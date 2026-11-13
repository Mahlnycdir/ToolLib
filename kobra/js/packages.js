// Paketverwaltung (pip im Browser ueber micropip / Pyodide-Pakete).
import { h, toast, loadPref, savePref, confirmDialog } from './ui.js';
import { icon } from './icons.js';
import { t as tr } from '../../app/i18n/i18n.js';

const popularPackages = () => [
  ['numpy', tr('kobra.pkg.arrays')], ['scipy', tr('kobra.pkg.scipy')], ['matplotlib', tr('kobra.pkg.plots')],
  ['sympy', tr('kobra.pkg.symbolic')], ['pandas', tr('kobra.pkg.tables')], ['pillow', tr('kobra.pkg.images')],
  ['scikit-learn', tr('kobra.pkg.ml')], ['networkx', tr('kobra.pkg.graphs')], ['statsmodels', tr('kobra.pkg.stats')],
  ['qutip', tr('kobra.pkg.quantumOptics')], ['astropy', tr('kobra.pkg.astronomy')], ['beautifulsoup4', tr('kobra.pkg.html')],
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
    const input = h('input', { class: 'field', type: 'text', placeholder: tr('kobra.pkg.placeholder'), autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', list: 'pkg-suggest', enterkeyhint: 'go', id: 'pkg-input' });
    this.datalist = h('datalist', { id: 'pkg-suggest' });
    const btn = h('button', { class: 'btn primary', type: 'button', text: tr('kobra.pkg.install') });
    const go = () => { const v = input.value.trim(); if (v) this.install(v.split(/[\s,]+/).filter(Boolean)); };
    btn.addEventListener('click', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    this.input = input;
    this.log = h('div', { class: 'pkg-log', hidden: true });
    this.installedEl = h('div', { class: 'pkg-list' });
    const popular = h('div', { class: 'chip-row' });
    for (const [name, desc] of popularPackages()) {
      const c = h('button', { class: 'chip', type: 'button', title: desc }, name);
      c.addEventListener('click', () => this.install([name]));
      popular.append(c);
    }
    const reqBtn = h('button', { class: 'btn small', type: 'button', title: tr('kobra.pkg.fromRequirements'), html: `${icon('file')}<span>requirements.txt</span>` });
    reqBtn.addEventListener('click', () => this.onRequirements?.());
    this.root.append(
      h('section', { class: 'card' },
        h('h3', { text: tr('kobra.pkg.installOne') }),
        h('div', { class: 'row-input' }, input, btn),
        this.datalist,
        h('p', { class: 'hint', html: tr('kobra.pkg.hint') }),
        this.log),
      h('section', { class: 'card' }, h('h3', { text: tr('kobra.pkg.popular') }), popular),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', { text: tr('kobra.pkg.installed') }), reqBtn),
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
      el.append(h('p', { class: 'empty', text: wanted.size ? tr('kobra.pkg.loadingAtStart') : tr('kobra.pkg.none') }));
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
    if (this.busy) { toast(tr('kobra.pkg.wait')); return; }
    if (this.runner.state === 'running') { toast(tr('kobra.pkg.stopFirst'), 'error'); return; }
    this.busy = true;
    this.log.textContent = '';
    this.logLine(tr('kobra.pkg.installing', { v: names.join(', ') }));
    try {
      const res = await this.runner.call('pip-install', { names }, 600000);
      const ok = res.filter(r => r.ok).map(r => r.name);
      for (const r of res) this.logLine(r.ok ? tr('kobra.pkg.installedOne', { name: r.name }) : `✗ ${r.name}: ${r.error}`, r.ok ? 'ok' : 'bad');
      if (ok.length) {
        this.remember(ok, true);
        toast(`${ok.join(', ')} installiert`, 'ok');
        this.input.value = '';
      }
    } catch (e) {
      this.logLine(tr('kobra.pkg.error', { message: e.message }), 'bad');
    } finally {
      this.busy = false;
      this.refresh();
    }
  }

  async uninstall(name) {
    if (!(await confirmDialog(tr('kobra.pkg.remove'), tr('kobra.pkg.removeConfirm', { name }), { okLabel: tr('kobra.remove'), danger: true }))) return;
    this.remember([name], false);
    try { await this.runner.call('pip-uninstall', { name }, 20000); } catch (e) { /* bleibt bis Neustart geladen */ }
    toast(`${name} entfernt`, 'ok');
    this.refresh();
  }
}
