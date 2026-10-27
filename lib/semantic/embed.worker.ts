// lib/semantic/embed.worker.ts
//
// The browser embedding worker for meaning-based search: runs transformers.js
// (onnxruntime-web, WebAssembly) off the main thread. Created by
// workerEmbedder.ts only after the user turns "Meaning-based search" on.
// Network: the public model files from the Hugging Face Hub and the public ONNX
// Runtime WebAssembly files from the jsDelivr CDN (onnxruntime-web@<installed
// version>, see model.ts), each cached by the browser (Cache API). Connection
// data never leaves this worker.

import { env, pipeline } from '@huggingface/transformers';
import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import { MODEL_DTYPE, MODEL_ID, MODEL_REVISION } from './model.ts';

export type WorkerRequest = { type: 'load'; id: number } | { type: 'embed'; id: number; texts: string[] };
export type WorkerResponse =
  | { type: 'progress'; status: string; file?: string; loaded?: number; total?: number }
  | { type: 'loaded'; id: number }
  | { type: 'embedded'; id: number; data: Float32Array; dims: number; count: number }
  | { type: 'error'; id: number; message: string };

env.allowLocalModels = false;

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(msg, transfer);

let extractor: Promise<FeatureExtractionPipeline> | null = null;
function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractor) {
    extractor = pipeline('feature-extraction', MODEL_ID, {
      dtype: MODEL_DTYPE,
      revision: MODEL_REVISION,
      device: 'wasm',
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) =>
        post({ type: 'progress', status: p.status, file: p.file, loaded: p.loaded, total: p.total }),
    }) as Promise<FeatureExtractionPipeline>;
    extractor.catch(() => {
      extractor = null; // allow a retry after a failed download
    });
  }
  return extractor;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    const ex = await getExtractor();
    if (msg.type === 'load') {
      post({ type: 'loaded', id: msg.id });
      return;
    }
    const out = await ex(msg.texts, { pooling: 'mean', normalize: true });
    const data = (out.data as Float32Array).slice();
    const dims = out.dims[out.dims.length - 1];
    post({ type: 'embedded', id: msg.id, data, dims, count: msg.texts.length }, [data.buffer]);
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
