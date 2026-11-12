// Notes (0.15.0): catch a thought in one step, sort it later. A note is a node in your knowledge:
//   notes/<name>.md   type: note; title (its first line), at (when you wrote it), your text below
// A note that belongs to no project waits in the inbox. From there it goes into a project, becomes a card or a
// snippet, starts a search, or is deleted.
import { KNOWLEDGE, exists } from './storage.js';
import { deleteNode, parseNode, readNodeText, setField, slugify, writeNode } from './nodes.js';
import { allNodes, forgetNode, nodeBySlug, refreshNode } from './search.js';
import { noteChange } from './sync.js';
import { announce } from './channel.js';
import { addToProject, projects, skipAutoLink } from './projects.js';

const q = (v) => JSON.stringify(String(v));
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

// The first line of a text as a title: without Markdown marks, at most 70 characters.
export function noteTitle(text) {
  const line = String(text).split('\n').map((l) => l.trim()).find(Boolean) || '';
  const plain = line.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (all, a, b) => b || a).replace(/^#+\s*/, '').replace(/^[-*+]\s+/, '').replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > 70 ? `${plain.slice(0, 69).trimEnd()}…` : plain;
}

export const notes = () => allNodes().filter((d) => d.type === 'note' && !d.conflict).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
// Notes that belong to no project yet, newest first.
export function inbox() {
  const filed = new Set(projects().flatMap((p) => p.links));
  return notes().filter((d) => !filed.has(d.slug));
}

async function freePath(base) {
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const path = `notes/${slug}.md`;
    if (!nodeBySlug(slug) && !(await exists(`${KNOWLEDGE}/${path}`))) return path;
  }
}

export function noteText({ text, at = stamp() }) {
  const body = String(text).replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  return `---\ntype: note\ntitle: ${q(noteTitle(body) || at.slice(0, 10))}\nat: ${q(at)}\ncreated: ${q(at.slice(0, 10))}\nsource: you\n---\n\n${body}\n`;
}

// Writes a note. project: the path of a project it goes into right away (otherwise the project in focus takes it,
// or it waits in the inbox). inbox: true keeps it out of the project in focus. Returns its path.
export async function capture(text, { project = '', inbox: stay = false } = {}) {
  const body = String(text || '').trim();
  if (!body) throw new Error('Nothing to note');
  const at = stamp();
  const path = await freePath(`note-${at.slice(0, 10)}-${slugify(noteTitle(body)).slice(0, 32) || 'note'}`.replace(/-+$/, ''));
  if (project || stay) skipAutoLink(path);
  await writeNode(path, noteText({ text: body, at }));
  await refreshNode(path);
  await noteChange(path, 'added');
  announce([path]);
  if (project) await addToProject(project, [path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')]);
  return path;
}

export async function loadNote(path) {
  const node = parseNode(await readNodeText(path), path);
  return { path, slug: node.slug, title: String(node.meta.title || ''), at: String(node.meta.at || node.meta.created || ''), text: node.body.replace(/^\n+/, '').replace(/\s+$/, '') };
}

// Your text changed: the body and, with it, the title (its first line).
export async function saveNote(path, text) {
  const before = await readNodeText(path);
  const m = before.match(/^(﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$))/);
  if (!m) return false;
  const body = String(text).replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  // a handwritten note (0.21.0) keeps the title you gave it in Kladde
  const title = /^ink:\s*\S/m.test(m[1]) ? '' : noteTitle(body);
  const head = title ? setField(m[1], 'title', q(title)) : m[1];
  const next = `${head}\n${body}\n`;
  if (next === before) return false;
  await writeNode(path, next);
  await refreshNode(path);
  await noteChange(path, 'edited');
  announce([path]);
  return true;
}

export async function deleteNote(path) {
  await deleteNode(path);
  forgetNode(path);
  await noteChange(path, 'removed');
  announce([path]);
}
