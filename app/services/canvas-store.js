// The canvas of a project (0.27.0): where its cards lie on the free surface, and its groups.
//
// Kept beside the project as projects/<name>.canvas in the open JSON Canvas format (jsoncanvas.org), the same one
// Obsidian's Canvas uses, so the file can be opened there too:
//   { "nodes": [ { "id", "type": "file" | "group", "x", "y", "width", "height", "file"?, "label"?, "color"? } ],
//     "edges": [ { "id", "fromNode", "toNode", "color"?, "label"? } ] }
// Only places and groups are read back. The lines are written for Obsidian's sake, but the truth about what is
// linked stays in the knowledge (relations.js: a thread you draw is a link in the node), and the red thread stays in
// the project (`thread:`). So a canvas can never contradict the knowledge.
//
// For Python readers: load returns plain dicts; save takes them and writes one JSON file, like json.dump.
import { KNOWLEDGE, exists, readText, removeFile, writeFile } from './storage.js';
import { noteChange } from './sync.js';
import { post } from './channel.js';

export const canvasPathOf = (projectPath) => projectPath.replace(/\.md$/, '.canvas');
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : fallback);
const okId = (v) => typeof v === 'string' && /^[\w.-]{1,120}$/.test(v);

// { cards: Map slug → { x, y, w, h }, groups: [{ id, x, y, w, h, label, color }] }; empty when there is no file yet
// or it cannot be read (a broken file is never fatal: the canvas starts again from the board).
export async function loadCanvas(projectPath) {
  const out = { cards: new Map(), groups: [], found: false };
  const file = `${KNOWLEDGE}/${canvasPathOf(projectPath)}`;
  if (!(await exists(file))) return out;
  let data;
  try { data = JSON.parse(await readText(file)); } catch { return out; }
  out.found = true;
  for (const n of Array.isArray(data?.nodes) ? data.nodes : []) {
    if (!n || !okId(n.id)) continue;
    const box = { x: num(n.x), y: num(n.y), w: Math.max(80, num(n.width, 230)), h: Math.max(40, num(n.height, 110)) };
    if (n.type === 'file') out.cards.set(n.id, box);
    else if (n.type === 'group') out.groups.push({ id: n.id, ...box, label: typeof n.label === 'string' ? n.label.slice(0, 120) : '', color: typeof n.color === 'string' ? n.color.slice(0, 9) : '' });
  }
  return out;
}

// Writes the canvas. cards: Map slug → { x, y, w, h }; groups as above; files: slug → path of its node;
// edges: [{ from, to, color, label }] (for Obsidian only). Tells the sync and other windows.
export async function saveCanvas(projectPath, { cards, groups, files, edges = [] }) {
  const path = canvasPathOf(projectPath);
  const file = `${KNOWLEDGE}/${path}`;
  const had = await exists(file);
  const nodes = [
    ...groups.map((g) => ({ id: g.id, type: 'group', x: num(g.x), y: num(g.y), width: num(g.w), height: num(g.h), label: g.label || '', ...(g.color ? { color: g.color } : {}) })),
    ...[...cards].filter(([slug]) => files(slug)).map(([slug, b]) => ({ id: slug, type: 'file', file: files(slug), x: num(b.x), y: num(b.y), width: num(b.w), height: num(b.h) })),
  ];
  const ids = new Set(nodes.map((n) => n.id));
  const lines = edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e, i) => ({ id: `e${i}-${e.from}-${e.to}`.slice(0, 120), fromNode: e.from, toNode: e.to, ...(e.color ? { color: e.color } : {}), ...(e.label ? { label: e.label } : {}) }));
  const text = `${JSON.stringify({ nodes, edges: lines }, null, 1)}\n`;
  if (had) { try { if ((await readText(file)) === text) return false; } catch { /* write anew */ } }
  await writeFile(file, text);
  await noteChange(path, had ? 'edited' : 'added');
  post({ kind: 'canvas', path });
  return true;
}

// A project goes, its canvas goes with it (the places would only stand around without it).
export async function removeCanvas(projectPath) {
  const path = canvasPathOf(projectPath);
  if (!(await exists(`${KNOWLEDGE}/${path}`))) return false;
  await removeFile(`${KNOWLEDGE}/${path}`);
  await noteChange(path, 'removed');
  return true;
}
