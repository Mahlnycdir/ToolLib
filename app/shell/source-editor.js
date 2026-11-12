// Edit any node as it is written (0.15.1): its Markdown with the header on the left, how it will look on the right
// (on the phone: two tabs). This is how cards are changed, and everything else that has no form of its own.
// Saving checks that the header still reads as YAML and still names a type and a title; the file changes only then.
// Since 0.17.0 in the editor of the pages (md-editor.js): colours, LaTeX completion, shorthand, keys.
import { h, toast, confirmDialog, debounce } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { getNode, localize, parseNode, readNodeText, titleOf, writeNode } from '../services/nodes.js';
import { nodeBySlug, refreshNode } from '../services/search.js';
import { noteChange } from '../services/sync.js';
import { announce } from '../services/channel.js';
import { renderMarkdown } from './markdown.js';
import { nodeHref, nodeTitle, typeLabel, typeTile } from './node-view.js';
import { createEditor } from './md-editor.js';
import { assetUrl } from '../services/assets.js';
import { searchNodes } from '../services/search.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });

// What is wrong with a text as a node, as a key of strings.json, or '' when it can be saved.
export function sourceProblem(text, before) {
  if (!/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.test(text)) return 'source.bad.header';
  const node = parseNode(text, 'x/x.md');
  if (node.error) return 'source.bad.yaml';
  if (!node.meta.type) return 'source.bad.type';
  if (before && String(node.meta.type) !== String(before.meta.type)) return 'source.bad.typeChanged';
  if (!String(node.meta.title || '').trim()) return 'source.bad.title';
  return '';
}

export async function renderSource(main, path, { go, isCurrent }) {
  main.dataset.view = 'source';
  const lang = getLang();
  const node = await getNode(path);
  if (!isCurrent()) return;
  const back = () => (history.length > 1 ? history.back() : go(nodeHref(path)));
  if (!node || node.conflict) {
    main.append(h('h1', { class: 'view-title', text: t('node.notFound') }));
    return;
  }
  const original = await readNodeText(path);
  if (!isCurrent()) return;

  const host = h('div', { class: 'source-text' });
  const drawSoon = debounce(() => draw(), 250);
  const editor = createEditor(host, {
    value: original, kind: 'source', label: t('source.text'),
    links: (q) => (q.trim() ? searchNodes(q, { limit: 10, filter: (d) => !d.conflict && d.path !== path }) : []).map((d) => ({ slug: d.slug, label: d.title, kind: typeLabel(d.type) })),
    onChange: () => drawSoon(),
    actions: { 'editor.save': () => save.click() },
  });
  const area = { get value() { return editor.value(); } };
  const preview = h('div', { class: 'source-preview node' });
  const problem = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const save = h('button', { type: 'button', class: 'btn primary source-save', disabled: true }, iconEl('check'), h('span', { text: t('action.save') }));
  const cancel = h('button', { type: 'button', class: 'btn source-cancel' }, h('span', { text: t('action.cancel') }));
  const changed = () => area.value !== original;

  const tools = h('div', { class: 'source-tools', role: 'toolbar', 'aria-label': t('source.tools') });
  const tool = (label, title, fn) => tools.append(h('button', { type: 'button', class: 'btn small', title, 'aria-label': title, text: label, onpointerdown: (e) => e.preventDefault(), onclick: fn }));
  const around = (open, close, sample) => editor.apply((v, a, b) => { const inner = v.slice(a, b) || sample; return { value: v.slice(0, a) + open + inner + close + v.slice(b), start: a + open.length, end: a + open.length + inner.length }; });
  tool('$…$', t('source.tool.inline'), () => around('$', '$', 'x'));
  tool('$$', t('source.tool.display'), () => around('\n$$\n', '\n$$\n', 'E = mc^2'));
  tool('[[ ]]', t('source.tool.link'), () => { around('[[', ']]', ''); editor.complete(); });
  tool('B', t('source.tool.bold'), () => around('**', '**', 'text'));
  tool('##', t('source.tool.heading'), () => around('\n## ', '\n', 'Title'));
  tool('```', t('source.tool.code'), () => around('\n```python\n', '\n```\n', 'code'));

  function draw() {
    const key = sourceProblem(area.value, node);
    problem.hidden = !key;
    problem.textContent = key ? t(key) : '';
    save.disabled = !!key || !changed();
    const now = parseNode(area.value, path);
    const title = key && key !== 'source.bad.title' ? titleOf(node, lang) : titleOf(now, lang);
    preview.replaceChildren(
      h('header', { class: 'node-head' }, typeTile(node.meta.type, 'big'), h('div', { class: 'node-titles' }, h('h1', { class: 'view-title', text: title }), h('div', { class: 'node-chips' }, h('span', { class: 'chip', text: typeLabel(node.meta.type) })))),
      renderMarkdown(localize(now.body, lang), { onNodeLink: (slug) => { const d = nodeBySlug(slug); return d ? { href: nodeHref(d.path), label: nodeTitle(d, lang) } : null; }, onAsset: assetUrl }));
  }

  // two panes on a wide screen, two tabs on the phone
  const tabs = h('div', { class: 'segmented source-tabs', role: 'tablist' });
  const box = h('div', { class: 'source', dataset: { pane: 'text' } });
  for (const id of ['text', 'preview']) {
    const b = h('button', { type: 'button', role: 'tab', class: id === 'text' ? 'on' : '', text: t(`source.${id}`) });
    b.addEventListener('click', () => {
      box.dataset.pane = id;
      for (const x of tabs.children) x.classList.toggle('on', x === b);
      if (id === 'preview') draw();
    });
    tabs.append(b);
  }
  box.append(h('div', { class: 'source-left' }, tools, host), h('div', { class: 'source-right' }, preview));

  save.addEventListener('click', async () => {
    if (sourceProblem(area.value, node) || !changed()) return;
    save.disabled = true;
    try {
      const text = area.value.endsWith('\n') ? area.value : `${area.value}\n`;
      await writeNode(path, text);
      await refreshNode(path);
      await noteChange(path, 'edited');
      announce([path]);
      toast(t('source.saved'), 'ok');
      leaving = true;
      location.replace(nodeHref(path));
    } catch (e) {
      console.warn('Could not save', e);
      save.disabled = false;
      toast(t('create.failed'), 'error', 5000);
    }
  });
  let leaving = false;
  cancel.addEventListener('click', async () => {
    if (changed() && !(await confirmDialog(t('source.discard'), t('source.discard.confirm'), { okLabel: t('source.discard'), danger: true }))) return;
    leaving = true;
    back();
  });

  main.append(...[
    h('header', { class: 'source-head' }, h('div', {}, h('h1', { class: 'view-title', text: t('source.title') }), h('p', { class: 'muted small', text: path })), h('div', { class: 'btn-row' }, cancel, save)),
    node.meta.verified === true && node.meta.source !== 'you' ? h('p', { class: 'muted small', text: t('source.verified') }) : null,
    tabs, problem, box].filter(Boolean));
  draw();
}
