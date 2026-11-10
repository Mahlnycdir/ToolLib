// Toollib fetch proxy: a Cloudflare Worker that fetches public pages and research interfaces for Toollib.
// Browsers may only read answers from other sites that allow it (CORS); arXiv and many pages do not. Toollib then
// asks this worker, and the worker fetches the address and passes the answer on. Setup: README.md next to this file.
//
//   GET /ping                    -> {"ok":true,...} when the token is right (Toollib's "Test connection")
//   GET /fetch?url=<address>     -> the answer of <address>; X-Final-URL names the address after redirects
//        &ttl=<seconds>          -> Cloudflare may keep a successful answer that long (fewer requests to the site)
//
// Rules: only requests from your own pages (ALLOWED_ORIGINS) with your token (TOKEN, a secret); only http and https
// to public hosts (no localhost, no private networks); at most MAX_BYTES per answer; no cookies, no logins.
// Optional: ALLOWED_HOSTS limits the hosts (comma list, "*.example.org" for subdomains); USER_AGENT replaces the
// generic name the worker sends. The worker never sends anything about you to the sites.

const VERSION = '0.14.1';
const DEFAULT_MAX_BYTES = 30 * 1024 * 1024;
const TIMEOUT_MS = 90 * 1000;          // arXiv's interface can take most of a minute
const MAX_REDIRECTS = 6;
const FORWARD = ['accept', 'accept-language', 'x-api-key', 'range', 'if-none-match', 'if-modified-since'];
const PASS_BACK = ['content-type', 'content-length', 'content-disposition', 'content-range', 'retry-after', 'last-modified', 'etag', 'cache-control', 'link', 'x-ratelimit-remaining', 'x-ratelimit-reset'];
const ALLOW_HEADERS = 'X-Toollib-Token, Accept, Accept-Language, X-Api-Key, Range, If-None-Match, If-Modified-Since';
const EXPOSE = 'X-Final-URL, X-Proxy-Version, Content-Type, Content-Length, Content-Disposition, Content-Range, Retry-After, Last-Modified, ETag, Link, X-RateLimit-Remaining, X-RateLimit-Reset';

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env || {});
    } catch (e) {
      return json({ ok: false, error: 'proxy-error', detail: String(e?.message || e) }, 502, corsFor(request, env || {}));
    }
  },
};

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

function corsFor(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = list(env.ALLOWED_ORIGINS).map((o) => o.replace(/\/+$/, ''));
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Expose-Headers': EXPOSE,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}

// Same length and same time for every comparison, so the token cannot be guessed letter by letter.
function sameToken(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

async function handle(request, env) {
  const url = new URL(request.url);
  const cors = corsFor(request, env);
  const origin = request.headers.get('Origin');
  if (origin && !cors['Access-Control-Allow-Origin']) return json({ ok: false, error: 'origin-not-allowed' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ ok: false, error: 'method-not-allowed' }, 405, cors);
  if (!env.TOKEN) return json({ ok: false, error: 'no-token-configured' }, 500, cors);
  const token = request.headers.get('X-Toollib-Token') || '';
  if (!sameToken(token, env.TOKEN)) return json({ ok: false, error: 'bad-token' }, 401, cors);

  if (url.pathname === '/ping') return json({ ok: true, name: 'toollib-fetch-proxy', version: VERSION, maxBytes: maxBytes(env) }, 200, cors);
  if (url.pathname !== '/fetch') return json({ ok: false, error: 'not-found' }, 404, cors);

  let target;
  try { target = new URL(url.searchParams.get('url') || ''); } catch { return json({ ok: false, error: 'bad-url' }, 400, cors); }
  const refused = refuse(target, env);
  if (refused) return json({ ok: false, error: refused }, 403, cors);

  const headers = new Headers();
  for (const k of FORWARD) { const v = request.headers.get(k); if (v) headers.set(k, v); }
  headers.set('User-Agent', env.USER_AGENT || `Toollib-Research/${VERSION} (personal research client)`);
  const ttl = Math.max(0, Math.min(86400, Number(url.searchParams.get('ttl')) || 0));

  // Redirects by hand: every new address has to pass the same rules.
  let res;
  let at = target;
  for (let hop = 0; ; hop++) {
    const init = { method: request.method, headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) };
    if (ttl) init.cf = { cacheTtl: ttl, cacheEverything: true };
    res = await fetch(at.href, init);
    if (![301, 302, 303, 307, 308].includes(res.status) || !res.headers.get('location')) break;
    if (hop >= MAX_REDIRECTS) return json({ ok: false, error: 'too-many-redirects' }, 508, cors);
    let next;
    try { next = new URL(res.headers.get('location'), at); } catch { return json({ ok: false, error: 'bad-redirect' }, 502, cors); }
    const why = refuse(next, env);
    if (why) return json({ ok: false, error: why, at: next.href }, 403, cors);
    at = next;
  }

  const limit = maxBytes(env);
  const length = Number(res.headers.get('content-length'));
  if (Number.isFinite(length) && length > limit) return json({ ok: false, error: 'too-large', bytes: length, limit }, 413, cors);

  const out = new Headers(cors);
  for (const k of PASS_BACK) { const v = res.headers.get(k); if (v) out.set(k, v); }
  // Compressed upstream (arXiv's source files come that way): the body is unpacked on the way, so the length no longer fits.
  const packed = !!res.headers.get('content-encoding');
  if (packed) out.delete('content-length');
  out.set('X-Final-URL', at.href);
  out.set('X-Proxy-Version', VERSION);
  if (!ttl) out.set('Cache-Control', 'no-store');
  if (request.method === 'HEAD' || !res.body) return new Response(null, { status: res.status, headers: out });
  // Known size within the limit: straight through, without touching every chunk (saves CPU time on large PDFs).
  if (!packed && Number.isFinite(length) && res.headers.get('content-length')) return new Response(res.body, { status: res.status, headers: out });
  return new Response(capped(res.body, limit), { status: res.status, headers: out });
}

function maxBytes(env) {
  const n = Number(env.MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BYTES;
}

// The body, cut off with an error once it grows beyond the limit (for answers without Content-Length).
function capped(body, limit) {
  let seen = 0;
  return body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > limit) controller.error(new Error('too-large'));
      else controller.enqueue(chunk);
    },
  }));
}

// Why an address is refused, or '' when it may be fetched.
function refuse(u, env = {}) {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'only-http';
  if (u.username || u.password) return 'no-credentials-in-url';
  if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) return 'port-not-allowed';
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') && !host.includes(':')) return 'private-host';
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/.test(host)) return 'private-host';
  if (isPrivateAddress(host)) return 'private-host';
  const hosts = list(env.ALLOWED_HOSTS).map((s) => s.toLowerCase());
  if (hosts.length && !hosts.some((p) => (p.startsWith('*.') ? host === p.slice(2) || host.endsWith(p.slice(1)) : host === p))) return 'host-not-allowed';
  return '';
}

function isPrivateAddress(host) {
  const h = host.replace(/^\[|\]$/g, '');
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (/^\d+$/.test(h) || /^0x[0-9a-f]+$/i.test(h)) return true;                     // 2130706433, 0x7f000001
  if (h.includes(':')) {
    const x = h.toLowerCase();
    if (x === '::' || x === '::1') return true;
    if (/^(fc|fd|fe8|fe9|fea|feb)/.test(x)) return true;                             // unique local, link local
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (x.startsWith('::ffff:')) return true;
  }
  return false;
}
