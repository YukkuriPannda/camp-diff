import { FileRange } from '../types';

const DIFF_HEADER_PREFIX = 'diff --git ';
const NEW_FILE_PREFIX = '+++ ';
const DEV_NULL = '/dev/null';
const HUNK_PATTERN = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

interface LineRange {
  startLine: number;
  endLine: number;
}

/**
 * Reverses the C-style quoting git applies to paths that contain characters it
 * considers unsafe. Octal escapes are collected as bytes so multi-byte UTF-8
 * names survive even when `core.quotePath` is left at its default.
 */
function unquotePath(value: string): string {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) {
    return value;
  }

  const body = value.slice(1, -1);
  const encoder = new TextEncoder();
  const bytes: number[] = [];

  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== '\\') {
      const char = String.fromCodePoint(body.codePointAt(index) ?? 0);
      index += char.length - 1;
      bytes.push(...encoder.encode(char));
      continue;
    }

    const next = body[index + 1];
    if (next === undefined) {
      break;
    }

    const octal = /^[0-7]{1,3}/.exec(body.slice(index + 1, index + 4));
    if (octal) {
      bytes.push(Number.parseInt(octal[0], 8) & 0xff);
      index += octal[0].length;
      continue;
    }

    index += 1;
    switch (next) {
      case 't':
        bytes.push(0x09);
        break;
      case 'n':
        bytes.push(0x0a);
        break;
      case 'r':
        bytes.push(0x0d);
        break;
      default:
        bytes.push(...encoder.encode(next));
        break;
    }
  }

  return new TextDecoder().decode(new Uint8Array(bytes));
}

function parseNewFilePath(line: string): string | undefined {
  const raw = line.slice(NEW_FILE_PREFIX.length).split('\t')[0];
  if (raw === DEV_NULL) {
    return undefined;
  }
  const unquoted = unquotePath(raw);
  return unquoted.startsWith('b/') ? unquoted.slice(2) : unquoted;
}

/**
 * Hunks are emitted in ascending order per file, so merging only needs to look
 * at the previous range. Ranges that touch are merged as well, because two
 * adjacent hunks describe one contiguous edit for our purposes.
 */
function coalesce(ranges: LineRange[]): LineRange[] {
  const sorted = [...ranges].sort((left, right) => left.startLine - right.startLine);
  const merged: LineRange[] = [];

  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.startLine <= previous.endLine + 1) {
      previous.endLine = Math.max(previous.endLine, range.endLine);
      continue;
    }
    merged.push({ ...range });
  }

  return merged;
}

/**
 * Extracts the line ranges a `git diff --unified=0` patch touches on the new
 * side. Paths are returned exactly as git reported them, so they are relative
 * to the repository root.
 *
 * Only line numbers are read; the added and removed text is discarded here and
 * never leaves this function.
 */
export function parseUnifiedDiffRanges(diff: string): FileRange[] {
  const byPath = new Map<string, LineRange[]>();
  let currentPath: string | undefined;
  let remainingBodyLines = 0;

  for (const rawLine of diff.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    // Inside a hunk body a content line can look exactly like a header
    // (`+++ b/x` is what an added `++ b/x` renders as), so the body is consumed
    // by count before any header is recognised again.
    if (remainingBodyLines > 0) {
      if (line.startsWith('\\')) {
        continue;
      }
      if (line.startsWith('+') || line.startsWith('-')) {
        remainingBodyLines -= 1;
        continue;
      }
      remainingBodyLines = 0;
    }

    if (line.startsWith(DIFF_HEADER_PREFIX)) {
      currentPath = undefined;
      continue;
    }
    if (line.startsWith(NEW_FILE_PREFIX)) {
      currentPath = parseNewFilePath(line);
      continue;
    }

    const hunk = HUNK_PATTERN.exec(line);
    if (!hunk) {
      continue;
    }

    const removedLines = hunk[1] === undefined ? 1 : Number(hunk[1]);
    const newStart = Number(hunk[2]);
    const addedLines = hunk[3] === undefined ? 1 : Number(hunk[3]);
    remainingBodyLines = removedLines + addedLines;

    if (!currentPath) {
      continue;
    }

    const ranges = byPath.get(currentPath) ?? [];
    if (addedLines === 0) {
      // A pure deletion leaves nothing to point at, so the line preceding the
      // removed block is marked instead.
      const line = Math.max(1, newStart);
      ranges.push({ startLine: line, endLine: line });
    } else {
      const startLine = Math.max(1, newStart);
      ranges.push({ startLine, endLine: startLine + addedLines - 1 });
    }
    byPath.set(currentPath, ranges);
  }

  return [...byPath.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([filePath, ranges]) =>
      coalesce(ranges).map((range) => ({ filePath, ...range })),
    );
}
