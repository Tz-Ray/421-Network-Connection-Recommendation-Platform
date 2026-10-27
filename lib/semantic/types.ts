// lib/semantic/types.ts
//
// Types shared by the semantic stage (meaning-based search). Type-only: importing it (with `import type`) adds no
// code to any bundle, so RecommenderScreen can name SemanticRanker safely.

import type { NetworkContext } from '../connectionFields.ts';
import type { RankedRow } from '../search.ts';

export type Row = Record<string, unknown>;

/** Same shape as `rankConnections` in lib/search.ts, but async. */
export type RankResult = { expanded: string; roleQuery: boolean; ranked: RankedRow[] };

export type SemanticRanker = (
  rows: Row[],
  criteria: string,
  strictTitleOnly: boolean,
  ctx: NetworkContext | null
) => Promise<RankResult>;

/** Turns texts into L2-normalized sentence vectors (one Float32Array per text). */
export type Embedder = {
  readonly modelId: string;
  embed(texts: string[]): Promise<Float32Array[]>;
};

/**
 * How the lexical ranking and the embedding similarity are combined (see fusion.ts).
 * - `rrf`: reciprocal-rank fusion, 1/(k + lexRank) + wSem/(k + semRank).
 * - `blend`: (1 - wSem) * relevance / maxRelevance + wSem * similarity.
 * - `tier`: the lexical order's relevance tiers stay; inside a tier rows sort by
 *   score + wSem * similarity (wSem in relevance points).
 * In every mode, rows the lexical ranker dropped (relevance 0) are added only when
 * their similarity is at least `addThreshold` (at most `maxAdded` of them), and in
 * `tier` mode always below every lexical row; with "Strict title-only" on, never.
 */
export type FusionParams = {
  mode: 'rrf' | 'blend' | 'tier';
  k: number;
  wSem: number;
  addThreshold: number;
  maxAdded: number;
  /** A row (lexical or added) gets the "Semantic match" chip at this similarity or above. */
  chipThreshold: number;
};
