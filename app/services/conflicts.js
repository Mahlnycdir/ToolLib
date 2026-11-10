// Conflict copies (0.14.1.1): when both devices changed the same lines, Sync keeps this device's version next to
// the original as "<name>.conflict-<device>-<date>.md". Here you decide: the copy replaces the original, or it goes.
import { deleteNode, readNodeText, writeNode } from './nodes.js';
import { forgetNode, refreshNode } from './search.js';
import { noteChange } from './sync.js';

export const isConflictCopy = (path) => /\.conflict-[a-z0-9-]+(\.[^./]+)?$/.test(path);
export const originalOf = (copy) => copy.replace(/\.conflict-[a-z0-9-]+(\.[^./]+)?$/, '$1');

// The copy becomes the node; the copy itself is removed.
export async function keepCopy(copy) {
  const original = originalOf(copy);
  await writeNode(original, await readNodeText(copy));
  await deleteNode(copy);
  forgetNode(copy);
  await refreshNode(original);
  await noteChange(original, 'edited');
  await noteChange(copy, 'removed');
  return original;
}

// The copy is removed, the original stays as it is.
export async function dropCopy(copy) {
  await deleteNode(copy);
  forgetNode(copy);
  await noteChange(copy, 'removed');
  return originalOf(copy);
}
