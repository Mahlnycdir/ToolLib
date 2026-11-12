// How a search found its hits (0.19.0), one quiet line above them: the word that was corrected ("Meintest du
// „plot“?"), the other names that found something ("Auch gefunden über: fit, curve_fit") and whether what you
// opened before for the same words comes first. Nothing when the hits simply matched your words.
import { h } from '../services/ui.js';
import { t } from '../i18n/i18n.js';

export function searchNote(note, cls = 'search-note') {
  if (!note) return null;
  const parts = [];
  if (note.corrected?.length) parts.push(t('search.corrected', { words: note.corrected.map((c) => c.to).join(' ') }));
  if (note.via?.length) parts.push(t('search.via', { names: note.via.slice(0, 3).join(', ') }));
  if (note.learned) parts.push(t('search.learned'));
  return parts.length ? h('div', { class: `${cls} muted small`, role: 'note', text: parts.join(' · ') }) : null;
}
