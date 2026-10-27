// lib/semantic/engine.test.ts — node --test lib/semantic/engine.test.ts
// The browser engine's request bookkeeping with a fake worker (no model, no network):
// a dead worker, a stalled load or a slow embedding must reject, never hang.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from './engine.ts';
import type { SemanticStatus, WorkerLike } from './engine.ts';
import type { WorkerRequest, WorkerResponse } from './embed.worker.ts';

type FakeWorker = WorkerLike & {
  posted: WorkerRequest[];
  terminated: boolean;
  reply(msg: WorkerResponse): void;
  fail(message: string): void;
};

function fakeWorker(): FakeWorker {
  const w: FakeWorker = {
    onmessage: null,
    onerror: null,
    posted: [],
    terminated: false,
    postMessage(msg) {
      if (this.terminated) return; // a terminated Worker silently drops messages
      this.posted.push(msg);
    },
    terminate() {
      this.terminated = true;
    },
    reply(msg) {
      if (!this.terminated) this.onmessage?.({ data: msg } as MessageEvent<WorkerResponse>);
    },
    fail(message) {
      this.onerror?.({ message } as ErrorEvent);
    },
  };
  return w;
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const rows = [{ Position: 'Chef', Company: 'Bistro' }];

/** Answers load and embed requests like the real worker, with 2-d vectors. */
function autoReply(w: FakeWorker) {
  const post = w.postMessage.bind(w);
  w.postMessage = (msg) => {
    post(msg);
    queueMicrotask(() => {
      if (msg.type === 'load') w.reply({ type: 'loaded', id: msg.id });
      else w.reply({ type: 'embedded', id: msg.id, data: new Float32Array(msg.texts.flatMap(() => [1, 0])), dims: 2, count: msg.texts.length });
    });
  };
}

test('a worker error rejects pending requests and every later one at once', async () => {
  const w = fakeWorker();
  const statuses: SemanticStatus[] = [];
  const eng = createEngine(() => w, (s) => statuses.push(s), { loadStallMs: 10_000 });
  const load = eng.warmUp();
  w.fail('boom');
  await assert.rejects(load, /boom/);
  assert.equal(eng.dead, true);
  assert.equal(w.terminated, true);
  assert.deepEqual(statuses.at(-1), { kind: 'error', message: 'boom' });
  const posted = w.posted.length;
  await assert.rejects(eng.warmUp(), /boom/);
  await assert.rejects(eng.ranker(rows, 'chef', false, null), /boom/);
  assert.equal(w.posted.length, posted, 'nothing is posted to a dead worker');
});

test('dispose rejects pending and later requests, without an error status', async () => {
  const w = fakeWorker();
  const statuses: SemanticStatus[] = [];
  const eng = createEngine(() => w, (s) => statuses.push(s), { loadStallMs: 10_000 });
  const search = eng.ranker(rows, 'chef', false, null);
  eng.dispose();
  await assert.rejects(search, /turned off/);
  await assert.rejects(eng.ranker(rows, 'chef', false, null), /turned off/);
  assert.equal(w.terminated, true);
  assert.ok(!statuses.some((s) => s.kind === 'error'));
});

test('a load with no progress times out, terminates the worker and rejects the search', async () => {
  const w = fakeWorker();
  const statuses: SemanticStatus[] = [];
  const eng = createEngine(() => w, (s) => statuses.push(s), { loadStallMs: 30 });
  const t0 = Date.now();
  await assert.rejects(eng.ranker(rows, 'chef', false, null), /stalled/);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(w.terminated, true);
  assert.equal(statuses.at(-1)?.kind, 'error');
});

test('download progress keeps a slow load alive; a stall after it still times out', async () => {
  const w = fakeWorker();
  const eng = createEngine(() => w, () => {}, { loadStallMs: 40 });
  const load = eng.warmUp();
  let settled = false;
  load.then(
    () => (settled = true),
    () => (settled = true)
  );
  for (let i = 0; i < 4; i++) {
    await tick(20);
    w.reply({ type: 'progress', status: 'progress', file: 'onnx/model_quantized.onnx', loaded: i, total: 10 });
  }
  assert.equal(settled, false, '80 ms in total, but never 40 ms without progress');
  await assert.rejects(load, /stalled/);
});

test('an embedding batch that never answers times out', async () => {
  const w = fakeWorker();
  const post = w.postMessage.bind(w);
  w.postMessage = (msg) => {
    post(msg);
    if (msg.type === 'load') queueMicrotask(() => w.reply({ type: 'loaded', id: msg.id }));
    // embed requests are swallowed
  };
  const eng = createEngine(() => w, () => {}, { embedTimeoutMs: 30 });
  await assert.rejects(eng.ranker(rows, 'chef', false, null), /embedding timed out/);
  assert.equal(eng.dead, true);
  assert.equal(w.terminated, true);
});

test('a healthy worker ranks and leaves no timer running', async () => {
  const w = fakeWorker();
  autoReply(w);
  const statuses: SemanticStatus[] = [];
  const eng = createEngine(() => w, (s) => statuses.push(s), { loadStallMs: 50, embedTimeoutMs: 50 });
  const out = await eng.ranker(rows, 'chef', false, null);
  assert.ok(out.ranked.length >= 1);
  await tick(80); // past both timeouts: nothing fires
  assert.equal(eng.dead, false);
  assert.ok(!statuses.some((s) => s.kind === 'error'));
  eng.dispose();
});
