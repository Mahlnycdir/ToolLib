// Research (0.14.0): what you keep goes into your knowledge as nodes, so it is searchable offline on every device.
//   clips/<name>.md     type: clip, one work with all its versions (source: scraper, unchecked); since 0.14.1 also the
//                       text you read (## Text, ## References) and your highlights (## Highlights), see reader.js
//   research/<name>.md  type: research, your research folder: title, question, the clips, your notes (source: you)
// The folder lists its clips (clips: [..]); a clip can sit in several folders.
import { KNOWLEDGE, exists } from './storage.js';
import { deleteNode, parseNode, readNodeText, setField, slugify, writeNode, yamlValue } from './nodes.js';
import { allNodes, forgetNode, nodeByPath, nodeBySlug, refreshNode } from './search.js';
import { noteChange, noteChanges } from './sync.js';
import { announce } from './channel.js';
import { normArxiv, normDoi, orderVersions } from './research-merge.js';
import { composeBody, parseBody } from './reader.js';
import { addToProject, projectsWith, removeFromProject } from './projects.js';
import { capture } from './notes.js';

const q = (v) => JSON.stringify(String(v));
const today = () => new Date().toISOString().slice(0, 10);
const asList = (v) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);

export const folders = () => allNodes().filter((d) => d.type === 'research' && !d.conflict).sort((a, b) => a.title.localeCompare(b.title));
export const clipsIn = (folder) => (folder?.clips || []).map((slug) => nodeBySlug(slug)).filter((d) => d && d.type === 'clip');
export const foldersWith = (slug) => folders().filter((f) => f.clips.includes(slug));

// The clip you already kept for a work (same DOI or arXiv id), or null.
export function clipFor(work) {
  const doi = work.ids?.doi;
  const arxiv = work.ids?.arxiv;
  // a single page (0.14.3) has neither: the same address is the same clip
  const url = !doi && !arxiv && work.type === 'page' ? work.versions?.[0]?.url : '';
  return allNodes().find((d) => d.type === 'clip' && !d.conflict && ((doi && d.doi === doi) || (arxiv && d.arxiv === arxiv) || (url && d.url === url))) || null;
}

async function freePath(dir, base) {
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const path = `${dir}/${slug}.md`;   // clips/ and research/ at the top of the knowledge (README of knowledge, "Ordner")
    if (!nodeBySlug(slug) && !(await exists(`${KNOWLEDGE}/${path}`))) return path;
  }
}

async function written(paths, what) {
  for (const p of paths) await refreshNode(p);
  for (const [p, w] of paths.map((p, i) => [p, Array.isArray(what) ? what[i] : what])) await noteChange(p, w);
  announce(paths);
}

// ------------------------------------------------------------------ folders
// extra: more lines for the front matter (a run through a website, 0.14.3, adds crawl: …).
export async function createFolder({ title, question = '', extra = [] }) {
  const name = String(title).trim();
  if (!name) throw new Error('A folder needs a title');
  const path = await freePath('research', slugify(name).slice(0, 40) || 'research');
  const head = ['---', 'type: research', `title: ${q(name)}`, question.trim() ? `question: ${q(question.trim())}` : null,
    'clips: []', ...extra, `created: ${q(today())}`, 'source: you', '---'].filter(Boolean);
  await writeNode(path, `${head.join('\n')}\n\n`);
  await written([path], 'added');
  return path;
}

// Deletes the folder only: the works you kept stay in clips/ (they can sit in other folders too).
export async function deleteFolder(folderPath) {
  await deleteNode(folderPath);
  forgetNode(folderPath);
  await noteChange(folderPath, 'removed');
  announce([folderPath]);
}

// A folder from before 0.16.0 goes into a project: its works join the project, its question and notes become a note
// there, the folder goes (and leaves the projects that named it). Nothing you kept or wrote is lost.
export async function dissolveFolder(folderPath, projectPath) {
  const f = nodeByPath(folderPath);
  if (!f || f.type !== 'research' || f.crawl || f.pdfInbox) return false;
  if (f.clips.length) await addToProject(projectPath, f.clips);
  const n = await folderNotes(folderPath).catch(() => null);
  const text = [n?.question, n?.notes].map((x) => String(x || '').trim()).filter(Boolean).join('\n\n');
  if (text) await capture(`${f.title}\n\n${text}`, { project: projectPath });
  for (const p of projectsWith(f.slug)) await removeFromProject(p.path, f.slug);
  await deleteFolder(folderPath);
  return true;
}

// Works you kept that sit in no folder (0.15.0): they show under "No folder" instead of vanishing from the window.
export function looseClips() {
  const filed = new Set(folders().flatMap((f) => f.clips));
  return allNodes().filter((d) => d.type === 'clip' && !d.conflict && !filed.has(d.slug)).sort((a, b) => a.title.localeCompare(b.title));
}
// Pages of a run through a website whose folder is gone: nothing leads to them any more.
export const orphanPages = () => looseClips().filter((d) => d.run && !d.marked);

// Deletes clips for good (pages of a run you no longer want). Returns how many.
export async function deleteClips(paths) {
  const done = [];
  for (const p of paths) {
    try { await deleteNode(p); forgetNode(p); done.push(p); } catch (e) { console.warn('Could not delete', p, e); }
  }
  if (done.length) { await noteChanges(done.map((p) => [p, 'removed'])); announce(done); }
  return done.length;
}

// The pages of a run that go with its folder: in no other folder, and nothing marked in them.
export function runPages(folder) {
  const elsewhere = new Set(folders().filter((f) => f.path !== folder.path).flatMap((f) => f.clips));
  return allNodes().filter((d) => d.type === 'clip' && !d.conflict && d.run === folder.slug && !d.marked && !elsewhere.has(d.slug));
}

async function changeClips(folderPath, change) {
  const text = await readNodeText(folderPath);
  const node = parseNode(text, folderPath);
  const before = asList(node.meta.clips);
  const after = change(before);
  if (after.join('\n') === before.join('\n')) return false;
  await writeNode(folderPath, setField(text, 'clips', yamlValue(after), ['question', 'title_de', 'title']));
  await written([folderPath], 'edited');
  return true;
}
export const addToFolder = (folderPath, slug) => changeClips(folderPath, (l) => (l.includes(slug) ? l : [...l, slug]));
export const removeFromFolder = (folderPath, slug) => changeClips(folderPath, (l) => l.filter((s) => s !== slug));

// Your notes in a folder: the text below the front matter, and the question.
export async function folderNotes(folderPath) {
  const node = parseNode(await readNodeText(folderPath), folderPath);
  return { question: String(node.meta.question || ''), notes: node.body.replace(/^\n+/, '') };
}
export async function saveFolderNotes(folderPath, { question, notes }) {
  const text = await readNodeText(folderPath);
  const m = text.match(/^(﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$))/);
  if (!m) return false;
  let head = m[1];
  if (question != null) {
    const qq = String(question).trim();
    const cur = String(parseNode(text, folderPath).meta.question || '');
    if (qq !== cur) {
      const fm = `${head}`;
      head = qq ? setField(fm, 'question', q(qq), ['title_de', 'title']) : fm.replace(/^question:.*\r?\n/m, '');
    }
  }
  const body = notes == null ? text.slice(m[1].length) : `\n${String(notes).replace(/\s+$/, '')}\n`;
  const next = head + body;
  if (next === text) return false;
  await writeNode(folderPath, next);
  await written([folderPath], 'edited');
  return true;
}

// ------------------------------------------------------------------ clips
const KIND_EN = { published: 'Published version', accepted: 'Accepted manuscript', preprint: 'Preprint', other: 'Copy' };
const versionTitle = (v) => `${KIND_EN[v.kind] || 'Copy'}${v.free ? ' (free)' : ''}${v.host ? ` · ${v.host}` : ''}`;
const slim = (v) => {
  const out = { kind: v.kind, free: !!v.free, url: v.url || v.pdf };
  if (v.pdf && v.pdf !== out.url) out.pdf = v.pdf;
  if (v.host) out.host = v.host;
  if (v.license) out.license = v.license;
  return out;
};

function clipName(work) {
  const last = (work.authors[0] || '').split(/\s+/).pop() || '';
  const title = String(work.title).split(/\s+/).slice(0, 6).join(' ');
  return slugify([last, work.year, title].filter(Boolean).join(' ')) || (work.ids.arxiv ? `arxiv-${work.ids.arxiv}` : 'clip');
}

// The text of a clip node for a work.
export function clipText(work, { query = '', problem = '', date = today() } = {}) {
  const ids = work.ids || {};
  const versions = orderVersions(work.versions || []).map(slim);
  const best = versions.find((v) => v.free) || versions[0];
  const head = [
    '---',
    'type: clip',
    `kind: ${q(work.type === 'book' || work.type === 'chapter' || work.type === 'page' ? work.type : work.type === 'thesis' ? 'thesis' : 'paper')}`,
    `title: ${q(work.title)}`,
    work.authors.length ? `authors: ${yamlValue(work.authors.slice(0, 30))}` : null,
    work.year ? `year: ${Number(work.year)}` : null,
    work.venue ? `venue: ${q(work.venue)}` : null,
    ids.doi ? `doi: ${q(ids.doi)}` : null,
    ids.arxiv ? `arxiv: ${q(ids.arxiv)}` : null,
    ids.pmid ? `pmid: ${q(ids.pmid)}` : null,
    ids.pmcid ? `pmcid: ${q(ids.pmcid)}` : null,
    ids.isbn?.length ? `isbn: ${yamlValue(ids.isbn.slice(0, 6))}` : null,
    ids.openalex ? `openalex: ${q(ids.openalex)}` : null,
    best ? `url: ${q(best.url)}` : null,
    problem.trim() ? `problems_de: ${yamlValue([problem.trim()])}` : null,
    versions.length ? 'versions:' : null,
    ...versions.map((v) => `  - ${JSON.stringify(v)}`),
    versions.length ? 'sources:' : null,
    ...versions.map((v) => `  - ${JSON.stringify({ title: versionTitle(v), url: v.pdf && v.free ? v.pdf : v.url })}`),
    `found_with: ${q(query)}`,
    `found_in: ${yamlValue(work.sources || [])}`,
    `fetched: ${q(date)}`,
    'source: scraper',
    'verified: false',
    '---',
  ].filter((l) => l != null);
  const abstract = String(work.abstract || '').replace(/\s+/g, ' ').trim().replace(/^(:::|#|---)/, '\\$1');
  return `${head.join('\n')}\n\n${abstract ? `${abstract}\n` : ''}`;
}

// Keeps a work: writes its clip (or takes the one you have) and puts it into the folder.
// Returns { clipPath, slug, existed }.
export async function keepWork(work, { folderPath, query = '', problem = '' } = {}) {
  let clip = clipFor(work);
  let existed = !!clip;
  let clipPath = clip?.path;
  if (!clip) {
    clipPath = await freePath('clips', clipName(work));
    await writeNode(clipPath, clipText(work, { query, problem }));
    await written([clipPath], 'added');
    clip = nodeByPath(clipPath);
    existed = false;
  }
  const slug = clipPath.slice(clipPath.lastIndexOf('/') + 1).replace(/\.md$/, '');
  if (folderPath) await addToFolder(folderPath, slug);
  return { clipPath, slug, existed };
}

// What the details show as abstract: the lead of the clip (not the stored text); for a page or a document you went
// through (0.14.3) its first paragraphs.
function abstractOf(body, kind) {
  const b = parseBody(body);
  if (b.lead || !['page', 'document'].includes(kind)) return b.lead;
  const paras = b.text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !/^(#|```|~~~|\$\$|\||>|---)/.test(p));
  let out = '';
  for (const p of paras) { if (out.length > 300) break; out += `${out ? '\n\n' : ''}${p}`; }
  return out.length > 900 ? `${out.slice(0, 899).trimEnd()}…` : out;
}

// A kept clip as a work again, for the details next to the results.
export async function workFromClip(path) {
  const node = parseNode(await readNodeText(path), path);
  const m = node.meta;
  const versions = (Array.isArray(m.versions) ? m.versions : []).filter((v) => v && typeof v === 'object')
    .map((v) => ({ kind: String(v.kind || 'other'), free: v.free === true, url: String(v.url || ''), pdf: v.pdf ? String(v.pdf) : '', host: v.host ? String(v.host) : '', license: v.license ? String(v.license) : '', via: [] }));
  const ids = { doi: normDoi(m.doi), arxiv: normArxiv(m.arxiv), pmid: m.pmid ? String(m.pmid) : '', pmcid: m.pmcid ? String(m.pmcid) : '', openalex: m.openalex ? String(m.openalex) : '', isbn: asList(m.isbn) };
  return {
    key: ids.doi ? `doi:${ids.doi}` : ids.arxiv ? `arxiv:${ids.arxiv}` : `clip:${node.slug}`,
    title: String(m.title || node.slug), authors: asList(m.authors), year: Number(m.year) || null, venue: String(m.venue || ''),
    type: ['book', 'chapter', 'thesis', 'page', 'document'].includes(m.kind) ? String(m.kind) : 'article',
    abstract: abstractOf(node.body, m.kind), cited: 0, ids, versions: orderVersions(versions), free: versions.some((v) => v.free),
    sources: asList(m.found_in), ranks: {}, clip: { path, slug: node.slug, fetched: String(m.fetched || ''), verified: m.verified === true },
    text: m.text_via ? { via: String(m.text_via), url: String(m.text_url || ''), fetched: String(m.text_fetched || '') } : null,
  };
}

// Takes the versions found now into a clip you kept earlier (only versions, sources and url change).
export async function updateClipVersions(path, work) {
  const text = await readNodeText(path);
  const versions = orderVersions(work.versions || []).map(slim);
  if (!versions.length) return false;
  const block = (items) => `\n${items.map((x) => `  - ${JSON.stringify(x)}`).join('\n')}`;
  let next = setField(text, 'versions', block(versions), ['url', 'doi', 'title']).replace(/^versions: \n/m, 'versions:\n');
  next = setField(next, 'sources', block(versions.map((v) => ({ title: versionTitle(v), url: v.pdf && v.free ? v.pdf : v.url }))), ['versions']).replace(/^sources: \n/m, 'sources:\n');
  next = setField(next, 'url', q((versions.find((v) => v.free) || versions[0]).url), ['arxiv', 'doi', 'title']);
  if (next === text) return false;
  await writeNode(path, next);
  await written([path], 'edited');
  return true;
}

// ------------------------------------------------------------------ the text of a clip, your highlights (0.14.1)
const FRONT = /^(\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$))/;

export async function loadClipDoc(path) {
  const node = parseNode(await readNodeText(path), path);
  const b = parseBody(node.body);
  const m = node.meta;
  return {
    meta: m, lead: b.lead, markdown: b.text, references: b.references, highlights: b.highlights,
    via: m.text_via ? String(m.text_via) : '', url: m.text_url ? String(m.text_url) : '', fetched: m.text_fetched ? String(m.text_fetched) : '',
  };
}

// Keeps what the reader read in the clip: ## Text and ## References, where it came from. The abstract only if the clip has none.
export async function saveClipDoc(path, doc) {
  const text = await readNodeText(path);
  const m = text.match(FRONT);
  if (!m) throw new Error('A clip needs its front matter');
  let head = m[1];
  const parts = parseBody(text.slice(m[1].length)).parts;
  const change = { text: doc.markdown, references: doc.references || [] };
  if (!parts[0].lines.join('').trim() && doc.abstract) change.lead = doc.abstract;
  const after = ['fetched', 'found_in', 'found_with', 'source'];
  head = setField(head, 'text_via', q(doc.via), after);
  head = setField(head, 'text_url', q(doc.finalUrl || doc.url || ''), ['text_via']);
  head = setField(head, 'text_fetched', q(doc.fetched || today()), ['text_url']);
  // the original in your PDF folder on the Mac (0.14.4)
  if (doc.file) {
    head = setField(head, 'file', q(doc.file), ['text_fetched']);
    head = setField(head, 'file_sha1', q(doc.fileSha1 || ''), ['file']);
  }
  const next = `${head}\n${composeBody(parts, change)}`;
  if (next === text) return false;
  await writeNode(path, next);
  await written([path], 'edited');
  return true;
}

export async function saveHighlights(path, highlights) {
  const text = await readNodeText(path);
  const m = text.match(FRONT);
  if (!m) return false;
  const parts = parseBody(text.slice(m[1].length)).parts;
  const next = `${m[1]}\n${composeBody(parts, { highlights })}`;
  if (next === text) return false;
  await writeNode(path, next);
  await written([path], 'edited');
  return true;
}
