// Fertige Bausteine. ${name} = Platzhalter (mit Tab/→ weiter), \t = eine Einrueckungsebene.
export const SNIPPET_GROUPS = [
  {
    title: 'Ablauf',
    items: [
      { key: 'if', label: 'if', detail: 'Bedingung', body: 'if ${bedingung}:\n\t${pass}' },
      { key: 'ifelse', label: 'if … else', detail: 'Entweder–oder', body: 'if ${bedingung}:\n\t${pass}\nelse:\n\t${pass}' },
      { key: 'ifelif', label: 'if … elif … else', detail: 'Mehrere Fälle', body: 'if ${bedingung}:\n\t${pass}\nelif ${andere}:\n\t${pass}\nelse:\n\t${pass}' },
      { key: 'forrange', label: 'for … range', detail: 'Zählschleife', body: 'for ${i} in range(${10}):\n\t${print(i)}' },
      { key: 'forin', label: 'for … in', detail: 'Über Elemente', body: 'for ${element} in ${liste}:\n\t${print(element)}' },
      { key: 'forenum', label: 'for … enumerate', detail: 'Mit Index', body: 'for ${i}, ${element} in enumerate(${liste}):\n\t${print(i, element)}' },
      { key: 'forzip', label: 'for … zip', detail: 'Parallel', body: 'for ${a}, ${b} in zip(${liste1}, ${liste2}):\n\t${print(a, b)}' },
      { key: 'fordict', label: 'for … items', detail: 'Über ein Dictionary', body: 'for ${schluessel}, ${wert} in ${daten}.items():\n\t${print(schluessel, wert)}' },
      { key: 'while', label: 'while', detail: 'Solange-Schleife', body: 'while ${bedingung}:\n\t${pass}' },
      { key: 'whiletrue', label: 'while True … break', detail: 'Endlosschleife mit Ausstieg', body: 'while True:\n\t${eingabe} = input("${> }")\n\tif ${eingabe} == "${q}":\n\t\tbreak\n\t${pass}' },
      { key: 'match', label: 'match … case', detail: 'Mustervergleich', body: 'match ${wert}:\n\tcase ${1}:\n\t\t${pass}\n\tcase _:\n\t\t${pass}' },
    ],
  },
  {
    title: 'Funktionen & Klassen',
    items: [
      { key: 'def', label: 'def', detail: 'Funktion', body: 'def ${name}(${parameter}):\n\t"""${Beschreibung}"""\n\t${return None}' },
      { key: 'deftyped', label: 'def mit Typen', detail: 'Mit Typangaben', body: 'def ${name}(${x}: ${float}) -> ${float}:\n\t${return x}' },
      { key: 'lambda', label: 'lambda', detail: 'Kurzfunktion', body: 'lambda ${x}: ${x * 2}' },
      { key: 'class', label: 'class', detail: 'Klasse', body: 'class ${Name}:\n\tdef __init__(self, ${wert}):\n\t\tself.${wert} = ${wert}\n\n\tdef __repr__(self):\n\t\treturn f"${Name}({self.${wert}!r})"' },
      { key: 'dataclass', label: '@dataclass', detail: 'Datenklasse', body: 'from dataclasses import dataclass\n\n\n@dataclass\nclass ${Punkt}:\n\t${x}: float = 0.0\n\t${y}: float = 0.0' },
      { key: 'subclass', label: 'Unterklasse', detail: 'Vererbung', body: 'class ${Kind}(${Eltern}):\n\tdef __init__(self, *args, **kwargs):\n\t\tsuper().__init__(*args, **kwargs)\n\t\t${pass}' },
      { key: 'property', label: '@property', detail: 'Eigenschaft', body: '@property\ndef ${name}(self):\n\treturn self._${name}\n\n@${name}.setter\ndef ${name}(self, wert):\n\tself._${name} = wert' },
      { key: 'main', label: 'if __name__ == "__main__"', detail: 'Startpunkt', body: 'def main():\n\t${pass}\n\n\nif __name__ == "__main__":\n\tmain()' },
    ],
  },
  {
    title: 'Fehler & Dateien',
    items: [
      { key: 'try', label: 'try … except', detail: 'Fehler abfangen', body: 'try:\n\t${pass}\nexcept ${ValueError} as e:\n\tprint("Fehler:", e)' },
      { key: 'tryfinally', label: 'try … except … finally', detail: 'Mit Aufräumen', body: 'try:\n\t${pass}\nexcept ${Exception} as e:\n\tprint("Fehler:", e)\nfinally:\n\t${pass}' },
      { key: 'raise', label: 'raise', detail: 'Fehler auslösen', body: 'raise ${ValueError}("${Nachricht}")' },
      { key: 'readfile', label: 'Datei lesen', detail: 'with open … "r"', body: 'with open("${daten.txt}", encoding="utf-8") as f:\n\t${inhalt} = f.read()' },
      { key: 'readlines', label: 'Zeilen lesen', detail: 'Zeile für Zeile', body: 'with open("${daten.txt}", encoding="utf-8") as f:\n\tfor zeile in f:\n\t\t${print(zeile.strip())}' },
      { key: 'writefile', label: 'Datei schreiben', detail: 'with open … "w"', body: 'with open("${ausgabe.txt}", "w", encoding="utf-8") as f:\n\tf.write(${text})' },
      { key: 'csvread', label: 'CSV lesen', detail: 'csv.DictReader', body: 'import csv\n\nwith open("${daten.csv}", newline="", encoding="utf-8") as f:\n\tfor zeile in csv.DictReader(f):\n\t\t${print(zeile)}' },
      { key: 'jsonrw', label: 'JSON lesen/schreiben', detail: 'json.load / dump', body: 'import json\n\nwith open("${daten.json}", encoding="utf-8") as f:\n\t${daten} = json.load(f)\n\nwith open("${daten.json}", "w", encoding="utf-8") as f:\n\tjson.dump(${daten}, f, indent=2, ensure_ascii=False)' },
    ],
  },
  {
    title: 'Daten',
    items: [
      { key: 'listcomp', label: 'Listen-Abstraktion', detail: '[… for … in …]', body: '[${x * 2} for ${x} in ${werte}]' },
      { key: 'listcompif', label: 'Listen-Abstraktion mit if', detail: 'Gefiltert', body: '[${x} for ${x} in ${werte} if ${x > 0}]' },
      { key: 'dictcomp', label: 'Dict-Abstraktion', detail: '{k: v for …}', body: '{${k}: ${v} for ${k}, ${v} in ${paare}}' },
      { key: 'sorted', label: 'sortieren mit key', detail: 'sorted(…, key=…)', body: 'sorted(${liste}, key=lambda ${x}: ${x[1]}, reverse=${False})' },
      { key: 'fstring', label: 'f-String', detail: 'Formatierte Ausgabe', body: 'print(f"${Wert}: {${wert}:.${2}f}")' },
      { key: 'inputint', label: 'Zahl einlesen', detail: 'int(input(…))', body: '${zahl} = int(input("${Zahl eingeben: }"))' },
      { key: 'counter', label: 'Zählen', detail: 'collections.Counter', body: 'from collections import Counter\n\n${zaehler} = Counter(${elemente})\nprint(${zaehler}.most_common(${3}))' },
    ],
  },
  {
    title: 'Grafische Oberflächen',
    items: [
      { key: 'tkapp', label: 'tkinter-Fenster', detail: 'Grundgerüst', body: 'import tkinter as tk\nfrom tkinter import ttk\n\nroot = tk.Tk()\nroot.title("${Mein Fenster}")\nroot.geometry("${320x240}")\n\nttk.Label(root, text="${Hallo!}").pack(pady=10)\nttk.Button(root, text="${Klick mich}", command=lambda: print("Klick")).pack()\n\nroot.mainloop()' },
      { key: 'tkclass', label: 'tkinter-App als Klasse', detail: 'Strukturiert', body: 'import tkinter as tk\nfrom tkinter import ttk\n\n\nclass ${App}(tk.Tk):\n\tdef __init__(self):\n\t\tsuper().__init__()\n\t\tself.title("${App}")\n\t\tself.text = tk.StringVar(value="${Start}")\n\t\tttk.Entry(self, textvariable=self.text).pack(padx=10, pady=10, fill="x")\n\t\tttk.Button(self, text="OK", command=self.ok).pack(pady=(0, 10))\n\n\tdef ok(self):\n\t\tprint(self.text.get())\n\n\nif __name__ == "__main__":\n\t${App}().mainloop()' },
      { key: 'tkgrid', label: 'tkinter-Formular (grid)', detail: 'Beschriftung + Feld', body: 'for zeile, beschriftung in enumerate(["${Name}", "${Alter}"]):\n\tttk.Label(${root}, text=beschriftung).grid(row=zeile, column=0, sticky="w", padx=6, pady=4)\n\tttk.Entry(${root}).grid(row=zeile, column=1, sticky="ew", padx=6, pady=4)\n${root}.columnconfigure(1, weight=1)' },
      { key: 'tkcanvas', label: 'tkinter-Animation (Canvas)', detail: 'mit after()', body: 'import tkinter as tk\n\nroot = tk.Tk()\ncanvas = tk.Canvas(root, width=${300}, height=${200}, bg="white")\ncanvas.pack()\nball = canvas.create_oval(10, 10, 40, 40, fill="${tomato}")\ndx, dy = 3, 2\n\n\ndef schritt():\n\tglobal dx, dy\n\tx1, y1, x2, y2 = canvas.coords(ball)\n\tif x1 + dx < 0 or x2 + dx > ${300}:\n\t\tdx = -dx\n\tif y1 + dy < 0 or y2 + dy > ${200}:\n\t\tdy = -dy\n\tcanvas.move(ball, dx, dy)\n\troot.after(16, schritt)\n\n\nschritt()\nroot.mainloop()' },
      { key: 'tkmsg', label: 'messagebox', detail: 'Hinweis / Frage', body: 'from tkinter import messagebox\n\nif messagebox.askyesno("${Frage}", "${Wirklich fortfahren?}"):\n\t${pass}' },
      { key: 'qtapp', label: 'PyQt-Fenster', detail: 'Grundgerüst', body: 'import sys\nfrom PyQt5.QtWidgets import QApplication, QWidget, QVBoxLayout, QLabel, QPushButton\n\n\nclass ${Fenster}(QWidget):\n\tdef __init__(self):\n\t\tsuper().__init__()\n\t\tself.setWindowTitle("${Mein Fenster}")\n\t\tself.label = QLabel("${Hallo!}")\n\t\tknopf = QPushButton("${Klick mich}")\n\t\tknopf.clicked.connect(self.geklickt)\n\t\tlayout = QVBoxLayout(self)\n\t\tlayout.addWidget(self.label)\n\t\tlayout.addWidget(knopf)\n\n\tdef geklickt(self):\n\t\tself.label.setText("${Geklickt!}")\n\n\nif __name__ == "__main__":\n\tapp = QApplication(sys.argv)\n\tw = ${Fenster}()\n\tw.show()\n\tsys.exit(app.exec())' },
      { key: 'qtpaint', label: 'PyQt-Zeichenfläche', detail: 'paintEvent + QPainter', body: 'from PyQt5.QtWidgets import QWidget\nfrom PyQt5.QtGui import QPainter, QColor, QPen\n\n\nclass ${Leinwand}(QWidget):\n\tdef paintEvent(self, event):\n\t\tp = QPainter(self)\n\t\tp.setPen(QPen(QColor("${steelblue}"), 3))\n\t\tp.drawEllipse(20, 20, self.width() - 40, self.height() - 40)\n\t\tp.end()' },
    ],
  },
  {
    title: 'Wissenschaft',
    items: [
      { key: 'np', label: 'numpy-Array', detail: 'linspace + Funktion', body: 'import numpy as np\n\n${x} = np.linspace(${0}, ${2 * np.pi}, ${200})\n${y} = np.sin(${x})' },
      { key: 'plot', label: 'Diagramm', detail: 'matplotlib', body: 'import matplotlib.pyplot as plt\n\nplt.plot(${x}, ${y}, label="${Messung}")\nplt.xlabel("${x}")\nplt.ylabel("${y}")\nplt.legend()\nplt.grid(True)\nplt.show()' },
      { key: 'subplots', label: 'Mehrere Diagramme', detail: 'plt.subplots', body: 'import matplotlib.pyplot as plt\n\nfig, (${ax1}, ${ax2}) = plt.subplots(${2}, 1, figsize=(6, 6))\n${ax1}.plot(${x}, ${y})\n${ax2}.hist(${daten}, bins=${30})\nfig.tight_layout()\nplt.show()' },
      { key: 'ode', label: 'Differentialgleichung', detail: 'scipy solve_ivp', body: 'import numpy as np\nfrom scipy.integrate import solve_ivp\n\n\ndef rhs(t, y):\n\treturn [y[1], -${omega}**2 * y[0]]\n\n\nt = np.linspace(0, ${10}, ${500})\nloesung = solve_ivp(rhs, (t[0], t[-1]), [${1.0}, ${0.0}], t_eval=t)\nprint(loesung.y[0][-1])' },
      { key: 'fit', label: 'Kurvenanpassung', detail: 'scipy curve_fit', body: 'import numpy as np\nfrom scipy.optimize import curve_fit\n\n\ndef modell(x, a, b):\n\treturn a * np.exp(-b * x)\n\n\nparameter, kovarianz = curve_fit(modell, ${xdaten}, ${ydaten}, p0=(${1}, ${0.1}))\nfehler = np.sqrt(np.diag(kovarianz))\nprint("a, b =", parameter, "±", fehler)' },
      { key: 'sympy', label: 'Symbolisch rechnen', detail: 'sympy', body: 'import sympy as sp\n\n${x} = sp.symbols("${x}")\n${ausdruck} = ${sp.sin(x) * sp.exp(-x)}\nprint(sp.diff(${ausdruck}, ${x}))\nprint(sp.integrate(${ausdruck}, (${x}, 0, sp.oo)))' },
      { key: 'random', label: 'Zufallszahlen', detail: 'numpy.random', body: 'import numpy as np\n\nrng = np.random.default_rng(${42})\n${werte} = rng.normal(${0}, ${1}, size=${1000})\nprint(${werte}.mean(), ${werte}.std())' },
    ],
  },
  {
    title: 'Importe',
    items: [
      { key: 'imp_np', label: 'import numpy as np', detail: '', body: 'import numpy as np' },
      { key: 'imp_plt', label: 'import matplotlib.pyplot as plt', detail: '', body: 'import matplotlib.pyplot as plt' },
      { key: 'imp_tk', label: 'import tkinter as tk', detail: '', body: 'import tkinter as tk\nfrom tkinter import ttk, messagebox' },
      { key: 'imp_qt', label: 'PyQt5-Widgets', detail: '', body: 'from PyQt5.QtWidgets import *\nfrom PyQt5.QtCore import Qt, QTimer\nfrom PyQt5.QtGui import QFont, QColor' },
      { key: 'imp_math', label: 'import math, random', detail: '', body: 'import math\nimport random' },
      { key: 'imp_pd', label: 'import pandas as pd', detail: '', body: 'import pandas as pd' },
      { key: 'imp_path', label: 'from pathlib import Path', detail: '', body: 'from pathlib import Path' },
    ],
  },
];

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

export const ALL_SNIPPETS = Object.fromEntries(SNIPPET_GROUPS.flatMap(g => g.items.map(i => [i.key, i])));

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
