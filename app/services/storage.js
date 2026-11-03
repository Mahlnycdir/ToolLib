// Storage service: files on this device in IndexedDB through LightningFS. Taken from Kobra's storage.js.
// Changes for Toollib: one file system "toollib" with two areas, /knowledge (the knowledge repository)
// and /projects (code projects, later from Kobra). Kobra keeps its own file system "kobra".
import { LightningFS } from '../../vendor/git.js';

export const fs = new LightningFS('toollib');
export const pfs = fs.promises;
export const KNOWLEDGE = '/knowledge';
export const PROJECTS = '/projects';

const enc = new TextEncoder();
const dec = new TextDecoder();

export const join = (...p) => p.filter(Boolean).join('/').replace(/\/+/g, '/');
export const dirname = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const basename = (p) => p.slice(p.lastIndexOf('/') + 1);

// LightningFS writes its table of contents lazily. Save it right after every change,
// so nothing is lost when iOS closes the app.
let flushing = null;
let flushAgain = false;
export function flush() {
  if (flushing) { flushAgain = true; return flushing; }
  flushing = (async () => {
    do {
      flushAgain = false;
      try { await pfs.flush(); } catch { /* next attempt */ }
    } while (flushAgain);
    flushing = null;
  })();
  return flushing;
}

export async function exists(p) {
  try { await pfs.stat(p); return true; } catch { return false; }
}

export async function mkdirp(p) {
  const parts = p.split('/').filter(Boolean);
  let cur = '';
  for (const part of parts) {
    cur += '/' + part;
    try { await pfs.mkdir(cur); } catch (e) { if (e.code !== 'EEXIST' && !(await exists(cur))) throw e; }
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

export async function removeFile(p, { noFlush = false } = {}) {
  try { await pfs.unlink(p); } catch { /* already gone */ }
  if (!noFlush) await flush();
}

export async function rmrf(p) {
  await rmrfInner(p);
  await flush();
}

async function rmrfInner(p) {
  let st;
  try { st = await pfs.stat(p); } catch { return; }
  if (st.isDirectory()) {
    for (const name of await pfs.readdir(p)) await rmrfInner(`${p}/${name}`);
    await pfs.rmdir(p);
  } else {
    await pfs.unlink(p);
  }
}

// All files below dir (without .git), relative to dir.
export async function listTree(dir, { includeGit = false } = {}) {
  const out = [];
  async function walk(rel) {
    const full = rel ? `${dir}/${rel}` : dir;
    let names;
    try { names = await pfs.readdir(full); } catch { return; }
    names.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
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

export async function storageInfo() {
  const info = { persisted: false, usage: 0, quota: 0 };
  try {
    if (navigator.storage?.persisted) info.persisted = await navigator.storage.persisted();
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      info.usage = e.usage || 0;
      info.quota = e.quota || 0;
    }
  } catch { /* not available */ }
  return info;
}

// Asks the browser to keep the files even when space runs low.
export async function requestPersist() {
  try { return (await navigator.storage?.persist?.()) || false; } catch { return false; }
}
