// lib/semantic/store.ts
//
// In-memory embedding cache of the semantic stage, keyed by the
// exact text embedded (connectionText), so a changed dataset re-embeds only the
// rows whose title or company changed, and rows sharing a title + company are
// embedded once. One store per embedder (= per model). Never persisted: no
// Firestore, no IndexedDB, no sessionStorage.

import { connectionText } from './fusion.ts';
import type { Embedder, Row } from './types.ts';

export type EmbedProgress = { done: number; total: number };

export class EmbeddingStore {
  readonly embedder: Embedder;
  private readonly batchSize: number;
  private readonly maxEntries: number;
  private readonly byText = new Map<string, Float32Array>();
  // Per rows array: the vectors aligned with it (arrays are replaced, never mutated, by the app).
  private readonly byRows = new WeakMap<Row[], { length: number; vectors: (Float32Array | null)[] }>();

  constructor(embedder: Embedder, batchSize = 32, maxEntries = 200_000) {
    this.embedder = embedder;
    this.batchSize = batchSize;
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.byText.size;
  }

  /**
   * Vectors for these texts (embedding the ones not cached yet, in batches).
   * The return value is built from this call's own lookups and embeddings, so a
   * concurrent call that evicts entries meanwhile cannot take vectors away from it.
   */
  async vectorsForTexts(texts: string[], onProgress?: (p: EmbedProgress) => void): Promise<Float32Array[]> {
    const local = new Map<string, Float32Array>();
    const missing: string[] = [];
    for (const t of new Set(texts)) {
      const v = this.byText.get(t);
      if (v) local.set(t, v);
      else missing.push(t);
    }
    for (let start = 0; start < missing.length; start += this.batchSize) {
      const batch = missing.slice(start, start + this.batchSize);
      const vecs = await this.embedder.embed(batch);
      if (vecs.length !== batch.length) throw new Error(`embedder returned ${vecs.length} vectors for ${batch.length} texts`);
      batch.forEach((t, j) => {
        local.set(t, vecs[j]);
        this.remember(t, vecs[j]);
      });
      onProgress?.({ done: Math.min(start + batch.length, missing.length), total: missing.length });
    }
    return texts.map((t) => local.get(t) as Float32Array);
  }

  /** Caches one vector, evicting the oldest entries beyond maxEntries (Map keeps insertion order). */
  private remember(text: string, v: Float32Array): void {
    this.byText.delete(text);
    this.byText.set(text, v);
    while (this.byText.size > this.maxEntries) {
      const oldest = this.byText.keys().next().value as string;
      this.byText.delete(oldest);
    }
  }

  /** One vector per row (null for a row with neither title nor company). */
  async vectorsForRows(rows: Row[], onProgress?: (p: EmbedProgress) => void): Promise<(Float32Array | null)[]> {
    const memo = this.byRows.get(rows);
    if (memo && memo.length === rows.length) return memo.vectors;
    const texts = rows.map(connectionText);
    const nonEmpty = texts.filter((t) => t !== '');
    const vecs = await this.vectorsForTexts(nonEmpty, onProgress);
    const byText = new Map<string, Float32Array>();
    nonEmpty.forEach((t, j) => byText.set(t, vecs[j]));
    const vectors = texts.map((t) => (t ? byText.get(t) ?? null : null));
    this.byRows.set(rows, { length: rows.length, vectors });
    return vectors;
  }
}
