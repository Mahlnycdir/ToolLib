// Reader (0.14.1): brings the text of a work into the reader. Order for an arXiv paper: the LaTeX source (exact
// formulas), then the PDF; for other works the free version's PDF or page. Everything ends as Markdown with LaTeX
// formulas, an outline, a list of references and a place for your highlights.
// The clip node keeps it: abstract, then "## Text", "## References", "## Highlights" (functions at the end of this file).
import { fetchPage, researchSettings, ResearchError } from './research.js';
import { arxivFromUrl, bestFree, normArxiv } from './research-merge.js';

export class ReaderError extends Error {
  constructor(code, detail = '') { super(detail ? `${code}: ${detail}` : code); this.code = code; }
}

const today = () => new Date().toISOString().slice(0, 10);
const isPdf = (bytes, type) => /pdf/.test(type) || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);

// ------------------------------------------------------------------ what to read
// version: one entry of work.versions, or null for the best free one.
export function planFor(work, version = null) {
  const v = version || bestFree(work) || work.versions?.[0] || null;
  const id = arxivFromUrl(v?.url) || arxivFromUrl(v?.pdf) || (!v ? normArxiv(work.ids?.arxiv) : '');
  const steps = [];
  if (id) {
    steps.push({ via: 'arxiv-source', url: `https://arxiv.org/e-print/${id}` });
    steps.push({ via: 'pdf', url: `https://arxiv.org/pdf/${id}` });
  } else {
    if (v?.pdf) steps.push({ via: 'auto', url: v.pdf });
    if (v?.url && v.url !== v?.pdf) steps.push({ via: 'auto', url: v.url });
    if (!steps.length && work.ids?.doi) steps.push({ via: 'auto', url: `https://doi.org/${work.ids.doi}` });
  }
  return { version: v, steps, openUrl: v?.url || v?.pdf || (work.ids?.doi ? `https://doi.org/${work.ids.doi}` : '') };
}

// ------------------------------------------------------------------ reading
async function readStep(step, { signal, onStatus }) {
  onStatus?.({ step: 'fetch', via: step.via, url: step.url });
  const page = await fetchPage(step.url, { signal, onProgress: (got, total) => onStatus?.({ step: 'fetch', via: step.via, url: step.url, got, total }) });
  const done = { url: step.url, finalUrl: page.finalUrl, fetched: today() };
  onStatus?.({ step: 'convert', via: step.via });
  const pdf = async () => {
    const { pdfToDoc } = await import('./reader-pdf.js');
    return pdfToDoc(page.bytes, { signal, onProgress: (n, total) => onStatus?.({ step: 'convert', via: 'pdf', page: n, pages: total }) });
  };
  if (step.via === 'arxiv-source') {
    const { gunzipSync, strFromU8 } = await import('../../vendor/reader.js');
    const { unpackSource, latexToDoc } = await import('./reader-latex.js');
    let unpacked;
    try { unpacked = unpackSource(page.bytes, { gunzipSync, strFromU8 }); } catch { throw new ReaderError('bad-source'); }
    if (unpacked.kind === 'pdf') return { ...(await pdf()), ...done, via: 'pdf', warnings: ['pdf-only'] };
    if (unpacked.kind !== 'tex') throw new ReaderError('no-source');
    const doc = latexToDoc(unpacked.files);
    if (!doc || doc.markdown.length < 400) throw new ReaderError('no-source');
    return { ...doc, via: 'arxiv-source', warnings: [], ...done };
  }
  if (step.via === 'pdf' || isPdf(page.bytes, page.contentType)) return { ...(await pdf()), ...done };
  const { htmlToDoc, decodeHtml } = await import('./reader-html.js');
  const doc = await htmlToDoc(decodeHtml(page.bytes, page.contentType), page.finalUrl || step.url);
  return { ...doc, ...done };
}

// Tries the steps in order; the first that gives text wins. A failed first step is told (the reader shows it).
export async function readWork(plan, { signal, onStatus } = {}) {
  let first = null;
  for (const step of plan.steps) {
    try {
      const doc = await readStep(step, { signal, onStatus });
      if (first && step !== plan.steps[0]) doc.warnings = [...(doc.warnings || []), `fallback:${first.code}`];
      return doc;
    } catch (e) {
      if (signal?.aborted || e?.code === 'aborted') throw e;
      first = first || (e instanceof ResearchError || e instanceof ReaderError ? e : new ReaderError('failed', String(e?.message || e)));
      console.warn('Reader step failed', step.via, step.url, e);
      // a missing fetcher, a wrong token or no network will not change with the next step
      if (['no-worker', 'worker-token', 'worker-origin', 'offline'].includes(e?.code)) throw e;
    }
  }
  if (!plan.steps.length) throw new ReaderError('nothing');
  throw first;
}

export const canRead = (settings = researchSettings()) => !!(settings.worker && settings.token);

// ------------------------------------------------------------------ outline
// Headings of the stored text: "###" first level, "####" second level. Code and display formulas are skipped.
export function outlineOf(markdown) {
  const out = [];
  let fence = false;
  let math = false;
  for (const line of String(markdown).split('\n')) {
    const t = line.trim();
    if (/^(```|~~~)/.test(t)) { fence = !fence; continue; }
    if (fence) continue;
    if (t === '$$') { math = !math; continue; }
    if (math) continue;
    const m = line.match(/^(#{3,4})\s+(.+?)\s*$/);
    if (m) out.push({ level: m[1].length - 2, title: m[2] });
  }
  return out;
}

// ------------------------------------------------------------------ the body of a clip
// Lines with "## " outside code and display formulas start a part. The lead (before the first part) is the abstract.
export function parseBody(body) {
  const parts = [{ title: null, lines: [] }];
  let fence = false;
  let math = false;
  for (const line of String(body).replace(/\r\n?/g, '\n').split('\n')) {
    const t = line.trim();
    if (/^(```|~~~)/.test(t)) fence = !fence;
    else if (!fence && t === '$$') math = !math;
    const h = !fence && !math && line.match(/^## (.+?)\s*$/);
    if (h) parts.push({ title: h[1], lines: [] }); else parts[parts.length - 1].lines.push(line);
  }
  const text = (title) => parts.find((p) => p.title === title)?.lines.join('\n').trim() || '';
  return {
    parts,
    lead: parts[0].lines.join('\n').trim(),
    text: text('Text'),
    references: text('References').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean),
    highlights: parseHighlights(text('Highlights')),
  };
}

function setPart(parts, title, content) {
  const i = parts.findIndex((p) => p.title === title);
  if (i >= 0) { if (content == null || content === '') parts.splice(i, 1); else parts[i].lines = ['', ...content.split('\n'), '']; return; }
  if (content == null || content === '') return;
  parts.push({ title, lines: ['', ...content.split('\n'), ''] });
}

// parts: from parseBody. change: { lead, text, references, highlights } – only what is given changes.
export function composeBody(parts, change = {}) {
  const next = parts.map((p) => ({ title: p.title, lines: [...p.lines] }));
  if ('lead' in change) next[0].lines = [change.lead.trim(), ''];
  if ('text' in change) setPart(next, 'Text', change.text);
  if ('references' in change) setPart(next, 'References', (change.references || []).join('\n\n'));
  if ('highlights' in change) setPart(next, 'Highlights', formatHighlights(change.highlights || []));
  // keep our parts in a fixed order at the end: Text, References, Highlights
  const ours = ['Text', 'References', 'Highlights'];
  const other = next.slice(1).filter((p) => !ours.includes(p.title));
  const mine = ours.map((t) => next.find((p) => p.title === t)).filter(Boolean);
  const render = (p) => `## ${p.title}\n${p.lines.join('\n').replace(/^\n*/, '\n').replace(/\n*$/, '\n')}`;
  const lead = next[0].lines.join('\n').trim();
  return `${lead ? `${lead}\n\n` : ''}${[...other, ...mine].map(render).join('\n')}`.replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
}

// ------------------------------------------------------------------ highlights
//   > the marked text
//
//   § Section title
//   your note (several lines possible)
//
//   ---
export function formatHighlights(list) {
  return list.map((h) => {
    const note = String(h.note || '').trim();
    const head = h.section ? `§ ${h.section}` : '';
    return [`> ${String(h.quote).replace(/\s+/g, ' ').trim()}`, head || note ? `\n${[head, note].filter(Boolean).join('\n')}` : ''].join('\n').trim();
  }).join('\n\n---\n\n');
}

export function parseHighlights(section) {
  if (!section.trim()) return [];
  return section.split(/\n\s*---\s*\n/).map((chunk) => {
    const quote = [];
    const rest = [];
    for (const line of chunk.split('\n')) (line.startsWith('>') ? quote : rest).push(line);
    const lines = rest.join('\n').trim().split('\n');
    let sectionTitle = '';
    if (lines[0]?.startsWith('§ ')) sectionTitle = lines.shift().slice(2).trim();
    return { quote: quote.map((l) => l.replace(/^>\s?/, '')).join(' ').trim(), section: sectionTitle, note: lines.join('\n').trim() };
  }).filter((h) => h.quote);
}
