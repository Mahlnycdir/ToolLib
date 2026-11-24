// The card window (0.14.1.2, shared since 0.14.2): kind, title, topic, text and language, filled in from what you
// selected, or empty for a card from a whole work. Used by the reader, the research window and the node of a clip.
import { h, loadPref, modal, savePref, toast } from '../services/ui.js';
import { getLang, t } from '../i18n/i18n.js';
import { CARD_KINDS, createCard, guessKind, guessLang, guessTitle, knownTopics } from '../services/reader-cards.js';
import { keepWork } from '../services/research-store.js';
import { photoButton, imageLine } from './photo.js';
import { typeset } from './math.js';
import { focusProject, loadProject, sectionsOf, stationOf } from '../services/projects.js';

// opts: { text, section, kind, workTitle, lang } → { kind, title, topic, text, lang, attach } or null
// 0.35.0 (P24, "auch das Erstellen neuer Karten überarbeiten"): one tap. The kind as buttons, the title and the topic
// filled in (your last topics as chips), the formula of the text shown as it will look, a photo, and what the card
// hangs on: the work it comes from and the project you work on, in the section you pick (kept per project).
// Enter in the title creates it. attach: { project, section } or null.
export async function cardDialog({ text = '', section = '', kind = '', workTitle = '', lang = '', title: title0 = '' } = {}) {
  let k = kind || (text ? guessKind(text, section) : 'formula');
  const kinds = h('div', { class: 'segmented small cd-kinds', role: 'group', 'aria-label': t('reader.card.type') });
  const drawKinds = () => kinds.replaceChildren(...CARD_KINDS.map((x) => {
    const b = h('button', { type: 'button', class: x === k ? 'on' : '', 'aria-pressed': String(x === k), dataset: { kind: x }, text: t(`reader.card.kind.${x}`) });
    b.addEventListener('click', () => { k = x; drawKinds(); });
    return b;
  }));
  drawKinds();
  const title = h('input', { class: 'field cd-title', type: 'text', value: title0 || (text ? guessTitle(text, section) : ''), 'aria-label': t('reader.card.title'), placeholder: t('reader.card.title') });
  const recent = loadPref('reader.topics', []).filter((x) => typeof x === 'string').slice(0, 5);
  const topic = h('input', { class: 'field cd-topic', type: 'text', list: 'rd-topics', value: loadPref('reader.topic', ''), 'aria-label': t('reader.card.topic'), placeholder: t('reader.card.topic'), autocomplete: 'off' });
  const topicChips = h('div', { class: 'cd-chips' }, ...recent.map((x) => { const c = h('button', { type: 'button', class: 'chip small', text: x }); c.addEventListener('click', () => { topic.value = x; }); return c; }));
  const body = h('textarea', { class: 'field rd-card-text', rows: '4', 'aria-label': t('reader.card.text') });
  body.value = text;
  // the formula as it will look (the first $…$ or $$…$$ of the text)
  const preview = h('div', { class: 'cd-preview', hidden: true });
  const drawPreview = () => {
    const m = body.value.match(/\$\$([\s\S]+?)\$\$/) || body.value.match(/\$([^$\n]+)\$/);
    preview.hidden = !m;
    if (m) { preview.replaceChildren(); typeset(preview, m[1].trim(), true); }
  };
  body.addEventListener('input', drawPreview);
  drawPreview();
  let ln = lang || (text ? guessLang(text) : (getLang() === 'de' ? 'de' : 'en'));
  const langs = h('div', { class: 'segmented small cd-lang', role: 'group', 'aria-label': t('reader.card.lang') });
  const drawLangs = () => langs.replaceChildren(...['de', 'en'].map((x) => { const b = h('button', { type: 'button', class: x === ln ? 'on' : '', 'aria-pressed': String(x === ln), text: x.toUpperCase() }); b.addEventListener('click', () => { ln = x; drawLangs(); }); return b; }));
  drawLangs();
  // what it hangs on: the work, and the project you work on with its section
  const proj = focusProject();
  let attachOn = !!proj;
  let sec = '';
  const hangs = h('div', { class: 'cd-hangs' });
  if (proj) {
    const p = await loadProject(proj.path).catch(() => null);
    const secs = p ? sectionsOf(p) : [];
    const kept = loadPref('card.section', {})[proj.path];
    sec = secs.some((x) => x.id === kept) ? kept : (secs.find((x) => x.id === stationOf(k)) || secs[0] || {}).id || '';
    const toggle = h('button', { type: 'button', class: `chip cd-proj${attachOn ? ' on' : ''}`, 'aria-pressed': String(attachOn) }, h('span', { text: proj.title }));
    toggle.addEventListener('click', () => { attachOn = !attachOn; toggle.classList.toggle('on', attachOn); toggle.setAttribute('aria-pressed', String(attachOn)); pick.disabled = !attachOn; });
    const pick = h('select', { class: 'field small cd-sec', 'aria-label': t('reader.card.section') }, ...secs.map((x) => h('option', { value: x.id, selected: x.id === sec ? true : null, text: x.title || x.id })));
    pick.addEventListener('change', () => { sec = pick.value; });
    hangs.append(...[h('span', { class: 'muted small', text: t('reader.card.hangs') }), workTitle ? h('span', { class: 'chip on cd-work', text: workTitle.slice(0, 60) }) : null, toggle, secs.length ? pick : null].filter(Boolean));
  } else if (workTitle) hangs.append(h('span', { class: 'muted small', text: t('reader.card.hangs') }), h('span', { class: 'chip on cd-work', text: workTitle.slice(0, 60) }));
  const form = h('div', { class: 'rd-card-form cd-form' },
    kinds, title,
    h('div', { class: 'cd-topicrow' }, topic, topicChips),
    h('datalist', { id: 'rd-topics' }, ...knownTopics().slice(0, 40).map((x) => h('option', { value: x }))),
    preview, body,
    h('div', { class: 'cd-row' }, photoButton({ cls: 'small', onPath: (img) => { body.value = `${body.value.trim()}\n\n${imageLine(img)}`.trim(); } }), h('span', { class: 'grow' }), langs),
    hangs.childNodes.length ? hangs : null,
    section ? h('p', { class: 'muted small', text: t('reader.card.from', { work: workTitle, section }) }) : null);
  const done = () => {
    if (!title.value.trim() || !body.value.trim()) { toast(t('reader.card.empty'), 'error'); (title.value.trim() ? body : title).focus(); return undefined; }
    const v = { kind: k, title: title.value.trim(), topic: topic.value.trim(), text: body.value.trim(), lang: ln, attach: attachOn && proj ? { project: proj.path, section: sec } : null };
    if (v.topic) savePref('reader.topics', [v.topic, ...recent.filter((x) => x !== v.topic)].slice(0, 8));
    if (v.attach?.section) savePref('card.section', { ...loadPref('card.section', {}), [proj.path]: v.attach.section });
    return v;
  };
  return modal({
    title: t('reader.card.new'), body: form, wide: true,
    actions: [{ label: t('action.cancel'), value: null }, { label: t('reader.card.create'), kind: 'primary', value: done }],
    onOpen: (m) => setTimeout(() => {
      title.focus();
      title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const btn = [...(title.closest('.modal')?.querySelectorAll('.modal-actions button') || [])].pop(); btn?.click(); } });
    }, 60),
  });
}

// The link of a work for sources: its DOI, its arXiv page, else its best address.
export const workUrl = (w) => (w.ids?.doi ? `https://doi.org/${w.ids.doi}` : w.ids?.arxiv ? `https://arxiv.org/abs/${w.ids.arxiv}` : w.url || w.versions?.[0]?.url || '');

// A card, a term or a snippet from a whole work (0.14.2): the work is kept first, the new node names it and links its clip.
// kind: 'card' | 'term' | 'snippet'. Returns the path of the new card, true for a snippet draft, or null.
export async function createFromWork(kind, work, { folderPath = '', query = '', go = (h2) => { location.hash = h2; } } = {}) {
  try {
    const clipPath = work.clip?.path || (await keepWork(work, { folderPath, query })).clipPath;
    const clipSlug = clipPath.slice(clipPath.lastIndexOf('/') + 1).replace(/\.md$/, '');
    if (kind === 'snippet') {
      savePref('snippet.draft', { from: clipPath, fromTitle: work.title, group: '', links: [clipSlug], code: '', check: '' });
      go('#/new');
      return true;
    }
    const values = await cardDialog({ kind: kind === 'term' ? 'term' : 'formula', workTitle: work.title });
    if (!values) return null;
    const path = await createCard({ ...values, section: '', work: { title: work.title, url: workUrl(work) }, clipSlug });
    if (values.topic) savePref('reader.topic', values.topic);
    toast(t('reader.card.made', { title: values.title }), 'ok');
    return path;
  } catch (e) {
    console.warn('Could not create from the work', e);
    toast(t('reader.card.failed'), 'error', 5000);
    return null;
  }
}
