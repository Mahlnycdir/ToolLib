// A photo when you create something (0.33.0, P33: "Bilder und Kamera beim Anlegen, egal was"): one button for the
// card window, a new note, a quick note in a project and the conversation with Loom. On the iPhone the file picker
// offers the camera and the photo library; on the Mac a file. The picture is kept in assets/ (services/assets.js,
// made smaller, an SVG never) and goes into the text as ![](assets/…).
//
//   photoButton({ onPath, cls })   → a button; onPath(path) gets the stored picture's path
//   imageLine(path)                → the Markdown line for it
import { h, toast } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t } from '../i18n/i18n.js';
import { saveImage } from '../services/assets.js';

export const imageLine = (path) => `![](${path})`;

export function photoButton({ onPath, cls = '' }) {
  const input = h('input', { type: 'file', accept: 'image/*', hidden: true, class: 'photo-input' });
  const btn = h('button', { type: 'button', class: `icon-btn photo-btn ${cls}`, title: t('photo.add'), 'aria-label': t('photo.add'), html: icon('camera') });
  btn.addEventListener('click', () => { input.value = ''; input.click(); });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    btn.classList.add('busy');
    try { onPath(await saveImage(file), file); } catch (e) {
      toast(t(String(e?.message) === 'no-knowledge' ? 'create.noKnowledge' : 'photo.failed'), 'error', 5000);
    } finally { btn.classList.remove('busy'); }
  });
  return h('span', { class: 'photo-wrap' }, btn, input);
}
