// Research (0.14.0): the open interfaces Toollib searches, each turned into the same records (research-merge.js).
// An adapter builds the addresses for a search and reads the answers; research.js does the fetching.
//   cors 'yes': the browser may read the answers directly; 'no': only through your fetcher (fetch-proxy/worker.js);
//   'try': directly first, through the fetcher when the browser refuses.
// All of them are free; OpenAlex wants a free key, Semantic Scholar works better with one. None gets your name.
import { arxivFromUrl, normArxiv, normDoi, normPmcid, normPmid, splitDoi } from './research-merge.js';

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const year = (v) => { const n = parseInt(String(v ?? '').slice(0, 4), 10); return n > 1000 && n < 3000 ? n : null; };
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const enc = encodeURIComponent;

// Markup in abstracts (Crossref sends JATS XML) as plain text.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function plainText(s) {
  return clean(String(s ?? '')
    .replace(/<\/?(jats:)?(p|sec|title)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
      return ENT[e.toLowerCase()] ?? m;
    }))
    .replace(/^abstract\s*[:.]?\s+/i, '');
}

// Words of a query for interfaces with their own query language: no operators, no quotes.
const words = (q, max = 12) => clean(String(q).replace(/[\\/:()[\]{}^~*?"!<>|&+=,;]/g, ' ')).split(' ').filter(Boolean).slice(0, max);
const isCc = (url) => /creativecommons\.org|\/licenses\/(by|cc0)/i.test(String(url || ''));

// ------------------------------------------------------------------ OpenAlex
const OA_SELECT = 'id,doi,title,display_name,publication_year,type,ids,open_access,best_oa_location,primary_location,locations,authorships,cited_by_count,abstract_inverted_index';
const oaKind = (v) => ({ publishedVersion: 'published', acceptedVersion: 'accepted', submittedVersion: 'preprint' }[v] || 'other');

function oaAbstract(inv) {
  if (!inv || typeof inv !== 'object') return '';
  const out = [];
  for (const [word, places] of Object.entries(inv)) for (const p of places || []) out[p] = word;
  return clean(out.filter(Boolean).join(' '));
}

function oaRecord(w, rank) {
  const ids = w.ids || {};
  const fromDoi = splitDoi(w.doi || ids.doi);
  const locs = Array.isArray(w.locations) && w.locations.length ? w.locations : [w.primary_location, w.best_oa_location].filter(Boolean);
  let arxiv = fromDoi.arxiv;
  const versions = locs.map((l) => {
    const url = l.landing_page_url || l.pdf_url || '';
    const ax = arxivFromUrl(url) || arxivFromUrl(l.pdf_url);
    if (ax && !arxiv) arxiv = ax;
    const host = l.source?.display_name || l.raw_source_name || hostOf(url);
    return { kind: ax ? 'preprint' : oaKind(l.version), free: !!l.is_oa, url, pdf: l.pdf_url || '', host, license: l.license || '' };
  });
  const type = { article: 'article', 'book-chapter': 'chapter', book: 'book', preprint: 'preprint', dissertation: 'thesis', review: 'article', letter: 'article' }[w.type] || (w.type ? 'other' : 'article');
  return {
    source: 'openalex', rank,
    title: clean(w.title || w.display_name),
    authors: (w.authorships || []).map((a) => clean(a.author?.display_name || a.raw_author_name)).filter(Boolean),
    year: w.publication_year || null,
    venue: clean(w.primary_location?.source?.display_name),
    type,
    abstract: oaAbstract(w.abstract_inverted_index),
    cited: w.cited_by_count || 0,
    ids: { doi: fromDoi.doi, arxiv, pmid: normPmid(ids.pmid), pmcid: normPmcid(ids.pmcid), openalex: String(w.id || '').replace(/^https?:\/\/openalex\.org\//, '') },
    versions,
  };
}

const openalex = {
  id: 'openalex', name: 'OpenAlex', home: 'https://openalex.org', cors: 'yes', what: { en: 'all disciplines, with the free copies Unpaywall knows', de: 'alle Fächer, mit den freien Fassungen aus Unpaywall' },
  key: (s) => (s.openalexKey ? `&api_key=${enc(s.openalexKey)}` : ''),
  requests(q, s, limit) {
    const k = this.key(s);
    const one = (path) => [{ url: `https://api.openalex.org/works/${path}?select=${OA_SELECT}${k}`, as: 'json', one: true }];
    if (q.kind === 'doi') return one(`doi:${enc(q.value)}`);
    if (q.kind === 'arxiv') return one(`doi:10.48550/arxiv.${enc(q.value)}`);
    if (q.kind === 'pmid') return one(`pmid:${q.value}`);
    if (q.kind === 'pmcid') return one(`pmcid:${q.value}`);
    return [{ url: `https://api.openalex.org/works?search=${enc(q.value)}&per-page=${limit}&select=${OA_SELECT}${k}`, as: 'json' }];
  },
  versionRequests(work, s) {
    return work.title ? [{ url: `https://api.openalex.org/works?filter=title.search:${enc(words(work.title, 16).join(' '))}&per-page=6&select=${OA_SELECT}${this.key(s)}`, as: 'json' }] : [];
  },
  parse(data, req) {
    const list = req.one ? (data && data.id ? [data] : []) : data?.results || [];
    return list.map((w, i) => oaRecord(w, i));
  },
};

// ------------------------------------------------------------------ Crossref
const CR_SELECT = 'DOI,title,subtitle,author,issued,container-title,type,license,link,relation,is-referenced-by-count,publisher,abstract,ISBN,URL';
function crRecord(m, rank) {
  const doi = normDoi(m.DOI);
  const now = Date.now();
  const openLicense = (m.license || []).some((l) => isCc(l.URL) && (!l.start?.timestamp || l.start.timestamp <= now) && (l['content-version'] || 'vor') !== 'am');
  const preprint = m.type === 'posted-content' || m.subtype === 'preprint';
  const pdf = (m.link || []).find((l) => /pdf/i.test(l['content-type'] || '') && (l['intended-application'] || '') !== 'similarity-checking');
  const versions = [{ kind: preprint ? 'preprint' : 'published', free: openLicense || preprint, url: `https://doi.org/${doi}`, pdf: openLicense && pdf ? pdf.URL : '', host: clean(m.publisher), license: (m.license || []).map((l) => l.URL).find(isCc) || '' }];
  // Preprints Crossref knows (has-preprint) are versions too; arXiv ones carry their id.
  for (const rel of m.relation?.['has-preprint'] || []) {
    const s = splitDoi(rel.id);
    if (s.arxiv) versions.push({ kind: 'preprint', free: true, url: `https://arxiv.org/abs/${s.arxiv}`, pdf: `https://arxiv.org/pdf/${s.arxiv}`, host: 'arXiv' });
    else if (s.doi) versions.push({ kind: 'preprint', free: true, url: `https://doi.org/${s.doi}`, host: '' });
  }
  const type = { 'journal-article': 'article', 'proceedings-article': 'article', 'book-chapter': 'chapter', book: 'book', monograph: 'book', 'edited-book': 'book', 'reference-book': 'book', 'posted-content': 'preprint', dissertation: 'thesis' }[m.type] || 'other';
  const title = clean([...(m.title || []).slice(0, 1), ...(m.subtitle || []).slice(0, 1)].join(': '));
  return {
    source: 'crossref', rank, title,
    authors: (m.author || []).map((a) => clean(a.name || [a.given, a.family].filter(Boolean).join(' '))).filter(Boolean),
    year: year(m.issued?.['date-parts']?.[0]?.[0]),
    venue: clean((m['container-title'] || [])[0] || (type === 'book' ? m.publisher : '')),
    type, abstract: plainText(m.abstract), cited: m['is-referenced-by-count'] || 0,
    ids: { doi, isbn: (m.ISBN || []).map((x) => x.replace(/-/g, '')) },
    versions,
  };
}

const crossref = {
  id: 'crossref', name: 'Crossref', home: 'https://www.crossref.org', cors: 'yes', what: { en: 'every DOI, published versions', de: 'alle DOIs, veröffentlichte Fassungen' },
  requests(q, _s, limit) {
    if (q.kind === 'doi') return [{ url: `https://api.crossref.org/works/${enc(q.value)}`, as: 'json', one: true }];
    if (q.kind === 'isbn') return [{ url: `https://api.crossref.org/works?filter=isbn:${enc(q.value)}&rows=${limit}&select=${CR_SELECT}`, as: 'json' }];
    if (q.kind !== 'text') return [];
    return [{ url: `https://api.crossref.org/works?query.bibliographic=${enc(q.value)}&rows=${limit}&select=${CR_SELECT}`, as: 'json' }];
  },
  versionRequests(work) {
    if (!work.title || work.ids.doi) return [];
    const who = (work.authors[0] || '').split(' ').pop();
    return [{ url: `https://api.crossref.org/works?query.bibliographic=${enc(`${work.title} ${who}`)}&rows=5&select=${CR_SELECT}`, as: 'json' }];
  },
  parse(data, req) {
    const list = req.one ? (data?.message ? [data.message] : []) : data?.message?.items || [];
    return list.map((m, i) => crRecord(m, i));
  },
};

// ------------------------------------------------------------------ arXiv (Atom; the browser may not read it directly)
function arxivRecords(xml) {
  if (typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const NS = 'http://www.w3.org/2005/Atom';
  const AX = 'http://arxiv.org/schemas/atom';
  const text = (el, tag, ns = NS) => clean(el.getElementsByTagNameNS(ns, tag)[0]?.textContent);
  return [...doc.getElementsByTagNameNS(NS, 'entry')].map((e, i) => {
    const id = normArxiv(text(e, 'id').replace(/^https?:\/\/arxiv\.org\/abs\//, ''));
    if (!id) return null;
    const doi = normDoi(text(e, 'doi', AX));
    const journal = text(e, 'journal_ref', AX);
    const versions = [{ kind: 'preprint', free: true, url: `https://arxiv.org/abs/${id}`, pdf: `https://arxiv.org/pdf/${id}`, host: 'arXiv', license: '' }];
    if (doi) versions.push({ kind: 'published', free: false, url: `https://doi.org/${doi}`, host: journal || '' });
    return {
      source: 'arxiv', rank: i,
      title: text(e, 'title'),
      authors: [...e.getElementsByTagNameNS(NS, 'author')].map((a) => text(a, 'name')).filter(Boolean),
      year: year(text(e, 'published')),
      venue: journal,
      type: doi || journal ? 'article' : 'preprint',
      abstract: text(e, 'summary'),
      cited: 0,
      ids: { arxiv: id, doi },
      versions,
    };
  }).filter(Boolean);
}

const arxivQuery = (ws, field = 'all') => ws.map((w) => `${field}:${w}`).join(' AND ');
const arxiv = {
  id: 'arxiv', name: 'arXiv', home: 'https://arxiv.org', cors: 'no', gap: 3100, ttl: 3600, what: { en: 'preprints in physics, maths and computer science', de: 'Preprints aus Physik, Mathematik und Informatik' },
  requests(q, _s, limit) {
    if (q.kind === 'arxiv') return [{ url: `https://export.arxiv.org/api/query?id_list=${enc(q.value)}&max_results=1`, as: 'text' }];
    if (q.kind !== 'text') return [];
    const ws = words(q.value, 10);
    return ws.length ? [{ url: `https://export.arxiv.org/api/query?search_query=${enc(arxivQuery(ws))}&sortBy=relevance&max_results=${limit}`, as: 'text' }] : [];
  },
  versionRequests(work) {
    if (!work.title || work.ids.arxiv) return [];
    const ws = words(work.title, 10).filter((w) => w.length > 2).slice(0, 8);
    const who = normArxivAuthor(work.authors[0]);
    const query = arxivQuery(ws, 'ti') + (who ? ` AND au:${who}` : '');
    return ws.length ? [{ url: `https://export.arxiv.org/api/query?search_query=${enc(query)}&max_results=5`, as: 'text' }] : [];
  },
  parse: (xml) => arxivRecords(xml),
};
function normArxivAuthor(name) {
  const last = clean(name).split(' ').pop() || '';
  return last.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z-]/g, '');
}

// ------------------------------------------------------------------ Semantic Scholar
const S2_FIELDS = 'title,year,authors,externalIds,openAccessPdf,venue,citationCount,abstract,publicationTypes,isOpenAccess';
function s2Record(p, rank) {
  const x = p.externalIds || {};
  const doi = splitDoi(x.DOI);
  const arxivId = normArxiv(x.ArXiv) || doi.arxiv;
  const versions = [];
  const oa = p.openAccessPdf;
  if (oa?.url) {
    const ax = arxivFromUrl(oa.url);
    const kind = ax ? 'preprint' : /GOLD|HYBRID|BRONZE/i.test(oa.status || '') ? 'published' : 'other';
    versions.push({ kind, free: true, url: oa.url, pdf: /\.pdf($|\?)/i.test(oa.url) || ax ? oa.url : '', host: hostOf(oa.url), license: oa.license || '' });
  }
  if (doi.doi) versions.push({ kind: 'published', free: false, url: `https://doi.org/${doi.doi}`, host: clean(p.venue) });
  if (arxivId) versions.push({ kind: 'preprint', free: true, url: `https://arxiv.org/abs/${arxivId}`, pdf: `https://arxiv.org/pdf/${arxivId}`, host: 'arXiv' });
  const types = p.publicationTypes || [];
  return {
    source: 's2', rank,
    title: clean(p.title),
    authors: (p.authors || []).map((a) => clean(a.name)).filter(Boolean),
    year: p.year || null,
    venue: clean(p.venue),
    type: types.includes('Book') ? 'book' : types.includes('JournalArticle') || types.includes('Conference') ? 'article' : arxivId && !doi.doi ? 'preprint' : 'article',
    abstract: clean(p.abstract), cited: p.citationCount || 0,
    ids: { doi: doi.doi, arxiv: arxivId, pmid: normPmid(x.PubMed), pmcid: x.PubMedCentral ? normPmcid(`PMC${x.PubMedCentral}`) : '', s2: p.paperId || '' },
    versions,
  };
}

const s2 = {
  id: 's2', name: 'Semantic Scholar', home: 'https://www.semanticscholar.org', cors: 'try', gap: 1100, what: { en: 'all disciplines, links to free PDFs', de: 'alle Fächer, Links zu freien PDFs' },
  headers: (s) => (s.s2Key ? { 'x-api-key': s.s2Key } : {}),
  requests(q, s, limit) {
    const one = (id) => [{ url: `https://api.semanticscholar.org/graph/v1/paper/${id}?fields=${S2_FIELDS}`, as: 'json', one: true, headers: this.headers(s) }];
    if (q.kind === 'doi') return one(`DOI:${enc(q.value)}`);
    if (q.kind === 'arxiv') return one(`arXiv:${enc(q.value)}`);
    if (q.kind === 'pmid') return one(`PMID:${q.value}`);
    if (q.kind === 'pmcid') return one(`PMCID:${q.value.replace(/^PMC/, '')}`);
    if (q.kind !== 'text') return [];
    return [{ url: `https://api.semanticscholar.org/graph/v1/paper/search?query=${enc(q.value)}&limit=${limit}&fields=${S2_FIELDS}`, as: 'json', headers: this.headers(s) }];
  },
  versionRequests(work, s) {
    return work.title ? [{ url: `https://api.semanticscholar.org/graph/v1/paper/search/match?query=${enc(work.title)}&fields=${S2_FIELDS}`, as: 'json', headers: this.headers(s) }] : [];
  },
  parse(data, req) {
    const list = req.one ? (data?.paperId ? [data] : []) : data?.data || [];
    return list.map((p, i) => s2Record(p, i));
  },
};

// ------------------------------------------------------------------ Europe PMC (life sciences, medicine, nursing)
function epmcRecord(r, rank) {
  const pmcid = normPmcid(r.pmcid);
  const free = r.isOpenAccess === 'Y' || r.inEPMC === 'Y';
  const versions = [];
  if (r.source === 'PPR') {
    versions.push({ kind: 'preprint', free: true, url: `https://europepmc.org/article/PPR/${r.id}`, host: 'Europe PMC' });
  } else if (pmcid) {
    versions.push({ kind: r.authMan === 'Y' || r.epmcAuthMan === 'Y' ? 'accepted' : 'published', free, url: `https://europepmc.org/article/PMC/${pmcid}`, pdf: r.hasPDF === 'Y' ? `https://europepmc.org/articles/${pmcid}?pdf=render` : '', host: 'Europe PMC', license: r.license || '' });
  }
  for (const f of r.fullTextUrlList?.fullTextUrl || []) {
    if (!f.url || /europepmc\.org/i.test(f.url)) continue;
    const open = f.availabilityCode === 'OA' || f.availabilityCode === 'F';
    versions.push({ kind: f.documentStyle === 'doi' ? 'published' : 'other', free: open, url: f.url, pdf: f.documentStyle === 'pdf' && open ? f.url : '', host: f.site || hostOf(f.url) });
  }
  if (r.doi) versions.push({ kind: r.source === 'PPR' ? 'preprint' : 'published', free: r.source === 'PPR', url: `https://doi.org/${normDoi(r.doi)}`, host: clean(r.journalInfo?.journal?.title || r.journalTitle) });
  const authors = (r.authorList?.author || []).map((a) => clean(a.firstName && a.lastName ? `${a.firstName} ${a.lastName}` : a.fullName || a.collectiveName)).filter(Boolean);
  return {
    source: 'europepmc', rank,
    title: clean(r.title).replace(/\.$/, ''),
    authors: authors.length ? authors : clean(r.authorString).replace(/\.$/, '').split(/,\s*/).filter(Boolean),
    year: year(r.pubYear),
    venue: clean(r.journalInfo?.journal?.title || r.journalTitle || r.bookOrReportDetails?.publisher),
    type: r.source === 'PPR' ? 'preprint' : r.pubModel === 'Book' || r.hasBook === 'Y' ? 'book' : 'article',
    abstract: plainText(r.abstractText), cited: r.citedByCount || 0,
    ids: { doi: splitDoi(r.doi).doi, pmid: normPmid(r.pmid), pmcid },
    versions,
  };
}

const europepmc = {
  id: 'europepmc', name: 'Europe PMC', home: 'https://europepmc.org', cors: 'yes', what: { en: 'medicine, nursing and life sciences', de: 'Medizin, Pflege und Biowissenschaften' },
  requests(q, _s, limit) {
    const query = { doi: `DOI:"${q.value}"`, pmid: `EXT_ID:${q.value} AND SRC:MED`, pmcid: `PMCID:${q.value}` }[q.kind] || (q.kind === 'text' ? q.value : '');
    return query ? [{ url: `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${enc(query)}&format=json&resultType=core&pageSize=${limit}`, as: 'json' }] : [];
  },
  versionRequests(work) {
    return work.title && !work.ids.pmid ? [{ url: `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${enc(`TITLE:"${words(work.title, 16).join(' ')}"`)}&format=json&resultType=core&pageSize=5`, as: 'json' }] : [];
  },
  parse: (data) => (data?.resultList?.result || []).map((r, i) => epmcRecord(r, i)),
};

// ------------------------------------------------------------------ DOAJ (open access journals)
function doajRecord(r, rank) {
  const b = r.bibjson || {};
  const doi = normDoi((b.identifier || []).find((x) => String(x.type).toLowerCase() === 'doi')?.id);
  const links = (b.link || []).filter((l) => l.url);
  const versions = links.map((l) => ({ kind: 'published', free: true, url: l.url, pdf: /pdf/i.test(l.content_type || '') ? l.url : '', host: clean(b.journal?.publisher) || hostOf(l.url) }));
  if (doi) versions.push({ kind: 'published', free: true, url: `https://doi.org/${doi}`, host: clean(b.journal?.publisher) });
  if (!versions.length && r.id) versions.push({ kind: 'published', free: true, url: `https://doaj.org/article/${r.id}`, host: 'DOAJ' });
  return {
    source: 'doaj', rank,
    title: clean(b.title),
    authors: (b.author || []).map((a) => clean(a.name)).filter(Boolean),
    year: year(b.year),
    venue: clean(b.journal?.title),
    type: 'article', abstract: plainText(b.abstract), cited: 0,
    ids: { doi },
    versions,
  };
}

const doaj = {
  id: 'doaj', name: 'DOAJ', home: 'https://doaj.org', cors: 'yes', what: { en: 'articles in open access journals', de: 'Artikel aus Open-Access-Zeitschriften' },
  requests(q, _s, limit) {
    const query = q.kind === 'doi' ? `doi:"${q.value}"` : q.kind === 'text' ? words(q.value).join(' ') : '';
    return query ? [{ url: `https://doaj.org/api/search/articles/${enc(query)}?pageSize=${limit}`, as: 'json' }] : [];
  },
  versionRequests(work) {
    return work.title && !work.ids.doi ? [{ url: `https://doaj.org/api/search/articles/${enc(`bibjson.title:"${words(work.title, 16).join(' ')}"`)}?pageSize=5`, as: 'json' }] : [];
  },
  parse: (data) => (data?.results || []).map((r, i) => doajRecord(r, i)),
};

// ------------------------------------------------------------------ DOAB (open access books, DSpace REST)
function doabRecord(item, rank) {
  const md = Array.isArray(item.metadata) ? item.metadata : [];
  const all = (k) => md.filter((m) => m.key === k).map((m) => clean(m.value)).filter(Boolean);
  const first = (...ks) => { for (const k of ks) { const v = all(k)[0]; if (v) return v; } return ''; };
  const doi = normDoi(first('oapen.identifier.doi', 'dc.identifier.doi'));
  const handle = item.handle ? `https://directory.doabooks.org/handle/${item.handle}` : '';
  const versions = [];
  for (const b of item.bitstreams || []) {
    if (b.bundleName && b.bundleName !== 'ORIGINAL') continue;
    if (!/pdf|epub/i.test(`${b.mimeType} ${b.format} ${b.name}`) || !b.retrieveLink) continue;
    versions.push({ kind: 'published', free: true, url: handle || `https://directory.doabooks.org${b.retrieveLink}`, pdf: `https://directory.doabooks.org${b.retrieveLink}`, host: 'DOAB', license: first('dc.rights.uri', 'dc.rights') });
  }
  for (const u of [...all('oapen.identifier.downloadUrl'), ...all('dc.identifier.uri')]) {
    if (/^https?:/.test(u) && !/\/handle\//.test(u)) versions.push({ kind: 'published', free: true, url: u, pdf: /\.pdf($|\?)|\/bitstream\//i.test(u) ? u : '', host: hostOf(u) });
  }
  if (handle && !versions.length) versions.push({ kind: 'published', free: true, url: handle, host: 'DOAB' });
  if (doi) versions.push({ kind: 'published', free: true, url: `https://doi.org/${doi}`, host: first('publisher.name', 'dc.publisher') });
  return {
    source: 'doab', rank,
    title: first('dc.title') || clean(item.name),
    authors: [...all('dc.contributor.author'), ...all('dc.contributor.editor')].map(firstLast),
    year: year(first('dc.date.issued')),
    venue: first('publisher.name', 'dc.publisher', 'oapen.relation.isPublishedBy'),
    type: 'book', abstract: plainText(first('dc.description.abstract')), cited: 0,
    ids: { doi, isbn: [...all('oapen.identifier.isbn'), ...all('dc.identifier.isbn')].map((x) => x.replace(/[^\dX]/gi, '')) },
    versions,
  };
}

// "Doe, Jane" -> "Jane Doe"
const firstLast = (name) => { const m = String(name).match(/^([^,]+),\s*(.+)$/); return m ? `${m[2]} ${m[1]}` : name; };

const doab = {
  id: 'doab', name: 'DOAB', home: 'https://www.doabooks.org', cors: 'try', what: { en: 'open access books', de: 'Open-Access-Bücher' },
  requests(q, _s, limit) {
    const query = q.kind === 'isbn' || q.kind === 'doi' ? q.value : q.kind === 'text' ? words(q.value).join(' ') : '';
    return query ? [{ url: `https://directory.doabooks.org/rest/search?query=${enc(query)}&expand=metadata,bitstreams&limit=${limit}`, as: 'json' }] : [];
  },
  versionRequests: () => [],
  parse: (data) => (Array.isArray(data) ? data : data?.items || []).map((it, i) => doabRecord(it, i)),
};

export const SOURCES = [openalex, crossref, arxiv, s2, europepmc, doaj, doab];
export const sourceById = (id) => SOURCES.find((s) => s.id === id) || null;
