// Paketverwaltung (pip im Browser ueber micropip / Pyodide-Pakete).
import { h, toast, loadPref, savePref, confirmDialog } from './ui.js';
import { icon } from './icons.js';

const POPULAR = [
  ['numpy', 'Rechnen mit Arrays'], ['scipy', 'Integration, Optimierung, ODEs'], ['matplotlib', 'Diagramme'],
  ['sympy', 'Symbolisch rechnen'], ['pandas', 'Tabellen und Daten'], ['pillow', 'Bilder (PIL)'],
  ['scikit-learn', 'Maschinelles Lernen'], ['networkx', 'Graphen'], ['statsmodels', 'Statistik'],
  ['qutip', 'Quantenoptik'], ['astropy', 'Astronomie'], ['beautifulsoup4', 'HTML auslesen'],
];

export class PackagePanel {
  constructor(root, runner) {
    this.root = root;
    this.runner = runner;
    this.available = [];
    this.installed = {};
    this.busy = false;
    this.render();
  }

  static wanted() { return loadPref('packages', []); }

  remember(names, add = true) {
    let list = loadPref('packages', []);
    for (const n of names) {
      const key = n.toLowerCase();
      list = list.filter(x => x.toLowerCase() !== key);
      if (add) list.push(n);
    }
    savePref('packages', list);
  }

  render() {
    this.root.textContent = '';
    const input = h('input', { class: 'field', type: 'text', placeholder: 'Paketname, z. B. numpy oder rich', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', list: 'pkg-suggest', enterkeyhint: 'go', id: 'pkg-input' });
    this.datalist = h('datalist', { id: 'pkg-suggest' });
    const btn = h('button', { class: 'btn primary', type: 'button', text: 'Installieren' });
    const go = () => { const v = input.value.trim(); if (v) this.install(v.split(/[\s,]+/).filter(Boolean)); };
    btn.addEventListener('click', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    this.input = input;
    this.log = h('div', { class: 'pkg-log', hidden: true });
    this.installedEl = h('div', { class: 'pkg-list' });
    const popular = h('div', { class: 'chip-row' });
    for (const [name, desc] of POPULAR) {
      const c = h('button', { class: 'chip', type: 'button', title: desc }, name);
      c.addEventListener('click', () => this.install([name]));
      popular.append(c);
    }
    const reqBtn = h('button', { class: 'btn small', type: 'button', title: 'Pakete aus requirements.txt installieren', html: `${icon('file')}<span>requirements.txt</span>` });
    reqBtn.addEventListener('click', () => this.onRequirements?.());
    this.root.append(
      h('section', { class: 'card' },
        h('h3', { text: 'Paket installieren' }),
        h('div', { class: 'row-input' }, input, btn),
        this.datalist,
        h('p', { class: 'hint', html: 'Reine Python-Pakete kommen direkt von PyPI. Pakete mit kompiliertem Code (numpy, scipy, pandas …) funktionieren, wenn Pyodide sie vorkompiliert anbietet. Ein <code>import</code> lädt diese übrigens automatisch.' }),
        this.log),
      h('section', { class: 'card' }, h('h3', { text: 'Beliebt' }), popular),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', { text: 'Installiert' }), reqBtn),
        this.installedEl),
    );
    this.renderInstalled();
  }

  async refresh() {
    try {
      const res = await this.runner.call('pip-list', {}, 30000);
      this.installed = res.installed || {};
      this.tools = new Set((res.tools || []).map(x => x.toLowerCase()));
      this.available = res.available || [];
      this.datalist.textContent = '';
      for (const n of this.available.slice().sort()) this.datalist.append(h('option', { value: n }));
    } catch (e) { /* Python laedt noch */ }
    this.renderInstalled();
  }

  renderInstalled() {
    const el = this.installedEl;
    el.textContent = '';
    const wanted = new Set(loadPref('packages', []).map(x => x.toLowerCase()));
    const names = Object.keys(this.installed).sort((a, b) => a.localeCompare(b));
    const tools = this.tools || new Set();
    const shown = names.filter(n => wanted.has(n.toLowerCase()) || (this.installed[n].s === 'pypi' && !tools.has(n.toLowerCase())));
    if (!shown.length) {
      el.append(h('p', { class: 'empty', text: wanted.size ? 'Pakete werden beim Start von Python geladen …' : 'Noch keine zusätzlichen Pakete. Mitgeliefert sind die gesamte Standardbibliothek sowie der tkinter- und PyQt-Nachbau.' }));
      return;
    }
    for (const n of shown) {
      const info = this.installed[n];
      const del = h('button', { class: 'icon-btn small', type: 'button', 'aria-label': `${n} entfernen`, html: icon('trash') });
      del.addEventListener('click', () => this.uninstall(n));
      el.append(h('div', { class: 'pkg-row' }, h('div', {}, h('div', { class: 'pkg-name', text: n }), h('div', { class: 'pkg-meta', text: `${info.v}${info.s === 'pypi' ? ' · PyPI' : ' · Pyodide'}` })), del));
    }
  }

  logLine(text, kind = '') {
    this.log.hidden = false;
    this.log.append(h('div', { class: `pkg-log-line ${kind}`, text }));
    this.log.scrollTop = this.log.scrollHeight;
  }

  async install(names) {
    if (this.busy) { toast('Bitte warten, bis die laufende Installation fertig ist.'); return; }
    if (this.runner.state === 'running') { toast('Erst das laufende Programm stoppen.', 'error'); return; }
    this.busy = true;
    this.log.textContent = '';
    this.logLine(`Installiere ${names.join(', ')} …`);
    try {
      const res = await this.runner.call('pip-install', { names }, 600000);
      const ok = res.filter(r => r.ok).map(r => r.name);
      for (const r of res) this.logLine(r.ok ? `✓ ${r.name} installiert` : `✗ ${r.name}: ${r.error}`, r.ok ? 'ok' : 'bad');
      if (ok.length) {
        this.remember(ok, true);
        toast(`${ok.join(', ')} installiert`, 'ok');
        this.input.value = '';
      }
    } catch (e) {
      this.logLine(`Fehler: ${e.message}`, 'bad');
    } finally {
      this.busy = false;
      this.refresh();
    }
  }

  async uninstall(name) {
    if (!(await confirmDialog('Paket entfernen', `${name} entfernen? Es wird beim nächsten Start nicht mehr geladen.`, { okLabel: 'Entfernen', danger: true }))) return;
    this.remember([name], false);
    try { await this.runner.call('pip-uninstall', { name }, 20000); } catch (e) { /* bleibt bis Neustart geladen */ }
    toast(`${name} entfernt`, 'ok');
    this.refresh();
  }
}
