// lib/semantic/semanticRank.ts
//
// The fused ranker behind meaning-based search: lexical
// rankConnections (lib/search.ts, imported, never edited) + embedding
// similarity, combined by fuse(). Environment-agnostic: the embedder is a Web
// Worker in the browser (workerEmbedder.ts) and transformers.js directly in Node
// (nodeEmbedder.ts, benchmark only).

import type { NetworkContext } from '../connectionFields.ts';
import { rankConnections } from '../search.ts';
import { DEFAULT_FUSION, fuse, queryText, similarities } from './fusion.ts';
import type { EmbedProgress, EmbeddingStore } from './store.ts';
import type { FusionParams, RankResult, Row, SemanticRanker } from './types.ts';

export async function semanticRank(
  rows: Row[],
  criteria: string,
  strictTitleOnly: boolean,
  ctx: NetworkContext | null,
  store: EmbeddingStore,
  params: FusionParams = DEFAULT_FUSION,
  onProgress?: (p: EmbedProgress) => void
): Promise<RankResult> {
  const lexical = rankConnections(rows, criteria, strictTitleOnly, ctx);
  const q = queryText(criteria);
  if (!q || rows.length === 0) return lexical;
  const vectors = await store.vectorsForRows(rows, onProgress);
  const [qv] = await store.vectorsForTexts([q]);
  return fuse(lexical, rows, similarities(vectors, qv), strictTitleOnly, ctx, params, new Date());
}

export function createSemanticRanker(
  store: EmbeddingStore,
  params: FusionParams = DEFAULT_FUSION,
  onProgress?: (p: EmbedProgress) => void
): SemanticRanker {
  return (rows, criteria, strictTitleOnly, ctx) =>
    semanticRank(rows, criteria, strictTitleOnly, ctx, store, params, onProgress);
}
