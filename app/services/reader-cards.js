// Reader (0.14.1, part 2): from the text you read to your knowledge, quickly.
//   - a card (formula, definition, theorem, term) or a snippet from the words you selected
//   - what your knowledge already says about a section or a selection
//   - what the reference [12] in the text points to
// The card is a normal node (nodes/formulas|terms/<name>.md, source: you, verified: false) that names the work it comes
// from (sources) and links to its clip, so it shows up in the formulary, the search and next to the work.
import { KNOWLEDGE, exists } from './storage.js';
import { slugify, writeNode } from './nodes.js';
import { allNodes, nodeBySlug, refreshNode, searchNodes } from './search.js';
import { noteChange } from './sync.js';
import { announce } from './channel.js';
import { normArxiv, normDoi } from './research-merge.js';

const q = (v) => JSON.stringify(String(v));
const today = () => new Date().toISOString().slice(0, 10);

export const CARD_KINDS = ['formula', 'definition', 'theorem', 'term'];
const FOLDER = { formula: 'formulas', definition: 'formulas', theorem: 'formulas', term: 'terms' };

const plain = (s) => String(s).replace(/\$\$?[^$]*\$\$?/g, ' ').replace(/\s+/g, ' ').trim();

// What the selection most likely is.
export function guessKind(text, section = '') {
  const t = String(text).trim();
  const words = plain(t).split(/\s+/).filter(Boolean).length;
  if (/^(theorem|lemma|proposition|corollary|satz|korollar)\b/i.test(t) || /\b(theorem|lemma|proposition|satz)\b/i.test(section)) return 'theorem';
  if (/\b(is called|are called|we (call|define|say)|is defined|defined (as|by)|heißt|heißen|nennt|definiert)\b/i.test(t) || /^definition\b/i.test(t)) return 'definition';
  if (/\$/.test(t) && words <= 40) return 'formula';
  return words <= 8 ? 'term' : 'definition';
}

// A title from the words, else from the section.
export function guessTitle(text, section = '') {
  const words = plain(text).replace(/[“”"*_#>]/g, '').split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.slice(0, 6).join(' ').replace(/[,;:.]+$/, '');
  return String(section || words.join(' ')).slice(0, 60);
}

export function guessLang(text) {
  return /[äöüß]|\b(und|der|die|das|ist|nicht|wird|eine?)\b/i.test(plain(text)) ? 'de' : 'en';
}

// The topics your cards already use, the ones used most first (for the topic field).
export function knownTopics() {
  const n = new Map();
  for (const d of allNodes()) if (!d.conflict && ['formula', 'definition', 'theorem', 'term'].includes(d.type)) for (const x of d.topics) n.set(x, (n.get(x) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
}
const areaOf = (topic) => {
  const d = allNodes().find((x) => !x.conflict && x.topics.includes(topic) && x.area.length);
  return d ? d.area : ['physics'];
};

async function freePath(dir, title) {
  const base = slugify(title) || 'card';
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const path = `nodes/${dir}/${slug}.md`;
    if (!nodeBySlug(slug) && !(await exists(`${KNOWLEDGE}/${path}`))) return path;
  }
}

// values: { kind, title, topic, text, lang, section, work: {title, url}, clipSlug }
export function cardText(v, date = today()) {
  const lang = v.lang === 'de' ? 'de' : 'en';
  const head = [
    `type: ${v.kind}`,
    `title: ${q(v.title)}`,   // the title alone stands in the title field, in either language (nodes.js, titleFields)
    `area: [${areaOf(v.topic).map(q).join(', ')}]`,
    v.topic ? `topic: [${q(v.topic)}]` : null,
    `${lang === 'de' ? 'problems_de' : 'problems'}: [${q(v.title)}]`,
    v.clipSlug ? `links: [${q(v.clipSlug)}]` : null,
    v.work ? `sources:\n  - title: ${q(v.work.title)}\n    url: ${q(v.work.url || '')}\n    at: ${q(v.section || '')}` : null,
    'source: you',
    'verified: false',
    `created: ${date}`,
  ].filter(Boolean);
  return `---\n${head.join('\n')}\n---\n::: ${lang}\n${String(v.text).trim()}\n:::\n`;
}

export async function createCard(v) {
  const path = await freePath(FOLDER[v.kind] || 'formulas', v.title);
  await writeNode(path, cardText(v));
  await refreshNode(path);
  await noteChange(path, 'added');
  announce([path]);
  return path;
}

// ------------------------------------------------------------------ what your knowledge says
const isKnowledge = (d, skip) => d && !d.conflict && d.type !== 'research' && d.path !== skip;

export function knowledgeFor(query, { skip = '', limit = 6 } = {}) {
  const text = plain(query).slice(0, 160);
  if (!text) return [];
  return searchNodes(text, { limit, filter: (d) => isKnowledge(d, skip) });
}

// The cards and snippets made from this work: they name its link, DOI or arXiv id in their sources.
export function madeFrom(work, clipPath = '') {
  const keys = [work.url, work.ids?.doi && `https://doi.org/${work.ids.doi}`, work.ids?.arxiv && `https://arxiv.org/abs/${work.ids.arxiv}`]
    .filter(Boolean).map((u) => u.toLowerCase());
  const doi = work.ids?.doi || '';
  return allNodes().filter((d) => isKnowledge(d, clipPath) && d.type !== 'clip'
    && d.sourceUrls.some((u) => keys.includes(u.toLowerCase()) || (doi && normDoi(u) === doi)));
}

// ------------------------------------------------------------------ references
// The entry of [n] in the list: "[12] Author, Title …". Returns the text without the number, or ''.
export function referenceEntry(references, n) {
  for (const r of references || []) {
    const m = String(r).match(/^\[(\d+)\]\s*([\s\S]*)$/);
    if (m && Number(m[1]) === Number(n)) return m[2].trim();
  }
  return '';
}

// What to search for an entry: its DOI, its arXiv id, a quoted title, else the entry itself.
export function searchTermFor(entry) {
  const doi = normDoi(entry);
  if (doi) return doi;
  const arxiv = /arxiv/i.test(entry) ? normArxiv(entry) : '';
  if (arxiv) return `arXiv:${arxiv}`;
  const quoted = entry.match(/[“"]([^”"]{12,})[”"]/);
  if (quoted) return quoted[1].trim();
  return entry.replace(/\s+/g, ' ').slice(0, 200);
}

// A clip you already have for this entry (same DOI or arXiv id).
export function clipForEntry(entry) {
  const doi = normDoi(entry);
  const arxiv = /arxiv/i.test(entry) ? normArxiv(entry) : '';
  if (!doi && !arxiv) return null;
  return allNodes().find((d) => d.type === 'clip' && !d.conflict && ((doi && d.doi === doi) || (arxiv && d.arxiv === arxiv))) || null;
}

// The numbers of a marker: "12" -> [12], "3, 5" -> [3,5], "3-5" / "3–5" -> [3,4,5].
export function citeNumbers(raw) {
  const out = [];
  for (const part of String(raw).split(',')) {
    const m = part.trim().match(/^(\d{1,3})\s*[–-]\s*(\d{1,3})$/);
    if (m && Number(m[2]) >= Number(m[1]) && Number(m[2]) - Number(m[1]) < 30) for (let i = Number(m[1]); i <= Number(m[2]); i++) out.push(i);
    else if (/^\d{1,3}$/.test(part.trim())) out.push(Number(part.trim()));
  }
  return out;
}

const CITE = /\[(\d{1,3}(?:\s*[,–-]\s*\d{1,3})*)\]/g;
const NOT_IN = 'pre, code, a, .katex, .rd-refs, button, h1, h2, h3, h4';

// Wraps the markers [12] in the text as links (a.rd-cite); formulas, code and the list itself stay as they are.
export function linkCitations(root, known = () => true) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const todo = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.includes('[') || n.parentElement.closest(NOT_IN) || n.parentElement.closest('[data-tex]')) continue;
    todo.push(n);
  }
  for (const node of todo) {
    const text = node.nodeValue;
    const frag = document.createDocumentFragment();
    let last = 0;
    let any = false;
    for (const m of text.matchAll(CITE)) {
      const nums = citeNumbers(m[1]);
      if (!nums.length || !nums.some(known)) continue;
      any = true;
      frag.append(text.slice(last, m.index));
      const a = document.createElement('a');
      a.className = 'rd-cite';
      a.href = '#';
      a.dataset.cite = nums.join(',');
      a.textContent = m[0];
      frag.append(a);
      last = m.index + m[0].length;
    }
    if (!any) continue;
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
}
