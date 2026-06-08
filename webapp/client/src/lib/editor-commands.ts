/**
 * Pure selection-transform helpers for the Markdown editor. Each takes the
 * current text + selection and returns the next text + selection, so they're
 * trivially unit-testable and the React component just wires them to buttons
 * and keystrokes.
 */

export interface EditState {
  text: string;
  selStart: number;
  selEnd: number;
}

const UNIT = '  '; // two-space indent step

/** Char range of the full lines the selection touches. */
function lineRange(text: string, selStart: number, selEnd: number): { start: number; end: number } {
  const start = text.lastIndexOf('\n', selStart - 1) + 1;
  let end = text.indexOf('\n', selEnd);
  if (end === -1) end = text.length;
  return { start, end };
}

function splice(text: string, start: number, end: number, insert: string): string {
  return text.slice(0, start) + insert + text.slice(end);
}

/** Wrap (or unwrap) the selection with an inline marker like `**` or `` ` ``. */
export function wrapInline(s: EditState, marker: string, placeholder = ''): EditState {
  const { text, selStart, selEnd } = s;
  const sel = text.slice(selStart, selEnd);
  const ml = marker.length;
  // Markers sit just outside the selection → unwrap them.
  if (sel && text.slice(selStart - ml, selStart) === marker && text.slice(selEnd, selEnd + ml) === marker) {
    return { text: splice(text, selStart - ml, selEnd + ml, sel), selStart: selStart - ml, selEnd: selEnd - ml };
  }
  // Markers are inside the selection → unwrap them.
  if (sel.length >= 2 * ml && sel.startsWith(marker) && sel.endsWith(marker)) {
    const inner = sel.slice(ml, sel.length - ml);
    return { text: splice(text, selStart, selEnd, inner), selStart, selEnd: selStart + inner.length };
  }
  const body = sel || placeholder;
  return {
    text: splice(text, selStart, selEnd, marker + body + marker),
    selStart: selStart + ml,
    selEnd: selStart + ml + body.length,
  };
}

/** Toggle a per-line prefix (e.g. `## `, `- `, `> `) across the selected lines. */
export function toggleLinePrefix(s: EditState, prefix: string): EditState {
  const { text } = s;
  const { start, end } = lineRange(text, s.selStart, s.selEnd);
  const block = text.slice(start, end);
  const lines = block.split('\n');
  const allPrefixed = lines.every((l) => l.trim() === '' || l.startsWith(prefix));
  const out = lines
    .map((l) => (l.trim() === '' ? l : allPrefixed ? l.slice(prefix.length) : prefix + l))
    .join('\n');
  return { text: splice(text, start, end, out), selStart: start, selEnd: end + (out.length - block.length) };
}

/** Toggle an ordered list (`1.`, `2.`, …) across the selected lines. */
export function toggleOrderedList(s: EditState): EditState {
  const { text } = s;
  const { start, end } = lineRange(text, s.selStart, s.selEnd);
  const block = text.slice(start, end);
  const lines = block.split('\n');
  const re = /^\d+\.\s/;
  const allListed = lines.every((l) => l.trim() === '' || re.test(l));
  let n = 0;
  const out = lines
    .map((l) => {
      if (l.trim() === '') return l;
      if (allListed) return l.replace(re, '');
      n += 1;
      return `${n}. ${l}`;
    })
    .join('\n');
  return { text: splice(text, start, end, out), selStart: start, selEnd: end + (out.length - block.length) };
}

/** Wrap the selection as a Markdown link, selecting the URL placeholder. */
export function insertLink(s: EditState): EditState {
  const { text, selStart, selEnd } = s;
  const sel = text.slice(selStart, selEnd);
  // A selected URL becomes the target; cursor lands in the empty label.
  if (sel && /^https?:\/\/\S+$/i.test(sel.trim())) {
    const out = `[](${sel.trim()})`;
    return { text: splice(text, selStart, selEnd, out), selStart: selStart + 1, selEnd: selStart + 1 };
  }
  const label = sel || 'text';
  const out = `[${label}](url)`;
  const urlStart = selStart + label.length + 3; // past "[label]("
  return { text: splice(text, selStart, selEnd, out), selStart: urlStart, selEnd: urlStart + 3 };
}

/** Insert a multi-line block on its own line(s), keeping blank-line separation. */
export function insertBlock(s: EditState, snippet: string): EditState {
  const { text, selStart } = s;
  const before = text.slice(0, selStart);
  const after = text.slice(selStart);
  const pad = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const tail = after.startsWith('\n') || after === '' ? '' : '\n';
  const pos = selStart + pad.length;
  return { text: before + pad + snippet + tail + after, selStart: pos, selEnd: pos + snippet.length };
}

/**
 * Enter inside a list/quote item: continue it with the next marker, or — when
 * the current item is empty — exit the list. Returns null when not in a list
 * (caller should let the textarea insert a normal newline).
 */
export function handleEnter(s: EditState): EditState | null {
  const { text, selStart, selEnd } = s;
  if (selStart !== selEnd) return null;
  const lineStart = text.lastIndexOf('\n', selStart - 1) + 1;
  const line = text.slice(lineStart, selStart);

  const li = /^(\s*)(?:([-*+])|(\d+)\.)\s+(.*)$/.exec(line);
  if (li) {
    const [, indent, bullet, num, content] = li;
    if (content.trim() === '') {
      const pos = lineStart + indent.length;
      return { text: splice(text, lineStart, selStart, indent), selStart: pos, selEnd: pos };
    }
    const marker = bullet ? `${bullet} ` : `${Number(num) + 1}. `;
    const insert = `\n${indent}${marker}`;
    const pos = selStart + insert.length;
    return { text: splice(text, selStart, selEnd, insert), selStart: pos, selEnd: pos };
  }

  const bq = /^(\s*)>\s?(.*)$/.exec(line);
  if (bq) {
    const [, indent, content] = bq;
    if (content.trim() === '') {
      const pos = lineStart + indent.length;
      return { text: splice(text, lineStart, selStart, indent), selStart: pos, selEnd: pos };
    }
    const insert = `\n${indent}> `;
    const pos = selStart + insert.length;
    return { text: splice(text, selStart, selEnd, insert), selStart: pos, selEnd: pos };
  }
  return null;
}

/** Indent (Tab) or outdent (Shift+Tab) the selected lines. */
export function indent(s: EditState, outdent = false): EditState {
  const { text, selStart, selEnd } = s;
  // A bare cursor just inserts a tab-step.
  if (!outdent && selStart === selEnd) {
    const pos = selStart + UNIT.length;
    return { text: splice(text, selStart, selStart, UNIT), selStart: pos, selEnd: pos };
  }
  const { start, end } = lineRange(text, selStart, selEnd);
  const block = text.slice(start, end);
  const out = block
    .split('\n')
    .map((l) => (outdent ? l.replace(/^ {1,2}/, '') : UNIT + l))
    .join('\n');
  return { text: splice(text, start, end, out), selStart: start, selEnd: end + (out.length - block.length) };
}
