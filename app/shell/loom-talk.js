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
import { h, toast, actionSheet, loadPref, savePref } from '../services/ui.js';
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

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
const KEY = 'loom.talk';
const slugOf = (path) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;
// The language Loom listens in (0.33.2): its own, not the language of the surface. ENTE reads Loom in English and
// speaks German; an English recognizer then got every second word wrong. First the pref, then the languages of the
// device (German if it has German at all), then the surface.
export const SPEECH_LANGS = ['de-DE', 'en-US'];
export function speechLang() {
  const v = loadPref('loom.speechLang', '');
  if (SPEECH_LANGS.includes(v)) return v;
  const device = (navigator.languages?.length ? navigator.languages : [navigator.language || '']).map((x) => String(x).toLowerCase());
  if (device.some((x) => x.startsWith('de'))) return 'de-DE';
  if (device.some((x) => x.startsWith('en'))) return 'en-US';
  return getLang() === 'de' ? 'de-DE' : 'en-US';
}

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
  const all = [...history(), { id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, at: Date.now(), ...msg }].slice(-60);
  savePref(KEY, all);
  for (const p of [...panels]) { if (p.isConnected) p.redraw(); else panels.delete(p); }
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
  // DE / EN beside the microphone: tap to switch the language Loom listens in
  const langBtn = h('button', { type: 'button', class: 'talk-lang', title: t('loom.mic.lang'), 'aria-label': t('loom.mic.lang') });
  const showLang = () => { langBtn.textContent = speechLang().slice(0, 2).toUpperCase(); };
  showLang();
  langBtn.addEventListener('click', () => { const i = SPEECH_LANGS.indexOf(speechLang()); savePref('loom.speechLang', SPEECH_LANGS[(i + 1) % SPEECH_LANGS.length]); showLang(); });
  const aloud = h('button', { type: 'button', class: 'chip talk-aloud', 'aria-pressed': String(!!loadPref('loom.aloud', false)), title: t('loom.aloud.hint') }, iconEl('wave'), h('span', { text: t('loom.aloud') }));
  const state = h('span', { class: 'talk-state', text: t('loom.ready') });
  const close = onClose ? h('button', { type: 'button', class: 'icon-btn small talk-close', 'aria-label': t('action.close'), title: t('action.close'), html: icon('close'), onclick: onClose }) : null;
  const photo = photoButton({ cls: 'small', onPath: async (path) => { push({ who: 'me', text: t('loom.photo.me'), project: placeNow().project }); const r = await noteHere(`${imageLine(path)}\n\n${field.value.trim()}`.trim(), { go }); field.value = ''; push({ who: 'loom', ...r }); } });
  const head = h('header', { class: 'talk-head' }, h('span', { class: 'talk-mark' }, loomMark(18), h('b', { text: embedded ? t('loom.aloud.title') : 'Loom' })), state, aloud, close);
  // the phone (0.33.1): a handle on top; tap it to switch between the whole screen and the lower half
  const grab = embedded ? null : h('button', { type: 'button', class: 'talk-grab', 'aria-label': t('loom.half'), title: t('loom.half'), onclick: () => el.classList.toggle('half') });
  const hint = h('p', { class: 'talk-hint', hidden: true });
  el.append(...[grab, head, list, hint, h('div', { class: 'talk-bar' }, wave, field, photo, langBtn, mic)].filter(Boolean));
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

  async function send(value) {
    const text = String(value || '').trim();
    if (!text) return;
    field.value = '';
    fitField();
    const at = embedded ? project : placeNow().project;
    if (embedded && project) setTalkPlace(project);
    push({ who: 'me', text, project: at });
    state.textContent = t('loom.thinking');
    try {
      const reply = await respond(text, { go });
      const { went, ...msg } = reply;
      push({ who: 'loom', project: reply.project ?? at, ...msg });
      if (went) peekTalk();
    } catch (e) { console.warn('Loom', e); push({ who: 'loom', text: t('loom.failed'), project: at }); }
    state.textContent = t('loom.ready');
  }
  el.send = send;
  const fitField = () => { field.style.height = 'auto'; field.style.height = `${Math.min(120, field.scrollHeight)}px`; };
  field.addEventListener('input', fitField);
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(field.value); }
    if (e.key === 'Escape' && onClose) { e.preventDefault(); e.stopPropagation(); onClose(); }
  });

  // ---------------- speaking: the browser's speech recognition, or the keyboard's dictation
  // Speaking (0.33.2, ENTE: "Die Sprache soll im Browser funktionieren", "nicht die Tastatur random öffnen"): the
  // microphone always starts the browser's own recognition (Safari, Chrome) in the language above; what it hears
  // stands in the field while you speak and is sent when you pause. It never opens the keyboard. If the browser
  // cannot listen, a line says why (no keyboard, no detour). No time limit: Safari may first ask for the microphone.
  let rec = null;
  let hintTimer = 0;
  const showHint = (key, args) => {
    hint.textContent = t(key, args);
    hint.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { hint.hidden = true; }, 12000);
  };
  const homeScreen = navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  mic.addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    const Rec = SR();
    if (!Rec) { showHint(homeScreen ? 'loom.mic.safari' : 'loom.mic.none'); return; }
    hint.hidden = true;
    const done = () => { rec = null; el.classList.remove('listening'); state.textContent = t('loom.ready'); mic.setAttribute('aria-pressed', 'false'); };
    try {
      rec = new Rec();
      rec.lang = speechLang();
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.continuous = !!loadPref('loom.aloud', false);
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) { const said = r[0].transcript.trim(); if (said) send(said); interim = ''; } else interim += r[0].transcript;
        }
        if (interim) field.value = interim;
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') showHint(homeScreen ? 'loom.mic.safari' : 'loom.mic.denied');
        else if (e.error === 'language-not-supported') showHint('loom.mic.lang.no');
        else if (e.error !== 'no-speech' && e.error !== 'aborted') showHint('loom.mic.failed', { error: e.error || '?' });
      };
      rec.onend = done;
      rec.start();
      el.classList.add('listening');
      mic.setAttribute('aria-pressed', 'true');
      state.textContent = t('loom.listening');
    } catch (err) { done(); showHint('loom.mic.failed', { error: err?.name || 'start' }); }
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
