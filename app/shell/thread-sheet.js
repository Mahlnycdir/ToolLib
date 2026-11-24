// The overview of a project's red thread (0.34.0; P5 "Übersicht zum schnellen Umsortieren", and ENTE's list of 17.11.:
// "neue Punkte vor, dazwischen und beliebig nach dem derzeitigen roten Faden einsetzen").
//
//   the thread   every card of the thread in order, with its number; ↑ ↓ move it, × takes it out. Under a card: what
//                it builds on earlier in the thread ("folgt aus 2"), and a warning when it comes before a card it
//                follows from.
//   insert       the slots between the cards (and before the first, after the last) choose where new cards go; the
//                cards of the project not yet in the thread are listed below with "+", and "Neue Notiz hier"
//                writes a note of the project right into that place.
//   suggest      "Vorschlagen" shows the order along the derivations (projects.js suggestThreadWhy) with the reason
//                for every place; "Übernehmen" takes it (with Undo), "Zurück" keeps yours.
//
// Opened from the canvas (in "Red thread") and from the board. Every change is written at once (projects.js
// setThread) and handed to onChange(list), so the canvas and the board follow.
import { h, toast, promptDialog, openSheet, confirmDialog } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { loadProject, projectNodes, setThread, suggestThreadWhy, threadClashes } from '../services/projects.js';
import { nodeBySlug } from '../services/search.js';
import { capture } from '../services/notes.js';
import { nodeTitle, typeLabel, typeTile } from './node-view.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });

// The thread with `slug` at place `at` (0 = first; -1 or past the end = last); a card already in it moves there.
// For Python readers: like list.insert after list.remove.
export function threadWith(list, slug, at = -1) {
  const rest = list.filter((x) => x !== slug);
  const i = at < 0 || at > rest.length ? rest.length : at;
  return [...rest.slice(0, i), slug, ...rest.slice(i)];
}

// path: the project; onChange(list) after every change; onClose() when the sheet goes; suggest: open with the suggestion
export async function openThread({ path, title = '', onChange = () => {}, onClose = () => {}, suggest = false } = {}) {
  const lang = getLang();
  let p;
  try { p = await loadProject(path); } catch { p = null; }
  if (!p) { toast(t('create.failed'), 'error'); return null; }
  let list = [...p.thread];
  let insertAt = -1;          // where new cards go: an index, -1 = at the end
  let proposal = null;        // the suggestion while it is shown
  const body = h('div', { class: 'thread-sheet' });
  const sheet = openSheet(t('thread.title', { project: title || p.title }), body, { onClose });
  sheet.sheet.classList.add('thread-panel');

  const members = () => projectNodes(p.links).filter((d) => d.type !== 'library' && d.type !== 'project');
  const name = (slug) => { const d = nodeBySlug(slug); return d ? nodeTitle(d, lang) : slug; };
  async function save(next, { undo = null } = {}) {
    const was = list;
    list = next;
    if (insertAt > list.length) insertAt = -1;
    draw();
    try { await setThread(path, list); p = (await loadProject(path)) || p; list = [...p.thread]; } catch { toast(t('canvas.saveFailed'), 'error', 5000); }
    onChange(list);
    draw();
    if (undo) toast(undo, 'ok', 6000, { label: t('delete.undo'), run: () => save(was) });
  }
  const putIn = (slug) => {
    const at = insertAt;
    save(threadWith(list, slug, at));
    if (at >= 0) insertAt = at + 1;
  };

  // a slot between two cards: tap it and new cards go there
  function slot(at) {
    const on = (insertAt < 0 ? list.length : insertAt) === at;
    const b = h('button', { type: 'button', class: `thread-slot${on ? ' on' : ''}`, dataset: { at: String(at) }, 'aria-pressed': String(on) },
      iconEl('plus'), h('span', { text: on ? t('thread.slot.here') : t('thread.slot') }));
    b.addEventListener('click', () => { insertAt = at >= list.length ? -1 : at; draw(); });
    return h('li', { class: 'thread-slot-row' }, b);
  }

  function row(slug, i, clashes) {
    const d = nodeBySlug(slug);
    const btn = (key, name, fn, disabled = false) => {
      const b = h('button', { type: 'button', class: `icon-btn small thread-${key}`, title: t(`thread.${key}`), 'aria-label': `${t(`thread.${key}`)}: ${nameOf()}`, html: icon(name), disabled: disabled || null });
      b.addEventListener('click', fn);
      return b;
    };
    const nameOf = () => name(slug);
    // what it builds on earlier in the thread, and where it comes too early
    const notes = [];
    if (d) {
      const earlier = [...new Set([...(d.derived || []), ...(d.conventions || [])])].map((x) => list.indexOf(x)).filter((k) => k >= 0 && k < i).sort((a, b) => a - b);
      if (earlier.length) notes.push(h('span', { class: 'thread-rel', text: t('thread.rel.from', { n: earlier.map((k) => k + 1).join(', ') }) }));
    }
    const late = clashes.get(slug);
    if (late) notes.push(h('span', { class: 'thread-clash' }, iconEl('warn'), h('span', { text: t('thread.rel.early', { n: late.map((x) => list.indexOf(x) + 1).join(', ') }) })));
    return h('li', { class: 'thread-row', dataset: { slug } },
      h('span', { class: 'thread-n', text: String(i + 1) }),
      d ? typeTile(d.type, 'small') : h('span'),
      h('span', { class: 'thread-text' }, h('span', { class: 'thread-name', text: nameOf() }), h('span', { class: 'muted small thread-meta' }, h('span', { text: d ? typeLabel(d.type) : '' }), ...notes)),
      h('span', { class: 'thread-btns' },
        btn('up', 'arrowUp', () => save(threadWith(list, slug, i - 1)), i === 0),
        btn('down', 'arrowDown', () => save(threadWith(list, slug, i + 1)), i === list.length - 1),
        btn('out', 'close', () => { if (insertAt > i) insertAt -= 1; save(list.filter((x) => x !== slug)); })));
  }

  function drawList() {
    const clashes = threadClashes({ ...p, thread: list }, members());
    const top = h('div', { class: 'thread-top' },
      h('span', { class: 'small thread-count', text: list.length ? t('thread.count', { n: list.length }) : t('thread.empty') }),
      h('span', { class: 'grow' }));
    const sug = h('button', { type: 'button', class: 'btn small thread-suggest', title: t('canvas.thread.suggest.hint') }, iconEl('wand'), h('span', { text: t('canvas.thread.suggest') }));
    sug.addEventListener('click', () => showSuggestion());
    top.append(sug);
    if (list.length) {
      const clear = h('button', { type: 'button', class: 'link-btn thread-clear', text: t('canvas.thread.clear') });
      clear.addEventListener('click', async () => { if (await confirmDialog(t('canvas.thread'), t('canvas.thread.clear.confirm'), { okLabel: t('canvas.thread.clear'), danger: true })) { insertAt = -1; save([], { undo: t('thread.cleared') }); } });
      top.append(clear);
    }
    const ol = h('ol', { class: 'thread-list' });
    ol.append(slot(0));
    list.forEach((slug, i) => { ol.append(row(slug, i, clashes), slot(i + 1)); });
    // the cards not yet in the thread, and a new note right at the insertion point
    const out = members().filter((d) => !list.includes(d.slug));
    const where = insertAt < 0 || insertAt >= list.length ? t('thread.at.end') : insertAt === 0 ? t('thread.at.start') : t('thread.at.after', { n: insertAt, title: name(list[insertAt - 1]) });
    const note = h('button', { type: 'button', class: 'btn small thread-note' }, iconEl('edit'), h('span', { text: t('thread.note') }));
    note.addEventListener('click', async () => {
      const v = await promptDialog(t('thread.note'), { label: t('project.quick') });
      if (!v || !v.trim()) return;
      try {
        const made = await capture(v.trim(), { project: path });
        const slug = made.slice(made.lastIndexOf('/') + 1).replace(/\.md$/, '');
        p = (await loadProject(path)) || p;
        putIn(slug);
        toast(t('note.kept'), 'ok');
      } catch { toast(t('create.failed'), 'error', 5000); }
    });
    const rest = h('ul', { class: 'thread-rest' }, ...out.map((d) => {
      const add = h('button', { type: 'button', class: 'btn small thread-add', 'aria-label': `${t('thread.add')}: ${nodeTitle(d, lang)}` }, iconEl('plus'), h('span', { text: t('thread.add') }));
      add.addEventListener('click', () => putIn(d.slug));
      return h('li', { class: 'thread-rest-row', dataset: { slug: d.slug } }, typeTile(d.type, 'small'), h('span', { class: 'thread-text' }, h('span', { class: 'thread-name', text: nodeTitle(d, lang) }), h('span', { class: 'muted small', text: typeLabel(d.type) })), add);
    }));
    const restBox = h('section', { class: 'thread-out' },
      h('div', { class: 'thread-out-head' }, h('h3', { class: 'small', text: t('thread.notIn', { n: out.length }) }), h('span', { class: 'muted small thread-where', text: t('thread.goesTo', { where }) })),
      note, out.length ? rest : h('p', { class: 'muted small', text: t('thread.allIn') }));
    body.replaceChildren(top, ol, restBox);
  }

  function showSuggestion() {
    const why = suggestThreadWhy(p, members());
    if (why.length < 2) { toast(t('canvas.thread.suggest.none'), 'info'); return; }
    proposal = why;
    draw();
  }
  const reason = (x) => {
    if (x.why === 'chain') return t('thread.why.chain', { title: name(x.refs[0]) });
    if (x.why === 'after') return t('thread.why.after', { titles: x.refs.map(name).join(', ') });
    if (x.why === 'kind') return t('thread.why.kind');
    if (x.why === 'circle') return t('thread.why.circle');
    return t('thread.why.board');
  };
  function drawProposal() {
    const same = proposal.length === list.length && proposal.every((x, i) => x.slug === list[i]);
    const take = h('button', { type: 'button', class: 'btn small primary thread-take', disabled: same || null }, iconEl('check'), h('span', { text: t('thread.take') }));
    take.addEventListener('click', () => { const next = proposal.map((x) => x.slug); proposal = null; insertAt = -1; save(next, { undo: t('canvas.thread.suggested', { n: next.length }) }); });
    const back = h('button', { type: 'button', class: 'btn small thread-back' }, iconEl('arrowLeft'), h('span', { text: t('thread.back') }));
    back.addEventListener('click', () => { proposal = null; draw(); });
    const ol = h('ol', { class: 'thread-list thread-proposal' }, ...proposal.map((x, i) => {
      const d = nodeBySlug(x.slug);
      const was = list.indexOf(x.slug);
      const moved = was >= 0 && was !== i ? h('span', { class: 'thread-was', text: t('thread.was', { n: was + 1 }) }) : was < 0 ? h('span', { class: 'thread-was new', text: t('thread.new') }) : null;
      return h('li', { class: `thread-row why-${x.why}`, dataset: { slug: x.slug } },
        h('span', { class: 'thread-n', text: String(i + 1) }),
        d ? typeTile(d.type, 'small') : h('span'),
        h('span', { class: 'thread-text' }, h('span', { class: 'thread-name', text: name(x.slug) }), h('span', { class: 'muted small thread-meta' }, h('span', { class: 'thread-why', text: reason(x) }), ...(moved ? [moved] : []))));
    }));
    body.replaceChildren(h('p', { class: 'small thread-intro', text: same ? t('thread.same') : t('thread.intro') }), ol, h('div', { class: 'btn-row thread-actions' }, back, take));
  }
  function draw() { if (proposal) drawProposal(); else drawList(); }
  draw();
  if (suggest) showSuggestion();
  return sheet;
}
