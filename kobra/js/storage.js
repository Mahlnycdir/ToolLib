// Dateisystem auf dem Geraet (IndexedDB via LightningFS) und Projektverwaltung.
import { LightningFS, JSZip } from '../vendor/vendor.js';

export const fs = new LightningFS('kobra');
export const pfs = fs.promises;
export const ROOT = '/projects';

const enc = new TextEncoder();
const dec = new TextDecoder();

export const join = (...p) => p.filter(Boolean).join('/').replace(/\/+/g, '/');
export const dirname = (p) => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
export const basename = (p) => p.slice(p.lastIndexOf('/') + 1);
export const projectPath = (name) => `${ROOT}/${name}`;

// LightningFS speichert das Inhaltsverzeichnis verzoegert. Nach jeder Aenderung
// sofort sichern, damit beim Schliessen der App nichts verloren geht.
let flushing = null;
let flushAgain = false;
export function flush() {
  if (flushing) { flushAgain = true; return flushing; }
  flushing = (async () => {
    do {
      flushAgain = false;
      try { await pfs.flush(); } catch (e) { /* naechster Versuch */ }
    } while (flushAgain);
    flushing = null;
  })();
  return flushing;
}

export async function exists(p) {
  try { await pfs.stat(p); return true; } catch (e) { return false; }
}

export async function mkdirp(p) {
  const parts = p.split('/').filter(Boolean);
  let cur = '';
  for (const part of parts) {
    cur += '/' + part;
    try { await pfs.mkdir(cur); } catch (e) { if (e.code !== 'EEXIST') { if (!(await exists(cur))) throw e; } }
  }
}

export async function readText(p) {
  const data = await pfs.readFile(p);
  return typeof data === 'string' ? data : dec.decode(data);
}

export async function readBytes(p) {
  const data = await pfs.readFile(p);
  return typeof data === 'string' ? enc.encode(data) : data;
}

export async function writeFile(p, data, { noFlush = false } = {}) {
  await mkdirp(dirname(p));
  await pfs.writeFile(p, typeof data === 'string' ? enc.encode(data) : data, { mode: 0o644 });
  if (!noFlush) await flush();
}

export async function rmrf(p) {
  await rmrfInner(p);
  await flush();
}

async function rmrfInner(p) {
  let st;
  try { st = await pfs.stat(p); } catch (e) { return; }
  if (st.isDirectory()) {
    for (const name of await pfs.readdir(p)) await rmrfInner(`${p}/${name}`);
    await pfs.rmdir(p);
  } else {
    await pfs.unlink(p);
  }
}

export async function copyTree(src, dst, { skipGit = false, top = true } = {}) {
  const st = await pfs.stat(src);
  if (st.isDirectory()) {
    await mkdirp(dst);
    for (const name of await pfs.readdir(src)) {
      if (skipGit && name === '.git') continue;
      await copyTree(`${src}/${name}`, `${dst}/${name}`, { skipGit, top: false });
    }
  } else {
    await writeFile(dst, await readBytes(src), { noFlush: true });
  }
  if (top) await flush();
}

export async function move(src, dst) {
  await mkdirp(dirname(dst));
  try {
    await pfs.rename(src, dst);
  } catch (e) {
    await copyTree(src, dst);
    await rmrfInner(src);
  }
  await flush();
}

// Alle Dateien eines Projekts (ohne .git), relativ zum Projektordner
export async function listTree(dir, { includeGit = false } = {}) {
  const out = [];
  async function walk(rel) {
    const full = rel ? `${dir}/${rel}` : dir;
    let names;
    try { names = await pfs.readdir(full); } catch (e) { return; }
    names.sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));
    for (const name of names) {
      if (!includeGit && name === '.git') continue;
      const r = rel ? `${rel}/${name}` : name;
      const st = await pfs.stat(`${dir}/${r}`);
      if (st.isDirectory()) {
        out.push({ path: r, type: 'dir' });
        await walk(r);
      } else {
        out.push({ path: r, type: 'file', size: st.size, mtime: st.mtimeMs });
      }
    }
  }
  await walk('');
  return out;
}

// ----------------------------------------------------------------- Projekte
export async function listProjects() {
  await mkdirp(ROOT);
  const names = await pfs.readdir(ROOT);
  const res = [];
  for (const name of names) {
    try {
      const st = await pfs.stat(`${ROOT}/${name}`);
      if (st.isDirectory()) res.push({ name, mtime: st.mtimeMs, git: await exists(`${ROOT}/${name}/.git`) });
    } catch (e) { /* weiter */ }
  }
  res.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  return res;
}

export const validName = (name) => {
  if (!name || !name.trim()) return 'Bitte einen Namen eingeben.';
  if (/[\\:*?"<>|]/.test(name)) return 'Diese Zeichen sind nicht erlaubt: \\ : * ? " < > |';
  if (name.startsWith('.') && name !== '.gitignore' && name !== '.env') return 'Der Name darf nicht mit einem Punkt beginnen.';
  return null;
};

export const TEMPLATES = {
  leer: { label: 'Leeres Projekt', files: { 'main.py': '' } },
  hallo: {
    label: 'Hallo Welt',
    files: {
      'main.py': `"""Mein erstes Programm."""\n\n\ndef begruessung(name: str) -> str:\n    return f"Hallo, {name}!"\n\n\nif __name__ == "__main__":\n    name = input("Wie heißt du? ")\n    print(begruessung(name))\n`,
    },
  },
  tkinter: {
    label: 'tkinter-App',
    files: {
      'main.py': `import tkinter as tk\nfrom tkinter import ttk, messagebox\n\n\nclass App(tk.Tk):\n    def __init__(self):\n        super().__init__()\n        self.title("Zähler")\n        self.geometry("320x200")\n        self.anzahl = tk.IntVar(value=0)\n\n        ttk.Label(self, text="Klicks:", font=("Helvetica", 14)).pack(pady=(20, 4))\n        ttk.Label(self, textvariable=self.anzahl, font=("Helvetica", 32, "bold")).pack()\n\n        leiste = ttk.Frame(self)\n        leiste.pack(pady=16)\n        ttk.Button(leiste, text="+1", command=self.plus).pack(side="left", padx=6)\n        ttk.Button(leiste, text="Zurücksetzen", command=self.reset).pack(side="left", padx=6)\n\n    def plus(self):\n        self.anzahl.set(self.anzahl.get() + 1)\n\n    def reset(self):\n        if messagebox.askyesno("Zurücksetzen", "Zähler wirklich auf 0 setzen?"):\n            self.anzahl.set(0)\n\n\nif __name__ == "__main__":\n    App().mainloop()\n`,
    },
  },
  pyqt: {
    label: 'PyQt-App',
    files: {
      'main.py': `import sys\nfrom PyQt5.QtWidgets import (QApplication, QWidget, QVBoxLayout, QHBoxLayout,\n                             QLabel, QLineEdit, QPushButton, QListWidget)\n\n\nclass Fenster(QWidget):\n    def __init__(self):\n        super().__init__()\n        self.setWindowTitle("Aufgaben")\n        self.resize(340, 380)\n        self.eingabe = QLineEdit(placeholderText="Neue Aufgabe …")\n        self.eingabe.returnPressed.connect(self.hinzufuegen)\n        knopf = QPushButton("Hinzufügen", clicked=self.hinzufuegen)\n        self.liste = QListWidget()\n        self.liste.itemDoubleClicked.connect(lambda it: self.liste.takeItem(self.liste.row(it)))\n        zeile = QHBoxLayout()\n        zeile.addWidget(self.eingabe)\n        zeile.addWidget(knopf)\n        layout = QVBoxLayout(self)\n        layout.addLayout(zeile)\n        layout.addWidget(self.liste)\n        layout.addWidget(QLabel("Doppeltippen entfernt eine Aufgabe."))\n\n    def hinzufuegen(self):\n        text = self.eingabe.text().strip()\n        if text:\n            self.liste.addItem(text)\n            self.eingabe.clear()\n\n\nif __name__ == "__main__":\n    app = QApplication(sys.argv)\n    fenster = Fenster()\n    fenster.show()\n    sys.exit(app.exec())\n`,
    },
  },
  wissenschaft: {
    label: 'Wissenschaft (numpy + matplotlib)',
    files: {
      'main.py': `"""Gedämpfter harmonischer Oszillator: x'' + 2γx' + ω²x = 0"""\nimport numpy as np\nimport matplotlib.pyplot as plt\nfrom scipy.integrate import solve_ivp\n\nomega, gamma = 2.0, 0.15\n\n\ndef rhs(t, y):\n    x, v = y\n    return [v, -2 * gamma * v - omega**2 * x]\n\n\nt = np.linspace(0, 20, 800)\nloesung = solve_ivp(rhs, (t[0], t[-1]), [1.0, 0.0], t_eval=t)\n\nfig, (ax1, ax2) = plt.subplots(2, 1, figsize=(6, 6))\nax1.plot(loesung.t, loesung.y[0], label="x(t)")\nax1.plot(t, np.exp(-gamma * t), "--", label="Einhüllende")\nax1.set_xlabel("t")\nax1.legend()\nax2.plot(loesung.y[0], loesung.y[1], color="tab:orange")\nax2.set_xlabel("x")\nax2.set_ylabel("v")\nax2.set_title("Phasenraum")\nfig.tight_layout()\nplt.show()\n`,
      'README.md': '# Oszillator\n\nLöst die Bewegungsgleichung numerisch und zeichnet Zeitverlauf und Phasenraum.\n',
    },
  },
  module: {
    label: 'Mehrere Module',
    files: {
      'main.py': `from geometrie.formen import Kreis, Rechteck\nfrom hilfen import tabelle\n\nformen = [Kreis(1.5), Rechteck(2, 3), Kreis(0.5)]\nprint(tabelle(formen))\n`,
      'hilfen.py': `def tabelle(formen):\n    zeilen = [f"{'Form':<12}{'Fläche':>10}"]\n    for f in formen:\n        zeilen.append(f"{f.name:<12}{f.flaeche():>10.2f}")\n    return "\\n".join(zeilen)\n`,
      'geometrie/__init__.py': '',
      'geometrie/formen.py': `import math\nfrom dataclasses import dataclass\n\n\n@dataclass\nclass Kreis:\n    r: float\n    name: str = "Kreis"\n\n    def flaeche(self) -> float:\n        return math.pi * self.r ** 2\n\n\n@dataclass\nclass Rechteck:\n    a: float\n    b: float\n    name: str = "Rechteck"\n\n    def flaeche(self) -> float:\n        return self.a * self.b\n`,
    },
  },
};

const GITIGNORE = '__pycache__/\n*.pyc\n.DS_Store\n';

export async function createProject(name, template = 'hallo') {
  const dir = projectPath(name);
  if (await exists(dir)) throw new Error('Ein Projekt mit diesem Namen gibt es schon.');
  await mkdirp(dir);
  const t = TEMPLATES[template] || TEMPLATES.leer;
  for (const [p, content] of Object.entries(t.files)) await writeFile(`${dir}/${p}`, content, { noFlush: true });
  await writeFile(`${dir}/.gitignore`, GITIGNORE);
  return dir;
}

export async function deleteProject(name) {
  await rmrf(projectPath(name));
}

export async function renameProject(oldName, newName) {
  const dst = projectPath(newName);
  if (await exists(dst)) throw new Error('Ein Projekt mit diesem Namen gibt es schon.');
  await move(projectPath(oldName), dst);
}

export async function duplicateProject(name, newName) {
  const dst = projectPath(newName);
  if (await exists(dst)) throw new Error('Ein Projekt mit diesem Namen gibt es schon.');
  await copyTree(projectPath(name), dst, { skipGit: true });
}

export async function exportZip(name) {
  const dir = projectPath(name);
  const zip = new JSZip();
  const root = zip.folder(name);
  for (const f of await listTree(dir)) {
    if (f.type === 'dir') root.folder(f.path);
    else root.file(f.path, await readBytes(`${dir}/${f.path}`));
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function importZip(file, nameHint) {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter(e => !e.dir && !e.name.startsWith('__MACOSX/') && !e.name.endsWith('.DS_Store'));
  if (!entries.length) throw new Error('Das ZIP-Archiv ist leer.');
  // gemeinsamen Oberordner entfernen
  const first = entries[0].name.split('/');
  let prefix = '';
  if (first.length > 1 && entries.every(e => e.name.startsWith(first[0] + '/'))) prefix = first[0] + '/';
  let base = (prefix ? prefix.slice(0, -1) : nameHint || 'Import').replace(/[\\:*?"<>|]/g, '_');
  let name = base;
  for (let i = 2; await exists(projectPath(name)); i++) name = `${base} ${i}`;
  const dir = projectPath(name);
  await mkdirp(dir);
  for (const e of entries) {
    const rel = e.name.slice(prefix.length);
    if (!rel || rel.includes('..')) continue;
    await writeFile(`${dir}/${rel}`, await e.async('uint8array'), { noFlush: true });
  }
  await flush();
  return name;
}

export async function storageInfo() {
  const info = { persisted: false, usage: 0, quota: 0 };
  try {
    if (navigator.storage?.persisted) info.persisted = await navigator.storage.persisted();
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      info.usage = e.usage || 0;
      info.quota = e.quota || 0;
    }
  } catch (e) { /* egal */ }
  return info;
}

export async function requestPersist() {
  try { return await navigator.storage?.persist?.(); } catch (e) { return false; }
}

const TEXT_EXT = /\.(py|pyw|pyi|txt|md|markdown|json|csv|tsv|ini|cfg|toml|yaml|yml|xml|html|htm|css|js|ts|sh|bat|gitignore|env|rst|tex|bib|log|sql|dat|r|c|h|cpp|java|svg)$/i;
export const isTextFile = (path) => TEXT_EXT.test(path) || !/\.[a-z0-9]+$/i.test(basename(path));
export const isImageFile = (path) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(path);
