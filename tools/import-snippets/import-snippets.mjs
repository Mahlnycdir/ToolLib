#!/usr/bin/env node
// Imports Kobra's snippets.js as Toollib snippet nodes (one Markdown file per snippet).
//
// Usage:
//   node import-snippets.mjs <path/to/snippets.js> <path/to/knowledge/nodes/snippets> [--force]
//
// Texts, titles and the German -> English word list come from texts.json next to this file.
// Existing node files are kept unless --force is given, so edits in knowledge are safe.

import { readFile, writeFile, mkdir, access, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [snippetsPath, outDir, ...flags] = process.argv.slice(2);
const force = flags.includes('--force');

if (!snippetsPath || !outDir) {
  console.error('Usage: node import-snippets.mjs <snippets.js> <output dir> [--force]');
  process.exit(1);
}

// snippets.js uses `export`, so load it as an ES module from a temporary .mjs copy.
async function loadSnippets(path) {
  const dir = await mkdtemp(join(tmpdir(), 'snippets-'));
  const copy = join(dir, 'snippets.mjs');
  await copyFile(resolve(path), copy);
  try {
    return await import(pathToFileURL(copy).href);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const exists = (p) => access(p).then(() => true, () => false);
const q = (s) => JSON.stringify(String(s));            // JSON strings are valid YAML scalars
const list = (xs) => `[${xs.map(q).join(', ')}]`;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Replace whole words only, longest phrases first, case-sensitive.
function translate(code, table) {
  const keys = Object.keys(table).sort((a, b) => b.length - a.length);
  for (const de of keys) {
    const re = new RegExp(`(?<![\\w])${escapeRe(de)}(?![\\w])`, 'g');
    code = code.replace(re, table[de]);
  }
  return code;
}

function langBlocks(en, de) {
  let out = `::: en\n${en}\n:::\n`;
  if (de) out += `\n::: de\n${de}\n:::\n`;
  return out;
}

function bullets(xs) {
  return xs.map((x) => `- ${x}`).join('\n');
}

function node(item, group, text, keywords) {
  const body = translate(
    translate(item.body.replace(/\t/g, '    '), text.rename ?? {}),
    texts.translate,
  );
  const aliases = [...new Set([item.label, item.detail, ...(text.aliases ?? [])].filter(Boolean))];
  const tags = [...new Set([group.slug, ...keywords, ...(text.tags ?? [])])];

  let md = '---\n';
  md += 'type: snippet\n';
  md += `title: ${q(text.title)}\n`;
  md += `title_de: ${q(text.title_de)}\n`;
  md += `aliases: ${list(aliases)}\n`;
  md += `group: ${group.slug}\n`;
  md += 'language: python\n';
  md += `tags: ${list(tags)}\n`;
  md += `kobra_key: ${item.key}\n`;
  md += 'source: claude\n';
  md += 'verified: false\n';
  md += '---\n\n';
  md += langBlocks(text.en, text.de);
  md += `\n\`\`\`python\n${body}\n\`\`\`\n`;
  if (text.pitfalls_en?.length) {
    md += '\n## Pitfalls\n\n';
    md += langBlocks(bullets(text.pitfalls_en), text.pitfalls_de?.length ? bullets(text.pitfalls_de) : '');
  }
  return md;
}

const texts = JSON.parse(await readFile(join(here, 'texts.json'), 'utf8'));
const { SNIPPET_GROUPS, KEYWORD_SNIPPETS = {} } = await loadSnippets(snippetsPath);

const keywordsOf = {};
for (const [kw, keys] of Object.entries(KEYWORD_SNIPPETS)) {
  for (const k of keys) (keywordsOf[k] ??= []).push(kw);
}

await mkdir(outDir, { recursive: true });
let written = 0, kept = 0;
const missing = [];

for (const g of SNIPPET_GROUPS) {
  const group = texts.groups[g.title];
  if (!group) throw new Error(`No group entry in texts.json for "${g.title}"`);
  for (const item of g.items) {
    const text = texts.snippets[item.key];
    if (!text) { missing.push(item.key); continue; }
    const file = join(outDir, `${text.slug}.md`);
    if (!force && await exists(file)) { kept++; continue; }
    await writeFile(file, node(item, group, text, keywordsOf[item.key] ?? []), 'utf8');
    written++;
  }
}

console.log(`${written} written, ${kept} kept (already there)`);
if (missing.length) {
  console.log(`No texts yet for: ${missing.join(', ')} (add them to texts.json)`);
  process.exitCode = 2;
}
