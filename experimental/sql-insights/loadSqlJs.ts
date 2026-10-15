// experimental/sql-insights/loadSqlJs.ts
//
// EXPERIMENTAL (sql-insights). Provides the sql.js .wasm bytes from this app's
// own bundle, never a CDN. The page hands them to the Insights worker, which
// instantiates sql.js with them (insights.worker.ts). Only the lazily loaded
// Insights screen imports this file.
//
// The .wasm is imported with `?url&inline` (a data URL inside this module's lazy
// chunk), not plain `?url`: Vite emits a `?url` asset as soon as the module is loaded
// into the graph, which happens even when the flag is off and the dynamic
// import is dead code, so plain `?url` would put the .wasm file into the production
// dist/. Inlined, it lives in the experimental JS chunk, which the production
// build tree-shakes away together with the screen.

import wasmDataUrl from 'sql.js/dist/sql-wasm-browser.wasm?url&inline';

function dataUrlToBytes(url: string): Uint8Array {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

let bytes: ArrayBuffer | null = null;

/** The .wasm bytes, decoded once per page load. Each worker gets its own copy (postMessage clones it). */
export function loadSqlWasm(): ArrayBuffer {
  if (!bytes) bytes = dataUrlToBytes(wasmDataUrl).buffer as ArrayBuffer;
  return bytes;
}
