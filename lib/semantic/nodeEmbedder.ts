// lib/semantic/nodeEmbedder.ts
//
// Node-only embedder for the benchmark
// (bench/rankers/semantic.ts, bench/semantic_perf.ts): transformers.js on
// onnxruntime-node, in-process. Never imported by the app.

import { env, pipeline } from '@huggingface/transformers';
import { EMBED_DIMS, MODEL_DTYPE, MODEL_ID, MODEL_REVISION } from './model.ts';
import type { Embedder } from './types.ts';

export type NodeEmbedderOptions = { cacheDir?: string };

export async function createNodeEmbedder(opts: NodeEmbedderOptions = {}): Promise<Embedder> {
  if (opts.cacheDir) env.cacheDir = opts.cacheDir;
  const extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: MODEL_DTYPE, revision: MODEL_REVISION });
  return {
    modelId: MODEL_ID,
    async embed(texts: string[]): Promise<Float32Array[]> {
      if (texts.length === 0) return [];
      const out = await extractor(texts, { pooling: 'mean', normalize: true });
      const data = out.data as Float32Array;
      const dims = out.dims[out.dims.length - 1];
      if (dims !== EMBED_DIMS) throw new Error(`expected ${EMBED_DIMS}-d vectors, got ${dims}`);
      return texts.map((_, i) => data.slice(i * dims, (i + 1) * dims));
    },
  };
}
