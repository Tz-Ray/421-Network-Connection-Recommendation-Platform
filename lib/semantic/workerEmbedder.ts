// lib/semantic/workerEmbedder.ts
//
// Browser embedder backed by embed.worker.ts. Loaded by a dynamic import() from
// the "Meaning-based search" toggle when it is turned on, so this chunk, the
// worker and transformers.js inside it are never downloaded or created otherwise.
// The bookkeeping (timeouts, dead state) lives in engine.ts.

import { createEngine } from './engine.ts';
import type { EngineOptions, SemanticEngine, SemanticStatus } from './engine.ts';
import EmbedWorker from './embed.worker.ts?worker&inline';

export type { SemanticEngine, SemanticStatus } from './engine.ts';

export function createSemanticEngine(onStatus: (s: SemanticStatus) => void, opts?: EngineOptions): SemanticEngine {
  return createEngine(() => new EmbedWorker(), onStatus, opts);
}
