// "Daten sammeln" (0.35.0, P17, design board R2): one surface of the research window. Left: where (pages, a search on
// the web, how deep, how many), what (variables with kind and expression) and fixed values and formulas, with "Neu
// holen" and how often by itself. Middle: the result as a table, a chart or cards, each row with its page and
// unchecked until you confirm it; "Als Sammlung" (a note with the table, in the project you work on) and "Als Widget
// auf Heute". Right: what Loom counted along (cheapest, best, where an expression found nothing) and your queries.
// The arithmetic and the fetching live in services/collect.js; this file draws and saves.
// For Python readers: `q` is the query as a dict you edit in place; save() writes it after a short pause (debounce).
import { h, toast, debounce, confirmDialog } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import {
  EVERY, KINDS, cleanQuery, collectRunning, emptyQuery, exprOf, fixedFor, hostOf, listQueries, onQueries, recompute,
  removeQuery, runQuery, saveQuery, stopQuery, tableMarkdown, confirmRows,
} from '../services/collect.js';
import { canWebSearch, hasFetcher } from '../services/research.js';
import { capture } from '../services/notes.js';
import { focusPath } from '../services/projects.js';
import { addStartBlock } from '../services/start-store.js';
import { newBlockId } from '../services/widget-store.js';
import { cardDialog } from './card-dialog.js';
import { createCard } from '../services/reader-cards.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
const fmt = (v) => (v == null ? '–' : typeof v === 'number' ? v.toLocaleString(getLang() === 'de' ? 'de-DE' : 'en-GB', { maximumFractionDigits: 4 }) : String(v));
export function ago(iso) {
  const ms = Date.now() - (Date.parse(iso || '') || 0);
  if (!iso || ms < 0) return '';
  const min = Math.round(ms / 60000);
  if (min < 1) return t('collect.ago.now');
  if (min < 60) return t('collect.ago.min', { n: min });
  if (min < 1440) return t('collect.ago.h', { n: Math.round(min / 60) });
  return t('collect.ago.d', { n: Math.round(min / 1440) });
}
const cols = (q) => [...q.vars.map((v) => ({ name: v.name, kind: v.kind, fixed: false })), ...q.fixed.map((f) => ({ name: f.name, kind: 'number', fixed: true }))];
const numericCols = (q) => cols(q).filter((c) => c.kind === 'number' || c.kind === 'price' || c.fixed);

// opts: { id (a query to open, '' for a new one), title, onOpen(id) }
export function collectView({ id = '', title = '', onOpen = () => {} } = {}) {
  const root = h('section', { class: 'cl', 'aria-label': t('research.task.collect') });
  let q = emptyQuery(title);
  let view = 'table';
  let progress = null;
  let chartX = ''; let chartY = '';
  // the working copy keeps rows you are still filling in; the file gets the clean query (and only once there is
  // something to keep: a page, a search or a named variable)
  const worth = () => q.where.pages.length || q.where.search.trim() || q.vars.some((v) => v.name.trim());
  // one save at a time: a second one waits for the first (else a new query got two files, one from the pause and one
  // from "Neu holen", both still without an id)
  let saving = Promise.resolve();
  const saveNow = () => { saving = saving.then(async () => { if (!worth()) return; try { const saved = await saveQuery(q); if (!q.id) { q.id = saved.id; onOpen(q.id); } drawQueries(); } catch (e) { console.warn(e); } }); return saving; };
  const save = debounce(saveNow, 700);
  const changed = (redrawResult = false) => { if (redrawResult && q.result) { q.result = recompute(cleanQuery(q)).result; drawResult(); drawLoom(); } save(); };

  // ---------------------------------------------------------------- head
  const head = h('header', { class: 'cl-head' });
  const left = h('div', { class: 'cl-left' });
  const mid = h('div', { class: 'cl-mid' });
  const right = h('aside', { class: 'cl-right' });
  root.append(head, h('div', { class: 'cl-body' }, left, mid, right));

  function drawHead() {
    const name = h('input', { class: 'cl-title', type: 'text', value: q.title, placeholder: t('collect.title.placeholder'), 'aria-label': t('collect.title.placeholder'), maxlength: '100' });
    name.addEventListener('input', () => { q.title = name.value; changed(); });
    const r = q.result;
    const meta = r ? t('collect.meta', { ago: ago(r.fetched), pages: r.pages, rows: r.rows.length }) : t('collect.meta.none');
    head.replaceChildren(
      h('div', { class: 'cl-kicker small', text: t('research.task.collect') }),
      name,
      h('div', { class: 'cl-sub' }, h('span', { class: 'muted', text: t('collect.sub') }), h('span', { class: 'muted small cl-meta', text: meta })));
  }

  // ---------------------------------------------------------------- left: where, what, fixed
  function card(titleKey, ...kids) { return h('section', { class: 'cl-card' }, h('h3', { class: 'cl-card-t small', text: t(titleKey) }), ...kids); }
  function drawLeft() {
    // where
    const pages = h('div', { class: 'cl-chips' }, ...q.where.pages.map((u, i) => {
      const rm = h('button', { type: 'button', class: 'icon-btn small', 'aria-label': t('action.remove'), html: icon('close') });
      rm.addEventListener('click', () => { q.where.pages.splice(i, 1); drawLeft(); changed(); });
      return h('span', { class: 'cl-chip', title: u }, h('span', { text: hostOf(u) + (new URL(u).pathname.length > 1 ? new URL(u).pathname.slice(0, 24) : '') }), rm);
    }));
    const add = h('input', { class: 'field small cl-add-page', type: 'text', placeholder: t('collect.where.add'), 'aria-label': t('collect.where.add'), inputmode: 'url', autocapitalize: 'off', spellcheck: 'false' });
    const addPage = () => {
      const urls = add.value.split(/\s+/).map((x) => x.trim()).filter(Boolean).map((x) => (/^https?:\/\//i.test(x) ? x : `https://${x}`)).filter((x) => { try { return !!new URL(x).hostname.includes('.'); } catch { return false; } });
      if (!urls.length) { if (add.value.trim()) toast(t('links.bad'), 'error'); return; }
      q.where.pages = [...new Set([...q.where.pages, ...urls])];
      add.value = '';
      drawLeft(); changed();
      left.querySelector('.cl-add-page')?.focus();
    };
    add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addPage(); } });
    add.addEventListener('paste', () => setTimeout(() => { if (/\s/.test(add.value.trim())) addPage(); }, 0));
    const search = h('input', { class: 'field small cl-search', type: 'search', value: q.where.search, placeholder: t('collect.where.search'), 'aria-label': t('collect.where.search') });
    search.addEventListener('input', () => { q.where.search = search.value; changed(); });
    const depth = h('div', { class: 'segmented small cl-depth', role: 'group', 'aria-label': t('collect.where.depth') }, ...[0, 1].map((d) => {
      const b = h('button', { type: 'button', class: q.where.depth === d ? 'on' : '', 'aria-pressed': String(q.where.depth === d), text: t(`collect.depth.${d}`) });
      b.addEventListener('click', () => { q.where.depth = d; drawLeft(); changed(); });
      return b;
    }));
    const max = h('input', { class: 'field small cl-max', type: 'number', min: '1', max: '60', value: String(q.where.max), 'aria-label': t('collect.where.max') });
    max.addEventListener('change', () => { q.where.max = Math.max(1, Math.min(60, Number(max.value) || 20)); changed(); });
    const searchHint = q.where.search && !canWebSearch() ? h('p', { class: 'muted small', text: t('collect.where.searchHelper') }) : null;
    const where = card('collect.where', pages, add, search, searchHint,
      h('div', { class: 'cl-row' }, depth, h('label', { class: 'cl-max-l small' }, h('span', { class: 'muted', text: t('collect.where.max') }), max)));

    // what: variables
    const vars = h('div', { class: 'cl-vars' }, ...q.vars.map((v, i) => varRow(v, i)));
    const addVar = h('button', { type: 'button', class: 'link-btn small cl-add-var' }, iconEl('plus'), h('span', { text: t('collect.var.add') }));
    addVar.addEventListener('click', () => { q.vars.push({ name: '', kind: 'text', expr: '' }); drawLeft(); left.querySelector('.cl-var:last-child .cl-var-name')?.focus(); });
    const rowsSel = h('div', { class: 'segmented small cl-rows', role: 'group', 'aria-label': t('collect.rows') }, ...['page', 'match'].map((m) => {
      const b = h('button', { type: 'button', class: q.rows === m ? 'on' : '', 'aria-pressed': String(q.rows === m), text: t(`collect.rows.${m}`) });
      b.addEventListener('click', () => { q.rows = m; drawLeft(); changed(); });
      return b;
    }));
    const what = card('collect.what', vars, h('div', { class: 'cl-row' }, addVar, rowsSel));
    what.querySelector('.cl-card-t').after(h('p', { class: 'muted small cl-hint', text: t('collect.what.hint') }));

    // fixed values and formulas
    const errs = fixedFor(cleanQuery(q)).errors;
    const fixed = h('div', { class: 'cl-fixed' }, ...q.fixed.map((f, i) => {
      const n = h('input', { class: 'field small cl-fx-name', type: 'text', value: f.name, placeholder: t('collect.fixed.name'), 'aria-label': t('collect.fixed.name') });
      const v = h('input', { class: 'field small cl-fx-value', type: 'text', value: f.value, placeholder: t('collect.fixed.value'), 'aria-label': t('collect.fixed.value'), spellcheck: 'false' });
      const rm = h('button', { type: 'button', class: 'icon-btn small', 'aria-label': t('action.remove'), html: icon('close') });
      n.addEventListener('input', () => { f.name = n.value; changed(true); });
      v.addEventListener('input', () => { f.value = v.value; changed(true); });
      rm.addEventListener('click', () => { q.fixed.splice(i, 1); drawLeft(); changed(true); });
      return h('div', { class: `cl-fx${errs[f.name] ? ' bad' : ''}` }, n, h('span', { class: 'muted', text: '=' }), v, rm);
    }));
    const addFx = h('button', { type: 'button', class: 'link-btn small cl-add-fx' }, iconEl('plus'), h('span', { text: t('collect.fixed.add') }));
    addFx.addEventListener('click', () => { q.fixed.push({ name: '', value: '' }); drawLeft(); left.querySelector('.cl-fx:last-child .cl-fx-name')?.focus(); });
    const fx = card('collect.fixed', fixed, addFx);
    fx.querySelector('.cl-card-t').after(h('p', { class: 'muted small cl-hint', text: t('collect.fixed.hint') }));

    // fetch now, and how often
    const busy = collectRunning();
    const go = h('button', { type: 'button', class: 'btn primary cl-go', disabled: busy && busy.id !== q.id ? true : null }, iconEl(busy?.id === q.id ? 'stop' : 'refresh'), h('span', { text: busy?.id === q.id ? t('collect.stop') : t('collect.go') }));
    go.addEventListener('click', () => (collectRunning()?.id === q.id ? stopQuery() : fetchNow()));
    const every = h('select', { class: 'field small cl-every', 'aria-label': t('collect.every') }, ...EVERY.map((x) => h('option', { value: x, selected: q.every === x ? true : null, text: t(`collect.every.${x}`) })));
    every.addEventListener('change', () => { q.every = every.value; changed(); drawQueries(); });
    const prog = progress ? h('p', { class: 'muted small cl-progress', role: 'status' }, iconEl('refresh', 'spin'), h('span', { text: t('collect.progress', progress) })) : null;
    const noFetch = !hasFetcher() ? h('p', { class: 'muted small cl-hint', text: t('collect.noFetcher') }) : null;
    left.replaceChildren(...[where, what, fx, h('div', { class: 'cl-go-row' }, go, every), prog, noFetch].filter(Boolean));
  }
  function varRow(v, i) {
    const name = h('input', { class: 'field small cl-var-name', type: 'text', value: v.name, placeholder: t('collect.var.name'), 'aria-label': t('collect.var.name') });
    const kind = h('select', { class: 'field small cl-var-kind', 'aria-label': t('collect.var.kind') }, ...KINDS.map((k) => h('option', { value: k, selected: v.kind === k ? true : null, text: t(`collect.kind.${k}`) })));
    const expr = h('input', { class: 'field small cl-var-expr', type: 'text', value: v.expr, placeholder: t('collect.var.auto'), 'aria-label': t('collect.var.expr'), spellcheck: 'false', autocapitalize: 'off' });
    const rm = h('button', { type: 'button', class: 'icon-btn small', 'aria-label': t('action.remove'), html: icon('close') });
    const bad = () => { const re = exprOf({ ...v, name: v.name || 'x' }); row.classList.toggle('bad', re instanceof Error); expr.title = re instanceof Error ? String(re.message) : ''; };
    name.addEventListener('input', () => { v.name = name.value; changed(); });
    kind.addEventListener('change', () => { v.kind = kind.value; changed(); });
    expr.addEventListener('input', () => { v.expr = expr.value; bad(); changed(); });
    rm.addEventListener('click', () => { q.vars.splice(i, 1); drawLeft(); changed(true); });
    const miss = q.result?.missing?.[v.name];
    const row = h('div', { class: 'cl-var', dataset: { i: String(i) } }, name, kind, rm, expr,
      miss ? h('span', { class: 'cl-var-miss small', text: t('collect.var.missing', { n: miss }) }) : null);
    bad();
    return row;
  }

  async function fetchNow() {
    const clean = cleanQuery(q);
    if (!clean.vars.length) { toast(t('collect.needVar'), 'error'); return; }
    if (!clean.where.pages.length && !clean.where.search) { toast(t('collect.needWhere'), 'error'); return; }
    progress = { done: 0, total: q.where.pages.length || q.where.max, host: '' };
    drawLeft();
    save.cancel();
    await saveNow();
    try {
      q = await runQuery({ ...cleanQuery(q), id: q.id }, { onProgress: (p) => { progress = { done: p.done, total: p.total, host: hostOf(p.url) }; drawLeft(); } });
      onOpen(q.id);
      const r = q.result;
      toast(r.rows.length ? t('collect.done', { n: r.rows.length, pages: r.pages }) : t('collect.none', { pages: r.pages }), r.rows.length ? 'ok' : 'warn', 6000);
    } catch (e) {
      if (String(e?.message) === 'busy') toast(t('collect.busy'), 'info');
      else { console.warn(e); toast(t('collect.failed'), 'error', 5000); }
    }
    progress = null;
    drawAll();
  }

  // ---------------------------------------------------------------- middle: the result
  function drawResult() {
    const r = q.result;
    const sw = h('div', { class: 'segmented small cl-view', role: 'group' }, ...['table', 'chart', 'cards'].map((v) => {
      const b = h('button', { type: 'button', class: view === v ? 'on' : '', 'aria-pressed': String(view === v), dataset: { view: v }, text: t(`collect.view.${v}`) });
      b.addEventListener('click', () => { view = v; drawResult(); });
      return b;
    }));
    const keep = h('button', { type: 'button', class: 'btn small cl-keep', disabled: r?.rows.length ? null : true }, iconEl('bookmark'), h('span', { text: t('collect.keep') }));
    keep.addEventListener('click', keepAsNote);
    const widget = h('button', { type: 'button', class: `btn small cl-widget${q.widget ? ' on' : ''}`, disabled: q.id ? null : true }, iconEl('blocks'), h('span', { text: q.widget ? t('collect.widget.on') : t('collect.widget') }));
    widget.addEventListener('click', toWidget);
    const bar = h('div', { class: 'cl-bar' }, sw, h('span', { class: 'grow' }), keep, widget);
    if (!r) { mid.replaceChildren(bar, h('div', { class: 'cl-empty' }, iconEl('vars', 'tile'), h('p', { text: t('collect.empty') }), h('p', { class: 'muted small', text: t('collect.example') }))); return; }
    if (!r.rows.length) { mid.replaceChildren(bar, h('div', { class: 'cl-empty' }, h('p', { text: t('collect.none', { pages: r.pages }) }), errorsLine(r))); return; }
    const body = view === 'chart' ? chart() : view === 'cards' ? cards() : table();
    mid.replaceChildren(bar, body, errorsLine(r));
  }
  const errorsLine = (r) => (r.errors.length ? h('details', { class: 'cl-errors small' }, h('summary', { text: t('collect.errors', { n: r.errors.length }) }), h('ul', {}, ...r.errors.slice(0, 20).map((e) => h('li', { class: 'muted', text: `${hostOf(e.url)} · ${t(`collect.err.${e.code}`) === `collect.err.${e.code}` ? e.code : t(`collect.err.${e.code}`)}` })))) : h('span'));

  function table() {
    const c = cols(q);
    const allOk = q.result.rows.every((r) => r.ok);
    const all = h('button', { type: 'button', class: 'link-btn small cl-ok-all', text: allOk ? t('collect.ok.allDone') : t('collect.ok.all'), disabled: allOk ? true : null });
    all.addEventListener('click', async () => { const next = await confirmRows(q.id, -1, true); if (next) { q.result = next.result; drawResult(); drawLoom(); } });
    const tbl = h('table', { class: 'cl-table' },
      h('thead', {}, h('tr', {}, ...c.map((x) => h('th', { class: x.fixed ? 'fx' : '', text: x.name })), h('th', { text: t('collect.page') }), h('th', {}, all))),
      h('tbody', {}, ...q.result.rows.map((row, i) => {
        const ok = h('button', { type: 'button', class: `icon-btn small cl-ok${row.ok ? ' on' : ''}`, 'aria-pressed': String(row.ok), title: t(row.ok ? 'collect.ok.done' : 'collect.ok.one'), 'aria-label': t(row.ok ? 'collect.ok.done' : 'collect.ok.one'), html: icon('check') });
        ok.addEventListener('click', async () => { const next = await confirmRows(q.id, i, !row.ok); if (next) { q.result = next.result; drawResult(); drawLoom(); } });
        return h('tr', { class: row.ok ? 'ok' : 'unchecked' }, ...c.map((x) => h('td', { class: `${x.fixed ? 'fx' : ''}${row.values[x.name] == null ? ' none' : ''}`, text: fmt(row.values[x.name]) })),
          h('td', { class: 'cl-page' }, h('a', { href: row.page, target: '_blank', rel: 'noopener noreferrer', text: hostOf(row.page), title: row.title })), h('td', {}, ok));
      })));
    return h('div', { class: 'cl-table-wrap' }, tbl, h('p', { class: 'muted small cl-unchecked', text: t('collect.unchecked') }));
  }

  // a scatter of two numeric columns: each row a point with its first text value as name
  function chart() {
    const nc = numericCols(q);
    if (nc.length < 1) return h('p', { class: 'muted cl-empty', text: t('collect.chart.none') });
    if (!nc.some((c) => c.name === chartX)) chartX = nc[0].name;
    if (!nc.some((c) => c.name === chartY)) chartY = (nc[1] || nc[0]).name;
    const pick = (val, set) => { const s = h('select', { class: 'field small' }, ...nc.map((c) => h('option', { value: c.name, selected: c.name === val ? true : null, text: c.name }))); s.addEventListener('change', () => { set(s.value); drawResult(); }); return s; };
    const label = q.vars.find((v) => v.kind === 'text')?.name;
    const pts = q.result.rows.map((r) => ({ x: r.values[chartX], y: r.values[chartY], name: label ? r.values[label] : hostOf(r.page), ok: r.ok })).filter((p) => typeof p.x === 'number' && typeof p.y === 'number');
    const W = 560; const H = 300; const P = 44;
    const ns = 'http://www.w3.org/2000/svg';
    const el = (n, a = {}, text = '') => { const e = document.createElementNS(ns, n); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); if (text) e.textContent = text; return e; };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'cl-chart', role: 'img', 'aria-label': `${chartY} / ${chartX}` });
    if (pts.length) {
      const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
      const [x0, x1] = [Math.min(...xs), Math.max(...xs)]; const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
      const sx = (v) => P + ((v - x0) / (x1 - x0 || 1)) * (W - 2 * P); const sy = (v) => H - P - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * P);
      svg.append(el('line', { x1: P, y1: H - P, x2: W - P, y2: H - P, class: 'axis' }), el('line', { x1: P, y1: P, x2: P, y2: H - P, class: 'axis' }),
        el('text', { x: P, y: H - P + 18, class: 'tick' }, fmt(x0)), el('text', { x: W - P, y: H - P + 18, class: 'tick end' }, fmt(x1)),
        el('text', { x: P - 6, y: H - P, class: 'tick end' }, fmt(y0)), el('text', { x: P - 6, y: P + 4, class: 'tick end' }, fmt(y1)),
        el('text', { x: W / 2, y: H - 6, class: 'lab' }, chartX), el('text', { x: 10, y: P - 14, class: 'lab start' }, chartY));
      for (const p of pts) {
        const g = el('g', { class: `pt${p.ok ? ' ok' : ''}` });
        g.append(el('circle', { cx: sx(p.x).toFixed(1), cy: sy(p.y).toFixed(1), r: 5 }), el('text', { x: (sx(p.x) + 8).toFixed(1), y: (sy(p.y) - 7).toFixed(1), class: 'name' }, String(p.name ?? '').slice(0, 22)));
        svg.append(g);
      }
    } else svg.append(el('text', { x: W / 2, y: H / 2, class: 'lab' }, t('collect.chart.empty')));
    return h('div', { class: 'cl-chart-box' }, h('div', { class: 'cl-row small' }, h('span', { class: 'muted', text: 'x' }), pick(chartX, (v) => { chartX = v; }), h('span', { class: 'muted', text: 'y' }), pick(chartY, (v) => { chartY = v; })), svg);
  }

  // every row as a card; "Karte daraus" makes a card of your knowledge from it
  function cards() {
    const c = cols(q);
    const label = q.vars.find((v) => v.kind === 'text')?.name;
    return h('div', { class: 'cl-cards' }, ...q.result.rows.map((row) => {
      const make = h('button', { type: 'button', class: 'btn small cl-card-make' }, iconEl('vars'), h('span', { text: t('research.cardFrom') }));
      make.addEventListener('click', () => cardFromRow(row));
      return h('article', { class: `cl-rowcard${row.ok ? ' ok' : ''}` },
        h('h4', { text: String((label && row.values[label]) || row.title || hostOf(row.page)) }),
        h('dl', {}, ...c.filter((x) => x.name !== label).flatMap((x) => [h('dt', { class: 'muted small', text: x.name }), h('dd', { text: fmt(row.values[x.name]) })])),
        h('div', { class: 'cl-row' }, h('a', { class: 'small muted', href: row.page, target: '_blank', rel: 'noopener noreferrer', text: hostOf(row.page) }), h('span', { class: 'grow' }), make));
    }));
  }
  async function cardFromRow(row) {
    const label = q.vars.find((v) => v.kind === 'text')?.name;
    const lines = cols(q).map((x) => `- **${x.name}:** ${fmt(row.values[x.name])}`).join('\n');
    const name = String((label && row.values[label]) || row.title || hostOf(row.page));
    const values = await cardDialog({ kind: 'term', title: name, text: `${name}\n\n${lines}`, workTitle: q.title });
    if (!values) return;
    try {
      await createCard({ ...values, section: '', work: { title: row.title || hostOf(row.page), url: row.page }, clipSlug: '' });
      toast(t('reader.card.made', { title: values.title }), 'ok');
    } catch { toast(t('reader.card.failed'), 'error', 5000); }
  }

  async function keepAsNote() {
    const text = `# ${t('collect.note.title', { title: q.title })}\n\n${tableMarkdown(q)}\n\n${t('collect.note.from', { date: (q.result?.fetched || '').slice(0, 10) })}`;
    try { await capture(text, { project: focusPath() || '' }); toast(t('collect.kept'), 'ok'); } catch { toast(t('create.failed'), 'error', 5000); }
  }
  async function toWidget() {
    if (!q.id) return;
    if (q.widget) { toast(t('collect.widget.there'), 'info'); return; }
    try {
      await addStartBlock(newBlockId(), { kind: 'data', title: q.title, query: q.id });
      q.widget = true;
      await saveQuery(q);
      drawResult(); drawQueries();
      toast(t('collect.widget.done'), 'ok', 5000, { label: t('nav.home'), run: () => { location.hash = '#/home'; } });
    } catch (e) { console.warn(e); toast(t('create.failed'), 'error', 5000); }
  }

  // ---------------------------------------------------------------- right: Loom counted along, your queries
  const loomBox = h('section', { class: 'cl-card cl-loom' });
  const listBox = h('section', { class: 'cl-card cl-list' });
  const noteBox = h('section', { class: 'cl-card cl-note small', text: t('collect.note') });
  right.append(loomBox, listBox, noteBox);
  function drawLoom() {
    const r = q.result;
    const says = [];
    const chips = [];
    if (r?.rows.length) {
      const label = q.vars.find((v) => v.kind === 'text')?.name;
      const name = (row) => String((label && row.values[label]) || hostOf(row.page));
      const price = q.vars.find((v) => v.kind === 'price') || q.fixed[q.fixed.length - 1];
      if (price) {
        const withP = r.rows.filter((x) => typeof x.values[price.name] === 'number');
        if (withP.length > 1) { const best = withP.reduce((a, b) => (b.values[price.name] < a.values[price.name] ? b : a)); says.push(t('collect.loom.low', { name: name(best), col: price.name, value: fmt(best.values[price.name]) })); }
      }
      const miss = Object.entries(r.missing || {}).filter(([, n]) => n > 0);
      if (miss.length) {
        const [col, n] = miss.sort((a, b) => b[1] - a[1])[0];
        says.push(t('collect.loom.missing', { n, col }));
        chips.push({ label: t('collect.loom.fix', { col }), run: () => { const i = q.vars.findIndex((v) => v.name === col); const input = left.querySelector(`.cl-var[data-i="${i}"] .cl-var-expr`); input?.focus(); input?.scrollIntoView({ block: 'center' }); } });
      }
      const open = r.rows.filter((x) => !x.ok).length;
      if (open) says.push(t('collect.loom.open', { n: open }));
    } else says.push(t('collect.loom.idle'));
    loomBox.replaceChildren(h('div', { class: 'cl-loom-head small' }, h('span', { text: 'Loom' }), h('span', { class: 'cl-loom-state', text: t('collect.loom.state') })),
      h('p', { class: 'cl-loom-say', text: says.join(' ') }),
      ...chips.map((c) => { const b = h('button', { type: 'button', class: 'loom-chip cl-loom-chip', text: c.label }); b.addEventListener('click', c.run); return b; }));
  }
  async function drawQueries() {
    const list = await listQueries();
    const row = (x) => {
      const b = h('button', { type: 'button', class: `cl-q${x.id === q.id ? ' on' : ''}`, dataset: { id: x.id } }, h('span', { class: 'cl-q-t', text: x.title || x.id }),
        h('span', { class: 'muted small', text: [x.id === q.id ? t('collect.q.now') : x.result ? ago(x.result.fetched) : '', x.every !== 'off' ? t(`collect.every.${x.every}`) : '', x.widget ? t('collect.q.widget') : ''].filter(Boolean).join(' · ') }));
      b.addEventListener('click', () => open(x.id));
      return b;
    };
    const fresh = h('button', { type: 'button', class: 'link-btn small cl-new' }, iconEl('plus'), h('span', { text: t('collect.new') }));
    fresh.addEventListener('click', () => { q = emptyQuery(); view = 'table'; onOpen(''); drawAll(); left.querySelector('.cl-add-page')?.focus(); });
    const del = q.id ? h('button', { type: 'button', class: 'link-btn small cl-del', text: t('collect.delete') }) : null;
    del?.addEventListener('click', async () => {
      if (!(await confirmDialog(t('collect.delete'), t('collect.delete.confirm', { title: q.title }), { okLabel: t('delete.ok'), danger: true }))) return;
      await removeQuery(q.id); q = emptyQuery(); onOpen(''); drawAll();
    });
    listBox.replaceChildren(h('div', { class: 'cl-list-head small' }, h('span', { text: t('collect.queries') }), fresh),
      ...(list.length ? list.map(row) : [h('p', { class: 'muted small', text: t('collect.queries.none') })]), del || h('span'));
  }
  async function open(qid) {
    const x = (await listQueries()).find((y) => y.id === qid);
    if (!x) return;
    q = JSON.parse(JSON.stringify(x));
    onOpen(q.id);
    drawAll();
  }

  function drawAll() { drawHead(); drawLeft(); drawResult(); drawLoom(); drawQueries(); }
  const stop = onQueries(() => { if (!root.isConnected) { stop(); return; } if (!progress) drawQueries(); });
  drawAll();
  if (id) open(id);
  return root;
}

// ------------------------------------------------------------------ the widget on Heute (building block "data")
export function dataBlockBody(cfg, api = {}) {
  const box = h('div', { class: 'cl-block' });
  const draw = async () => {
    const q = (await listQueries()).find((x) => x.id === cfg.query);
    if (!q) { box.replaceChildren(h('p', { class: 'muted small', text: t('collect.block.gone') })); return; }
    const c = cols(q).slice(0, 3);
    const rows = (q.result?.rows || []).slice(0, 5);
    const openIt = () => { try { localStorage.setItem('toollib.research.task', JSON.stringify('collect')); localStorage.setItem('toollib.collect.open', JSON.stringify(q.id)); } catch { /* the window opens empty */ } (api.go || ((x) => { location.hash = x; }))('#/m/scraper'); };
    const again = h('button', { type: 'button', class: 'icon-btn small cl-block-again', title: t('collect.go'), 'aria-label': t('collect.go'), html: icon('refresh') });
    again.addEventListener('click', async () => { again.disabled = true; again.classList.add('spin'); try { await runQuery(q); } catch { toast(t('collect.failed'), 'error'); } draw(); });
    box.replaceChildren(
      rows.length ? h('table', { class: 'cl-block-table small' }, h('tr', {}, ...c.map((x) => h('th', { text: x.name }))), ...rows.map((r) => h('tr', { class: r.ok ? '' : 'unchecked' }, ...c.map((x) => h('td', { text: fmt(r.values[x.name]) })))))
        : h('p', { class: 'muted small', text: t('collect.block.empty') }),
      h('div', { class: 'cl-block-foot small' }, h('button', { type: 'button', class: 'link-btn', text: t('collect.block.open'), onclick: openIt }), h('span', { class: 'muted', text: q.result ? ago(q.result.fetched) : '' }), again));
  };
  draw();
  return box;
}
