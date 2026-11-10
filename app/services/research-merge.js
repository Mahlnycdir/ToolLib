// Research (0.14.0): one work found by several sources becomes one hit with all its versions, ordered from the most
// useful free version to the paid one. Nothing here touches the network or the page, so it is easy to test.
//
// A record is what one source says about one work:
//   { source, rank, title, authors: [..], year, venue, type, abstract, cited,
//     ids: { doi, arxiv, pmid, pmcid, openalex, s2, isbn: [..] },
//     versions: [{ kind: 'published'|'accepted'|'preprint'|'other', free, url, pdf, host, license }] }
// A work is the merge of the records that belong together (same DOI, arXiv id, PMID or PMCID, or the same title
// with a shared author), with the versions of all of them.

// ------------------------------------------------------------------ identifiers
export function normDoi(s) {
  if (!s) return '';
  const m = String(s).trim().match(/10\.\d{4,9}\/[^\s"<>]+/i);
  return m ? m[0].replace(/[.,;)\]]+$/, '').toLowerCase() : '';
}

// arXiv ids without the version: 1810.04414, hep-th/9301001.
export function normArxiv(s) {
  if (!s) return '';
  const t = String(s).trim().replace(/^arxiv:\s*/i, '');
  const m = t.match(/(\d{4}\.\d{4,5})(v\d+)?/) || t.match(/([a-z-]+(?:\.[a-z]{2})?\/\d{7})(v\d+)?/i);
  return m ? m[1].toLowerCase() : '';
}

export function arxivFromUrl(url) {
  const m = String(url || '').match(/arxiv\.org\/(?:abs|pdf|html)\/([^?#\s]+?)(?:\.pdf)?(?:[?#]|$)/i);
  return m ? normArxiv(m[1]) : '';
}

// The arXiv DOIs (10.48550/arXiv.<id>) stand for the preprint, not for the published version.
export function splitDoi(doi) {
  const d = normDoi(doi);
  const m = d.match(/^10\.48550\/arxiv\.(.+)$/);
  return m ? { doi: '', arxiv: normArxiv(m[1]) } : { doi: d, arxiv: '' };
}

export const normPmcid = (s) => { const m = String(s || '').match(/pmc\d+/i); return m ? m[0].toUpperCase() : ''; };
export const normPmid = (s) => { const m = String(s || '').match(/\d{4,9}/); return m ? m[0] : ''; };

// What you typed: an identifier or words.
export function parseQuery(raw) {
  const q = String(raw || '').trim();
  const doi = normDoi(q);
  if (doi && (q.length < doi.length + 30 || /doi/i.test(q))) {
    const s = splitDoi(doi);
    return s.arxiv ? { kind: 'arxiv', value: s.arxiv, text: q } : { kind: 'doi', value: doi, text: q };
  }
  if (/^(arxiv:\s*)?\d{4}\.\d{4,5}(v\d+)?$/i.test(q) || /^(arxiv:\s*)?[a-z-]+(\.[a-z]{2})?\/\d{7}(v\d+)?$/i.test(q) || /arxiv\.org\/(abs|pdf)\//i.test(q)) {
    return { kind: 'arxiv', value: normArxiv(arxivFromUrl(q) || q), text: q };
  }
  if (/^pmc\d{4,9}$/i.test(q)) return { kind: 'pmcid', value: normPmcid(q), text: q };
  if (/^pmid:?\s*\d{4,9}$/i.test(q)) return { kind: 'pmid', value: normPmid(q), text: q };
  const isbn = q.replace(/^isbn:?\s*/i, '').replace(/[\s-]/g, '');
  if (/^(\d{9}[\dx]|\d{13})$/i.test(isbn) && (/isbn/i.test(q) || /^97[89]/.test(isbn) || /[\s-]/.test(q))) return { kind: 'isbn', value: isbn.toUpperCase(), text: q };
  return { kind: 'text', value: q, text: q };
}

// ------------------------------------------------------------------ text
export function normText(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
    .replace(/\$[^$]*\$/g, (m) => m.replace(/[\\{}^_$]/g, ' '))
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
const STOP = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'and', 'for', 'to', 'with', 'at', 'by', 'from', 'der', 'die', 'das', 'und', 'im', 'zur', 'zum', 'von', 'ein', 'eine', 'einer']);
export const titleTokens = (s) => normText(s).split(' ').filter((w) => w && !STOP.has(w));

function jaccard(a, b) {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let both = 0;
  for (const x of A) if (B.has(x)) both++;
  return both / (A.size + B.size - both);
}

// Family names, for comparing authors across sources that write names differently ("S. Coleman", "Coleman S").
function nameTokens(authors) {
  const out = new Set();
  for (const a of (authors || []).slice(0, 4)) for (const w of normText(a).split(' ')) if (w.length >= 3) out.add(w);
  return out;
}
function shareAuthor(a, b) {
  const A = nameTokens(a);
  for (const w of nameTokens(b)) if (A.has(w)) return true;
  return false;
}

// Do two records describe the same work although no identifier connects them?
export function sameWork(a, b) {
  if (a.ids.arxiv && b.ids.arxiv && a.ids.arxiv !== b.ids.arxiv) return false;
  if (a.ids.pmid && b.ids.pmid && a.ids.pmid !== b.ids.pmid) return false;
  const ta = titleTokens(a.title);
  const tb = titleTokens(b.title);
  if (ta.length < 2 || tb.length < 2) return false;
  const exact = ta.join(' ') === tb.join(' ');
  const sim = exact ? 1 : jaccard(ta, tb);
  if (sim < 0.86) return false;
  const years = a.year && b.year ? Math.abs(a.year - b.year) : 0;
  if (years > 4) return false;
  if (a.authors?.length && b.authors?.length) return shareAuthor(a.authors, b.authors);
  return exact && ta.length >= 4 && years <= 1;
}

// ------------------------------------------------------------------ versions
export const KIND_ORDER = ['published', 'accepted', 'preprint', 'other'];
export const versionRank = (v) => (v.free ? KIND_ORDER.indexOf(v.kind) : 4 + KIND_ORDER.indexOf(v.kind));

function versionKey(v) {
  const ax = arxivFromUrl(v.url) || arxivFromUrl(v.pdf);
  if (ax) return `arxiv:${ax}`;
  const doi = /doi\.org\//i.test(v.url) ? normDoi(v.url) : '';
  if (doi) return `doi:${doi}`;
  const pmc = String(v.url || '').match(/(?:ncbi\.nlm\.nih\.gov\/pmc\/articles|europepmc\.org\/(?:article\/PMC|abstract\/PMC)|pmc\.ncbi\.nlm\.nih\.gov\/articles)\/?(PMC\d+)/i);
  if (pmc) return `pmc:${pmc[1].toUpperCase()}`;
  return String(v.url || v.pdf || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[#?].*$/, '').replace(/\/+$/, '');
}

// Joins versions that are the same copy (arXiv abs and pdf, doi.org links, the same address) and orders them.
export const webUrl = (u) => (/^https?:\/\/[^\s"<>]+$/i.test(String(u || '').trim()) ? String(u).trim() : '');

export function orderVersions(list) {
  const byKey = new Map();
  for (const raw of list) {
    if (!raw) continue;
    const v = { ...raw, url: webUrl(raw.url), pdf: webUrl(raw.pdf) };   // links from the web: only http and https
    if (!(v.url || v.pdf)) continue;
    const key = versionKey(v);
    const old = byKey.get(key);
    if (!old) { byKey.set(key, { ...v, via: [...new Set(v.via || [])] }); continue; }
    old.free = old.free || !!v.free;
    if (!old.pdf && v.pdf) old.pdf = v.pdf;
    if (!old.url && v.url) old.url = v.url;
    if (!old.license && v.license) old.license = v.license;
    if (!old.host && v.host) old.host = v.host;
    if (KIND_ORDER.indexOf(v.kind) < KIND_ORDER.indexOf(old.kind) && !key.startsWith('arxiv:')) old.kind = v.kind;
    for (const s of v.via || []) if (!old.via.includes(s)) old.via.push(s);
  }
  return [...byKey.values()].sort((a, b) => versionRank(a) - versionRank(b)
    || (b.pdf ? 1 : 0) - (a.pdf ? 1 : 0)
    || b.via.length - a.via.length);
}

// ------------------------------------------------------------------ merging
const ID_KEYS = ['doi', 'arxiv', 'pmid', 'pmcid'];
const TRUST = ['crossref', 'openalex', 'europepmc', 'doaj', 'doab', 's2', 'arxiv'];   // whose title and venue count
const trust = (s) => { const i = TRUST.indexOf(s); return i < 0 ? TRUST.length : i; };

export function mergeRecords(records) {
  const parent = records.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i, j) => { const a = find(i); const b = find(j); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
  const seen = new Map();
  records.forEach((r, i) => {
    for (const k of ID_KEYS) {
      const v = r.ids?.[k];
      if (!v) continue;
      const key = `${k}:${v}`;
      if (seen.has(key)) union(i, seen.get(key));
      else seen.set(key, i);
    }
  });
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      if (find(i) !== find(j) && sameWork(records[i], records[j])) union(i, j);
    }
  }
  const groups = new Map();
  records.forEach((r, i) => { const g = find(i); groups.set(g, [...(groups.get(g) || []), r]); });
  return [...groups.values()].map(combine);
}

function combine(group) {
  const sorted = [...group].sort((a, b) => trust(a.source) - trust(b.source));
  const pick = (f) => { for (const r of sorted) { const v = f(r); if (v) return v; } return null; };
  const ids = {};
  for (const r of sorted) for (const [k, v] of Object.entries(r.ids || {})) {
    if (k === 'isbn') ids.isbn = [...new Set([...(ids.isbn || []), ...(v || [])])];
    else if (v && !ids[k]) ids[k] = v;
  }
  const published = sorted.find((r) => r.source !== 'arxiv' && r.venue);
  const ranks = {};
  for (const r of group) if (ranks[r.source] == null || r.rank < ranks[r.source]) ranks[r.source] = r.rank;
  const abstract = group.map((r) => r.abstract || '').sort((a, b) => b.length - a.length)[0] || '';
  const authors = pick((r) => (r.authors?.length ? r.authors : null)) || [];
  const years = group.map((r) => r.year).filter(Boolean);
  const versions = orderVersions(group.flatMap((r) => (r.versions || []).map((v) => ({ ...v, via: [r.source] }))));
  const type = pick((r) => (r.type && r.type !== 'other' && r.type !== 'preprint' ? r.type : null)) || pick((r) => r.type) || 'other';
  return {
    key: ids.doi ? `doi:${ids.doi}` : ids.arxiv ? `arxiv:${ids.arxiv}` : ids.pmid ? `pmid:${ids.pmid}` : `t:${titleTokens(sorted[0].title).join('-')}`,
    title: pick((r) => r.title) || '',
    authors,
    year: published?.year || (years.length ? Math.min(...years) : null),
    venue: published?.venue || '',
    type,
    abstract,
    cited: Math.max(0, ...group.map((r) => r.cited || 0)),
    ids,
    versions,
    free: versions.some((v) => v.free),
    sources: [...new Set(group.map((r) => r.source))],
    ranks,
    records: group.length,
  };
}

// Adds records found later (other versions of the same work) to a work.
export function absorb(work, records) {
  const base = { source: '', rank: 0, title: work.title, authors: work.authors, year: work.year, ids: work.ids };
  const fits = records.filter((r) => ID_KEYS.some((k) => r.ids?.[k] && r.ids[k] === work.ids[k]) || sameWork(base, r));
  if (!fits.length) return { work, added: 0 };
  const before = work.versions.length;
  const ids = { ...work.ids };
  for (const r of fits) for (const [k, v] of Object.entries(r.ids || {})) if (v && !ids[k] && k !== 'isbn') ids[k] = v;
  const versions = orderVersions([...work.versions, ...fits.flatMap((r) => (r.versions || []).map((v) => ({ ...v, via: [r.source] })))]);
  const abstract = [work.abstract, ...fits.map((r) => r.abstract || '')].sort((a, b) => b.length - a.length)[0];
  const sources = [...new Set([...work.sources, ...fits.map((r) => r.source)])];
  return { work: { ...work, ids, versions, free: versions.some((v) => v.free), abstract, sources, cited: Math.max(work.cited, ...fits.map((r) => r.cited || 0)) }, added: versions.length - before };
}

// ------------------------------------------------------------------ ranking
// Reciprocal rank fusion: a work that several sources rank high comes first. Free full text, the words of the query
// in the title and (a little) citations move a work up; an exact identifier match goes to the top.
export function rankWorks(works, query, { sort = 'relevance' } = {}) {
  const words = query?.kind === 'text' ? titleTokens(query.value) : [];
  const scored = works.map((w) => {
    let score = 0;
    for (const r of Object.values(w.ranks)) score += 1 / (20 + r + 1);
    if (words.length) {
      const tt = new Set(titleTokens(w.title));
      score += 0.06 * (words.filter((x) => tt.has(x)).length / words.length);
    }
    if (w.free) score *= 1.15;
    score += 0.004 * Math.log10(1 + (w.cited || 0));
    if (query && query.kind !== 'text' && w.ids[query.kind === 'isbn' ? 'isbn' : query.kind]
      && (query.kind === 'isbn' ? w.ids.isbn?.includes(query.value) : w.ids[query.kind] === query.value)) score += 10;
    return { ...w, score };
  });
  const by = {
    relevance: (a, b) => b.score - a.score,
    year: (a, b) => (b.year || 0) - (a.year || 0) || b.score - a.score,
    cited: (a, b) => (b.cited || 0) - (a.cited || 0) || b.score - a.score,
  }[sort] || ((a, b) => b.score - a.score);
  return scored.sort(by);
}

// The free version to open first, or null.
export const bestFree = (work) => work.versions.find((v) => v.free) || null;
