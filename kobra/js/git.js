// Versionskontrolle mit echtem Git (isomorphic-git) und GitHub-Abgleich.
import { git, http, Diff } from '../vendor/vendor.js';
import { fs, projectPath, readText, exists, isTextFile, flush } from './storage.js';
import { h, toast, promptDialog, confirmDialog, openSheet, actionSheet, loadPref, savePref, modal } from './ui.js';
import { icon } from './icons.js';

const dec = new TextDecoder();

export function gitSettings() {
  return {
    name: loadPref('git.name', ''),
    email: loadPref('git.email', ''),
    token: loadPref('git.token', ''),
    proxy: loadPref('git.proxy', ''),
  };
}

function authOpts() {
  const s = gitSettings();
  const o = {};
  if (s.proxy) o.corsProxy = s.proxy.replace(/\/+$/, '');
  o.onAuth = () => (s.token ? { username: 'x-access-token', password: s.token } : { cancel: true });
  o.onAuthFailure = () => { toast('GitHub hat die Anmeldung abgelehnt. Token in den Einstellungen prüfen.', 'error', 5000); return { cancel: true }; };
  return o;
}

function author() {
  const s = gitSettings();
  return { name: s.name || 'Kobra', email: s.email || 'kobra@example.invalid' };
}

export function explainGitError(e) {
  const m = String(e?.message || e);
  if (/Failed to fetch|NetworkError|Load failed|CORS/i.test(m)) {
    return gitSettings().proxy
      ? 'Keine Verbindung zum Git-Proxy. Internet und Proxy-Adresse in den Einstellungen prüfen.'
      : 'GitHub erlaubt Browsern keinen direkten Git-Zugriff. Bitte in den Einstellungen eine Proxy-Adresse eintragen (Anleitung in der README).';
  }
  if (/401|403|HttpError.*40[13]/.test(m)) return 'Zugriff verweigert. Ist das GitHub-Token gültig und hat es Schreibrechte für dieses Repository?';
  if (/404/.test(m)) return 'Repository nicht gefunden. Adresse prüfen (und ob es privat ist).';
  if (/MergeConflict|conflict/i.test(m)) return 'Konflikt beim Zusammenführen: Dieselben Zeilen wurden hier und auf GitHub geändert.';
  if (/PushRejected|not a simple fast-forward/i.test(m)) return 'Auf GitHub gibt es neuere Commits. Erst „Holen“, dann erneut hochladen.';
  return m.split('\n')[0];
}

export class GitService {
  constructor() {
    this.fs = fs;
    for (const m of ['init', 'commit', 'discard', 'restoreFile', 'createBranch', 'checkoutBranch', 'deleteBranch', 'merge', 'setRemote', 'clone', 'push', 'pull', 'addAll']) {
      const orig = this[m].bind(this);
      this[m] = async (...a) => { try { return await orig(...a); } finally { await flush(); } };
    }
  }

  dir(project) { return projectPath(project); }

  async isRepo(project) { return exists(`${this.dir(project)}/.git`); }

  async init(project) {
    const dir = this.dir(project);
    await git.init({ fs, dir, defaultBranch: 'main' });
    await this.addAll(project);
    await git.commit({ fs, dir, message: 'Erster Stand', author: author() });
  }

  async status(project) {
    const dir = this.dir(project);
    const matrix = await git.statusMatrix({ fs, dir });
    const out = [];
    for (const [file, head, work, stage] of matrix) {
      if (head === 1 && work === 1 && stage === 1) continue;
      let kind = 'M';
      if (head === 0 && work === 2) kind = stage === 0 ? '?' : 'A';
      else if (work === 0) kind = 'D';
      out.push({ file, head, work, stage, kind });
    }
    return out;
  }

  async addAll(project, files) {
    const dir = this.dir(project);
    const list = files || (await this.status(project)).map(s => s.file);
    for (const f of list) {
      const st = (await git.statusMatrix({ fs, dir, filepaths: [f] }))[0];
      if (st && st[2] === 0) await git.remove({ fs, dir, filepath: f });
      else await git.add({ fs, dir, filepath: f });
    }
  }

  async commit(project, message, files) {
    const dir = this.dir(project);
    await this.addAll(project, files);
    return git.commit({ fs, dir, message, author: author() });
  }

  async log(project, depth = 80) {
    try { return await git.log({ fs, dir: this.dir(project), depth }); } catch (e) { return []; }
  }

  async headContent(project, file, ref = 'HEAD') {
    try {
      const oid = await git.resolveRef({ fs, dir: this.dir(project), ref });
      const { blob } = await git.readBlob({ fs, dir: this.dir(project), oid, filepath: file });
      return dec.decode(blob);
    } catch (e) { return null; }
  }

  async contentAt(project, commitOid, file) {
    try {
      const { blob } = await git.readBlob({ fs, dir: this.dir(project), oid: commitOid, filepath: file });
      return dec.decode(blob);
    } catch (e) { return null; }
  }

  async discard(project, file) {
    const dir = this.dir(project);
    const inHead = (await this.headContent(project, file)) !== null;
    if (inHead) await git.checkout({ fs, dir, ref: 'HEAD', filepaths: [file], force: true });
    else {
      try { await git.remove({ fs, dir, filepath: file }); } catch (e) { /* nicht vorgemerkt */ }
      try { await fs.promises.unlink(`${dir}/${file}`); } catch (e) { /* weg */ }
    }
  }

  async restoreFile(project, oid, file) {
    const dir = this.dir(project);
    await git.checkout({ fs, dir, ref: oid, filepaths: [file], force: true, noUpdateHead: true });
  }

  async changedInCommit(project, commit) {
    const dir = this.dir(project);
    const parent = commit.commit.parent[0];
    const trees = [git.TREE({ ref: commit.oid })];
    if (parent) trees.push(git.TREE({ ref: parent }));
    const files = [];
    await git.walk({
      fs, dir, trees,
      map: async (filepath, [a, b]) => {
        if (filepath === '.') return undefined;
        const ta = a ? await a.type() : null;
        const tb = b ? await b.type() : null;
        if (ta === 'tree' || tb === 'tree') return true;
        const oa = a ? await a.oid() : null;
        const ob = b ? await b.oid() : null;
        if (oa !== ob) files.push({ file: filepath, kind: !ob ? 'A' : !oa ? 'D' : 'M' });
        return true;
      },
    });
    return files;
  }

  async branches(project) {
    const dir = this.dir(project);
    const list = await git.listBranches({ fs, dir });
    const current = await git.currentBranch({ fs, dir, fullname: false });
    return { list, current };
  }

  async createBranch(project, name) {
    await git.branch({ fs, dir: this.dir(project), ref: name, checkout: true });
  }

  async checkoutBranch(project, name) {
    await git.checkout({ fs, dir: this.dir(project), ref: name });
  }

  async deleteBranch(project, name) {
    await git.deleteBranch({ fs, dir: this.dir(project), ref: name });
  }

  async merge(project, theirs) {
    const dir = this.dir(project);
    const ours = await git.currentBranch({ fs, dir });
    const res = await git.merge({ fs, dir, ours, theirs, author: author() });
    if (res.oid) await git.checkout({ fs, dir, ref: ours });
    return res;
  }

  async remotes(project) {
    try { return await git.listRemotes({ fs, dir: this.dir(project) }); } catch (e) { return []; }
  }

  async setRemote(project, url) {
    const dir = this.dir(project);
    try { await git.deleteRemote({ fs, dir, remote: 'origin' }); } catch (e) { /* neu */ }
    await git.addRemote({ fs, dir, remote: 'origin', url });
  }

  async clone(project, url, onProgress) {
    await git.clone({ fs, http, dir: this.dir(project), url, singleBranch: true, depth: 50, onProgress, ...authOpts() });
  }

  async push(project, onProgress) {
    const dir = this.dir(project);
    const ref = await git.currentBranch({ fs, dir });
    const res = await git.push({ fs, http, dir, remote: 'origin', ref, onProgress, ...authOpts() });
    if (res && res.ok === false) throw new Error(res.error || 'Hochladen abgelehnt');
    return res;
  }

  async pull(project, onProgress) {
    const dir = this.dir(project);
    const ref = await git.currentBranch({ fs, dir });
    await git.pull({ fs, http, dir, remote: 'origin', ref, singleBranch: true, author: author(), onProgress, ...authOpts() });
  }

  async ahead(project) {
    const dir = this.dir(project);
    try {
      const ref = await git.currentBranch({ fs, dir });
      const local = await git.resolveRef({ fs, dir, ref });
      const remote = await git.resolveRef({ fs, dir, ref: `refs/remotes/origin/${ref}` });
      if (local === remote) return 0;
      const commits = await git.log({ fs, dir, ref, depth: 50 });
      const i = commits.findIndex(c => c.oid === remote);
      return i < 0 ? commits.length : i;
    } catch (e) { return null; }
  }
}

// ---------------------------------------------------------------- Diff-Ansicht
export function renderDiff(oldText, newText) {
  const box = h('div', { class: 'diff' });
  const parts = Diff.diffLines(oldText ?? '', newText ?? '');
  let oldNo = 1, newNo = 1;
  const CONTEXT = 3;
  for (let pi = 0; pi < parts.length; pi++) {
    const p = parts[pi];
    const lines = p.value.replace(/\n$/, '').split('\n');
    if (!p.added && !p.removed) {
      // lange unveraenderte Bloecke kuerzen
      if (lines.length > CONTEXT * 2 + 1) {
        const head = pi === 0 ? [] : lines.slice(0, CONTEXT);
        const tail = pi === parts.length - 1 ? [] : lines.slice(-CONTEXT);
        for (const l of head) box.append(diffLine(' ', oldNo++, newNo++, l));
        const skipped = lines.length - head.length - tail.length;
        box.append(h('div', { class: 'diff-skip', text: `… ${skipped} unveränderte Zeilen …` }));
        oldNo += skipped; newNo += skipped;
        for (const l of tail) box.append(diffLine(' ', oldNo++, newNo++, l));
      } else {
        for (const l of lines) box.append(diffLine(' ', oldNo++, newNo++, l));
      }
    } else if (p.removed) {
      for (const l of lines) box.append(diffLine('-', oldNo++, '', l));
    } else {
      for (const l of lines) box.append(diffLine('+', '', newNo++, l));
    }
  }
  if (!box.children.length) box.append(h('div', { class: 'diff-skip', text: 'Keine Unterschiede.' }));
  return box;
}

function diffLine(sign, a, b, text) {
  const cls = sign === '+' ? 'add' : sign === '-' ? 'del' : 'ctx';
  return h('div', { class: `diff-line ${cls}` }, h('span', { class: 'ln', text: String(a) }), h('span', { class: 'ln', text: String(b) }), h('span', { class: 'sign', text: sign }), h('span', { class: 'code', text: text || ' ' }));
}

// ------------------------------------------------------------------ Panel
export class GitPanel {
  constructor(root, { service, getProject, onFilesChanged, openSettings, onProjectsChanged }) {
    this.root = root;
    this.svc = service;
    this.getProject = getProject;
    this.onFilesChanged = onFilesChanged;
    this.openSettings = openSettings;
    this.onProjectsChanged = onProjectsChanged;
    this.busy = false;
  }

  async refresh() {
    const project = this.getProject();
    this.root.textContent = '';
    if (!project) {
      this.root.append(h('p', { class: 'empty', text: 'Kein Projekt geöffnet.' }));
      return;
    }
    if (!(await this.svc.isRepo(project))) {
      const initBtn = h('button', { class: 'btn primary', type: 'button', html: `${icon('git')}<span>Versionskontrolle einrichten</span>` });
      initBtn.addEventListener('click', () => this.guard(async () => {
        await this.svc.init(project);
        toast('Git eingerichtet, erster Stand gespeichert', 'ok');
      }));
      const cloneBtn = h('button', { class: 'btn', type: 'button', html: `${icon('cloudDown')}<span>Repository von GitHub klonen</span>` });
      cloneBtn.addEventListener('click', () => this.cloneDialog());
      this.root.append(h('section', { class: 'card' },
        h('h3', { text: `„${project}“ ist noch nicht versioniert` }),
        h('p', { class: 'hint', text: 'Git speichert jeden Stand deines Projekts als Commit. So kannst du Änderungen vergleichen, zurücknehmen und das Projekt mit GitHub abgleichen.' }),
        h('div', { class: 'btn-col' }, initBtn, cloneBtn)));
      return;
    }
    const [status, br, remotes, log] = await Promise.all([
      this.svc.status(project), this.svc.branches(project), this.svc.remotes(project), this.svc.log(project, 40),
    ]);
    // Branch-Zeile
    const branchBtn = h('button', { class: 'btn small', type: 'button', html: `${icon('branch')}<span>${br.current || '(losgelöst)'}</span>` });
    branchBtn.addEventListener('click', () => this.branchMenu(br));
    const origin = remotes.find(r => r.remote === 'origin');
    const head = h('section', { class: 'card git-head' },
      h('div', { class: 'card-head' }, h('h3', { text: 'Zweig' }), branchBtn));
    // Remote
    if (origin) {
      const ahead = await this.svc.ahead(project);
      const pushBtn = h('button', { class: 'btn small primary', type: 'button', html: `${icon('cloudUp')}<span>Hochladen${ahead ? ` (${ahead})` : ''}</span>` });
      const pullBtn = h('button', { class: 'btn small', type: 'button', html: `${icon('cloudDown')}<span>Holen</span>` });
      pushBtn.addEventListener('click', () => this.remoteOp('push'));
      pullBtn.addEventListener('click', () => this.remoteOp('pull'));
      const urlBtn = h('button', { class: 'link-btn', type: 'button', text: origin.url.replace(/^https:\/\//, '') });
      urlBtn.addEventListener('click', () => this.remoteDialog(origin.url));
      head.append(h('div', { class: 'remote-row' }, h('span', { class: 'muted', html: icon('link') }), urlBtn), h('div', { class: 'btn-row' }, pullBtn, pushBtn));
    } else {
      const addRemote = h('button', { class: 'btn small', type: 'button', html: `${icon('link')}<span>Mit GitHub verbinden</span>` });
      addRemote.addEventListener('click', () => this.remoteDialog(''));
      head.append(addRemote);
    }
    this.root.append(head);

    // Aenderungen
    const changes = h('section', { class: 'card' });
    const selected = new Set(status.map(s => s.file));
    changes.append(h('div', { class: 'card-head' }, h('h3', { text: status.length ? `Änderungen (${status.length})` : 'Keine Änderungen' })));
    for (const s of status) {
      const cb = h('input', { type: 'checkbox', checked: true, 'aria-label': `${s.file} in Commit aufnehmen` });
      cb.addEventListener('change', () => { if (cb.checked) selected.add(s.file); else selected.delete(s.file); });
      const name = h('button', { class: 'change-name', type: 'button', text: s.file });
      name.addEventListener('click', () => this.showDiff(project, s));
      const badge = h('span', { class: `badge k-${s.kind === '?' ? 'U' : s.kind}`, text: { M: 'geändert', A: 'neu', D: 'gelöscht', '?': 'neu' }[s.kind] });
      const undo = h('button', { class: 'icon-btn small', type: 'button', 'aria-label': 'Änderung verwerfen', title: 'Änderung verwerfen', html: icon('undo') });
      undo.addEventListener('click', async () => {
        if (!(await confirmDialog('Änderung verwerfen', `Alle Änderungen an „${s.file}“ seit dem letzten Commit verwerfen?`, { okLabel: 'Verwerfen', danger: true }))) return;
        await this.guard(async () => { await this.svc.discard(project, s.file); this.onFilesChanged?.([s.file]); });
      });
      changes.append(h('div', { class: 'change-row' }, cb, name, badge, undo));
    }
    if (status.length) {
      const msg = h('textarea', { class: 'field commit-msg', rows: '2', placeholder: 'Was hast du geändert? (Commit-Nachricht)', id: 'commit-msg' });
      const commitBtn = h('button', { class: 'btn primary', type: 'button', html: `${icon('check')}<span>Commit</span>` });
      commitBtn.addEventListener('click', () => this.guard(async () => {
        const text = msg.value.trim();
        if (!text) { toast('Bitte eine kurze Nachricht eingeben.', 'error'); msg.focus(); throw new Error(''); }
        if (!selected.size) { toast('Keine Datei ausgewählt.', 'error'); throw new Error(''); }
        if (!gitSettings().name) toast('Tipp: Name und E-Mail für Commits in den Einstellungen eintragen.');
        await this.svc.commit(project, text, [...selected]);
        toast('Commit gespeichert', 'ok');
      }));
      changes.append(msg, commitBtn);
    }
    this.root.append(changes);

    // Verlauf
    const hist = h('section', { class: 'card' }, h('h3', { text: 'Verlauf' }));
    for (const c of log) {
      const d = new Date(c.commit.author.timestamp * 1000);
      const row = h('button', { class: 'commit-row', type: 'button' },
        h('span', { class: 'commit-msg-text', text: c.commit.message.split('\n')[0] }),
        h('span', { class: 'commit-meta', text: `${c.oid.slice(0, 7)} · ${c.commit.author.name} · ${d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}` }));
      row.addEventListener('click', () => this.showCommit(project, c));
      hist.append(row);
    }
    if (!log.length) hist.append(h('p', { class: 'empty', text: 'Noch keine Commits.' }));
    this.root.append(hist);
  }

  async guard(fn) {
    if (this.busy) return;
    this.busy = true;
    try { await fn(); } catch (e) { if (e?.message) toast(explainGitError(e), 'error', 6000); }
    finally { this.busy = false; this.refresh(); }
  }

  async showDiff(project, s) {
    const dir = projectPath(project);
    const before = await this.svc.headContent(project, s.file);
    let after = null;
    if (s.work !== 0) {
      if (!isTextFile(s.file)) { toast('Binärdatei – kein Textvergleich möglich.'); return; }
      after = await readText(`${dir}/${s.file}`);
    }
    openSheet(s.file, renderDiff(before || '', after || ''), { full: true });
  }

  async showCommit(project, c) {
    const files = await this.svc.changedInCommit(project, c);
    const body = h('div', { class: 'commit-detail' });
    const d = new Date(c.commit.author.timestamp * 1000);
    body.append(h('p', { class: 'commit-full', text: c.commit.message }), h('p', { class: 'muted', text: `${c.oid} · ${c.commit.author.name} <${c.commit.author.email}> · ${d.toLocaleString('de-DE')}` }));
    for (const f of files) {
      const row = h('div', { class: 'change-row' });
      const name = h('button', { class: 'change-name', type: 'button', text: f.file });
      name.addEventListener('click', async () => {
        const parent = c.commit.parent[0];
        const before = parent ? await this.svc.contentAt(project, parent, f.file) : '';
        const after = await this.svc.contentAt(project, c.oid, f.file);
        openSheet(`${f.file} @ ${c.oid.slice(0, 7)}`, renderDiff(before || '', after || ''), { full: true });
      });
      const restore = h('button', { class: 'icon-btn small', type: 'button', title: 'Datei auf diesen Stand zurücksetzen', 'aria-label': 'Datei auf diesen Stand zurücksetzen', html: icon('history') });
      restore.addEventListener('click', async () => {
        if (f.kind === 'D') { toast('Die Datei wurde in diesem Commit gelöscht.'); return; }
        if (!(await confirmDialog('Datei zurücksetzen', `„${f.file}“ auf den Stand von ${c.oid.slice(0, 7)} setzen? Nicht committete Änderungen daran gehen verloren.`, { okLabel: 'Zurücksetzen', danger: true }))) return;
        try {
          await this.svc.restoreFile(project, c.oid, f.file);
          this.onFilesChanged?.([f.file]);
          toast('Datei zurückgesetzt', 'ok');
        } catch (e) { toast(explainGitError(e), 'error'); }
      });
      row.append(h('span', { class: `badge k-${f.kind}`, text: { M: 'geändert', A: 'neu', D: 'gelöscht' }[f.kind] }), name, restore);
      body.append(row);
    }
    openSheet('Commit', body, { full: true });
  }

  async branchMenu(br) {
    const project = this.getProject();
    const items = br.list.map(b => ({ label: b, icon: b === br.current ? 'check' : 'branch', value: `co:${b}`, disabled: b === br.current }));
    items.push('-', { label: 'Neuer Zweig …', icon: 'plus', value: 'new' });
    const others = br.list.filter(b => b !== br.current);
    if (others.length) items.push({ label: 'Zweig hierher zusammenführen …', icon: 'git', value: 'merge' }, { label: 'Zweig löschen …', icon: 'trash', value: 'del', danger: true });
    const v = await actionSheet('Zweige', items);
    if (!v) return;
    if (v.startsWith('co:')) {
      const status = await this.svc.status(project);
      if (status.length && !(await confirmDialog('Zweig wechseln', 'Es gibt nicht committete Änderungen. Beim Wechsel können sie überschrieben werden. Trotzdem wechseln?', { okLabel: 'Wechseln', danger: true }))) return;
      await this.guard(async () => { await this.svc.checkoutBranch(project, v.slice(3)); this.onFilesChanged?.(null); toast(`Zweig ${v.slice(3)}`, 'ok'); });
    } else if (v === 'new') {
      const name = await promptDialog('Neuer Zweig', { label: 'Name', placeholder: 'z. B. experiment', validate: (s) => /^[\w.\-/]+$/.test(s) ? null : 'Nur Buchstaben, Ziffern, - _ . /' });
      if (name) await this.guard(() => this.svc.createBranch(project, name));
    } else if (v === 'merge' || v === 'del') {
      const pick = await actionSheet(v === 'merge' ? `In ${br.current} zusammenführen` : 'Zweig löschen', others.map(b => ({ label: b, value: b, icon: 'branch', danger: v === 'del' })));
      if (!pick) return;
      if (v === 'merge') await this.guard(async () => { await this.svc.merge(project, pick); this.onFilesChanged?.(null); toast(`${pick} zusammengeführt`, 'ok'); });
      else if (await confirmDialog('Zweig löschen', `Zweig „${pick}“ löschen?`, { okLabel: 'Löschen', danger: true })) await this.guard(() => this.svc.deleteBranch(project, pick));
    }
  }

  async remoteDialog(current) {
    const url = await promptDialog('GitHub-Repository', {
      label: 'HTTPS-Adresse des Repositorys', value: current, placeholder: 'https://github.com/name/projekt.git',
      hint: 'Lege das Repository vorher auf github.com an (leer, ohne README).',
      validate: (s) => /^https:\/\/\S+$/.test(s.trim()) ? null : 'Bitte eine https://-Adresse eingeben.',
    });
    if (!url) return;
    await this.guard(() => this.svc.setRemote(this.getProject(), url.trim()));
  }

  async remoteOp(kind) {
    const s = gitSettings();
    if (!s.proxy || (kind === 'push' && !s.token)) {
      const go = await modal({
        title: 'GitHub einrichten',
        body: h('p', { text: kind === 'push' && !s.token ? 'Zum Hochladen brauchst du ein GitHub-Token. Außerdem braucht der Browser einen kleinen Git-Proxy. Beides trägst du in den Einstellungen ein.' : 'Der Browser braucht einen kleinen Git-Proxy, um mit GitHub zu sprechen. Trage dessen Adresse in den Einstellungen ein.' }),
        actions: [{ label: 'Abbrechen', value: false }, { label: 'Zu den Einstellungen', kind: 'primary', value: true }],
      });
      if (go) this.openSettings?.('git');
      return;
    }
    const project = this.getProject();
    const prog = toastProgress(kind === 'push' ? 'Lade hoch …' : 'Hole Änderungen …');
    await this.guard(async () => {
      try {
        if (kind === 'push') { await this.svc.push(project, prog.update); toast('Auf GitHub hochgeladen', 'ok'); }
        else {
          const st = await this.svc.status(project);
          if (st.some(x => x.kind !== '?')) {
            prog.done();
            toast('Bitte zuerst committen, dann holen.', 'error', 4000);
            return;
          }
          await this.svc.pull(project, prog.update);
          this.onFilesChanged?.(null);
          toast('Auf dem neuesten Stand', 'ok');
        }
      } finally { prog.done(); }
    });
  }

  async cloneDialog() {
    const url = await promptDialog('Repository klonen', {
      label: 'HTTPS-Adresse', placeholder: 'https://github.com/name/projekt.git',
      validate: (s) => /^https:\/\/\S+$/.test(s.trim()) ? null : 'Bitte eine https://-Adresse eingeben.',
    });
    if (!url) return;
    if (!gitSettings().proxy) {
      toast('Zum Klonen ist ein Git-Proxy nötig (Einstellungen).', 'error', 5000);
      this.openSettings?.('git');
      return;
    }
    const base = decodeURIComponent(url.trim().replace(/\.git$/, '').split('/').pop() || 'Klon');
    let name = base;
    for (let i = 2; await exists(projectPath(name)); i++) name = `${base} ${i}`;
    const prog = toastProgress('Klone …');
    try {
      await this.svc.clone(name, url.trim(), prog.update);
      toast(`Als Projekt „${name}“ geklont`, 'ok');
      this.onProjectsChanged?.(name);
    } catch (e) {
      toast(explainGitError(e), 'error', 6000);
    } finally { prog.done(); }
  }
}

function toastProgress(label) {
  const el = h('div', { class: 'progress-toast' }, h('span', { class: 'spinner' }), h('span', { text: label }));
  document.body.append(el);
  const text = el.lastChild;
  return {
    update: (p) => { if (p?.phase) text.textContent = `${label} ${p.phase}${p.total ? ` ${Math.round((p.loaded / p.total) * 100)} %` : ''}`; },
    done: () => el.remove(),
  };
}
