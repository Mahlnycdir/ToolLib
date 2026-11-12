// Deleting a node from where it shows (0.15.2). The file goes, and so does every list that names it: the projects it
// belongs to, the research folders it sits in, the chapter of its library. Text that links to it keeps the link (it
// then leads nowhere). Until you leave, "Undo" puts the file and its places back.
import { deleteNode, readNodeText, writeNode } from './nodes.js';
import { allNodes, forgetNode, nodeByPath, refreshNode } from './search.js';
import { noteChange } from './sync.js';
import { announce } from './channel.js';
import { addToProject, focusPath, projectsWith, removeFromProject, setFocus } from './projects.js';
import { addToFolder, foldersWith, removeFromFolder } from './research-store.js';
import { libraries, loadLibrary, placePage, unlistPage } from './library-store.js';
import { forget } from './trail.js';

// A library goes with all its pages: that is asked and done in the library.
export const DELETED_ELSEWHERE = new Set(['library']);

const slugOfPath = (path) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');

// What else changes when the node goes: { projects, folders, library, linkedFrom }, each a list of index entries.
export function whatGoes(path) {
  const d = nodeByPath(path);
  const slug = d?.slug || slugOfPath(path);
  const projects = projectsWith(slug);
  const folders = foldersWith(slug);
  const library = d?.type === 'page' ? libraries().filter((l) => l.slug === d.library) : [];
  const listed = new Set([...projects, ...folders, ...library].map((x) => x.path));
  const linkedFrom = allNodes().filter((x) => x.path !== path && !listed.has(x.path) && !x.conflict && (x.links || []).includes(slug));
  return { projects, folders, library, linkedFrom };
}

// Deletes the node and takes it out of its lists. Returns undo(), which writes it back where it was.
export async function removeNode(path) {
  const d = nodeByPath(path);
  const slug = d?.slug || slugOfPath(path);
  const text = await readNodeText(path);
  const { projects, folders, library } = whatGoes(path);
  let place = null;
  for (const lib of library) {
    const l = await loadLibrary(lib.path);
    const at = l.chapters.findIndex((c) => c.pages.includes(slug));
    if (at >= 0) place = { lib: lib.path, chapter: at, index: l.chapters[at].pages.indexOf(slug) };
  }
  const wasFocus = focusPath() === path;
  for (const p of projects) await removeFromProject(p.path, slug);
  for (const f of folders) await removeFromFolder(f.path, slug);
  if (place) await unlistPage(place.lib, slug);
  await deleteNode(path);
  forgetNode(path);
  forget(path);
  if (wasFocus) setFocus('');
  await noteChange(path, 'removed');
  announce([path]);
  return async function undo() {
    await writeNode(path, text);
    await refreshNode(path);
    await noteChange(path, 'edited');
    for (const p of projects) await addToProject(p.path, [slug]);
    for (const f of folders) await addToFolder(f.path, slug);
    if (place) await placePage(place.lib, slug, place.chapter, place.index);
    if (wasFocus) setFocus(path);
    announce([path]);
  };
}

