// "Delete" for any node (0.15.2): one question that says what else changes, then a toast with "Undo".
import { h, modal, toast } from '../services/ui.js';
import { getLang, t } from '../i18n/i18n.js';
import { nodeByPath } from '../services/search.js';
import { removeNode, whatGoes } from '../services/remove.js';
import { titleOf } from '../services/nodes.js';
import { forgetEdits } from './run-panel.js';
import { moduleOfType } from './modules.js';

const names = (list) => { const [a, b] = getLang() === 'de' ? ['„', '“'] : ['“', '”']; return list.map((x) => `${a}${titleOf(x, getLang(), x.slug)}${b}`).join(', '); };

// Asks, deletes and leads to the tool the node belonged to. Returns true when it was deleted.
export async function askDelete(path, { go, title = '' } = {}) {
  const d = nodeByPath(path);
  const name = title || (d ? titleOf(d, getLang(), d.slug) : path.split('/').pop());
  const { projects, folders, library, linkedFrom } = whatGoes(path);
  const lines = [h('p', { text: t('delete.what', { title: name }) })];
  const places = [...projects, ...folders, ...library];
  if (places.length) lines.push(h('p', { class: 'delete-places', text: t('delete.places', { list: names(places) }) }));
  if (linkedFrom.length) {
    lines.push(h('p', { class: 'delete-links muted', text: t('delete.links', { n: linkedFrom.length, list: names(linkedFrom.slice(0, 3)) + (linkedFrom.length > 3 ? ' …' : '') }) }));
  }
  const ok = await modal({
    title: t('delete.title'),
    body: h('div', { class: 'delete-ask' }, ...lines),
    actions: [{ label: t('action.cancel'), value: false }, { label: t('delete.ok'), kind: 'danger', value: true }],
    dismissValue: false,
  });
  if (!ok) return false;
  let undo;
  try {
    undo = await removeNode(path);
  } catch (err) {
    console.warn('Could not delete', path, err);
    toast(t('delete.failed', { error: err.message || String(err) }), 'error', 5000);
    return false;
  }
  if (d?.type === 'snippet') forgetEdits(path);
  const module = moduleOfType(d?.type || '');
  const back = module === 'shell' ? '#/home' : `#/m/${module}`;
  toast(t('delete.done', { title: name }), 'ok', 8000, {
    label: t('delete.undo'),
    run: async () => {
      try { await undo(); toast(t('delete.undone'), 'ok'); go(`#/n/${path.split('/').map(encodeURIComponent).join('/')}`); }
      catch (err) { toast(t('delete.failed', { error: err.message || String(err) }), 'error', 5000); }
    },
  });
  location.replace(back);   // Back should not lead to what is gone
  return true;
}
