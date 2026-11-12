// Kladde's notes in your knowledge (0.21.0). A handwritten note is a note like any other, with its strokes beside it:
//   notes/kladde-2026-11-12-1905.md    type: note; title, at, created, paper, sheets, ink: <the .ink file>; your text
//   notes/kladde-2026-11-12-1905.ink   the strokes, one per line (ink.js), so Git shows only the strokes that changed
// What the handwriting says (LaTeX from the Mac helper) stands in the note under "## LaTeX (Kladde)", so the search
// finds it and every note view shows it. ink_read: "mac" asks the Mac to read it (background.js, from anywhere).
// Where the magnifier stood on a page belongs to this device only (kladde.lupe), not to the repository.
import { KNOWLEDGE, exists, readText, writeFile, removeFile } from './storage.js';
import { parseNode, readNodeText, removeField, setField, writeNode } from './nodes.js';
import { allNodes, nodeBySlug, refreshNode } from './search.js';
import { deleteNote } from './notes.js';
import { noteChange } from './sync.js';
import { announce } from './channel.js';
import { loadPref, savePref } from './prefs.js';
import { decodeInk, encodeInk, sheetCount, MAX_INK } from './ink.js';

const q = (v) => JSON.stringify(String(v));
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const INK_NAME = /^[a-z0-9][a-z0-9.-]{0,120}\.ink$/;
export const PAPERS = ['grid', 'lines', 'dots', 'blank'];
export const LATEX_HEAD = '## LaTeX (Kladde)';

// The handwritten notes, newest first (from the index: no file is read).
export const inkNotes = () => allNodes().filter((d) => d.type === 'note' && d.ink && !d.conflict)
  .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

export const inkPathOf = (path, ink) => `${path.slice(0, path.lastIndexOf('/') + 1)}${ink}`;
function inkFile(path, ink) {
  if (!INK_NAME.test(ink || '') || !/^notes\/[^/]+\.md$/.test(path)) throw new Error('Not a handwritten note');
  return `${KNOWLEDGE}/${inkPathOf(path, ink)}`;
}

async function freeBase(base) {
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!nodeBySlug(slug) && !(await exists(`${KNOWLEDGE}/notes/${slug}.md`)) && !(await exists(`${KNOWLEDGE}/notes/${slug}.ink`))) return slug;
  }
}

// A new handwritten note. Only written once it has strokes (saveInk with create).
export async function createInkNote({ title, paper = 'grid', strokes = [] }) {
  const at = stamp();
  const slug = await freeBase(`kladde-${at.slice(0, 10)}-${at.slice(11, 13)}${at.slice(14, 16)}`);
  const path = `notes/${slug}.md`;
  const ink = `${slug}.ink`;
  const text = `---\ntype: note\ntitle: ${q(title || at.slice(0, 16).replace('T', ' '))}\nat: ${q(at)}\ncreated: ${q(at.slice(0, 10))}\nsource: you\nink: ${q(ink)}\npaper: ${PAPERS.includes(paper) ? paper : 'grid'}\nsheets: ${sheetCount(strokes)}\n---\n\n`;
  await writeFile(inkFile(path, ink), encodeInk(strokes));
  await writeNode(path, text);
  await refreshNode(path);
  await noteChange(path, 'added');
  announce([path]);
  return path;
}

// { path, title, paper, at, strokes, text, ink, inkRead }
export async function loadInkNote(path) {
  const node = parseNode(await readNodeText(path), path);
  const ink = String(node.meta.ink || '');
  let raw = '';
  try { raw = await readText(inkFile(path, ink)); } catch { raw = ''; }
  return {
    path, ink, title: String(node.meta.title || ''), paper: PAPERS.includes(node.meta.paper) ? node.meta.paper : 'grid',
    at: String(node.meta.at || node.meta.created || ''), inkRead: String(node.meta.ink_read || ''),
    strokes: raw.length > MAX_INK ? [] : decodeInk(raw), text: node.body.replace(/^\n+/, ''),
  };
}

// Writes the strokes and, if they changed, title, paper and sheets in the head. Returns true if anything changed.
export async function saveInk(path, { title, paper, strokes }) {
  const before = await readNodeText(path);
  const node = parseNode(before, path);
  const file = inkFile(path, String(node.meta.ink || ''));
  const ink = encodeInk(strokes);
  let changed = false;
  let old = '';
  try { old = await readText(file); } catch { old = ''; }
  if (old !== ink) { await writeFile(file, ink); changed = true; }
  const m = before.match(/^(﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$))/);
  if (m) {
    let head = m[1];
    if (title && title !== String(node.meta.title || '')) head = setField(head, 'title', q(title));
    if (paper && PAPERS.includes(paper) && paper !== node.meta.paper) head = setField(head, 'paper', paper);
    const sheets = sheetCount(strokes);
    if (Number(node.meta.sheets) !== sheets) head = setField(head, 'sheets', String(sheets));
    if (head !== m[1]) { await writeNode(path, head + before.slice(m[1].length)); changed = true; }
  }
  if (changed) {
    await refreshNode(path);
    await noteChange(path, 'edited');
    announce([path]);
  }
  return changed;
}

export async function deleteInkNote(path) {
  const node = parseNode(await readNodeText(path), path);
  const ink = String(node.meta.ink || '');
  if (INK_NAME.test(ink)) await removeFile(inkFile(path, ink)).catch(() => {});
  await deleteNote(path);
  forgetLupe(path);
}

// What the handwriting says: replaces the section "## LaTeX (Kladde)" (up to the next "## " or the end) with one
// display formula per line. Your own text stays as it is. Also clears ink_read.
export function withLatex(text, lines) {
  const m = text.match(/^(﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$))/);
  const head0 = m ? m[1] : '';
  const head = head0 ? removeField(head0, 'ink_read') : '';
  let body = text.slice(head0.length);
  const clean = lines.map((l) => String(l || '').replace(/\$\$/g, '').replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  const block = clean.length ? `${LATEX_HEAD}\n\n${clean.map((l) => `$$\n${l}\n$$`).join('\n\n')}\n` : '';
  const at = body.split('\n').findIndex((l) => l.trim() === LATEX_HEAD);
  if (at >= 0) {
    const ls = body.split('\n');
    let end = ls.findIndex((l, i) => i > at && /^## /.test(l));
    if (end < 0) end = ls.length;
    const rest = ls.slice(end).join('\n');
    body = `${ls.slice(0, at).join('\n').replace(/\s+$/, '')}${block ? `\n\n${block}` : '\n'}${rest ? `\n${rest}` : ''}`;
  } else if (block) {
    body = `${body.replace(/\s+$/, '')}\n\n${block}`;
  }
  return `${head}${body.replace(/^\n*/, '\n').replace(/\n*$/, '\n')}`;
}

export async function setLatex(path, lines) {
  const before = await readNodeText(path);
  const next = withLatex(before, lines);
  if (next === before) return false;
  await writeNode(path, next);
  await refreshNode(path);
  await noteChange(path, 'edited');
  announce([path]);
  return true;
}

// The lines read last time (to show them again), from the section.
export function latexOf(text) {
  const ls = String(text || '').split('\n');
  const at = ls.findIndex((l) => l.trim() === LATEX_HEAD);
  if (at < 0) return [];
  const out = [];
  let cur = null;
  for (let i = at + 1; i < ls.length && !/^## /.test(ls[i]); i++) {
    if (ls[i].trim() === '$$') { if (cur === null) cur = []; else { out.push(cur.join('\n').trim()); cur = null; } }
    else if (cur) cur.push(ls[i]);
  }
  return out.filter(Boolean);
}

// Ask the Mac to read it (when the helper is out of reach): ink_read: "mac". The Mac clears it when done.
export async function askMac(path) {
  const before = await readNodeText(path);
  const m = before.match(/^(﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$))/);
  if (!m) return false;
  const head = setField(m[1], 'ink_read', q('mac'));
  if (head === m[1]) return false;
  await writeNode(path, head + before.slice(m[1].length));
  await refreshNode(path);
  await noteChange(path, 'edited');
  announce([path]);
  return true;
}

// ------------------------------------------------------------------ this device only
const LUPES = 'kladde.lupe';
export function lupeOf(path) { const all = loadPref(LUPES, {}); const l = all && typeof all === 'object' ? all[path] : null; return l && Number.isFinite(l.x) && Number.isFinite(l.y) && Number.isFinite(l.w) ? l : null; }
export function rememberLupe(path, l) {
  const all = loadPref(LUPES, {});
  const next = all && typeof all === 'object' ? { ...all } : {};
  delete next[path];
  next[path] = { x: Math.round(l.x), y: Math.round(l.y), w: Math.round(l.w) };
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - 100))) delete next[k];
  savePref(LUPES, next);
}
function forgetLupe(path) { const all = loadPref(LUPES, {}); if (all && all[path]) { delete all[path]; savePref(LUPES, all); } }

// ------------------------------------------------------------------ the old Kladde on this address
// The Kladde from GitHub Pages kept its notes in this browser (localStorage, kladde:m:<id> and kladde:b:<id>).
export function oldNotes() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('kladde:m:')) continue;
      const id = k.slice(9);
      const meta = JSON.parse(localStorage.getItem(k) || 'null');
      const body = JSON.parse(localStorage.getItem(`kladde:b:${id}`) || 'null');
      if (meta && body && typeof body.ink === 'string' && body.ink.length < MAX_INK && !localStorage.getItem(`kladde:moved:${id}`)) out.push({ id, meta, body });
    }
  } catch { /* no storage */ }
  return out;
}

export async function moveOldNotes() {
  const moved = [];
  for (const { id, meta, body } of oldNotes()) {
    const strokes = decodeInk(body.ink);
    if (!strokes.length) continue;
    const path = await createInkNote({ title: String(meta.title || '').slice(0, 120), paper: PAPERS.includes(meta.paper) ? meta.paper : 'grid', strokes });
    try { localStorage.setItem(`kladde:moved:${id}`, path); } catch { /* the notes stay where they were */ }
    moved.push(path);
  }
  return moved;
}
