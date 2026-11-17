// Loom's mind (0.33.0): what you say to Loom, understood without a language model (decided 16.11.: Loom 1 works
// from your own knowledge only; a model comes later as one more source, see loomModel in settings/loom.js).
//
//   understand(text)          → { intent, arg, target }   what you want: open, search, note (also "in <project>"),
//                                                          card, research, collect, attach, next, surface, deeper,
//                                                          ask (a question) or say (anything else)
//   answerFrom(question)      → { found: [{ d, quote, tex }], query }   the sentences of your nodes that answer best,
//                                                          each with its node as the source
//   suggestions(n)            → [{ text, why, chip }]       what Loom would bring up, always with the reason
//   intents()                 the list for the help in the conversation
//
// Nothing here draws or writes; shell/loom-talk.js acts on it. For Python readers: plain functions over the index,
// like a small rule-based parser (regular expressions first, then a search with scoring).
import { allNodes, nodeByPath, normalize, searchNodes, stem } from './search.js';
import { localize, readNodeText, parseNode } from './nodes.js';
import { firstFormula } from './library-store.js';
import { focusProject, projects } from './projects.js';
import { inbox } from './notes.js';
import { pathsInProgress, doneCount, stepStates } from './paths.js';

// ------------------------------------------------------------------ what you want
const ATTACH = [
  /^(?:häng(?:e)?|haeng(?:e)?)\s+(?:es|das|sie|ihn|die notiz|die karte|den fund)?\s*an\s+(.+)$/i,
  /^an\s+(.+?)\s+(?:hängen|anhängen)$/i,
  /^(?:attach|link|pin)(?:\s+(?:it|this|that))?\s+to\s+(.+)$/i,
];
const VERBS = [
  ['surface', /^(?:auftauchen|tauch(?:e)? auf|zurück nach oben|surface|back up|come up)[.!]?$/i],
  ['next', /^(?:nächster schritt|naechster schritt|was (?:jetzt|als nächstes|nun)|wie geht'?s weiter|was steht an|next(?: step)?|what(?:'s| is)? next)[?.!]?$/i],
  ['deeper', /^(?:tiefer|eine ebene tiefer|geh(?:e)? tiefer|tauch(?:e)? (?:ein|in)|go deeper|dive(?: into)?)\s*(.*)$/i],
  ['open', /^(?:öffne|oeffne|öffnen|zeig(?:e)?(?: mir)?|geh(?:e)? (?:zu|zur|zum|in|ins)|open|show(?: me)?|go to)\s+(.+)$/i],
  ['search', /^(?:such(?:e)?(?: nach)?|finde?|search(?: for)?|find)\s+(.+)$/i],
  ['research', /^(?:recherchier(?:e)?|schlag(?:e)? nach|research|look up)\s+(.+)$/i],
  ['collect', /^(?:sammle(?: daten)?|daten sammeln|collect(?: data)?)\s*(?:zu|über|ueber|about|on|for)?\s*(.*)$/i],
  ['card', /^(?:(?:mach(?:e)?|leg(?:e)?(?: an)?|neue)\s+)?(?:(?:eine|daraus eine|als)\s+)?karte\s*(?:an|daraus|davon|aus|zu)?\s*[:,-]?\s*(.*)$/i],
  ['card', /^(?:make\s+)?(?:a\s+)?card\s*(?:from|of|for|:)?\s*[:,-]?\s*(.*)$/i],
  ['note', /^(?:notier(?:e)?|notiz|merk(?:e)? (?:dir|mir)|schreib(?:e)? auf|note(?: down)?|jot down|remember)\s*[:,-]?\s*(.*)$/i],
];
const QUESTION = /\?\s*$|^(?:was|wer|wie|warum|wieso|weshalb|wo|wann|welche[rsnm]?|woher|wozu|womit|gibt es|erklär(?:e)?|erklaer(?:e)?|what|who|how|why|where|when|which|is|are|does|do|can|explain)\b/i;

export function understand(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return { intent: 'none', arg: '' };
  for (const re of ATTACH) { const m = text.match(re); if (m) return { intent: 'attach', arg: m[1].trim() }; }
  for (const [intent, re] of VERBS) {
    const m = text.match(re);
    if (!m) continue;
    const arg = (m[1] || '').trim();
    if (intent === 'note') { const into = intoProject(arg); return { intent, arg: into.rest, target: into.project }; }
    return { intent, arg };
  }
  if (QUESTION.test(text)) return { intent: 'ask', arg: text };
  return { intent: 'say', arg: text };
}

// "in ToolLib: Farben prüfen" → the project ToolLib and "Farben prüfen" (the longest title that fits wins)
function intoProject(arg) {
  const m = arg.match(/^(?:in|ins|bei|zu|zum|für|fuer|to|into|for)\s+(.+)$/i);
  if (!m) return { project: null, rest: arg };
  const rest = normalize(m[1]);
  let best = null;
  for (const p of projects()) {
    const name = normalize(p.title);
    if (name && rest.startsWith(name) && (!best || name.length > normalize(best.title).length)) best = p;
  }
  if (!best) return { project: null, rest: arg };
  const cut = m[1].slice(best.title.length).replace(/^[\s:,.–-]+/, '');
  return { project: best, rest: cut };
}

// The node a few words mean: its title, another name or the best hit of the search.
export function nodeFor(words) {
  const want = normalize(words).replace(/^(?:die|der|das|den|the|a|an|mein(?:e|en)?|my)\s+/, '');
  if (!want) return null;
  const all = allNodes().filter((d) => !d.conflict);
  const exact = all.find((d) => [d.title, d.title_de, ...(d.aliases || [])].some((n) => n && normalize(n) === want));
  return exact || searchNodes(words, { limit: 1 })[0] || null;
}

// ------------------------------------------------------------------ answers from your knowledge
const STOP = new Set(('der die das den dem des ein eine einen einem einer und oder aber ist sind war was wer wie warum wieso weshalb wo wann welche welcher welches '
  + 'gibt es mir mich ich du dir eigentlich denn noch schon nur auch so zu im in am an auf aus bei mit nach von vor fur fuer uber ueber um wird werden kann '
  + 'man mal bitte eigentlich genau jetzt hier dort sein seine ihr ihre diese dieser dieses wenn dann weil dass ob gibt '
  + 'the a an and or but is are was were what who how why where when which does do can of in on at to for with from about it this that there explain erklar erklare '
  + 'please one you your my me i we our they them be been get make').split(' '));
// two words count as the same when they agree in their first letters (chirale ~ chiral, anomalie ~ anomaly): good
// enough across German and English without a dictionary
export function near(a, b) {
  if (a === b) return true;
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  return p >= 5 || (p >= 4 && Math.min(a.length, b.length) <= 6 && Math.abs(a.length - b.length) <= 2);
}
const keyWords = (text) => normalize(text).split(/[^a-z0-9äöü+-]+/).filter((w) => w.length > 1 && !STOP.has(w));

function sentences(md) {
  return md.replace(/```[\s\S]*?```/g, ' ').replace(/\$\$[\s\S]*?\$\$/g, ' ').replace(/^#+\s.*$/gm, ' ').replace(/^:::.*$/gm, ' ')
    .replace(/([.!?])\s+/g, '$1\n').split(/\n+/).map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => x.length > 12 && x.length < 420);
}

// The best few sentences for a question, each from one node, with the formula of a card when it has one.
export async function answerFrom(question, { lang = 'en', limit = 3 } = {}) {
  const words = keyWords(question);
  const query = words.join(' ');
  if (!query) return { found: [], query };
  const hits = searchNodes(query, { limit: 8 }).filter((d) => !['project', 'library', 'research'].includes(d.type));
  const stems = [...new Set(words.map((w) => stem(w)))];
  const hit = (list) => stems.filter((q) => list.some((w) => near(q, w))).length;
  const scored = [];
  for (const [rank, d] of hits.entries()) {
    let body = '';
    try { body = localize(parseNode(await readNodeText(d.path), d.path).body, lang); } catch { continue; }
    let best = null;
    for (const s of sentences(body)) {
      const n = hit(keyWords(s).map((w) => stem(w)));
      const score = n / Math.max(1, stems.length) + 0.15 / (rank + 1);
      if (!best || score > best.score) best = { s, score };
    }
    const lead = d.lead?.[lang] || d.lead?.en || '';
    // only what really speaks about the question: a sentence with one of its words, or a title that names one
    const named = hit(keyWords([d.title, d.title_de, ...(d.aliases || [])].filter(Boolean).join(' ')).map((w) => stem(w))) > 0;
    const said = best && best.score > 0.2;
    if (!said && !named) continue;
    const quote = said ? best.s : lead;
    if (!quote && !firstFormula(body)) continue;
    scored.push({ d, quote, tex: firstFormula(body) || '', score: (best?.score || 0.1) + 0.3 / (rank + 1) });
  }
  scored.sort((a, b) => b.score - a.score);
  return { found: scored.slice(0, limit), query };
}

// ------------------------------------------------------------------ suggestions, always with a reason
// Each is { key, text, why, chip: { label, act, arg } }; what you set aside (pref loom.dismissed) does not come again
// the same day.
export function suggestions({ max = 1, dismissed = [] } = {}) {
  const out = [];
  const f = focusProject();
  if (f?.steps?.next) out.push({ key: `next:${f.path}:${f.steps.next}`, text: f.steps.next, why: 'next', whyArg: f.title, chip: { label: 'go', act: 'open', arg: f.path } });
  const waiting = projects().filter((p) => p.state === 'active' && p.steps?.wait).slice(0, 1);
  for (const p of waiting) {
    const step = (p.steps.list || []).find((x) => x.status === 'wait');
    if (step) out.push({ key: `wait:${p.path}:${step.text}`, text: step.text, why: 'wait', whyArg: p.title, chip: { label: 'open', act: 'open', arg: p.path } });
  }
  const box = inbox();
  if (box.length) out.push({ key: `inbox:${box.length}`, text: String(box.length), why: 'inbox', chip: { label: 'open', act: 'open', arg: box[0].path } });
  for (const x of pathsInProgress().slice(0, 1)) {
    const states = stepStates(x.node);
    out.push({ key: `path:${x.node.path}`, text: x.node.title, why: 'path', whyArg: `${doneCount(states)}/${x.node.pathSteps.length}`, chip: { label: 'go', act: 'open', arg: x.node.path } });
  }
  const notes = (f ? f.links : []).map((slug) => allNodes().find((d) => d.slug === slug)).filter((d) => d?.type === 'note' && /\$|=/.test(d.lead?.en || d.title || ''));
  if (notes[0]) out.push({ key: `card:${notes[0].path}`, text: notes[0].title, why: 'card', chip: { label: 'card', act: 'card', arg: notes[0].path } });
  return out.filter((x) => !dismissed.includes(x.key)).slice(0, max);
}

// What Loom understands, for the little help in the conversation.
export const INTENTS = ['ask', 'note', 'noteIn', 'card', 'search', 'open', 'research', 'attach', 'next', 'deeper', 'surface'];
export const nodeOf = (path) => nodeByPath(path);
