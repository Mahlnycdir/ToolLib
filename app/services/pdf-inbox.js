// The PDF folder on your Mac (0.14.4). The Mac helper keeps the PDFs Toollib reads as originals in
// ~/Toollib-PDFs/<site>/ (file: in the clip). PDFs you put into ~/Toollib-PDFs/Eingang/ become clips with their text
// in your folder "PDF folder" (research/<name>.md with pdf_inbox: true); then the helper moves them to Eigene/. The
// same file (same sha1) becomes one clip only. Runs where the helper answers: on the Mac, on the iPhone at home.
//   clips/<name>.md  type: clip; kind: "document"; title; file; file_sha1; text_via: "pdf"; ## Text; source: scraper
import { helperFetch, helperReady, ResearchError } from './research.js';
import { KNOWLEDGE, exists } from './storage.js';
import { readNodeText, setField, slugify, writeNode } from './nodes.js';
import { allNodes, indexState, nodeBySlug, onIndexChange, refreshNode } from './search.js';
import { isConfigured, isSyncing, noteChanges, syncState } from './sync.js';
import { announce } from './channel.js';
import { addToFolder, createFolder } from './research-store.js';
import { composeBody } from './reader.js';

const LOCK = 'toollib-inbox';
const q = (v) => JSON.stringify(String(v));
const today = () => new Date().toISOString().slice(0, 10);
const listeners = new Set();
export const onInbox = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const tell = (x) => { for (const fn of listeners) { try { fn(x); } catch (e) { console.warn(e); } } };

export const inboxFolder = () => allNodes().find((d) => d.type === 'research' && d.pdfInbox && !d.conflict) || null;
export const clipBySha1 = (sha1) => (sha1 ? allNodes().find((d) => d.type === 'clip' && !d.conflict && d.fileSha1 === sha1) || null : null);

// The PDFs waiting in your inbox: [{ path, name, size, mtime, sha1 }].
export async function inboxFiles({ signal } = {}) {
  const res = await helperFetch('/files', { signal });
  return (await res.json()).files || [];
}

// A file of the PDF folder as a blob address (the original of a clip); found by its sha1 when it moved.
export async function originalUrl(file, sha1 = '') {
  const res = await helperFetch(`/file?path=${encodeURIComponent(file || '')}${sha1 ? `&sha1=${encodeURIComponent(sha1)}` : ''}`);
  return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: 'application/pdf' }));
}

// Opens the original in a new tab (opened before the wait: Safari allows new tabs only right after a tap).
export async function openOriginal(file, sha1 = '') {
  const win = window.open('', '_blank');
  try {
    const url = await originalUrl(file, sha1);
    if (win) win.location.href = url; else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    return true;
  } catch (e) {
    win?.close();
    return false;
  }
}

function indexReady() {
  if (indexState().ready && !indexState().building) return Promise.resolve();
  return new Promise((resolve) => { const off = onIndexChange((st) => { if (st.ready && !st.building) { off(); resolve(); } }); });
}

const niceTitle = (name) => decodeURIComponent(String(name)).replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();

async function freePath(base) {
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const path = `clips/${slug}.md`;
    if (!nodeBySlug(slug) && !(await exists(`${KNOWLEDGE}/${path}`))) return path;
  }
}

export function inboxClipText({ title, file, sha1, name, doc, date = today() }) {
  const head = [
    '---', 'type: clip', 'kind: "document"', `title: ${q(title)}`, `file: ${q(file)}`, `file_sha1: ${q(sha1)}`,
    'sources:', `  - ${JSON.stringify({ title: name, at: file })}`,
    `fetched: ${q(date)}`, 'text_via: "pdf"', `text_fetched: ${q(date)}`, 'source: scraper', 'verified: false', '---',
  ];
  return `${head.join('\n')}\n\n${composeBody([{ title: null, lines: [] }], { lead: doc.abstract || '', text: doc.markdown || '', references: doc.references || [] })}`;
}

async function moveDone(file, clipPath) {
  const res = await helperFetch('/files/imported', { method: 'POST', json: { path: file } });
  const moved = (await res.json()).path;
  if (moved && clipPath) {
    const text = await readNodeText(clipPath);
    const next = setField(text, 'file', q(moved), ['title']);
    if (next !== text) { await writeNode(clipPath, next); await refreshNode(clipPath); }
  }
  return moved;
}

// Reads what waits in the inbox into clips. Resolves to { added, known, failed, folder } or null when another window
// does it already or the helper does not answer. onProgress({ n, total, name, page, pages }).
export async function importInbox({ signal, onProgress, title = 'PDF folder' } = {}) {
  // only into a knowledge that came from GitHub once (a new device would write beside it, then merge)
  if (!isConfigured() || !syncState().last) return null;
  if (!(await helperReady())) return null;
  await indexReady();
  const run = async () => {
    for (let i = 0; i < 600 && isSyncing(); i++) await new Promise((r) => setTimeout(r, 250));
    const files = await inboxFiles({ signal });
    const out = { added: 0, known: 0, failed: 0, folder: inboxFolder()?.path || '', paths: [] };
    if (!files.length) return out;
    tell({ busy: true, total: files.length });
    const changes = [];
    try {
      for (const [i, f] of files.entries()) {
        if (signal?.aborted) break;
        onProgress?.({ n: i + 1, total: files.length, name: f.name });
        try {
          const have = clipBySha1(f.sha1);
          if (have) {   // the same file again (or the last import stopped halfway): only move it
            await moveDone(f.path, have.path);
            changes.push({ path: have.path, what: 'edited' });
            out.known++;
            continue;
          }
          const res = await helperFetch(`/file?path=${encodeURIComponent(f.path)}`, { signal });
          const bytes = new Uint8Array(await res.arrayBuffer());
          const { pdfToDoc } = await import('./reader-pdf.js');
          const doc = await pdfToDoc(bytes, { signal, onProgress: (page, pages) => onProgress?.({ n: i + 1, total: files.length, name: f.name, page, pages }) });
          const t = String(doc.title || '').trim();
          const name = niceTitle(f.name);
          const docTitle = t && t.length > 3 && !/^(untitled|microsoft word|document)/i.test(t) ? t : name;
          if (!out.folder) out.folder = await createFolder({ title, extra: ['pdf_inbox: true'] });
          const base = slugify(docTitle.split(/\s+/).slice(0, 7).join(' ')).slice(0, 48).replace(/-+$/, '') || 'pdf';
          const path = await freePath(base);
          await writeNode(path, inboxClipText({ title: docTitle, file: f.path, sha1: f.sha1, name: f.name, doc }));
          await refreshNode(path);
          await addToFolder(out.folder, path.split('/').pop().replace(/\.md$/, ''));
          await moveDone(f.path, path);
          changes.push({ path, what: 'added' });
          out.paths.push(path);
          out.added++;
        } catch (e) {
          if (signal?.aborted || e?.code === 'aborted') break;
          console.warn('PDF inbox: could not read', f.path, e);
          out.failed++;
        }
      }
    } finally {
      if (changes.length) {
        await noteChanges(changes.map((c) => [c.path, c.what]));
        announce(changes.map((c) => c.path));
      }
      tell({ busy: false, ...out });
    }
    return out;
  };
  if (navigator.locks?.request) return navigator.locks.request(LOCK, { ifAvailable: true }, (lock) => (lock ? run() : null));
  return run();
}

// Now and then while the app is open: what you put into the inbox comes in by itself.
let timer = 0;
export function watchInbox({ every = 5 * 60 * 1000, onDone, title } = {}) {
  const check = async () => {
    if (document.hidden) return;
    try {
      const r = await importInbox({ title: title?.() });
      if (r && (r.added || r.failed)) onDone?.(r);
    } catch (e) {
      if (!(e instanceof ResearchError)) console.warn('PDF inbox', e);
    }
  };
  clearInterval(timer);
  timer = setInterval(check, every);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  return check();
}
