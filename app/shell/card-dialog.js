// The card window (0.14.1.2, shared since 0.14.2): kind, title, topic, text and language, filled in from what you
// selected, or empty for a card from a whole work. Used by the reader, the research window and the node of a clip.
import { h, loadPref, modal, savePref, toast } from '../services/ui.js';
import { getLang, t } from '../i18n/i18n.js';
import { CARD_KINDS, createCard, guessKind, guessLang, guessTitle, knownTopics } from '../services/reader-cards.js';
import { keepWork } from '../services/research-store.js';

// opts: { text, section, kind, workTitle, lang } → { kind, title, topic, text, lang } or null
export async function cardDialog({ text = '', section = '', kind = '', workTitle = '', lang = '' } = {}) {
  const sel = h('select', { class: 'field', 'aria-label': t('reader.card.type') }, ...CARD_KINDS.map((k) => h('option', { value: k, text: t(`reader.card.kind.${k}`) })));
  sel.value = kind || (text ? guessKind(text, section) : 'formula');
  const title = h('input', { class: 'field', type: 'text', value: text ? guessTitle(text, section) : '', 'aria-label': t('reader.card.title') });
  const topics = knownTopics();
  const topic = h('input', { class: 'field', type: 'text', list: 'rd-topics', value: loadPref('reader.topic', ''), 'aria-label': t('reader.card.topic'), autocomplete: 'off' });
  const body = h('textarea', { class: 'field rd-card-text', rows: '5', 'aria-label': t('reader.card.text') });
  body.value = text;
  const langSel = h('select', { class: 'field', 'aria-label': t('reader.card.lang') }, h('option', { value: 'en', text: 'English' }), h('option', { value: 'de', text: 'Deutsch' }));
  langSel.value = lang || (text ? guessLang(text) : (getLang() === 'de' ? 'de' : 'en'));
  const row = (key, el) => h('label', { class: 'rd-card-row' }, h('span', { text: t(key) }), el);
  const from = section ? t('reader.card.from', { work: workTitle, section }) : workTitle ? t('library.fromWork', { work: workTitle }) : '';
  const form = h('div', { class: 'rd-card-form' },
    row('reader.card.type', sel), row('reader.card.title', title), row('reader.card.topic', topic),
    h('datalist', { id: 'rd-topics' }, ...topics.slice(0, 40).map((x) => h('option', { value: x }))),
    row('reader.card.text', body), row('reader.card.lang', langSel),
    from ? h('p', { class: 'muted small', text: from }) : null);
  return modal({
    title: t('reader.card.new'), body: form, wide: true,
    actions: [
      { label: t('action.cancel'), value: null },
      { label: t('reader.card.create'), kind: 'primary', value: () => {
        if (!title.value.trim() || !body.value.trim()) { toast(t('reader.card.empty'), 'error'); (title.value.trim() ? body : title).focus(); return undefined; }
        return { kind: sel.value, title: title.value.trim(), topic: topic.value.trim(), text: body.value.trim(), lang: langSel.value };
      } },
    ],
    onOpen: () => setTimeout(() => title.focus(), 60),
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
