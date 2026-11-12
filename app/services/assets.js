// Images and plots of your pages (0.17.0): files under assets/ in your knowledge, synced like every node.
// A photo is made smaller before it is stored (at most 1600 px on the long side, JPEG), so the repository and the
// iPhone stay light. A Python plot is stored under assets/plots/<hash of its code>.png: it shows on every device at
// once, without running Python again, and a changed plot gets a new file.
import { KNOWLEDGE, writeFile, readBytes, exists, mkdirp } from './storage.js';
import { noteChange } from './sync.js';

export const isAsset = (p) => /^assets\/[\w./-]{1,160}$/.test(String(p)) && !String(p).includes('..');
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
const MAX_SIDE = 1600;

const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
const rand = () => Math.random().toString(36).slice(2, 8);
const safeName = (s) => String(s || '').toLowerCase().replace(/\.[a-z0-9]+$/, '').normalize('NFD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

async function store(path, bytes) {
  await mkdirp(`${KNOWLEDGE}/${path.slice(0, path.lastIndexOf('/'))}`);
  await writeFile(`${KNOWLEDGE}/${path}`, bytes);
  urls.delete(path);
  noteChange(path, 'added');
  return path;
}

// A picture from the clipboard, a drop or the file picker → its path, e.g. "assets/img-20261112-tafel-k3x9q2.jpg".
export async function saveImage(file) {
  if (!(await exists(`${KNOWLEDGE}/.git`))) throw new Error('no-knowledge');
  const type = String(file.type || '');
  if (type === 'image/gif' || type === 'image/svg+xml') {
    const ext = type === 'image/gif' ? 'gif' : 'svg';
    if (ext === 'svg') throw new Error('svg');   // an SVG can carry scripts: not stored
    return store(`assets/img-${stamp()}-${safeName(file.name) || 'bild'}-${rand()}.${ext}`, new Uint8Array(await file.arrayBuffer()));
  }
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('unreadable');
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const hgt = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  const c = canvas.getContext('2d');
  // a small PNG with transparency (a sketch, a screenshot) stays a PNG, everything else becomes a JPEG
  const keepPng = type === 'image/png' && file.size < 600 * 1024 && k === 1;
  if (!keepPng) { c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, hgt); }
  c.drawImage(bmp, 0, 0, w, hgt);
  bmp.close?.();
  const blob = await new Promise((r) => canvas.toBlob(r, keepPng ? 'image/png' : 'image/jpeg', 0.85));
  if (!blob) throw new Error('unreadable');
  return store(`assets/img-${stamp()}-${safeName(file.name) || 'bild'}-${rand()}.${keepPng ? 'png' : 'jpg'}`, new Uint8Array(await blob.arrayBuffer()));
}

// A blob address for an asset (cached while the app runs), or null if it is not on this device.
const urls = new Map();
export async function assetUrl(path) {
  if (!isAsset(path)) return null;
  if (urls.has(path)) return urls.get(path);
  try {
    const bytes = await readBytes(`${KNOWLEDGE}/${path}`);
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    if (ext === 'svg') return null;
    const url = URL.createObjectURL(new Blob([bytes], { type: TYPES[ext] || 'application/octet-stream' }));
    urls.set(path, url);
    return url;
  } catch {
    return null;
  }
}

// The file of a Python plot: assets/plots/<first 12 hex of the SHA-1 of its code>.png
export async function plotPath(code) {
  const data = new TextEncoder().encode(String(code).trim());
  const hash = await crypto.subtle.digest('SHA-1', data);
  return `assets/plots/${[...new Uint8Array(hash)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('')}.png`;
}
export async function savePlot(code, b64) {
  const path = await plotPath(code);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return store(path, bytes);
}
export const hasAsset = async (path) => isAsset(path) && exists(`${KNOWLEDGE}/${path}`);
