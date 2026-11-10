// Reads knowledge nodes: front matter (YAML between --- lines), language blocks (::: en / ::: de),
// code blocks and sources. Nothing here touches the page; the node view and the search build on it.
import { parseYaml, JSON_SCHEMA } from '../../vendor/search.js';
import { KNOWLEDGE, basename, exists, listTree, readText, removeFile, writeFile } from './storage.js';
import { choicesOf, plainSpots } from './choices.js';

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
  for (const para of localize(plainSpots(body), lang).split(/\n\s*\n/)) {
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
    // formulary (0.12.0): topic (second level), derived_from ("follows from"), conventions, order of a topic in its area
    topics: asList(m.topic),
    derived: asList(m.derived_from),
    conventions: asList(m.conventions),
    order: Number.isFinite(Number(m.order)) && m.order !== '' && m.order != null ? Number(m.order) : null,
    // open conventions (0.13.0): the choices still open on a card; a convention card you decided names its choice
    choices: choicesOf(m).map((c) => ({ id: c.id, en: c.en, de: c.de, options: c.options })),
    choice: m.choice ? String(m.choice) : '',
    decided: m.decided != null ? String(m.decided) : '',
    decidedOn: m.decided_on ? String(m.decided_on) : '',
    // research (0.14.0): a clip names its work, a research folder lists its clips
    doi: m.doi ? String(m.doi).toLowerCase() : '',
    arxiv: m.arxiv ? String(m.arxiv).toLowerCase() : '',
    url: m.url ? String(m.url) : '',
    clips: m.type === 'research' ? asList(m.clips) : [],
    question: m.question ? String(m.question) : '',
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
export function setField(text, key, value, after = ['source']) {
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
    let at = -1;
    for (const k of after) { at = head.findIndex(isKey(k)); if (at >= 0) break; }
    while (at >= 0 && at + 1 < head.length && /^(\s+\S|-\s)/.test(head[at + 1])) at++;   // after its block value
    head.splice(at >= 0 ? at + 1 : head.length, 0, line);
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

// Takes a top-level field out of the front matter (with a block value below it). Everything else stays as it was.
export function removeField(text, key) {
  const m = text.match(/^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/);
  if (!m) return text;
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const head = m[2].split(/\r?\n/);
  const i = head.findIndex((l) => l.startsWith(`${key}:`) && /^\s|^$/.test(l.slice(key.length + 1)));
  if (i < 0) return text;
  let end = i + 1;
  while (end < head.length && /^(\s+\S|-\s)/.test(head[end])) end++;
  head.splice(i, end - i);
  return m[1] + head.join(nl) + m[3] + text.slice(m[0].length);
}

// ------------------------------------------------------------------ your own snippets and your changes to nodes
// Values in the front matter are written like the rest of the knowledge: strings in quotes, lists as [..].
export const yamlValue = (v) => (Array.isArray(v) ? `[${v.map((x) => JSON.stringify(String(x))).join(', ')}]` : JSON.stringify(String(v)));
// A field that is new goes to its usual place: title_de after title, problems after language, and so on.
const PLACE = {
  title_de: ['title'], group: ['title_de', 'title'], problems: ['language', 'group'], problems_de: ['problems', 'language', 'group'],
  tags: ['problems_de', 'problems', 'language'],
};
const setOrRemove = (text, key, value) => (value == null || value === '' || (Array.isArray(value) && !value.length)
  ? removeField(text, key) : setField(text, key, yamlValue(value), PLACE[key] || ['source']));

// "Plakette mit np.roll" -> "plakette-mit-np-roll"
export function slugify(title) {
  return String(title).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48).replace(/-+$/, '') || 'snippet';
}

// A free file name for a new snippet: nodes/snippets/<slug>.md, with -2, -3 … when the name is taken.
export async function freeSnippetPath(title, taken = () => false) {
  const base = slugify(title);
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const path = `nodes/snippets/${slug}.md`;
    if (!taken(slug) && !(await exists(`${KNOWLEDGE}/${path}`))) return path;
  }
}

// Titles in the language you write in: the title field is English, title_de German. Without an English title
// the German one stands in the title field alone (the app falls back to it in both languages).
function titleFields(lang, title, other) {
  if (lang === 'en') return { title, title_de: other || null };
  return other ? { title: other, title_de: title } : { title, title_de: null };
}

// fields: { lang, title, titleOther, group, problems, description, tags, links, code, check, date }
export function buildSnippet(f) {
  const t = titleFields(f.lang, f.title, f.titleOther);
  const head = [
    'type: snippet',
    `title: ${yamlValue(t.title)}`,
    t.title_de ? `title_de: ${yamlValue(t.title_de)}` : null,
    `group: ${yamlValue(f.group)}`,
    'language: python',
    f.problems?.length ? `${f.lang === 'de' ? 'problems_de' : 'problems'}: ${yamlValue(f.problems)}` : null,
    f.tags?.length ? `tags: ${yamlValue(f.tags)}` : null,
    f.links?.length ? `links: ${yamlValue(f.links)}` : null,
    'source: you',
    `created: ${f.date}`,
  ].filter(Boolean);
  const parts = [`---\n${head.join('\n')}\n---\n`];
  if (f.description) parts.push(`::: ${f.lang}\n${f.description.trim()}\n:::\n`);
  parts.push(`\`\`\`python\n${f.code.replace(/\s+$/, '')}\n\`\`\`\n`);
  if (f.check?.trim()) parts.push(`## Check\n\n\`\`\`python\n${f.check.replace(/\s+$/, '')}\n\`\`\`\n`);
  return parts.join('\n');
}

// Where the snippet's code (first Python block before any "## " heading) and its check (first Python block under
// "## Check") sit in a file: [start, end] of the lines inside the fences. Same rules as runParts.
function blockSpans(text) {
  const fm = text.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  const base = fm ? fm[0].length : 0;
  const body = text.slice(base);
  const heads = [...body.matchAll(/^## (.*)$/gm)].map((m) => ({ at: m.index, title: m[1] }));
  const out = { code: null, check: null, checkSection: null, firstFence: null };
  const re = /^(```|~~~)\s*([\w+-]*)[^\n]*\n([\s\S]*?)\n\1[ \t]*$/gm;
  let m;
  while ((m = re.exec(body))) {
    if (m[2] !== 'python') continue;
    const inner = m.index + m[0].indexOf('\n') + 1;
    const span = [base + inner, base + inner + m[3].length];
    const section = heads.filter((h) => h.at < m.index).pop();
    if (!section) {
      if (!out.code) { out.code = span; out.firstFence = base + m.index; }
    } else if (/^Check\b/.test(section.title) && !out.check) {
      out.check = span;
      const next = heads.find((h) => h.at > section.at);
      out.checkSection = [base + section.at, next ? base + next.at : text.length];
    }
  }
  return out;
}

// Lines you did not change keep the node's placeholders (${…}); the editor shows them filled in.
export function keepPlaceholders(raw, edited) {
  if (!/\$\{/.test(raw)) return edited;
  const a = raw.split('\n');
  const fa = a.map(fillPlaceholders);
  const b = edited.split('\n');
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = fa[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (j < m) {
    if (i < n && fa[i] === b[j]) { out.push(a[i]); i++; j++; } else if (i < n && dp[i + 1][j] >= dp[i][j + 1]) i++; else { out.push(b[j]); j++; }
  }
  return out.join('\n');
}

// Puts new text into the code block or the check block of a node file; nothing else changes. A check that is not
// there yet becomes a new "## Check" section at the end; an empty check removes that section.
export function replaceBlock(text, which, code) {
  const sp = blockSpans(text);
  const clean = code.replace(/\s+$/, '');
  if (which === 'code') {
    if (!sp.code) return null;
    return text.slice(0, sp.code[0]) + keepPlaceholders(text.slice(sp.code[0], sp.code[1]), clean) + text.slice(sp.code[1]);
  }
  if (!clean) {
    if (!sp.checkSection) return text;
    return (text.slice(0, sp.checkSection[0]).replace(/\n+$/, '\n') + text.slice(sp.checkSection[1])).replace(/\n*$/, '\n');
  }
  if (sp.check) return text.slice(0, sp.check[0]) + clean + text.slice(sp.check[1]);
  return `${text.replace(/\n*$/, '\n')}\n## Check\n\n\`\`\`python\n${clean}\n\`\`\`\n`;
}

// The text of one language block before the code (your description), or '' when there is none.
function introSpan(text, lang) {
  const sp = blockSpans(text);
  const fm = text.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  const start = fm ? fm[0].length : 0;
  const end = sp.firstFence ?? text.length;
  const intro = text.slice(start, end);
  const m = intro.match(new RegExp(`^::: ${lang}[ \\t]*\\n([\\s\\S]*?)\\n:::[ \\t]*$`, 'm'));
  return { start, end, m };
}

export function introText(text, lang) {
  return introSpan(text, lang).m?.[1] ?? '';
}

function setIntroText(text, lang, desc) {
  const { start, end, m } = introSpan(text, lang);
  const clean = (desc || '').trim();
  if (m) {
    const a = start + m.index;
    const b = a + m[0].length;
    if (!clean) return text.slice(0, a) + text.slice(b).replace(/^\n+/, '');
    return `${text.slice(0, a)}::: ${lang}\n${clean}\n:::${text.slice(b)}`;
  }
  if (!clean) return text;
  return `${text.slice(0, end)}::: ${lang}\n${clean}\n:::\n\n${text.slice(end)}`;
}

// What the form shows for one of your snippets, in the language you write in.
export function snippetFields(node, lang) {
  const m = node.meta;
  const list = (v) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);
  const parts = runParts(node);
  const de = lang === 'de';
  return {
    title: String((de ? m.title_de || m.title : m.title) || ''),
    titleOther: String((de ? (m.title_de ? m.title : '') : m.title_de) || ''),
    group: m.group ? String(m.group) : '',
    problems: list(de ? m.problems_de : m.problems),
    description: introText(node.body, lang),
    tags: list(m.tags),
    code: parts.code,
    check: parts.check,
  };
}

// Writes the form back into your snippet: only the fields of the form change, other sections stay.
export function updateSnippet(text, f) {
  let next = text;
  const t = titleFields(f.lang, f.title, f.titleOther);
  next = setOrRemove(next, 'title', t.title);
  next = setOrRemove(next, 'title_de', t.title_de);
  next = setOrRemove(next, 'group', f.group);
  next = setOrRemove(next, f.lang === 'de' ? 'problems_de' : 'problems', f.problems);
  next = setOrRemove(next, 'tags', f.tags);
  next = setIntroText(next, f.lang, f.description);
  next = replaceBlock(next, 'code', f.code) ?? next;
  next = replaceBlock(next, 'check', f.check || '');
  return next;
}

export const isOwn = (meta) => meta.source === 'you';

export async function readNodeText(path) {
  if (!isNodeFile(path) || path.includes('..')) throw new Error(`Not a node: ${path}`);
  return readText(`${KNOWLEDGE}/${path}`);
}

export async function writeNode(path, text) {
  if (!isNodeFile(path) || path.includes('..')) throw new Error(`Not a node: ${path}`);
  await writeFile(`${KNOWLEDGE}/${path}`, text);
}

export async function deleteNode(path) {
  if (!isNodeFile(path) || path.includes('..')) throw new Error(`Not a node: ${path}`);
  await removeFile(`${KNOWLEDGE}/${path}`);
}
