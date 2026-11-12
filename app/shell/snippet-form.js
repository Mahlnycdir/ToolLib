// Your own snippets: a form for a new one (empty, or from "Try it" of another snippet) and for changing or deleting
// one of yours. The file goes to nodes/snippets/<name>.md with source: you; Sync uploads it.
// Texts land in the language of the app (title, description, problems); the other language is optional.
import { h, toast, confirmDialog, promptDialog } from '../services/ui.js';
import { icon } from '../services/icons.js';
import { loadPref, removePref, savePref } from '../services/prefs.js';
import { t, getLang } from '../i18n/i18n.js';
import { LANGUAGES, buildSnippet, deleteNode, freeSnippetPath, getNode, isOwn, languageName, readNodeText, snippetFields, updateSnippet, writeNode } from '../services/nodes.js';
import { allNodes, forgetNode, indexState, nodeBySlug, refreshNode } from '../services/search.js';
import { isConfigured, noteChange } from '../services/sync.js';
import { GROUP_ORDER, groupLabel, nodeHref } from './node-view.js';
import { enableCodeKeys, forgetEdits } from './run-panel.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });
const DRAFT = 'snippet.draft';
const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const commaList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
const today = () => new Date().toISOString().slice(0, 10);

function field(labelKey, control, { hint, required } = {}) {
  return h('label', {},
    h('span', {}, t(labelKey), required ? h('span', { class: 'req', text: ' *' }) : null),
    control,
    hint ? h('span', { class: 'field-hint', text: hint }) : null);
}

// mode: 'new' or 'edit'; path: the snippet to edit
export async function renderSnippetForm(main, { mode, path, go, isCurrent }) {
  const lang = getLang();
  const editing = mode === 'edit';
  main.append(h('h1', { class: 'view-title', text: t(editing ? 'snippet.edit.title' : 'snippet.new.title') }));

  let node = null;
  let values;
  if (editing) {
    node = await getNode(path);
    if (!isCurrent()) return;
    if (!node || !isOwn(node.meta) || node.conflict || node.error) {
      main.append(h('div', { class: 'note warn' }, iconEl('warn'), h('p', { text: t(node ? 'snippet.notOwn' : 'node.notFound') })));
      return;
    }
    values = snippetFields(node, lang);
  } else {
    if (indexState().hasKnowledge === false) {
      main.append(h('p', { class: 'muted', text: t('snippet.noKnowledge') }),
        h('button', { type: 'button', class: 'btn primary', onclick: () => go('#/settings/sync') }, iconEl('settings'), h('span', { text: t('action.setup') })));
      return;
    }
    const draft = loadPref(DRAFT, null) || {};
    values = {
      language: draft.language || loadPref('snippet.language', 'python'),
      title: draft.title || '', titleOther: draft.titleOther || '', group: draft.group || loadPref('snippet.group', 'data'),
      problems: draft.problems || [], description: draft.description || '', tags: draft.tags || [],
      code: draft.code || '', check: draft.check || '', from: draft.from || '', fromTitle: draft.fromTitle || '', links: draft.links || [],
    };
  }

  // ------------------------------------------------------------------ fields
  const title = h('input', { class: 'field', type: 'text', value: values.title, autocomplete: 'off' });
  const titleOther = h('input', { class: 'field', type: 'text', value: values.titleOther, autocomplete: 'off' });
  // Language (0.15.1): any language, not only Python. It is chosen once; the groups offered follow it.
  const snippets = allNodes().filter((d) => d.type === 'snippet' && !d.conflict);
  const language = h('select', { class: 'field snippet-language', disabled: editing ? true : null });
  const fillLanguages = (pick) => {
    const all = [...new Set([...LANGUAGES, ...snippets.map((d) => d.language), pick].filter(Boolean))];
    language.replaceChildren(...all.map((l) => h('option', { value: l, text: languageName(l), selected: l === pick || null })), h('option', { value: '+', text: t('snippet.language.other') }));
  };
  fillLanguages(values.language || 'python');
  const group = h('select', { class: 'field snippet-group' });
  const fillGroups = (pick) => {
    const lang0 = language.value;
    const used = snippets.filter((d) => d.language === lang0).map((d) => d.group).filter(Boolean);
    const all = [...new Set([...(lang0 === 'python' ? GROUP_ORDER : []), ...used, 'other', pick].filter(Boolean))];
    group.replaceChildren(...all.map((g) => h('option', { value: g, text: groupLabel(g), selected: g === pick || null })), h('option', { value: '+', text: t('snippet.group.new') }));
    if (!all.includes(pick)) group.value = all[0];
  };
  fillGroups(values.group);
  let lastLanguage = language.value;
  let lastGroup = group.value;
  language.addEventListener('change', async () => {
    if (language.value === '+') {
      const name = await promptDialog(t('snippet.language.other'), { label: t('snippet.field.language'), placeholder: 'julia', validate: (v) => (/^[a-z][a-z0-9+#-]{0,19}$/.test(v.trim().toLowerCase()) ? '' : t('snippet.language.bad')) });
      fillLanguages(name ? name.trim().toLowerCase() : lastLanguage);
    }
    lastLanguage = language.value;
    fillGroups(group.value === '+' ? lastGroup : group.value);
    lastGroup = group.value;
    showCheck();
    form.dispatchEvent(new Event('input'));
  });
  group.addEventListener('change', async () => {
    if (group.value === '+') {
      const name = await promptDialog(t('snippet.group.new'), { label: t('snippet.field.group'), validate: (v) => (v.trim() ? '' : t('snippet.group.need')) });
      fillGroups(name ? name.trim() : lastGroup);
    }
    lastGroup = group.value;
    form.dispatchEvent(new Event('input'));
  });
  const problems = h('textarea', { class: 'field', rows: '3' });
  problems.value = values.problems.join('\n');
  const description = h('textarea', { class: 'field', rows: '3' });
  description.value = values.description;
  const tags = h('input', { class: 'field', type: 'text', value: values.tags.join(', '), autocapitalize: 'off', autocomplete: 'off' });
  const code = h('textarea', { class: 'code-edit', rows: '8', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', wrap: 'off', 'aria-label': t('snippet.field.code') });
  code.value = values.code;
  const check = h('textarea', { class: 'code-edit', rows: '4', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', wrap: 'off', 'aria-label': t('snippet.field.check') });
  check.value = values.check;
  enableCodeKeys(code);
  enableCodeKeys(check);
  const grow = (ta, min) => { ta.rows = Math.max(min, Math.min(ta.value.split('\n').length + 1, 30)); };
  grow(code, 6);
  grow(check, 3);
  code.addEventListener('input', () => grow(code, 6));
  check.addEventListener('input', () => grow(check, 3));
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });

  const form = h('form', { class: 'snippet-form', novalidate: true });
  const checkField = field('snippet.field.check', check, { hint: t('snippet.field.check.hint') });
  const showCheck = () => { checkField.hidden = language.value !== 'python'; };
  showCheck();
  if (!editing && values.from) form.append(h('p', { class: 'muted', text: t('snippet.from', { title: values.fromTitle || values.from }) }));
  form.append(
    h('section', { class: 'card' },
      field('snippet.field.title', title, { required: true }),
      field('snippet.field.titleOther', titleOther),
      h('div', { class: 'field-pair' }, field('snippet.field.language', language), field('snippet.field.group', group)),
      field('snippet.field.problems', problems, { hint: t('snippet.field.problems.hint') }),
      field('snippet.field.description', description),
      field('snippet.field.tags', tags)),
    h('section', { class: 'card' },
      field('snippet.field.code', code, { required: true }),
      checkField));

  const save = h('button', { type: 'submit', class: 'btn primary' }, iconEl('check'), h('span', { text: t('snippet.save') }));
  const cancel = h('button', { type: 'button', class: 'btn' }, h('span', { text: t('action.cancel') }));
  const actions = h('div', { class: 'form-actions' }, save, cancel);
  if (editing) {
    const del = h('button', { type: 'button', class: 'btn danger' }, iconEl('trash'), h('span', { text: t('snippet.delete') }));
    del.addEventListener('click', () => remove(del));
    actions.append(del);
  }
  form.append(error, actions);
  main.append(form);

  const collect = () => ({
    lang,
    language: language.value === '+' ? lastLanguage : language.value,
    title: title.value.trim(),
    titleOther: titleOther.value.trim(),
    group: group.value === '+' ? lastGroup : group.value,
    problems: lines(problems.value),
    description: description.value.trim(),
    tags: commaList(tags.value),
    code: code.value.replace(/\s+$/, ''),
    check: language.value === 'python' ? check.value.replace(/\s+$/, '') : '',
  });

  // A new snippet is kept as a draft on this device until it is saved or cancelled.
  if (!editing) {
    form.addEventListener('input', () => savePref(DRAFT, { ...collect(), from: values.from, fromTitle: values.fromTitle, links: values.links }));
  }

  const fail = (key, el) => {
    error.textContent = t(key);
    error.hidden = false;
    el?.focus();
    return false;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = collect();
    if (!f.title) return fail('snippet.need.title', title);
    if (!f.code) return fail('snippet.need.code', code);
    error.hidden = true;
    save.disabled = true;
    try {
      let target = path;
      if (editing) {
        const text = await readNodeText(path);
        const next = updateSnippet(text, f);
        if (next !== text) {
          await writeNode(path, next);
          await noteChange(path, 'edited');
        }
      } else {
        target = await freeSnippetPath(f.titleOther && lang === 'de' ? f.titleOther : f.title, (slug) => !!nodeBySlug(slug));
        await writeNode(target, buildSnippet({ ...f, links: values.links, date: today() }));
        await noteChange(target, 'added');
        removePref(DRAFT);
        savePref('snippet.group', f.group);
        savePref('snippet.language', f.language);
        if (values.from) forgetEdits(values.from);   // what you tried there lives in your snippet now
      }
      forgetEdits(target);
      await refreshNode(target);
      toast(t(isConfigured() ? 'snippet.saved' : 'snippet.savedLocal'), 'ok', 3500);
      location.replace(nodeHref(target));
    } catch (err) {
      console.warn('Could not save the snippet', err);
      save.disabled = false;
      fail('snippet.failed');
      error.textContent = t('snippet.failed', { error: err.message || String(err) });
    }
  });

  cancel.addEventListener('click', () => {
    if (!editing) removePref(DRAFT);
    if (history.length > 1) history.back();
    else go(editing ? nodeHref(path) : '#/m/cheatsheet');
  });

  async function remove(btn) {
    const name = values.title || node.slug;
    if (!(await confirmDialog(t('snippet.delete'), t('snippet.delete.confirm', { title: name }), { okLabel: t('snippet.delete'), danger: true }))) return;
    btn.disabled = true;
    try {
      await deleteNode(path);
      forgetNode(path);
      forgetEdits(path);
      await noteChange(path, 'removed');
      toast(t('snippet.deleted'), 'ok');
      location.replace('#/m/cheatsheet');
    } catch (err) {
      btn.disabled = false;
      toast(t('snippet.failed', { error: err.message || String(err) }), 'error', 5000);
    }
  }

  if (!editing && !values.title) title.focus();
}
