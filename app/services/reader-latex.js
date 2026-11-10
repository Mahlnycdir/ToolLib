// Reader (0.14.1): the LaTeX source of an arXiv paper -> Markdown for the reader.
// Formulas stay exact LaTeX (set later with KaTeX), the paper's own macros are expanded, equations, sections, figures
// and theorems are numbered as in the paper, \ref and \cite are resolved, the bibliography comes from the .bbl (or .bib).
// No DOM and no browser API here, so the same code runs in Node for the tests.
//
//   unpackSource(bytes, { gunzipSync, strFromU8 }) -> { kind: 'tex' | 'pdf' | 'none', files: Map(name -> text) }
//   latexToDoc(files) -> { title, abstract, markdown, references: [string], macros, main, stats }
//
// Not covered (shown plainly instead): pictures, TikZ, complicated tables, algorithms. Text stays readable, formulas are exact.

// ------------------------------------------------------------------ unpacking
const cstr = (u8, from, len) => {
  let end = from;
  while (end < from + len && u8[end] !== 0) end++;
  return new TextDecoder('utf-8').decode(u8.subarray(from, end));
};

// A tar archive (what arXiv sends for most papers): { name -> bytes }.
export function parseTar(u8) {
  const files = new Map();
  let at = 0;
  let longName = '';
  let pax = {};
  while (at + 512 <= u8.length) {
    if (u8.subarray(at, at + 512).every((b) => b === 0)) break;
    let name = cstr(u8, at, 100);
    const size = parseInt(cstr(u8, at + 124, 12).trim() || '0', 8) || 0;
    const type = String.fromCharCode(u8[at + 156] || 48);
    if (cstr(u8, at + 257, 5) === 'ustar') {
      const prefix = cstr(u8, at + 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }
    const data = u8.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = cstr(data, 0, data.length); continue; }
    if (type === 'x' || type === 'g') {
      const text = new TextDecoder().decode(data);
      for (const m of text.matchAll(/\d+ (\w+)=([^\n]*)\n/g)) pax[m[1]] = m[2];
      continue;
    }
    if (longName) { name = longName; longName = ''; }
    if (pax.path) { name = pax.path; }
    pax = {};
    if (type === '0' || type === '\0') files.set(name.replace(/^\.\//, ''), data);
  }
  return files;
}

const looksText = (u8) => {
  const n = Math.min(u8.length, 4000);
  for (let i = 0; i < n; i++) if (u8[i] === 0) return false;
  return true;
};
function decode(u8) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch { return new TextDecoder('windows-1252').decode(u8); }
}

export function unpackSource(bytes, { gunzipSync, strFromU8 } = {}) {
  let u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = gunzipSync(u8);   // arXiv: gzip around a tar archive or a single file
  if (u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46) return { kind: 'pdf', files: new Map() };   // %PDF: submitted as PDF only
  const files = new Map();
  if (u8.length > 512 && cstr(u8, 257, 5) === 'ustar') {
    for (const [name, data] of parseTar(u8)) {
      if (/\.(tex|bbl|bib|sty|cls|ltx)$/i.test(name) && looksText(data)) files.set(name, decode(data));
    }
  } else if (looksText(u8)) {
    files.set('main.tex', decode(u8));
  }
  void strFromU8;
  return { kind: [...files.keys()].some((k) => /\.tex$|\.ltx$/i.test(k)) ? 'tex' : 'none', files };
}

// ------------------------------------------------------------------ small TeX helpers
const isLetter = (c) => /[A-Za-z]/.test(c || '');

// Removes % comments (not \%), \begin{comment} and \iffalse … \fi.
export function stripComments(s) {
  let t = s.replace(/\\begin\{comment\}[\s\S]*?\\end\{comment\}/g, '').replace(/\\iffalse[\s\S]*?\\fi\b/g, '');
  t = t.split('\n').map((line) => {
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '\\') { i++; continue; }
      if (line[i] === '%') return line.slice(0, i);
    }
    return line;
  }).join('\n');
  return t;
}

// {…} starting at s[i] === '{': { text, end } with end after the closing brace, or null.
export function readGroup(s, i, open = '{', close = '}') {
  if (s[i] !== open) return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') { j++; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return { text: s.slice(i + 1, j), end: j + 1 }; }
  }
  return null;
}
const skipSpace = (s, i) => { while (i < s.length && /\s/.test(s[i])) i++; return i; };

// \begin{name} … \end{name} with the same name nested: index of the matching \end, or -1.
function findEnd(s, from, name) {
  const re = new RegExp(`\\\\(begin|end)\\{${name.replace(/[*]/g, '\\*')}\\}`, 'g');
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(s))) {
    if (m[1] === 'begin') depth++;
    else if (--depth === 0) return m.index;
  }
  return -1;
}

// Splits at a separator that stands outside braces and nested environments (for rows and cells).
export function splitTop(s, sep) {
  const parts = [];
  let depth = 0;
  let env = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      if (sep === '\\\\' && s[i + 1] === '\\' && depth === 0 && env === 0) {
        parts.push(s.slice(last, i));
        i += 2;
        const opt = s.slice(i).match(/^\*?\s*\[[^\]]*\]/);
        if (opt) i += opt[0].length;
        last = i;
        i--;
        continue;
      }
      const m = s.slice(i).match(/^\\(begin|end)\{/);
      if (m) { env += m[1] === 'begin' ? 1 : -1; }
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (sep !== '\\\\' && c === sep && depth === 0 && env === 0) { parts.push(s.slice(last, i)); last = i + 1; }
  }
  parts.push(s.slice(last));
  return parts;
}

// ------------------------------------------------------------------ the source: files, main file, \input
export function findMain(files) {
  const tex = [...files.keys()].filter((k) => /\.(tex|ltx)$/i.test(k));
  const docs = tex.filter((k) => /\\documentclass/.test(files.get(k)) && /\\begin\{document\}/.test(files.get(k)));
  const pool = docs.length ? docs : tex;
  const pref = pool.find((k) => /(^|\/)(main|paper|ms|article|manuscript)\.tex$/i.test(k));
  if (pref) return pref;
  return pool.sort((a, b) => files.get(b).length - files.get(a).length)[0] || null;
}

function resolveInput(files, base, name) {
  const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '';
  const cands = [name, `${name}.tex`, `${dir}${name}`, `${dir}${name}.tex`].map((x) => x.replace(/^\.\//, ''));
  for (const c of cands) if (files.has(c)) return c;
  const tail = name.split('/').pop();
  return [...files.keys()].find((k) => k === `${tail}.tex` || k.endsWith(`/${tail}.tex`) || k === tail) || null;
}

export function expandInputs(files, name, depth = 0, seen = new Set()) {
  let src = stripComments(files.get(name) || '');
  if (depth > 8 || seen.has(name)) return src;
  seen.add(name);
  src = src.replace(/\\(?:input|include|subfile)\s*\{([^}]+)\}|\\import\{([^}]*)\}\{([^}]+)\}/g, (all, a, dir, b) => {
    const target = resolveInput(files, name, (dir ? `${dir.replace(/\/?$/, '/')}${b}` : a).trim());
    return target ? `\n${expandInputs(files, target, depth + 1, seen)}\n` : '';
  });
  return src;
}

// ------------------------------------------------------------------ macros of the paper
const DEF_RE = /\\(newcommand|renewcommand|providecommand|DeclareRobustCommand|DeclareMathOperator|def|let|newtheorem|newcounter|numberwithin)\*?/g;

// Reads the macro definitions out of the source. Returns { macros, theorems, src (definitions taken out), within }.
export function collectMacros(src) {
  const macros = new Map();   // name -> { nargs, opt, body }
  const theorems = new Map(); // env -> { title, counter, within, star }
  let within = false;
  let out = '';
  let at = 0;
  DEF_RE.lastIndex = 0;
  let m;
  while ((m = DEF_RE.exec(src))) {
    if (m.index < at) continue;
    let i = m.index + m[0].length;
    const kind = m[1];
    const star = m[0].endsWith('*');
    i = skipSpace(src, i);
    let end = -1;
    if (kind === 'numberwithin') {
      const a = readGroup(src, i);
      const b = a && readGroup(src, skipSpace(src, a.end));
      if (a && b) { if (a.text === 'equation') within = true; end = b.end; }
    } else if (kind === 'newcounter') {
      const a = readGroup(src, i);
      if (a) end = a.end;
    } else if (kind === 'newtheorem') {
      const a = readGroup(src, i);
      if (a) {
        let j = skipSpace(src, a.end);
        let counter = '';
        const opt1 = readGroup(src, j, '[', ']');
        if (opt1) { counter = opt1.text; j = skipSpace(src, opt1.end); }
        const title = readGroup(src, j);
        if (title) {
          j = title.end;
          const opt2 = readGroup(src, j, '[', ']');
          if (opt2) j = opt2.end;
          theorems.set(a.text, { title: title.text, counter, within: opt2 ? opt2.text : '', star });
          end = j;
        }
      }
    } else if (kind === 'let') {
      const nm = src.slice(i).match(/^\\([A-Za-z]+)\s*=?\s*\\([A-Za-z]+)/);
      if (nm) { macros.set(nm[1], { nargs: 0, body: `\\${nm[2]}`, alias: true }); end = i + nm[0].length; }
    } else if (kind === 'def') {
      const nm = src.slice(i).match(/^\\([A-Za-z]+)((?:#\d)*)\s*/);
      if (nm) {
        const body = readGroup(src, i + nm[0].length);
        if (body) { macros.set(nm[1], { nargs: nm[2].length / 2, body: body.text }); end = body.end; }
      }
    } else if (kind === 'DeclareMathOperator') {
      let nm = readGroup(src, i);
      let name = nm ? nm.text.replace(/^\\/, '') : (src.slice(i).match(/^\\([A-Za-z]+)/) || [])[1];
      const j = nm ? skipSpace(src, nm.end) : skipSpace(src, i + (name ? name.length + 1 : 0));
      const body = readGroup(src, j);
      if (name && body) { macros.set(name, { nargs: 0, body: `\\operatorname${star ? '*' : ''}{${body.text}}` }); end = body.end; }
    } else {
      // newcommand / renewcommand / providecommand / DeclareRobustCommand
      let name = '';
      let j = i;
      const g = readGroup(src, j);
      if (g) { name = g.text.replace(/^\\/, '').trim(); j = skipSpace(src, g.end); } else {
        const nm = src.slice(j).match(/^\\([A-Za-z]+)/);
        if (nm) { name = nm[1]; j = skipSpace(src, j + nm[0].length); }
      }
      let nargs = 0;
      let opt = null;
      const na = readGroup(src, j, '[', ']');
      if (na) { nargs = parseInt(na.text, 10) || 0; j = skipSpace(src, na.end); const dflt = readGroup(src, j, '[', ']'); if (dflt) { opt = dflt.text; j = skipSpace(src, dflt.end); } }
      const body = readGroup(src, j);
      if (name && /^[A-Za-z]+$/.test(name) && body) { macros.set(name, { nargs, opt, body: body.text }); end = body.end; }
    }
    if (end > 0) { out += src.slice(at, m.index); at = end; DEF_RE.lastIndex = end; }
  }
  out += src.slice(at);
  // Definitions too hard for a plain substitution stay unexpanded.
  for (const [k, v] of macros) if (/\\(csname|expandafter|ifx|ifnum|ifthenelse|xspace|futurelet|ifdefined)\b/.test(v.body)) macros.delete(k);
  return { macros, theorems, within, src: out };
}

// Expands the macros (several rounds, since macros use macros). Arguments: {…} groups or a single token.
export function expandMacros(src, macros) {
  if (!macros.size) return src;
  const names = [...macros.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(/[^A-Za-z]/g, ''));
  const re = new RegExp(`\\\\(${names.join('|')})(?![A-Za-z])`, 'g');
  let text = src;
  for (let round = 0; round < 8; round++) {
    let changed = false;
    let out = '';
    let last = 0;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const mac = macros.get(m[1]);
      let i = m.index + m[0].length;
      const args = [];
      let ok = true;
      let optArg = mac.opt != null ? mac.opt : null;
      if (mac.nargs > 0 && mac.opt != null) {
        const j = skipSpace(text, i);
        const o = readGroup(text, j, '[', ']');
        if (o) { optArg = o.text; i = o.end; }
      }
      for (let k = 0; k < mac.nargs; k++) {
        if (k === 0 && mac.opt != null) { args.push(optArg); continue; }
        const j = skipSpace(text, i);
        const g = readGroup(text, j);
        if (g) { args.push(g.text); i = g.end; } else if (text[j] === '\\') {
          const nm = text.slice(j).match(/^\\([A-Za-z]+|.)/);
          args.push(nm[0]); i = j + nm[0].length;
        } else if (j < text.length) { args.push(text[j]); i = j + 1; } else { ok = false; break; }
      }
      if (!ok) continue;
      let body = mac.body.replace(/#(\d)/g, (_, d) => (args[Number(d) - 1] ?? ''));
      // a macro name followed by a letter must not run into it: \foo{} bar
      if (!mac.nargs && /^[A-Za-z]/.test(text.slice(i)) && /\\[A-Za-z]+$/.test(body)) body += ' ';
      out += text.slice(last, m.index) + body;
      last = i;
      re.lastIndex = i;
      changed = true;
    }
    out += text.slice(last);
    text = out;
    if (!changed) break;
  }
  return text;
}

// ------------------------------------------------------------------ bibliography
function cleanInline(s, ctx) {
  return convertText(s, ctx, { inline: true }).replace(/\s+/g, ' ').trim();
}

export function parseBbl(bbl, ctx) {
  const items = [];
  const body = bbl.replace(/\\begin\{thebibliography\}\{[^}]*\}/, '').replace(/\\end\{thebibliography\}/, '');
  const re = /\\bibitem\s*(?:\[((?:[^\[\]{}]|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*)\])?\s*\{([^}]*)\}/g;
  const hits = [...body.matchAll(re)];
  hits.forEach((m, k) => {
    const raw = body.slice(m.index + m[0].length, k + 1 < hits.length ? hits[k + 1].index : body.length);
    const text = cleanInline(raw.replace(/\\newblock/g, ' ').replace(/\\natexlab\{[^}]*\}/g, '').replace(/\\bibinfo\{[^}]*\}\{([^}]*)\}/g, '$1').replace(/\\BibitemOpen|\\BibitemShut\{[^}]*\}|\\bibfield\{[^}]*\}\{([^}]*)\}/g, '$1'), ctx);
    let label = m[1] ? m[1].replace(/[{}]/g, '') : '';
    if (/[()]/.test(label)) label = '';   // natbib author-year labels: use numbers
    items.push({ key: m[2].trim(), label, text });
  });
  return items;
}

function braced(s, i) {
  const g = readGroup(s, i);
  return g ? g : null;
}

export function parseBib(bib) {
  const entries = new Map();
  const re = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;
  let m;
  while ((m = re.exec(bib))) {
    const type = m[1].toLowerCase();
    if (type === 'comment' || type === 'string' || type === 'preamble') continue;
    const start = m.index + m[0].length;
    const fields = {};
    let i = start;
    let depth = 1;
    // read fields until the entry's closing brace
    const fre = /([A-Za-z]+)\s*=\s*/y;
    while (i < bib.length && depth > 0) {
      while (i < bib.length && /[\s,]/.test(bib[i])) i++;
      if (bib[i] === '}') break;
      fre.lastIndex = i;
      const f = fre.exec(bib);
      if (!f) { i++; continue; }
      i = fre.lastIndex;
      let value = '';
      if (bib[i] === '{') { const g = braced(bib, i); if (!g) break; value = g.text; i = g.end; } else if (bib[i] === '"') {
        let j = i + 1;
        let d = 0;
        while (j < bib.length && !(bib[j] === '"' && d === 0)) { if (bib[j] === '{') d++; else if (bib[j] === '}') d--; j++; }
        value = bib.slice(i + 1, j); i = j + 1;
      } else { const n = bib.slice(i).match(/^[^,}\n]+/); value = n ? n[0].trim() : ''; i += n ? n[0].length : 0; }
      fields[f[1].toLowerCase()] = value;
    }
    entries.set(m[2], { type, ...fields });
    re.lastIndex = Math.max(re.lastIndex, i);
  }
  return entries;
}

export function formatBib(e, ctx) {
  const plain = (s) => cleanInline(String(s || ''), ctx);
  let authors = String(e.author || e.editor || '').split(/\s+and\s+/).map((a) => a.trim()).filter(Boolean).map((a) => {
    if (a.includes(',')) { const [last, first] = a.split(',').map((x) => x.trim()); return `${first.split(/\s+/).filter(Boolean).map((p) => `${p[0]}.`).join(' ')} ${last}`.trim(); }
    return a;
  });
  if (authors.length > 6) authors = [...authors.slice(0, 6), 'et al.'];
  const where = [e.journal || e.booktitle || e.publisher || e.school || e.howpublished, e.volume, e.number && `(${e.number})`, e.pages && `p. ${String(e.pages).replace(/--/g, '–')}`].filter(Boolean).map(plain).join(' ');
  const id = e.doi ? `doi:${plain(e.doi)}` : e.eprint ? `arXiv:${plain(e.eprint)}` : e.url ? plain(e.url) : '';
  return [authors.map(plain).join(', '), e.title && `${plain(e.title)}.`, where, e.year && `(${plain(e.year)})`, id].filter(Boolean).join(' ').replace(/\s+\./g, '.').replace(/\.\./g, '.');
}

// ------------------------------------------------------------------ text pieces
const ACCENT = { "'": '\u0301', '`': '\u0300', '^': '\u0302', '"': '\u0308', '~': '\u0303', '=': '\u0304', '.': '\u0307', u: '\u0306', v: '\u030c', H: '\u030b', c: '\u0327', k: '\u0328', r: '\u030a', b: '\u0331', d: '\u0323' };
const LETTER_CMD = {
  ss: 'ß', o: 'ø', O: 'Ø', l: 'ł', L: 'Ł', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', i: 'ı', j: 'ȷ',
  ldots: '…', dots: '…', textellipsis: '…', cdots: '⋯', textendash: '–', textemdash: '—', copyright: '©', textregistered: '®',
  texttrademark: '™', S: '§', P: '¶', dag: '†', ddag: '‡', textdegree: '°', degree: '°', LaTeX: 'LaTeX', TeX: 'TeX', textbackslash: '\\',
  textbullet: '•', textasciitilde: '~', textasciicircum: '^', textless: '<', textgreater: '>', textpm: '±', texttimes: '×', textmu: 'µ',
  quad: ' ', qquad: '  ', enspace: ' ', thinspace: ' ', today: '', etal: 'et al.', ie: 'i.e.', eg: 'e.g.', cf: 'cf.', etc: 'etc.',
  euro: '€', pounds: '£', guillemotleft: '«', guillemotright: '»', glqq: '„', grqq: '“', flqq: '‹', frqq: '›',
};
const DROP_NOARG = new Set(['noindent', 'centering', 'raggedright', 'raggedleft', 'small', 'footnotesize', 'scriptsize', 'tiny', 'large', 'Large', 'LARGE', 'huge', 'Huge',
  'normalsize', 'normalfont', 'newpage', 'clearpage', 'cleardoublepage', 'pagebreak', 'nopagebreak', 'medskip', 'bigskip', 'smallskip', 'maketitle', 'tableofcontents',
  'listoffigures', 'listoftables', 'hline', 'toprule', 'midrule', 'bottomrule', 'xspace', 'protect', 'relax', 'indent', 'flushbottom', 'sloppy', 'fussy', 'newline',
  'linebreak', 'nolinebreak', 'hfill', 'vfill', 'hfil', 'fi', 'FloatBarrier', 'onecolumn', 'twocolumn', 'frenchspacing', 'nonumber', 'notag', 'bfseries', 'itshape', 'mdseries',
  'upshape', 'rmfamily', 'sffamily', 'ttfamily', 'selectfont', 'null', 'allowbreak', 'strut', 'ignorespaces', 'unskip', 'break', 'limits', 'nolimits', 'bf', 'it', 'rm', 'sf', 'tt', 'sc', 'em', 'sl', 'boldmath']);
const DROP_ARG = new Set(['vspace', 'hspace', 'vskip', 'hskip', 'setlength', 'addtolength', 'setcounter', 'addtocounter', 'pagestyle', 'thispagestyle', 'bibliographystyle', 'usepackage', 'documentclass',
  'includegraphics', 'rule', 'phantom', 'hphantom', 'vphantom', 'title', 'author', 'date', 'address', 'affiliation', 'email', 'thanks', 'institute', 'inst', 'keywords', 'ead', 'cortext',
  'tnoteref', 'tnotetext', 'fntext', 'fnref', 'pacs', 'preprint', 'affil', 'orcid', 'index', 'markboth', 'markright', 'newpage', 'setcounter', 'graphicspath', 'hypersetup', 'bibliographystylefile', 'footnotemark',
  'footnotetext', 'acknowledgments', 'acknowledgements', 'pdfbookmark', 'addcontentsline', 'renewcommand', 'newcommand', 'theoremstyle', 'AtBeginDocument', 'captionsetup', 'floatname', 'geometry', 'definecolor', 'colorlet',
  'lstset', 'sisetup', 'DeclareGraphicsExtensions', 'fancyhf', 'fancyhead', 'fancyfoot', 'lhead', 'chead', 'rhead', 'lfoot', 'cfoot', 'rfoot', 'allowdisplaybreaks', 'journal', 'collaboration', 'noaffiliation', 'altaffiliation']);
const SUPER = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻' };
const THEOREMS = {
  theorem: 'Theorem', thm: 'Theorem', lemma: 'Lemma', lem: 'Lemma', proposition: 'Proposition', prop: 'Proposition', corollary: 'Corollary', cor: 'Corollary',
  definition: 'Definition', defn: 'Definition', remark: 'Remark', rem: 'Remark', example: 'Example', claim: 'Claim', conjecture: 'Conjecture', assumption: 'Assumption',
  notation: 'Notation', problem: 'Problem', fact: 'Fact', observation: 'Observation', note: 'Note',
};
const TEXT_ENVS = new Set(['center', 'flushleft', 'flushright', 'minipage', 'small', 'footnotesize', 'scriptsize', 'large', 'document', 'titlepage', 'subequations', 'appendices', 'multicols',
  'spacing', 'singlespace', 'doublespace', 'onehalfspace', 'CJK', 'otherlanguage', 'sloppypar', 'raggedright', 'raggedleft', 'frontmatter', 'wrapfigure', 'wraptable', 'adjustwidth', 'tcolorbox', 'mdframed', 'framed']);
const MATH_ENVS = new Set(['equation', 'align', 'alignat', 'gather', 'multline', 'eqnarray', 'flalign', 'displaymath', 'math']);

const MARK_OPEN = '\uE100';
const MARK_CLOSE = '\uE101';
const CITE_OPEN = '\uE104';
const CITE_CLOSE = '\uE105';

// ------------------------------------------------------------------ math
// Cleans a formula for KaTeX; numbering and labels are handled by the caller.
export function cleanMath(tex, ctx) {
  let s = tex;
  s = s.replace(/\\label\{[^}]*\}/g, '').replace(/\\(?:nonumber|notag)\b/g, '');
  s = s.replace(/\\(eqref|ref|autoref|cref|Cref)\s*\{([^}]*)\}/g, (_, kind, key) => `\\text{${MARK_OPEN}${kind}\u0001${key.trim()}${MARK_CLOSE}}`);
  s = s.replace(/\\(?:mathbbm|mathds)\b/g, '\\mathbb').replace(/\\textsc\b/g, '\\text').replace(/\\mbox\b/g, '\\text').replace(/\\hbox\b/g, '\\text').replace(/\\ensuremath\s*\{([^{}]*)\}/g, '$1');
  s = s.replace(/\\(?:hspace|vspace)\*?\s*\{[^}]*\}/g, '').replace(/\\(?:intertext|shortintertext)\s*\{([^{}]*)\}/g, '\\\\ \\text{$1} \\\\');
  s = s.replace(/\\(?:big|Big|bigg|Bigg)(?:l|r|m)?\s*(?=\\?[.|])/g, (m) => m);   // kept: KaTeX knows \bigl etc.
  s = s.replace(/\\(?:left|right)\s*\\(?:slash)\b/g, '');
  s = s.replace(/\\ifmmode[\s\S]*?\\fi/g, '');
  s = s.replace(/\\(?:cr|crcr)\b/g, '\\\\').replace(/\\(?:nolimits)\b/g, '').replace(/\\(?:protect|relax)\b/g, '');
  s = s.replace(/\\[Ee]nd\s*\{/g, '\\end{');
  return s.replace(/[ \t]+\n/g, '\n').trim();
}

const label = (ctx, key, kind, num) => { if (key) ctx.labels.set(key.trim(), { kind, num }); };

// A numbered equation environment -> one display formula with \tag{n} in every numbered row.
function mathEnv(name, inner, ctx) {
  const star = name.endsWith('*');
  const base = name.replace('*', '');
  let body = inner;
  if (base === 'alignat') body = body.replace(/^\s*\{\d+\}/, '');
  if (base === 'eqnarray') body = body.split('\n').map((l) => l.replace(/&([^&]*)&/g, '&$1')).join('\n');
  const rowsRaw = base === 'equation' || base === 'displaymath' || base === 'math' ? [body] : splitTop(body, '\\\\');
  const rows = rowsRaw.filter((r, i) => r.trim() || i < rowsRaw.length - 1).filter((r) => r.trim());
  const numberRow = (row) => {
    const labels = [...row.matchAll(/\\label\{([^}]*)\}/g)].map((m) => m[1]);
    const explicit = /\\tag\b/.test(row);
    const skip = star || explicit || /\\(?:nonumber|notag)\b/.test(row) || base === 'displaymath' || base === 'math';
    let tag = '';
    if (!skip) {
      ctx.eq++;
      const num = ctx.eqWithin ? `${ctx.secLabel(1)}.${ctx.eq}` : String(ctx.eq);
      tag = `\\tag{${num}}`;
      ctx.last = { kind: 'eq', num };
      for (const k of labels) label(ctx, k, 'eq', num);
    } else if (labels.length) { for (const k of labels) label(ctx, k, 'eq', ctx.last?.num || '?'); }
    return { text: cleanMath(row, ctx), tag };
  };
  let tex;
  if (base === 'multline') {
    const r = numberRow(rows.join(' \\\\ '));
    tex = `\\begin{gathered}${r.text}\\end{gathered}${r.tag}`;
  } else if (base === 'equation') {
    const r = numberRow(body);
    tex = `${r.text} ${r.tag}`;
  } else if (base === 'displaymath' || base === 'math') {
    tex = cleanMath(body, ctx);
  } else {
    const env = base === 'eqnarray' || base === 'flalign' || base === 'alignat' ? 'align' : base;
    tex = `\\begin{${env}*}${rows.map((r) => { const x = numberRow(r); return `${x.text} ${x.tag}`.trim(); }).join(' \\\\ ')}\\end{${env}*}`;
  }
  return tex;
}

function displayMath(tex, ctx, numbered = false) {
  const clean = numbered ? tex : cleanMath(tex, ctx);
  if (!clean) return '';
  if (ctx.listDepth > 0) return `$\\displaystyle ${clean.replace(/\s*\n\s*/g, ' ').replace(/\$/g, '')}$`;
  return `\n\n$$\n${clean}\n$$\n\n`;
}
function inlineMath(tex, ctx) {
  const clean = cleanMath(tex, ctx).replace(/\s*\n\s*/g, ' ').replace(/\$/g, '');
  return clean ? `$${clean}$` : '';
}

// Items of a list, without those of lists inside it.
function splitItems(inner) {
  const items = [];
  let depth = 0;
  let last = -1;
  const re = /\\(begin|end)\{(?:itemize|enumerate|description|compactitem|compactenum|inparaenum|asparaenum)\}|\\item(?![A-Za-z])/g;
  let m;
  while ((m = re.exec(inner))) {
    if (m[1] === 'begin') depth++;
    else if (m[1] === 'end') depth--;
    else if (depth === 0) { if (last >= 0) items.push(inner.slice(last, m.index)); last = m.index + m[0].length; }
  }
  if (last >= 0) items.push(inner.slice(last));
  return items;
}

// ------------------------------------------------------------------ the converter
function sectionNumber(ctx, level) {
  if (ctx.appendix) {
    const letter = String.fromCharCode(64 + Math.max(1, ctx.sec[0]));
    return [letter, ...ctx.sec.slice(1, level)].join('.');
  }
  return ctx.sec.slice(0, level).join('.');
}

function applyAccent(kind, arg) {
  const base = arg === '\\i' ? 'i' : arg === '\\j' ? 'j' : arg;
  if (!base) return ACCENT[kind] ? ' ' + ACCENT[kind] : '';
  return (base[0] + (ACCENT[kind] || '') + base.slice(1)).normalize('NFC');
}

// text mode: LaTeX -> Markdown. opts.inline: no block output (headings, lists) – for titles, captions, bibliography entries.
export function convertText(src, ctx, opts = {}) {
  const out = [];
  let buf = '';
  const flush = () => {
    if (!buf) return;
    out.push(buf.replace(/---/g, '—').replace(/--/g, '–').replace(/``/g, '“').replace(/''/g, '”').replace(/(^|[\s(])`/g, '$1‘'));
    buf = '';
  };
  const push = (s) => { flush(); out.push(s); };
  const block = (s) => { if (!s) return; flush(); out.push(opts.inline ? ` ${s.replace(/\s+/g, ' ')} ` : `\n\n${s.trim()}\n\n`); };
  const n = src.length;
  let i = 0;

  const arg = () => { const j = skipSpace(src, i); const g = readGroup(src, j); if (g) { i = g.end; return g.text; } return ''; };
  const opt = () => { const j = skipSpace(src, i); const g = readGroup(src, j, '[', ']'); if (g) { i = g.end; return g.text; } return null; };
  const conv = (s, o = {}) => convertText(s, ctx, { ...opts, ...o });
  const inl = (s) => conv(s, { inline: true }).replace(/\s+/g, ' ').trim();

  while (i < n) {
    const c = src[i];
    if (c === '\\') {
      const next = src[i + 1];
      // environments
      if (src.startsWith('\\begin', i) && !isLetter(src[i + 6])) {
        const nameG = readGroup(src, i + 6);
        if (nameG) {
          const name = nameG.text.trim();
          const from = nameG.end;
          const endAt = findEnd(src, from, name);
          if (endAt >= 0) {
            const inner = src.slice(from, endAt);
            i = endAt + `\\end{${name}}`.length;
            env(name, inner);
            continue;
          }
        }
        i += 6;
        continue;
      }
      if (next === '[') {   // \[ … \]
        const end = src.indexOf('\\]', i + 2);
        if (end > 0) { push(displayMath(mathEnv('equation*', src.slice(i + 2, end), ctx), ctx, true)); i = end + 2; continue; }
      }
      if (next === '(') {
        const end = src.indexOf('\\)', i + 2);
        if (end > 0) { push(inlineMath(src.slice(i + 2, end), ctx)); i = end + 2; continue; }
      }
      i = command();
      continue;
    }
    if (c === '$') {
      if (src[i + 1] === '$') {
        const end = src.indexOf('$$', i + 2);
        if (end > 0) { push(displayMath(mathEnv('equation*', src.slice(i + 2, end), ctx), ctx, true)); i = end + 2; continue; }
      } else {
        let j = i + 1;
        while (j < n && !(src[j] === '$' && src[j - 1] !== '\\')) j++;
        if (j < n) { push(inlineMath(src.slice(i + 1, j), ctx)); i = j + 1; continue; }
      }
      buf += '＄'; i++; continue;
    }
    if (c === '{') {
      const g = readGroup(src, i);
      if (g) {
        const sw = g.text.match(/^\s*\\(bf|bfseries|it|itshape|em|sl|slshape|sc|scshape|tt|ttfamily|rm|sf)\b\s*/);
        if (sw) {
          const inner = conv(g.text.slice(sw[0].length), { inline: true }).trim();
          push(wrap(sw[1], inner));
        } else {
          flush();
          out.push(conv(g.text));
        }
        i = g.end;
        continue;
      }
    }
    if (c === '}') { i++; continue; }
    if (c === '~') { buf += '\u00a0'; i++; continue; }
    buf += c;
    i++;
  }
  flush();
  return out.join('');

  function wrap(style, inner) {
    if (!inner) return '';
    if (/^(bf|bfseries)$/.test(style)) return `**${inner}**`;
    if (/^(it|itshape|em|sl|slshape)$/.test(style)) return `*${inner}*`;
    if (/^(tt|ttfamily)$/.test(style)) return `\`${inner}\``;
    return inner;
  }

  // a command starting at src[i] === '\\'; returns the new position
  function command() {
    let j = i + 1;
    const first = src[j];
    if (!isLetter(first)) {
      i = j + 1;
      switch (first) {
        case '\\': { const o = src.slice(i).match(/^\*?\s*\[[^\]]*\]/); if (o) i += o[0].length; buf += opts.inline ? ' ' : ' \n'; return i; }
        case '&': buf += '&'; return i;
        case '%': buf += '%'; return i;
        case '#': buf += '#'; return i;
        case '_': buf += '_'; return i;
        case '{': buf += '{'; return i;
        case '}': buf += '}'; return i;
        case '$': buf += '＄'; return i;
        case ' ': case '\n': buf += ' '; return i;
        case ',': case ';': case ':': buf += '\u2009'; return i;
        case '!': case '/': case '-': case '@': return i;
        case '|': buf += '‖'; return i;
        case '"': case "'": case '`': case '^': case '~': case '=': case '.': {
          const jj = skipSpace(src, i);
          let a = '';
          if (src[jj] === '{') { const g = readGroup(src, jj); a = g ? g.text.trim() : ''; i = g ? g.end : jj; } else if (src[jj] === '\\' && /^\\[ij]\b/.test(src.slice(jj))) { a = src.slice(jj, jj + 2); i = jj + 2; } else if (isLetter(src[jj])) { a = src[jj]; i = jj + 1; }
          buf += applyAccent(first, a);
          return i;
        }
        default: return i;
      }
    }
    while (isLetter(src[j])) j++;
    const name = src.slice(i + 1, j);
    i = j;
    const star = src[i] === '*';
    if (star) i++;
    const spaceAfter = /\s/.test(src[i] || '');
    if (spaceAfter && !'ucvHkrbdt'.includes(name)) i = skipSpace(src, i);
    if (name in LETTER_CMD) { buf += LETTER_CMD[name]; if (name === 'i' || name === 'j' || spaceAfter) { /* eaten */ } return i; }
    if (name.length === 1 && ACCENT[name] && 'ucvHkrbd'.includes(name)) {
      const jj = skipSpace(src, i);
      let a = '';
      if (src[jj] === '{') { const g = readGroup(src, jj); a = g ? g.text.trim() : ''; i = g ? g.end : jj; } else if (isLetter(src[jj])) { a = src[jj]; i = jj + 1; }
      buf += applyAccent(name, a);
      return i;
    }
    if (DROP_NOARG.has(name)) return i;
    switch (name) {
      case 'section': case 'chapter': case 'part': heading(1, star); return i;
      case 'subsection': heading(2, star); return i;
      case 'subsubsection': heading(3, star); return i;
      case 'paragraph': case 'subparagraph': { opt(); const t = inl(arg()); block(`**${t}.**`); return i; }
      case 'appendix': ctx.appendix = true; ctx.sec = [0, 0, 0]; ctx.eq = ctx.eqWithin ? 0 : ctx.eq; return i;
      case 'label': { const k = arg(); if (ctx.last) label(ctx, k, ctx.last.kind, ctx.last.num); return i; }
      case 'emph': case 'textit': case 'textsl': case 'mathit': { const t = inl(arg()); push(t ? `*${t}*` : ''); return i; }
      case 'textbf': case 'mathbf': case 'bm': case 'boldsymbol': { const t = inl(arg()); push(t ? `**${t}**` : ''); return i; }
      case 'texttt': case 'mathtt': case 'code': case 'lstinline': { const t = inl(arg()); push(t ? `\`${t.replace(/`/g, "'")}\`` : ''); return i; }
      case 'verb': { const d = src[i]; const e = src.indexOf(d, i + 1); if (e > 0) { push(`\`${src.slice(i + 1, e)}\``); i = e + 1; } return i; }
      case 'textsc': case 'textrm': case 'textsf': case 'textup': case 'mbox': case 'hbox': case 'text': case 'underline': case 'uline': case 'textnormal': case 'mathrm': case 'mathsf':
      case 'textcolor': case 'color': case 'colorbox': case 'fbox': case 'framebox': case 'makebox': case 'parbox': case 'raisebox': case 'ensuremath': case 'xspace': case 'uppercase': case 'MakeUppercase': case 'MakeLowercase': {
        if (name === 'textcolor' || name === 'colorbox') arg(); else if (name === 'color') { arg(); return i; }
        if (name === 'parbox' || name === 'raisebox') { opt(); arg(); }
        const o = opt();
        void o;
        push(conv(arg(), { inline: true }));
        return i;
      }
      case 'textsuperscript': { const t = inl(arg()); push(/^[0-9+-]+$/.test(t) ? [...t].map((x) => SUPER[x] || x).join('') : `^(${t})`); return i; }
      case 'textsubscript': { const t = inl(arg()); push(`_(${t})`); return i; }
      case 'footnote': { opt(); const t = inl(arg()); push(t ? ` (note: ${t})` : ''); return i; }
      case 'url': { const u = arg().replace(/\s+/g, ''); push(u); return i; }
      case 'href': { const u = arg().replace(/\s+/g, ''); const t = inl(arg()); push(/^https?:/.test(u) && !/[()]/.test(u) ? `[${t || u}](${u})` : t); return i; }
      case 'doi': { const d = arg(); push(`doi:${d}`); return i; }
      case 'arxiv': { const d = arg(); push(`arXiv:${d}`); return i; }
      case 'cite': case 'citep': case 'citet': case 'citealp': case 'citealt': case 'citeauthor': case 'citeyear': case 'parencite': case 'textcite': case 'autocite': case 'footcite': case 'nocite': case 'citenum': {
        opt(); opt();
        const keys = arg().split(',').map((k) => k.trim()).filter(Boolean);
        if (name === 'nocite') { for (const k of keys) if (!ctx.citeOrder.includes(k)) ctx.citeOrder.push(k); return i; }
        for (const k of keys) if (!ctx.citeOrder.includes(k)) ctx.citeOrder.push(k);
        push(`${CITE_OPEN}${keys.join(',')}${CITE_CLOSE}`);
        return i;
      }
      case 'ref': case 'eqref': case 'autoref': case 'cref': case 'Cref': case 'pageref': case 'vref': case 'nameref': {
        const k = arg().trim();
        push(`${MARK_OPEN}${name}\u0001${k}${MARK_CLOSE}`);
        return i;
      }
      case 'item': return i;
      case 'caption': case 'captionof': { if (name === 'captionof') arg(); opt(); const t = inl(arg()); push(t); return i; }
      case 'bibliography': case 'printbibliography': arg(); push(`\n\n\uE102\n\n`); return i;
      case 'abstract': { ctx.abstract = ctx.abstract || arg(); return i; }
      case 'newline': return i;
      case 'ldots': return i;
      case 'hline': return i;
      case 'input': case 'include': arg(); return i;
      case 'begin': case 'end': arg(); return i;
      case 'par': block(''); buf += '\n\n'; return i;
      case 'textwidth': case 'linewidth': case 'columnwidth': return i;
      default:
        if (DROP_ARG.has(name)) { opt(); arg(); return i; }
        // unknown command: keep its argument, drop the command
        { const k = skipSpace(src, i); if (src[k] === '[') { const o = readGroup(src, k, '[', ']'); if (o && src[skipSpace(src, o.end)] === '{') i = o.end; } }
        return i;
    }
  }

  function heading(level, star = false) {
    opt();
    const title = inl(arg());
    let num = '';
    if (!star) {
      ctx.sec[level - 1]++;
      for (let k = level; k < 3; k++) ctx.sec[k] = 0;
      if (level === 1 && ctx.eqWithin) ctx.eq = 0;
      num = sectionNumber(ctx, level);
      ctx.last = { kind: 'sec', num };
    }
    ctx.headings.push({ level, num, title });
    if (level >= 3) block(`**${num ? `${num} ` : ''}${title}**`);
    else block(`${'#'.repeat(2 + level)} ${num ? `${num}${level === 1 ? '.' : ''} ` : ''}${title}`);
  }

  function env(name, inner) {
    const base = name.replace('*', '');
    if (name === 'abstract') { ctx.abstract = ctx.abstract || inner; return; }
    if (name === 'thebibliography') {
      if (!ctx.bibitems) ctx.bibitems = parseBbl(`\\begin{thebibliography}{99}${inner}\\end{thebibliography}`, ctx);
      push('\n\n\uE102\n\n');
      return;
    }
    if (MATH_ENVS.has(base)) { push(displayMath(mathEnv(name, inner, ctx), ctx, true)); return; }
    if (name === 'split' || name === 'aligned' || name === 'gathered' || name === 'cases') { push(displayMath(`\\begin{${name}}${inner}\\end{${name}}`, ctx)); return; }
    if (['itemize', 'enumerate', 'description', 'compactitem', 'compactenum', 'inparaenum', 'asparaenum'].includes(name)) { list(name, inner); return; }
    if (name === 'quote' || name === 'quotation' || name === 'verse') { block(conv(inner).trim().split('\n').map((l) => `> ${l}`).join('\n')); return; }
    if (['verbatim', 'Verbatim', 'lstlisting', 'minted', 'alltt'].includes(base)) { block(`\`\`\`\n${inner.replace(/^\s*\[[^\]]*\]\s*(\{[^}]*\})?\n?/, '').replace(/^\n+|\s+$/g, '')}\n\`\`\``); return; }
    if (['figure', 'figure*', 'subfigure', 'sidewaysfigure'].includes(name) || (base === 'figure')) { floatEnv('Fig.', 'fig', inner); return; }
    if (['table', 'table*', 'sidewaystable'].includes(name) || base === 'table') { floatEnv('Table', 'tab', inner, true); return; }
    if (['tabular', 'tabularx', 'longtable', 'tabulary', 'array'].includes(base)) { block(tabular(base, inner)); return; }
    if (name === 'proof') { const t = opt0(inner); block(`*${t.title || 'Proof'}.* ${conv(t.rest).trim()} ∎`); return; }
    const th = theoremInfo(base);
    if (th) { theorem(base, th, inner); return; }
    if (['tikzpicture', 'pgfpicture', 'picture', 'algorithm', 'algorithm2e', 'algorithmic', 'pspicture', 'axis'].includes(name)) { return; }
    if (TEXT_ENVS.has(name)) {
      let rest = inner;
      if (['minipage', 'wrapfigure', 'wraptable', 'multicols', 'adjustwidth', 'tcolorbox', 'mdframed'].includes(name)) { rest = rest.replace(/^\s*(\[[^\]]*\])?\s*(\{[^{}]*\})?\s*(\{[^{}]*\})?/, ''); }
      if (name === 'appendices') { ctx.appendix = true; ctx.sec = [0, 0, 0]; }
      push(conv(rest));
      return;
    }
    push(conv(inner));
  }

  function opt0(inner) {
    const m = inner.match(/^\s*\[([^\]]*)\]/);
    return m ? { title: inl(m[1]), rest: inner.slice(m[0].length) } : { title: '', rest: inner };
  }

  function theoremInfo(base) {
    const own = ctx.theorems.get(base) || ctx.theorems.get(`${base}*`);
    if (own) return { title: inl(own.title), counter: own.counter || base, within: own.within, star: own.star };
    if (THEOREMS[base]) return { title: THEOREMS[base], counter: base, within: '', star: false };
    return null;
  }
  function theorem(base, th, inner) {
    const o = opt0(inner);
    let num = '';
    if (!th.star) {
      const key = th.counter;
      ctx.thm[key] = (ctx.thm[key] || 0) + 1;
      num = th.within === 'section' ? `${ctx.sec[0]}.${ctx.thm[key]}` : String(ctx.thm[key]);
      ctx.last = { kind: 'thm', num, word: th.title };
    }
    const head = `**${th.title}${num ? ` ${num}` : ''}.**${o.title ? ` (${o.title})` : ''}`;
    const text = conv(o.rest).trim();
    block(`${head} ${text}`.split('\n').map((l) => `> ${l}`).join('\n'));
  }

  function list(name, inner) {
    ctx.listDepth++;
    const parts = splitItems(inner);
    const lines = [];
    let k = 0;
    for (const part of parts) {
      let text = part;
      let term = '';
      const o = text.match(/^\s*\[((?:[^\[\]{}]|\{[^{}]*\})*)\]/);
      if (o) { term = inl(o[1]); text = text.slice(o[0].length); }
      const rows = conv(text, { inline: false }).split('\n').map((r) => r.trim()).filter(Boolean);
      const isItem = (r) => /^([-*+]|\d+\.)\s/.test(r);
      const bullet = name === 'enumerate' || name === 'compactenum' || name === 'asparaenum' ? `${++k}.` : '-';
      lines.push(`${bullet} ${term ? `**${term}** ` : ''}${rows.filter((r) => !isItem(r)).join(' ').replace(/\s+/g, ' ')}`);
      for (const r of rows.filter(isItem)) lines.push(`  ${r}`);
    }
    ctx.listDepth--;
    block(lines.join('\n'));
  }

  function floatEnv(word, kind, inner, isTable = false) {
    const hasCaption = /\\caption/.test(inner);
    let num = '';
    if (hasCaption) {
      ctx[kind]++;
      num = String(ctx[kind]);
      ctx.last = { kind, num };
    }
    const cap = inner.match(/\\caption\s*(?:\[[^\]]*\])?\s*\{/);
    let caption = '';
    if (cap) { const g = readGroup(inner, cap.index + cap[0].length - 1); if (g) caption = inl(g.text); }
    const bodyNoCaption = cap ? inner.replace(/\\caption\s*(?:\[[^\]]*\])?\s*\{/, (m) => m.replace('caption', 'captionnone')) : inner;
    let tableMd = '';
    if (isTable) {
      const tab = bodyNoCaption.match(/\\begin\{(tabular\*?|tabularx|longtable|tabulary)\}/);
      if (tab) {
        const from = tab.index + tab[0].length;
        const end = findEnd(bodyNoCaption, from, tab[1]);
        if (end > 0) tableMd = tabular(tab[1].replace('*', ''), bodyNoCaption.slice(from, end));
      }
    }
    for (const m of inner.matchAll(/\\label\{([^}]*)\}/g)) if (num) label(ctx, m[1], kind, num);
    const subs = [...bodyNoCaption.matchAll(/\\begin\{subfigure\}/g)].length;
    const subCaptions = [];
    if (subs) {
      for (const m of bodyNoCaption.matchAll(/\\begin\{subfigure\}[\s\S]*?\\caption\s*(?:\[[^\]]*\])?\s*\{/g)) {
        const g = readGroup(bodyNoCaption, m.index + m[0].length - 1);
        if (g) subCaptions.push(inl(g.text));
      }
    }
    const lines = [];
    if (caption || num) lines.push(`> **${word} ${num}.**${caption ? ` ${caption}` : ''}`);
    if (subCaptions.length) lines.push(`> ${subCaptions.map((c, k) => `(${String.fromCharCode(97 + k)}) ${c}`).join(' · ')}`);
    if (tableMd) block(`${lines.join('\n')}\n\n${tableMd}`); else if (lines.length) block(lines.join('\n'));
    ctx.stats.figures += isTable ? 0 : 1;
  }

  function tabular(base, inner) {
    let body = inner;
    if (base === 'tabularx' || base === 'tabulary') body = body.replace(/^\s*\{[^{}]*\}/, '');
    body = body.replace(/^\s*(\[[^\]]*\])?\s*\{(?:[^{}]|\{[^{}]*\})*\}/, '');
    body = body.replace(/\\(?:hline|toprule|midrule|bottomrule|endhead|endfirsthead|endfoot|endlastfoot)\b/g, '').replace(/\\(?:cline|cmidrule)\s*(?:\([^)]*\))?\s*\{[^}]*\}/g, '').replace(/\\(?:noalign)\s*\{[^{}]*\}/g, '').replace(/\\(?:rowcolor|cellcolor)\s*(?:\[[^\]]*\])?\s*\{[^}]*\}/g, '');
    const rows = splitTop(body, '\\\\').map((r) => r.trim()).filter(Boolean);
    const table = rows.map((r) => {
      const cells = [];
      for (const cell of splitTop(r, '&')) {
        let text = cell.trim();
        let span = 1;
        const mc = text.match(/^\\multicolumn\s*\{(\d+)\}\s*\{[^{}]*\}\s*/);
        if (mc) { span = Number(mc[1]); const g = readGroup(text, mc[0].length); text = g ? g.text : text.slice(mc[0].length); }
        const mr = text.match(/^\\multirow\s*\{[^{}]*\}\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}\s*(?:\[[^\]]*\])?\s*/);
        if (mr) { const g = readGroup(text, mr[0].length); text = g ? g.text : text.slice(mr[0].length); }
        let md = inl(text).replace(/\$([^$]*)\$/g, (_, t) => `$${t.replace(/\\\|/g, '\\Vert ').replace(/\|/g, '\\vert ')}$`);
        md = md.replace(/\|/g, '∣');
        cells.push(md);
        for (let s = 1; s < span; s++) cells.push('');
      }
      return cells;
    });
    if (!table.length) return '';
    const width = Math.max(...table.map((r) => r.length));
    const row = (r) => `| ${Array.from({ length: width }, (_, k) => r[k] ?? '').join(' | ')} |`;
    return [row(table[0]), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...table.slice(1).map(row)].join('\n');
  }
}

// ------------------------------------------------------------------ the whole paper
function newCtx(theorems, within) {
  const ctx = {
    sec: [0, 0, 0], eq: 0, fig: 0, tab: 0, thm: {}, appendix: false, last: null, labels: new Map(), citeOrder: [], bibitems: null,
    theorems, eqWithin: within, listDepth: 0, headings: [], abstract: '', stats: { figures: 0 },
    secLabel(level) { return sectionNumber(ctx, level); },
  };
  return ctx;
}

// Spaces and blank lines in order, except inside code blocks and display formulas.
export function tidy(text) {
  const out = [];
  let fence = false;
  let math = false;
  for (const raw of text.split('\n')) {
    if (/^```/.test(raw.trim())) { fence = !fence; out.push(raw.trim()); continue; }
    if (fence) { out.push(raw); continue; }
    if (/^\$\$\s*$/.test(raw.trim())) { math = !math; out.push('$$'); continue; }
    if (math) { out.push(raw.trim()); continue; }
    const keepIndent = /^\s+([-*+]|\d+\.)\s/.test(raw);
    const line = raw.replace(/\u00a0/g, '\u00a0').replace(/[ \t]+$/g, '').replace(/([^\s])[ \t]{2,}/g, '$1 ');
    out.push(keepIndent ? `  ${line.trim()}` : line.replace(/^[ \t]+/, ''));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const WORD = { sec: 'Section', eq: 'Eq.', fig: 'Fig.', tab: 'Table', thm: 'Theorem' };

function resolveMarks(text, ctx, numbers) {
  const one = (kind, key) => {
    const l = ctx.labels.get(key);
    if (!l) return '?';
    const num = l.num;
    if (kind === 'eqref') return `(${num})`;
    if (kind === 'ref' || kind === 'pageref' || kind === 'nameref') return String(num);
    const word = l.kind === 'thm' ? (l.word || 'Theorem') : (WORD[l.kind] || '');
    return l.kind === 'eq' ? `${word} (${num})` : `${word} ${num}`;
  };
  return text
    .replace(new RegExp(`${MARK_OPEN}(\\w+)\\u0001([^${MARK_CLOSE}]*)${MARK_CLOSE}`, 'g'), (_, kind, keys) => keys.split(',').map((k) => one(kind, k.trim())).join(', '))
    .replace(new RegExp(`${CITE_OPEN}([^${CITE_CLOSE}]*)${CITE_CLOSE}`, 'g'), (_, keys) => `[${keys.split(',').map((k) => numbers(k.trim())).join(', ')}]`);
}

export function latexToDoc(files) {
  const main = findMain(files);
  if (!main) return null;
  let src = expandInputs(files, main);
  const { macros, theorems, within, src: noDefs } = collectMacros(src);
  src = expandMacros(noDefs, macros);
  const ctx = newCtx(theorems, within);

  // preamble: title; body: everything after \begin{document}
  const titleM = src.match(/\\title\s*(?:\[[^\]]*\])?\s*\{/);
  let title = '';
  if (titleM) { const g = readGroup(src, titleM.index + titleM[0].length - 1); if (g) title = convertText(g.text, ctx, { inline: true }).replace(/\s+/g, ' ').trim(); }
  const bodyStart = src.search(/\\begin\{document\}/);
  let body = bodyStart >= 0 ? src.slice(bodyStart + '\\begin{document}'.length) : src;
  body = body.replace(/\\end\{document\}[\s\S]*$/, '');
  if (macros.has('abstract')) body = body.replace(/\\abstract/, '\\abstract');

  // bibliography: .bbl first, then .bib
  const bbl = [...files.keys()].filter((k) => /\.bbl$/i.test(k));
  const bibs = [...files.keys()].filter((k) => /\.bib$/i.test(k));
  if (bbl.length) ctx.bibitems = parseBbl(files.get(bbl.find((k) => k.startsWith(main.replace(/\.tex$/i, ''))) || bbl[0]), ctx);

  let text = convertText(body, ctx);
  // numbers for citations
  let refs = [];
  const bibMap = new Map();
  for (const f of bibs) for (const [k, v] of parseBib(files.get(f))) bibMap.set(k, v);
  let numbers;
  if (ctx.bibitems && ctx.bibitems.length) {
    const index = new Map(ctx.bibitems.map((b, k) => [b.key, k + 1]));
    numbers = (key) => { const b = ctx.bibitems[(index.get(key) || 0) - 1]; return b ? (b.label || String(index.get(key))) : key; };
    refs = ctx.bibitems.map((b, k) => `[${b.label || k + 1}] ${b.text}`);
  } else if (bibMap.size) {
    const order = ctx.citeOrder.filter((k) => bibMap.has(k));
    const index = new Map(order.map((k, n) => [k, n + 1]));
    numbers = (key) => String(index.get(key) || key);
    refs = order.map((k, n) => `[${n + 1}] ${formatBib(bibMap.get(k), ctx)}`);
  } else {
    numbers = (key) => key;
  }
  text = resolveMarks(text, ctx, numbers).replace(/\uE102/g, '');
  const abstract = resolveMarks(convertText(ctx.abstract || '', ctx, { inline: false }), ctx, numbers).trim();
  title = resolveMarks(title, ctx, numbers);
  text = tidy(text);
  return {
    title, abstract, markdown: text, references: refs, macros: [...macros.keys()], main,
    stats: { equations: ctx.eq, sections: ctx.headings.length, figures: ctx.fig, tables: ctx.tab, citations: ctx.citeOrder.length, references: refs.length },
  };
}
