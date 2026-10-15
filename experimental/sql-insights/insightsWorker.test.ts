// Tests for the Insights worker plumbing (feature key sql-insights):
// resultLimits.ts (value/result caps, blob limits), workerCore.ts (the handler
// that runs inside the Web Worker) and insightsClient.ts (queue, timeout,
// terminate, rebuild).
//
// Run from the repo root:
//   node --test experimental/sql-insights/insightsWorker.test.ts
//
// The client is driven with a fake worker and a manual clock, and once with a
// real Node worker thread running workerCore + sql.js, so a runaway query is
// really stopped by terminate().

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import initSqlJs from 'sql.js';
import type { SqlJsStatic } from 'sql.js';

import {
  CELL_CHARS,
  MAX_BLOB_BYTES,
  RESULT_CHARS,
  TITLE_CHARS,
  blobSize,
  cellDisplay,
  clip,
  createRowLimiter,
  limitCell,
} from './resultLimits.ts';
import { createWorkerCore, type LimitedResult, type WorkerReply, type WorkerRequest } from './workerCore.ts';
import { InsightsClient, type Clock, type ClientStatus, type WorkerLike } from './insightsClient.ts';
import { CARDS } from './insightsDb.ts';
import { REPO, loadZipNetwork } from './fixtures.ts';

let SQL: SqlJsStatic;
before(async () => {
  SQL = await initSqlJs();
});

const RUNAWAY_CTE =
  'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c LIMIT 1000000000) SELECT count(*) FROM c';

// ---------------------------------------------------------------------------
// resultLimits
// ---------------------------------------------------------------------------

describe('result limits', () => {
  test('clip keeps short text and never splits a surrogate pair', () => {
    assert.equal(clip('abc', 3), 'abc');
    assert.equal(clip('abcd', 3), 'abc…');
    assert.equal(clip('ab😀cd', 3), 'ab…'); // the emoji is two code units at 2..3
  });

  test('limitCell: blobs become a size, long text is cut to TITLE_CHARS', () => {
    assert.deepEqual(limitCell(null), { value: null, clipped: false });
    assert.deepEqual(limitCell(42), { value: 42, clipped: false });
    assert.deepEqual(limitCell(new Uint8Array(1234)), { value: '<1,234 bytes>', clipped: false });
    const long = limitCell('x'.repeat(TITLE_CHARS + 50));
    assert.equal(long.clipped, true);
    assert.equal((long.value as string).length, TITLE_CHARS + 1);
    assert.ok((long.value as string).endsWith('…'));
    assert.deepEqual(limitCell('x'.repeat(TITLE_CHARS)), { value: 'x'.repeat(TITLE_CHARS), clipped: false });
  });

  test('cellDisplay shows CELL_CHARS and puts the longer value in the tooltip', () => {
    assert.deepEqual(cellDisplay('short'), { text: 'short' });
    assert.deepEqual(cellDisplay(7), { text: '7' });
    const v = 'y'.repeat(CELL_CHARS + 1);
    const d = cellDisplay(v);
    assert.equal(d.text.length, CELL_CHARS + 1);
    assert.ok(d.text.endsWith('…'));
    assert.equal(d.title, v);
  });

  test('row limiter stops at the result budget and counts cut values of kept rows only', () => {
    const lim = createRowLimiter({ titleChars: 10, resultChars: 25 });
    assert.deepEqual(lim.filterRow(['abcdefghijklmnop', 1]), ['abcdefghij…', 1]); // 11 + 1
    assert.deepEqual(lim.filterRow(['abc', null]), ['abc', null]); // 15
    assert.equal(lim.filterRow(['abcdefghijklmnop', 'x']), null); // 15 + 12 > 25
    assert.equal(lim.filterRow(['a']), null); // stays stopped
    assert.equal(lim.clippedCells(), 1);
    assert.equal(lim.clippedTotal(), true);
  });

  test('blobSize follows SQLite (randomblob >= 1, zeroblob >= 0) and refuses huge sizes', () => {
    assert.equal(blobSize('randomblob', 0), 1);
    assert.equal(blobSize('randomblob', -5), 1);
    assert.equal(blobSize('randomblob', null), 1);
    assert.equal(blobSize('zeroblob', -5), 0);
    assert.equal(blobSize('zeroblob', '12'), 12);
    assert.equal(blobSize('zeroblob', 3.9), 3);
    assert.equal(blobSize('randomblob', MAX_BLOB_BYTES), MAX_BLOB_BYTES);
    assert.throws(() => blobSize('randomblob', MAX_BLOB_BYTES + 1), /randomblob\(\) is limited/);
    assert.throws(() => blobSize('zeroblob', 5e8), /zeroblob\(\) is limited/);
  });
});

// ---------------------------------------------------------------------------
// workerCore (real sql.js, in process)
// ---------------------------------------------------------------------------

describe('worker core', () => {
  const N04 = loadZipNetwork('N04_kristine-chua');

  async function readyCore() {
    const core = createWorkerCore(async () => SQL);
    const init = await core.handle({ id: 1, kind: 'init', docs: N04.docs, ctx: N04.ctx });
    assert.equal(init.ok, true);
    let id = 2;
    const q = async (sql: string): Promise<WorkerReply> => core.handle({ id: id++, kind: 'query', sql });
    const rows = async (sql: string): Promise<LimitedResult> => {
      const r = await q(sql);
      assert.equal(r.ok, true, r.ok ? '' : (r as { error: string }).error);
      return (r as { value: LimitedResult }).value;
    };
    return { core, q, rows };
  }

  test('init then every card answers with limited results', async () => {
    const { core, rows } = await readyCore();
    try {
      for (const c of CARDS) {
        const r = await rows(c.sql);
        assert.ok(r.columns.length >= 2, c.id);
        assert.equal(r.clippedTotal, false, c.id);
      }
      const n = await rows('SELECT COUNT(*) FROM connections');
      assert.equal(n.rows[0][0], N04.docs.length);
    } finally {
      core.close();
    }
  });

  test('refusals and SQL errors are told apart; neither is fatal', async () => {
    const { core, q } = await readyCore();
    try {
      const refused = await q('DELETE FROM connections');
      assert.equal(refused.ok, false);
      assert.equal((refused as { refused: boolean }).refused, true);
      assert.equal((refused as { fatal: boolean }).fatal, false);
      const bad = await q('SELECT nope FROM connections');
      assert.equal(bad.ok, false);
      assert.equal((bad as { refused: boolean }).refused, false);
      assert.match((bad as { error: string }).error, /no such column/);
    } finally {
      core.close();
    }
  });

  test('huge randomblob/zeroblob fail fast instead of allocating', async () => {
    const { core, q, rows } = await readyCore();
    try {
      for (const sql of ['SELECT hex(randomblob(500000000))', 'SELECT zeroblob(1000000000)', 'SELECT length(randomblob(1000001))']) {
        const t0 = performance.now();
        const r = await q(sql);
        assert.ok(performance.now() - t0 < 1000, sql);
        assert.equal(r.ok, false, sql);
        assert.match((r as { error: string }).error, /is limited to 1,000,000 bytes/, sql);
      }
      const ok = await rows(
        "SELECT length(randomblob(1000)), length(zeroblob(10)), typeof(randomblob(4)), length(randomblob(0)), hex(zeroblob(2)), randomblob(4) = randomblob(4)"
      );
      assert.deepEqual(ok.rows[0], [1000, 10, 'blob', 1, '0000', 0]);
    } finally {
      core.close();
    }
  });

  test('long values are cut, blobs described, and big results truncated', async () => {
    const { core, rows } = await readyCore();
    try {
      const one = await rows("SELECT printf('%.*c', 5000, 'x') AS v, randomblob(16) AS b");
      assert.equal((one.rows[0][0] as string).length, TITLE_CHARS + 1);
      assert.equal(one.rows[0][1], '<16 bytes>');
      assert.equal(one.clippedCells, 1);
      assert.equal(one.clippedTotal, false);

      const many = await rows(
        "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c LIMIT 400) SELECT printf('%.*c', 1000, 'y') FROM c"
      );
      assert.equal(many.rows.length, RESULT_CHARS / 1000);
      assert.equal(many.clippedTotal, true);
      assert.equal(many.capped, false);
    } finally {
      core.close();
    }
  });

  test('query before init is an error, not a crash', async () => {
    const core = createWorkerCore(async () => SQL);
    const r = await core.handle({ id: 9, kind: 'query', sql: 'SELECT 1' });
    assert.equal(r.ok, false);
    assert.equal(r.id, 9);
  });
});

// ---------------------------------------------------------------------------
// insightsClient with a fake worker and a manual clock
// ---------------------------------------------------------------------------

class ManualClock implements Clock {
  t = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  private next = 1;
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(h: unknown): void {
    this.timers.delete(h as number);
  }
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.t = due[1].at;
      due[1].fn();
    }
    this.t = end;
  }
  pending(): number {
    return this.timers.size;
  }
}

class FakeWorker implements WorkerLike {
  onmessage: ((ev: { data: WorkerReply }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  posted: WorkerRequest[] = [];
  terminated = false;
  postMessage(msg: WorkerRequest): void {
    this.posted.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
  last(): WorkerRequest {
    return this.posted[this.posted.length - 1];
  }
  ok(value: unknown, id = this.last().id): void {
    this.onmessage?.({ data: { id, ok: true, value } as WorkerReply });
  }
  fail(error: string, extra: { refused?: boolean; fatal?: boolean } = {}): void {
    this.onmessage?.({
      data: { id: this.last().id, ok: false, error, refused: extra.refused ?? false, fatal: extra.fatal ?? false },
    });
  }
}

const flush = () => new Promise<void>((r) => setImmediate(r));
const RESULT: LimitedResult = { columns: ['n'], rows: [[1]], capped: false, ms: 1, clippedCells: 0, clippedTotal: false };
const DATA = { wasm: new ArrayBuffer(8), docs: [{ fullName: 'A' }] as never[], ctx: null };
const STOP = 'Query stopped after 5 s';

function setup(opts: { buildTimeoutMs?: number } = {}) {
  const clock = new ManualClock();
  const workers: FakeWorker[] = [];
  const statuses: ClientStatus[] = [];
  const client = new InsightsClient({
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    clock,
    buildTimeoutMs: opts.buildTimeoutMs,
    onStatus: (s) => statuses.push(s),
  });
  return { clock, workers, statuses, client };
}

async function started() {
  const s = setup();
  const init = s.client.init(DATA);
  assert.equal(s.workers.length, 1);
  assert.equal(s.workers[0].last().kind, 'init');
  s.workers[0].ok({ buildMs: 12 });
  assert.deepEqual(await init, { buildMs: 12 });
  return s;
}

describe('insights client', () => {
  test('init posts the docs, context and wasm; queries run one at a time', async () => {
    const { client, workers, statuses } = await started();
    const w = workers[0];
    const first = w.posted[0] as Extract<WorkerRequest, { kind: 'init' }>;
    assert.equal(first.docs, DATA.docs);
    assert.equal(first.wasm, DATA.wasm);

    const a = client.query('SELECT 1', { timeoutMs: 5000, stoppedMessage: STOP });
    const b = client.query('SELECT 2', { timeoutMs: 5000, stoppedMessage: STOP });
    assert.equal(w.posted.length, 2); // only the first query is in flight
    assert.deepEqual(w.last(), { id: w.last().id, kind: 'query', sql: 'SELECT 1' });
    w.ok(RESULT);
    assert.deepEqual(await a, { result: RESULT });
    assert.equal(w.posted.length, 3);
    w.fail('Only read-only queries can run here', { refused: true });
    assert.deepEqual(await b, { error: 'Only read-only queries can run here', refused: true });
    assert.deepEqual(statuses, ['ready']);
  });

  test('a query past its timeout is stopped, the worker terminated and rebuilt, and the next query runs', async () => {
    const { client, workers, statuses, clock } = await started();
    const old = workers[0];
    const slow = client.query(RUNAWAY_CTE, { timeoutMs: 5000, stoppedMessage: STOP });
    const queued = client.query('SELECT 2', { timeoutMs: 5000, stoppedMessage: STOP });

    clock.advance(4999);
    assert.equal(old.terminated, false);
    clock.advance(1);
    assert.deepEqual(await slow, { error: STOP, stopped: true });
    assert.equal(old.terminated, true);
    assert.equal(old.onmessage, null);
    assert.equal(workers.length, 2);
    assert.equal(client.workersCreated, 2);

    // The new worker gets the same docs first; the queued query waits for it.
    const fresh = workers[1];
    assert.equal(fresh.posted.length, 1);
    const re = fresh.posted[0] as Extract<WorkerRequest, { kind: 'init' }>;
    assert.equal(re.kind, 'init');
    assert.equal(re.docs, DATA.docs);
    assert.equal(re.wasm, DATA.wasm);
    assert.deepEqual(statuses, ['ready', 'restarting']);

    // A late answer from the terminated worker is ignored.
    old.onmessage?.({ data: { id: 999, ok: true, value: RESULT } });

    fresh.ok({ buildMs: 3 });
    assert.deepEqual(statuses, ['ready', 'restarting', 'ready']);
    assert.equal(fresh.last().kind, 'query');
    fresh.ok(RESULT);
    assert.deepEqual(await queued, { result: RESULT });
    assert.equal(clock.pending(), 0);
  });

  test('the queued query\'s timer starts when it is sent, not when it is queued', async () => {
    const { client, workers, clock } = await started();
    const w = workers[0];
    const a = client.query('SELECT 1', { timeoutMs: 5000, stoppedMessage: STOP });
    const b = client.query('SELECT 2', { timeoutMs: 5000, stoppedMessage: STOP });
    clock.advance(4000);
    w.ok(RESULT);
    await a;
    clock.advance(4000); // 8 s after b was queued, 4 s after it was sent
    w.ok(RESULT);
    assert.deepEqual(await b, { result: RESULT });
    assert.equal(workers.length, 1);
  });

  test('cards share one deadline; a card whose budget is gone is answered without running', async () => {
    const { client, workers, clock } = await started();
    const deadline = clock.now() + 15_000;
    const msg = 'Stopped: the cards ran for more than 15 s together.';
    const outs = ['A', 'B', 'C'].map((sql) => client.query(sql, { deadline, stoppedMessage: msg }));
    clock.advance(10_000);
    workers[0].ok(RESULT); // A took 10 s
    assert.deepEqual(await outs[0], { result: RESULT });
    clock.advance(5_000); // B hits the shared deadline
    assert.deepEqual(await outs[1], { error: msg, stopped: true });
    assert.equal(workers[0].terminated, true);
    workers[1].ok({ buildMs: 1 }); // rebuild done; C's budget is already gone
    assert.deepEqual(await outs[2], { error: msg, stopped: true });
    assert.equal(workers[1].posted.length, 1, 'C was never sent');
  });

  test('a crashed worker (error event) fails its query and is rebuilt', async () => {
    const { client, workers } = await started();
    const q = client.query('SELECT 1', { timeoutMs: 5000, stoppedMessage: STOP });
    workers[0].onerror?.(new Error('out of memory'));
    const out = await q;
    assert.match(out.error ?? '', /worker stopped/);
    assert.equal(out.stopped, undefined);
    assert.equal(workers[0].terminated, true);
    assert.equal(workers[1].last().kind, 'init');
  });

  test('a fatal reply (wasm trap / RangeError) replaces the worker after answering', async () => {
    const { client, workers } = await started();
    const q = client.query('SELECT 1', { timeoutMs: 5000, stoppedMessage: STOP });
    workers[0].fail('Invalid string length', { fatal: true });
    assert.deepEqual(await q, { error: 'Invalid string length' });
    assert.equal(workers[0].terminated, true);
    assert.equal(workers.length, 2);
  });

  test('a failed rebuild leaves the client broken and answers everything', async () => {
    const { client, workers, clock, statuses } = await started();
    const slow = client.query('slow', { timeoutMs: 5000, stoppedMessage: STOP });
    const queued = client.query('next', { timeoutMs: 5000, stoppedMessage: STOP });
    clock.advance(5000);
    assert.equal((await slow).stopped, true);
    workers[1].fail('boom');
    assert.match((await queued).error ?? '', /could not be restarted: boom/);
    assert.match((await client.query('later', { timeoutMs: 5000, stoppedMessage: STOP })).error ?? '', /could not be restarted/);
    assert.equal(workers[1].terminated, true);
    assert.equal(statuses.at(-1), 'broken');
  });

  test('a first build that times out rejects init', async () => {
    const { client, workers, clock } = setup({ buildTimeoutMs: 1000 });
    const init = client.init(DATA);
    clock.advance(1000);
    await assert.rejects(init, /took longer than 1 s/);
    assert.equal(workers[0].terminated, true);
    assert.equal(client.getStatus(), 'broken');
  });

  test('dispose terminates the worker and answers pending queries', async () => {
    const { client, workers, clock, statuses } = await started();
    const q = client.query('SELECT 1', { timeoutMs: 5000, stoppedMessage: STOP });
    client.dispose();
    assert.deepEqual(await q, { error: 'Insights was closed.' });
    assert.equal(workers[0].terminated, true);
    assert.equal(clock.pending(), 0);
    assert.equal(statuses.at(-1), 'closed');
    assert.deepEqual(await client.query('x', { timeoutMs: 1, stoppedMessage: STOP }), { error: 'Insights was closed.' });
  });
});

// ---------------------------------------------------------------------------
// End to end in a real worker thread: terminate() really stops sql.js
// ---------------------------------------------------------------------------

/** Adapts a Node worker thread running workerCore + sql.js to WorkerLike. */
class NodeThreadWorker implements WorkerLike {
  onmessage: ((ev: { data: WorkerReply }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  private w: Worker;
  constructor() {
    const core = pathToFileURL(path.join(REPO, 'experimental/sql-insights/workerCore.ts')).href;
    const sqljs = import.meta.resolve('sql.js');
    this.w = new Worker(
      `const { parentPort } = require('node:worker_threads');
       (async () => {
         const { createWorkerCore } = await import(${JSON.stringify(core)});
         const initSqlJs = (await import(${JSON.stringify(sqljs)})).default;
         const core = createWorkerCore(() => initSqlJs());
         parentPort.on('message', async (m) => parentPort.postMessage(await core.handle(m)));
       })();`,
      { eval: true }
    );
    this.w.on('message', (data: WorkerReply) => this.onmessage?.({ data }));
    this.w.on('error', (e) => this.onerror?.(e));
  }
  postMessage(msg: WorkerRequest): void {
    this.w.postMessage(msg);
  }
  terminate(): void {
    void this.w.terminate();
  }
}

describe('insights client + real worker thread', () => {
  test('runaway queries are stopped after the timeout and the rebuilt database answers', { timeout: 60_000 }, async () => {
    const { docs, ctx } = loadZipNetwork('N04_kristine-chua');
    const threads: NodeThreadWorker[] = [];
    const client = new InsightsClient({
      createWorker: () => {
        const t = new NodeThreadWorker();
        threads.push(t);
        return t;
      },
    });
    try {
      await client.init({ docs, ctx });
      const count = 'SELECT COUNT(*) AS n FROM connections';
      const before = await client.query(count, { timeoutMs: 5000, stoppedMessage: STOP });
      assert.equal(before.result?.rows[0][0], docs.length);

      for (const sql of [RUNAWAY_CTE, 'SELECT count(*) FROM connections a, connections b, connections c, connections d']) {
        const t0 = performance.now();
        const out = await client.query(sql, { timeoutMs: 1000, stoppedMessage: STOP });
        const ms = performance.now() - t0;
        assert.deepEqual(out, { error: STOP, stopped: true }, sql);
        assert.ok(ms >= 1000 && ms < 3000, `${sql}: ${ms.toFixed(0)} ms`);
        const after = await client.query(count, { timeoutMs: 5000, stoppedMessage: STOP });
        assert.equal(after.result?.rows[0][0], docs.length, 'rebuilt database answers');
      }
      assert.equal(threads.length, 3);

      const blob = await client.query('SELECT hex(randomblob(500000000))', { timeoutMs: 5000, stoppedMessage: STOP });
      assert.match(blob.error ?? '', /randomblob\(\) is limited/);
      assert.equal(threads.length, 3, 'a refused blob does not need a new worker');
    } finally {
      client.dispose();
    }
  });
});
