// experimental/sql-insights/insightsClient.ts
//
// EXPERIMENTAL (sql-insights). The page's side of the Insights Web Worker.
// Requests go through one queue, one at a time, so each request's timer covers
// only its own run. When a request runs past its time (or the worker crashes,
// or reports a fatal error), the client terminate()s the worker, answers that
// request as stopped, and builds a new worker + database from the docs it
// already has; queued requests wait for the rebuild and then run normally.
//
// Pure module: the worker factory and the timers are injected, so Node tests
// drive it with a fake worker.

import type { ConnectionDoc } from '../../lib/connectionsStore.ts';
import type { NetworkContext } from '../../lib/connectionFields.ts';
import type { InitValue, LimitedResult, WorkerReply, WorkerRequest } from './workerCore.ts';

/** The part of a Worker the client uses. */
export type WorkerLike = {
  postMessage(msg: WorkerRequest): void;
  terminate(): void;
  onmessage: ((ev: { data: WorkerReply }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
};

export type Clock = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
};

const realClock: Clock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
};

/** 'restarting': a stopped query's worker is being replaced; 'broken': it could not be. */
export type ClientStatus = 'starting' | 'ready' | 'restarting' | 'broken' | 'closed';

/** Exactly one of `result` / `error` is set. */
export type QueryOutcome = {
  result?: LimitedResult;
  error?: string;
  /** The read-only guard refused the text (nothing ran). */
  refused?: boolean;
  /** The query ran out of time and its worker was replaced. */
  stopped?: boolean;
};

export type QueryOptions = {
  /** Time this query may run once it starts. */
  timeoutMs?: number;
  /** Absolute clock time (Clock.now) by which it must finish; used for the cards' shared budget. */
  deadline?: number;
  /** Error shown when it is stopped. */
  stoppedMessage: string;
};

export type ClientOptions = {
  createWorker: () => WorkerLike;
  clock?: Clock;
  /** Time allowed to build the database (first build and rebuilds). */
  buildTimeoutMs?: number;
  onStatus?: (status: ClientStatus) => void;
};

export type InitData = { wasm?: ArrayBuffer; docs: ConnectionDoc[]; ctx: NetworkContext | null };

/** How a job ended: `value` on success, otherwise `error` (+ why). */
type JobEnd = {
  value?: InitValue | LimitedResult;
  error?: string;
  refused?: boolean;
  /** Ran out of time (its worker was replaced). */
  stopped?: boolean;
};

type Job = {
  kind: 'init' | 'query';
  sql?: string;
  timeoutMs?: number;
  deadline?: number;
  settle: (end: JobEnd) => void;
};

type FailedReply = Extract<WorkerReply, { ok: false }>;

export const DEFAULT_BUILD_TIMEOUT_MS = 60_000;

export class InsightsClient {
  private readonly createWorker: () => WorkerLike;
  private readonly clock: Clock;
  private readonly buildTimeoutMs: number;
  private readonly onStatus?: (status: ClientStatus) => void;

  private worker: WorkerLike | null = null;
  private data: InitData | null = null;
  private queue: Job[] = [];
  private inFlight: { job: Job; id: number; timer: unknown } | null = null;
  private nextId = 1;
  private status: ClientStatus = 'starting';
  private brokenReason = '';
  /** Workers created so far (tests and diagnostics). */
  workersCreated = 0;

  constructor(opts: ClientOptions) {
    this.createWorker = opts.createWorker;
    this.clock = opts.clock ?? realClock;
    this.buildTimeoutMs = opts.buildTimeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS;
    this.onStatus = opts.onStatus;
  }

  getStatus(): ClientStatus {
    return this.status;
  }

  /** Starts the worker and builds the database; keeps `data` for rebuilds. Call once. */
  init(data: InitData): Promise<InitValue> {
    if (this.data) return Promise.reject(new Error('init() was already called.'));
    this.data = data;
    try {
      this.spawn();
    } catch (e) {
      const msg = `Could not start the database worker: ${e instanceof Error ? e.message : String(e)}`;
      this.breakDown(msg);
      return Promise.reject(new Error(msg));
    }
    return new Promise((resolve, reject) => {
      this.queue.unshift({
        kind: 'init',
        timeoutMs: this.buildTimeoutMs,
        settle: (end) => {
          if (end.error === undefined) {
            this.setStatus('ready');
            resolve(end.value as InitValue);
            return;
          }
          const msg = end.stopped
            ? `Building the database took longer than ${Math.round(this.buildTimeoutMs / 1000)} s.`
            : end.error;
          this.breakDown(msg);
          reject(new Error(msg));
        },
      });
      this.pump();
    });
  }

  /** Runs one statement; never rejects. */
  query(sql: string, opts: QueryOptions): Promise<QueryOutcome> {
    if (this.status === 'closed') return Promise.resolve({ error: 'Insights was closed.' });
    if (this.status === 'broken') {
      return Promise.resolve({ error: `The database could not be restarted: ${this.brokenReason}` });
    }
    if (!this.data) return Promise.resolve({ error: 'The database is not ready yet.' });
    return new Promise((resolve) => {
      this.queue.push({
        kind: 'query',
        sql,
        timeoutMs: opts.timeoutMs,
        deadline: opts.deadline,
        settle: (end) => {
          if (end.stopped) resolve({ error: opts.stoppedMessage, stopped: true });
          else if (end.error !== undefined) resolve({ error: end.error, ...(end.refused ? { refused: true } : {}) });
          else resolve({ result: end.value as LimitedResult });
        },
      });
      this.pump();
    });
  }

  /** Terminates the worker and answers everything still waiting. */
  dispose(): void {
    if (this.status === 'closed') return;
    this.setStatus('closed');
    this.killWorker();
    this.failAll('Insights was closed.');
  }

  // ---------------------------------------------------------------------------

  private setStatus(s: ClientStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.onStatus?.(s);
  }

  private spawn(): void {
    const w = this.createWorker();
    this.workersCreated++;
    w.onmessage = (ev) => this.onReply(w, ev.data);
    w.onerror = () => this.onCrash(w);
    this.worker = w;
  }

  private killWorker(): void {
    const w = this.worker;
    this.worker = null;
    if (this.inFlight) {
      this.clock.clearTimeout(this.inFlight.timer);
    }
    if (w) {
      w.onmessage = null;
      w.onerror = null;
      w.terminate();
    }
  }

  private failAll(message: string): void {
    const pending = [...(this.inFlight ? [this.inFlight.job] : []), ...this.queue];
    this.inFlight = null;
    this.queue = [];
    for (const job of pending) job.settle({ error: message });
  }

  private breakDown(reason: string): void {
    if (this.status === 'closed') return;
    this.brokenReason = reason;
    this.killWorker();
    this.setStatus('broken');
    this.failAll(`The database could not be restarted: ${reason}`);
  }

  /** Replaces the worker and queues a rebuild ahead of everything else. */
  private restart(): void {
    this.killWorker();
    this.inFlight = null;
    if (!this.data) return;
    this.setStatus('restarting');
    try {
      this.spawn();
    } catch (e) {
      this.breakDown(`could not start a new worker (${e instanceof Error ? e.message : String(e)}).`);
      return;
    }
    this.queue.unshift({
      kind: 'init',
      timeoutMs: this.buildTimeoutMs,
      settle: (end) => {
        if (end.error === undefined) this.setStatus('ready');
        else this.breakDown(end.stopped ? 'rebuilding took too long.' : end.error);
      },
    });
  }

  private pump(): void {
    while (!this.inFlight && this.worker && this.queue.length) {
      const job = this.queue.shift()!;
      let timeoutMs = job.timeoutMs ?? Infinity;
      if (job.deadline !== undefined) timeoutMs = Math.min(timeoutMs, job.deadline - this.clock.now());
      if (timeoutMs <= 0) {
        // Its budget ran out while it waited: answer without running it.
        job.settle({ error: 'stopped', stopped: true });
        continue;
      }
      const id = this.nextId++;
      const timer = Number.isFinite(timeoutMs) ? this.clock.setTimeout(() => this.onTimeout(id), timeoutMs) : null;
      this.inFlight = { job, id, timer };
      const d = this.data!;
      this.worker.postMessage(
        job.kind === 'init'
          ? { id, kind: 'init', wasm: d.wasm, docs: d.docs, ctx: d.ctx }
          : { id, kind: 'query', sql: job.sql ?? '' }
      );
    }
  }

  private onReply(from: WorkerLike, reply: WorkerReply): void {
    if (from !== this.worker || !this.inFlight || reply?.id !== this.inFlight.id) return;
    const { job, timer } = this.inFlight;
    this.clock.clearTimeout(timer);
    this.inFlight = null;
    if (reply.ok === true) {
      job.settle({ value: reply.value });
    } else {
      const failed = reply as FailedReply;
      // A wasm trap or out-of-memory leaves the worker in doubt: replace it.
      if (failed.fatal && job.kind === 'query') this.restart();
      job.settle({ error: failed.error, refused: failed.refused });
    }
    this.pump();
  }

  private onTimeout(id: number): void {
    if (!this.inFlight || this.inFlight.id !== id) return;
    const { job } = this.inFlight;
    this.inFlight = null;
    if (job.kind === 'init') {
      job.settle({ error: 'stopped', stopped: true });
      return;
    }
    this.restart();
    job.settle({ error: 'stopped', stopped: true });
    this.pump();
  }

  private onCrash(from: WorkerLike): void {
    if (from !== this.worker) return;
    const job = this.inFlight?.job;
    if (this.inFlight) this.clock.clearTimeout(this.inFlight.timer);
    this.inFlight = null;
    if (!job || job.kind === 'query') {
      this.restart();
      job?.settle({ error: 'The database worker stopped (it may have run out of memory); it is being rebuilt.' });
      this.pump();
      return;
    }
    job.settle({ error: 'The database worker stopped while building the database.' });
  }
}
