// Sync service: brings the private knowledge repository onto this device and back.
// Built from Kobra's GitService (git.js). One button does everything: save the changes made on this device,
// fetch from GitHub, combine both sides and upload. When the same file changed here and on GitHub and the
// changes cannot be combined line by line, both versions stay: GitHub's at the original path, this device's
// next to it as "<name>.conflict-<device>-<date>.md". You decide which one stays.
import { git, http, diff3Merge } from '../../vendor/git.js';
import { fs, KNOWLEDGE, exists, flush, listTree, removeFile, requestPersist, rmrf, writeFile } from './storage.js';
import { loadPref, savePref } from './prefs.js';
import { t } from '../i18n/i18n.js';

const dir = KNOWLEDGE;

// ------------------------------------------------------------------ settings
export function syncSettings() {
  return {
    repo: loadPref('sync.repo', ''),
    branch: loadPref('sync.branch', ''),
    token: loadPref('sync.token', ''),
    proxy: loadPref('sync.proxy', ''),
    name: loadPref('sync.name', ''),
    email: loadPref('sync.email', ''),
    device: loadPref('sync.device', '') || defaultDevice(),
  };
}

export function saveSyncSetting(key, value) {
  savePref(`sync.${key}`, String(value ?? '').trim());
  emit();
}

export function defaultDevice() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Browser';
}

// "ente/knowledge" becomes https://github.com/ente/knowledge.git; full addresses stay as they are.
export function repoUrl(repo = syncSettings().repo) {
  const r = String(repo || '').trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(r)) return `https://github.com/${r.replace(/\.git$/, '')}.git`;
  if (/^https?:\/\/\S+$/.test(r)) return r;
  return '';
}

export const isConfigured = () => !!repoUrl();

// Kobra keeps its settings on the same address with the prefix "kobra.". The installed apps on the iPhone
// each have their own storage, so this only finds something in the browser.
export function kobraSettings() {
  const read = (k) => {
    try { const v = localStorage.getItem(`kobra.git.${k}`); return v ? String(JSON.parse(v)) : ''; } catch { return ''; }
  };
  return { proxy: read('proxy'), name: read('name'), email: read('email') };
}

// ------------------------------------------------------------------ state
const state = { busy: false, phase: '', percent: null, error: '', last: loadPref('sync.last', null) };
const listeners = new Set();

export const syncState = () => ({ ...state, configured: isConfigured() });

export function onSyncChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  const s = syncState();
  for (const fn of listeners) fn(s);
}

function setPhase(phase, loaded, total) {
  const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : null;
  if (phase === state.phase && percent === state.percent) return;
  state.phase = phase;
  state.percent = percent;
  emit();
}

// Text for the current step, e.g. "Receiving objects 45 %".
export function phaseText(s = state) {
  if (!s.phase) return '';
  const key = `sync.phase.${s.phase.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  const label = t(key) === key ? s.phase : t(key);
  return s.percent == null ? label : `${label} ${s.percent} %`;
}

export class SyncError extends Error {
  constructor(code) {
    super(code);
    this.syncCode = code;
  }
}

export function explainSyncError(e) {
  if (e?.syncCode) return t(`sync.err.${e.syncCode}`);
  const s = syncSettings();
  const m = `${e?.code || ''} ${e?.message || e}`;
  if (!navigator.onLine) return t('sync.err.offline');
  if (/UserCanceledError|HttpError.*\b40[13]\b|\b401\b|\b403\b/.test(m)) return t(s.token ? 'sync.err.auth' : 'sync.err.noToken');
  if (/Failed to fetch|NetworkError|Load failed|CORS|network connection/i.test(m)) {
    if (s.proxy) return t('sync.err.proxy');
    return /github\.com/.test(repoUrl(s.repo)) ? t('sync.err.noProxy') : t('sync.err.network');
  }
  if (/\b404\b/.test(m)) return t('sync.err.notFound');
  if (/PushRejected|fast-forward/i.test(m)) return t('sync.err.pushRejected');
  if (/NotFoundError/.test(m)) return t('sync.err.branch');
  return m.trim().split('\n')[0];
}

// ------------------------------------------------------------------ git options
function remoteOpts(s) {
  const o = { http, onProgress: (p) => setPhase(p.phase, p.loaded, p.total) };
  if (s.proxy) o.corsProxy = s.proxy.replace(/\/+$/, '');
  o.onAuth = () => (s.token ? { username: 'x-access-token', password: s.token } : { cancel: true });
  o.onAuthFailure = () => ({ cancel: true });
  return o;
}

const author = (s) => ({ name: s.name || `Toollib (${s.device})`, email: s.email || 'toollib@example.invalid' });

// ------------------------------------------------------------------ sync
let running = null;

export function syncKnowledge() {
  if (!running) running = run().finally(() => { running = null; });
  return running;
}

export const isSyncing = () => !!running;

async function run() {
  const s = syncSettings();
  const url = repoUrl(s.repo);
  state.busy = true;
  state.error = '';
  setPhase('start');
  const cache = {};
  try {
    if (!url) throw new SyncError('notConfigured');
    if (!navigator.onLine) throw new SyncError('offline');
    const result = (await exists(`${dir}/.git`)) ? await update(s, url, cache) : await cloneRepo(s, url, cache);
    const stats = await knowledgeStats();
    state.last = {
      time: Date.now(),
      kind: result.kind,
      head: stats?.head || '',
      nodes: stats?.total || 0,
      uploaded: result.uploaded || 0,
      conflicts: result.conflicts || [],
      kept: result.kept || [],
    };
    savePref('sync.last', state.last);
    requestPersist();
    return state.last;
  } catch (e) {
    console.warn('Sync failed', e);
    state.error = explainSyncError(e);
    throw e;
  } finally {
    state.busy = false;
    state.phase = '';
    state.percent = null;
    emit();
  }
}

async function cloneRepo(s, url, cache) {
  await rmrf(dir); // leftovers of an interrupted first sync
  const opts = { fs, dir, url, singleBranch: true, cache, ...remoteOpts(s) };
  if (s.branch) opts.ref = s.branch;
  try {
    await git.clone(opts);
  } catch (e) {
    await rmrf(dir);
    throw e;
  }
  await flush();
  return { kind: 'cloned' };
}

async function update(s, url, cache) {
  // The address in the settings wins over the one stored in the local copy.
  const origin = (await git.listRemotes({ fs, dir })).find((r) => r.remote === 'origin');
  if (!origin || origin.url !== url) await git.addRemote({ fs, dir, remote: 'origin', url, force: true });
  const branch = (await git.currentBranch({ fs, dir })) || s.branch || 'main';

  let uploaded = await commitChanges(s, `Sync from ${s.device}`, cache);
  let kind = 'upToDate';
  const conflicts = [];
  const kept = [];

  // A second device may upload between our fetch and our push; then fetch and combine once more.
  for (let attempt = 0; attempt < 3; attempt++) {
    setPhase('fetch');
    await git.fetch({ fs, dir, remote: 'origin', ref: branch, singleBranch: true, tags: false, cache, ...remoteOpts(s) });
    const local = await git.resolveRef({ fs, dir, ref: `refs/heads/${branch}` });
    let remote = null;
    try { remote = await git.resolveRef({ fs, dir, ref: `refs/remotes/origin/${branch}` }); } catch { /* branch not on GitHub yet */ }

    if (remote === local) break;
    if (remote) {
      const [base] = await git.findMergeBase({ fs, dir, oids: [local, remote], cache });
      if (!base) throw new SyncError('unrelated');
      if (base === local) { // only GitHub has news
        await moveTo(branch, remote, cache);
        kind = 'pulled';
        break;
      }
      if (base !== remote) { // both sides have news
        const r = await combine(s, branch, base, local, remote, cache);
        conflicts.push(...r.conflicts);
        kept.push(...r.kept);
        uploaded += r.uploaded;
        kind = 'merged';
      }
    }
    setPhase('push');
    try {
      const res = await git.push({ fs, dir, remote: 'origin', ref: branch, cache, ...remoteOpts(s) });
      if (res && res.ok === false) throw new Error(res.error || 'PushRejected');
    } catch (e) {
      if (/PushRejected|fast-forward/i.test(`${e?.code} ${e?.message}`) && attempt < 2) continue;
      throw e;
    }
    if (kind === 'upToDate') kind = 'pushed';
    break;
  }
  return { kind, uploaded, conflicts, kept };
}

// Saves everything that changed on this device as one commit. Returns the number of changed files.
async function commitChanges(s, message, cache) {
  const matrix = await git.statusMatrix({ fs, dir, cache });
  let n = 0;
  for (const [filepath, head, work, stage] of matrix) {
    if (head === 1 && work === 1 && stage === 1) continue;
    if (work === 0) await git.remove({ fs, dir, filepath, cache });
    else await git.add({ fs, dir, filepath, cache });
    n++;
  }
  if (!n) return 0;
  setPhase('commit');
  await git.commit({ fs, dir, message, author: author(s), cache });
  await flush();
  return n;
}

// Points the branch at another commit and brings the files in line with it.
async function moveTo(branch, oid, cache) {
  await git.writeRef({ fs, dir, ref: `refs/heads/${branch}`, value: oid, force: true });
  await git.checkout({ fs, dir, ref: branch, force: true, cache, onProgress: (p) => setPhase(p.phase, p.loaded, p.total) });
  await flush();
}

// Both sides changed since the common base. GitHub's state becomes the starting point and this device's
// changes are applied on top, file by file.
async function combine(s, branch, base, local, remote, cache) {
  setPhase('combine');
  const mine = await changedFiles(base, local, cache);
  const theirs = await changedFiles(base, remote, cache);
  await moveTo(branch, remote, cache);
  const conflicts = [];
  const kept = [];
  const stamp = timestamp();
  for (const [path, oid] of mine) {
    const target = `${dir}/${path}`;
    if (!theirs.has(path)) { // untouched on GitHub: take this device's version
      if (oid) await writeFile(target, await blob(oid, cache), { noFlush: true });
      else await removeFile(target, { noFlush: true });
      continue;
    }
    const other = theirs.get(path);
    if (oid === other || !oid) continue; // same result, or deleted here but changed on GitHub: GitHub's version stays
    const ours = await blob(oid, cache);
    if (!other) { // deleted on GitHub but changed here: keep this device's version
      await writeFile(target, ours, { noFlush: true });
      kept.push(path);
      continue;
    }
    const merged = mergeText(await blobAt(base, path, cache), ours, await blob(other, cache));
    if (merged != null) {
      await writeFile(target, merged, { noFlush: true });
      continue;
    }
    const copy = conflictName(path, s.device, stamp);
    await writeFile(`${dir}/${copy}`, ours, { noFlush: true });
    conflicts.push({ path, copy });
  }
  await flush();
  const message = conflicts.length
    ? `Sync from ${s.device}: kept both versions of ${conflicts.length} file(s)`
    : `Sync from ${s.device}`;
  const uploaded = await commitChanges(s, message, cache);
  return { conflicts, kept, uploaded };
}

// Files that differ between two commits: path -> blob id in the second commit, or null if deleted there.
async function changedFiles(fromOid, toOid, cache) {
  const out = new Map();
  await git.walk({
    fs, dir, cache,
    trees: [git.TREE({ ref: fromOid }), git.TREE({ ref: toOid })],
    map: async (path, [a, b]) => {
      if (path === '.') return true;
      const ta = a ? await a.type() : null;
      const tb = b ? await b.type() : null;
      if (ta === 'tree' || tb === 'tree') {
        if (ta === 'blob') out.set(path, null);
        if (tb === 'blob') out.set(path, await b.oid());
        return true;
      }
      const oa = a ? await a.oid() : null;
      const ob = b ? await b.oid() : null;
      if (oa !== ob) out.set(path, ob);
      return true;
    },
  });
  return out;
}

async function blob(oid, cache) {
  return (await git.readBlob({ fs, dir, oid, cache })).blob;
}

async function blobAt(commit, filepath, cache) {
  try { return (await git.readBlob({ fs, dir, oid: commit, filepath, cache })).blob; } catch { return null; }
}

// Line-by-line three-way merge like git's. Returns the merged text, or null if the same lines
// changed on both sides or a file is not text.
const LINES = /^.*(\r?\n|$)/gm;
function mergeText(base, ours, theirs) {
  const dec = new TextDecoder('utf-8', { fatal: true });
  let o, a, b;
  try {
    o = base ? dec.decode(base) : '';
    a = dec.decode(ours);
    b = dec.decode(theirs);
  } catch {
    return null;
  }
  let text = '';
  for (const part of diff3Merge(a.match(LINES), o.match(LINES), b.match(LINES))) {
    if (part.conflict) return null;
    text += part.ok.join('');
  }
  return text;
}

function conflictName(path, device, stamp) {
  const slash = path.lastIndexOf('/');
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const dev = device.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'device';
  return `${path.slice(0, slash + 1)}${stem}.conflict-${dev}-${stamp}${ext}`;
}

function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

// ------------------------------------------------------------------ connection test and local copy
// Checks reading and writing. Returns { branches, defaultBranch, canPush }.
export async function testConnection() {
  const s = syncSettings();
  const url = repoUrl(s.repo);
  if (!url) throw new SyncError('notConfigured');
  if (!navigator.onLine) throw new SyncError('offline');
  const opts = { url, ...remoteOpts(s) };
  const info = await git.getRemoteInfo(opts);
  const branches = Object.keys(info.refs?.heads || {});
  const defaultBranch = (info.HEAD || '').replace(/^refs\/heads\//, '') || branches[0] || '';
  let canPush = false;
  try { await git.getRemoteInfo({ ...opts, forPush: true }); canPush = true; } catch { /* read only */ }
  return { branches, defaultBranch, canPush };
}

export const hasLocalCopy = () => exists(`${dir}/.git`);

// Changes on this device that GitHub does not have yet.
export async function pendingChanges() {
  if (!(await hasLocalCopy())) return 0;
  let n = 0;
  for (const [, head, work, stage] of await git.statusMatrix({ fs, dir })) if (!(head === 1 && work === 1 && stage === 1)) n++;
  try {
    const branch = await git.currentBranch({ fs, dir });
    const local = await git.resolveRef({ fs, dir, ref: `refs/heads/${branch}` });
    const remote = await git.resolveRef({ fs, dir, ref: `refs/remotes/origin/${branch}` });
    if (local !== remote) {
      const [base] = await git.findMergeBase({ fs, dir, oids: [local, remote] });
      if (base !== local) n++;
    }
  } catch { /* nothing to compare */ }
  return n;
}

export async function removeLocalCopy() {
  if (running) throw new SyncError('busy');
  await rmrf(dir);
  state.last = null;
  state.error = '';
  savePref('sync.last', null);
  emit();
}

// Counts the Markdown files per folder: nodes/<folder> for nodes, otherwise the top folder.
export async function knowledgeStats() {
  if (!(await hasLocalCopy())) return null;
  const groups = new Map();
  const conflicts = [];
  let total = 0;
  for (const f of await listTree(dir)) {
    if (f.type !== 'file' || !f.path.endsWith('.md') || !f.path.includes('/')) continue;
    const parts = f.path.split('/');
    const group = parts[0] === 'nodes' && parts.length > 2 ? parts[1] : parts[0];
    groups.set(group, (groups.get(group) || 0) + 1);
    total++;
    if (f.path.includes('.conflict-')) conflicts.push(f.path);
  }
  let head = '';
  try { head = await git.resolveRef({ fs, dir, ref: 'HEAD' }); } catch { /* empty */ }
  return { total, groups: [...groups].sort((a, b) => a[0].localeCompare(b[0])), conflicts, head };
}
