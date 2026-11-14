// Going through a website (0.14.3) in the research window: the dialog that starts a run, the panel with its progress
// at the top of the folder, and the pages of the folder as a tree by their path below the start.
import { h, toast, modal, confirmDialog } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { getLang, t } from '../i18n/i18n.js';
import { hasFetcher, helperFetch, researchSettings } from '../services/research.js';
import {
  CrawlError, commandMac, crawlDefaults, crawlState, loadCrawl, onCrawl, parseStart, pauseCrawl, queueCrawl, recrawl, resumeCrawl, scopeFor, scopeFromText,
  scopeLabel, inScope, startCrawl, stopCrawl, treePath,
} from '../services/crawl.js';
import { loadPref, savePref } from '../services/prefs.js';
import { isHelperMode } from '../services/background.js';
import { isSyncing, syncKnowledge } from '../services/sync.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

export function crawlErrorText(code, status = '') {
  const key = `crawl.why.${code}`;
  const text = t(key, { status: status || '' });
  return (text === key ? t('crawl.why.failed', { status: status || '' }) : text).replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------------ starting a run
// Resolves to the new folder's path, or null.
export async function crawlDialog({ start = '' } = {}) {
  const d = crawlDefaults();
  const worker = hasFetcher(researchSettings());
  const startUrl = parseStart(start) || '';
  const field = (label, input, hint) => h('label', { class: 'set-field' }, h('span', { class: 'field-label', text: label }), input, hint ? h('span', { class: 'field-hint', text: hint }) : null);
  const startIn = h('input', { class: 'field', type: 'url', inputmode: 'url', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', placeholder: 'docs.scipy.org/doc/scipy/tutorial', value: startUrl || start, id: 'crawl-start' });
  const scopeIn = h('input', { class: 'field', type: 'text', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', id: 'crawl-scope' });
  const depthIn = h('input', { class: 'field', type: 'number', min: '0', max: '10', step: '1', value: String(d.depth), id: 'crawl-depth' });
  const maxIn = h('input', { class: 'field', type: 'number', min: '1', max: '5000', step: '1', value: String(d.max), id: 'crawl-max' });
  const pdfIn = h('input', { type: 'checkbox', id: 'crawl-pdfs', checked: d.pdfs ? true : null });
  const nameIn = h('input', { class: 'field', type: 'text', id: 'crawl-name' });
  // where the run goes (0.14.4): here, or on the Mac in the background (it gets the folder by Sync)
  const helperMode = isHelperMode();
  const onMac = !helperMode && loadPref('crawl.where', 'here') === 'mac';
  const whereHere = h('input', { type: 'radio', name: 'crawl-where', id: 'crawl-where-here', value: 'here', checked: onMac ? null : true });
  const whereMac = h('input', { type: 'radio', name: 'crawl-where', id: 'crawl-where-mac', value: 'mac', checked: onMac ? true : null });
  const where = helperMode ? null : h('fieldset', { class: 'cr-where' },
    h('legend', { class: 'field-label', text: t('crawl.where') }),
    h('label', { class: 'set-check', for: 'crawl-where-here' }, whereHere, h('span', {}, h('b', { text: t('crawl.where.here') }), h('span', { class: 'field-hint', text: t('crawl.where.here.hint') }))),
    h('label', { class: 'set-check', for: 'crawl-where-mac' }, whereMac, h('span', {}, h('b', { text: t('crawl.where.mac') }), h('span', { class: 'field-hint', text: t('crawl.where.mac.hint') }))));
  const error = h('p', { class: 'rs-line warn cr-error', hidden: true });
  let scopeTouched = false;
  let nameTouched = false;
  const fill = () => {
    const url = parseStart(startIn.value);
    if (!url) return;
    const sc = scopeFor(url);
    if (!scopeTouched) scopeIn.value = scopeLabel(sc);
    if (!nameTouched) nameIn.value = scopeLabel(scopeTouched ? (scopeFromText(scopeIn.value) || sc) : sc).replace(/\/$/, '');
  };
  startIn.addEventListener('input', fill);
  scopeIn.addEventListener('input', () => { scopeTouched = true; if (!nameTouched) { const sc = scopeFromText(scopeIn.value); if (sc) nameIn.value = scopeLabel(sc).replace(/\/$/, ''); } });
  nameIn.addEventListener('input', () => { nameTouched = true; });
  fill();
  const body = h('div', { class: 'cr-dialog' },
    worker ? null : h('p', { class: 'rs-line warn' }, iconEl('warn'), h('span', { text: t('crawl.needWorker') }), h('a', { href: '#/settings/research', text: t('research.toSettings') })),
    field(t('crawl.start'), startIn),
    field(t('crawl.scope'), scopeIn, t('crawl.scope.hint')),
    h('div', { class: 'cr-row' }, field(t('crawl.depth'), depthIn, t('crawl.depth.hint')), field(t('crawl.max'), maxIn, t('crawl.max.hint'))),
    h('label', { class: 'set-check', for: 'crawl-pdfs' }, pdfIn, h('span', {}, h('b', { text: t('crawl.pdfs') }), h('span', { class: 'field-hint', text: t('crawl.pdfs.hint') }))),
    field(t('crawl.folder'), nameIn, t('crawl.folder.hint')),
    where,
    h('p', { class: 'muted small', text: t('crawl.rules', { gap: String(d.gap).replace('.', t('crawl.decimal')) }) }),
    error);
  const say = (key) => { error.hidden = false; error.replaceChildren(iconEl('warn'), h('span', { text: t(key) })); };
  const opts = await modal({
    title: t('crawl.title'),
    body,
    wide: true,
    onOpen: () => setTimeout(() => (startUrl ? depthIn : startIn).focus(), 60),
    actions: [
      { label: t('action.cancel'), value: null },
      {
        label: t('crawl.go'), kind: 'primary',
        value: () => {
          if (!worker && !whereMac.checked) { say('crawl.needWorker'); return undefined; }
          const url = parseStart(startIn.value);
          if (!url) { say('crawl.badUrl'); return undefined; }
          const scope = scopeFromText(scopeIn.value) || scopeFor(url);
          if (!inScope(url, scope)) { say('crawl.why.outside-start'); return undefined; }
          return {
            start: url, scope, title: nameIn.value.trim(),
            depth: Math.round(Math.min(10, Math.max(0, num(depthIn.value, d.depth)))),
            max: Math.round(Math.min(5000, Math.max(1, num(maxIn.value, d.max)))),
            pdfs: pdfIn.checked,
            mac: !helperMode && whereMac.checked,
          };
        },
      },
    ],
  });
  if (!opts) return null;
  if (!helperMode) savePref('crawl.where', opts.mac ? 'mac' : 'here');
  try {
    if (opts.mac) {
      const folder = await queueCrawl(opts);
      toast(t('crawl.mac.queuedToast'), 'ok', 5000);
      tellMac();
      return folder;
    }
    const folder = await startCrawl(opts);
    toast(t('crawl.started', { scope: scopeLabel(opts.scope) }), 'ok');
    return folder;
  } catch (e) {
    toast(crawlErrorText(e instanceof CrawlError ? e.code : 'failed'), 'error', 6000);
    return null;
  }
}

// A run for the Mac or a command for it: sync now, and wake the helper when this device reaches it.
// A sync already going may not carry the change yet: then once more after it.
async function tellMac() {
  try {
    if (isSyncing()) await syncKnowledge().catch(() => {});
    await syncKnowledge();
  } catch { /* the next sync takes it along */ }
  helperFetch('/background/wake', { method: 'POST', json: {} }).catch(() => {});
}

// The panel of a run on the Mac (0.14.4), as other devices see it: what the folder says after the last sync.
function macPanel(folder) {
  const el = h('section', { class: 'cr-panel cr-mac', 'aria-live': 'polite' });
  const draw = () => {
    const c = folder.crawl || {};
    const pending = c.cmdAt && c.cmdAt > (c.cmdDone || '');
    const time = c.at ? new Date(c.at) : null;
    const when = time && !Number.isNaN(time.getTime()) ? time.toLocaleString(getLang() === 'de' ? 'de-DE' : undefined, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : c.date || '?';
    const line = c.state === 'queued' ? t('crawl.mac.queued')
      : c.state === 'running' ? t('crawl.mac.running', { pages: c.pages, queue: c.queue, when })
        : c.state === 'paused' ? t('crawl.mac.paused', { pages: c.pages, queue: c.queue, when })
          : c.state === 'done' ? (c.why === 'limit' ? t('crawl.mac.limit', { pages: c.pages, queue: c.queue, when }) : t('crawl.mac.done', { pages: c.pages, when }))
            : c.state === 'stopped' ? t('crawl.mac.stopped', { pages: c.pages, when })
              : c.state === 'error' ? t('crawl.mac.error', { why: crawlErrorText(c.why) }) : t('crawl.mac.queued');
    const send = (cmd) => async () => {
      try {
        await commandMac(folder.path, cmd);
        toast(t('crawl.mac.sentToast'), 'ok', 4000);
        tellMac();
      } catch (e) { toast(crawlErrorText(e instanceof CrawlError ? e.code : 'failed'), 'error', 6000); }
    };
    const btn = (label, iconName, cmd, primary = false) => h('button', { type: 'button', class: `btn small${primary ? ' primary' : ''}`, dataset: { cmd }, onclick: send(cmd) }, iconEl(iconName), h('span', { text: label }));
    const buttons = [];
    if (c.state === 'running') buttons.push(btn(t('crawl.pause'), 'pause', 'pause'), btn(t('crawl.stop'), 'stop', 'stop'));
    else if (c.state === 'queued') buttons.push(btn(t('crawl.mac.cancel'), 'stop', 'stop'));
    else if (c.state === 'paused' || c.state === 'error' || c.state === 'stopped') buttons.push(btn(t('crawl.resume'), 'play', 'go', true), btn(t('crawl.again'), 'refresh', 'again'));
    else if (c.state === 'done' && c.why === 'limit') buttons.push(btn(t('crawl.more', { n: c.max || crawlDefaults().max }), 'play', 'more', true), btn(t('crawl.again'), 'refresh', 'again'));
    else buttons.push(btn(t('crawl.again'), 'refresh', 'again'));
    el.dataset.status = c.state || 'queued';
    el.replaceChildren(...[
      h('div', { class: 'cr-head' }, iconEl(c.state === 'running' ? 'refresh' : 'globe', c.state === 'running' ? 'spin' : ''), h('strong', { text: t('crawl.mac.panel') }),
        h('a', { class: 'rs-tag cr-scope', href: c.start || '#', target: '_blank', rel: 'noopener noreferrer', text: c.scope || '' })),
      h('p', { class: 'cr-line', text: line }),
      pending ? h('p', { class: 'cr-line muted small cr-sent', text: t('crawl.mac.sent', { cmd: t(`crawl.mac.cmd.${c.cmd}`) }) }) : null,
      h('div', { class: 'btn-row cr-actions' }, ...buttons),
      h('p', { class: 'muted small', text: t('crawl.mac.hint') })].filter(Boolean));
  };
  draw();
  return { el, folder: folder.path, setFolder(f) { folder = f; draw(); }, destroy() {} };
}

// ------------------------------------------------------------------ the panel at the top of a crawl folder
export function crawlPanel(folder) {
  // a run on the Mac: this device only sees the folder (the Toollib in the helper runs it like its own)
  if (folder.crawl?.on === 'mac' && !isHelperMode()) return macPanel(folder);
  const el = h('section', { class: 'cr-panel', 'aria-live': 'polite' });
  let b = crawlState(folder.path);
  let openSkipped = false;
  const act = (fn) => async () => {
    try { await fn(); } catch (e) { toast(crawlErrorText(e instanceof CrawlError ? e.code : 'failed'), 'error', 6000); }
  };
  const again = act(async () => {
    if (!(await confirmDialog(t('crawl.again'), t('crawl.again.confirm'), { okLabel: t('crawl.again') }))) return;
    await recrawl(folder.path);
  });
  function draw() {
    const c = folder.crawl || {};
    const status = b?.status || '';
    const line = [];
    let kind = '';
    if (!b) {
      if (c.state === 'running' || c.state === 'paused') line.push(t('crawl.elsewhere', { date: c.date || '?', pages: c.pages || 0 }));
      else if (c.date) line.push(t('crawl.doneOn', { date: c.date, pages: c.pages || 0 }));
    } else if (status === 'running') {
      line.push(t('crawl.running', { pages: b.pages, queue: b.queue, depth: b.depth, max: b.max, gap: String(Math.max(b.gap, b.delay)).replace('.', t('crawl.decimal')) }));
      if (!b.here) line.push(t('crawl.otherWindow'));
    } else if (status === 'paused') {
      line.push(b.why === 'offline' ? t('crawl.offline', { pages: b.pages }) : b.why === 'busy' ? t('crawl.why.busy') : t('crawl.paused', { pages: b.pages, queue: b.queue }));
    } else if (status === 'done') {
      line.push(b.why === 'limit' ? t('crawl.limit', { pages: b.pages, queue: b.queue }) : t('crawl.done', { pages: b.pages }));
    } else if (status === 'stopped') line.push(t('crawl.stopped', { pages: b.pages }));
    else if (status === 'error') { kind = 'warn'; line.push(t('crawl.error', { why: crawlErrorText(b.why, b.whyStatus) })); }
    if (b?.scopeMoved) line.push(t('crawl.scopeMoved', { scope: b.scope }));

    const btn = (label, iconName, fn, primary = false) => h('button', { type: 'button', class: `btn small${primary ? ' primary' : ''}`, onclick: fn }, iconEl(iconName), h('span', { text: label }));
    const buttons = [];
    if (status === 'running') {
      buttons.push(btn(t('crawl.pause'), 'pause', () => pauseCrawl(folder.path)), btn(t('crawl.stop'), 'stop', () => stopCrawl(folder.path)));
    } else if (b && (status === 'paused' || status === 'error')) {
      buttons.push(btn(t('crawl.resume'), 'play', act(() => resumeCrawl(folder.path)), true), btn(t('crawl.again'), 'refresh', again));
      if (['no-worker', 'worker-token', 'worker-origin', 'worker', 'helper-token', 'helper-origin', 'helper'].includes(b.why)) buttons.push(h('a', { class: 'btn small', href: /^helper/.test(b.why) ? '#/settings/helper' : '#/settings/research' }, iconEl('settings'), h('span', { text: t('research.toSettings') })));
    } else if (b && status === 'done' && b.why === 'limit') {
      const more = crawlDefaults().max;
      buttons.push(btn(t('crawl.more', { n: more }), 'play', act(() => resumeCrawl(folder.path, { more })), true), btn(t('crawl.again'), 'refresh', again));
    } else buttons.push(btn(t('crawl.again'), 'refresh', again));

    const counts = b?.counts || {};
    const bits = [];
    if (counts.updated || counts.same) bits.push(t('crawl.count.recrawl', { saved: counts.saved || 0, updated: counts.updated || 0, same: counts.same || 0 }));
    if (counts.sitemap) bits.push(t('crawl.count.sitemap', { n: counts.sitemap }));
    for (const k of ['rendered', 'robots', 'outside', 'noindex', 'empty', 'dup', 'type', 'missing', 'blocked', 'failed']) if (counts[k]) bits.push(t(`crawl.count.${k}`, { n: counts[k] }));
    const skipped = b?.skipped || [];
    const details = skipped.length ? h('details', { class: 'cr-skipped', open: openSkipped ? true : null },
      h('summary', { class: 'small', text: t('crawl.skippedList', { n: skipped.length }) }),
      h('ul', { class: 'cr-skip-list small' }, skipped.slice().reverse().map((x) => h('li', {},
        h('span', { class: 'rs-tag', text: t(`crawl.skip.${x.why}`) }),
        h('a', { href: x.u, target: '_blank', rel: 'noopener noreferrer', text: x.u.replace(/^https?:\/\//, '') }))))) : null;
    details?.addEventListener('toggle', () => { openSkipped = details.open; });
    const progress = status === 'running' || status === 'paused'
      ? h('div', { class: 'cr-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(b.max), 'aria-valuenow': String(b.counts.fetched) },
        h('span', { style: `width:${Math.min(100, Math.round((b.counts.fetched / Math.max(1, Math.min(b.max, b.counts.fetched + b.queue))) * 100))}%` }))
      : null;
    el.dataset.status = status || c.state || '';
    el.replaceChildren(...[
      h('div', { class: 'cr-head' }, iconEl(status === 'running' ? 'refresh' : 'globe', status === 'running' ? 'spin' : ''), h('strong', { text: t('crawl.panel') }),
        h('a', { class: 'rs-tag cr-scope', href: b?.start || c.start || '#', target: '_blank', rel: 'noopener noreferrer', text: b?.scope || c.scope || '' })),
      ...line.map((x) => h('p', { class: `cr-line${kind ? ` ${kind}` : ''}`, text: x })),
      progress,
      status === 'running' && b.current ? h('p', { class: 'cr-current muted small', title: b.current, text: b.current.replace(/^https?:\/\//, '') }) : null,
      h('div', { class: 'btn-row cr-actions' }, ...buttons),
      bits.length ? h('p', { class: 'cr-counts muted small', text: bits.join(' · ') }) : null,
      details].filter(Boolean));
  }
  const off = onCrawl((x) => { if (x.folder === folder.path) { b = x; draw(); } });
  draw();
  if (!b) loadCrawl(folder.path).then((x) => { if (x && !b) { b = x; draw(); } }).catch(() => {});
  return { el, folder: folder.path, setFolder(f) { folder = f; draw(); }, destroy: off };
}

// ------------------------------------------------------------------ the pages as a tree
const closed = new Set();   // folders of the tree you closed, kept while the app is open

// badge(d): an element shown beside the path of a page (0.29.0: the library shows how far you read it)
export function pageTree(folder, clips, { selected = '', onPick, onRead, badge } = {}) {
  const scope = folder.crawl?.scope || '';
  const root = { name: '', dirs: new Map(), pages: [] };
  for (const d of clips) {
    const parts = treePath(d.url || '', scope);
    // "sub/" heads the folder sub, "sub/e.html" sits in it; each page shows its path below the area
    const dirLike = /\/$/.test(d.url || '');
    const name = parts.length ? `${parts.join('/')}${dirLike ? '/' : ''}` : '/';
    if (!dirLike) parts.pop();
    let node = root;
    for (const p of parts) {
      if (!node.dirs.has(p)) node.dirs.set(p, { name: p, dirs: new Map(), pages: [] });
      node = node.dirs.get(p);
    }
    node.pages.push({ d, name, head: name.endsWith('/') });
  }
  const count = (n) => n.pages.length + [...n.dirs.values()].reduce((a, x) => a + count(x), 0);
  const row = ({ d, name }) => {
    const on = selected === d.path;
    // every page of a run is unchecked at first: only a checked one gets a mark, so the list stays calm
    const main = h('button', { type: 'button', class: 'cr-page-main', 'aria-pressed': String(on) },
      h('span', { class: 'cr-page-title', text: d.title }),
      h('span', { class: 'cr-page-path muted small' }, h('span', { text: name || '/' }),
        d.kind === 'document' ? h('span', { class: 'rs-tag', text: 'PDF' }) : null,
        d.verified ? h('span', { class: 'rs-tag ok', title: t('research.checked') }, iconEl('check')) : null,
        badge?.(d) || null));
    main.addEventListener('click', () => onPick?.(d));
    return h('li', { class: `cr-page${on ? ' on' : ''}` }, main,
      h('button', { type: 'button', class: 'icon-btn cr-read', title: t('research.read'), 'aria-label': `${t('research.read')}: ${d.title}`, html: icon('book'), onclick: () => onRead?.(d) }),
      d.url ? h('a', { class: 'icon-btn', href: d.url, target: '_blank', rel: 'noopener noreferrer', title: t('research.open'), 'aria-label': t('research.open'), html: icon('external') }) : null);
  };
  const draw = (node, key) => {
    const ul = h('ul', { class: 'cr-tree' }, ...[...node.pages.filter((x) => x.head), ...node.pages.filter((x) => !x.head)].map(row));
    for (const dir of [...node.dirs.values()].sort((a, b) => Number(a.name.startsWith('/')) - Number(b.name.startsWith('/')))) {
      const k = `${folder.path}|${key}/${dir.name}`;
      const box = h('details', { class: 'cr-dir', open: closed.has(k) ? null : true },
        h('summary', {}, iconEl('folder'), h('span', { class: 'cr-dir-name', text: `${dir.name}/` }), h('span', { class: 'rs-count', text: String(count(dir)) })),
        draw(dir, `${key}/${dir.name}`));
      box.addEventListener('toggle', () => { if (box.open) closed.delete(k); else closed.add(k); });
      ul.append(h('li', { class: 'cr-dir-item' }, box));
    }
    return ul;
  };
  return draw(root, '');
}
