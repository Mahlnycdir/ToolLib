// Reads knowledge nodes: front matter (YAML between --- lines), language blocks (::: en / ::: de),
// code blocks and sources. Nothing here touches the page; the node view and the search build on it.
import { parseYaml, JSON_SCHEMA } from '../../vendor/search.js';
import { KNOWLEDGE, basename, exists, listTree, readText, writeFile } from './storage.js';

// ------------------------------------------------------------------ parsing
export function parseNode(text, path) {
  let meta = {};
  let body = text.replace(/^﻿/, '');
  let error = null;
  const m = body.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (m) {
    try {
      const parsed = parseYaml(m[1], { schema: JSON_SCHEMA });
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed;
    } catch (e) {
      error = String(e.message || e).split('\n')[0];
    }
    body = body.slice(m[0].length);
  }
  const slug = basename(path).replace(/\.md$/, '');
  return { path, slug, meta, body, error, conflict: path.includes('.conflict-') };
}

// Splits the body into parts: shared text (formulas, code, tables, headings) and groups of language blocks.
// Language blocks that follow each other (only blank lines between) form one group: one text in several languages.
export function splitLanguages(body) {
  const parts = [];
  let shared = [];
  let group = null; // { en: [...], de: [...] }
  let block = null; // { lang, lines }
  let fence = null;
  let blankRun = [];

  const flushShared = () => { if (shared.length) parts.push({ kind: 'shared', text: shared.join('\n') }); shared = []; };
  const closeGroup = () => {
    if (group) parts.push({ kind: 'lang', texts: Object.fromEntries(Object.entries(group).map(([k, v]) => [k, v.join('\n')])) });
    group = null;
  };

  for (const line of body.split(/\r?\n/)) {
    if (block) {
      if (!fence && /^:::\s*$/.test(line)) { group[block.lang] = block.lines; block = null; continue; }
      if (/^(```|~~~)/.test(line.trim())) fence = fence ? null : line.trim().slice(0, 3);
      block.lines.push(line);
      continue;
    }
    if (!fence) {
      const open = line.match(/^:::\s*([a-z]{2})\s*$/);
      if (open) {
        if (!group) { flushShared(); group = {}; }
        blankRun = [];
        block = { lang: open[1], lines: [] };
        continue;
      }
      if (group && line.trim() === '') { blankRun.push(line); continue; }
      if (group) { closeGroup(); shared.push(...blankRun); blankRun = []; }
    }
    if (/^(```|~~~)/.test(line.trim())) fence = fence ? null : line.trim().slice(0, 3);
    shared.push(line);
  }
  if (block) group[block.lang] = block.lines; // unclosed block: keep what is there
  closeGroup();
  flushShared();
  return parts;
}

// Markdown of the body in one language: the chosen language, otherwise English, otherwise the first one.
export function localize(body, lang) {
  return splitLanguages(body)
    .map((p) => (p.kind === 'shared' ? p.text : p.texts[lang] ?? p.texts.en ?? Object.values(p.texts)[0] ?? ''))
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ------------------------------------------------------------------ fields
const asList = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map((x) => String(x));

export const titleOf = (meta, lang, fallback = '') => (lang === 'de' && meta.title_de) || meta.title || meta.title_de || fallback;

export function sourcesOf(meta) {
  const list = Array.isArray(meta.sources) ? meta.sources : [];
  const out = list
    .map((s) => (typeof s === 'string' ? { title: s } : s && typeof s === 'object' ? s : null))
    .filter(Boolean)
    .map((s) => ({ title: String(s.title || s.url || ''), url: s.url ? String(s.url) : '', at: s.at ? String(s.at) : '' }))
    .filter((s) => s.title);
  if (!out.length && meta.ref) out.push({ title: String(meta.ref), url: '', at: '' }); // older nodes
  return out;
}

// Fenced code blocks: [{ lang, code }]
export function codeBlocks(markdown) {
  const out = [];
  const re = /^(```|~~~)\s*([\w+-]*)[^\n]*\n([\s\S]*?)\n\1[ \t]*$/gm;
  let m;
  while ((m = re.exec(markdown))) out.push({ lang: m[2] || '', code: m[3] });
  return out;
}

// Snippets mark the spots to fill in like Kobra: ${name} or ${1:name}. Copying keeps the names.
export const fillPlaceholders = (code) => code.replace(/\$\{(?:\d+:)?([^}]*)\}/g, '$1');

// What a snippet runs with: its code (the first Python block before any "## " heading), its check (the first
// Python block under "## Check") and the snippets the check needs ("# needs: a, b" as its first line).
// The same rules as check_nodes.py in the test folder, so a check runs here exactly as it ran there.
export function runParts(node) {
  let code = '';
  let check = '';
  node.body.split(/^## /m).forEach((part, i) => {
    const blocks = codeBlocks(part).filter((b) => b.lang === 'python');
    if (!blocks.length) return;
    if (i === 0 && !code) code = blocks[0].code;
    if (i > 0 && /^Check\b/.test(part) && !check) check = blocks[0].code;
  });
  return { code, check, needs: needsOf(check) };
}

export function needsOf(check) {
  const m = (check || '').trim().split('\n')[0].match(/^#\s*needs:\s*(.+)$/);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}

// The snippets a check needs, with everything they need themselves, in the order their definitions must come.
// load(slug) returns the node or null. Result: { deps: [[slug, code], ...], missing: [slug, ...] }
export async function resolveNeeds(needs, load) {
  const deps = [];
  const missing = [];
  const seen = new Set();
  async function visit(slug) {
    if (seen.has(slug)) return;
    seen.add(slug);
    const node = await load(slug);
    if (!node) { missing.push(slug); return; }
    const parts = runParts(node);
    for (const s of parts.needs) await visit(s);
    if (parts.code) deps.push([slug, parts.code]);
  }
  for (const s of needs) await visit(s);
  return { deps, missing };
}

// [[name]] and [[name|label]] in the text plus the field links.
export function linksOf(node) {
  const out = new Set(asList(node.meta.links));
  for (const m of node.body.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) out.add(m[1].trim());
  return [...out];
}

// Plain text of all languages for the search: prose, code and formulas.
export function searchText(node) {
  return node.body
    .replace(/^:::.*$/gm, ' ')
    .replace(/^(```|~~~).*$/gm, ' ')
    .replace(/[#*_`>|$\\{}[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// First sentence-ish of the prose in one language, for lists.
export function leadOf(body, lang, max = 140) {
  for (const para of localize(body, lang).split(/\n\s*\n/)) {
    const p = para.trim();
    if (!p || /^(```|~~~|\$\$|#|\||>|[-*+] |\d+[.)] )/.test(p)) continue;
    const text = p.replace(/\s+/g, ' ').replace(/[*`]/g, '').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a);
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  }
  return '';
}

// Everything the search and the lists need, without the body.
export function summary(node) {
  const m = node.meta;
  const blocks = m.type === 'snippet' ? codeBlocks(node.body) : [];
  return {
    path: node.path,
    slug: node.slug,
    type: String(m.type || 'note'),
    title: String(m.title || m.title_de || node.slug),
    title_de: m.title_de ? String(m.title_de) : '',
    aliases: asList(m.aliases),
    problems: asList(m.problems),
    problems_de: asList(m.problems_de),
    tags: asList(m.tags),
    group: m.group ? String(m.group) : '',
    area: asList(m.area),
    source: m.source ? String(m.source) : '',
    verified: m.verified !== false,
    conflict: node.conflict,
    error: node.error,
    code: blocks.length ? fillPlaceholders(blocks[0].code) : '',
    lead: { en: leadOf(node.body, 'en'), de: leadOf(node.body, 'de') },
    text: searchText(node),
  };
}

// ------------------------------------------------------------------ files
const isNodeFile = (p) => p.endsWith('.md') && p.includes('/') && !p.startsWith('.git/');

export async function loadAllNodes() {
  if (!(await exists(`${KNOWLEDGE}/.git`))) return null;
  const files = (await listTree(KNOWLEDGE)).filter((f) => f.type === 'file' && isNodeFile(f.path));
  const out = [];
  for (const f of files) {
    try { out.push(parseNode(await readText(`${KNOWLEDGE}/${f.path}`), f.path)); } catch (e) { console.warn('Unreadable node', f.path, e); }
  }
  return out;
}

export async function getNode(path) {
  if (!isNodeFile(path) || path.includes('..')) return null;
  try { return parseNode(await readText(`${KNOWLEDGE}/${path}`), path); } catch { return null; }
}

// ------------------------------------------------------------------ changing nodes
// Sets one top-level field of the front matter, e.g. "verified: true". Only that line changes (a field that is
// missing gets a new line after "source:"), so Git shows a one-line difference and the sync can combine it
// line by line with changes from other devices. Everything else in the file stays exactly as it was.
export function setField(text, key, value) {
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const body = text.slice(bom.length);
  const nl = body.includes('\r\n') ? '\r\n' : '\n';
  const line = `${key}: ${value}`;
  const m = body.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return `${bom}---${nl}${line}${nl}---${nl}${body}`;
  const head = m[1].split(/\r?\n/);
  const isKey = (k) => (l) => l.startsWith(`${k}:`) && /^\s|^$/.test(l.slice(k.length + 1));
  const i = head.findIndex(isKey(key));
  if (i >= 0) {
    let end = i + 1; // a block value below the key (indented lines or "- " items) goes too
    while (end < head.length && /^(\s+\S|-\s)/.test(head[end])) end++;
    head.splice(i, end - i, line);
  } else {
    const after = head.findIndex(isKey('source'));
    head.splice(after >= 0 ? after + 1 : head.length, 0, line);
  }
  const start = m[0].indexOf(m[1]);
  return bom + m[0].slice(0, start) + head.join(nl) + m[0].slice(start + m[1].length) + body.slice(m[0].length);
}

// Marks a node as checked by you (verified: true) or as unchecked again. Writes the file on this device;
// the next sync uploads it. Returns the node as it is now.
export async function setVerified(path, verified) {
  if (!isNodeFile(path) || path.includes('..')) throw new Error(`Not a node: ${path}`);
  const file = `${KNOWLEDGE}/${path}`;
  const text = await readText(file);
  const next = setField(text, 'verified', verified ? 'true' : 'false');
  if (next !== text) await writeFile(file, next);
  return parseNode(next, path);
}
