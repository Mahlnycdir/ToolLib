// Talking with Loom (0.33.0): the second voice, reachable everywhere; it takes the place of the planned "work
// mode" (Arbeitsmodus, arbeitsmodus.md): one conversation instead of a mode of its own.
//
//   You speak (the microphone: the speech recognition of the browser; where it does not start, the dictation of the
//   keyboard) or type. Loom understands what you want (services/loom-mind.js) and does it: opens, searches, notes
//   (also "notier in ToolLib …" into another project), makes a card, researches, attaches, says the next step, goes
//   one level deeper or up again. A question gets the sentences of your own nodes that answer it, each with its source;
//   where nothing fits, Loom says so and offers to research.
//   "Laut denken": what you say becomes a note where you are (the project, and the card you are deep in); Loom offers
//   to make a card of it, to attach it or to go one level deeper.
//
//   talkPanel({ go, project, embedded })   the conversation as an element (in a project: on the right)
//   openTalk({ go }) / toggleTalk({ go })  the panel docked on the right (Mac) or over the page (iPhone); Alt+T
//   sendToLoom(text, { go })               what the Loom widget on Heute hands over
//
// The conversation is kept on this device (pref loom.talk, the last 60 lines); nothing leaves the device.
// For Python readers: respond() is a dispatcher (like a dict of handlers keyed by intent); every handler returns the
// message Loom answers with, which is stored and drawn.
import { h, toast, actionSheet, loadPref, savePref, confirmDialog } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { nodeByPath, searchNodes } from '../services/search.js';
import { capture, loadNote } from '../services/notes.js';
import { connect } from '../services/relations.js';
import { addToProject, focusPath, loadProject, nextUp, placeItem, sectionsOf } from '../services/projects.js';
import { createCard } from '../services/reader-cards.js';
import { answerFrom, nodeFor, suggestions, understand } from '../services/loom-mind.js';
import { addFind, diveInto, hereOf } from '../services/dive.js';
import { loomSuggest } from './settings/loom.js';
import { nodeHref, nodeTitle, typeLabel } from './node-view.js';
import { typeset } from './math.js';
import { loomMark } from './loom.js';
import { photoButton, imageLine } from './photo.js';
import { MODULES } from './modules.js';
import { SPEECH_LANGS, speechLang, setSpeechLang, record, isSilent, writeDown, vocabulary, keepForMac, wavOf, drain, loadHere, learnWords, liveEngine, liveWriter, warmUp, activeEngine, AUTO_SECONDS, MAX_SECONDS } from '../services/speech.js';
import { hasHelper as hasHelperNow } from '../services/research.js';
import { saveNote } from '../services/notes.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
const KEY = 'loom.talk';
const slugOf = (path) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
// the language Loom listens in, recording and writing down: services/speech.js (0.33.4)
export { SPEECH_LANGS, speechLang } from '../services/speech.js';

// ------------------------------------------------------------------ where you are (the project and the card deep in it)
let placeHint = { project: '', at: 0 };
export function setTalkPlace(project) { placeHint = { project: project || '', at: Date.now() }; }
function placeNow() {
  const m = location.hash.match(/^#\/n\/(projects\/[^/]+\.md)$/);
  let project = '';
  try { project = m ? decodeURIComponent(m[1]) : ''; } catch { project = ''; }
  if (!project && placeHint.project && nodeByPath(placeHint.project)) project = placeHint.project;
  if (!project) project = focusPath() && nodeByPath(focusPath()) ? focusPath() : '';
  return { project, node: project ? hereOf(project) : '' };
}

// ------------------------------------------------------------------ the conversation on this device
const history = () => { const v = loadPref(KEY, []); return Array.isArray(v) ? v : []; };
const panels = new Set();
function push(msg) {
  const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const all = [...history(), { id, at: Date.now(), ...msg }].slice(-60);
  savePref(KEY, all);
  redrawAll();
  return id;
}
const redrawAll = () => { for (const p of [...panels]) { if (p.isConnected) p.redraw(); else panels.delete(p); } };
// a message written down roughly first, precisely later (0.33.4)
function editMsg(id, patch) {
  const all = history();
  const m = all.find((x) => x.id === id);
  if (!m) return false;
  Object.assign(m, patch);
  savePref(KEY, all);
  redrawAll();
  return true;
}
// The Mac writes down what waited (0.33.4): the precise text replaces the quick one, in the conversation and in the
// note it became; a voice message that waited becomes a note now, where you spoke it.
async function applyPrecise(item, text) {
  if (!text) { if (item.msg) editMsg(item.msg, { spoken: 'mac' }); return; }
  if (item.rough) {
    if (item.msg) editMsg(item.msg, { text, spoken: 'mac' });
    if (item.note) {
      const n = await loadNote(item.note).catch(() => null);
      if (n && n.text.includes(item.rough)) await saveNote(item.note, n.text.replace(item.rough, text));
    }
    return;
  }
  const path = await capture(text, { project: item.project || '' });
  if (item.msg) editMsg(item.msg, { text, spoken: 'mac', made: { label: text.slice(0, 60), href: nodeHref(path) } });
}
export const writeWaiting = () => drain(applyPrecise);
// whenever the Mac may be in reach again: on start, when the page comes back, online again, every five minutes
let drainTimer = 0;
function drainSoon(ms = 3000) {
  clearTimeout(drainTimer);
  drainTimer = setTimeout(async () => {
    const n = await writeWaiting().catch(() => 0);
    if (n) toast(t('loom.voice.done', { n }), 'ok', 5000);
  }, ms);
}
if (typeof window !== 'undefined' && new URLSearchParams(location.search).get('side') !== '1') {
  window.addEventListener('online', () => drainSoon());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') drainSoon(); });
  setInterval(() => drainSoon(0), 5 * 60 * 1000);
  drainSoon(8000);
}

let lastMade = '';   // the note or card Loom made last: "als Karte", "häng das an …" mean it

// ------------------------------------------------------------------ what Loom does
async function noteHere(text, { project = '' } = {}) {
  const place = placeNow();
  const into = project || place.project;
  const path = await capture(text, { project: into });
  lastMade = path;
  // deep in a card: the note hangs on it and is a find to take along
  if (place.node && into === place.project) { await connect(slugOf(path), slugOf(place.node)).catch(() => false); addFind(into, path); }
  const p = into ? nodeByPath(into) : null;
  const chips = [{ label: t('loom.chip.card'), act: 'card', arg: path }];
  if (into) chips.push({ label: t('loom.chip.attach'), act: 'attach', arg: path });
  if (place.node) chips.push({ label: t('loom.chip.deeper'), act: 'deeper', arg: place.node });
  return { text: p ? t('loom.noted.in', { title: p.title }) : t('loom.noted.inbox'), made: { label: text.slice(0, 60), href: nodeHref(path) }, chips, project: into };
}

async function cardFrom(text, { fromNote = '' } = {}) {
  const { cardDialog } = await import('./card-dialog.js');
  const values = await cardDialog({ text });
  if (!values) return { text: t('loom.card.later') };
  const made = await createCard({ ...values, section: '', work: null, clipSlug: '' });
  lastMade = made;
  const place = placeNow();
  if (fromNote) {
    await connect(slugOf(fromNote), slugOf(made)).catch(() => false);
    const note = nodeByPath(fromNote);
    const projects = note ? (await import('../services/projects.js')).projectsWith(note.slug) : [];
    for (const p of projects) await addToProject(p.path, [slugOf(made)]);
  } else if (place.project) await addToProject(place.project, [slugOf(made)]);
  if (place.node) { await connect(slugOf(made), slugOf(place.node)).catch(() => false); addFind(place.project, made); }
  return { text: t('loom.card.made', { title: values.title }), made: { label: values.title, href: nodeHref(made) }, chips: [{ label: t('loom.chip.open'), act: 'open', arg: made }] };
}

// the tools by the names you would say, in German and English (the names in strings.json, and a few more)
const TOOL_WORDS = {
  projects: 'projekte projekt projects project', shelf: 'bibliothek library regal shelf bücher', net: 'netz network graph netzwerk',
  scraper: 'recherche research suche papers webscraper', formulary: 'formelsammlung formeln formulary formulas karten',
  cheatsheet: 'spickzettel snippets cheatsheet', kobra: 'kobra code editor python', kladde: 'kladde handschrift notizbuch handwriting',
};
function toolFor(words) {
  const w = String(words).toLowerCase().replace(/^(?:die|der|das|den|the|my|meine?n?)\s+/, '').trim();
  if (/^(heute|today|start)$/.test(w)) return { id: 'home', href: '#/home', name: t('nav.home') };
  if (/^(einstellungen|settings)$/.test(w)) return { id: 'settings', href: '#/settings', name: w };
  if (/^(schreiben|write|seiten|pages)$/.test(w)) return { id: 'write', href: '#/m/library', name: w };
  for (const m of MODULES) {
    if (m.planned) continue;
    const names = [m.id, t(`module.${m.id}.name`), ...(TOOL_WORDS[m.id] || '').split(' '), ...(m.keys || '').split(' ')].map((x) => String(x).toLowerCase()).filter(Boolean);
    if (names.some((n) => n === w)) return { id: m.id, href: m.href || `#/m/${m.id}`, name: t(`module.${m.id}.name`) };
  }
  return null;
}

function itemsOf(list) {
  const lang = getLang();
  return list.map((x) => ({ path: x.d.path, title: nodeTitle(x.d, lang), type: x.d.type, quote: x.quote || '', tex: x.tex || '' }));
}

export async function respond(raw, { go }) {
  const text = String(raw || '').trim();
  const u = understand(text);
  const place = placeNow();
  const lang = getLang();
  switch (u.intent) {
    case 'open': {
      const tool = toolFor(u.arg);
      if (tool) { go(tool.href); return { text: t('loom.opened', { title: tool.name }), went: true }; }
      const d = nodeFor(u.arg);
      if (!d) return { text: t('loom.notFound', { q: u.arg }), chips: [{ label: t('loom.chip.research'), act: 'research', arg: u.arg }] };
      go(nodeHref(d.path));
      return { text: t('loom.opened', { title: nodeTitle(d, lang) }), went: true };
    }
    case 'search': {
      const hits = searchNodes(u.arg, { limit: 5 });
      if (!hits.length) return { text: t('loom.notFound', { q: u.arg }), chips: [{ label: t('loom.chip.research'), act: 'research', arg: u.arg }] };
      return { text: t('loom.found', { n: hits.length, q: u.arg }), items: hits.map((d) => ({ path: d.path, title: nodeTitle(d, lang), type: d.type, quote: d.lead?.[lang] || d.lead?.en || '' })) };
    }
    case 'note': {
      if (!u.arg) return { text: t('loom.note.what') };
      return noteHere(u.arg, { project: u.target?.path || '', go });
    }
    case 'card': {
      if (u.arg) return cardFrom(u.arg);
      if (lastMade && nodeByPath(lastMade)?.type === 'note') { const n = await loadNote(lastMade).catch(() => null); return cardFrom(n?.text || '', { fromNote: lastMade }); }
      return cardFrom('');
    }
    case 'research': {
      const { queueSearch } = await import('./research-view.js');
      queueSearch(u.arg);
      go('#/m/scraper');
      return { text: t('loom.research', { q: u.arg }), went: true };
    }
    case 'collect':
      return { text: t('loom.collect'), chips: [{ label: t('loom.chip.research'), act: 'research', arg: u.arg || '' }] };
    case 'attach': return attachTo(lastMade, u.arg);
    case 'next': {
      const p = place.project ? await loadProject(place.project).catch(() => null) : null;
      const step = p ? nextUp(p.steps) : null;
      if (!p) return { text: t('loom.next.noProject') };
      if (!step) return { text: t('loom.next.none', { title: p.title }), chips: [{ label: t('loom.chip.open'), act: 'open', arg: p.path }] };
      return { text: t('loom.next', { title: p.title, step: step.text }), chips: [{ label: t('loom.chip.go'), act: 'open', arg: p.path }] };
    }
    case 'surface':
      window.dispatchEvent(new CustomEvent('loom:surface', { detail: place.project }));
      return { text: place.node ? t('loom.surfaced') : t('loom.surface.top') };
    case 'deeper': {
      if (!place.project) return { text: t('loom.next.noProject') };
      const d = u.arg ? nodeFor(u.arg) : null;
      if (!d) return { text: t('loom.deeper.which') };
      diveInto(place.project, d.path);
      go(nodeHref(place.project));
      return { text: t('loom.deeper', { title: nodeTitle(d, lang) }), went: true };
    }
    case 'ask': return answer(text, { lang });
    default: {
      if (loadPref('loom.aloud', false)) return noteHere(text, { go });
      const a = await answer(text, { lang, quiet: true });
      if (a.items?.length) return a;
      return { text: t('loom.say.what'), chips: [{ label: t('loom.chip.note'), act: 'note', arg: text }, { label: t('loom.chip.research'), act: 'research', arg: text }] };
    }
  }
}

async function answer(question, { lang, quiet = false }) {
  const { found, query } = await answerFrom(question, { lang });
  if (!found.length) {
    return { text: quiet ? t('loom.say.what') : t('loom.answer.none'), chips: [{ label: t('loom.chip.research'), act: 'research', arg: query || question }, { label: t('loom.chip.note'), act: 'note', arg: question }] };
  }
  return { text: found.length === 1 ? t('loom.answer.one') : t('loom.answer.some', { n: found.length }), items: itemsOf(found) };
}

async function attachTo(path, words = '') {
  if (!path || !nodeByPath(path)) return { text: t('loom.attach.nothing') };
  const place = placeNow();
  // a section of the project ("an Kapitel 2"), otherwise a node ("an die Karte Spektralfluss")
  if (place.project) {
    const p = await loadProject(place.project).catch(() => null);
    const want = String(words).toLowerCase().trim();
    const { sectionTitle } = await import('./project-board.js');
    const secs = p ? sectionsOf(p) : [];
    let s = want ? secs.find((x) => sectionTitle(x).toLowerCase() === want || sectionTitle(x).toLowerCase().startsWith(want)) : null;
    if (!s && !want && secs.length) {
      const pick = await actionSheet(t('loom.attach.where'), secs.map((x) => ({ label: sectionTitle(x), value: x.id, icon: 'blocks' })));
      s = secs.find((x) => x.id === pick) || null;
      if (!s) return { text: t('loom.card.later') };
    }
    if (s) {
      await addToProject(place.project, [slugOf(path)]);
      await placeItem(place.project, slugOf(path), s.id, -1);
      return { text: t('loom.attached', { title: sectionTitle(s) }) };
    }
  }
  const d = nodeFor(words);
  if (!d) return { text: t('loom.notFound', { q: words }) };
  await connect(slugOf(path), d.slug);
  return { text: t('loom.attached', { title: nodeTitle(d) }) };
}

async function runChip(c, { go }) {
  try {
    // a chip that leads somewhere: on the phone the conversation steps down to the lower half, so you see where
    // you are and can go on talking (0.33.1)
    if (c.act === 'open') { go(String(c.arg).startsWith('#') ? c.arg : nodeHref(c.arg)); peekTalk(); return; }
    if (c.act === 'research') { const { queueSearch } = await import('./research-view.js'); queueSearch(c.arg); go('#/m/scraper'); peekTalk(); return; }
    if (c.act === 'deeper') { const place = placeNow(); if (place.project) { diveInto(place.project, c.arg); go(nodeHref(place.project)); peekTalk(); } return; }
    let reply = null;
    if (c.act === 'note') reply = await noteHere(c.arg, { go });
    else if (c.act === 'card') { const n = await loadNote(c.arg).catch(() => null); reply = await cardFrom(n?.text || '', { fromNote: c.arg }); }
    else if (c.act === 'attach') reply = await attachTo(c.arg);
    if (reply) push({ who: 'loom', project: placeNow().project, ...reply });
  } catch (e) { console.warn('Loom', e); toast(t('create.failed'), 'error', 5000); }
}

// ------------------------------------------------------------------ the panel
let shared = { open: false, el: null };
export function talkPanel({ go, project = '', embedded = false, onClose = null } = {}) {
  const el = h('section', { class: `loom-talk${embedded ? ' embedded' : ''}`, 'aria-label': t('loom.talk') });
  const list = h('div', { class: 'talk-list', 'aria-live': 'polite' });
  const field = h('textarea', { class: 'talk-in', rows: '1', placeholder: t('loom.talk.placeholder'), 'aria-label': t('loom.talk.placeholder'), enterkeyhint: 'send' });
  const wave = h('div', { class: 'talk-wave', 'aria-hidden': 'true' }, ...Array.from({ length: 22 }, (_, i) => h('span', { style: `--i:${i}` })));
  const mic = h('button', { type: 'button', class: 'talk-mic', 'aria-label': t('loom.mic'), title: t('loom.mic'), html: icon('mic') });
  // what you said lands in the field first (0.33.4): you check it, change it if you like, then send
  const sendBtn = h('button', { type: 'button', class: 'talk-send', hidden: true, 'aria-label': t('loom.send'), title: t('loom.send'), html: icon('arrowUp') });
  // DE / EN beside the microphone: tap to switch the language Loom listens in
  const langBtn = h('button', { type: 'button', class: 'talk-lang', title: t('loom.mic.lang'), 'aria-label': t('loom.mic.lang') });
  const showLang = () => { langBtn.textContent = speechLang().slice(0, 2).toUpperCase(); };
  showLang();
  langBtn.addEventListener('click', () => { const i = SPEECH_LANGS.indexOf(speechLang()); setSpeechLang(SPEECH_LANGS[(i + 1) % SPEECH_LANGS.length]); showLang(); });
  const aloud = h('button', { type: 'button', class: 'chip talk-aloud', 'aria-pressed': String(!!loadPref('loom.aloud', false)), title: t('loom.aloud.hint') }, iconEl('wave'), h('span', { text: t('loom.aloud') }));
  const state = h('span', { class: 'talk-state', text: t('loom.ready') });
  const close = onClose ? h('button', { type: 'button', class: 'icon-btn small talk-close', 'aria-label': t('action.close'), title: t('action.close'), html: icon('close'), onclick: onClose }) : null;
  const photo = photoButton({ cls: 'small', onPath: async (path) => { push({ who: 'me', text: t('loom.photo.me'), project: placeNow().project }); const r = await noteHere(`${imageLine(path)}\n\n${field.value.trim()}`.trim(), { go }); field.value = ''; push({ who: 'loom', ...r }); } });
  const head = h('header', { class: 'talk-head' }, h('span', { class: 'talk-mark' }, loomMark(18), h('b', { text: embedded ? t('loom.aloud.title') : 'Loom' })), state, aloud, close);
  // the phone (0.33.1): a handle on top; tap it to switch between the whole screen and the lower half
  const grab = embedded ? null : h('button', { type: 'button', class: 'talk-grab', 'aria-label': t('loom.half'), title: t('loom.half'), onclick: () => el.classList.toggle('half') });
  const hint = h('p', { class: 'talk-hint', hidden: true });
  el.append(...[grab, head, list, hint, h('div', { class: 'talk-bar' }, wave, field, photo, langBtn, sendBtn, mic)].filter(Boolean));
  field.addEventListener('focus', () => el.classList.remove('half'));

  aloud.addEventListener('click', () => {
    const on = !loadPref('loom.aloud', false);
    savePref('loom.aloud', on);
    aloud.setAttribute('aria-pressed', String(on));
    toast(t(on ? 'loom.aloud.on' : 'loom.aloud.off'), 'info', 3000);
  });

  function drawMsg(m) {
    const me = m.who === 'me';
    const box = h('div', { class: `talk-msg ${me ? 'me' : 'loom'}` }, h('p', { class: 'talk-bubble', text: m.text }));
    // spoken and written down roughly here, or waiting: the Mac makes it precise later (0.33.4)
    if (m.spoken === 'here' || m.spoken === 'waiting') box.append(h('span', { class: 'talk-rough', text: t(m.spoken === 'here' ? 'loom.voice.rough' : 'loom.voice.wait') }));
    if (m.items?.length) {
      box.append(h('div', { class: 'talk-items' }, m.items.map((it) => {
        const a = h('a', { class: 'talk-item', href: nodeHref(it.path) }, h('span', { class: 'talk-kind', text: typeLabel(it.type) }), h('b', { text: it.title }));
        if (it.tex) a.append(typeset(h('span', { class: 'talk-tex' }), it.tex, false));
        if (it.quote) a.append(h('span', { class: 'talk-quote', text: it.quote.length > 260 ? `${it.quote.slice(0, 258)} …` : it.quote }));
        a.append(h('span', { class: 'talk-src', text: t('loom.source', { title: it.title }) }));
        return a;
      })));
    }
    if (m.made) box.append(h('a', { class: 'talk-made', href: m.made.href, text: `+ ${m.made.label}` }));
    if (m.chips?.length) box.append(h('div', { class: 'talk-chips' }, m.chips.map((c) => h('button', { type: 'button', class: 'loom-chip', text: c.label, onclick: () => runChip(c, { go }) }))));
    return box;
  }
  function suggestBox() {
    const mode = loomSuggest();
    if (mode === 'off') return null;
    const dismissed = loadPref('loom.dismissed', []);
    const items = suggestions({ max: mode === 'more' ? 3 : 1, dismissed: Array.isArray(dismissed) ? dismissed : [] });
    if (!items.length) return null;
    return h('div', { class: 'talk-suggest' }, items.map((x) => suggestRow(x, { go, redraw })));
  }
  function redraw() {
    const all = history().filter((m) => !embedded || m.project === project);
    const shown = all.slice(-30);
    list.replaceChildren(...(shown.length ? shown.map(drawMsg) : [h('div', { class: 'talk-empty' }, h('p', { class: 'muted small', text: t(embedded ? 'loom.talk.emptyProject' : 'loom.talk.empty') }),
      h('p', { class: 'muted small talk-how', text: t('loom.talk.how') }))]), ...[suggestBox()].filter(Boolean));
    list.scrollTop = list.scrollHeight;
  }
  el.redraw = redraw;
  panels.add(el);

  // → { msg, note, project }: the id of your message, the note it became (if any), where you were (0.33.4)
  let pending = null;   // what was spoken into the field: { text, precise, later, keep }
  async function send(value, { spoken = '' } = {}) {
    const text = String(value || '').trim();
    if (!text) return null;
    field.value = '';
    fitField();
    showSend();
    // spoken text you corrected: Loom learns the words; unchanged rough text waits for the Mac to make it precise
    const said = pending;
    pending = null;
    if (said && !spoken) {
      const changed = said.text.trim() !== text;
      if (changed) learnWords(said.text, text);
      spoken = said.precise ? 'mac' : said.later && !changed ? 'here' : 'device';
    }
    const at = embedded ? project : placeNow().project;
    if (embedded && project) setTalkPlace(project);
    const msg = push({ who: 'me', text, project: at, ...(spoken ? { spoken } : {}) });
    state.textContent = t('loom.thinking');
    const before = lastMade;
    try {
      const reply = await respond(text, { go });
      const { went, ...rest } = reply;
      push({ who: 'loom', project: reply.project ?? at, ...rest });
      if (went) peekTalk();
    } catch (e) { console.warn('Loom', e); push({ who: 'loom', text: t('loom.failed'), project: at }); }
    state.textContent = t('loom.ready');
    const done = { msg, note: lastMade !== before ? lastMade : '', project: at };
    if (said && spoken === 'here') await keepForMac({ ...said.keep, rough: text, msg: done.msg, note: done.note, project: done.project }).catch(() => {});
    return done;
  }
  el.send = send;
  const fitField = () => { field.style.height = 'auto'; field.style.height = `${Math.min(120, field.scrollHeight)}px`; };
  field.addEventListener('input', () => { fitField(); showSend(); if (!field.value.trim()) pending = null; });
  const showSend = () => { sendBtn.hidden = !field.value.trim(); };
  sendBtn.addEventListener('click', () => send(field.value));
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(field.value); }
    if (e.key === 'Escape' && onClose) { e.preventDefault(); e.stopPropagation(); onClose(); }
  });

  // ---------------- speaking: the browser's speech recognition, or the keyboard's dictation
  // Speaking (0.33.4, ENTE: "wie eine Sprachnachricht … aber nicht meine Tastatur"): a tap on the microphone
  // records, a second tap ends it (or 5 minutes); the keyboard never opens. 0.33.5 ("Text in Echtzeit", "nach 10
  // Sekunden Stille automatisch schicken, außer ich sage warte"): what you say appears in the field while you speak
  // (the Mac writes along, or the model on this device); after 10 s of silence it is sent by itself, unless your last
  // word was "warte" (then Loom waits until you speak again). A tap on the microphone instead ends it and lets you check
  // the text first. Same in "Laut denken".
  let rec = null;
  let live = null;
  let base = '';
  let busy = false;
  let tick = 0;
  let hintTimer = 0;
  const showHint = (key, args, ms = 12000) => {
    hint.textContent = t(key, args);
    hint.hidden = false;
    clearTimeout(hintTimer);
    if (ms) hintTimer = setTimeout(() => { hint.hidden = true; }, ms);
  };
  const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  const micIdle = () => { field.placeholder = t('loom.talk.placeholder'); mic.innerHTML = icon('mic'); mic.setAttribute('aria-pressed', 'false'); mic.title = t('loom.mic'); mic.setAttribute('aria-label', t('loom.mic')); el.classList.remove('listening', 'live-text'); el.style.removeProperty('--level'); field.readOnly = false; };
  const autoSend = () => loadPref('loom.autoSend', true) !== false;
  // the small model on this device: asked once before it is fetched (about 230 MB)
  const mayLoad = async () => {
    if (Date.now() - Number(loadPref('loom.speech.declined', 0)) < 24 * 3600 * 1000) return false;
    if (!(await confirmDialog(t('loom.model.title'), t('loom.model.ask'), { okLabel: t('loom.model.load') }))) { savePref('loom.speech.declined', Date.now()); return false; }
    try {
      await loadHere((share) => showHint('loom.model.loading', { n: Math.round((share || 0) * 100) }, 0));
      showHint('loom.model.ready', {}, 4000);
      return true;
    } catch (e) { console.warn('speech model', e); showHint('loom.model.failed'); return false; }
  };
  // the text is there: into the field after what stood there before; sent at once when it came by itself (auto)
  async function landed(text, { precise, later, pcm, lang, prompt, seconds, auto }) {
    field.value = base ? `${base} ${text}` : text;
    const keep = later && !precise && !base;
    pending = { text: field.value, precise, later: keep, keep: keep ? { wav: wavOf(pcm), lang, prompt, seconds } : null };
    fitField();
    showSend();
    if (auto) { await send(field.value); return; }
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) { field.focus({ preventScroll: true }); field.setSelectionRange(field.value.length, field.value.length); }
    if (!precise && !later) showHint('loom.mic.roughOnly', {}, 6000);
  }
  // written down only now (nothing wrote along): the Mac, the device, or it waits as a voice message
  async function heard(pcm, seconds, { lang, prompt }) {
    if (isSilent(pcm)) { field.value = base; showSend(); showHint('loom.mic.silent', {}, 5000); return; }
    const res = await writeDown(pcm, { lang, prompt, mayLoad });
    if (res.text) { await landed(res.text, { precise: res.precise, later: res.later, pcm, lang, prompt, seconds, auto: false }); return; }
    field.value = base;
    showSend();
    if (res.later) {
      const at = embedded ? project : placeNow().project;
      const msg = push({ who: 'me', text: t('loom.voice.waiting', { time: clock(seconds) }), project: at, spoken: 'waiting' });
      await keepForMac({ wav: wavOf(pcm), lang, prompt, rough: '', msg, note: '', project: at, seconds });
      return;
    }
    showHint('loom.mic.nothing');
  }
  async function finish({ auto = false } = {}) {
    const r = rec;
    const lw = live;
    rec = null;
    live = null;
    clearInterval(tick);
    micIdle();
    busy = true;
    mic.disabled = true;
    state.textContent = t('loom.writing');
    const lang = speechLang().slice(0, 2);
    const prompt = r.prompt;
    try {
      const seconds = r.seconds();
      const pcm = await r.stop();
      const out = lw ? await lw.finish() : null;
      if (out && !out.broken) {
        if (out.text) await landed(out.text, { precise: lw.engine === 'mac', later: lw.engine === 'here' && !!r.canLater, pcm, lang, prompt, seconds, auto: auto && !lw.hold });
        else { field.value = base; showSend(); showHint('loom.mic.silent', {}, 5000); }
      } else await heard(pcm, seconds, { lang, prompt });
    } catch (e) { console.warn('speech', e); showHint('loom.mic.failed', { error: e?.name || 'stop' }); }
    busy = false;
    mic.disabled = false;
    state.textContent = t('loom.ready');
  }
  mic.addEventListener('click', async () => {
    if (busy) return;
    if (rec) { finish(); return; }
    hint.hidden = true;
    let r;
    try {
      r = await record({ onLevel: (v) => el.style.setProperty('--level', v.toFixed(2)) });
    } catch (e) {
      showHint(e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'loom.mic.denied' : e?.name === 'NotSupportedError' ? 'loom.mic.none' : 'loom.mic.failed', { error: e?.name || '?' });
      return;
    }
    rec = r;
    base = field.value.trim();
    field.readOnly = true;
    el.classList.add('listening');
    mic.innerHTML = icon('stop');
    mic.setAttribute('aria-pressed', 'true');
    mic.title = t('loom.mic.stop');
    mic.setAttribute('aria-label', t('loom.mic.stop'));
    state.textContent = t('loom.recording', { time: '0:00' });
    const lang = speechLang().slice(0, 2);
    r.prompt = vocabulary({ project: embedded ? project : placeNow().project, lang });
    // who writes along is found out while you already speak (the recording keeps everything from the start)
    // 0.33.7: the field says who writes down (and the model wakes at once, so the first words do not wait for it)
    field.placeholder = t('loom.listening');
    const wantLive = loadPref('loom.live', true) !== false;
    (wantLive ? liveEngine() : activeEngine()).then((engine) => {
      if (rec !== r) return;
      warmUp(engine);
      field.placeholder = t(!engine ? 'loom.listening.later' : !wantLive ? 'loom.listening.end' : engine === 'mac' ? 'loom.listening.mac' : 'loom.listening.here');
    }).catch(() => {});
    if (wantLive) {
      liveEngine().then((engine) => {
        if (!engine || rec !== r) return;
        r.canLater = engine === 'here' && hasHelperNow();
        live = liveWriter(r, { engine, lang, prompt: r.prompt, onText: ({ text }) => {
          if (rec !== r) return;
          field.value = base ? `${base} ${text}` : text;
          el.classList.toggle('live-text', !!field.value);
          fitField();
        } });
      }).catch(() => {});
    }
    tick = setInterval(() => {
      if (rec !== r) return;
      const sec = r.seconds();
      const quiet = r.silence();
      if (live && live.hold) state.textContent = t('loom.hold');
      else if (live && live.said && autoSend() && quiet >= AUTO_SECONDS - 3) state.textContent = t('loom.autosend.in', { n: Math.max(1, Math.ceil(AUTO_SECONDS - quiet)) });
      else state.textContent = t('loom.recording', { time: clock(sec) });
      if (live && live.said && !live.hold && !live.busy && autoSend() && quiet >= AUTO_SECONDS) { finish({ auto: true }); return; }
      if (sec >= MAX_SECONDS) finish();
    }, 250);
  });
  // Escape while recording: thrown away
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !rec) return;
    e.stopPropagation();
    live?.cancel();
    rec.cancel();
    rec = null;
    live = null;
    clearInterval(tick);
    micIdle();
    field.value = base;
    showSend();
    state.textContent = t('loom.ready');
  });
  redraw();
  return el;
}

// One suggestion: what, why, and one chip to act; "×" sets it aside.
export function suggestRow(x, { go, redraw = () => {} }) {
  const label = { go: t('loom.chip.go'), open: t('loom.chip.open'), card: t('loom.chip.card') }[x.chip.label] || x.chip.label;
  const text = x.why === 'inbox' ? t('loom.sug.inbox', { n: x.text }) : x.text;
  const away = h('button', { type: 'button', class: 'icon-btn small sug-away', 'aria-label': t('loom.sug.away'), title: t('loom.sug.away'), html: icon('close') });
  away.addEventListener('click', () => { const list = loadPref('loom.dismissed', []); savePref('loom.dismissed', [...(Array.isArray(list) ? list : []), x.key].slice(-80)); redraw(); });
  return h('div', { class: 'sug' }, h('div', { class: 'sug-text' }, h('b', { text }), h('span', { class: 'sug-why', text: t(`loom.why.${x.why}`, { title: x.whyArg || '', n: x.text, arg: x.whyArg || '' }) })),
    h('button', { type: 'button', class: 'loom-chip', text: label, onclick: () => runChip(x.chip, { go }) }), away);
}

// ------------------------------------------------------------------ the docked panel (Alt+T, the Loom button)
export function openTalk({ go, text = '', focus = true } = {}) {
  if (!shared.el || !shared.el.isConnected) {
    shared.el = talkPanel({ go, onClose: () => closeTalk() });
    shared.el.classList.add('docked');
    document.querySelector('.app')?.append(shared.el);
  }
  shared.open = true;
  document.querySelector('.app')?.classList.add('talk-open');
  shared.el.hidden = false;
  shared.el.classList.remove('half');
  shared.el.redraw();
  if (text) shared.el.send(text);
  // the field takes the keys only on a Mac (mouse and keyboard); on the phone a tap on the field opens the keyboard,
  // nothing else does (0.33.2)
  else if (focus && window.matchMedia('(hover: hover) and (pointer: fine)').matches) setTimeout(() => shared.el?.querySelector('.talk-in')?.focus({ preventScroll: true }), 60);
  return shared.el;
}
export function closeTalk() {
  shared.open = false;
  document.querySelector('.app')?.classList.remove('talk-open');
  if (shared.el) shared.el.hidden = true;
}
export function toggleTalk({ go }) {
  // on a project page with the conversation beside it, the key goes to that field
  const here = document.querySelector('.main .loom-talk.embedded .talk-in');
  const r = here?.getBoundingClientRect();
  if (here && here.offsetParent && !shared.open && r.top < innerHeight && r.bottom > 0 && innerWidth >= 900) { here.focus(); return; }
  if (shared.open) closeTalk(); else openTalk({ go });
}
export const sendToLoom = (text, { go }) => openTalk({ go, text });
// the phone: the docked conversation to the lower half (after a chip or an answer led somewhere)
export function peekTalk() {
  if (!shared.open || !shared.el || window.innerWidth >= 760) return;
  shared.el.classList.add('half');
  document.activeElement?.blur?.();
}
export const talkIsOpen = () => shared.open;
