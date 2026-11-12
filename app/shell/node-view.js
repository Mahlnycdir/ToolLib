// Reading the knowledge: the view of one node and the Python cheatsheet with all snippets.
import { h, toast, copyText, confirmDialog } from '../services/ui.js';
import { loadPref, savePref } from '../services/prefs.js';
import { icon } from '../services/icons.js';
import { t, getLang } from '../i18n/i18n.js';
import { getNode, isOwn, languageName, linksOf, localize, readNodeText, replaceBlock, runParts, setVerified, sourcesOf, summary, titleOf, writeNode } from '../services/nodes.js';
import { allNodes, bestProblem, indexState, nodeByPath, nodeBySlug, onIndexChange, refreshNode, searchNodes } from '../services/search.js';
import { githubRepo, isConfigured, noteChange, repoUrl } from '../services/sync.js';
import { moduleOfType, paintAccent } from './modules.js';
import { renderMarkdown } from './markdown.js';
import { runControls } from './run-panel.js';
import { CARD_TYPES, cardSections, shownElsewhere, topicChips } from './formulary.js';
import { choiceBox, choiceState, decide, pickedNode } from './choice-box.js';
import { markSpots } from '../services/choices.js';
import { conflictActions } from './conflict-actions.js';
import { loadLibrary } from '../services/library-store.js';
import { workFromClip } from '../services/research-store.js';
import { createFromWork } from './card-dialog.js';
import { openOriginal } from '../services/pdf-inbox.js';
import { contextBox } from './context.js';

const iconEl = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icon(name) });

// ------------------------------------------------------------------ kinds of nodes
const TYPE_ICON = {
  snippet: 'code', recipe: 'list', topic: 'outline', formula: 'vars', convention: 'outline', definition: 'book', term: 'book', theorem: 'book',
  rule: 'warn', part: 'chip', device: 'chip', pin_map: 'board', tool: 'wand', note: 'edit', project: 'target',
  card: 'chalkboard', clip: 'globe', research: 'search', library: 'book', page: 'file',
};
export const typeIcon = (type) => TYPE_ICON[type] || 'file';
export const typeAccent = (type) => moduleOfType(type);
const SOURCE_ELSEWHERE = new Set(['clip', 'research', 'library', 'page', 'project', 'note']);
export const sourceHref = (path) => `#/src/${path.split('/').map(encodeURIComponent).join('/')}`;
export const typeLabel = (type) => (t(`type.${type}`) === `type.${type}` ? type : t(`type.${type}`));
export const groupLabel = (group) => (t(`group.${group}`) === `group.${group}` ? group : t(`group.${group}`));
export const GROUP_ORDER = ['control-flow', 'functions-classes', 'errors-files', 'data', 'data-structures', 'numpy', 'scipy', 'matplotlib', 'animation', 'lattice', 'sympy', 'debugging', 'threading', 'gui', 'git', 'science', 'imports'];
const inCheatsheet = (d) => d && (d.type === 'snippet' || d.type === 'recipe') && !d.conflict;
const problemsOf = (d, lang = getLang()) => (lang === 'de' && d.problems_de.length ? d.problems_de : d.problems.length ? d.problems : d.problems_de);

export const nodeHref = (path) => `#/n/${path.split('/').map(encodeURIComponent).join('/')}`;
export const nodeTitle = (d, lang = getLang()) => titleOf(d, lang, d.slug);
export const nodeLead = (d, lang = getLang()) => d.lead?.[lang] || d.lead?.en || '';

export function typeTile(type, cls = '') {
  const tile = iconEl(typeIcon(type), `tile ${cls}`);
  paintAccent(tile, typeAccent(type));
  return tile;
}

export async function copyWithToast(text) {
  const ok = await copyText(text);
  toast(t(ok ? 'node.copied' : 'node.copyFailed'), ok ? 'ok' : 'error');
}

// ------------------------------------------------------------------ recently opened
export const recentPaths = () => loadPref('recent', []);
function pushRecent(path) {
  savePref('recent', [path, ...recentPaths().filter((p) => p !== path)].slice(0, 10));
}

// ------------------------------------------------------------------ checking nodes
// Marks a node as verified (or unverified again) in its file on this device; Sync uploads it.
async function changeVerified(path, verified) {
  try {
    await setVerified(path, verified);
    await refreshNode(path);
    await noteChange(path, verified ? 'verified' : 'unverified');
  } catch (e) {
    console.warn('Could not change the node', e);
    toast(t('node.verify.failed'), 'error', 5000);
    return false;
  }
  toast(t(verified ? (isConfigured() ? 'node.verify.done' : 'node.verify.doneLocal') : 'node.unverify.done'), 'ok', 3500);
  return true;
}

// Your version of the code or the check goes into the node file; only that block changes. Sync uploads it.
async function takeOver(path, which, code) {
  if (!code.trim()) return false;
  const ok = await confirmDialog(t('run.takeOver.title'), t(which === 'code' ? 'run.takeOver.code' : 'run.takeOver.check'), { okLabel: t('run.takeOver.ok') });
  if (!ok) return false;
  try {
    const text = await readNodeText(path);
    const next = replaceBlock(text, which, code);
    if (next == null) throw new Error('no code block');
    if (next !== text) {
      await writeNode(path, next);
      await refreshNode(path);
      await noteChange(path, 'edited');
    }
  } catch (e) {
    console.warn('Could not change the node', e);
    toast(t('node.verify.failed'), 'error', 5000);
    return false;
  }
  toast(t(isConfigured() ? 'run.takeOver.done' : 'snippet.savedLocal'), 'ok', 3500);
  return true;
}

// ------------------------------------------------------------------ node view
export async function renderNode(main, path, ctx) {
  const { isCurrent, go, onSync } = ctx;
  // Draws the view again after a change, at the same scroll position.
  const redraw = async () => {
    if (!isCurrent()) return;
    const top = main.scrollTop;
    main.replaceChildren();
    await renderNode(main, path, ctx);
    main.scrollTop = top;
  };
  main.dataset.view = 'node';
  const box = h('article', { class: 'node' });
  const back = h('button', { type: 'button', class: 'btn small back-btn', onclick: () => (history.length > 1 ? history.back() : go('#/home')) },
    iconEl('chevronLeft'), h('span', { text: t('action.back') }));
  box.append(back);
  main.append(box);

  const node = await getNode(path);
  if (!isCurrent()) return;
  if (!node) {
    box.append(h('h1', { class: 'view-title', text: t('node.notFound') }), h('p', { class: 'muted', text: t('node.notFound.hint') }),
      h('code', { class: 'path', text: path }));
    if (onSync) box.append(h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn primary', onclick: onSync }, iconEl('refresh'), h('span', { text: t('action.sync') }))));
    return;
  }
  pushRecent(path);
  const lang = getLang();
  const d = summary(node);
  const other = lang === 'de' ? (d.title_de && d.title !== d.title_de ? d.title : '') : d.title_de;

  // Head: kind, title, the title in the other language. A checked node looks like any other: no mark.
  const own = isOwn(node.meta);
  const chips = h('div', { class: 'node-chips' }, h('span', { class: 'chip', text: typeLabel(d.type) }));
  if (d.type === 'snippet' && d.language && d.language !== 'python') chips.append(h('span', { class: 'chip', text: languageName(d.language) }));
  if (d.group) chips.append(h('span', { class: 'chip', text: groupLabel(d.group) }));
  for (const a of d.area) chips.append(h('span', { class: 'chip', text: t(`area.${a}`) === `area.${a}` ? a : t(`area.${a}`) }));
  chips.append(...topicChips(d));
  if (own) chips.append(h('span', { class: 'chip chip-own' }, iconEl('edit'), h('span', { text: t('node.own') })));
  const editable = !node.conflict && !node.error;
  box.append(h('header', { class: 'node-head' },
    typeTile(d.type, 'big'),
    h('div', { class: 'node-titles' },
      h('h1', { class: 'view-title', text: nodeTitle(d, lang) }),
      other ? h('p', { class: 'muted other-title', text: other }) : null,
      chips),
    // Edit (0.15.1): every node opens as it is written, with a preview; works you kept, folders and pages have
    // their own places for that, your own snippets their form
    editable && !SOURCE_ELSEWHERE.has(d.type) && !(own && d.type === 'snippet')
      ? h('a', { class: 'btn small edit-source', href: sourceHref(path) }, iconEl('edit'), h('span', { text: t('node.edit') })) : null));

  // The problems this node solves: what the search matches first.
  const problems = problemsOf(d, lang);
  if (problems.length) {
    box.append(h('div', { class: 'solves' }, h('span', { class: 'solves-label', text: t('node.solves') }),
      h('ul', {}, problems.map((p) => h('li', { text: p })))));
  }

  // An open convention (0.13.0): you pick and decide in its box; deciding also marks the card as checked.
  const choices = CARD_TYPES.has(d.type) ? choiceState(node) : null;
  if (!d.verified) {
    const who = t(`node.source.${d.source}`) === `node.source.${d.source}` ? d.source : t(`node.source.${d.source}`);
    const text = h('div', { class: 'note-body' }, h('p', { text: who ? t('node.unverifiedFrom', { who }) : t('node.unverified') }));
    if (editable && !choices) {
      const btn = h('button', { type: 'button', class: 'btn small verify-btn' }, iconEl('check'), h('span', { text: t('node.verify') }));
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        if (await changeVerified(path, true)) await redraw();
        else btn.disabled = false;
      });
      text.append(h('p', { class: 'small', text: t('node.verify.hint') }), btn);
    }
    box.append(h('div', { class: 'note unverified' }, iconEl('info'), text));
  }
  if (node.error) box.append(h('div', { class: 'note warn' }, iconEl('warn'), h('p', { text: t('node.yamlError', { error: node.error }) })));
  if (node.conflict) {
    const original = path.replace(/\.conflict-[a-z0-9-]+(\.[^./]+)?$/, '$1');
    box.append(h('div', { class: 'note warn' }, iconEl('warn'), h('div', {},
      h('p', {}, t('node.conflictCopy'), ' ', h('a', { href: nodeHref(original), text: original })),
      conflictActions(path, (o) => go(nodeByPath(o) ? nodeHref(o) : '#/home')))));
  }

  const onNodeLink = (slug) => {
    const target = nodeBySlug(slug);
    return target ? { href: nodeHref(target.path), label: nodeTitle(target, lang) } : null;
  };

  // Copy, and run on this device: "Try it" with editable code, "Run check" with the node's check
  if (d.type === 'snippet' && d.code) {
    const row = h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn small primary copy-main', onclick: () => copyWithToast(d.code) }, iconEl('copy'), h('span', { text: t('node.copyCode') })));
    box.append(row);
    const run = runControls(node, {
      canVerify: () => editable && !d.verified,
      onVerify: async () => {
        if (!(await changeVerified(path, true))) return false;
        await redraw();
        return true;
      },
      nodeLink: onNodeLink,
      canChange: () => editable,
      onTakeOver: (which, text) => takeOver(path, which, text),
      onSaveAs: ({ code, check }) => {
        savePref('snippet.draft', { from: path, fromTitle: nodeTitle(d, lang), group: d.group, links: [d.slug], code, check: check || '' });
        go('#/new');
      },
      redraw,
    });
    if (run) {
      row.append(...run.buttons);
      box.append(run.panel);
    }
    if (own && editable) {
      row.append(h('button', { type: 'button', class: 'btn small edit-own', onclick: () => go(`#/edit/${path.split('/').map(encodeURIComponent).join('/')}`) },
        iconEl('edit'), h('span', { text: t('node.edit') })));
    }
  }

  // A kept work reads in the research window (0.14.1): it opens the stored text, or fetches it.
  if (d.type === 'clip') {
    const make = (kind) => async () => { const w = await workFromClip(path).catch(() => null); if (w) await createFromWork(kind, w, { go }); };
    box.append(h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn small primary clip-read', onclick: () => { savePref('research.read', path); go('#/m/scraper'); } }, iconEl('book'), h('span', { text: t('node.read') })),
      // the original in your PDF folder on the Mac (0.14.4)
      d.file ? h('button', { type: 'button', class: 'btn small clip-original', title: t('inbox.original.hint'), onclick: async () => { if (!(await openOriginal(d.file, d.fileSha1))) toast(t('inbox.originalFailed'), 'warn', 5000); } }, iconEl('file'), h('span', { text: t('inbox.original') })) : null,
      editable ? h('button', { type: 'button', class: 'btn small clip-card', onclick: make('card') }, iconEl('plus'), h('span', { text: t('reader.card') })) : null,
      editable ? h('button', { type: 'button', class: 'btn small clip-term', onclick: make('term') }, iconEl('plus'), h('span', { text: t('reader.card.kind.term') })) : null,
      editable ? h('button', { type: 'button', class: 'btn small clip-snippet', onclick: make('snippet') }, iconEl('code'), h('span', { text: t('reader.snippet') })) : null));
  }

  // Your libraries (0.14.2): a library shows its chapters, a page where it stands, with the pages before and after it.
  const writeIn = (libPath, pagePath = '') => { savePref('library.open', { path: libPath, page: pagePath, at: Date.now() }); go('#/m/library'); };
  let libInfo = null;
  if ((d.type === 'library' || d.type === 'page') && !node.conflict) {
    const libPath = d.type === 'library' ? path : allNodes().find((x) => x.type === 'library' && !x.conflict && x.slug === d.library)?.path;
    if (libPath) {
      libInfo = await loadLibrary(libPath).catch(() => null);
      if (!isCurrent()) return;
    }
    if (libInfo) {
      const flat = libInfo.chapters.flatMap((c, ci) => c.pages.map((sl) => ({ slug: sl, ci })));
      const k = flat.findIndex((x) => x.slug === d.slug);
      libInfo.prev = k > 0 ? flat[k - 1].slug : '';
      libInfo.next = k >= 0 && k < flat.length - 1 ? flat[k + 1].slug : '';
      if (d.type === 'page') {
        const ch = k >= 0 ? libInfo.chapters[flat[k].ci] : null;
        box.append(h('p', { class: 'lb-crumb small' }, h('a', { href: nodeHref(libPath), text: libInfo.title }), ch ? h('span', { class: 'muted', text: ` › ${flat[k].ci + 1}. ${ch.title}` }) : null));
      }
      if (editable) box.append(h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn small primary lb-write', onclick: () => writeIn(libPath, d.type === 'page' ? path : '') },
        iconEl('edit'), h('span', { text: t(d.type === 'page' ? 'library.editPage' : 'library.write') }))));
    }
  }

  const decideNow = async () => {
    if (!(await decide(node, d, lang))) return false;
    await redraw();
    return true;
  };
  if (choices) box.append(choiceBox(node, { lang, editable, onPick: () => redraw(), onDecide: decideNow }));

  // Cards of the formulary: run their check on this device, then mark them as verified (0.12.0). With an open
  // convention the check runs with what you picked, and "Mark as checked" becomes "Decide".
  if (CARD_TYPES.has(d.type) && d.type !== 'topic') {
    if (choices && !choices.complete) {
      if (runParts(node).check) {
        box.append(h('div', { class: 'btn-row card-run' },
          h('button', { type: 'button', class: 'btn small', disabled: true }, iconEl('check'), h('span', { text: t('run.check') })),
          h('span', { class: 'muted small', text: t('choice.pickToRun') })));
      }
    } else {
      const run = runControls(choices ? pickedNode(node, choices) : node, {
        canVerify: () => editable && (choices ? true : !d.verified),
        verifyText: choices ? t('choice.decide') : null,
        onVerify: choices ? decideNow : async () => {
          if (!(await changeVerified(path, true))) return false;
          await redraw();
          return true;
        },
        nodeLink: onNodeLink,
        canChange: () => editable && !choices,
        onTakeOver: (which, text) => takeOver(path, which, text),
        redraw,
      });
      if (run) box.append(h('div', { class: 'btn-row card-run' }, ...run.buttons), run.panel);
    }
  }

  // Body in the chosen language; the spots of an open convention show what you picked
  box.append(renderMarkdown(localize(choices ? markSpots(node.body, choices.pick) : node.body, lang), { onCopy: (text) => copyWithToast(text), onNodeLink }));

  // Formulary: symbols, follows from, leads to, conventions; for a topic the cards its text does not name
  box.append(...cardSections(node, d, lang));

  if (libInfo && d.type === 'library') {
    const pageLink = (sl) => { const p = nodeBySlug(sl); return p ? h('a', { href: nodeHref(p.path), text: nodeTitle(p, lang) }) : h('span', { class: 'muted', text: sl }); };
    box.append(h('ol', { class: 'lb-contents' }, ...libInfo.chapters.map((c) => h('li', {}, h('strong', { text: c.title }),
      c.pages.length ? h('ol', {}, ...c.pages.map((sl) => h('li', {}, pageLink(sl)))) : h('p', { class: 'muted small', text: t('library.chapter.empty') })))));
  }
  if (libInfo && d.type === 'page' && (libInfo.prev || libInfo.next)) {
    const step = (sl, key, cls) => { const p = sl && nodeBySlug(sl); return p ? h('a', { class: `btn small ${cls}`, href: nodeHref(p.path) }, h('span', { text: `${t(key)}: ${nodeTitle(p, lang)}` })) : h('span'); };
    box.append(h('nav', { class: 'lb-steps' }, step(libInfo.prev, 'library.prev', 'lb-prev'), step(libInfo.next, 'library.next', 'lb-next')));
  }

  // Related nodes (without the ones listed above)
  const elsewhere = shownElsewhere(node, d);
  const related = linksOf(node).filter((slug) => !elsewhere.has(slug)).map((slug) => nodeBySlug(slug)).filter((n) => n && n.path !== path);
  if (related.length) {
    box.append(h('h2', { text: t('node.related') }),
      h('div', { class: 'related' }, related.map((n) => h('a', { class: 'related-link', href: nodeHref(n.path) }, typeTile(n.type, 'small'), h('span', { text: nodeTitle(n, lang) })))));
  }

  // Sources with links and the exact place
  const sources = sourcesOf(node.meta);
  box.append(h('h2', { text: t('node.sources') }));
  if (sources.length) {
    box.append(h('ol', { class: 'sources' }, sources.map((s) => h('li', {},
      s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.title }) : h('span', { text: s.title }),
      s.at ? h('span', { class: 'muted', text: ` · ${s.at}` }) : null))));
  } else {
    box.append(h('p', { class: 'muted small', text: t('node.noSources') }));
  }

  // Other names, file and GitHub
  const foot = h('footer', { class: 'node-foot' });
  if (d.aliases.length) foot.append(h('p', { class: 'muted small' }, h('span', { text: `${t('node.aliases')}: ` }), d.aliases.join(' · ')));
  if (d.tags.length) foot.append(h('p', { class: 'muted small' }, h('span', { text: `${t('node.tags')}: ` }), d.tags.join(' · ')));
  if (editable && node.meta.verified === true) {
    const undo = h('button', { type: 'button', class: 'link-btn unverify-btn', text: t('node.unverify') });
    undo.addEventListener('click', async () => {
      undo.disabled = true;
      if (await changeVerified(path, false)) await redraw();
      else undo.disabled = false;
    });
    foot.append(h('p', { class: 'muted small' }, undo));
  }
  const gh = githubRepo(repoUrl());
  foot.append(h('p', { class: 'muted small' }, h('code', { class: 'path', text: path }),
    gh ? h('a', { class: 'gh-link', href: `https://github.com/${gh.owner}/${gh.name}/blob/HEAD/${path.split('/').map(encodeURIComponent).join('/')}`, target: '_blank', rel: 'noopener noreferrer', text: t('node.onGithub') }) : null));
  box.append(foot);
  // what the node belongs to (0.15.0): its projects, who links to it, what to do next
  if (!node.conflict) main.append(contextBox(d, { go, redraw }));
}

// ------------------------------------------------------------------ Python cheatsheet
export function renderCheatsheet(main, mod, { go }) {
  const head = h('div', { class: 'module-head' },
    iconEl(mod.icon, 'tile big'),
    h('div', {}, h('h1', { class: 'view-title', text: t(`module.${mod.id}.name`) }), h('p', { class: 'lead', text: t(`module.${mod.id}.desc`) })));
  const input = h('input', { class: 'field', type: 'search', placeholder: t('cheatsheet.filter'), 'aria-label': t('cheatsheet.filter'), autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
  const list = h('div', { class: 'snippets' });

  // Which snippets: all, the ones still to check, or the checked ones. Remembered on this device.
  let show = loadPref('cheatsheet.show', 'all');
  const seg = h('div', { class: 'segmented small', role: 'group', 'aria-label': t('cheatsheet.show') });
  const progress = h('div', { class: 'verify-progress' });
  for (const id of ['all', 'open', 'done']) {
    const b = h('button', { type: 'button', dataset: { show: id }, text: t(`cheatsheet.show.${id}`) });
    b.addEventListener('click', () => { show = id; savePref('cheatsheet.show', id); draw(); });
    seg.append(b);
  }
  // Languages (0.15.1): once there are snippets in more than one, chips pick one; a new snippet starts in it.
  let only = loadPref('cheatsheet.lang', '');
  const langs = h('div', { class: 'lang-chips', role: 'group', 'aria-label': t('snippet.field.language') });
  const newBtn = h('button', { type: 'button', class: 'btn small new-snippet', onclick: () => { if (only) savePref('snippet.language', only); go('#/new'); } }, iconEl('plus'), h('span', { text: t('cheatsheet.new') }));
  const tools = h('div', { class: 'cheat-tools' }, seg, progress);
  main.append(head, h('div', { class: 'filter-row' }, iconEl('search'), input), langs, h('div', { class: 'cheat-bar' }, tools, newBtn), list);
  // recipes are built from Python snippets: they show with all languages and with Python
  const inLang = (d) => (d.type === 'snippet' ? !only || d.language === only : !only || only === 'python');
  function drawLangs(all) {
    const count = {};
    for (const d of all) if (d.type === 'snippet') count[d.language] = (count[d.language] || 0) + 1;
    const names = Object.keys(count).sort((a, b) => count[b] - count[a]);
    if (only && !count[only]) only = '';
    langs.hidden = names.length < 2;
    langs.replaceChildren(...['', ...names].map((l) => {
      const b = h('button', { type: 'button', class: `lang-chip${only === l ? ' on' : ''}`, 'aria-pressed': String(only === l), dataset: { lang: l } }, h('span', { text: l ? languageName(l) : t('cheatsheet.show.all') }), l ? h('span', { class: 'count', text: String(count[l]) }) : null);
      b.addEventListener('click', () => { only = l; savePref('cheatsheet.lang', l); draw(); });
      return b;
    }));
  }

  // Checking is for drafts (by Claude or an import). Once none is left, the filter, the bar and the marks go away.
  let checking = true;
  const wanted = (d) => !checking || show === 'all' || (show === 'open' ? !d.verified : d.verified);
  const lead = (d) => {
    const q = input.value.trim();
    const problem = q ? bestProblem(d, q, getLang()) : '';
    return problem ? t('commandbar.solves', { problem }) : nodeLead(d);
  };
  const row = (d) => h('div', { class: 'snip-row' },
    h('a', { class: 'snip-main', href: nodeHref(d.path) },
      h('span', { class: 'snip-title' }, h('span', { text: nodeTitle(d) }),
        !only && d.type === 'snippet' && d.language !== 'python' ? h('span', { class: 'snip-lang', text: languageName(d.language) }) : null,
        !d.verified ? h('span', { class: 'snip-open', text: t('cheatsheet.unverified') }) : null,
        d.source === 'you' ? h('span', { class: 'snip-own', title: t('node.own'), 'aria-label': t('node.own'), html: icon('edit') }) : null),
      h('span', { class: 'snip-lead muted', text: lead(d) })),
    d.code ? h('button', { type: 'button', class: 'icon-btn', title: t('node.copyCode'), 'aria-label': `${t('node.copyCode')}: ${nodeTitle(d)}`, html: icon('copy'), onclick: () => copyWithToast(d.code) }) : null);

  function drawTools(all) {
    const snippets = all.filter((d) => d.source !== 'you');
    checking = snippets.some((d) => !d.verified);
    tools.hidden = !checking;
    for (const b of seg.children) {
      const on = b.dataset.show === show;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    const done = snippets.filter((d) => d.verified).length;
    const pct = snippets.length ? Math.round((done / snippets.length) * 100) : 0;
    progress.replaceChildren(
      h('span', { class: 'meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(snippets.length), 'aria-valuenow': String(done), 'aria-label': t('cheatsheet.progress', { done, total: snippets.length }) },
        h('span', { style: { width: `${pct}%` } })),
      h('span', { class: 'muted small', text: t('cheatsheet.progress', { done, total: snippets.length }) }));
  }

  function draw() {
    const s = indexState();
    list.replaceChildren();
    drawTools(s.ready ? allNodes().filter(inCheatsheet) : []);
    drawLangs(s.ready ? allNodes().filter(inCheatsheet) : []);
    if (!s.ready) { list.append(h('p', { class: 'muted', text: t('commandbar.indexing') })); return; }
    if (!s.hasKnowledge) {
      list.append(h('div', { class: 'card' }, h('p', { class: 'muted', text: t('cheatsheet.noKnowledge') }),
        h('button', { type: 'button', class: 'btn primary', onclick: () => go('#/settings/sync') }, iconEl('settings'), h('span', { text: t('action.setup') }))));
      return;
    }
    const q = input.value.trim();
    if (q) {
      const hits = searchNodes(q, { limit: 200, filter: (d) => inCheatsheet(d) && wanted(d) && inLang(d) });
      list.append(hits.length ? h('div', { class: 'card snip-card' }, hits.map(row)) : h('p', { class: 'muted', text: t('cheatsheet.none') }));
      return;
    }
    const byTitle = (a, b) => nodeTitle(a).localeCompare(nodeTitle(b));
    const recipes = allNodes().filter((d) => d.type === 'recipe' && inCheatsheet(d) && wanted(d) && inLang(d)).sort(byTitle);
    if (recipes.length) {
      list.append(h('section', { class: 'card snip-card recipes' },
        h('h2', {}, h('span', { class: 'icon', html: icon('list') }), t('cheatsheet.recipes'), h('span', { class: 'count', text: String(recipes.length) })),
        h('p', { class: 'muted small recipes-hint', text: t('cheatsheet.recipes.hint') }),
        recipes.map(row)));
    }
    const snippets = allNodes().filter((d) => d.type === 'snippet' && inCheatsheet(d) && wanted(d) && inLang(d));
    const groups = [...new Set([...GROUP_ORDER, ...snippets.map((d) => d.group || 'other')])];
    for (const g of groups) {
      const items = snippets.filter((d) => (d.group || 'other') === g).sort((a, b) => nodeTitle(a).localeCompare(nodeTitle(b)));
      if (!items.length) continue;
      list.append(h('section', { class: 'card snip-card' }, h('h2', {}, groupLabel(g), h('span', { class: 'count', text: String(items.length) })), items.map(row)));
    }
    const view = checking ? show : 'all';
    if (!snippets.length && !recipes.length) list.append(h('p', { class: 'muted', text: t(view === 'done' ? 'cheatsheet.noneDone' : view === 'open' ? 'cheatsheet.noneOpen' : 'cheatsheet.none') }));
  }
  // The filter belongs to this history entry: Back from a node brings it back, a new visit starts empty.
  input.value = history.state?.cheatFilter || '';
  input.addEventListener('input', () => {
    try { history.replaceState({ ...(history.state || {}), cheatFilter: input.value }, ''); } catch { /* ignore */ }
    draw();
  });
  const stop = onIndexChange((s) => { if (!list.isConnected) stop(); else if (!s.building) draw(); });
  draw();
}

// ------------------------------------------------------------------ recently opened, for Home
export function recentList() {
  const items = recentPaths().map((p) => nodeByPath(p)).filter(Boolean).slice(0, 6);
  if (!items.length) return null;
  return h('div', { class: 'recent' }, items.map((d) => h('a', { class: 'related-link', href: nodeHref(d.path) }, typeTile(d.type, 'small'), h('span', { text: nodeTitle(d) }))));
}
