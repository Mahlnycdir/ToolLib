// Kobra als Werkzeug in Toollib (0.22.0, entschieden 12.11.: eine Ansicht im Rahmen statt einer eigenen Seite).
// Die Wurzel entsteht einmal (kobra/js/markup.js) und bleibt bestehen: Wechselst du zu einem anderen Werkzeug,
// wird sie nur aus der Arbeitsfläche genommen, Dateien, Reiter, Konsole und ein laufendes Programm bleiben.
// Kobras Daten bleiben, wo sie waren (Speicher „kobra“, Einstellungen kobra.*).
import { buildRoot } from '../../kobra/js/markup.js';

let root = null;
let kobra = null;   // das Modul kobra/js/app.js, sobald geladen

export function renderKobra(main) {
  main.dataset.view = 'kobra';
  const app = main.closest('.app') || document.body;
  app.dataset.kobra = '1';
  if (!document.getElementById('kobra-css')) {
    document.head.append(Object.assign(document.createElement('link'), { id: 'kobra-css', rel: 'stylesheet', href: 'kobra/styles.css' }));
  }
  if (!root) root = buildRoot();
  main.append(root);
  const layer = document.querySelector('.kobra-layer');
  if (layer) layer.hidden = false;
  let gone = false;
  (kobra ? Promise.resolve(kobra) : import('../../kobra/js/app.js').then((m) => { kobra = m; return m; }))
    .then(async (m) => { await m.mountKobra(root); if (!gone) m.setActive(true); })
    .catch((e) => console.error('Kobra:', e));
  main.cleanup = () => {
    gone = true;
    delete app.dataset.kobra;
    kobra?.setActive(false);
    // Fenster und Dialoge gehören zu Kobra: ausblenden, solange ein anderes Werkzeug zu sehen ist
    if (layer) layer.hidden = true;
  };
}
