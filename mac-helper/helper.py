#!/usr/bin/env python3
# Toollib Mac helper (0.14.4): a small program on your Mac that Toollib asks for what a browser and the Cloudflare
# worker cannot do:
#   - fetch pages, PDFs and interfaces from your home address (DOAB and some other sites refuse servers)
#   - show pages that build their content with JavaScript (a real Chromium through Playwright)
#   - keep the PDFs Toollib reads as originals in ~/Toollib-PDFs/<site>/, and hand Toollib the PDFs you put into
#     ~/Toollib-PDFs/Eingang/ (Toollib turns them into clips with their text; then they move to Eigene/)
#   - search the web through SearXNG next to it (only on 127.0.0.1, ~/.toollib-helper/searxng)
#   - run Toollib without a window (part 2): it syncs every minute and goes through websites marked "on the Mac"
#     while you have closed Toollib everywhere else (python helper.py background setup <settings file>)
# It speaks HTTPS with a certificate of its own (Safari refuses plain http from https pages), answers only your pages
# (allowed_origins) and only with your token. Setup: README.md next to this file, or ./install.sh.
#
#   GET  /ping                         -> {"ok":true,"version":…,"render":true,"inbox":2,…}
#   GET  /fetch?url=<address>[&keep=1] -> the answer of <address> (X-Final-URL); keep=1 keeps a PDF (X-Saved-As)
#   GET  /render?url=<address>         -> the page as Chromium shows it after its scripts ran (text/html)
#   GET  /files                        -> {"files":[{"path":"Eingang/x.pdf","name":…,"size":…,"mtime":…,"sha1":…}]}
#   GET  /file?path=<rel>[&sha1=…]     -> a PDF from the folder (found by its sha1 when it moved)
#   POST /files/imported {"path":…}    -> moves a PDF from Eingang/ to Eigene/: {"ok":true,"path":"Eigene/x.pdf"}
#   GET  /search?q=<words>[&page=2]    -> {"ok":true,"results":[{"title","url","content","engines","published"}],…}
#   GET  /background                   -> {"ok":true,"enabled":true,"alive":true,"status":{…}} (Toollib without a window)
#   POST /background/wake              -> it syncs and looks for work now instead of within the minute
#
#   python helper.py setup | run | info | trust | autostart on|off | renew [--ca] | token [--new]
#                    background setup <settings file> | background off [--forget] | background status
# Everything it keeps lives in ~/.toollib-helper (config.json, certs/, files.json, helper.log).
import argparse
import asyncio
import base64
import getpass
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import shutil
import signal
import socket
import ssl
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, unquote, urljoin, urlsplit

VERSION = '0.14.4.2'
HOME = Path(os.environ.get('TOOLLIB_HELPER_HOME') or '~/.toollib-helper').expanduser()
CONFIG = HOME / 'config.json'
STATE = HOME / 'files.json'
CERTS = HOME / 'certs'
LOG = HOME / 'helper.log'
LABEL = 'de.toollib.helper'
PLIST = Path('~/Library/LaunchAgents').expanduser() / f'{LABEL}.plist'
BROWSER = HOME / 'browser'                  # the Chromium profile of Toollib without a window
SEARXNG_DIR = HOME / 'searxng'              # SearXNG from source (install.sh), its venv and settings next to it
SEARXNG_VENV = HOME / 'searxng-venv'
SEARXNG_SETTINGS = HOME / 'searxng-settings.yml'
SEARXNG_LOG = HOME / 'searxng.log'
DEFAULTS = {
    'port': 8413,
    'bind': '0.0.0.0',                      # 127.0.0.1: only this Mac (no iPhone at home)
    'token': '',
    'pdf_dir': '~/Toollib-PDFs',
    'inbox': 'Eingang',
    'own': 'Eigene',
    'allowed_origins': ['https://mahlnycdir.github.io'],
    'names': [],                            # more names for the certificate, e.g. "mac.fritz.box"
    'max_bytes': 100 * 1024 * 1024,
    'render_timeout': 30,
    'user_agent': '',
    'allow_private': False,                 # tests only: fetch addresses in your own network too
    'mock_upstream': '',                    # tests only: every fetch goes to <mock>/?url=<address>
    'background': False,                    # Toollib without a window (python helper.py background setup <file>)
    'app_url': 'https://mahlnycdir.github.io/ToolLib/',
    'search_port': 8888,                    # SearXNG, only on 127.0.0.1
    'search_url': '',                       # tests, or another SearXNG of yours: ask that one instead
}
FORWARD = ['accept', 'accept-language', 'x-api-key', 'range', 'if-none-match', 'if-modified-since']
PASS_BACK = ['content-type', 'content-disposition', 'content-range', 'retry-after', 'last-modified', 'etag', 'link',
             'x-ratelimit-remaining', 'x-ratelimit-reset']
ALLOW_HEADERS = 'X-Toollib-Token, Accept, Accept-Language, X-Api-Key, Range, If-None-Match, If-Modified-Since, Content-Type'
EXPOSE = ('X-Final-URL, X-Proxy-Version, X-Saved-As, X-Saved-Sha1, X-Rendered, X-Status, X-File-Path, Content-Type, '
          'Content-Length, Content-Disposition, Content-Range, Retry-After, Last-Modified, ETag, Link, '
          'X-RateLimit-Remaining, X-RateLimit-Reset')
MAX_REDIRECTS = 6
# The certificate authority of the helper may only vouch for names and addresses in your own network.
PERMITTED_DNS = ['localhost', 'local', 'fritz.box', 'home.arpa', 'lan', 'home', 'internal']
PERMITTED_NETS = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '::1/128', 'fc00::/7']
PRIVATE_SUFFIX = re.compile(r'(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa|fritz\.box)$')


def say(*parts):
    print(time.strftime('%Y-%m-%d %H:%M:%S'), *parts, flush=True)


# ------------------------------------------------------------------ settings
def load_config():
    cfg = dict(DEFAULTS)
    if CONFIG.exists():
        cfg.update(json.loads(CONFIG.read_text('utf-8')))
    return cfg


def save_config(cfg):
    HOME.mkdir(parents=True, exist_ok=True)
    keep = {k: v for k, v in cfg.items() if k in DEFAULTS}
    CONFIG.write_text(json.dumps(keep, indent=2, ensure_ascii=False) + '\n', 'utf-8')
    os.chmod(CONFIG, 0o600)


def pdf_root(cfg):
    return Path(cfg['pdf_dir']).expanduser()


def shown(path):
    p = str(path)
    home = str(Path.home())
    return '~' + p[len(home):] if p.startswith(home) else p


# ------------------------------------------------------------------ names and addresses of this Mac
def host_names(cfg):
    names = {'localhost'}
    try:
        h = socket.gethostname().strip().rstrip('.').lower()
        if h:
            names.add(h if '.' in h else f'{h}.local')
    except OSError:
        pass
    if sys.platform == 'darwin':
        try:
            out = subprocess.run(['scutil', '--get', 'LocalHostName'], capture_output=True, text=True, timeout=5).stdout.strip()
            if out:
                names.add(f'{out.lower()}.local')
        except Exception:
            pass
    names.update(str(n).lower().rstrip('.') for n in cfg.get('names') or [] if n)
    return sorted(names)


def lan_ips():
    ips = {'127.0.0.1'}
    try:   # the address of the default route; UDP "connect" sends nothing
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return sorted(ip for ip in ips if ipaddress.ip_address(ip).is_private)


def covered(name, domains):
    return any(name == d or name.endswith('.' + d) for d in domains)


# ------------------------------------------------------------------ certificates
def _x509():
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
    return x509, hashes, serialization, rsa, ExtendedKeyUsageOID, NameOID


def _write_key(path, key):
    _, _, serialization, _, _, _ = _x509()
    path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    os.chmod(path, 0o600)


def make_ca(cfg):
    x509, hashes, serialization, rsa, _, NameOID = _x509()
    CERTS.mkdir(parents=True, exist_ok=True)
    names = host_names(cfg)
    dns = list(PERMITTED_DNS) + [n for n in names if not covered(n, PERMITTED_DNS)]
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    short = next((n for n in names if n != 'localhost'), 'Mac').split('.')[0]
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f'Toollib Helper CA ({short})'),
                         x509.NameAttribute(NameOID.ORGANIZATION_NAME, 'Toollib')])
    now = datetime.now(timezone.utc)
    permitted = [x509.DNSName(d) for d in dns] + [x509.IPAddress(ipaddress.ip_network(n)) for n in PERMITTED_NETS]
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=3650))
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
            .add_extension(x509.KeyUsage(digital_signature=False, content_commitment=False, key_encipherment=False,
                                         data_encipherment=False, key_agreement=False, key_cert_sign=True, crl_sign=True,
                                         encipher_only=False, decipher_only=False), critical=True)
            .add_extension(x509.NameConstraints(permitted_subtrees=permitted, excluded_subtrees=None), critical=True)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
            .sign(key, hashes.SHA256()))
    _write_key(CERTS / 'ca-key.pem', key)
    (CERTS / 'ca.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    (CERTS / 'ca.json').write_text(json.dumps({'dns': dns}) + '\n', 'utf-8')
    # for the iPhone: AirDrop this file, then trust it (README)
    (HOME / 'toollib-helper-ca.cer').write_bytes(cert.public_bytes(serialization.Encoding.DER))
    for old in ('server.pem', 'server-key.pem', 'server.json'):
        (CERTS / old).unlink(missing_ok=True)
    say('made a new certificate authority', shown(CERTS / 'ca.pem'))


def leaf_wanted(cfg):
    dns = json.loads((CERTS / 'ca.json').read_text('utf-8'))['dns']
    names = [n for n in host_names(cfg) if covered(n, dns)]
    nets = [ipaddress.ip_network(n) for n in PERMITTED_NETS]
    ips = sorted(i for i in set(lan_ips()) | {'127.0.0.1'} if any(ipaddress.ip_address(i) in n for n in nets))
    return names, ips + ['::1']


def make_leaf(cfg):
    x509, hashes, serialization, rsa, ExtendedKeyUsageOID, NameOID = _x509()
    ca_cert = x509.load_pem_x509_certificate((CERTS / 'ca.pem').read_bytes())
    ca_key = serialization.load_pem_private_key((CERTS / 'ca-key.pem').read_bytes(), password=None)
    names, ips = leaf_wanted(cfg)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = datetime.now(timezone.utc)
    sans = [x509.DNSName(n) for n in names] + [x509.IPAddress(ipaddress.ip_address(i)) for i in ips]
    cert = (x509.CertificateBuilder()
            .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, names[-1] if names else 'localhost')]))
            .issuer_name(ca_cert.subject).public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=397))
            .add_extension(x509.SubjectAlternativeName(sans), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False, key_encipherment=True,
                                         data_encipherment=False, key_agreement=False, key_cert_sign=False, crl_sign=False,
                                         encipher_only=False, decipher_only=False), critical=True)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
            .sign(ca_key, hashes.SHA256()))
    _write_key(CERTS / 'server-key.pem', key)
    (CERTS / 'server.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM) + (CERTS / 'ca.pem').read_bytes())
    (CERTS / 'server.json').write_text(json.dumps({'names': names, 'ips': ips, 'until': (now + timedelta(days=397)).isoformat()}) + '\n', 'utf-8')
    say('certificate for', ', '.join(names + ips))


def ensure_certs(cfg):
    """True when the server certificate changed."""
    if not (CERTS / 'ca.pem').exists() or not (CERTS / 'ca-key.pem').exists():
        make_ca(cfg)
    try:
        have = json.loads((CERTS / 'server.json').read_text('utf-8'))
        names, ips = leaf_wanted(cfg)
        fresh = datetime.fromisoformat(have['until']) - datetime.now(timezone.utc) > timedelta(days=30)
        if fresh and have['names'] == names and have['ips'] == ips and (CERTS / 'server.pem').exists():
            return False
    except (OSError, ValueError, KeyError):
        pass
    make_leaf(cfg)
    return True


def ssl_context():
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(CERTS / 'server.pem', CERTS / 'server-key.pem')
    return ctx


# ------------------------------------------------------------------ which addresses may be fetched
def refuse(url, cfg):
    try:
        u = urlsplit(url)
    except ValueError:
        return 'bad-url'
    if u.scheme not in ('http', 'https'):
        return 'only-http'
    if u.username or u.password:
        return 'no-credentials-in-url'
    host = (u.hostname or '').lower().rstrip('.')
    if not host:
        return 'bad-url'
    if cfg['allow_private']:
        return ''
    try:
        port = u.port
    except ValueError:
        return 'bad-url'
    if port and port not in (80, 443, 8080, 8443):
        return 'port-not-allowed'
    if '.' not in host and ':' not in host:
        return 'private-host'
    if PRIVATE_SUFFIX.search(host):
        return 'private-host'
    try:
        if not ipaddress.ip_address(host).is_global:
            return 'private-host'
    except ValueError:
        pass
    return ''


async def resolves_private(url, cfg):
    if cfg['allow_private'] or cfg['mock_upstream']:
        return ''
    host = urlsplit(url).hostname or ''
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, None)
    except OSError:
        return ''   # the request itself will say it cannot reach the host
    for info in infos:
        try:
            if not ipaddress.ip_address(info[4][0].split('%')[0]).is_global:
                return 'private-host'
        except ValueError:
            continue
    return ''


def is_pdf(body, ctype):
    return 'pdf' in (ctype or '').lower() or body[:4] == b'%PDF'


# ------------------------------------------------------------------ the PDF folder
class Files:
    def __init__(self, cfg):
        self.cfg = cfg
        self.root = pdf_root(cfg)
        self.inbox = self.root / cfg['inbox']
        self.own = self.root / cfg['own']
        for d in (self.root, self.inbox, self.own):
            d.mkdir(parents=True, exist_ok=True)
        readme = self.root / 'LIESMICH.txt'
        if not readme.exists():
            readme.write_text(f'Toollib-PDFs\n\n{cfg["inbox"]}/   Lege hier PDFs hinein (z. B. Skripte). Toollib liest sie ein und legt sie danach nach {cfg["own"]}/.\n'
                              f'{cfg["own"]}/    Deine eingelesenen PDFs.\n<website>/  Originale der PDFs, die Toollib gelesen hat.\n', 'utf-8')
        try:
            self.state = json.loads(STATE.read_text('utf-8'))
        except (OSError, ValueError):
            self.state = {}
        self.state.setdefault('meta', {})     # rel -> [size, mtime, sha1]
        self.state.setdefault('by_sha1', {})  # sha1 -> rel

    def save(self):
        STATE.write_text(json.dumps(self.state, indent=1) + '\n', 'utf-8')

    def rel(self, p):
        return p.relative_to(self.root).as_posix()

    def inside(self, rel):
        p = (self.root / rel).resolve()
        root = self.root.resolve()
        return p if (p == root or root in p.parents) else None

    def sha1_of(self, p):
        st = p.stat()
        rel = self.rel(p)
        m = self.state['meta'].get(rel)
        if m and m[0] == st.st_size and m[1] == int(st.st_mtime):
            return m[2]
        h = hashlib.sha1()
        with open(p, 'rb') as f:
            for chunk in iter(lambda: f.read(1 << 20), b''):
                h.update(chunk)
        sha = h.hexdigest()
        self.state['meta'][rel] = [st.st_size, int(st.st_mtime), sha]
        self.state['by_sha1'][sha] = rel
        return sha

    def inbox_files(self):
        out = []
        now = time.time()
        for p in sorted(self.inbox.rglob('*')):
            if not p.is_file() or p.suffix.lower() != '.pdf' or any(part.startswith('.') for part in p.relative_to(self.inbox).parts):
                continue
            st = p.stat()
            if now - st.st_mtime < 3:      # still being copied
                continue
            out.append({'path': self.rel(p), 'name': p.name, 'size': st.st_size, 'mtime': int(st.st_mtime * 1000), 'sha1': self.sha1_of(p)})
        self.save()
        return out

    def find(self, rel='', sha1=''):
        if rel:
            p = self.inside(rel)
            if p and p.is_file() and p.suffix.lower() == '.pdf':
                return p
        if sha1:
            known = self.state['by_sha1'].get(sha1)
            if known:
                p = self.inside(known)
                if p and p.is_file() and self.sha1_of(p) == sha1:
                    return p
            for p in self.root.rglob('*.pdf'):   # it moved: look once through the whole folder
                if p.is_file() and self.sha1_of(p) == sha1:
                    self.save()
                    return p
            self.save()
        return None

    @staticmethod
    def free(p):
        if not p.exists():
            return p
        for n in range(2, 1000):
            q = p.with_name(f'{p.stem}-{n}{p.suffix}')
            if not q.exists():
                return q
        raise OSError('no free name')

    def keep(self, url, body, disposition=''):
        """A fetched PDF as original in <site>/<name>.pdf; the same file is kept once."""
        sha = hashlib.sha1(body).hexdigest()
        known = self.state['by_sha1'].get(sha)
        if known and (self.root / known).is_file():
            return known, sha
        u = urlsplit(url)
        site = re.sub(r'^www\.', '', (u.hostname or 'web').lower())
        name = ''
        m = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)', disposition or '', re.I)
        if m:
            name = unquote(m.group(1))
        if not name:
            segs = [unquote(s) for s in u.path.split('/') if s]
            generic = {'pdf', 'download', 'view', 'file', 'content', 'fulltext', 'bitstream', 'retrieve'}
            name = next((s for s in reversed(segs) if s.lower().removesuffix('.pdf') not in generic), '') or 'document'
        name = re.sub(r'[^\w.\-]+', '-', name).strip('-.')[:120] or 'document'
        if not name.lower().endswith('.pdf'):
            name += '.pdf'
        folder = self.root / re.sub(r'[^\w.\-]+', '-', site)
        folder.mkdir(parents=True, exist_ok=True)
        p = self.free(folder / name)
        p.write_bytes(body)
        rel = self.rel(p)
        st = p.stat()
        self.state['meta'][rel] = [st.st_size, int(st.st_mtime), sha]
        self.state['by_sha1'][sha] = rel
        self.save()
        return rel, sha

    def imported(self, rel):
        p = self.inside(rel)
        inbox = self.inbox.resolve()
        if not p or not p.is_file() or inbox not in p.parents:
            return None
        dest = self.free(self.own.resolve() / p.relative_to(inbox))
        dest.parent.mkdir(parents=True, exist_ok=True)
        sha = self.sha1_of(p)
        shutil.move(str(p), str(dest))
        self.state['meta'].pop(rel, None)
        new = self.rel(dest)
        st = dest.stat()
        self.state['meta'][new] = [st.st_size, int(st.st_mtime), sha]
        self.state['by_sha1'][sha] = new
        self.save()
        return new


# ------------------------------------------------------------------ pages with JavaScript
class NotHtml(Exception):
    pass


class Renderer:
    def __init__(self, cfg, upstream):
        self.cfg = cfg
        self.upstream = upstream
        self.pw = None
        self.browser = None
        self.sem = asyncio.Semaphore(2)
        self.lock = asyncio.Lock()
        self.last = 0.0
        self.busy = 0
        try:
            import playwright  # noqa: F401
            self.available = True
        except ImportError:
            self.available = False

    async def _browser(self):
        async with self.lock:
            if self.browser and self.browser.is_connected():
                return self.browser
            from playwright.async_api import async_playwright
            if not self.pw:
                self.pw = await async_playwright().start()
            self.browser = await self.pw.chromium.launch(headless=True)
            return self.browser

    async def close_idle(self):
        while True:
            await asyncio.sleep(60)
            if self.browser and not self.busy and time.time() - self.last > 600:
                async with self.lock:
                    try:
                        await self.browser.close()
                    except Exception:
                        pass
                    self.browser = None
                    say('closed Chromium (idle)')

    async def _route(self, route):
        req = route.request
        if req.resource_type in ('image', 'media', 'font'):
            return await route.abort()
        if req.url.startswith(('http://', 'https://')):
            if refuse(req.url, self.cfg):
                return await route.abort()
            if self.cfg['mock_upstream']:
                try:
                    status, headers, body = await self.upstream(req.url, {}, 'GET')
                except Exception:
                    return await route.abort()
                return await route.fulfill(status=status, headers={k: v for k, v in headers.items() if k in ('content-type', 'location')}, body=body)
        return await route.continue_()

    async def render(self, url):
        from playwright.async_api import TimeoutError as PWTimeout
        self.busy += 1
        try:
            browser = await self._browser()
            ua = self.cfg['user_agent'] or (await self._ua(browser))
            ctx = await browser.new_context(user_agent=ua, service_workers='block', accept_downloads=False, viewport={'width': 1280, 'height': 900})
            try:
                await ctx.route('**/*', self._route)
                page = await ctx.new_page()
                try:
                    resp = await page.goto(url, wait_until='domcontentloaded', timeout=self.cfg['render_timeout'] * 1000)
                except Exception as e:
                    if 'Download is starting' in str(e) or 'net::ERR_ABORTED' in str(e):
                        raise NotHtml() from e
                    raise
                ctype = (resp.headers.get('content-type', '') if resp else '') or ''
                if ctype and 'html' not in ctype.lower():
                    raise NotHtml()
                try:
                    await page.wait_for_load_state('networkidle', timeout=8000)
                except PWTimeout:
                    pass
                for _ in range(10):   # some pages fill in a moment after the network is quiet
                    n = await page.evaluate('() => ((document.body && document.body.innerText) || "").trim().length')
                    if n > 400:
                        break
                    await page.wait_for_timeout(300)
                return await page.content(), page.url, (resp.status if resp else 200)
            finally:
                await ctx.close()
        finally:
            self.busy -= 1
            self.last = time.time()

    _agent = ''

    async def _ua(self, browser):
        if not Renderer._agent:
            page = await browser.new_page()
            Renderer._agent = (await page.evaluate('navigator.userAgent')).replace('HeadlessChrome', 'Chrome')
            await page.close()
        return Renderer._agent


# ------------------------------------------------------------------ the web through SearXNG (0.14.4)
SEARXNG_YML = """# SearXNG for the Toollib Mac helper: only on this Mac, answers in JSON too. Made by helper.py; yours to change.
use_default_settings: true
general:
  instance_name: "Toollib"
  enable_metrics: false
search:
  safe_search: 0
  autocomplete: ""
  formats: [html, json]
server:
  bind_address: "127.0.0.1"
  port: {port}
  secret_key: "{secret}"
  limiter: false
  public_instance: false
  image_proxy: false
"""


class Search:
    """SearXNG next to the helper: started with it, bound to 127.0.0.1, asked with format=json."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.external = cfg['search_url'].rstrip('/')
        self.python = SEARXNG_VENV / 'bin' / 'python'
        self.base = self.external or f"http://127.0.0.1:{cfg['search_port']}"
        self.proc = None
        self.started = 0.0
        self.lock = asyncio.Lock()

    @property
    def installed(self):
        return bool(self.external) or (self.python.exists() and (SEARXNG_DIR / 'searx').is_dir())

    def write_settings(self):
        if not SEARXNG_SETTINGS.exists():
            SEARXNG_SETTINGS.write_text(SEARXNG_YML.format(port=int(self.cfg['search_port']), secret=secrets.token_hex(32)), 'utf-8')
        os.chmod(SEARXNG_SETTINGS, 0o600)

    async def start(self):
        if self.external or not self.installed:
            return
        async with self.lock:
            if self.proc and self.proc.returncode is None:
                return
            self.write_settings()
            if SEARXNG_LOG.exists() and SEARXNG_LOG.stat().st_size > 5 * 1024 * 1024:
                SEARXNG_LOG.replace(SEARXNG_LOG.with_suffix('.log.1'))
            env = {k: v for k, v in os.environ.items() if not k.startswith('SEARXNG_')}
            env['SEARXNG_SETTINGS_PATH'] = str(SEARXNG_SETTINGS)
            with open(SEARXNG_LOG, 'ab') as log:
                self.proc = await asyncio.create_subprocess_exec(
                    str(self.python), '-m', 'searx.webapp', cwd=str(SEARXNG_DIR), env=env,
                    stdin=subprocess.DEVNULL, stdout=log, stderr=log)
            self.started = time.time()
            say(f'SearXNG started on {self.base} (pid {self.proc.pid}, log {shown(SEARXNG_LOG)})')

    async def search(self, session, q, page=1, lang=''):
        import aiohttp
        await self.start()
        params = {'q': q, 'format': 'json', 'pageno': str(page), 'safesearch': '0'}
        if lang:
            params['language'] = lang
        for attempt in range(40):   # it needs a few seconds after starting
            try:
                async with session.get(f'{self.base}/search', params=params, timeout=aiohttp.ClientTimeout(total=25)) as r:
                    if r.status != 200:
                        raise aiohttp.ClientResponseError(r.request_info, r.history, status=r.status, message='searxng')
                    return await r.json(content_type=None)
            except aiohttp.ClientConnectorError:
                if self.external or time.time() - self.started > 30:
                    raise
                await asyncio.sleep(0.5)
        raise aiohttp.ClientError('searxng-not-ready')

    async def stop(self):
        if self.proc and self.proc.returncode is None:
            self.proc.terminate()
            try:
                await asyncio.wait_for(self.proc.wait(), 5)
            except asyncio.TimeoutError:
                self.proc.kill()
            say('SearXNG stopped')


# ------------------------------------------------------------------ Toollib without a window (0.14.4 part 2)
# The helper opens Toollib (app_url) in a Chromium of its own, headless, with its own profile in ~/.toollib-helper/
# browser. Your settings come in once from your encrypted settings file (background setup); after that the page lives
# there like Toollib in a browser tab: it syncs every minute and goes through the websites you marked "on the Mac".
# Its Chromium trusts the helper's own certificate by its public key only, and asks the helper on localhost.
def ca_spki():
    from cryptography import x509
    from cryptography.hazmat.primitives import serialization
    ca = x509.load_pem_x509_certificate((CERTS / 'ca.pem').read_bytes())
    der = ca.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return base64.b64encode(hashlib.sha256(der).digest()).decode()


def app_origin(cfg):
    u = urlsplit(cfg['app_url'])
    return f'{u.scheme}://{u.netloc}'


def init_script(cfg, background):
    """Runs before Toollib's own scripts, only on Toollib's page: the helper on this Mac and its token, every time."""
    put = {'research.helper': f'https://localhost:{cfg["port"]}', 'research.helperToken': cfg['token'], 'helper.mode': bool(background)}
    return ('(() => { if (location.origin !== %s) return; try {\n'
            '  for (const [k, v] of Object.entries(%s)) localStorage.setItem("toollib." + k, JSON.stringify(v));\n'
            '  if (!localStorage.getItem("toollib.sync.device")) localStorage.setItem("toollib.sync.device", JSON.stringify("Mac-Helfer"));\n'
            '} catch (e) { /* no storage */ } })();') % (json.dumps(app_origin(cfg)), json.dumps(put))


async def open_app(pw, cfg, background):
    BROWSER.mkdir(parents=True, exist_ok=True)
    os.chmod(BROWSER, 0o700)
    args = ['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,'
            'PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests',
            f'--ignore-certificate-errors-spki-list={ca_spki()}']
    try:
        ctx = await pw.chromium.launch_persistent_context(str(BROWSER), headless=True, args=args, accept_downloads=False,
                                                          viewport={'width': 1280, 'height': 900})
    except Exception as e:
        if 'ProcessSingleton' in str(e) or 'SingletonLock' in str(e):
            raise RuntimeError('profile-in-use') from e
        raise
    await ctx.add_init_script(script=init_script(cfg, background))
    page = ctx.pages[0] if ctx.pages else await ctx.new_page()
    page.on('pageerror', lambda e: say('background page error:', str(e)[:300]))
    page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and say('background console:', m.text[:300]))
    return ctx, page


def app_page(cfg, background):
    return cfg['app_url'] + ('?helper=1' if background else '')


class Background:
    EVERY = 30
    RELOAD = 6 * 3600

    def __init__(self, cfg):
        self.cfg = cfg
        self.pw = self.ctx = self.page = None
        self.status = None
        self.error = ''
        self.loaded = 0.0
        self.caff = None
        self.task = None

    @property
    def alive(self):
        return bool(self.page and not self.page.is_closed())

    async def _open(self):
        from playwright.async_api import async_playwright
        if not self.pw:
            self.pw = await async_playwright().start()
        self.ctx, self.page = await open_app(self.pw, self.cfg, True)
        await self.page.goto(app_page(self.cfg, True), wait_until='load', timeout=90000)
        self.loaded = time.time()
        say('Toollib without a window is open:', app_page(self.cfg, True))

    async def _close(self):
        ctx, self.ctx, self.page = self.ctx, None, None
        if ctx:
            try:
                await ctx.close()
            except Exception:   # noqa: BLE001 – it crashed already
                pass

    def _awake(self, on):
        """While a run goes on, the Mac does not fall asleep by itself (caffeinate ends with the helper)."""
        if sys.platform != 'darwin':
            return
        if on and not (self.caff and self.caff.poll() is None):
            self.caff = subprocess.Popen(['caffeinate', '-i', '-s', '-w', str(os.getpid())])
            say('keeping the Mac awake while it goes through a website')
        elif not on and self.caff and self.caff.poll() is None:
            self.caff.terminate()
            self.caff = None

    async def loop(self):
        wait = self.EVERY
        while True:
            try:
                if not self.alive:
                    await self._close()
                    await self._open()
                st = await asyncio.wait_for(self.page.evaluate('() => window.toollibBackground ? window.toollibBackground.status() : null'), 20)
                if st is None and time.time() - self.loaded > 90:
                    raise RuntimeError('Toollib did not start in the page')
                self.status = st
                self.error = (st or {}).get('error') or ''
                running = bool(st and st.get('running'))
                self._awake(running)
                if not running and time.time() - self.loaded > self.RELOAD:   # now and then the newest Toollib
                    await self.page.reload(wait_until='load', timeout=90000)
                    self.loaded = time.time()
                wait = self.EVERY
            except asyncio.CancelledError:
                raise
            except Exception as e:   # noqa: BLE001 – the page or Chromium broke: open it again a little later
                self.error = str(e)[:200]
                say('background:', repr(e)[:300])
                self._awake(False)
                await self._close()
                wait = min(wait * 2, 600)
            await asyncio.sleep(wait)

    async def fresh(self):
        """The state right now instead of the last look (every 30 s)."""
        if not self.alive:
            return
        try:
            st = await asyncio.wait_for(self.page.evaluate('() => window.toollibBackground ? window.toollibBackground.status() : null'), 5)
            if st is not None:
                self.status = st
        except Exception:   # noqa: BLE001 – the loop finds out what broke
            pass

    async def wake(self):
        if not self.alive:
            return False
        try:
            await asyncio.wait_for(self.page.evaluate('() => { if (window.toollibBackground) window.toollibBackground.wake(); return true; }'), 10)
            return True
        except Exception:   # noqa: BLE001
            return False

    def start(self):
        self.task = asyncio.create_task(self.loop())

    async def stop(self):
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except (asyncio.CancelledError, Exception):   # noqa: BLE001
                pass
        self._awake(False)
        await self._close()
        if self.pw:
            await self.pw.stop()
            self.pw = None


# ------------------------------------------------------------------ the server
def make_app(cfg):
    import aiohttp
    from aiohttp import web

    origins = {o.rstrip('/') for o in cfg['allowed_origins']}
    ua = cfg['user_agent'] or f'Toollib-Research/{VERSION} (personal research client; Mac helper)'
    files = Files(cfg)
    state = {'session': None}

    class TooLarge(Exception):
        pass

    async def session():
        if not state['session']:
            state['session'] = aiohttp.ClientSession(cookie_jar=aiohttp.DummyCookieJar(), timeout=aiohttp.ClientTimeout(total=120, sock_connect=20))
        return state['session']

    async def upstream(url, headers, method='GET'):
        """One request without following redirects: (status, headers in lower case, body)."""
        target = f"{cfg['mock_upstream'].rstrip('/')}/?url={quote(url, safe='')}" if cfg['mock_upstream'] else url
        s = await session()
        async with s.request(method, target, headers=headers, allow_redirects=False) as r:
            length = r.headers.get('Content-Length')
            if length and length.isdigit() and int(length) > cfg['max_bytes'] and 'gzip' not in r.headers.get('Content-Encoding', ''):
                raise TooLarge(int(length))
            chunks, n = [], 0
            async for chunk in r.content.iter_chunked(1 << 16):
                n += len(chunk)
                if n > cfg['max_bytes']:
                    raise TooLarge(n)
                chunks.append(chunk)
            return r.status, {k.lower(): v for k, v in r.headers.items()}, b''.join(chunks)

    renderer = Renderer(cfg, upstream)
    search = Search(cfg)
    background = Background(cfg) if cfg['background'] else None

    def cors_for(origin):
        if not origin or origin.rstrip('/') not in origins:
            return {}
        return {'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
                'Access-Control-Allow-Headers': ALLOW_HEADERS, 'Access-Control-Expose-Headers': EXPOSE,
                'Access-Control-Max-Age': '86400', 'Vary': 'Origin'}

    def jerr(error, status, **extra):
        return web.json_response({'ok': False, 'error': error, **extra}, status=status, headers={'Cache-Control': 'no-store'})

    @web.middleware
    async def guard(request, handler):
        origin = request.headers.get('Origin')
        cors = cors_for(origin)
        started = time.time()
        if origin and not cors:
            return jerr('origin-not-allowed', 403)
        if request.method == 'OPTIONS':
            h = dict(cors)
            if request.headers.get('Access-Control-Request-Private-Network') == 'true':
                h['Access-Control-Allow-Private-Network'] = 'true'
            return web.Response(status=204, headers=h)
        if not cfg['token'] or not hmac.compare_digest(request.headers.get('X-Toollib-Token', '').encode(), cfg['token'].encode()):
            resp = jerr('bad-token', 401)
        else:
            try:
                resp = await handler(request)
            except web.HTTPException:
                raise
            except Exception as e:   # noqa: BLE001 – the app gets a short reason, the log the rest
                say('error', request.path, repr(e))
                resp = jerr('helper-error', 502, detail=str(e)[:200])
        resp.headers.update(cors)
        host = urlsplit(request.query.get('url', '')).hostname or ''
        say(request.method, request.path, host, resp.status, f'{(time.time() - started) * 1000:.0f} ms')
        return resp

    async def ping(request):
        return web.json_response({'ok': True, 'name': 'toollib-mac-helper', 'version': VERSION, 'maxBytes': cfg['max_bytes'],
                                  'render': renderer.available, 'pdfDir': shown(files.root), 'inboxDir': shown(files.inbox), 'ownDir': shown(files.own), 'inbox': len(await asyncio.to_thread(files.inbox_files)),
                                  'names': host_names(cfg), 'port': cfg['port'], 'search': search.installed,
                                  'background': bool(background)}, headers={'Cache-Control': 'no-store'})

    async def fetch(request):
        url = request.query.get('url', '')
        why = refuse(url, cfg) or await resolves_private(url, cfg)
        if why:
            return jerr(why, 403)
        headers = {k: request.headers[k] for k in FORWARD if k in request.headers}
        headers['User-Agent'] = ua
        method = 'HEAD' if request.method == 'HEAD' else 'GET'
        at = url
        for hop in range(MAX_REDIRECTS + 1):
            try:
                status, rh, body = await upstream(at, headers, method)
            except TooLarge as e:
                return jerr('too-large', 413, bytes=e.args[0], limit=cfg['max_bytes'])
            except asyncio.TimeoutError:
                return jerr('timeout', 504)
            except aiohttp.ClientError as e:
                return jerr('unreachable', 502, detail=str(e)[:200])
            if status in (301, 302, 303, 307, 308) and rh.get('location'):
                if hop >= MAX_REDIRECTS:
                    return jerr('too-many-redirects', 508)
                nxt = urljoin(at, rh['location'])
                why = refuse(nxt, cfg) or await resolves_private(nxt, cfg)
                if why:
                    return jerr(why, 403, at=nxt)
                at = nxt
                continue
            break
        out = {k.title() if k != 'etag' else 'ETag': rh[k] for k in PASS_BACK if k in rh}
        out.update({'X-Final-URL': at, 'X-Proxy-Version': VERSION, 'Cache-Control': 'no-store'})
        if request.query.get('keep') == '1' and 200 <= status < 300 and method == 'GET' and is_pdf(body, rh.get('content-type', '')):
            try:
                rel, sha = await asyncio.to_thread(files.keep, at, body, rh.get('content-disposition', ''))
                out['X-Saved-As'] = quote(rel)
                out['X-Saved-Sha1'] = sha
            except OSError as e:
                say('could not keep', at, e)
        return web.Response(status=status, body=b'' if method == 'HEAD' else body, headers=out)

    async def render(request):
        url = request.query.get('url', '')
        why = refuse(url, cfg) or await resolves_private(url, cfg)
        if why:
            return jerr(why, 403)
        if not renderer.available:
            return jerr('no-render', 501)
        async with renderer.sem:
            try:
                html, final, status = await renderer.render(url)
            except NotHtml:
                return jerr('not-html', 415)
            except Exception as e:   # noqa: BLE001
                if 'Timeout' in type(e).__name__:
                    return jerr('timeout', 504)
                return jerr('render-failed', 502, detail=str(e)[:200])
        return web.Response(status=status, body=html.encode('utf-8'), headers={
            'Content-Type': 'text/html; charset=utf-8', 'X-Final-URL': final, 'X-Rendered': '1', 'X-Status': str(status),
            'X-Proxy-Version': VERSION, 'Cache-Control': 'no-store'})

    async def list_files(request):
        return web.json_response({'ok': True, 'files': await asyncio.to_thread(files.inbox_files), 'inbox': cfg['inbox'], 'own': cfg['own']},
                                 headers={'Cache-Control': 'no-store'})

    async def get_file(request):
        p = await asyncio.to_thread(files.find, request.query.get('path', ''), request.query.get('sha1', ''))
        if not p:
            return jerr('not-found', 404)
        return web.Response(body=await asyncio.to_thread(p.read_bytes), headers={
            'Content-Type': 'application/pdf', 'X-File-Path': quote(files.rel(p)), 'Cache-Control': 'no-store',
            'Content-Disposition': f"inline; filename*=UTF-8''{quote(p.name)}"})

    async def imported(request):
        try:
            data = await request.json()
        except ValueError:
            return jerr('bad-request', 400)
        new = await asyncio.to_thread(files.imported, str(data.get('path') or ''))
        if not new:
            return jerr('not-found', 404)
        return web.json_response({'ok': True, 'path': new})

    async def web_search(request):
        q = request.query.get('q', '').strip()[:400]
        if not q:
            return jerr('bad-request', 400)
        if not search.installed:
            return jerr('no-search', 501)
        try:
            page = max(1, min(10, int(request.query.get('page', '1'))))
        except ValueError:
            page = 1
        lang = re.sub(r'[^A-Za-z-]', '', request.query.get('lang', ''))[:10]
        try:
            data = await search.search(await session(), q, page, lang)
        except asyncio.TimeoutError:
            return jerr('timeout', 504)
        except aiohttp.ClientError as e:
            return jerr('search-down', 502, detail=str(e)[:200])
        results, seen = [], set()
        for r in data.get('results') or []:
            url = str(r.get('url') or '')
            if not url.startswith(('http://', 'https://')) or url in seen:
                continue
            seen.add(url)
            results.append({'title': str(r.get('title') or '')[:300], 'url': url, 'content': str(r.get('content') or '')[:600],
                            'engines': [str(e) for e in (r.get('engines') or [r.get('engine')]) if e][:6],
                            'published': str(r.get('publishedDate') or '')[:40]})
        down = [str(e[0]) for e in data.get('unresponsive_engines') or [] if e]
        return web.json_response({'ok': True, 'query': q, 'page': page, 'results': results,
                                  'suggestions': [str(x) for x in data.get('suggestions') or []][:8], 'unresponsive': down},
                                 headers={'Cache-Control': 'no-store'})

    async def background_state(request):
        if not background:
            return web.json_response({'ok': True, 'enabled': False}, headers={'Cache-Control': 'no-store'})
        await background.fresh()
        return web.json_response({'ok': True, 'enabled': True, 'alive': background.alive, 'status': background.status,
                                  'error': background.error, 'app': cfg['app_url']}, headers={'Cache-Control': 'no-store'})

    async def background_wake(request):
        if not background:
            return web.json_response({'ok': True, 'enabled': False})
        return web.json_response({'ok': True, 'enabled': True, 'woke': await background.wake()})

    async def closing(app):
        if background:
            await background.stop()
        await search.stop()
        if state['session']:
            await state['session'].close()
        if renderer.browser:
            await renderer.browser.close()
        if renderer.pw:
            await renderer.pw.stop()

    async def starting(app):
        app['idle'] = asyncio.create_task(renderer.close_idle())
        if search.installed:
            asyncio.create_task(search.start())
        if background:
            background.start()

    app = web.Application(middlewares=[guard], client_max_size=1 << 20)
    app.router.add_get('/ping', ping)
    app.router.add_route('*', '/fetch', fetch)
    app.router.add_get('/render', render)
    app.router.add_get('/files', list_files)
    app.router.add_get('/file', get_file)
    app.router.add_post('/files/imported', imported)
    app.router.add_get('/search', web_search)
    app.router.add_get('/background', background_state)
    app.router.add_post('/background/wake', background_wake)
    app.on_startup.append(starting)
    app.on_cleanup.append(closing)
    return app


async def serve(cfg):
    from aiohttp import web
    ensure_certs(cfg)
    ctx = ssl_context()
    runner = web.AppRunner(make_app(cfg), access_log=None)
    await runner.setup()
    # all addresses (IPv4 and IPv6: Safari tries ::1 for localhost first), or only this Mac
    hosts = [None] if cfg['bind'] in ('', '*', '0.0.0.0', '::') else (['127.0.0.1', '::1'] if cfg['bind'] in ('127.0.0.1', 'localhost') else [cfg['bind']])
    for host in hosts:
        await web.TCPSite(runner, host, cfg['port'], ssl_context=ctx).start()
    say(f'Toollib Mac helper {VERSION} on https://localhost:{cfg["port"]} (bound to {cfg["bind"]}), PDFs in {shown(pdf_root(cfg))}')

    async def watch_certs():   # a new address in the home network: a new certificate for new connections
        while True:
            await asyncio.sleep(600)
            try:
                if ensure_certs(cfg):
                    ctx.load_cert_chain(CERTS / 'server.pem', CERTS / 'server-key.pem')
            except Exception as e:   # noqa: BLE001
                say('certificate check failed', e)

    # launchd and Ctrl+C stop it with a signal: close Chromium and the connections before leaving
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop.set)
        except (NotImplementedError, RuntimeError):
            pass
    task = asyncio.create_task(watch_certs())
    await stop.wait()
    task.cancel()
    await runner.cleanup()
    say('stopped')


# ------------------------------------------------------------------ commands
def cmd_setup(cfg, args):
    HOME.mkdir(parents=True, exist_ok=True)
    os.chmod(HOME, 0o700)
    if not cfg['token']:
        cfg['token'] = secrets.token_urlsafe(24)
    save_config(cfg)
    ensure_certs(cfg)
    Files(cfg)
    cmd_info(cfg, args)


def cmd_info(cfg, args):
    names = host_names(cfg)
    ips = lan_ips()
    port = cfg['port']
    print(f'\nToollib Mac-Helfer {VERSION}')
    print(f'  Auf diesem Mac:      https://localhost:{port}')
    for n in [n for n in names if n != 'localhost'] + [i for i in ips if i != '127.0.0.1']:
        print(f'  Vom iPhone zu Hause: https://{n}:{port}')
    print(f'  Token:               {cfg["token"]}')
    print(f'  PDF-Ordner:          {shown(pdf_root(cfg))}  (Eingang: {cfg["inbox"]}/)')
    print(f'  Zertifikat:          {shown(CERTS / "ca.pem")}  (fürs iPhone: {shown(HOME / "toollib-helper-ca.cer")})')
    print(f'  Erlaubte Seiten:     {", ".join(cfg["allowed_origins"])}')
    print(f'  Startet von selbst:  {"ja" if PLIST.exists() else "nein"}  (python helper.py autostart on|off)')
    print(f'  Suche im Netz:       {"ja (SearXNG)" if Search(cfg).installed else "nein (install.sh richtet SearXNG ein)"}')
    print(f'  Im Hintergrund:      {"ja" if cfg["background"] else "nein"}  (python helper.py background setup <Einstellungs-Datei>)\n')


def cmd_trust(cfg, args):
    ensure_certs(cfg)
    if sys.platform != 'darwin':
        print('Nur auf dem Mac: dort kommt das Zertifikat in den Schlüsselbund. Hier selbst eintragen:', CERTS / 'ca.pem')
        return
    print('Das Zertifikat kommt in deinen Schlüsselbund; macOS fragt nach deinem Passwort.')
    keychain = Path('~/Library/Keychains/login.keychain-db').expanduser()
    subprocess.run(['security', 'add-trusted-cert', '-r', 'trustRoot', '-p', 'ssl', '-k', str(keychain), str(CERTS / 'ca.pem')], check=True)
    print('Vertraut. Safari und Chrome nehmen den Helfer jetzt an.')


def launchd_loaded():
    return subprocess.run(['launchctl', 'print', f'gui/{os.getuid()}/{LABEL}'], capture_output=True).returncode == 0


def launchd_stop():
    """Takes the helper out of launchd and waits until it is really gone (bootout returns before that)."""
    r = subprocess.run(['launchctl', 'bootout', f'gui/{os.getuid()}/{LABEL}'], capture_output=True)
    for _ in range(40):
        if not launchd_loaded():
            break
        time.sleep(0.25)
    return r.returncode == 0


def launchd_start():
    """Hands the helper to launchd; right after a bootout launchd answers "5: Input/output error" for a moment."""
    err = ''
    for attempt in range(8):
        r = subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(PLIST)], capture_output=True, text=True)
        if r.returncode == 0 or launchd_loaded():
            return True
        err = (r.stderr or r.stdout or '').strip()
        time.sleep(1 + attempt)
    raise RuntimeError(f'launchd nimmt den Helfer nicht an: {err}')


def cmd_autostart(cfg, args):
    if sys.platform != 'darwin':
        print('Von selbst starten geht hier über launchd nur auf dem Mac.')
        return
    launchd_stop()
    if args.state == 'off':
        PLIST.unlink(missing_ok=True)
        print('Der Helfer startet nicht mehr von selbst und läuft nicht mehr.')
        return
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    py = Path(sys.executable)
    plist = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>{LABEL}</string>
  <key>ProgramArguments</key><array><string>{py}</string><string>{Path(__file__).resolve()}</string><string>run</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>20</integer>
  <key>WorkingDirectory</key><string>{HOME}</string>
  <key>EnvironmentVariables</key><dict><key>TOOLLIB_HELPER_HOME</key><string>{HOME}</string></dict>
  <key>StandardOutPath</key><string>{LOG}</string>
  <key>StandardErrorPath</key><string>{LOG}</string>
</dict></plist>
'''
    PLIST.write_text(plist, 'utf-8')
    try:
        launchd_start()
    except RuntimeError as e:
        sys.exit(f'{e}\nNoch einmal versuchen: python helper.py autostart on (oder ab- und wieder anmelden).')
    print(f'Der Helfer läuft und startet bei jeder Anmeldung von selbst (Protokoll: {shown(LOG)}).')


def service(action):
    """Stops or starts the helper of launchd (only one Chromium may use the profile at a time). True: it was running."""
    if sys.platform != 'darwin' or not PLIST.exists():
        return False
    if action == 'stop':
        return launchd_stop()
    try:
        return launchd_start()
    except RuntimeError as e:
        print(f'{e}\nStarte ihn mit: python helper.py autostart on')
        return False


# Your settings go in here once: the page decrypts the file itself (the same code as "Load settings" in Toollib), takes
# everything but the helper address and its token (those point to this Mac), and syncs your knowledge for the first time.
SETUP_JS = """async ({ text, password }) => {
  const base = new URL('./', location.href).href;
  const file = await import(base + 'app/services/settings-file.js');
  let opened;
  try { opened = await file.readSettingsFile(text, password); } catch (e) { return { ok: false, error: e.code || String(e.message || e) }; }
  const skip = new Set(['toollib.research.helper', 'toollib.research.helperToken']);
  const rows = file.diffSettings(opened.settings).filter((r) => !skip.has(r.key));
  const applied = file.applySettings(rows);
  localStorage.setItem('toollib.sync.auto', 'true');
  return { ok: true, applied, device: opened.device || '', created: opened.created || '' };
}"""
SYNC_JS = """async () => {
  const sync = await import(new URL('./', location.href).href + 'app/services/sync.js');
  if (!sync.isConfigured()) return { ok: false, error: 'no-sync' };
  try { const r = await sync.syncKnowledge({ auto: false }); return { ok: true, result: r ? JSON.parse(JSON.stringify(r)) : null }; }
  catch (e) { return { ok: false, error: e.code || String(e.message || e) }; }
}"""


async def background_setup(cfg, text, password):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        ctx, page = await open_app(pw, cfg, False)
        try:
            await page.goto(app_page(cfg, False), wait_until='load', timeout=90000)
            r = await page.evaluate(SETUP_JS, {'text': text, 'password': password})
            if not r.get('ok'):
                return r
            say('settings taken over:', r['applied'], 'from', r.get('device') or 'a device', '– first Sync (this may take a few minutes) …')
            await page.reload(wait_until='load', timeout=90000)
            s = await page.evaluate(SYNC_JS)
            return {**r, 'sync': s}
        finally:
            await ctx.close()


def cmd_background(cfg, args):
    if args.state == 'status':
        print(f'Im Hintergrund: {"ja" if cfg["background"] else "nein"}  ·  Toollib von {cfg["app_url"]}  ·  Profil {shown(BROWSER)}')
        return
    if args.state == 'off':
        cfg['background'] = False
        save_config(cfg)
        was = service('stop')
        if args.forget and BROWSER.exists():
            shutil.rmtree(BROWSER)
            print('Das Profil mit deinen Einstellungen auf dem Helfer ist gelöscht.')
        if was:
            service('start')
        print('Der Helfer arbeitet nicht mehr im Hintergrund. Wieder an: python helper.py background setup <Einstellungs-Datei>')
        return
    if not cfg['token']:
        sys.exit('Erst einrichten: python helper.py setup')
    try:
        import playwright  # noqa: F401
    except ImportError:
        sys.exit('Dafür braucht der Helfer Playwright: bash install.sh')
    if not args.file:
        sys.exit('Welche Datei? python helper.py background setup ~/Downloads/toollib-settings-….json')
    path = Path(args.file).expanduser()
    try:
        text = path.read_text('utf-8')
    except OSError as e:
        sys.exit(f'Die Datei lässt sich nicht lesen: {e}')
    password = sys.stdin.readline().rstrip('\n') if args.password_stdin else getpass.getpass('Passwort der Einstellungs-Datei: ')
    ensure_certs(cfg)
    was = service('stop')
    try:
        r = asyncio.run(background_setup(cfg, text, password))
    except RuntimeError as e:
        if str(e) == 'profile-in-use':
            sys.exit('Ein anderer Helfer benutzt das Profil gerade. Halte ihn an (Ctrl+C oder python helper.py autostart off) und versuch es noch einmal.')
        raise
    finally:
        if was and not cfg['background']:
            service('start')
    if not r.get('ok'):
        why = {'wrong-password': 'Das Passwort passt nicht zu dieser Datei (oder die Datei wurde verändert).',
               'not-settings': 'Das ist keine Toollib-Einstellungs-Datei.', 'unsupported': 'Diese Datei kennt der Helfer noch nicht.',
               'too-large': 'Die Datei ist zu groß.'}.get(r.get('error'), r.get('error'))
        if was:
            service('start')
        sys.exit(f'Nicht übernommen: {why}')
    print(f'Übernommen: {r["applied"]} Einstellung(en) aus der Datei{" von " + r["device"] if r.get("device") else ""}.')
    sync = r.get('sync') or {}
    if sync.get('ok'):
        print('Erster Sync: fertig.')
    elif sync.get('error') == 'no-sync':
        print('Achtung: In der Datei steht kein Sync (Repository und Token). Ohne Sync sieht der Helfer keine Aufträge.')
    else:
        print(f'Erster Sync: nicht geklappt ({sync.get("error")}). Der Helfer versucht es jede Minute wieder.')
    cfg['background'] = True
    save_config(cfg)
    if was:
        service('start')
        print('Der Helfer läuft wieder, jetzt auch im Hintergrund.')
    else:
        print('Fertig. Starte den Helfer (python helper.py run oder autostart on); dann arbeitet er im Hintergrund.')


def cmd_renew(cfg, args):
    if args.ca:
        make_ca(cfg)
        print('Neues Zertifikat: auf dem Mac erneut „python helper.py trust“, auf dem iPhone die neue .cer-Datei installieren.')
    make_leaf(cfg)


def cmd_token(cfg, args):
    if args.new:
        cfg['token'] = secrets.token_urlsafe(24)
        save_config(cfg)
        print('Neuer Token; trag ihn auf jedem Gerät in Toollib ein und starte den Helfer neu.')
    print(cfg['token'])


def main():
    ap = argparse.ArgumentParser(description='Toollib Mac helper')
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('setup')
    sub.add_parser('run')
    sub.add_parser('info')
    sub.add_parser('trust')
    a = sub.add_parser('autostart')
    a.add_argument('state', choices=['on', 'off'])
    r = sub.add_parser('renew')
    r.add_argument('--ca', action='store_true')
    t = sub.add_parser('token')
    t.add_argument('--new', action='store_true')
    b = sub.add_parser('background')
    b.add_argument('state', choices=['setup', 'off', 'status'])
    b.add_argument('file', nargs='?')
    b.add_argument('--password-stdin', action='store_true', help='read the password from the first line of stdin')
    b.add_argument('--forget', action='store_true', help='with off: delete the profile with your settings too')
    args = ap.parse_args()
    cfg = load_config()
    if args.cmd == 'run':
        if not cfg['token']:
            sys.exit('Erst einrichten: python helper.py setup')
        if LOG.exists() and LOG.stat().st_size > 5 * 1024 * 1024:
            LOG.replace(LOG.with_suffix('.log.1'))
        try:
            asyncio.run(serve(cfg))
        except KeyboardInterrupt:
            pass
        return
    {'setup': cmd_setup, 'info': cmd_info, 'trust': cmd_trust, 'autostart': cmd_autostart, 'renew': cmd_renew, 'token': cmd_token,
     'background': cmd_background}[args.cmd](cfg, args)


if __name__ == '__main__':
    main()
