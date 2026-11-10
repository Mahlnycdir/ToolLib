// Open conventions (0.13.0). Where the paper does not fix a convention, a card leaves it open instead of guessing:
// its front matter lists the choices, and each spot in the text, a formula or the check that depends on one says
// what it becomes for every option:
//
//   choices:
//     - id: boson-current-sign
//       en: Sign of the bosonized current
//       de: Vorzeichen des bosonisierten Stroms
//       hint: φ → −φ flips it.            (optional, hint_de in German)
//       options: ["s = +1", "s = -1"]      (labels in LaTeX)
//
//   $$j^\mu \leftrightarrow \choice{boson-current-sign}{\frac{1}{\sqrt\pi}}{-\frac{1}{\sqrt\pi}}\epsilon^{\mu\nu}\partial_\nu\phi$$
//
// You pick and decide on the card. Toollib then writes the chosen text into every spot, removes the choice and
// records it in a convention card (nodes/conventions/<id>.md, decided: <label>). Cards with the same open
// convention take your decision too. Nothing here touches the page.

const asText = (v) => (v == null ? '' : String(v));

// The choices of a card, cleaned up: [{ id, en, de, hint, hint_de, options: [label, ...] }]
export function choicesOf(meta) {
  const list = Array.isArray(meta?.choices) ? meta.choices : [];
  return list
    .filter((c) => c && typeof c === 'object' && c.id && Array.isArray(c.options) && c.options.length >= 2)
    .map((c) => ({
      id: String(c.id), en: asText(c.en || c.de || c.id), de: asText(c.de || c.en || c.id),
      hint: asText(c.hint), hint_de: asText(c.hint_de), options: c.options.map(asText),
    }));
}

export const choiceTitle = (c, lang) => (lang === 'de' ? c.de : c.en) || c.id;
export const choiceHint = (c, lang) => (lang === 'de' && c.hint_de) || c.hint || c.hint_de || '';

// ------------------------------------------------------------------ spots
// One argument in braces starting at text[i] === '{', with nested braces: returns [content, index after it].
function group(text, i) {
  if (text[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const ch = text[j];
    if (ch === '\\') { j++; continue; }   // \{ and \} do not count
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return [text.slice(i + 1, j), j + 1];
  }
  return null;
}

// All spots \choice{id}{a}{b}…: [{ start, end, id, args }]. A spot takes as many arguments as follow it.
export function findSpots(text) {
  const out = [];
  const re = /\\choice\s*(?=\{)/g;
  let m;
  while ((m = re.exec(text))) {
    const idGroup = group(text, m.index + m[0].length);
    if (!idGroup) continue;
    const args = [];
    let at = idGroup[1];
    for (let g = group(text, at); g; g = group(text, at)) { args.push(g[0]); at = g[1]; }
    out.push({ start: m.index, end: at, id: idGroup[0].trim(), args });
    re.lastIndex = at;
  }
  return out;
}

// Where in a node body an index lies: 'fence' (code block), 'math' ($$ … $$ or $ … $), 'code' (`inline`) or 'text'.
function contextMap(text) {
  const ranges = [];
  let pos = 0;
  let fence = null;
  let display = false;
  for (const line of text.split('\n')) {
    const start = pos;
    const end = pos + line.length;
    const tr = line.trim();
    if (fence) {
      if (tr.startsWith(fence)) fence = null;
      else ranges.push([start, end, 'fence']);
    } else if (/^(```|~~~)/.test(tr)) {
      fence = tr.slice(0, 3);
    } else if (display) {
      ranges.push([start, end, 'math']);
      if (line.includes('$$')) display = false;
    } else if (/^\s*\$\$/.test(line)) {
      ranges.push([start, end, 'math']);
      if (!tr.slice(2).includes('$$')) display = true;
    } else {
      for (const m of line.matchAll(/`[^`]+`|\$[^$\n]+?\$/g)) ranges.push([start + m.index, start + m.index + m[0].length, m[0][0] === '`' ? 'code' : 'math']);
    }
    pos = end + 1;
  }
  return (i) => ranges.find(([a, b]) => i >= a && i < b)?.[2] || 'text';
}

// Replaces every spot. pick(id) gives the index of the chosen option or null (still open); mark(content, ctx,
// spot, index) returns what goes in. Spots of ids pick does not know (null) are marked as open.
export function resolveSpots(text, pick, mark) {
  const spots = findSpots(text);
  if (!spots.length) return text;
  const ctxAt = contextMap(text);
  let out = '';
  let last = 0;
  for (const s of spots) {
    const i = pick(s.id);
    const ok = i != null && i >= 0 && i < s.args.length;
    out += text.slice(last, s.start) + mark(ok ? s.args[i] : null, ctxAt(s.start), s, ok ? i : null);
    last = s.end;
  }
  return out + text.slice(last);
}

// Plain text: the chosen option; spots still open show all options ("a / b"), e.g. in leads and lists.
export const plainSpots = (text, pick = () => null) => resolveSpots(text, pick, (c, _ctx, s) => (c ?? s.args.join(' / ')));

// For the page: formulas get \htmlClass{choice-spot}{…} (KaTeX may use exactly this class, see math.js), text and
// code blocks get private-use marks that markdown.js turns into a highlight. An open spot shows a "?".
export const MARK_ON = '';
export const MARK_OPEN = '';
export const MARK_END = '';
export function markSpots(text, pick) {
  return resolveSpots(text, pick, (c, ctx) => {
    if (ctx === 'math') return c == null ? '\\htmlClass{choice-spot open}{?}' : `\\htmlClass{choice-spot}{${c}}`;
    if (ctx === 'code') return c ?? '?';
    return c == null ? `${MARK_OPEN}?${MARK_END}` : `${MARK_ON}${c}${MARK_END}`;
  });
}
export const stripMarks = (s) => String(s).replace(/[]/g, '');

// The LaTeX to copy: without the highlight.
export function unmarkTex(tex) {
  let out = '';
  let rest = String(tex);
  for (;;) {
    const at = rest.search(/\\htmlClass\{choice-spot( open)?\}\{/);
    if (at < 0) return out + rest;
    const head = rest.slice(at).match(/^\\htmlClass\{choice-spot( open)?\}/)[0];
    const g = group(rest, at + head.length);
    if (!g) return out + rest;
    out += rest.slice(0, at) + g[0];
    rest = rest.slice(g[1]);
  }
}

// ------------------------------------------------------------------ deciding
const FM = /^(﻿?---\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/;
const q = (v) => JSON.stringify(String(v));

// The choices field in the same style as the cards are written (block list, one key per line).
function choicesYaml(list, nl) {
  const lines = ['choices:'];
  for (const c of list) {
    lines.push(`  - id: ${q(c.id)}`, `    en: ${q(c.en)}`, `    de: ${q(c.de)}`);
    if (c.hint) lines.push(`    hint: ${q(c.hint)}`);
    if (c.hint_de) lines.push(`    hint_de: ${q(c.hint_de)}`);
    lines.push(`    options: [${c.options.map(q).join(', ')}]`);
  }
  return lines.join(nl);
}

// Writes decisions { id: index } into a card file: each spot of these ids becomes the chosen text, the choices
// leave the front matter, and the ids join the card's conventions. Other lines stay exactly as they were.
// meta: the parsed front matter of text.
export function applyDecision(text, meta, decisions) {
  const ids = Object.keys(decisions);
  const all = choicesOf(meta);
  const mine = all.filter((c) => ids.includes(c.id));
  if (!mine.length) return text;
  const m = text.match(FM);
  if (!m) return text;
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const body = text.slice(m[0].length);
  const nextBody = resolveSpots(body, (id) => (ids.includes(id) ? decisions[id] : null), (c, _ctx, s) => (c ?? body.slice(s.start, s.end)));

  // front matter, line by line
  const head = m[2].split(/\r?\n/);
  const isKey = (k) => (l) => l.startsWith(`${k}:`) && /^\s|^$/.test(l.slice(k.length + 1));
  const blockEnd = (i) => { let e = i + 1; while (e < head.length && /^(\s+\S|-\s)/.test(head[e])) e++; return e; };
  const rest = all.filter((c) => !ids.includes(c.id));
  const ci = head.findIndex(isKey('choices'));
  if (ci >= 0) head.splice(ci, blockEnd(ci) - ci, ...(rest.length ? [choicesYaml(rest, nl)] : []));
  const conv = Array.isArray(meta.conventions) ? meta.conventions.map(String) : meta.conventions ? [String(meta.conventions)] : [];
  const nextConv = [...conv, ...mine.map((c) => c.id).filter((id) => !conv.includes(id))];
  const convLine = `conventions: [${nextConv.map(q).join(', ')}]`;
  const vi = head.findIndex(isKey('conventions'));
  if (vi >= 0) head.splice(vi, blockEnd(vi) - vi, convLine);
  else {
    let at = -1;
    for (const k of ['derived_from', 'tags', 'problems_de', 'problems', 'topic']) { at = head.findIndex(isKey(k)); if (at >= 0) break; }
    head.splice(at >= 0 ? blockEnd(at) : head.length, 0, convLine);
  }
  return m[1] + head.join(nl) + m[3] + nextBody;
}

// A label like "c = 1/\sqrt2" as plain text, for dialogs and commit messages.
const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', mu: 'μ', nu: 'ν', pi: 'π', phi: 'φ', varphi: 'φ', psi: 'ψ', chi: 'χ', vartheta: 'ϑ', theta: 'θ', eta: 'η', sigma: 'σ', partial: '∂', pm: '±', mp: '∓', cdot: '·', leftrightarrow: '↔', to: '→' };
const SPACING = new Set(['quad', 'qquad', 'left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'displaystyle', 'textstyle', 'mathrm', 'text', 'operatorname']);
export function texToText(tex) {
  return String(tex)
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√$1').replace(/\\sqrt\s*(\w)/g, '√$1')
    .replace(/\\t?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2')
    .replace(/\\bar\s*\\psi/g, 'ψ̄').replace(/\\mathrm\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\([a-zA-Z]+)/g, (_, n) => GREEK[n] ?? (SPACING.has(n) ? ' ' : n))
    .replace(/[{}]/g, '').replace(/\\[,;!: ]/g, ' ').replace(/(^|[^\w])-/g, '$1−')
    .replace(/\s+/g, ' ').trim();
}
