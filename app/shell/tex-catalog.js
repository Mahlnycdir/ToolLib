// LaTeX for the editor (0.17.0): what the completion offers after "\" and what the formula palette shows, with
// German and English words to find a command by what it does ("Bruch", "arrow with text"). Every entry is set by KaTeX
// (checked with the macros of math.js). One line per command: command | template | words. The template uses #1, #2 …
// for the places you fill in, #0 for where the cursor ends; without a template the command stands alone.
// The rarer commands carry a short hint in their words (the palette shows them), so they are found and understood.
import { MACROS } from './math.js';

const GROUPS = {
  greek: `
\\alpha||alpha
\\beta||beta
\\gamma||gamma
\\delta||delta
\\epsilon||epsilon
\\varepsilon||epsilon varepsilon rund
\\zeta||zeta
\\eta||eta
\\theta||theta
\\vartheta||theta vartheta
\\iota||iota
\\kappa||kappa
\\lambda||lambda
\\mu||mu
\\nu||nu
\\xi||xi
\\pi||pi
\\varpi||pi varpi
\\rho||rho
\\varrho||rho varrho
\\sigma||sigma
\\varsigma||sigma final
\\tau||tau
\\upsilon||upsilon
\\phi||phi
\\varphi||phi varphi
\\chi||chi
\\psi||psi
\\omega||omega
\\Gamma||Gamma groß capital
\\Delta||Delta groß capital Laplace
\\Theta||Theta groß capital
\\Lambda||Lambda groß capital
\\Xi||Xi groß capital
\\Pi||Pi groß capital
\\Sigma||Sigma groß capital
\\Upsilon||Upsilon groß capital
\\Phi||Phi groß capital
\\Psi||Psi groß capital
\\Omega||Omega groß capital`,
  structure: `
\\frac|\\frac{#1}{#2}#0|Bruch fraction
\\dfrac|\\dfrac{#1}{#2}#0|Bruch groß display fraction
\\tfrac|\\tfrac{#1}{#2}#0|Bruch klein text fraction
\\sqrt|\\sqrt{#1}#0|Wurzel square root
\\sqrt[n]|\\sqrt[#1]{#2}#0|n-te Wurzel nth root
\\binom|\\binom{#1}{#2}#0|Binomialkoeffizient binomial choose
^{}|^{#1}#0|hoch Exponent superscript power
_{}|_{#1}#0|Index tief subscript
\\overline|\\overline{#1}#0|Strich darüber overline conjugate
\\underline|\\underline{#1}#0|unterstrichen underline
\\hat|\\hat{#1}#0|Hut Operator hat
\\widehat|\\widehat{#1}#0|breiter Hut wide hat Fourier
\\tilde|\\tilde{#1}#0|Tilde
\\widetilde|\\widetilde{#1}#0|breite Tilde wide tilde
\\bar|\\bar{#1}#0|Strich bar mean
\\vec|\\vec{#1}#0|Vektorpfeil vector arrow
\\dot|\\dot{#1}#0|Punkt Zeitableitung dot time derivative
\\ddot|\\ddot{#1}#0|zwei Punkte zweite Ableitung double dot
\\dddot|\\dddot{#1}#0|drei Punkte dritte Ableitung triple dot
\\mathring|\\mathring{#1}#0|Kringel ring Angström
\\check|\\check{#1}#0|Haken check hacek
\\breve|\\breve{#1}#0|Bogen breve
\\overbrace|\\overbrace{#1}^{#2}#0|Klammer oben mit Text brace above label
\\underbrace|\\underbrace{#1}_{#2}#0|Klammer unten mit Text brace below label
\\overset|\\overset{#1}{#2}#0|Zeichen über einem anderen, etwa !über = stack symbol above
\\underset|\\underset{#1}{#2}#0|Zeichen unter einem anderen stack symbol below
\\stackrel|\\stackrel{#1}{#2}#0|gestapelt, etwa def über = stack relation definition
\\overrightarrow|\\overrightarrow{#1}#0|langer Pfeil darüber arrow above
\\overleftarrow|\\overleftarrow{#1}#0|Pfeil nach links darüber arrow above left
\\overleftrightarrow|\\overleftrightarrow{#1}#0|Doppelpfeil darüber both arrow above
\\boxed|\\boxed{#1}#0|Rahmen Ergebnis box result
\\cancel|\\cancel{#1}#0|durchstreichen kürzen cancel strike
\\bcancel|\\bcancel{#1}#0|durchstreichen andersrum cancel back
\\xcancel|\\xcancel{#1}#0|kreuzweise durchstreichen cross out
\\phantom|\\phantom{#1}#0|unsichtbarer Platzhalter zum Ausrichten invisible spacer align
\\vphantom|\\vphantom{#1}#0|unsichtbare Höhe vertical phantom
\\hphantom|\\hphantom{#1}#0|unsichtbare Breite horizontal phantom
\\smash|\\smash{#1}#0|Höhe ignorieren smash height
\\mathclap|\\mathclap{#1}#0|ohne Breite zentriert, für breite Grenzen unter Summen zero width
\\mathrlap|\\mathrlap{#1}#0|ohne Breite nach rechts overlap right
\\mathllap|\\mathllap{#1}#0|ohne Breite nach links overlap left
\\substack|\\substack{#1 \\\\ #2}#0|mehrzeilige Grenzen unter einer Summe multiline limits
\\genfrac|\\genfrac{(}{)}{0pt}{}{#1}{#2}#0|Bruch mit eigenen Klammern generalized fraction
\\tag|\\tag{#1}#0|Gleichungsnummer tag equation number
\\operatorname|\\operatorname{#1}#0|eigener Operatorname operator name
\\operatorname*|\\operatorname*{#1}_{#2}#0|Operator mit Grenzen darunter, etwa argmax operator limits
\\color|{\\color{#1}#2}#0|Farbe colour color
\\textcolor|\\textcolor{#1}{#2}#0|farbiger Text colour text
\\colorbox|\\colorbox{#1}{$#2$}#0|farbiger Kasten colour box highlight
\\pmod|\\pmod{#1}#0|modulo in Klammern
\\bmod||modulo binär
\\pod|\\pod{#1}#0|Klammer ohne mod`,
  big: `
\\sum|\\sum_{#1}^{#2}#0|Summe sum
\\prod|\\prod_{#1}^{#2}#0|Produkt product
\\coprod|\\coprod_{#1}#0|Koprodukt coproduct
\\int|\\int_{#1}^{#2}#0|Integral
\\iint|\\iint_{#1}#0|Doppelintegral double integral
\\iiint|\\iiint_{#1}#0|Dreifachintegral triple integral
\\oint|\\oint_{#1}#0|Kurvenintegral geschlossen contour integral
\\oiint|\\oiint_{#1}#0|geschlossenes Flächenintegral surface integral
\\lim|\\lim_{#1 \\to #2}#0|Grenzwert limit
\\limsup|\\limsup_{#1}#0|Limes superior
\\liminf|\\liminf_{#1}#0|Limes inferior
\\sup|\\sup_{#1}#0|Supremum
\\inf|\\inf_{#1}#0|Infimum
\\max|\\max_{#1}#0|Maximum
\\min|\\min_{#1}#0|Minimum
\\bigcup|\\bigcup_{#1}#0|große Vereinigung union
\\bigcap|\\bigcap_{#1}#0|großer Schnitt intersection
\\bigoplus|\\bigoplus_{#1}#0|direkte Summe direct sum
\\bigotimes|\\bigotimes_{#1}#0|Tensorprodukt groß tensor product
\\det||Determinante determinant
\\exp||Exponentialfunktion exponential
\\log||Logarithmus logarithm
\\ln||natürlicher Logarithmus natural log
\\sin||Sinus sine
\\cos||Kosinus cosine
\\tan||Tangens tangent
\\arcsin||Arkussinus arcsine
\\arccos||Arkuskosinus arccosine
\\arctan||Arkustangens arctangent
\\sinh||Sinus hyperbolicus
\\cosh||Kosinus hyperbolicus
\\tanh||Tangens hyperbolicus
\\ker||Kern kernel
\\dim||Dimension
\\deg||Grad degree
\\gcd||größter gemeinsamer Teiler gcd
\\Pr||Wahrscheinlichkeit probability`,
  rel: `
\\leq||kleiner gleich less equal
\\geq||größer gleich greater equal
\\neq||ungleich not equal
\\approx||ungefähr approximately
\\simeq||asymptotisch gleich similar equal
\\cong||kongruent isomorph congruent
\\equiv||identisch äquivalent equivalent identical
\\sim||ähnlich verteilt similar distributed
\\propto||proportional
\\ll||viel kleiner much less
\\gg||viel größer much greater
\\lesssim||kleiner ungefähr less similar
\\gtrsim||größer ungefähr greater similar
\\coloneqq||definiert als := defined as
\\eqqcolon||=: definiert
\\doteq||Punkt gleich doteq
\\triangleq||gleich per Definition triangle
\\asymp||asymptotisch
\\in||Element von element of
\\notin||kein Element not element
\\ni||enthält contains
\\subset||Teilmenge subset
\\subseteq||Teilmenge gleich subset equal
\\supset||Obermenge superset
\\supseteq||Obermenge gleich superset equal
\\perp||senkrecht perpendicular
\\parallel||parallel
\\mid||teilt divides bedingt given
\\nmid||teilt nicht does not divide
\\prec||vorangehend precedes
\\succ||nachfolgend succeeds
\\vdash||folgt herleitbar proves
\\models||erfüllt models`,
  arrows: `
\\to||Pfeil gegen to arrow
\\rightarrow||Pfeil rechts right arrow
\\leftarrow||Pfeil links left arrow
\\leftrightarrow||Pfeil beide both arrow
\\Rightarrow||Doppelpfeil rechts double arrow
\\Leftarrow||Doppelpfeil links double arrow left
\\Leftrightarrow||Doppelpfeil beide equivalent
\\implies||folgt implies
\\impliedby||folgt aus implied by
\\iff||genau dann wenn if and only if
\\mapsto||bildet ab maps to
\\longmapsto||bildet ab lang long maps to
\\longrightarrow||langer Pfeil long arrow
\\hookrightarrow||Einbettung hook embedding
\\rightharpoonup||Harpune schwache Konvergenz harpoon weak convergence
\\rightleftharpoons||Gleichgewicht Reaktion equilibrium
\\uparrow||Pfeil hoch up arrow spin
\\downarrow||Pfeil runter down arrow spin
\\nearrow||Pfeil schräg hoch north east
\\searrow||Pfeil schräg runter south east
\\circlearrowleft||Kreispfeil circle arrow
\\xrightarrow|\\xrightarrow{#1}#0|Pfeil mit Text darüber arrow with label
\\xleftarrow|\\xleftarrow{#1}#0|Pfeil links mit Text arrow left label
\\xleftrightarrow|\\xleftrightarrow{#1}#0|Doppelpfeil mit Text arrow both label
\\xRightarrow|\\xRightarrow{#1}#0|Folgepfeil mit Text implies label
\\xmapsto|\\xmapsto{#1}#0|bildet ab mit Text maps to label`,
  ops: `
\\pm||plus minus
\\mp||minus plus
\\times||mal Kreuz times cross
\\cdot||mal Punkt dot product
\\div||geteilt divide
\\ast||Stern asterisk convolution
\\star||Stern star
\\circ||Verkettung compose circle
\\bullet||Punkt dick bullet
\\oplus||direkte Summe xor
\\ominus||minus im Kreis
\\otimes||Tensorprodukt tensor
\\odot||Punkt im Kreis Hadamard
\\wedge||Dach äußeres Produkt wedge
\\vee||oder vee
\\cap||Schnitt intersection
\\cup||Vereinigung union
\\setminus||ohne set minus
\\dagger||adjungiert dagger
\\ddagger||Doppelkreuz double dagger
\\sqcup||disjunkte Vereinigung disjoint
\\wr||Kranzprodukt wreath`,
  symbols: `
\\infty||unendlich infinity
\\partial||partiell partial
\\nabla||Nabla Gradient
\\hbar||h quer hbar Planck
\\ell||l geschwungen ell
\\aleph||Aleph
\\emptyset||leere Menge empty set
\\varnothing||leere Menge rund empty
\\forall||für alle for all
\\exists||es gibt exists
\\nexists||es gibt nicht does not exist
\\neg||nicht not
\\top||wahr top
\\bot||falsch bottom
\\angle||Winkel angle
\\triangle||Dreieck triangle
\\square||Quadrat d'Alembert square box
\\Box||Kasten d'Alembert box
\\blacksquare||Ende Beweis qed
\\prime||Strich prime
\\backslash||Backslash
\\dots||Punkte dots
\\cdots||Punkte mittig center dots
\\vdots||Punkte senkrecht vertical dots
\\ddots||Punkte schräg diagonal dots
\\therefore||also therefore
\\because||weil because
\\checkmark||Haken check
\\imath||i ohne Punkt dotless
\\jmath||j ohne Punkt dotless
\\wp||Weierstraß p
\\complement||Komplement
\\flat||b flat
\\sharp||Kreuz sharp
\\diamond||Raute diamond`,
  fonts: `
\\mathbb|\\mathbb{#1}#0|Zahlenmenge Doppelstrich blackboard R C Z
\\mathcal|\\mathcal{#1}#0|Schreibschrift calligraphic L H O
\\mathfrak|\\mathfrak{#1}#0|Fraktur Lie-Algebra fraktur
\\mathscr|\\mathscr{#1}#0|Skript script
\\mathrm|\\mathrm{#1}#0|aufrecht roman upright d e i
\\mathbf|\\mathbf{#1}#0|fett bold
\\boldsymbol|\\boldsymbol{#1}#0|fett Symbol bold symbol griechisch
\\mathit|\\mathit{#1}#0|kursiv italic
\\mathsf|\\mathsf{#1}#0|serifenlos sans
\\mathtt|\\mathtt{#1}#0|Schreibmaschine monospace
\\text|\\text{#1}#0|Text in Formel text
\\textbf|\\textbf{#1}#0|fetter Text bold text
\\textit|\\textit{#1}#0|kursiver Text italic text`,
  delims: `
\\left(|\\left( #1 \\right)#0|Klammern wachsen mit parentheses grow
\\left[|\\left[ #1 \\right]#0|eckige Klammern square brackets
\\left\\{|\\left\\{ #1 \\right\\}#0|geschweifte Klammern braces set
\\left||\\left| #1 \\right|#0|Betrag abs value bars
\\langle|\\left\\langle #1 \\right\\rangle#0|spitze Klammern Erwartungswert angle brackets
\\lvert|\\lvert #1 \\rvert#0|Betrag vertical bars
\\lVert|\\lVert #1 \\rVert#0|Norm double bars
\\lfloor|\\lfloor #1 \\rfloor#0|abrunden floor
\\lceil|\\lceil #1 \\rceil#0|aufrunden ceil
\\bigl(|\\bigl( #1 \\bigr)#0|feste große Klammern big parentheses
\\Bigl(|\\Bigl( #1 \\Bigr)#0|noch größere Klammern Big
\\biggl(|\\biggl( #1 \\biggr)#0|sehr große Klammern bigg
\\middle|\\left( #1 \\middle| #2 \\right)#0|Strich in der Mitte, wächst mit middle bar conditional`,
  env: `
pmatrix|\\begin{pmatrix} #1 & #2 \\\\ #3 & #4 \\end{pmatrix}#0|Matrix runde Klammern matrix parentheses
bmatrix|\\begin{bmatrix} #1 & #2 \\\\ #3 & #4 \\end{bmatrix}#0|Matrix eckige Klammern brackets
vmatrix|\\begin{vmatrix} #1 & #2 \\\\ #3 & #4 \\end{vmatrix}#0|Determinante Matrix Striche determinant
Vmatrix|\\begin{Vmatrix} #1 & #2 \\\\ #3 & #4 \\end{Vmatrix}#0|Matrix Doppelstriche norm
Bmatrix|\\begin{Bmatrix} #1 & #2 \\\\ #3 & #4 \\end{Bmatrix}#0|Matrix geschweift braces
matrix3|\\begin{pmatrix} #1 & #2 & #3 \\\\ #4 & #5 & #6 \\\\ #7 & #8 & #9 \\end{pmatrix}#0|Matrix drei mal drei 3x3
matrixn|\\begin{pmatrix} a_{11} & \\cdots & a_{1n} \\\\ \\vdots & \\ddots & \\vdots \\\\ a_{m1} & \\cdots & a_{mn} \\end{pmatrix}|allgemeine Matrix mit Punkten general matrix dots
smallmatrix|\\left(\\begin{smallmatrix} #1 & #2 \\\\ #3 & #4 \\end{smallmatrix}\\right)#0|kleine Matrix im Text small inline matrix
cases|\\begin{cases} #1 & \\text{#2} \\\\ #3 & \\text{#4} \\end{cases}#0|Fallunterscheidung cases piecewise
dcases|\\begin{dcases} #1 & #2 \\\\ #3 & #4 \\end{dcases}#0|Fälle groß display cases
aligned|\\begin{aligned} #1 &= #2 \\\\ &= #3 \\end{aligned}#0|ausgerichtet Umformung align steps
gathered|\\begin{gathered} #1 \\\\ #2 \\end{gathered}#0|zentriert untereinander gather
array|\\left(\\begin{array}{c|c} #1 & #2 \\\\ \\hline #3 & #4 \\end{array}\\right)#0|Tabelle mit Linien array block matrix
CD|\\begin{CD} A @>{#1}>> B \\\\ @V{#2}VV @VVV \\\\ C @>>> D \\end{CD}#0|kommutatives Diagramm commutative diagram`,
  space: `
\\,||kleiner Abstand thin space
\\:||mittlerer Abstand medium space
\\;||großer Abstand thick space
\\!||negativer Abstand negative space
\\quad||Abstand quad
\\qquad||doppelter Abstand qquad
\\hspace|\\hspace{1em}|eigener Abstand horizontal space`,
};

// Words for the macros of math.js (your paper, your thesis, the physics package).
const MACRO_WORDS = {
  '\\dv': 'Ableitung derivative', '\\pdv': 'partielle Ableitung partial derivative', '\\fdv': 'Funktionalableitung functional derivative',
  '\\abs': 'Betrag absolute', '\\norm': 'Norm', '\\ket': 'Ket Zustand state', '\\bra': 'Bra', '\\braket': 'Skalarprodukt Bra-Ket inner product',
  '\\expval': 'Erwartungswert expectation', '\\comm': 'Kommutator commutator', '\\acomm': 'Antikommutator anticommutator',
  '\\order': 'Ordnung O groß big O', '\\qty': 'Klammern wachsen', '\\tr': 'Spur trace', '\\Tr': 'Spur trace', '\\dd': 'Differential d',
  '\\slashed': 'Feynman slash', '\\diag': 'Diagonalmatrix diagonal', '\\Res': 'Residuum residue', '\\sgn': 'Vorzeichen sign',
};

const ARGS = (expansion) => Math.max(0, ...[...String(expansion).matchAll(/#(\d)/g)].map((m) => +m[1]));

function parse() {
  const out = [];
  for (const [group, text] of Object.entries(GROUPS)) {
    for (const line of text.trim().split('\n')) {
      // words after the last bar; the command up to the next bar (\left| keeps its own)
      const w = line.lastIndexOf('|');
      const rest = line.slice(0, w);
      const cut = rest.startsWith('\\left|') ? 6 : rest.indexOf('|');
      out.push({ label: rest.slice(0, cut), template: rest.slice(cut + 1) || rest.slice(0, cut), words: line.slice(w + 1), group });
    }
  }
  for (const [name, expansion] of Object.entries(MACROS)) {
    const n = ARGS(expansion);
    out.push({ label: name, template: n ? `${name}${Array.from({ length: n }, (_, i) => `{#${i + 1}}`).join('')}#0` : name, words: MACRO_WORDS[name] || '', group: 'yours', expansion });
  }
  return out;
}

let catalog = null;
export const texCatalog = () => (catalog ||= parse());
export const TEX_GROUPS = [...Object.keys(GROUPS), 'yours'];

// #1 … #9 and #0 → CodeMirror's fields; a literal { or } stays as it is.
// Without a place the cursor ends behind the text (#0 added).
export const toSnippet = (template) => (/#\d/.test(template) ? String(template) : `${template}#0`).replace(/#(\d)/g, (_, n) => `\${${n}}`);
// A sample to show the command: the places get a, b, c …
export const sampleOf = (template) => String(template).replace(/#0/g, '').replace(/#(\d)/g, (_, n) => 'abcdefghi'[+n - 1] || 'x');

// Shorthand that expands by itself while you type (0.17.0, setting editor.shorthand): in a formula ("math") or in
// text. Your own commands (Settings › Writing) come on top and may replace one of these.
export const SHORTHAND = [
  ['//', '\\frac{#1}{#2}#0', 'math'],
  ['sr', '^2', 'math'],
  ['cb', '^3', 'math'],
  ['td', '^{#1}#0', 'math'],
  ['__', '_{#1}#0', 'math'],
  ['sq', '\\sqrt{#1}#0', 'math'],
  ['->', '\\to ', 'math'],
  ['=>', '\\implies ', 'math'],
  ['<=', '\\leq ', 'math'],
  ['>=', '\\geq ', 'math'],
  ['!=', '\\neq ', 'math'],
  ['~~', '\\approx ', 'math'],
  ['xx', '\\times ', 'math'],
  ['**', '\\cdot ', 'math'],
  ['+-', '\\pm ', 'math'],
  ['ooo', '\\infty', 'math'],
  ['...', '\\dots', 'math'],
  ['pp', '\\partial', 'math'],
  ['nab', '\\nabla', 'math'],
  ['hb', '\\hbar', 'math'],
  ['dv', '\\dv{#1}{#2}#0', 'math'],
  ['pdv', '\\pdv{#1}{#2}#0', 'math'],
  ['bk', '\\braket{#1}{#2}#0', 'math'],
  ['kt', '\\ket{#1}#0', 'math'],
  ['ev', '\\expval{#1}#0', 'math'],
  ['sum', '\\sum_{#1}^{#2}#0', 'math'],
  ['int', '\\int_{#1}^{#2}#0', 'math'],
  ['lim', '\\lim_{#1 \\to #2}#0', 'math'],
  ['pmat', '\\begin{pmatrix} #1 & #2 \\\\ #3 & #4 \\end{pmatrix}#0', 'math'],
  ['case', '\\begin{cases} #1 & #2 \\\\ #3 & #4 \\end{cases}#0', 'math'],
  ['ali', '\\begin{aligned} #1 &= #2 \\\\ &= #3 \\end{aligned}#0', 'math'],
  ['tt', '\\text{#1}#0', 'math'],
  ['mk', '$#1$#0', 'text'],
  ['dm', '$$\n#1\n$$#0', 'text'],
  ...[['a', 'alpha'], ['b', 'beta'], ['g', 'gamma'], ['G', 'Gamma'], ['d', 'delta'], ['D', 'Delta'], ['e', 'epsilon'], ['ve', 'varepsilon'],
    ['z', 'zeta'], ['h', 'eta'], ['t', 'theta'], ['T', 'Theta'], ['i', 'iota'], ['k', 'kappa'], ['l', 'lambda'], ['L', 'Lambda'], ['m', 'mu'],
    ['n', 'nu'], ['x', 'xi'], ['p', 'pi'], ['r', 'rho'], ['s', 'sigma'], ['S', 'Sigma'], ['u', 'tau'], ['f', 'phi'], ['vf', 'varphi'],
    ['F', 'Phi'], ['c', 'chi'], ['y', 'psi'], ['Y', 'Psi'], ['o', 'omega'], ['O', 'Omega']].map(([k, g]) => [`;${k}`, `\\${g}`, 'math']),
].map(([trigger, text, where]) => ({ trigger, text, where, auto: true }));
