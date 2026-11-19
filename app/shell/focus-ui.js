// The projects in focus and their priorities (0.33.7).
// ENTE: "Mache halt Prios im Fokus. Oben stehen dann genau die im Fokus, geordnet nach den Prioritäten … Keine darf
// dieselbe haben. Ich möchte mit der Anzahl … nicht eingeschränkt sein." and "mehr Controlmechanismus der
// Today-Seite, nicht nur auf ein Projekt, sondern alle offenen (iPhone: nicht überladen, easy to use)".
//
//   openFocusSheet()          a sheet: the projects in focus with their numbers (↑ ↓, tap the number for another
//                             priority, × out of focus), below the others with "+ Focus"
//   focusRows({ go, max })    one line per project in focus: number, light, next step with a "Done" tick, open;
//                             Heute shows it under the light of priority 1 (on the phone the first three, the rest
//                             behind "+ n more")
//   rankBadge(path)           the small number of a project in focus (or nothing)
//
// For Python readers: the list itself lives in services/projects.js (focusList, moveFocus, addToFocus,
// removeFromFocus); this file only draws it. Every change there calls onFocusChange, so whoever shows the list
// (tabs, Heute, the projects page) draws again.
import { h, openSheet, actionSheet, toast } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t } from '../i18n/i18n.js';
import { addToFocus, focusList, focusPath, focusRank, moveFocus, nextUp, loadProject, onFocusChange, projects, removeFromFocus, setFocus, setStepStatus } from '../services/projects.js';
import { nodeHref } from './node-view.js';
import { paintProject } from './projects-view.js';
import { light } from './steps-ui.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });

export function rankBadge(path) {
  const r = focusRank(path);
  return r ? h('span', { class: 'focus-rank', title: t('focus.rank', { n: r }), text: String(r) }) : null;
}

function projectLight(p) {
  const s = p.steps || {};
  if (s.red) return 'next';
  if (s.wait) return 'wait';
  if (s.done && !s.open) return 'done';
  return 'open';
}

// ------------------------------------------------------------------ the sheet
export function openFocusSheet() {
  const body = h('div', { class: 'focus-sheet' });
  let sheet = null;
  const draw = () => {
    const list = focusList();
    const inList = new Set(list.map((d) => d.path));
    const rest = projects().filter((p) => p.state !== 'done' && !inList.has(p.path));
    const row = (d, i) => {
      const el = h('div', { class: 'focus-sheet-row', dataset: { path: d.path } },
        h('button', { type: 'button', class: 'focus-rank big', title: t('focus.rank.change'), 'aria-label': t('focus.rank', { n: i + 1 }), text: String(i + 1), onclick: () => pickRank(d, list.length) }),
        h('span', { class: 'focus-sheet-title' }, h('b', { text: d.title }), h('span', { class: 'muted small', text: d.steps?.next ? d.steps.next : t('pult.noSteps') })),
        h('button', { type: 'button', class: 'icon-btn small', title: t('focus.up'), 'aria-label': t('focus.up'), disabled: i === 0, html: icon('arrowUp'), onclick: () => moveFocus(d.path, i) }),
        h('button', { type: 'button', class: 'icon-btn small', title: t('focus.down'), 'aria-label': t('focus.down'), disabled: i === list.length - 1, html: icon('arrowDown'), onclick: () => moveFocus(d.path, i + 2) }),
        h('button', { type: 'button', class: 'icon-btn small', title: t('focus.remove'), 'aria-label': t('focus.remove'), html: icon('close'), onclick: () => removeFromFocus(d.path) }));
      paintProject(el, d.slug);
      return el;
    };
    body.replaceChildren(
      h('p', { class: 'muted small', text: t('focus.sheet.hint') }),
      list.length ? h('div', { class: 'focus-sheet-list' }, list.map(row)) : h('p', { class: 'empty-invite small', text: t('focus.sheet.empty') }),
      rest.length ? h('p', { class: 'muted small focus-sheet-sub', text: t('focus.sheet.others') }) : null,
      ...rest.map((p) => {
        const el = h('div', { class: 'focus-sheet-row off' },
          h('span', { class: 'project-dot', 'aria-hidden': 'true' }),
          h('span', { class: 'focus-sheet-title' }, h('b', { text: p.title }), p.state === 'paused' ? h('span', { class: 'muted small', text: t('project.state.paused') }) : null),
          h('button', { type: 'button', class: 'btn small', onclick: () => addToFocus(p.path) }, iconEl('target'), h('span', { text: t('focus.add') })));
        paintProject(el, p.slug);
        return el;
      }));
  };
  async function pickRank(d, n) {
    const pick = await actionSheet(t('focus.rank.of', { title: d.title }), Array.from({ length: n }, (_, i) => ({ label: t('focus.rank', { n: i + 1 }), value: String(i + 1), icon: 'target' })));
    if (pick) moveFocus(d.path, +pick);
  }
  draw();
  const stop = onFocusChange(() => { if (body.isConnected) draw(); });
  sheet = openSheet(t('focus.sheet.title'), body, { onClose: stop });
  return sheet;
}

// ------------------------------------------------------------------ one line per project in focus (Heute)
export function focusRows({ go, skipFirst = false, max = 0 }) {
  const box = h('div', { class: 'focus-rows' });
  let open = false;
  const draw = () => {
    const all = focusList();
    const list = skipFirst ? all.slice(1) : all;
    const shown = max && !open ? list.slice(0, max) : list;
    const rows = shown.map((d) => {
      const i = all.indexOf(d);
      const s = d.steps || {};
      const total = (s.open || 0) + (s.done || 0);
      const done = h('button', {
        type: 'button', class: 'icon-btn small focus-row-done', title: t('focus.row.done'), 'aria-label': `${t('focus.row.done')}: ${s.next || ''}`, html: icon('check'), hidden: !s.next,
        onclick: async (e) => {
          e.stopPropagation();
          const p = await loadProject(d.path).catch(() => null);
          const nx = p && nextUp(p.steps);
          if (!nx) return;
          await setStepStatus(d.path, p.steps.indexOf(nx), 'done');
          const after = await loadProject(d.path).catch(() => null);
          const n2 = after && nextUp(after.steps);
          toast(n2 ? t('steps.goOn', { step: n2.text }) : t('steps.allDone'), 'ok', 6000);
        },
      });
      const row = h('div', { class: `focus-row${d.path === focusPath() ? ' here' : ''}`, dataset: { path: d.path } },
        h('span', { class: 'focus-rank', text: String(i + 1) }),
        light(projectLight(d), t(`pult.light.${projectLight(d)}`)),
        h('button', { type: 'button', class: 'focus-row-main', onclick: () => { setFocus(d.path); go(nodeHref(d.path)); } },
          h('span', { class: 'focus-row-title', text: d.title }),
          h('span', { class: 'muted small focus-row-next', text: s.next || t(total ? 'steps.allDone' : 'pult.noSteps') })),
        total ? h('span', { class: 'meter focus-row-meter', title: t('pult.progress', { n: s.done, of: total }) }, h('span', { style: { width: `${Math.round((s.done / total) * 100)}%` } })) : null,
        done);
      paintProject(row, d.slug);
      return row;
    });
    const more = max && list.length > max ? h('button', { type: 'button', class: 'btn small ghost focus-more', text: open ? t('focus.less') : t('focus.more', { n: list.length - max }), onclick: () => { open = !open; draw(); } }) : null;
    const manage = h('button', { type: 'button', class: 'btn small ghost focus-manage', onclick: () => openFocusSheet() }, iconEl('edit'), h('span', { text: t('focus.manage') }));
    box.replaceChildren(...rows, h('div', { class: 'focus-rows-foot' }, more, manage));
  };
  draw();
  const stop = onFocusChange(() => { if (!box.isConnected) { stop(); return; } draw(); });
  return box;
}
