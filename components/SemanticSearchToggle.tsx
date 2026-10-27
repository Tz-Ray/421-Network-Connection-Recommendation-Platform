// components/SemanticSearchToggle.tsx
//
// The "Meaning-based search" toggle on the Recommender (lib/semantic/). Its own
// chunk (React.lazy in RecommenderScreen). Off by default for everyone; the
// choice is remembered per browser (localStorage, best effort). Turning it on
// dynamically imports lib/semantic/workerEmbedder, which starts a Web Worker that
// downloads the embedding model once (Hugging Face Hub) and the ONNX Runtime
// WebAssembly (jsDelivr), both cached by the browser, and runs them on this
// device: connection data never leaves the browser. Turning it off stops the
// worker and the Search button goes back to exactly the lexical ranker.

import React, { useEffect, useRef, useState } from 'react';
import { rankConnections } from '../lib/search';
import type { SemanticEngine, SemanticStatus } from '../lib/semantic/workerEmbedder';
import type { SemanticRanker } from '../lib/semantic/types';

/** Per-browser memory of the choice; 'on' or absent. Storage may be unavailable (private mode, blocked). */
const STORAGE_KEY = 'ncrp_meaning_search_v1';

function rememberedOn(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

function remember(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(STORAGE_KEY, 'on');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* not remembered; the toggle still works for this visit */
  }
}

/**
 * One-time download sizes as transferred, measured in Chromium on 2026-10-27: the
 * model at the pinned revision (onnx/model_quantized.onnx 22.97 MB, served
 * uncompressed, + tokenizer and config 0.2 MB) and the ONNX Runtime WebAssembly
 * from jsDelivr (ort-wasm-simd-threaded.asyncify.wasm, 26.9 MB raw, 5.55 MB brotli).
 */
const MODEL_MB = 23;
const RUNTIME_MB = 6;

type Props = {
  /** null = toggle off (lexical search); otherwise the fused ranker the Search button awaits. */
  onChange: (ranker: SemanticRanker | null) => void;
  disabled?: boolean;
};

function describe(s: SemanticStatus | null): string {
  if (!s)
    return `Off by default: Search ranks by keywords only. Turning this on downloads a ~${MODEL_MB} MB model once from Hugging Face (plus ~${RUNTIME_MB} MB of runtime from jsDelivr) and runs it in this browser; your connections never leave your browser.`;
  switch (s.kind) {
    case 'loading-model':
      return s.total
        ? `Loading model… ${Math.round(((s.loaded ?? 0) / s.total) * 100)}% of ${(s.total / 1e6).toFixed(0)} MB (first use only)`
        : 'Loading model…';
    case 'embedding':
      return `Embedding connections… ${s.done}/${s.total}`;
    case 'ready':
      return 'On: results also match by meaning (the model runs in this browser; your connections never leave it).';
    case 'error':
      return `Meaning-based search failed: ${s.message}. Search falls back to keyword ranking.`;
  }
}

const SemanticSearchToggle: React.FC<Props> = ({ onChange, disabled }) => {
  const [on, setOn] = useState(false);
  const [status, setStatus] = useState<SemanticStatus | null>(null);
  const engine = useRef<SemanticEngine | null>(null);
  const generation = useRef(0);

  // Restores a remembered "on" and tears down on unmount. No once-only ref guard:
  // under StrictMode the first mount's cleanup disposes its engine (the generation
  // check drops its late results) and the second mount starts a fresh one.
  useEffect(
    () => {
      if (rememberedOn()) turnOn();
      return () => {
        generation.current += 1;
        engine.current?.dispose();
        engine.current = null;
        onChange(null);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  function turnOn() {
    const gen = ++generation.current;
    remember(true);
    setOn(true);
    setStatus({ kind: 'loading-model' });
    const fail = (err: unknown) => {
      if (gen === generation.current) setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    };
    // The engine module (and its worker) load in the background; the ranker is
    // registered right away and waits for them, so a Search pressed meanwhile is
    // already semantic.
    const start = (): { engine: Promise<SemanticEngine>; failed: boolean } => {
      const attempt = {
        failed: false,
        engine: import('../lib/semantic/workerEmbedder').then(({ createSemanticEngine }) => {
          if (gen !== generation.current) throw new Error('Semantic search was turned off.');
          engine.current?.dispose();
          const eng = createSemanticEngine((s) => {
            if (gen === generation.current && engine.current === eng) setStatus(s);
          });
          engine.current = eng;
          eng.warmUp().catch(() => {
            /* the status line already shows the error */
          });
          return eng;
        }),
      };
      attempt.engine.catch((err) => {
        attempt.failed = true;
        fail(err);
      });
      return attempt;
    };
    let attempt = start();
    // After a failure (worker error, stalled download, timeout) the next Search
    // starts one fresh worker; if that fails too, Search stays lexical until the
    // toggle is switched off and on again. No retry loop.
    let freshStartsLeft = 1;
    // A failed semantic pass never breaks Search: it shows the error here and
    // returns the lexical ranking.
    onChange(async (rows, criteria, strict, ctx) => {
      try {
        const broken = attempt.failed || (engine.current?.dead ?? false);
        if (broken && freshStartsLeft > 0 && gen === generation.current) {
          freshStartsLeft -= 1;
          setStatus({ kind: 'loading-model' });
          attempt = start();
        }
        const result = await (await attempt.engine).ranker(rows, criteria, strict, ctx);
        if (gen === generation.current) setStatus({ kind: 'ready' });
        return result;
      } catch (err) {
        fail(err);
        return rankConnections(rows, criteria, strict, ctx);
      }
    });
  }

  function turnOff() {
    generation.current += 1;
    remember(false);
    onChange(null);
    engine.current?.dispose();
    engine.current = null;
    setOn(false);
    setStatus(null);
  }

  const busy = status?.kind === 'loading-model' || status?.kind === 'embedding';
  return (
    <div data-feature="semantic" className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
      <label className="inline-flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={on}
          disabled={disabled && !on}
          onChange={(e) => (e.target.checked ? turnOn() : turnOff())}
          aria-describedby="semantic-search-status"
        />
        <span className="font-bold">Meaning-based search</span>
      </label>
      <span
        id="semantic-search-status"
        role="status"
        data-semantic-status={status?.kind ?? 'off'}
        className={status?.kind === 'error' ? 'text-red-300' : busy ? 'text-primary animate-pulse' : 'text-slate-500'}
      >
        — {describe(status)}
      </span>
    </div>
  );
};

export default SemanticSearchToggle;
