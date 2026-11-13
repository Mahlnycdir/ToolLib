// Settings › Research and Mac helper: the fetcher (Cloudflare worker), the Mac helper at home, API keys, which
// paper sources are asked and what the search learns from.
import { h, toast } from '../../services/ui.js';
import { t, getLang } from '../../i18n/i18n.js';
import { loadPref, savePref } from '../../services/prefs.js';
import { researchSettings, saveResearchSetting, setSourceOn, sourceOn, testResearch } from '../../services/research.js';
import { SOURCES } from '../../services/research-sources.js';
import { errorText } from '../research-view.js';
import { crawlDefaults } from '../../services/crawl.js';
import { LEARN_SOURCES, learnOn, setLearnOn } from '../../services/learn.js';
import { card, iconEl, secretField } from './parts.js';

// ------------------------------------------------------------------ learning sources and the start mode of research
export function learnCard() {
  const box = card(t('settings.learn'));
  box.id = 'settings-learn';
  const list = h('ul', { class: 'research-sources' });
  for (const src of LEARN_SOURCES) {
    const id = `learn-src-${src.id}`;
    const cb = h('input', { type: 'checkbox', id, checked: learnOn(src.id) ? true : null });
    cb.addEventListener('change', () => setLearnOn(src.id, cb.checked));
    list.append(h('li', {}, h('label', { class: 'rs-check', for: id }, cb, h('span', {}, h('strong', { text: src.name }), h('span', { class: 'muted small', text: ` · ${src.groups.map((g) => t(`learn.group.${g}`)).join(', ')}${src.helper ? ` · ${t('settings.learn.helper')}` : ''}` })))));
  }
  const mode = loadPref('research.mode', 'learn');
  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': t('settings.learn.mode') });
  for (const m of ['learn', 'papers']) seg.append(h('button', { type: 'button', class: m === mode ? 'on' : '', text: t(`research.mode.${m}`), onclick: (e) => { savePref('research.mode', m); for (const b of seg.children) b.classList.toggle('on', b === e.currentTarget); } }));
  box.append(h('p', { class: 'muted small', text: t('settings.learn.hint') }), h('div', { class: 'set-field' }, h('span', { class: 'field-label', text: t('settings.learn.mode') }), seg), list);
  return box;
}

// Research (0.14.0): your fetcher for the sites the browser may not read directly, the free keys, the sources.
// One field of the research settings, saved when it loses the focus; secret ones get a "Show" button.
function researchField(s, key, label, attrs, hint, link) {
  const input = h('input', { class: 'field', id: `research-${key}`, value: s[key] || '', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', ...attrs });
  input.addEventListener('change', () => saveResearchSetting(key, input.value));
  const hintEl = hint ? h('span', { class: 'field-hint' }, h('span', { text: hint }), link ? ' ' : null,
    link ? h('a', { href: link.href, target: '_blank', rel: 'noopener noreferrer', text: link.text }) : null) : null;
  const row = h('label', { class: 'set-field', for: `research-${key}` }, h('span', { class: 'field-label', text: label }), input, hintEl);
  return { input, row: attrs.type === 'password' ? secretField(row) : row };
}

// The lines of a connection test: ok, warning, failure, still running.
function testLines() {
  const result = h('ul', { class: 'checks', role: 'status' });
  const line = (l) => h('li', { class: `check ${l.status}` },
    iconEl({ ok: 'check', warn: 'warn', fail: 'close', info: 'info', busy: 'refresh' }[l.status] || 'info', l.status === 'busy' ? 'spin' : ''),
    h('span', { text: l.key.startsWith('research.err.') ? `${l.vars.name}: ${errorText(l.vars.id, l.key.slice(13), l.vars.status)}` : t(l.key, l.vars) }));
  return { result, show: (lines) => result.replaceChildren(...lines.map(line)) };
}
function testButton(fields, run) {
  const test = h('button', { type: 'button', class: 'btn' }, iconEl('link'), h('span', { text: t('settings.sync.test') }));
  test.addEventListener('click', async () => {
    for (const f of fields) saveResearchSetting(f.input.id.replace('research-', ''), f.input.value);
    test.disabled = true;
    try { await run(); } finally { test.disabled = false; }
  });
  return test;
}

// Settings › Research: the fetcher (a Cloudflare worker that fetches pages for the browser) and the API keys.
export function researchCard() {
  const s = researchSettings();
  const worker = researchField(s, 'worker', t('settings.research.worker'), { type: 'url', placeholder: 'https://toollib-fetch.yourname.workers.dev', inputmode: 'url' }, t('settings.research.worker.hint'));
  const token = researchField(s, 'token', t('settings.research.token'), { type: 'password', autocomplete: 'off' }, t('settings.research.token.hint'));
  const oa = researchField(s, 'openalexKey', t('settings.research.openalex'), { type: 'password', autocomplete: 'off' }, t('settings.research.openalex.hint'), { href: 'https://openalex.org/settings/api', text: 'openalex.org/settings/api' });
  const s2 = researchField(s, 's2Key', t('settings.research.s2'), { type: 'password', autocomplete: 'off' }, t('settings.research.s2.hint'), { href: 'https://www.semanticscholar.org/product/api', text: 'semanticscholar.org/product/api' });
  const lines = testLines();
  const test = testButton([worker, token, oa, s2], () => testResearch(lines.show));
  return h('section', { class: 'card', id: 'settings-research' },
    h('h2', { text: t('settings.research') }),
    h('p', { class: 'muted', text: t('settings.research.hint') }),
    worker.row, token.row,
    h('h3', { class: 'set-sub', text: t('settings.research.keys') }),
    oa.row, s2.row,
    h('div', { class: 'btn-row' }, test), lines.result);
}

// Settings › Mac helper (0.14.4, own page since 0.25.0): your Mac at home fetches pages with JavaScript, keeps the
// PDF folder, searches the web (SearXNG) and reads handwriting. Its address and token come from `install.sh`.
export function helperCard() {
  const s = researchSettings();
  const helper = researchField(s, 'helper', t('settings.research.helper'), { type: 'url', placeholder: 'https://localhost:8413', inputmode: 'url' }, t('settings.research.helper.hint'));
  const helperToken = researchField(s, 'helperToken', t('settings.research.helperToken'), { type: 'password', autocomplete: 'off' }, t('settings.research.helperToken.hint'));
  // the address in a tab of its own (0.19.0): a short answer with "error" means helper and certificate are fine
  const tryTab = h('button', { type: 'button', class: 'btn small', text: t('settings.research.helperTab') });
  tryTab.addEventListener('click', () => {
    const v = helper.input.value.trim().replace(/\/+$/, '');
    if (/^https:\/\/[^\s/]+$/.test(v)) window.open(`${v}/ping`, '_blank', 'noopener');
    else toast(t('settings.research.helperTabBad'), 'error');
  });
  const addrRow = h('div', { class: 'row-input' });
  helper.input.before(addrRow);
  addrRow.append(helper.input, tryTab);
  const lines = testLines();
  const test = testButton([helper, helperToken], () => testResearch(lines.show, { only: 'helper' }));
  return h('section', { class: 'card', id: 'settings-helper' },
    h('h2', { text: t('settings.research.helperTitle') }),
    h('p', { class: 'muted', text: t('settings.research.helperIntro') }),
    helper.row, helperToken.row,
    h('div', { class: 'btn-row' }, test), lines.result);
}

// Which paper sources the search asks, and what a run through a website starts with.
export function researchSourcesCard() {
  const s = researchSettings();
  const list = h('ul', { class: 'research-sources' });
  const lang = getLang();
  for (const src of SOURCES) {
    const box = h('input', { type: 'checkbox', checked: sourceOn(src.id, s) ? true : null, id: `research-src-${src.id}` });
    box.addEventListener('change', () => setSourceOn(src.id, box.checked));
    list.append(h('li', {}, h('label', { class: 'rs-check', for: `research-src-${src.id}` }, box,
      h('span', {}, h('strong', { text: src.name }), h('span', { class: 'muted small', text: ` · ${src.what[lang] || src.what.en}${src.cors === 'no' ? ` · ${t('settings.research.viaWorker')}` : ''}` })))));
  }
  // going through a website (0.14.3): what a new run starts with
  const cd = crawlDefaults();
  const crawlNum = (key, label, value, attrs, hint) => {
    const input = h('input', { class: 'field', type: 'number', id: `crawl-set-${key}`, value: String(value), ...attrs });
    input.addEventListener('change', () => { const n = Number(input.value); if (Number.isFinite(n)) savePref(`crawl.${key}`, key === 'gap' ? Math.max(0.5, n) : n); input.value = String(crawlDefaults()[key]); });
    return h('label', { class: 'set-field', for: `crawl-set-${key}` }, h('span', { class: 'field-label', text: label }), input, h('span', { class: 'field-hint', text: hint }));
  };
  const pdfs = h('label', { class: 'set-check' }, h('input', { type: 'checkbox', id: 'crawl-set-pdfs', checked: cd.pdfs ? true : null }),
    h('span', {}, h('b', { text: t('crawl.pdfs') }), h('span', { class: 'field-hint', text: t('crawl.pdfs.hint') })));
  pdfs.firstChild.addEventListener('change', (e) => savePref('crawl.pdfs', e.target.checked));
  return h('section', { class: 'card', id: 'settings-research-sources' },
    h('h2', { text: t('settings.research.sources') }), list,
    h('h3', { class: 'set-sub', text: t('settings.crawl') }),
    h('p', { class: 'muted small', text: t('settings.crawl.hint') }),
    h('div', { class: 'cr-row' }, crawlNum('depth', t('crawl.depth'), cd.depth, { min: '0', max: '10', step: '1' }, t('crawl.depth.hint')),
      crawlNum('max', t('crawl.max'), cd.max, { min: '1', max: '5000', step: '1' }, t('crawl.max.hint'))),
    crawlNum('gap', t('settings.crawl.gap'), cd.gap, { min: '0.5', max: '120', step: '0.5' }, t('settings.crawl.gap.hint')),
    pdfs);
}
