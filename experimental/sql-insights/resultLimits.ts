// experimental/sql-insights/resultLimits.ts
//
// EXPERIMENTAL (sql-insights). Size limits for the Insights SQL box, so a
// query that produces huge values can neither freeze the page nor ship
// megabytes to it:
//   - each kept text value is cut to TITLE_CHARS in the worker (the table shows
//     CELL_CHARS of it; the rest is in the cell's tooltip),
//   - one result carries at most RESULT_CHARS characters of values (rows after
//     that are dropped and the result says so),
//   - randomblob()/zeroblob() are replaced by versions that refuse more than
//     MAX_BLOB_BYTES (the built-ins would allocate up to 1 GB first).
// Anything else that runs too long or runs out of memory is stopped by the
// worker timeout (insightsClient.ts).
//
// Pure module: no React, no DOM; Node tests import it directly.

import type { Database, SqlValue } from 'sql.js';

/** Characters of a value shown in a table cell. */
export const CELL_CHARS = 200;
/** Characters of a value kept at all (shown in the cell's tooltip). */
export const TITLE_CHARS = 2_000;
/** Characters of values kept per result. */
export const RESULT_CHARS = 200_000;
/** Largest randomblob()/zeroblob() allowed. */
export const MAX_BLOB_BYTES = 1_000_000;

/** A value as it reaches the page: blobs are already described as text. */
export type Cell = string | number | null;

export type Limits = { titleChars: number; resultChars: number };
export const DEFAULT_LIMITS: Limits = { titleChars: TITLE_CHARS, resultChars: RESULT_CHARS };

/** Cuts `s` to `max` characters plus '…' (never splitting a surrogate pair). */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = max;
  const c = s.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end -= 1;
  return `${s.slice(0, end)}…`;
}

/** One SQL value made safe to keep: blobs become `<N bytes>`, long text is cut. */
export function limitCell(v: SqlValue | bigint, titleChars: number = TITLE_CHARS): { value: Cell; clipped: boolean } {
  if (v === null) return { value: null, clipped: false };
  if (typeof v === 'number') return { value: v, clipped: false };
  if (typeof v === 'bigint') return { value: v.toString(), clipped: false };
  if (v instanceof Uint8Array) return { value: `<${v.length.toLocaleString('en-US')} bytes>`, clipped: false };
  const s = String(v);
  return s.length > titleChars ? { value: clip(s, titleChars), clipped: true } : { value: s, clipped: false };
}

export type RowLimiter = {
  /** Pass to runReadOnlyQuery as `filterRow`. */
  filterRow: (row: SqlValue[]) => Cell[] | null;
  /** Values cut to titleChars among the kept rows. */
  clippedCells: () => number;
  /** True when rows were dropped because the result reached resultChars. */
  clippedTotal: () => boolean;
};

/** Per-query limiter: cuts each value and stops once the result is full. */
export function createRowLimiter(limits: Limits = DEFAULT_LIMITS): RowLimiter {
  let used = 0;
  let clippedCells = 0;
  let clippedTotal = false;
  return {
    filterRow(row) {
      if (clippedTotal) return null;
      let size = 0;
      let clipped = 0;
      const out = row.map((v) => {
        const c = limitCell(v, limits.titleChars);
        if (c.clipped) clipped++;
        if (c.value !== null) size += typeof c.value === 'string' ? c.value.length : String(c.value).length;
        return c.value;
      });
      if (used + size > limits.resultChars) {
        clippedTotal = true;
        return null;
      }
      used += size;
      clippedCells += clipped;
      return out;
    },
    clippedCells: () => clippedCells,
    clippedTotal: () => clippedTotal,
  };
}

/** What a table cell shows, and its tooltip when the value is longer. */
export function cellDisplay(v: Cell, cellChars: number = CELL_CHARS): { text: string; title?: string } {
  const s = v === null ? '' : String(v);
  return s.length > cellChars ? { text: clip(s, cellChars), title: s } : { text: s };
}

/** SQLite's integer reading of a function argument (NULL and junk are 0). */
function intArg(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : 0;
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Size randomblob(N)/zeroblob(N) would produce, or an error past maxBytes. */
export function blobSize(name: 'randomblob' | 'zeroblob', arg: unknown, maxBytes: number = MAX_BLOB_BYTES): number {
  const n = intArg(arg);
  const size = name === 'randomblob' ? Math.max(1, n) : Math.max(0, n);
  if (size > maxBytes) {
    throw new Error(`${name}() is limited to ${maxBytes.toLocaleString('en-US')} bytes here`);
  }
  return size;
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  // getRandomValues fills at most 65,536 bytes per call.
  for (let i = 0; i < n; i += 65_536) globalThis.crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65_536)));
  return out;
}

/**
 * Replaces randomblob() and zeroblob() on this connection with versions that
 * refuse sizes over maxBytes (application functions take precedence over
 * SQLite's built-ins of the same name and argument count).
 */
export function installSizeLimits(db: Database, maxBytes: number = MAX_BLOB_BYTES): void {
  // sql.js passes a thrown value to sqlite3_result_error as text: an Error
  // object arrives as just "Error", so rethrow its message.
  const sized = (name: 'randomblob' | 'zeroblob', n: unknown): number => {
    try {
      return blobSize(name, n, maxBytes);
    } catch (e) {
      throw e instanceof Error ? e.message : e;
    }
  };
  db.create_function('randomblob', (n: unknown) => randomBytes(sized('randomblob', n)));
  db.create_function('zeroblob', (n: unknown) => new Uint8Array(sized('zeroblob', n)));
}
