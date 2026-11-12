// Your own libraries (0.14.2): books you write yourself, with chapters and pages, in your knowledge.
//   libraries/<lib>/<lib>.md   type: library: title, the chapters in order (one line each: title and its pages),
//                              a description below the front matter
//   libraries/<lib>/<page>.md  type: page: title, library, problems ("Helps with"), sources, links, lang; your text
// The order lives in the library alone; a page names its library. Pages are nodes like any other: the search finds
// them by their text and by "Helps with", [[links]] go both ways, sync takes them along line by line.
// A passage from a work comes as a quote with its source below (> text, — work, § section); the work goes into the
// sources of the page and its clip into links, so the reader shows the page under "Your knowledge".
import { KNOWLEDGE, exists } from './storage.js';
import { deleteNode, parseNode, readNodeText, removeField, setField, slugify, writeNode, yamlValue } from './nodes.js';
import { allNodes, forgetNode, nodeByPath, nodeBySlug, refreshNode } from './search.js';
import { conflictName, noteChange, syncSettings } from './sync.js';
import { announce } from './channel.js';
import { diff3Merge } from '../../vendor/git.js';

const q = (v) => JSON.stringify(String(v));
const today = () => new Date().toISOString().slice(0, 10);
const asList = (v) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);
const FRONT = /^(﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$))/;
export const slugOf = (path) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');

export const libraries = () => allNodes().filter((d) => d.type === 'library' && !d.conflict).sort((a, b) => a.title.localeCompare(b.title));
export const pagesOf = (libSlug) => allNodes().filter((d) => d.type === 'page' && !d.conflict && d.library === libSlug);

async function written(paths, what) {
  for (const p of paths) await refreshNode(p);
  for (const [p, w] of paths.map((p, i) => [p, Array.isArray(what) ? what[i] : what])) await noteChange(p, w);
  announce(paths);
}

async function freeSlug(base, dirOf) {
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!nodeBySlug(slug) && !(await exists(`${KNOWLEDGE}/${dirOf(slug)}`))) return slug;
  }
}

// ------------------------------------------------------------------ chapters
export function parseChapters(meta) {
  return (Array.isArray(meta.chapters) ? meta.chapters : []).filter((c) => c && typeof c === 'object')
    .map((c) => ({ title: String(c.title || ''), pages: asList(c.pages) }));
}
const chapterBlock = (chapters) => (chapters.length
  ? `\n${chapters.map((c) => `  - ${JSON.stringify({ title: c.title, pages: c.pages })}`).join('\n')}` : '[]');
export function withChapters(text, chapters) {
  return setField(text, 'chapters', chapterBlock(chapters), ['lang', 'title_de', 'title']).replace(/^chapters: \n/m, 'chapters:\n');
}

// A library as it is now: chapters with their pages; pages that name the library but stand in no chapter (e.g. after
// a sync) come under "loose", so nothing gets lost.
export async function loadLibrary(path) {
  const text = await readNodeText(path);
  const node = parseNode(text, path);
  const chapters = parseChapters(node.meta);
  const listed = new Set(chapters.flatMap((c) => c.pages));
  const loose = pagesOf(node.slug).filter((d) => !listed.has(d.slug)).map((d) => d.slug);
  return { path, slug: node.slug, title: String(node.meta.title || node.slug), lang: String(node.meta.lang || ''), chapters, loose, description: node.body.trim(), text };
}

async function changeChapters(path, change) {
  const text = await readNodeText(path);
  const before = parseChapters(parseNode(text, path).meta);
  const after = change(before.map((c) => ({ title: c.title, pages: [...c.pages] })));
  if (!after) return false;
  const next = withChapters(text, after);
  if (next === text) return false;
  await writeNode(path, next);
  await written([path], 'edited');
  return true;
}

export const addChapter = (path, title) => changeChapters(path, (cs) => [...cs, { title: String(title).trim(), pages: [] }]);
export const renameChapter = (path, i, title) => changeChapters(path, (cs) => { if (!cs[i]) return null; cs[i].title = String(title).trim(); return cs; });
export const moveChapter = (path, i, dir) => changeChapters(path, (cs) => {
  const j = i + dir;
  if (!cs[i] || j < 0 || j >= cs.length) return null;
  [cs[i], cs[j]] = [cs[j], cs[i]];
  return cs;
});

// Puts a chapter in front of the chapter at `before` (0.17.0, dragging in the contents); -1 or past the end: last.
export const placeChapter = (path, from, before) => changeChapters(path, (cs) => {
  if (!cs[from]) return null;
  let at = before < 0 || before > cs.length ? cs.length : before;
  if (at === from || at === from + 1) return null;
  const [c] = cs.splice(from, 1);
  if (at > from) at -= 1;
  cs.splice(at, 0, c);
  return cs;
});

// Moves a page within its chapter (dir -1 / +1) or to the end of another chapter (toChapter).
export const movePage = (path, slug, { dir = 0, toChapter = null } = {}) => changeChapters(path, (cs) => {
  const from = cs.findIndex((c) => c.pages.includes(slug));
  if (toChapter != null) {
    if (!cs[toChapter] || toChapter === from) return null;
    if (from >= 0) cs[from].pages = cs[from].pages.filter((s) => s !== slug);
    cs[toChapter].pages.push(slug);
    return cs;
  }
  if (from < 0) return null;
  const list = cs[from].pages;
  const i = list.indexOf(slug);
  const j = i + dir;
  if (j < 0 || j >= list.length) return null;
  [list[i], list[j]] = [list[j], list[i]];
  return cs;
});

// Puts a page at a place (0.15.1, dragging in the table of contents): chapter `to`, before the page at `index`
// (at the end with index -1). A page without a chapter comes in too.
export const placePage = (path, slug, to, index = -1) => changeChapters(path, (cs) => {
  if (!cs[to]) return null;
  const from = cs.findIndex((c) => c.pages.includes(slug));
  const old = from >= 0 ? cs[from].pages.indexOf(slug) : -1;
  if (from >= 0) cs[from].pages = cs[from].pages.filter((s) => s !== slug);
  const list = cs[to].pages;
  let at = index < 0 || index > list.length ? list.length : index;
  if (from === to && old >= 0 && old < at) at -= 1;   // the page left a gap above the place
  if (from === to && old === at) return null;
  list.splice(at, 0, slug);
  return cs;
});

// ------------------------------------------------------------------ libraries
export async function createLibrary({ title, lang = 'en', firstChapter = 'Chapter 1' }) {
  const name = String(title).trim();
  if (!name) throw new Error('A library needs a title');
  const slug = await freeSlug(slugify(name).slice(0, 40) || 'library', (s) => `libraries/${s}`);
  const path = `libraries/${slug}/${slug}.md`;
  const head = ['---', 'type: library', `title: ${q(name)}`, `lang: ${q(lang)}`, 'chapters:',
    `  - ${JSON.stringify({ title: firstChapter, pages: [] })}`, `created: ${q(today())}`, 'source: you', '---'];
  await writeNode(path, `${head.join('\n')}\n\n`);
  await written([path], 'added');
  return path;
}

export async function renameLibrary(path, title) {
  const text = await readNodeText(path);
  const next = setField(text, 'title', q(String(title).trim()));
  if (next === text) return false;
  await writeNode(path, next);
  await written([path], 'edited');
  return true;
}

export async function saveDescription(path, description) {
  const text = await readNodeText(path);
  const m = text.match(FRONT);
  if (!m) return false;
  const next = `${m[1]}\n${String(description).trim() ? `${String(description).trim()}\n` : ''}`;
  if (next === text) return false;
  await writeNode(path, next);
  await written([path], 'edited');
  return true;
}

// Deletes the library with all its pages.
export async function deleteLibrary(path) {
  const lib = await loadLibrary(path);
  const pages = [...lib.chapters.flatMap((c) => c.pages), ...lib.loose].map((s) => nodeBySlug(s)).filter((d) => d && d.type === 'page');
  const paths = [...pages.map((d) => d.path), path];
  for (const p of paths) { await deleteNode(p); forgetNode(p); await noteChange(p, 'removed'); }
  announce(paths);
}

// Deletes a chapter; its pages go too.
export async function deleteChapter(path, i) {
  const lib = await loadLibrary(path);
  const ch = lib.chapters[i];
  if (!ch) return false;
  await changeChapters(path, (cs) => cs.filter((_, k) => k !== i));
  for (const s of ch.pages) { const d = nodeBySlug(s); if (d?.type === 'page') await removePageFile(d.path); }
  return true;
}

// ------------------------------------------------------------------ pages
export function pageText({ title, library, lang, date = today() }) {
  return `${['---', 'type: page', `title: ${q(title)}`, `library: ${q(library)}`, `lang: ${q(lang)}`, `created: ${q(date)}`, 'source: you', '---'].join('\n')}\n\n`;
}

// A new page at the end of chapter i. Returns its path.
export async function createPage(libPath, chapter, title, lang = 'en') {
  const name = String(title).trim();
  if (!name) throw new Error('A page needs a title');
  const lib = slugOf(libPath);
  const dir = libPath.slice(0, libPath.lastIndexOf('/'));
  const base = slugify(name).slice(0, 40) || 'page';
  const slug = await freeSlug(nodeBySlug(base) ? `${lib}-${base}`.slice(0, 60) : base, (s) => `${dir}/${s}.md`);
  const path = `${dir}/${slug}.md`;
  await writeNode(path, pageText({ title: name, library: lib, lang }));
  await refreshNode(path);
  await changeChapters(libPath, (cs) => {
    if (!cs.length) cs.push({ title: name, pages: [] });
    (cs[chapter] || cs[cs.length - 1]).pages.push(slug);
    return cs;
  });
  await written([path], 'added');
  return path;
}

async function removePageFile(path) {
  await deleteNode(path);
  forgetNode(path);
  await noteChange(path, 'removed');
  announce([path]);
}

// Takes a page out of the chapters, the file stays.
export const unlistPage = (libPath, slug) => changeChapters(libPath, (cs) => (cs.some((c) => c.pages.includes(slug)) ? cs.map((c) => ({ ...c, pages: c.pages.filter((s) => s !== slug) })) : null));

export async function deletePage(libPath, slug) {
  const d = nodeBySlug(slug);
  await unlistPage(libPath, slug);
  if (d?.type === 'page') await removePageFile(d.path);
}

// The page as the editor needs it: the fields you edit and the whole text (the base for merging when you save).
export async function loadPage(path) {
  const text = await readNodeText(path);
  const node = parseNode(text, path);
  const m = node.meta;
  return {
    path, slug: node.slug, text, title: String(m.title || node.slug), library: String(m.library || ''), lang: String(m.lang || ''),
    problems: asList(m.lang === 'de' ? (m.problems_de ?? m.problems) : (m.problems ?? m.problems_de)),
    sources: (Array.isArray(m.sources) ? m.sources : []).filter((s) => s && typeof s === 'object')
      .map((s) => ({ title: String(s.title || ''), url: s.url ? String(s.url) : '', at: s.at ? String(s.at) : '' })),
    links: asList(m.links),
    body: node.body.replace(/^\n+/, ''),
  };
}

const sourceBlock = (sources) => (sources.length ? `\n${sources.map((s) => {
  const o = { title: s.title };
  if (s.url) o.url = s.url;
  if (s.at) o.at = s.at;
  return `  - ${JSON.stringify(o)}`;
}).join('\n')}` : null);

// The file text with these fields; only lines that change change. Fields left out stay as they are.
export function composePage(text, f) {
  let next = text;
  const m = next.match(FRONT);
  if (!m) throw new Error('A page needs its front matter');
  let head = m[1];
  if (f.title != null) head = setField(head, 'title', q(String(f.title).trim() || 'Page'), ['type']);
  if (f.problems != null) {
    const key = /^lang: "?de"?\s*$/m.test(head) ? 'problems_de' : 'problems';
    const list = f.problems.map((x) => String(x).trim()).filter(Boolean);
    head = list.length ? setField(head, key, yamlValue(list), ['lang', 'library', 'title']) : removeField(head, key);
  }
  if (f.sources != null) {
    const block = sourceBlock(f.sources);
    head = block ? setField(head, 'sources', block, ['problems_de', 'problems', 'lang', 'library']).replace(/^sources: \n/m, 'sources:\n') : removeField(head, 'sources');
  }
  if (f.links != null) head = f.links.length ? setField(head, 'links', yamlValue([...new Set(f.links)]), ['sources', 'problems_de', 'problems', 'lang']) : removeField(head, 'links');
  const body = f.body != null ? `\n${String(f.body).replace(/\s+$/, '')}\n` : next.slice(m[1].length);
  next = head + body;
  return next;
}

// Line-by-line three-way merge of two edits of the same text. Returns the merged text, or null on a clash.
const LINES = /^.*(\r?\n|$)/gm;
export function mergeLines(base, mine, theirs) {
  if (theirs === base) return mine;
  if (mine === base) return theirs;
  let out = '';
  for (const part of diff3Merge(mine.match(LINES), base.match(LINES), theirs.match(LINES))) {
    if (part.conflict) return null;
    out += part.ok.join('');
  }
  return out;
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

// Saves what you wrote. base: the file text when you began. If the file changed meanwhile (the reader put a quote in,
// a sync brought a change), both are merged; when the same lines changed, yours stays and the other goes next to it
// as a conflict copy, as with sync. Returns { text, merged, conflict }.
export async function savePage(path, fields, base) {
  const now = await readNodeText(path);
  const mine = composePage(base ?? now, fields);
  let text = mergeLines(base ?? now, mine, now);
  let conflict = '';
  if (text == null) {
    text = mine;
    conflict = conflictName(path, syncSettings().device || 'device', stamp());
    await writeNode(conflict, now);
    await refreshNode(conflict);
  }
  if (text !== now) {
    await writeNode(path, text);
    await written([path], 'edited');
  }
  if (conflict) await written([conflict], 'added');
  return { text, merged: text !== mine, conflict };
}

// ------------------------------------------------------------------ passages from works, links to your knowledge
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// A short name of a work for the line below a quote: "Coleman 1975, Quantum sine-Gordon …".
export function workLabel(work) {
  const last = String((work.authors || [])[0] || '').split(/\s+/).pop();
  const head = [last, work.year].filter(Boolean).join(' ');
  const title = oneLine(work.title);
  const short = title.length > 70 ? `${title.slice(0, 68).trimEnd()}…` : title;
  return head ? `${head}, ${short}` : short;
}

// > the passage
// >
// > — [[clip|Coleman 1975, Quantum …]], § 2. The model
export function quoteMarkdown({ quote, section = '', work, clipSlug = '', note = '' }) {
  const label = workLabel(work).replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim();
  const who = clipSlug ? `[[${clipSlug}|${label}]]` : label;
  const lines = String(quote).trim().split(/\r?\n/).map((l) => `> ${l}`.trimEnd());
  const out = [...lines, '>', `> — ${who}${section ? `, § ${oneLine(section)}` : ''}`];
  if (oneLine(note)) out.push('', oneLine(note));
  return out.join('\n');
}

// The page names the work in its sources (sections gathered in "at") and links to its clip.
export function withSource(page, { work, url, section = '', clipSlug = '' }) {
  const sources = page.sources.map((s) => ({ ...s }));
  const key = (url || '').toLowerCase();
  let s = sources.find((x) => (key && x.url.toLowerCase() === key) || (!key && x.title === oneLine(work.title)));
  if (!s) { s = { title: oneLine(work.title), url: url || '', at: '' }; sources.push(s); }
  const sec = oneLine(section);
  if (sec) {
    const ats = s.at ? s.at.split(' · ') : [];
    if (!ats.includes(`§ ${sec}`)) s.at = [...ats, `§ ${sec}`].join(' · ');
  }
  const links = clipSlug && !page.links.includes(clipSlug) ? [...page.links, clipSlug] : page.links;
  return { sources, links };
}

// Inserts markdown at a place in the text (an offset into the body), as its own paragraph. Returns { body, at }:
// the new body and where the next insert goes (right after this one).
export function insertBlock(body, md, at = null) {
  const text = String(body);
  const pos = at == null || at < 0 || at > text.length ? text.length : at;
  const before = text.slice(0, pos).replace(/\s+$/, '');
  const after = text.slice(pos).replace(/^\s+/, '');
  const head = before ? `${before}\n\n` : '';
  const next = `${head}${md}${after ? `\n\n${after}` : '\n'}`;
  return { body: next, at: head.length + md.length };
}

// The reader puts a passage into the page you last had open (library.target), where you left the cursor.
// target: { path, at }. Returns the new target (cursor after the quote) or null when the page is gone.
export async function insertIntoPage(target, { quote, section, work, url, clipSlug, note = '' }) {
  if (!target?.path || !nodeByPath(target.path)) return null;
  const page = await loadPage(target.path);
  const md = quoteMarkdown({ quote, section, work, clipSlug, note });
  const { body, at } = insertBlock(page.body, md, target.at);
  const src = withSource(page, { work, url, section, clipSlug });
  await savePage(target.path, { body, ...src }, page.text);
  return { path: target.path, at };
}

// The first display formula of a node, for "insert as formula" (cards in the formulary).
export function firstFormula(body) {
  const m = String(body).match(/^\s*\$\$([\s\S]*?)\$\$/m);
  return m ? m[1].trim() : '';
}
