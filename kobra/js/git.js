// Versionskontrolle mit echtem Git (isomorphic-git) und GitHub-Abgleich.
// 0.20.0: jedes Projekt committet und lädt mit seinem Konto (accounts.js); geklonte und verbundene Repositorys
// kommen in die Liste deiner Repositorys, die auf jedem Gerät gleich ist.
import { git, http, Diff } from '../vendor/vendor.js';
import { fs, projectPath, readText, exists, isTextFile, flush, rmrf } from './storage.js';
import { h, toast, promptDialog, confirmDialog, openSheet, actionSheet, loadPref, savePref, modal, esc } from './ui.js';
import { icon } from './icons.js';
import { overlayHost } from './markup.js';
import { MAIN, accounts, account, accountLabel, accountForUrl, tokenFor, authorOf, rememberRepo, repoEntry } from './accounts.js';
import { t as tr, getLang } from '../../app/i18n/i18n.js';

const dec = new TextDecoder();

// Das erste Konto und der Proxy (so wie früher; der Proxy gilt für alle Konten).
export function gitSettings() {
  return {
    name: loadPref('git.name', ''),
    email: loadPref('git.email', ''),
    token: loadPref('git.token', ''),
    proxy: loadPref('git.proxy', ''),
  };
}

function authOpts(url, acc) {
  const proxy = loadPref('git.proxy', '');
  const o = {};
  if (proxy) o.corsProxy = proxy.replace(/\/+$/, '');
  const token = tokenFor(acc, url);
  o.onAuth = () => (token ? { username: 'x-access-token', password: token } : { cancel: true });
  o.onAuthFailure = () => { toast(tr('kobra.git.authRefused', { v: accountLabel(acc) }), 'error', 5000); return { cancel: true }; };
  return o;
}

export function explainGitError(e) {
  const m = String(e?.message || e);
  if (/Failed to fetch|NetworkError|Load failed|CORS/i.test(m)) {
    return gitSettings().proxy
      ? tr('kobra.git.noProxy')
      : tr('kobra.git.needProxy');
  }
  if (/UserCanceled|operation was canceled/i.test(m)) return tr('kobra.git.refused');
  if (/401|403|HttpError.*40[13]/.test(m)) return tr('kobra.git.denied');
  if (/404/.test(m)) return tr('kobra.git.notFound');
  if (/MergeConflict|conflict/i.test(m)) return tr('kobra.git.conflict');
  if (/PushRejected|not a simple fast-forward/i.test(m)) return tr('kobra.git.behind');
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

  async originUrl(project) {
    try { return (await git.getConfig({ fs, dir: this.dir(project), path: 'remote.origin.url' })) || ''; } catch (e) { return ''; }
  }

  // Das Konto eines Projekts: mit GitHub verbunden nach der Liste deiner Repositorys, sonst auf diesem Gerät gemerkt.
  async accountOf(project) {
    const url = await this.originUrl(project);
    if (url) return accountForUrl(url);
    return account(loadPref(`account.${project}`, MAIN)) || accounts()[0];
  }

  async setAccount(project, id) {
    const url = await this.originUrl(project);
    if (url) rememberRepo({ url, name: project, account: id });
    else savePref(`account.${project}`, id);
  }

  async init(project) {
    const dir = this.dir(project);
    await git.init({ fs, dir, defaultBranch: 'main' });
    await this.addAll(project);
    await git.commit({ fs, dir, message: tr('kobra.git.firstCommit'), author: authorOf(await this.accountOf(project)) });
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
    return git.commit({ fs, dir, message, author: authorOf(await this.accountOf(project)) });
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
    const res = await git.merge({ fs, dir, ours, theirs, author: authorOf(await this.accountOf(project)) });
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
    rememberRepo({ url, name: project });
  }

  // accId: das gewählte Konto (leer: nach dem Besitzer). Danach steht das Repository in deiner Liste.
  async clone(project, url, onProgress, accId = '') {
    const acc = (accId && account(accId)) || accountForUrl(url);
    const branch = repoEntry(url)?.branch || undefined;
    try {
      await git.clone({ fs, http, dir: this.dir(project), url, ref: branch, singleBranch: true, depth: 50, onProgress, ...authOpts(url, acc) });
    } catch (e) {
      if (!branch || !/NotFound|Could not find/i.test(String(e?.message || e))) throw e;
      await rmrf(this.dir(project)).catch(() => {});   // der Zweig von früher gibt es nicht mehr: den Standardzweig holen
      await git.clone({ fs, http, dir: this.dir(project), url, singleBranch: true, depth: 50, onProgress, ...authOpts(url, acc) });
    }
    const current = await git.currentBranch({ fs, dir: this.dir(project) }).catch(() => '');
    rememberRepo({ url, name: project, account: accId || undefined, branch: current || '' });
  }

  async push(project, onProgress) {
    const dir = this.dir(project);
    const ref = await git.currentBranch({ fs, dir });
    const url = await this.originUrl(project);
    const res = await git.push({ fs, http, dir, remote: 'origin', ref, onProgress, ...authOpts(url, await this.accountOf(project)) });
    if (res && res.ok === false) throw new Error(res.error || tr('kobra.git.pushRejected'));
    return res;
  }

  async pull(project, onProgress) {
    const dir = this.dir(project);
    const ref = await git.currentBranch({ fs, dir });
    const url = await this.originUrl(project);
    const acc = await this.accountOf(project);
    await git.pull({ fs, http, dir, remote: 'origin', ref, singleBranch: true, author: authorOf(acc), onProgress, ...authOpts(url, acc) });
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
        box.append(h('div', { class: 'diff-skip', text: tr('kobra.git.unchangedLines', { skipped }) }));
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
  if (!box.children.length) box.append(h('div', { class: 'diff-skip', text: tr('kobra.git.noDiff') }));
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
      this.root.append(h('p', { class: 'empty', text: tr('kobra.git.noProject') }));
      return;
    }
    if (!(await this.svc.isRepo(project))) {
      const initBtn = h('button', { class: 'btn primary', type: 'button', html: `${icon('git')}<span>${esc(tr('kobra.git.initBtn'))}</span>` });
      initBtn.addEventListener('click', () => this.guard(async () => {
        await this.svc.init(project);
        toast(tr('kobra.git.initDone'), 'ok');
      }));
      const cloneBtn = h('button', { class: 'btn', type: 'button', html: `${icon('cloudDown')}<span>${esc(tr('kobra.git.cloneBtn'))}</span>` });
      cloneBtn.addEventListener('click', () => this.cloneDialog());
      this.root.append(h('section', { class: 'card' },
        h('h3', { text: tr('kobra.git.notVersioned', { project }) }),
        h('p', { class: 'hint', text: tr('kobra.git.explain') }),
        h('div', { class: 'btn-col' }, initBtn, cloneBtn)));
      return;
    }
    const [status, br, remotes, log] = await Promise.all([
      this.svc.status(project), this.svc.branches(project), this.svc.remotes(project), this.svc.log(project, 40),
    ]);
    // Branch-Zeile
    const branchBtn = h('button', { class: 'btn small', type: 'button', html: `${icon('branch')}<span>${esc(br.current || tr('kobra.git.detached'))}</span>` });
    branchBtn.addEventListener('click', () => this.branchMenu(br));
    const origin = remotes.find(r => r.remote === 'origin');
    const head = h('section', { class: 'card git-head' },
      h('div', { class: 'card-head' }, h('h3', { text: tr('kobra.git.branch') }), branchBtn));
    // Remote
    if (origin) {
      const ahead = await this.svc.ahead(project);
      const pushBtn = h('button', { class: 'btn small primary', type: 'button', html: `${icon('cloudUp')}<span>${esc(tr('kobra.git.push'))}${ahead ? ` (${ahead})` : ''}</span>` });
      const pullBtn = h('button', { class: 'btn small', type: 'button', html: `${icon('cloudDown')}<span>${esc(tr('kobra.git.pull'))}</span>` });
      pushBtn.addEventListener('click', () => this.remoteOp('push'));
      pullBtn.addEventListener('click', () => this.remoteOp('pull'));
      const urlBtn = h('button', { class: 'link-btn', type: 'button', text: origin.url.replace(/^https:\/\//, '') });
      urlBtn.addEventListener('click', () => this.remoteDialog(origin.url));
      head.append(h('div', { class: 'remote-row' }, h('span', { class: 'muted', html: icon('link') }), urlBtn), h('div', { class: 'btn-row' }, pullBtn, pushBtn));
    } else {
      const addRemote = h('button', { class: 'btn small', type: 'button', html: `${icon('link')}<span>${esc(tr('kobra.git.connect'))}</span>` });
      addRemote.addEventListener('click', () => this.remoteDialog(''));
      head.append(addRemote);
    }
    // Konto: mit wem dieses Projekt committet und hochlädt
    const acc = await this.svc.accountOf(project);
    const accBtn = h('button', { class: 'link-btn git-account', type: 'button', id: 'git-account', title: tr('kobra.git.pickAccount') });
    accBtn.append(h('span', { text: accountLabel(acc) }), acc.email ? h('span', { class: 'muted', text: `· ${acc.email}` }) : '');
    accBtn.addEventListener('click', () => this.accountMenu(project, acc));
    head.append(h('div', { class: 'remote-row' }, h('span', { class: 'muted', html: icon('user') }), accBtn));
    this.root.append(head);

    // Aenderungen
    const changes = h('section', { class: 'card' });
    const selected = new Set(status.map(s => s.file));
    changes.append(h('div', { class: 'card-head' }, h('h3', { text: status.length ? tr('kobra.git.changes', { n: status.length }) : tr('kobra.git.noChanges') })));
    for (const s of status) {
      const cb = h('input', { type: 'checkbox', checked: true, 'aria-label': tr('kobra.git.include', { file: s.file }) });
      cb.addEventListener('change', () => { if (cb.checked) selected.add(s.file); else selected.delete(s.file); });
      const name = h('button', { class: 'change-name', type: 'button', text: s.file });
      name.addEventListener('click', () => this.showDiff(project, s));
      const badge = h('span', { class: `badge k-${s.kind === '?' ? 'U' : s.kind}`, text: { M: tr('kobra.git.modified'), A: 'neu', D: tr('kobra.git.deleted'), '?': 'neu' }[s.kind] });
      const undo = h('button', { class: 'icon-btn small', type: 'button', 'aria-label': tr('kobra.git.discard'), title: tr('kobra.git.discard'), html: icon('undo') });
      undo.addEventListener('click', async () => {
        if (!(await confirmDialog(tr('kobra.git.discard'), tr('kobra.git.discardConfirm', { file: s.file }), { okLabel: tr('kobra.git.discardOk'), danger: true }))) return;
        await this.guard(async () => { await this.svc.discard(project, s.file); this.onFilesChanged?.([s.file]); });
      });
      changes.append(h('div', { class: 'change-row' }, cb, name, badge, undo));
    }
    if (status.length) {
      const msg = h('textarea', { class: 'field commit-msg', rows: '2', placeholder: tr('kobra.git.message'), id: 'commit-msg' });
      const commitBtn = h('button', { class: 'btn primary', type: 'button', html: `${icon('check')}<span>Commit</span>` });
      commitBtn.addEventListener('click', () => this.guard(async () => {
        const text = msg.value.trim();
        if (!text) { toast(tr('kobra.git.needMessage'), 'error'); msg.focus(); throw new Error(''); }
        if (!selected.size) { toast(tr('kobra.git.noFile'), 'error'); throw new Error(''); }
        if (!acc.name) toast(tr('kobra.git.tipIdentity', { v: accountLabel(acc) }));
        await this.svc.commit(project, text, [...selected]);
        toast(tr('kobra.git.committed'), 'ok');
      }));
      changes.append(msg, commitBtn);
    }
    this.root.append(changes);

    // Verlauf
    const hist = h('section', { class: 'card' }, h('h3', { text: tr('kobra.git.history') }));
    for (const c of log) {
      const d = new Date(c.commit.author.timestamp * 1000);
      const row = h('button', { class: 'commit-row', type: 'button' },
        h('span', { class: 'commit-msg-text', text: c.commit.message.split('\n')[0] }),
        h('span', { class: 'commit-meta', text: `${c.oid.slice(0, 7)} · ${c.commit.author.name} · ${d.toLocaleString(getLang() === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}` }));
      row.addEventListener('click', () => this.showCommit(project, c));
      hist.append(row);
    }
    if (!log.length) hist.append(h('p', { class: 'empty', text: tr('kobra.git.noCommits') }));
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
      if (!isTextFile(s.file)) { toast(tr('kobra.git.binary')); return; }
      after = await readText(`${dir}/${s.file}`);
    }
    openSheet(s.file, renderDiff(before || '', after || ''), { full: true });
  }

  async showCommit(project, c) {
    const files = await this.svc.changedInCommit(project, c);
    const body = h('div', { class: 'commit-detail' });
    const d = new Date(c.commit.author.timestamp * 1000);
    body.append(h('p', { class: 'commit-full', text: c.commit.message }), h('p', { class: 'muted', text: `${c.oid} · ${c.commit.author.name} <${c.commit.author.email}> · ${d.toLocaleString(getLang() === 'de' ? 'de-DE' : 'en-GB')}` }));
    for (const f of files) {
      const row = h('div', { class: 'change-row' });
      const name = h('button', { class: 'change-name', type: 'button', text: f.file });
      name.addEventListener('click', async () => {
        const parent = c.commit.parent[0];
        const before = parent ? await this.svc.contentAt(project, parent, f.file) : '';
        const after = await this.svc.contentAt(project, c.oid, f.file);
        openSheet(`${f.file} @ ${c.oid.slice(0, 7)}`, renderDiff(before || '', after || ''), { full: true });
      });
      const restore = h('button', { class: 'icon-btn small', type: 'button', title: tr('kobra.git.restoreFile'), 'aria-label': tr('kobra.git.restoreFile'), html: icon('history') });
      restore.addEventListener('click', async () => {
        if (f.kind === 'D') { toast(tr('kobra.git.deletedInCommit')); return; }
        if (!(await confirmDialog(tr('kobra.git.restoreTitle'), tr('kobra.git.restoreConfirm', { file: f.file, v: c.oid.slice(0, 7) }), { okLabel: tr('kobra.git.restoreOk'), danger: true }))) return;
        try {
          await this.svc.restoreFile(project, c.oid, f.file);
          this.onFilesChanged?.([f.file]);
          toast(tr('kobra.git.restored'), 'ok');
        } catch (e) { toast(explainGitError(e), 'error'); }
      });
      row.append(h('span', { class: `badge k-${f.kind}`, text: { M: tr('kobra.git.modified'), A: 'neu', D: tr('kobra.git.deleted') }[f.kind] }), name, restore);
      body.append(row);
    }
    openSheet('Commit', body, { full: true });
  }

  async branchMenu(br) {
    const project = this.getProject();
    const items = br.list.map(b => ({ label: b, icon: b === br.current ? 'check' : 'branch', value: `co:${b}`, disabled: b === br.current }));
    items.push('-', { label: tr('kobra.git.newBranch'), icon: 'plus', value: 'new' });
    const others = br.list.filter(b => b !== br.current);
    if (others.length) items.push({ label: tr('kobra.git.mergeBranch'), icon: 'git', value: 'merge' }, { label: tr('kobra.git.deleteBranch'), icon: 'trash', value: 'del', danger: true });
    const v = await actionSheet(tr('kobra.git.branches'), items);
    if (!v) return;
    if (v.startsWith('co:')) {
      const status = await this.svc.status(project);
      if (status.length && !(await confirmDialog(tr('kobra.git.switchBranch'), tr('kobra.git.switchConfirm'), { okLabel: tr('kobra.git.switchOk'), danger: true }))) return;
      await this.guard(async () => { await this.svc.checkoutBranch(project, v.slice(3)); this.onFilesChanged?.(null); toast(tr('kobra.git.onBranch', { v: v.slice(3) }), 'ok'); });
    } else if (v === 'new') {
      const name = await promptDialog(tr('kobra.git.newBranchTitle'), { label: tr('kobra.name'), placeholder: tr('kobra.git.branchExample'), validate: (s) => /^[\w.\-/]+$/.test(s) ? null : tr('kobra.git.branchChars') });
      if (name) await this.guard(() => this.svc.createBranch(project, name));
    } else if (v === 'merge' || v === 'del') {
      const pick = await actionSheet(v === 'merge' ? tr('kobra.git.mergeInto', { current: br.current }) : tr('kobra.git.deleteBranchTitle'), others.map(b => ({ label: b, value: b, icon: 'branch', danger: v === 'del' })));
      if (!pick) return;
      if (v === 'merge') await this.guard(async () => { await this.svc.merge(project, pick); this.onFilesChanged?.(null); toast(tr('kobra.git.merged', { pick }), 'ok'); });
      else if (await confirmDialog(tr('kobra.git.deleteBranchTitle'), tr('kobra.git.deleteBranchConfirm', { pick }), { okLabel: tr('kobra.delete'), danger: true })) await this.guard(() => this.svc.deleteBranch(project, pick));
    }
  }

  async accountMenu(project, current) {
    const all = accounts();
    const items = all.map((a) => ({ label: accountLabel(a), detail: [a.name, a.email].filter(Boolean).join(' · ') || (a.token ? '' : tr('kobra.git.noToken')), value: a.id, icon: a.id === current.id ? 'check' : 'user' }));
    items.push('-', { label: tr('kobra.git.manageAccounts'), value: '#settings', icon: 'settings' });
    const v = await actionSheet(tr('kobra.git.accountFor', { project }), items);
    if (!v) return;
    if (v === '#settings') { this.openSettings?.('git'); return; }
    await this.svc.setAccount(project, v);
    toast(tr('kobra.git.nowCommitsAs', { project, v: accountLabel(account(v)) }), 'ok');
    this.refresh();
  }

  async remoteDialog(current) {
    const url = await promptDialog('GitHub-Repository', {
      label: tr('kobra.git.remoteAddress'), value: current, placeholder: 'https://github.com/name/projekt.git',
      hint: tr('kobra.git.remoteHint'),
      validate: (s) => /^https:\/\/\S+$/.test(s.trim()) ? null : tr('kobra.git.needHttps'),
    });
    if (!url) return;
    await this.guard(() => this.svc.setRemote(this.getProject(), url.trim()));
  }

  async remoteOp(kind) {
    const project = this.getProject();
    const acc = await this.svc.accountOf(project);
    const url = await this.svc.originUrl(project);
    const proxy = loadPref('git.proxy', '');
    if (!proxy || (kind === 'push' && !tokenFor(acc, url))) {
      const noToken = kind === 'push' && !tokenFor(acc, url);
      const go = await modal({
        title: tr('kobra.git.setup'),
        body: h('p', { text: noToken ? (acc.token ? tr('kobra.git.tokenOtherHost', { v: accountLabel(acc), host: acc.host }) : (proxy ? tr('kobra.git.tokenNeeded', { v: accountLabel(acc) }) : tr('kobra.git.tokenProxyNeeded', { v: accountLabel(acc) }))) : tr('kobra.git.proxyNeeded') }),
        actions: [{ label: tr('kobra.cancel'), value: false }, { label: tr('kobra.git.toSettings'), kind: 'primary', value: true }],
      });
      if (go) this.openSettings?.('git');
      return;
    }
    const prog = toastProgress(kind === 'push' ? tr('kobra.git.uploadingAs', { v: accountLabel(acc) }) : tr('kobra.git.fetching'));
    await this.guard(async () => {
      try {
        if (kind === 'push') { await this.svc.push(project, prog.update); toast(tr('kobra.git.uploaded'), 'ok'); }
        else {
          const st = await this.svc.status(project);
          if (st.some(x => x.kind !== '?')) {
            prog.done();
            toast(tr('kobra.git.commitFirst'), 'error', 4000);
            return;
          }
          await this.svc.pull(project, prog.update);
          this.onFilesChanged?.(null);
          toast(tr('kobra.git.upToDate'), 'ok');
        }
      } finally { prog.done(); }
    });
  }

  // url und name: aus der Liste deiner Repositorys (Projekte › „Noch nicht auf diesem Gerät“)
  async cloneDialog(url0 = '', name0 = '') {
    const all = accounts();
    const urlIn = h('input', { class: 'field', type: 'url', value: url0, placeholder: 'https://github.com/name/projekt.git', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', id: 'clone-url' });
    const accIn = h('select', { class: 'field', id: 'clone-account' });
    const auto = h('option', { value: '', text: tr('kobra.git.byOwner') });
    accIn.append(auto, ...all.map((a) => h('option', { value: a.id, text: accountLabel(a) })));
    const guess = () => { const a = /^https:\/\/\S+$/.test(urlIn.value.trim()) ? accountForUrl(urlIn.value.trim()) : null; auto.textContent = a ? tr('kobra.git.byOwnerIs', { v: accountLabel(a) }) : tr('kobra.git.byOwner'); };
    urlIn.addEventListener('input', guess);
    const chosen = url0 && repoEntry(url0)?.account;
    if (chosen && all.some((a) => a.id === chosen)) accIn.value = chosen;
    guess();
    const err = h('div', { class: 'field-error' });
    const body = h('div', { class: 'form' },
      h('label', { class: 'field-label', for: 'clone-url', text: 'HTTPS-Adresse' }), urlIn,
      all.length > 1 ? h('label', { class: 'field-label', for: 'clone-account', text: tr('kobra.acc.account') }) : null, all.length > 1 ? accIn : null, err);
    const res = await modal({
      title: tr('kobra.git.cloneTitle'), body,
      actions: [{ label: tr('kobra.cancel'), value: null }, { label: tr('kobra.git.clone'), kind: 'primary', value: () => {
        const u = urlIn.value.trim();
        if (!/^https:\/\/\S+$/.test(u)) { err.textContent = tr('kobra.git.needHttps'); return undefined; }
        return { url: u, acc: accIn.value };
      } }],
      onOpen: () => setTimeout(() => (url0 ? accIn : urlIn).focus(), 60),
    });
    if (!res) return;
    if (!loadPref('git.proxy', '')) {
      toast(tr('kobra.git.cloneNeedsProxy'), 'error', 5000);
      this.openSettings?.('git');
      return;
    }
    const base = (name0 || decodeURIComponent(res.url.replace(/\.git$/, '').split('/').pop() || 'Klon')).replace(/[\/\\:*?"<>|]/g, '-').slice(0, 60) || 'Klon';
    let name = base;
    for (let i = 2; await exists(projectPath(name)); i++) name = `${base} ${i}`;
    const prog = toastProgress(tr('kobra.git.cloning'));
    try {
      await this.svc.clone(name, res.url, prog.update, res.acc);
      toast(tr('kobra.git.cloned', { name }), 'ok');
      this.onProjectsChanged?.(name);
    } catch (e) {
      await rmrf(projectPath(name)).catch(() => {});
      toast(explainGitError(e), 'error', 6000);
    } finally { prog.done(); }
  }
}

function toastProgress(label) {
  const el = h('div', { class: 'progress-toast' }, h('span', { class: 'spinner' }), h('span', { text: label }));
  overlayHost().append(el);
  const text = el.lastChild;
  return {
    update: (p) => { if (p?.phase) text.textContent = `${label} ${p.phase}${p.total ? ` ${Math.round((p.loaded / p.total) * 100)} %` : ''}`; },
    done: () => el.remove(),
  };
}
