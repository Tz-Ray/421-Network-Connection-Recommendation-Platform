// lib/semantic/engine.ts
//
// The browser engine of meaning-based search, around an
// embedding worker: request/response bookkeeping, timeouts and the "dead" state.
// It takes the worker from a factory so Node tests can drive it with a fake
// (engine.test.ts); workerEmbedder.ts passes the real embed.worker.ts.
//
// A request never hangs: once the worker errors, times out or the engine is
// disposed, the engine is dead, the worker is terminated, and every pending and
// later request rejects at once. The caller (SemanticSearchToggle) then falls back
// to the lexical ranking and may start a fresh engine.

import { MODEL_ID } from './model.ts';
import { EmbeddingStore } from './store.ts';
import type { EmbedProgress } from './store.ts';
import { createSemanticRanker } from './semanticRank.ts';
import type { Embedder, SemanticRanker } from './types.ts';
import type { WorkerRequest, WorkerResponse } from './embed.worker.ts';

export type SemanticStatus =
  | { kind: 'loading-model'; loaded?: number; total?: number }
  | { kind: 'embedding'; done: number; total: number }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

export type SemanticEngine = {
  ranker: SemanticRanker;
  /** Starts the model download / load now (the first search would otherwise do it). */
  warmUp(): Promise<void>;
  /** True once the worker failed, timed out or was disposed; every request then rejects at once. */
  readonly dead: boolean;
  dispose(): void;
};

/** The part of a Worker the engine uses. */
export type WorkerLike = {
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  postMessage(msg: WorkerRequest): void;
  terminate(): void;
};

export type EngineOptions = {
  /**
   * Model load fails after this long without any download progress (a stalled
   * Hub/jsDelivr download), not after this long in total, so a slow but moving
   * first download still completes. Default 60 s.
   */
  loadStallMs?: number;
  /** One embedding batch (32 texts) fails after this long. Default 30 s. */
  embedTimeoutMs?: number;
  batchSize?: number;
};

export const LOAD_STALL_MS = 60_000;
export const EMBED_TIMEOUT_MS = 30_000;

type Pending = {
  kind: 'load' | 'embed';
  resolve: (v: Float32Array[] | null) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export function createEngine(
  makeWorker: () => WorkerLike,
  onStatus: (s: SemanticStatus) => void,
  opts: EngineOptions = {}
): SemanticEngine {
  const loadStallMs = opts.loadStallMs ?? LOAD_STALL_MS;
  const embedTimeoutMs = opts.embedTimeoutMs ?? EMBED_TIMEOUT_MS;
  const worker = makeWorker();
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let modelReady = false;
  let dead: Error | null = null;
  const fileBytes = new Map<string, { loaded: number; total: number }>();

  /** Terminates the worker and rejects every pending request; later requests reject at once. */
  const kill = (err: Error, report: boolean) => {
    if (dead) return;
    dead = err;
    try {
      worker.terminate();
    } catch {
      /* already gone */
    }
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    pending.clear();
    if (report) onStatus({ kind: 'error', message: err.message });
  };

  const arm = (id: number, kind: Pending['kind']) =>
    setTimeout(
      () =>
        kill(
          new Error(
            kind === 'load'
              ? `loading the model stalled (no download progress for ${Math.round(loadStallMs / 1000)} s)`
              : `embedding timed out after ${Math.round(embedTimeoutMs / 1000)} s`
          ),
          true
        ),
      kind === 'load' ? loadStallMs : embedTimeoutMs
    );

  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    if (dead) return;
    const msg = e.data;
    if (msg.type === 'progress') {
      // Download progress keeps a load alive: re-arm the stall timer.
      for (const [id, p] of pending) {
        if (p.kind !== 'load') continue;
        clearTimeout(p.timer);
        p.timer = arm(id, 'load');
      }
      if (modelReady) return;
      if (msg.file && typeof msg.total === 'number' && msg.total > 0) {
        fileBytes.set(msg.file, { loaded: msg.loaded ?? 0, total: msg.total });
      }
      let loaded = 0;
      let total = 0;
      for (const f of fileBytes.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      onStatus(total > 0 ? { kind: 'loading-model', loaded, total } : { kind: 'loading-model' });
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.type === 'error') {
      p.reject(new Error(msg.message));
    } else if (msg.type === 'loaded') {
      p.resolve(null);
    } else {
      const out: Float32Array[] = [];
      for (let i = 0; i < msg.count; i++) out.push(msg.data.subarray(i * msg.dims, (i + 1) * msg.dims));
      p.resolve(out);
    }
  };
  worker.onerror = (e) => {
    kill(new Error(e?.message || 'the semantic search worker failed'), true);
  };

  const request = (body: { type: 'load' } | { type: 'embed'; texts: string[] }) =>
    new Promise<Float32Array[] | null>((resolve, reject) => {
      if (dead) {
        reject(dead);
        return;
      }
      const id = nextId++;
      pending.set(id, { kind: body.type, resolve, reject, timer: arm(id, body.type) });
      try {
        worker.postMessage({ ...body, id } as WorkerRequest);
      } catch (err) {
        kill(err instanceof Error ? err : new Error(String(err)), true);
      }
    });

  let loading: Promise<void> | null = null;
  const warmUp = (): Promise<void> => {
    if (dead) return Promise.reject(dead);
    if (!loading) {
      onStatus({ kind: 'loading-model' });
      loading = request({ type: 'load' }).then(
        () => {
          modelReady = true;
          onStatus({ kind: 'ready' });
        },
        (err: Error) => {
          loading = null;
          if (!dead) onStatus({ kind: 'error', message: err.message });
          throw err;
        }
      );
    }
    return loading;
  };

  const embedder: Embedder = {
    modelId: MODEL_ID,
    async embed(texts) {
      await warmUp();
      return (await request({ type: 'embed', texts })) ?? [];
    },
  };
  const store = new EmbeddingStore(embedder, opts.batchSize ?? 32);
  const onProgress = (p: EmbedProgress) =>
    onStatus(p.done >= p.total ? { kind: 'ready' } : { kind: 'embedding', done: p.done, total: p.total });

  return {
    ranker: createSemanticRanker(store, undefined, onProgress),
    warmUp,
    get dead() {
      return dead !== null;
    },
    dispose() {
      kill(new Error('Semantic search was turned off.'), false);
    },
  };
}
