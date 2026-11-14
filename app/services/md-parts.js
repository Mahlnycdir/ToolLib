// Parts of a Markdown file (0.28.0, moved here from projects.js): a part is a heading "## <name>" and the lines below
// it up to the next "## ". Projects keep "## Next", "## Notes", "## Calc", "## Time" this way, Start and projects the
// content of their widgets ("## Widget <id>"). Only the lines of one part change, so the sync can join two devices.
//
// For Python readers: like splitting a text at its "## " headings into a dict name → text, but writing back only the
// one entry that changed, line by line.

// Where the part sits: { lines, at (its heading line, or -1), end (the line where the next part starts) }.
export function partOf(text, name) {
  const lines = text.split('\n');
  let fmEnd = 0;
  if (lines[0]?.replace(/^﻿/, '') === '---') { fmEnd = lines.indexOf('---', 1) + 1; }
  const at = lines.findIndex((l, i) => i >= fmEnd && l.trim() === `## ${name}`);
  let end = lines.length;
  if (at >= 0) for (let i = at + 1; i < lines.length; i++) if (/^## /.test(lines[i])) { end = i; break; }
  return { lines, at, end };
}

// The text of a part, without its heading ('' when there is none).
export const partText = (text, name) => { const p = partOf(text, name); return p.at < 0 ? '' : p.lines.slice(p.at + 1, p.end).join('\n').trim(); };

// Puts `body` under "## <name>", in place of what was there; a new part goes to the end of the file.
export function setPart(text, name, body) {
  const p = partOf(text, name);
  const b = String(body).replace(/\s+$/, '');
  if (p.at < 0) return b ? `${text.replace(/\n*$/, '\n')}\n## ${name}\n\n${b}\n` : text;
  const lines = [...p.lines];
  lines.splice(p.at + 1, p.end - p.at - 1, '', ...(b ? b.split('\n') : []), ...(p.end < lines.length ? [''] : []));
  return `${lines.join('\n').replace(/\n*$/, '')}\n`;
}

// Takes the part out, heading and all.
export function removePart(text, name) {
  const p = partOf(text, name);
  if (p.at < 0) return text;
  const lines = [...p.lines];
  lines.splice(p.at, p.end - p.at);
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '')}\n`;
}

// Text you typed must not open a part of its own: a line starting with "## " (or a "---") is indented by one space.
export const keepInPart = (body) => String(body).replace(/^(#{1,6}\s)/gm, ' $1').replace(/^---\s*$/gm, ' ---');
