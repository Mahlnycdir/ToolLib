// An open convention on a card (0.13.0): the box where you pick an option and decide, and what deciding writes.
// The format of the choices and the spots is described in services/choices.js.
//   pick → the formulas, the text and the check of the card show that option (highlighted), "Run check" tests it
//   decide → this card gets the chosen text and is marked as checked; cards with the same open convention get the
//   same text but stay unchecked; nodes/conventions/<id>.md records the decision, so later cards use it too.
import { h, modal, toast } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t } from '../i18n/i18n.js';
import { applyDecision, choiceHint, choiceTitle, choicesOf, findSpots, markSpots, plainSpots, texToText } from '../services/choices.js';
import { localize, parseNode, readNodeText, setField, titleOf, writeNode } from '../services/nodes.js';
import { allNodes, nodeBySlug, refreshNode } from '../services/search.js';
import { isConfigured, noteChange } from '../services/sync.js';
import { typeset } from './math.js';
import { inline } from './markdown.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
const hrefOf = (path) => `#/n/${path.split('/').map(encodeURIComponent).join('/')}`;
const q = (v) => JSON.stringify(String(v));

// What you picked but did not decide yet, per convention, while the app is open: the same pick shows on every card
// with that convention.
const tentative = new Map();   // id -> index

// The option you decided before (its convention card says decided: <label>), or null.
function decidedIndex(c) {
  const conv = nodeBySlug(c.id);
  if (!conv || conv.choice !== c.id || !conv.decided) return null;
  const i = c.options.indexOf(conv.decided);
  return i >= 0 ? i : null;
}

// { choices, pick(id), decided(id), complete } of a node; null when it has no open convention.
export function choiceState(node) {
  const choices = choicesOf(node.meta);
  if (!choices.length) return null;
  const byId = new Map(choices.map((c) => [c.id, c]));
  const decided = (id) => (byId.has(id) ? decidedIndex(byId.get(id)) : null);
  const pick = (id) => decided(id) ?? tentative.get(id) ?? null;
  return { choices, pick, decided, complete: choices.every((c) => pick(c.id) != null) };
}

// The node as it runs: every spot with the option you picked.
export const pickedNode = (node, st) => ({ ...node, body: plainSpots(node.body, st.pick) });

// Display formulas of a text, as LaTeX.
const displayFormulas = (md) => [...md.matchAll(/^\s*\$\$([\s\S]*?)\$\$/gm)].map((m) => m[1].trim());
const firstFormulaWith = (md, id) => displayFormulas(md).find((tex) => findSpots(tex).some((s) => s.id === id)) || '';
const othersWith = (id, path) => allNodes().filter((x) => x.path !== path && !x.conflict && x.choices?.some((c) => c.id === id));
const linkTo = (d, lang) => h('a', { href: hrefOf(d.path), text: titleOf(d, lang, d.slug) });

// The box under the title. onPick(id, index) draws the view again; onDecide() resolves to true when it is done.
export function choiceBox(node, { lang, editable, onPick, onDecide }) {
  const st = choiceState(node);
  const md = localize(node.body, lang);
  const box = h('section', { class: 'choice-box', 'aria-label': t('choice.open') },
    h('div', { class: 'choice-head' }, iconEl('vars'), h('strong', { text: t(st.choices.length > 1 ? 'choice.openMany' : 'choice.open') })),
    h('p', { class: 'small muted choice-intro', text: t('choice.intro') }));
  for (const c of st.choices) {
    const dec = st.decided(c.id);
    const fs = h('fieldset', { class: 'choice', dataset: { choice: c.id } }, h('legend', { text: choiceTitle(c, lang) }));
    const hint = choiceHint(c, lang);
    if (hint) fs.append(h('p', { class: 'small choice-hint' }, inline(hint)));
    const preview = firstFormulaWith(md, c.id);
    c.options.forEach((label, i) => {
      const input = h('input', {
        type: 'radio', name: `choice-${c.id}`, value: String(i),
        checked: st.pick(c.id) === i ? true : null, disabled: !editable || (dec != null && dec !== i) ? true : null,
      });
      input.addEventListener('change', () => { if (input.checked) { tentative.set(c.id, i); onPick?.(c.id, i); } });
      const row = h('label', { class: `choice-option${st.pick(c.id) === i ? ' on' : ''}` }, input,
        typeset(h('span', { class: 'choice-label' }), label, false));
      if (preview) {
        const tex = markSpots(`$$${preview}$$`, (id) => (id === c.id ? i : st.pick(id))).slice(2, -2);
        row.append(typeset(h('span', { class: 'choice-preview' }), tex, false));
      }
      fs.append(row);
    });
    if (dec != null) {
      const conv = nodeBySlug(c.id);
      fs.append(h('p', { class: 'small choice-decided' }, iconEl('check'),
        h('span', { text: `${t('choice.decidedBefore', { value: texToText(c.options[dec]), date: conv.decidedOn || '' })} ` }), linkTo(conv, lang)));
    }
    const also = othersWith(c.id, node.path);
    if (also.length) {
      const p = h('p', { class: 'small muted choice-also' }, h('span', { text: `${t('choice.alsoIn')} ` }));
      also.forEach((d, i) => { if (i) p.append(', '); p.append(linkTo(d, lang)); });
      fs.append(p);
    }
    box.append(fs);
  }
  if (editable) {
    const btn = h('button', { type: 'button', class: 'btn small primary decide-btn', disabled: st.complete ? null : true },
      iconEl('check'), h('span', { text: t('choice.decide') }));
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      if (!(await onDecide())) btn.disabled = false;
    });
    box.append(h('div', { class: 'btn-row' }, btn, st.complete ? null : h('span', { class: 'muted small', text: t('choice.pickFirst') })));
  }
  return box;
}

// The convention card that keeps your decision, in both languages.
function conventionCard(c, i, card, d, used, today, decisions) {
  const label = c.options[i];
  const formula = firstFormulaWith(card.body, c.id);
  const shown = formula ? plainSpots(`$$${formula}$$`, (id) => decisions[id] ?? null).slice(2, -2) : '';
  const topic = nodeBySlug('conventions')?.type === 'topic' ? 'conventions' : d.topics[0];
  const head = [
    '---', 'type: convention', `title: ${q(c.en)}`, `title_de: ${q(c.de)}`, `area: [${q(d.area[0] || 'physics')}]`,
    topic ? `topic: [${q(topic)}]` : null,
    `problems: [${q(`which ${c.en.charAt(0).toLowerCase()}${c.en.slice(1)} I use`)}]`,
    `problems_de: [${q(`welche Konvention ich nutze: ${c.de}`)}]`,
    `choice: ${q(c.id)}`, `options: [${c.options.map(q).join(', ')}]`, `decided: ${q(label)}`, `decided_on: ${q(today)}`,
    'source: you', 'verified: true', '---',
  ].filter(Boolean);
  const list = used.map((s) => `[[${s}]]`).join(', ');
  const lang = (en, de) => `::: en\n${en}\n:::\n\n::: de\n${de}\n:::`;
  const parts = [
    lang(`Your convention, decided on ${today} on [[${card.slug}]].${c.hint ? ` ${c.hint}` : ''}`,
      `Deine Konvention, am ${today} auf [[${card.slug}]] festgelegt.${c.hint_de || c.hint ? ` ${c.hint_de || c.hint}` : ''}`),
    `$$${label}$$`,
    shown ? `$$${shown}$$` : null,
    lang(`Used in: ${list}.`, `Genutzt in: ${list}.`),
  ].filter(Boolean);
  return `${head.join('\n')}\n\n${parts.join('\n\n')}\n`;
}

// Writes the decision. Returns true when it is done (the view draws itself again).
export async function decide(node, d, lang) {
  const st = choiceState(node);
  if (!st?.complete) return false;
  const decisions = Object.fromEntries(st.choices.map((c) => [c.id, st.pick(c.id)]));
  const ids = Object.keys(decisions);
  const others = allNodes().filter((x) => x.path !== node.path && !x.conflict && x.choices?.some((c) => ids.includes(c.id)));
  const label = (c) => texToText(c.options[decisions[c.id]]);

  const body = h('div', { class: 'choice-confirm' },
    h('ul', {}, st.choices.map((c) => h('li', {}, h('strong', { text: label(c) }), h('span', { text: ` · ${choiceTitle(c, lang)}` })))),
    others.length ? h('p', { text: t('choice.confirm.others', { n: others.length }) }) : null,
    others.length ? h('ul', { class: 'choice-confirm-list' }, others.map((o) => h('li', { text: titleOf(o, lang, o.slug) }))) : null,
    h('p', { class: 'muted small', text: t('choice.confirm.card') }));
  const ok = await modal({
    title: t('choice.confirm.title'), body, dismissValue: false,
    actions: [{ label: t('action.cancel'), value: false }, { label: t('choice.confirm.ok'), kind: 'primary', value: true }],
  });
  if (!ok) return false;

  const what = `decided ${st.choices.map((c) => `${c.id} (${label(c)})`).join(', ')}`;
  const today = new Date().toISOString().slice(0, 10);
  const changed = [];
  try {
    const text = await readNodeText(node.path);
    await writeNode(node.path, setField(applyDecision(text, parseNode(text, node.path).meta, decisions), 'verified', 'true'));
    changed.push(node.path);
    for (const o of others) {
      const before = await readNodeText(o.path);
      const after = applyDecision(before, parseNode(before, o.path).meta, decisions);
      if (after !== before) { await writeNode(o.path, after); changed.push(o.path); }
    }
    for (const c of st.choices) {
      const conv = nodeBySlug(c.id);
      if (conv && !(conv.type === 'convention' && (conv.choice === c.id || !conv.choice))) continue;   // the name belongs to another node
      if (conv?.decided) continue;                                                                    // decided before: this card took it over
      const used = [node.slug, ...others.filter((o) => o.choices.some((x) => x.id === c.id)).map((o) => o.slug)].sort();
      const path = conv?.path || `nodes/conventions/${c.id}.md`;
      await writeNode(path, conventionCard(c, decisions[c.id], node, d, used, today, decisions));
      changed.push(path);
    }
  } catch (e) {
    console.warn('Could not write the decision', e);
    toast(t('choice.failed'), 'error', 5000);
    return false;
  }
  for (const p of changed) await refreshNode(p);
  for (const p of changed) await noteChange(p, what);
  for (const id of ids) tentative.delete(id);
  toast(t(isConfigured() ? 'choice.done' : 'choice.doneLocal'), 'ok', 4000);
  return true;
}
