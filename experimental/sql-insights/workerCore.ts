// experimental/sql-insights/workerCore.ts
//
// EXPERIMENTAL (sql-insights). The message handler that runs inside the
// Insights Web Worker (insights.worker.ts is a thin wrapper around it). It
// owns the one in-memory database of that worker: `init` builds it from the
// docs, `query` runs one read-only statement with the size limits of
// resultLimits.ts. The page never touches sql.js; a runaway query only blocks
// this worker, which the page then terminates (insightsClient.ts).
//
// Pure module (sql.js is passed in), so Node tests run the same handler.

import type { Database, SqlJsStatic } from 'sql.js';
import type { ConnectionDoc } from '../../lib/connectionsStore.ts';
import type { NetworkContext } from '../../lib/connectionFields.ts';
import { QueryRefused, buildInsightsDb, runReadOnlyQuery } from './insightsDb.ts';
import { type Cell, type Limits, DEFAULT_LIMITS, createRowLimiter, installSizeLimits } from './resultLimits.ts';

export type InitRequest = {
  id: number;
  kind: 'init';
  /** The sql.js .wasm bytes (the page loads them from its own bundle); Node tests omit it. */
  wasm?: ArrayBuffer;
  docs: ConnectionDoc[];
  ctx: NetworkContext | null;
};
export type QueryRequest = { id: number; kind: 'query'; sql: string };
export type WorkerRequest = InitRequest | QueryRequest;

export type InitValue = { buildMs: number };

/** A query result as it reaches the page (values already limited). */
export type LimitedResult = {
  columns: string[];
  rows: Cell[][];
  /** True when the query had more than MAX_ROWS rows. */
  capped: boolean;
  ms: number;
  /** Values cut to TITLE_CHARS. */
  clippedCells: number;
  /** True when rows were dropped because the result reached RESULT_CHARS. */
  clippedTotal: boolean;
};

export type WorkerReply =
  | { id: number; ok: true; value: InitValue | LimitedResult }
  | {
      id: number;
      ok: false;
      error: string;
      /** The read-only guard refused the text (nothing ran). */
      refused: boolean;
      /** The worker hit a JS/wasm failure (e.g. memory); the page should replace it. */
      fatal: boolean;
    };

function errorText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return String(e);
}

/** Errors that leave the worker in doubt (out of memory, wasm traps), not SQL errors. */
function isFatal(e: unknown): boolean {
  if (e instanceof RangeError) return true;
  const WA = (globalThis as { WebAssembly?: { RuntimeError?: new (...a: unknown[]) => Error } }).WebAssembly;
  return Boolean(WA?.RuntimeError && e instanceof WA.RuntimeError);
}

export type WorkerCore = {
  handle(msg: WorkerRequest): Promise<WorkerReply>;
  /** Closes the database (tests; a real worker is simply terminated). */
  close(): void;
};

export function createWorkerCore(
  loadSql: (wasm?: ArrayBuffer) => Promise<SqlJsStatic>,
  limits: Limits = DEFAULT_LIMITS
): WorkerCore {
  let db: Database | null = null;
  const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  async function handle(msg: WorkerRequest): Promise<WorkerReply> {
    const id = msg?.id ?? -1;
    try {
      if (msg.kind === 'init') {
        const SQL = await loadSql(msg.wasm);
        db?.close();
        db = null;
        const t0 = now();
        const built = buildInsightsDb(SQL, msg.docs, msg.ctx);
        installSizeLimits(built);
        db = built;
        return { id, ok: true, value: { buildMs: now() - t0 } };
      }
      if (msg.kind === 'query') {
        if (!db) throw new Error('The database is not ready yet.');
        const limiter = createRowLimiter(limits);
        const r = runReadOnlyQuery(db, msg.sql, undefined, limiter.filterRow);
        const value: LimitedResult = {
          columns: r.columns,
          rows: r.rows as Cell[][],
          capped: r.capped,
          ms: r.ms,
          clippedCells: limiter.clippedCells(),
          clippedTotal: limiter.clippedTotal(),
        };
        return { id, ok: true, value };
      }
      throw new Error('Unknown request.');
    } catch (e) {
      return { id, ok: false, error: errorText(e), refused: e instanceof QueryRefused, fatal: isFatal(e) };
    }
  }

  return {
    handle,
    close() {
      db?.close();
      db = null;
    },
  };
}
