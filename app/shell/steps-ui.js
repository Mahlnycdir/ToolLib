// The steps of a project with their lights (0.28.0), for the project's "Next steps" widget and the control panel on
// Start. Every step has a light in front: grey = open, red = next, yellow = handed in / waiting for someone,
// green = done. Tap the light to change it; the box ticks a step off (green) or opens it again. When a step turns
// green or yellow, the board says what you could go on with (the first red step, else the first open one).
//
//   stepsEditor(p, { path, redraw, fields, refocus, compact, skip, after })
//     p        the loaded project (projects.js loadProject: steps with status)
//     compact  done steps fold into one line (the control panel)
//     skip     the index of a step shown elsewhere (the control panel shows the next step on its own)
//   lightButton(p, i, { path, redraw, after })  the light of one step as a button that changes it
//     after    after a step turned green or yellow: (project, status) → shows a hint; default: the next step here
//
// For Python readers: the lights are stored in the Markdown itself ("- [!]", "- [>]", "- [x]", "- [ ]"); the
// functions only change one line of the file (projects.js setStepStatus, toggleStep).
import { h, toast, actionSheet } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t } from '../i18n/i18n.js';
import { addStep, loadProject, nextUp, removeStep, setStepStatus, toggleStep } from '../services/projects.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
// the colours of the lights, also for the menu (which wants hex values)
export const LIGHT_HEX = { open: '#94a3b8', next: '#e5484d', wait: '#d9a406', done: '#1e9e48' };
export const LIGHTS = ['next', 'wait', 'done', 'open'];

// A small round light, also used on Start for the other projects.
export const light = (status, title = '') => h('span', { class: `light s-${status}`, title: title || t(`steps.light.${status}`), 'aria-hidden': title ? null : 'true' });

// After a step turned green or yellow: what to go on with in this project.
export async function hintNext(p) {
  const fresh = await loadProject(p.path).catch(() => null);
  const step = fresh && nextUp(fresh.steps);
  toast(step ? t('steps.goOn', { step: step.text }) : t('steps.allDone'), 'ok', 6000);
}

// The light of step i as a button: a tap offers the four lights.
export function lightButton(p, i, { path, redraw, after = hintNext }) {
  const s = p.steps[i];
  const dot = h('button', { type: 'button', class: 'light-btn no-drag', title: t('steps.light.change'), 'aria-label': `${t('steps.light.change')}: ${s.text} (${t(`steps.light.${s.status}`)})` }, light(s.status));
  dot.addEventListener('click', async () => {
    const pick = await actionSheet(s.text, LIGHTS.map((st) => ({ label: t(`steps.light.${st}`), value: st, icon: 'dot', color: LIGHT_HEX[st], detail: t(`steps.light.${st}.hint`) })));
    if (!pick || pick === s.status) return;
    await setStepStatus(path, i, pick);
    if (pick === 'done' || pick === 'wait') await after(p, pick);
    redraw();
  });
  return dot;
}

export function stepsEditor(p, { path, redraw, fields = {}, refocus = { set() {} }, compact = false, skip = -1, after = hintNext }) {
  const list = h('ul', { class: 'steps-list' });
  const done = p.steps.filter((s) => s.status === 'done').length;
  let showDone = !compact;
  const changed = async (status) => { if (status === 'done' || status === 'wait') await after(p, status); };
  const draw = () => {
    list.replaceChildren();
    p.steps.forEach((s, i) => {
      if ((s.status === 'done' && !showDone) || i === skip) return;
      const dot = lightButton(p, i, { path, redraw, after });
      const box = h('input', { type: 'checkbox', checked: s.status === 'done' ? true : null, 'aria-label': s.text });
      box.addEventListener('change', async () => {
        await toggleStep(path, i);
        await changed(s.status === 'done' ? 'open' : 'done');
        redraw();
      });
      const del = h('button', { type: 'button', class: 'icon-btn small step-del', 'aria-label': `${t('action.remove')}: ${s.text}`, title: t('action.remove'), html: icon('close') });
      del.addEventListener('click', async () => { await removeStep(path, i); redraw(); });
      list.append(h('li', { class: `s-${s.status}${s.status === 'done' ? ' done' : ''}` }, dot, h('label', {}, box, h('span', { text: s.text })), del));
    });
    if (compact && done) {
      const fold = h('button', { type: 'button', class: 'link-btn steps-fold small' }, iconEl('check'), h('span', { text: t(showDone ? 'steps.hideDone' : 'steps.showDone', { n: done }) }));
      fold.addEventListener('click', () => { showDone = !showDone; draw(); });
      list.append(h('li', { class: 'steps-fold-row' }, fold));
    }
  };
  draw();
  const input = h('input', { class: 'field step-input', type: 'text', placeholder: t('project.step.add'), 'aria-label': t('project.step.add'), enterkeyhint: 'done' });
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !input.value.trim()) return;
    e.preventDefault();
    await addStep(path, input.value);
    refocus.set('step');
    redraw();
  });
  fields.step = input;
  return h('div', { class: 'project-steps' }, list, input);
}
