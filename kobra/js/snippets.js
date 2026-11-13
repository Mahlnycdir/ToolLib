// Fertige Bausteine. ${name} = Platzhalter (mit Tab/→ weiter), \t = eine Einrueckungsebene.
import { t as tr, getLang } from '../../app/i18n/i18n.js';
// 0.24.0: Texte in Toollibs Sprache; gebaut beim ersten Gebrauch und nach einem Sprachwechsel neu (snippetGroups()).
const buildGroups = () => [
  {
    title: tr('kobra.blocks.g.flow'),
    items: [
      { key: 'if', label: 'if', detail: tr('kobra.blocks.if.d'), body: 'if ${bedingung}:\n\t${pass}' },
      { key: 'ifelse', label: 'if … else', detail: tr('kobra.blocks.ifelse.d'), body: 'if ${bedingung}:\n\t${pass}\nelse:\n\t${pass}' },
      { key: 'ifelif', label: 'if … elif … else', detail: tr('kobra.blocks.ifelif.d'), body: 'if ${bedingung}:\n\t${pass}\nelif ${andere}:\n\t${pass}\nelse:\n\t${pass}' },
      { key: 'forrange', label: 'for … range', detail: tr('kobra.blocks.forrange.d'), body: 'for ${i} in range(${10}):\n\t${print(i)}' },
      { key: 'forin', label: 'for … in', detail: tr('kobra.blocks.forin.d'), body: 'for ${element} in ${liste}:\n\t${print(element)}' },
      { key: 'forenum', label: 'for … enumerate', detail: tr('kobra.blocks.forenum.d'), body: 'for ${i}, ${element} in enumerate(${liste}):\n\t${print(i, element)}' },
      { key: 'forzip', label: 'for … zip', detail: tr('kobra.blocks.forzip.d'), body: 'for ${a}, ${b} in zip(${liste1}, ${liste2}):\n\t${print(a, b)}' },
      { key: 'fordict', label: 'for … items', detail: tr('kobra.blocks.fordict.d'), body: 'for ${schluessel}, ${wert} in ${daten}.items():\n\t${print(schluessel, wert)}' },
      { key: 'while', label: 'while', detail: tr('kobra.blocks.while.d'), body: 'while ${bedingung}:\n\t${pass}' },
      { key: 'whiletrue', label: 'while True … break', detail: tr('kobra.blocks.whiletrue.d'), body: 'while True:\n\t${eingabe} = input("${> }")\n\tif ${eingabe} == "${q}":\n\t\tbreak\n\t${pass}' },
      { key: 'match', label: 'match … case', detail: tr('kobra.blocks.match.d'), body: 'match ${wert}:\n\tcase ${1}:\n\t\t${pass}\n\tcase _:\n\t\t${pass}' },
    ],
  },
  {
    title: tr('kobra.blocks.g.functions'),
    items: [
      { key: 'def', label: 'def', detail: tr('kobra.blocks.def.d'), body: 'def ${name}(${parameter}):\n\t"""${Beschreibung}"""\n\t${return None}' },
      { key: 'deftyped', label: tr('kobra.blocks.deftyped'), detail: tr('kobra.blocks.deftyped.d'), body: 'def ${name}(${x}: ${float}) -> ${float}:\n\t${return x}' },
      { key: 'lambda', label: 'lambda', detail: tr('kobra.blocks.lambda.d'), body: 'lambda ${x}: ${x * 2}' },
      { key: 'class', label: 'class', detail: tr('kobra.blocks.class.d'), body: 'class ${Name}:\n\tdef __init__(self, ${wert}):\n\t\tself.${wert} = ${wert}\n\n\tdef __repr__(self):\n\t\treturn f"${Name}({self.${wert}!r})"' },
      { key: 'dataclass', label: '@dataclass', detail: tr('kobra.blocks.dataclass.d'), body: 'from dataclasses import dataclass\n\n\n@dataclass\nclass ${Punkt}:\n\t${x}: float = 0.0\n\t${y}: float = 0.0' },
      { key: 'subclass', label: tr('kobra.blocks.subclass'), detail: tr('kobra.blocks.subclass.d'), body: 'class ${Kind}(${Eltern}):\n\tdef __init__(self, *args, **kwargs):\n\t\tsuper().__init__(*args, **kwargs)\n\t\t${pass}' },
      { key: 'property', label: '@property', detail: tr('kobra.blocks.property.d'), body: '@property\ndef ${name}(self):\n\treturn self._${name}\n\n@${name}.setter\ndef ${name}(self, wert):\n\tself._${name} = wert' },
      { key: 'main', label: 'if __name__ == "__main__"', detail: tr('kobra.blocks.main.d'), body: 'def main():\n\t${pass}\n\n\nif __name__ == "__main__":\n\tmain()' },
    ],
  },
  {
    title: tr('kobra.blocks.g.errors'),
    items: [
      { key: 'try', label: 'try … except', detail: tr('kobra.blocks.try.d'), body: 'try:\n\t${pass}\nexcept ${ValueError} as e:\n\tprint("Fehler:", e)' },
      { key: 'tryfinally', label: 'try … except … finally', detail: tr('kobra.blocks.tryfinally.d'), body: 'try:\n\t${pass}\nexcept ${Exception} as e:\n\tprint("Fehler:", e)\nfinally:\n\t${pass}' },
      { key: 'raise', label: 'raise', detail: tr('kobra.blocks.raise.d'), body: 'raise ${ValueError}("${Nachricht}")' },
      { key: 'readfile', label: tr('kobra.blocks.readfile'), detail: 'with open … "r"', body: 'with open("${daten.txt}", encoding="utf-8") as f:\n\t${inhalt} = f.read()' },
      { key: 'readlines', label: tr('kobra.blocks.readlines'), detail: tr('kobra.blocks.readlines.d'), body: 'with open("${daten.txt}", encoding="utf-8") as f:\n\tfor zeile in f:\n\t\t${print(zeile.strip())}' },
      { key: 'writefile', label: tr('kobra.blocks.writefile'), detail: 'with open … "w"', body: 'with open("${ausgabe.txt}", "w", encoding="utf-8") as f:\n\tf.write(${text})' },
      { key: 'csvread', label: tr('kobra.blocks.csvread'), detail: 'csv.DictReader', body: 'import csv\n\nwith open("${daten.csv}", newline="", encoding="utf-8") as f:\n\tfor zeile in csv.DictReader(f):\n\t\t${print(zeile)}' },
      { key: 'jsonrw', label: tr('kobra.blocks.jsonrw'), detail: 'json.load / dump', body: 'import json\n\nwith open("${daten.json}", encoding="utf-8") as f:\n\t${daten} = json.load(f)\n\nwith open("${daten.json}", "w", encoding="utf-8") as f:\n\tjson.dump(${daten}, f, indent=2, ensure_ascii=False)' },
    ],
  },
  {
    title: tr('kobra.blocks.g.data'),
    items: [
      { key: 'listcomp', label: tr('kobra.blocks.listcomp'), detail: '[… for … in …]', body: '[${x * 2} for ${x} in ${werte}]' },
      { key: 'listcompif', label: tr('kobra.blocks.listcompif'), detail: tr('kobra.blocks.listcompif.d'), body: '[${x} for ${x} in ${werte} if ${x > 0}]' },
      { key: 'dictcomp', label: tr('kobra.blocks.dictcomp'), detail: '{k: v for …}', body: '{${k}: ${v} for ${k}, ${v} in ${paare}}' },
      { key: 'sorted', label: tr('kobra.blocks.sorted'), detail: 'sorted(…, key=…)', body: 'sorted(${liste}, key=lambda ${x}: ${x[1]}, reverse=${False})' },
      { key: 'fstring', label: 'f-String', detail: tr('kobra.blocks.fstring.d'), body: 'print(f"${Wert}: {${wert}:.${2}f}")' },
      { key: 'inputint', label: tr('kobra.blocks.inputint'), detail: 'int(input(…))', body: '${zahl} = int(input("${Zahl eingeben: }"))' },
      { key: 'counter', label: tr('kobra.blocks.counter'), detail: 'collections.Counter', body: 'from collections import Counter\n\n${zaehler} = Counter(${elemente})\nprint(${zaehler}.most_common(${3}))' },
    ],
  },
  {
    title: tr('kobra.blocks.g.gui'),
    items: [
      { key: 'tkapp', label: tr('kobra.blocks.tkapp'), detail: tr('kobra.blocks.tkapp.d'), body: 'import tkinter as tk\nfrom tkinter import ttk\n\nroot = tk.Tk()\nroot.title("${Mein Fenster}")\nroot.geometry("${320x240}")\n\nttk.Label(root, text="${Hallo!}").pack(pady=10)\nttk.Button(root, text="${Klick mich}", command=lambda: print("Klick")).pack()\n\nroot.mainloop()' },
      { key: 'tkclass', label: tr('kobra.blocks.tkclass'), detail: tr('kobra.blocks.tkclass.d'), body: 'import tkinter as tk\nfrom tkinter import ttk\n\n\nclass ${App}(tk.Tk):\n\tdef __init__(self):\n\t\tsuper().__init__()\n\t\tself.title("${App}")\n\t\tself.text = tk.StringVar(value="${Start}")\n\t\tttk.Entry(self, textvariable=self.text).pack(padx=10, pady=10, fill="x")\n\t\tttk.Button(self, text="OK", command=self.ok).pack(pady=(0, 10))\n\n\tdef ok(self):\n\t\tprint(self.text.get())\n\n\nif __name__ == "__main__":\n\t${App}().mainloop()' },
      { key: 'tkgrid', label: tr('kobra.blocks.tkgrid'), detail: tr('kobra.blocks.tkgrid.d'), body: 'for zeile, beschriftung in enumerate(["${Name}", "${Alter}"]):\n\tttk.Label(${root}, text=beschriftung).grid(row=zeile, column=0, sticky="w", padx=6, pady=4)\n\tttk.Entry(${root}).grid(row=zeile, column=1, sticky="ew", padx=6, pady=4)\n${root}.columnconfigure(1, weight=1)' },
      { key: 'tkcanvas', label: tr('kobra.blocks.tkcanvas'), detail: tr('kobra.blocks.tkcanvas.d'), body: 'import tkinter as tk\n\nroot = tk.Tk()\ncanvas = tk.Canvas(root, width=${300}, height=${200}, bg="white")\ncanvas.pack()\nball = canvas.create_oval(10, 10, 40, 40, fill="${tomato}")\ndx, dy = 3, 2\n\n\ndef schritt():\n\tglobal dx, dy\n\tx1, y1, x2, y2 = canvas.coords(ball)\n\tif x1 + dx < 0 or x2 + dx > ${300}:\n\t\tdx = -dx\n\tif y1 + dy < 0 or y2 + dy > ${200}:\n\t\tdy = -dy\n\tcanvas.move(ball, dx, dy)\n\troot.after(16, schritt)\n\n\nschritt()\nroot.mainloop()' },
      { key: 'tkmsg', label: 'messagebox', detail: tr('kobra.blocks.tkmsg.d'), body: 'from tkinter import messagebox\n\nif messagebox.askyesno("${Frage}", "${Wirklich fortfahren?}"):\n\t${pass}' },
      { key: 'qtapp', label: tr('kobra.blocks.qtapp'), detail: tr('kobra.blocks.qtapp.d'), body: 'import sys\nfrom PyQt5.QtWidgets import QApplication, QWidget, QVBoxLayout, QLabel, QPushButton\n\n\nclass ${Fenster}(QWidget):\n\tdef __init__(self):\n\t\tsuper().__init__()\n\t\tself.setWindowTitle("${Mein Fenster}")\n\t\tself.label = QLabel("${Hallo!}")\n\t\tknopf = QPushButton("${Klick mich}")\n\t\tknopf.clicked.connect(self.geklickt)\n\t\tlayout = QVBoxLayout(self)\n\t\tlayout.addWidget(self.label)\n\t\tlayout.addWidget(knopf)\n\n\tdef geklickt(self):\n\t\tself.label.setText("${Geklickt!}")\n\n\nif __name__ == "__main__":\n\tapp = QApplication(sys.argv)\n\tw = ${Fenster}()\n\tw.show()\n\tsys.exit(app.exec())' },
      { key: 'qtpaint', label: tr('kobra.blocks.qtpaint'), detail: 'paintEvent + QPainter', body: 'from PyQt5.QtWidgets import QWidget\nfrom PyQt5.QtGui import QPainter, QColor, QPen\n\n\nclass ${Leinwand}(QWidget):\n\tdef paintEvent(self, event):\n\t\tp = QPainter(self)\n\t\tp.setPen(QPen(QColor("${steelblue}"), 3))\n\t\tp.drawEllipse(20, 20, self.width() - 40, self.height() - 40)\n\t\tp.end()' },
    ],
  },
  {
    title: tr('kobra.blocks.g.science'),
    items: [
      { key: 'np', label: tr('kobra.blocks.np'), detail: tr('kobra.blocks.np.d'), body: 'import numpy as np\n\n${x} = np.linspace(${0}, ${2 * np.pi}, ${200})\n${y} = np.sin(${x})' },
      { key: 'plot', label: tr('kobra.blocks.plot'), detail: 'matplotlib', body: 'import matplotlib.pyplot as plt\n\nplt.plot(${x}, ${y}, label="${Messung}")\nplt.xlabel("${x}")\nplt.ylabel("${y}")\nplt.legend()\nplt.grid(True)\nplt.show()' },
      { key: 'subplots', label: tr('kobra.blocks.subplots'), detail: 'plt.subplots', body: 'import matplotlib.pyplot as plt\n\nfig, (${ax1}, ${ax2}) = plt.subplots(${2}, 1, figsize=(6, 6))\n${ax1}.plot(${x}, ${y})\n${ax2}.hist(${daten}, bins=${30})\nfig.tight_layout()\nplt.show()' },
      { key: 'ode', label: tr('kobra.blocks.ode'), detail: 'scipy solve_ivp', body: 'import numpy as np\nfrom scipy.integrate import solve_ivp\n\n\ndef rhs(t, y):\n\treturn [y[1], -${omega}**2 * y[0]]\n\n\nt = np.linspace(0, ${10}, ${500})\nloesung = solve_ivp(rhs, (t[0], t[-1]), [${1.0}, ${0.0}], t_eval=t)\nprint(loesung.y[0][-1])' },
      { key: 'fit', label: tr('kobra.blocks.fit'), detail: 'scipy curve_fit', body: 'import numpy as np\nfrom scipy.optimize import curve_fit\n\n\ndef modell(x, a, b):\n\treturn a * np.exp(-b * x)\n\n\nparameter, kovarianz = curve_fit(modell, ${xdaten}, ${ydaten}, p0=(${1}, ${0.1}))\nfehler = np.sqrt(np.diag(kovarianz))\nprint("a, b =", parameter, "±", fehler)' },
      { key: 'sympy', label: tr('kobra.blocks.sympy'), detail: 'sympy', body: 'import sympy as sp\n\n${x} = sp.symbols("${x}")\n${ausdruck} = ${sp.sin(x) * sp.exp(-x)}\nprint(sp.diff(${ausdruck}, ${x}))\nprint(sp.integrate(${ausdruck}, (${x}, 0, sp.oo)))' },
      { key: 'random', label: tr('kobra.blocks.random'), detail: 'numpy.random', body: 'import numpy as np\n\nrng = np.random.default_rng(${42})\n${werte} = rng.normal(${0}, ${1}, size=${1000})\nprint(${werte}.mean(), ${werte}.std())' },
    ],
  },
  {
    title: tr('kobra.blocks.g.imports'),
    items: [
      { key: 'imp_np', label: 'import numpy as np', detail: '', body: 'import numpy as np' },
      { key: 'imp_plt', label: 'import matplotlib.pyplot as plt', detail: '', body: 'import matplotlib.pyplot as plt' },
      { key: 'imp_tk', label: 'import tkinter as tk', detail: '', body: 'import tkinter as tk\nfrom tkinter import ttk, messagebox' },
      { key: 'imp_qt', label: tr('kobra.blocks.imp_qt'), detail: '', body: 'from PyQt5.QtWidgets import *\nfrom PyQt5.QtCore import Qt, QTimer\nfrom PyQt5.QtGui import QFont, QColor' },
      { key: 'imp_math', label: 'import math, random', detail: '', body: 'import math\nimport random' },
      { key: 'imp_pd', label: 'import pandas as pd', detail: '', body: 'import pandas as pd' },
      { key: 'imp_path', label: 'from pathlib import Path', detail: '', body: 'from pathlib import Path' },
    ],
  },
];

// Die Bausteine sind deutsch geschrieben; auf Englisch bekommen Platzhalter und Texte im Code englische Namen.
const EN_PHRASES = [
  ['Zahl eingeben: ', 'Enter a number: '], ['Wirklich fortfahren?', 'Really continue?'], ['Mein Fenster', 'My window'],
  ['Klick mich', 'Click me'], ['Hallo!', 'Hello!'], ['Geklickt!', 'Clicked!'], ['Fehler:', 'Error:'],
];
const EN_WORDS = {
  Alter: 'Age', Beschreibung: 'What it does', Eltern: 'Parent', Fenster: 'Window', Frage: 'Question', Kind: 'Child',
  Klick: 'Click', Leinwand: 'Drawing', Messung: 'Measurement', Nachricht: 'message', Punkt: 'Point', Wert: 'Value',
  andere: 'other', ausdruck: 'expr', ausgabe: 'output', bedingung: 'condition', beschriftung: 'caption', daten: 'data',
  eingabe: 'answer', element: 'item', elemente: 'items', fehler: 'errors', geklickt: 'on_click', inhalt: 'content',
  knopf: 'button', kovarianz: 'covariance', liste: 'items', liste1: 'items1', liste2: 'items2', loesung: 'solution',
  modell: 'model', paare: 'pairs', parameter: 'params', schluessel: 'key', schritt: 'step', wert: 'value',
  werte: 'values', xdaten: 'xdata', ydaten: 'ydata', zaehler: 'counter', zahl: 'number', zeile: 'line',
};
const EN_RE = new RegExp(`\\b(${Object.keys(EN_WORDS).join('|')})\\b`, 'g');
export const toEnglish = (body) => EN_PHRASES.reduce((b, [de, en]) => b.split(de).join(en), body).replace(EN_RE, (w) => EN_WORDS[w]);

let built = { lang: null, groups: [], all: {} };
export function snippetGroups() {
  const lang = getLang();
  if (built.lang !== lang) {
    const groups = buildGroups();
    if (lang !== 'de') for (const g of groups) for (const it of g.items) it.body = toEnglish(it.body);
    built = { lang, groups, all: Object.fromEntries(groups.flatMap(g => g.items.map(i => [i.key, i]))) };
  }
  return built.groups;
}
export const allSnippets = () => { snippetGroups(); return built.all; };

// Fuer die Vervollstaendigung: Schluesselwort -> Bausteine
export const KEYWORD_SNIPPETS = {
  if: ['if', 'ifelse', 'ifelif'],
  for: ['forrange', 'forin', 'forenum', 'forzip', 'fordict'],
  while: ['while', 'whiletrue'],
  def: ['def', 'deftyped'],
  class: ['class', 'subclass', 'dataclass'],
  try: ['try', 'tryfinally'],
  with: ['readfile', 'writefile'],
  match: ['match'],
  main: ['main'],
  lambda: ['lambda'],
  open: ['readfile', 'writefile'],
  tk: ['tkapp', 'tkclass'],
  qt: ['qtapp'],
  plot: ['plot', 'subplots'],
};


// Python-Schluesselwoerter und eingebaute Namen fuer die Offline-Vervollstaendigung
export const PY_KEYWORDS = ['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
  'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda',
  'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'match', 'case'];
export const PY_BUILTINS = ['abs', 'all', 'any', 'bin', 'bool', 'bytes', 'callable', 'chr', 'dict', 'dir', 'divmod',
  'enumerate', 'eval', 'exec', 'filter', 'float', 'format', 'frozenset', 'getattr', 'globals', 'hasattr', 'hash', 'help',
  'hex', 'id', 'input', 'int', 'isinstance', 'issubclass', 'iter', 'len', 'list', 'locals', 'map', 'max', 'min', 'next',
  'object', 'oct', 'open', 'ord', 'pow', 'print', 'range', 'repr', 'reversed', 'round', 'set', 'setattr', 'slice',
  'sorted', 'str', 'sum', 'super', 'tuple', 'type', 'vars', 'zip', 'Exception', 'ValueError', 'TypeError', 'KeyError',
  'IndexError', 'ZeroDivisionError', 'FileNotFoundError', 'RuntimeError', 'StopIteration', 'self'];
