// bench/rankers/semantic.ts — the fused ranker behind the app's meaning-based search (lexical lib/search.ts + on-device
// embeddings, lib/semantic/) as a bench ranker module:
//   node bench/eval.ts --set dev --ranker bench/rankers/semantic.ts --now 2026-10-15
// Its rankConnections is async; bench/eval.ts awaits it. Fusion parameters default to
// DEFAULT_FUSION in lib/semantic/fusion.ts; SEMANTIC_FUSION='{"mode":"rrf","k":60,...}' overrides any
// of them (the dev grid in bench/semantic_grid.mjs uses this). The model loads once per process
// (downloaded on first use into node_modules/@huggingface/transformers/.cache).
// Reads only the rows it is given: nothing from labels, qrels or labeling/.
import { createNodeEmbedder } from '../../lib/semantic/nodeEmbedder.ts';
import { EmbeddingStore } from '../../lib/semantic/store.ts';
import { semanticRank } from '../../lib/semantic/semanticRank.ts';
import { DEFAULT_FUSION } from '../../lib/semantic/fusion.ts';
import type { FusionParams, RankResult, Row } from '../../lib/semantic/types.ts';
import type { NetworkContext } from '../../lib/connectionFields.ts';

const override = process.env.SEMANTIC_FUSION ? (JSON.parse(process.env.SEMANTIC_FUSION) as Partial<FusionParams>) : {};
export const fusionParams: FusionParams = { ...DEFAULT_FUSION, ...override };
console.error(`semantic ranker: fusion ${JSON.stringify(fusionParams)}`);

const store = new EmbeddingStore(await createNodeEmbedder(), 64);

export function rankConnections(
  rows: Row[],
  criteria: string,
  strictTitleOnly: boolean,
  ctx: NetworkContext | null
): Promise<RankResult> {
  return semanticRank(rows, criteria, strictTitleOnly, ctx, store, fusionParams);
}
