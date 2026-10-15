// experimental/sql-insights/insights.worker.ts
//
// EXPERIMENTAL (sql-insights). The Insights Web Worker: sql.js and the
// in-memory database live here, off the page's main thread, so a runaway query
// blocks only this worker (the page terminates it after a timeout; see
// insightsClient.ts). All logic is in workerCore.ts.
//
// Only InsightsScreen.tsx imports this file, with Vite's `?worker&inline`, so the
// worker code ends up inside the screen's lazy chunk and a build without
// VITE_EXPERIMENTAL=on contains none of it (a `new Worker(new URL(...))` would
// emit a worker file even from that dead branch).

import initSqlJs from 'sql.js';
import { createWorkerCore, type WorkerReply, type WorkerRequest } from './workerCore';

// The project's TS lib is DOM (not WebWorker); type the bit of the worker scope used here.
const scope = self as unknown as {
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(msg: WorkerReply): void;
};

// The page sends the .wasm bytes from its own bundle with `init`; never a CDN.
const core = createWorkerCore((wasm) => initSqlJs(wasm ? { wasmBinary: wasm } : {}));

scope.onmessage = (ev) => {
  void core.handle(ev.data).then((reply) => scope.postMessage(reply));
};
