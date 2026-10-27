// lib/semantic/model.ts
//
// The one model the semantic stage (meaning-based search) uses:
// all-MiniLM-L6-v2 (sentence-transformers, 384 dimensions), ONNX, 8-bit
// quantized, through transformers.js. Public model files, downloaded once from
// the Hugging Face Hub and cached by the library (browser Cache API; in Node a
// folder under node_modules/@huggingface/transformers/.cache/<model>/<revision>).
//
// Pinned to one Hub commit so similarity values cannot drift when the repo's
// `main` moves. MODEL_REVISION is the `sha` the Hub API reported for the repo on
// 2026-10-15 (GET https://huggingface.co/api/models/Xenova/all-MiniLM-L6-v2,
// lastModified 2025-07-22); the files cached before pinning were checked against
// it (onnx/model_quantized.onnx sha256 = the LFS oid at that commit;
// config.json, tokenizer.json, tokenizer_config.json git blob ids match).
// Library caveat (transformers.js 4.3.0, checked in the browser on 2026-10-15):
// pipeline() first reads config.json at `main` and range-probes the files at
// `main` to decide which files to load and to size the progress bar, ignoring
// `revision`; the config, tokenizer and ONNX weights it then loads all come from
// MODEL_REVISION. If `main` ever drops these files, loading fails (Search then
// falls back to lexical) rather than silently using other weights.
//
// Runtime dependency in the browser: onnxruntime-web's WebAssembly files are
// fetched from the jsDelivr CDN (https://cdn.jsdelivr.net/npm/onnxruntime-web@<the
// installed onnxruntime-web version>/dist/), a URL transformers.js builds from
// the version locked in package-lock.json; see vite.config.ts
// (`onnxruntime-web-use-extern-wasm`). Node (benchmark) uses onnxruntime-node.

export const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const MODEL_REVISION = '751bff37182d3f1213fa05d7196b954e230abad9';
export const MODEL_DTYPE = 'q8';
export const EMBED_DIMS = 384;
