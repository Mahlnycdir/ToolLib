// What a node belongs to (0.15.0), shown with every node: the projects it is in, its connections and what you can do
// with it next. This is the context panel of the frame: on a wide screen it stands beside the node, on the phone
// below it. Since 0.25.0 the connections come from services/relations.js (both directions, every kind, live) through
// relationsPanel in link-ui.js; until then this file looked up "who links here" by itself.
import { h, toast, actionSheet } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { addToProject, focusProject, projects, projectsWith, removeFromProject } from '../services/projects.js';
import { relationsOf } from '../services/relations.js';
import { nodeHref, nodeTitle } from './node-view.js';
import { newNote, newProject } from './create.js';
import { paintProject } from './projects-view.js';
import { queueSearch } from './research-view.js';
import { relationsPanel } from './link-ui.js';
import { miniNet } from './net-view.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });

// Nodes that name this one in their links, their text or their sources, without projects (they are listed apart) and
// without pages of the same run through a website (too many). Kept for older callers; the panel uses relationsOf.
export function backlinks(d, limit = 12) {
  return relationsOf(d.slug).in.map((x) => x.d)
    .filter((n) => !(n.run && n.run === d.run) && !(d.type === 'research' && n.type === 'clip'))
    .slice(0, limit);
}

// d: the summary of the node; redraw() after a change.
export function contextBox(d, { go, redraw }) {
  const lang = getLang();
  const box = h('aside', { class: 'ctx', 'aria-label': t('ctx.title') });
  box.append(h('h2', { text: t('ctx.title') }));

  // projects
  const inProjects = projectsWith(d.slug);
  const focus = focusProject();
  const chips = h('div', { class: 'ctx-projects' });
  for (const p of inProjects) {
    const rm = h('button', { type: 'button', class: 'chip-x', 'aria-label': `${t('project.takeOut')}: ${p.title}`, title: t('project.takeOut'), html: icon('close') });
    rm.addEventListener('click', async (e) => { e.preventDefault(); await removeFromProject(p.path, d.slug); redraw(); });
    const c = h('span', { class: 'chip chip-project' }, h('a', { href: nodeHref(p.path) }, iconEl('target'), h('span', { text: p.title })), rm);
    paintProject(c, p.slug);
    chips.append(c);
  }
  if (focus && !inProjects.some((p) => p.path === focus.path)) {
    const add = h('button', { type: 'button', class: 'btn small ctx-focus-add' }, iconEl('plus'), h('span', { text: t('ctx.toFocus', { title: focus.title }) }));
    add.addEventListener('click', async () => { await addToProject(focus.path, [d.slug]); toast(t('ctx.added', { title: focus.title }), 'ok'); redraw(); });
    chips.append(add);
  }
  const pick = h('button', { type: 'button', class: 'btn small ctx-add' }, iconEl('target'), h('span', { text: t(inProjects.length || focus ? 'ctx.other' : 'ctx.toProject') }));
  pick.addEventListener('click', async () => {
    const rest = projects().filter((p) => !inProjects.some((x) => x.path === p.path));
    const choice = await actionSheet(t('ctx.toProject'), [...rest.map((p) => ({ label: p.title, value: p.path, icon: 'target' })), rest.length ? '-' : null, { label: t('create.project'), value: 'new', icon: 'plus' }].filter(Boolean));
    if (!choice) return;
    const target = choice === 'new' ? await newProject({ go: null }) : choice;
    if (!target) return;
    await addToProject(target, [d.slug]);
    redraw();
  });
  chips.append(pick);
  box.append(h('section', {}, h('h3', { text: t('module.projects.name') }), chips));

  // connections: both directions, every kind, and a button to draw a new one (0.25.0)
  box.append(relationsPanel(d));
  // the small network: what lies around it, a tap opens the big one (0.26.0)
  box.append(miniNet(d));

  // go on with it
  const title = nodeTitle(d, lang);
  const act = (key, iconName, fn, cls) => h('button', { type: 'button', class: `btn small ${cls}`, onclick: fn }, iconEl(iconName), h('span', { text: t(key) }));
  box.append(h('section', {}, h('h3', { text: t('ctx.next') }), h('div', { class: 'ctx-actions' },
    act('ctx.note', 'edit', async () => { if (await newNote({ text: `[[${d.slug}|${title}]]\n\n` })) redraw(); }, 'ctx-note'),
    d.type === 'clip' || d.type === 'research' ? null : act('ctx.search', 'search', () => { queueSearch(title); go('#/m/scraper'); }, 'ctx-search'))));
  return box;
}
