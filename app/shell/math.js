// Formulas set with KaTeX (0.12.0). KaTeX is loaded with the first formula on screen, from vendor/katex.
// It builds DOM nodes itself, so text from the knowledge never goes through innerHTML. trust allows exactly one
// thing: \htmlClass{choice-spot}{…}, the highlight of an open convention (0.13.0); \href, \url and the other
// \html… commands do nothing. A formula KaTeX cannot read keeps its LaTeX in red.
import { h } from '../services/ui.js';
import { loadPref } from '../services/prefs.js';

// The macros of ENTE's paper draft and master thesis (Preamble/commands.tex), plus the parts of the physics
// package that nodes use. Copying a formula gives the LaTeX as written, so it works in the paper unchanged.
export const MACROS = {
  // paper draft
  '\\gammach': '\\gamma^{\\mathrm{ch}}',
  '\\D': '\\mathcal{D}',
  '\\dx': '\\mathrm{d}^2x\\;',
  '\\dy': '\\mathrm{d}^2y\\;',
  '\\T': '\\mathrm{T}',
  // thesis: general mathematics
  '\\Re': '\\operatorname{Re}',
  '\\Im': '\\operatorname{Im}',
  '\\ii': '\\mathrm{i}',
  '\\R': '\\mathbb{R}',
  '\\C': '\\mathbb{C}',
  '\\Z': '\\mathbb{Z}',
  '\\id': '\\mathbb{1}',
  '\\intx': '\\int_x\\,',
  // thesis: fields, spinors, operators
  '\\Lag': '\\mathcal{L}',
  '\\Ham': '\\mathcal{H}',
  '\\Action': '\\mathcal{S}',
  '\\pathD': '\\mathcal{D}',
  '\\slashed': '\\not{#1}',
  '\\slap': '\\not{#1}',
  '\\pslash': '\\not{p}',
  '\\Dslash': '\\not{D}',
  '\\dslash': '\\not{\\partial}',
  '\\psibar': '\\overline{\\Psi}',
  '\\psib': '\\bar{\\psi}',
  // thesis: gamma matrices, chirality, metric
  '\\gamm': '\\gamma^{#1}',
  '\\gfive': '\\gamma^{5}',
  '\\PL': 'P_{\\mathrm{L}}',
  '\\PR': 'P_{\\mathrm{R}}',
  '\\metric': '\\eta_{\\mu\\nu}',
  '\\Feps': '\\varepsilon',
  // thesis: gauge sector
  '\\Dcov': '\\mathrm{D}',
  '\\Fmn': 'F_{\\mu\\nu}',
  '\\Fmnup': 'F^{\\mu\\nu}',
  '\\gaugeA': 'A_{\\mu}',
  '\\chargeSet': '\\mathcal{Q}',
  '\\chiralitySet': '\\mathcal{X}',
  '\\diag': '\\mathrm{diag}\\left({#1}\\right)',
  // thesis: 3-4-5-0 model
  '\\gch': '\\gamma^{\\mathrm{ch}}',
  '\\Pich': '\\Pi_{\\chi}',
  '\\Qch': 'Q_{\\chi}',
  '\\Lhalf': '\\Lambda_{1/2}',
  '\\sigmn': '\\sigma^{\\mu\\nu}',
  '\\epsmn': '\\epsilon^{\\mu\\nu}',
  '\\jcur': 'j',
  '\\sgn': '\\operatorname{sgn}',
  // physics package (without optional arguments)
  '\\dd': '\\mathrm{d}',
  '\\dv': '\\frac{\\mathrm{d}#1}{\\mathrm{d}#2}',
  '\\pdv': '\\frac{\\partial #1}{\\partial #2}',
  '\\fdv': '\\frac{\\delta #1}{\\delta #2}',
  '\\tr': '\\operatorname{tr}',
  '\\Tr': '\\operatorname{Tr}',
  '\\abs': '\\left\\lvert #1\\right\\rvert',
  '\\norm': '\\left\\lVert #1\\right\\rVert',
  '\\qty': '\\left(#1\\right)',
  '\\order': '\\mathcal{O}\\left(#1\\right)',
  '\\ket': '\\left\\lvert #1\\right\\rangle',
  '\\bra': '\\left\\langle #1\\right\\rvert',
  '\\braket': '\\left\\langle #1\\middle\\vert #2\\right\\rangle',
  '\\expval': '\\left\\langle #1\\right\\rangle',
  '\\comm': '\\left[#1,#2\\right]',
  '\\acomm': '\\left\\{#1,#2\\right\\}',
  '\\Res': '\\operatorname*{Res}',
};

let katex = null;
let loading = null;

function load() {
  if (!loading) {
    if (!document.querySelector('link[data-katex]')) {
      document.head.append(h('link', { rel: 'stylesheet', href: new URL('../../vendor/katex/katex.min.css', import.meta.url).href, 'data-katex': '' }));
    }
    loading = import('../../vendor/katex/katex.js').then((m) => { katex = m.default; return katex; });
    loading.catch((e) => { console.warn('KaTeX did not load', e); loading = null; });
  }
  return loading;
}

export const onlyChoiceSpots = (c) => c.command === '\\htmlClass' && /^choice-spot( open)?$/.test(String(c.class));

// Your own macros (0.17.0, Settings › Writing): { "\\name": "expansion with #1" }; they come after the ones above and
// may replace one of them. Only names of letters and expansions as text: KaTeX reads them like any formula.
export function ownMacros() {
  const own = loadPref('editor.macros', {}) || {};
  const out = {};
  for (const [k, v] of Object.entries(own)) if (/^\\[a-zA-Z]{1,40}$/.test(k) && typeof v === 'string' && v.length <= 500) out[k] = v;
  return out;
}
export const allMacros = () => ({ ...MACROS, ...ownMacros() });

function draw(el, tex, display) {
  try {
    katex.render(tex, el, {
      displayMode: display, throwOnError: false, trust: onlyChoiceSpots, strict: 'ignore', maxExpand: 1000,
      macros: allMacros(), output: 'htmlAndMathml',
    });
    el.classList.add('typeset');
  } catch (e) {
    el.textContent = tex;
    el.classList.add('tex-error');
  }
}

// Sets tex into el. Until KaTeX is there (first formula, a fraction of a second) the LaTeX shows as text.
export function typeset(el, tex, display = false) {
  if (katex) draw(el, tex, display);
  else {
    el.textContent = tex;
    load()?.then(() => draw(el, tex, display)).catch(() => {});
  }
  return el;
}

export const mathReady = () => (katex ? Promise.resolve(katex) : load());

// Why KaTeX cannot set a formula, or '' (the editor underlines it, 0.17.0). Needs KaTeX loaded (mathReady).
export function texError(tex, display = false) {
  if (!katex) return '';
  try {
    katex.renderToString(String(tex).replace(/[\uE000-\uE002]/g, ''), { displayMode: display, throwOnError: true, trust: onlyChoiceSpots, strict: 'ignore', maxExpand: 1000, macros: allMacros() });
    return '';
  } catch (e) {
    return String(e?.message || e).replace(/^KaTeX parse error:\s*/, '');
  }
}
