// lib/semantic/fusion.ts
//
// The pure part of the semantic stage (meaning-based search): which text is embedded per connection, and how the
// lexical ranking (rankConnections in lib/search.ts, never edited here) is fused
// with cosine similarity to the query. No model, no network, no React: Node tests
// import it directly (relative imports carry explicit .ts extensions).
//
// Privacy: only a connection's title and company are embedded, never note text
// or message data, and everything stays on the device.

import { COMPANY_KEYS, POSITION_KEYS, getField } from '../connectionFields.ts';
import type { NetworkContext } from '../connectionFields.ts';
import { relationshipSignals } from '../relationship.ts';
import type { RankedRow } from '../search.ts';
import type { FusionParams, RankResult, Row } from './types.ts';

export const SEMANTIC_CHIP = 'Semantic match';
/** Queries longer than this are cut before embedding (the lexical ranker reads 32 words). */
export const MAX_QUERY_CHARS = 300;

/**
 * Chosen on the dev split only (bench/semantic_grid.mjs; grid and results in
 * bench/README.md). `tier` keeps the lexical relevance tiers (relevance first,
 * DEC-018), lets similarity reorder rows inside a tier, and appends rows the
 * lexical ranker dropped when they are close in meaning. `k` is unused in `tier`
 * mode.
 *
 * Caveat: dev is saturated (lexical NDCG@10 0.994) and every `tier` setting tied
 * there, so wSem 10 and the 0.6 add threshold are effectively unvalidated by dev
 * (0.6 is only the lowest threshold that added no grade-0 row on dev; `rrf` lost
 * at every setting; `blend` gained 0.002 from one query, noise, and breaks the
 * tiers). The only blind evidence is one holdout5 measurement on 2026-10-15
 * (35 synthetic, AI-labeled queries): lexical 0.739 -> fused 0.777 NDCG@10. Any
 * further change to these parameters or to fuse() needs a new blind set.
 */
export const DEFAULT_FUSION: FusionParams = {
  mode: 'tier',
  k: 60,
  wSem: 10,
  addThreshold: 0.6,
  maxAdded: 10,
  chipThreshold: 0.6,
};

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The text embedded for one connection: "<title> at <company>", or whichever exists; '' = not embedded. */
export function connectionText(row: Row): string {
  const title = collapse(getField(row, POSITION_KEYS));
  const company = collapse(getField(row, COMPANY_KEYS));
  if (title && company) return `${title} at ${company}`;
  return title || company;
}

/** The text embedded for a query ('' = nothing to embed). */
export function queryText(criteria: string): string {
  return collapse(criteria).slice(0, MAX_QUERY_CHARS);
}

/** Dot product; equals cosine similarity for L2-normalized vectors. */
export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/** Similarity of every row to the query (0 for rows without a vector). */
export function similarities(vectors: ReadonlyArray<Float32Array | null>, query: Float32Array): Float32Array {
  const out = new Float32Array(vectors.length);
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    out[i] = v ? dot(v, query) : 0;
  }
  return out;
}

function withChip(r: RankedRow): RankedRow {
  return { ...r, chips: [SEMANTIC_CHIP, ...r.chips] };
}

/**
 * Fuses the lexical result with per-row similarities (`sims[i]` belongs to
 * `rows[i]`). Returns the same shape as rankConnections; lexical rows keep their
 * reasons, chips and score (plus the "Semantic match" chip at or above
 * `chipThreshold`); added rows carry relevance >= 1, terms 0, a "Semantic match"
 * reason and chip, and their relationship signals. Deterministic: ties keep the
 * lexical order, then row order. With `strictTitleOnly` no row is added.
 */
export function fuse(
  lexical: RankResult,
  rows: Row[],
  sims: ArrayLike<number>,
  strictTitleOnly: boolean,
  ctx: NetworkContext | null,
  params: FusionParams,
  now: Date
): RankResult {
  const indexOf = new Map<Row, number>();
  rows.forEach((r, i) => indexOf.set(r, i));
  const simOfIndex = (i: number | undefined) => (i == null ? 0 : Number(sims[i]) || 0);

  const lex = lexical.ranked.map((r, rank) => {
    const i = indexOf.get(r.row);
    return { r, rank, i, sim: simOfIndex(i) };
  });
  const inLexical = new Set<number>();
  for (const x of lex) if (x.i != null) inLexical.add(x.i);

  // Rows the lexical ranker dropped, close enough in meaning to add. With
  // "Strict title-only" on, none: the user asked for title-level evidence, which
  // a similarity score is not (lexical rows still get the chip and in-tier order).
  const addable: { i: number; sim: number }[] = [];
  if (params.maxAdded > 0 && !strictTitleOnly) {
    for (let i = 0; i < rows.length; i++) {
      if (inLexical.has(i)) continue;
      const sim = simOfIndex(i);
      if (!(sim >= params.addThreshold)) continue;
      addable.push({ i, sim });
    }
    addable.sort((a, b) => b.sim - a.sim || a.i - b.i);
    addable.length = Math.min(addable.length, params.maxAdded);
  }
  const added = addable.map(({ i, sim }) => {
    const row = rows[i];
    const rel = relationshipSignals(row, ctx, now);
    const relevance = Math.max(1, Math.round(sim * 10));
    const item: RankedRow = {
      row,
      relevance,
      terms: 0,
      matchedTokens: [],
      reasons: [`Semantic match: similar in meaning to your search (similarity ${sim.toFixed(2)})`, ...rel.reasons],
      score: relevance + rel.bonus,
      chips: [SEMANTIC_CHIP, ...rel.chips],
      aiSummary: rel.aiSummary,
    };
    return { item, i, sim };
  });

  const decorate = (x: { r: RankedRow; sim: number }) => (x.sim >= params.chipThreshold ? withChip(x.r) : x.r);
  let ranked: RankedRow[];

  if (params.mode === 'tier') {
    const lexSorted = [...lex].sort(
      (a, b) =>
        b.r.terms - a.r.terms ||
        b.r.score + params.wSem * b.sim - (a.r.score + params.wSem * a.sim) ||
        a.rank - b.rank
    );
    ranked = [...lexSorted.map(decorate), ...added.map((a) => a.item)];
  } else {
    type Cand = { item: RankedRow; lexRank: number; i: number; sim: number; rel: number };
    const cands: Cand[] = [
      ...lex.map((x) => ({ item: decorate(x), lexRank: x.rank + 1, i: x.i ?? -1, sim: x.sim, rel: x.r.relevance })),
      ...added.map((a) => ({ item: a.item, lexRank: Infinity, i: a.i, sim: a.sim, rel: 0 })),
    ];
    let key: (c: Cand) => number;
    if (params.mode === 'rrf') {
      // Semantic rank among every row with a vector-derived similarity.
      const order = Array.from({ length: rows.length }, (_, i) => i).sort(
        (a, b) => simOfIndex(b) - simOfIndex(a) || a - b
      );
      const semRank = new Map<number, number>();
      order.forEach((i, r) => semRank.set(i, r + 1));
      key = (c) =>
        (Number.isFinite(c.lexRank) ? 1 / (params.k + c.lexRank) : 0) +
        (c.i >= 0 && c.sim > 0 ? params.wSem / (params.k + (semRank.get(c.i) ?? Infinity)) : 0);
    } else {
      const maxRel = lex.reduce((m, x) => Math.max(m, x.r.relevance), 1);
      key = (c) => (1 - params.wSem) * (c.rel / maxRel) + params.wSem * c.sim;
    }
    const keyed = cands.map((c) => ({ c, k: key(c) }));
    keyed.sort((a, b) => b.k - a.k || a.c.lexRank - b.c.lexRank || b.c.sim - a.c.sim || a.c.i - b.c.i);
    ranked = keyed.map((x) => x.c.item);
  }

  return { expanded: lexical.expanded, roleQuery: lexical.roleQuery, ranked };
}
