# Ranking benchmark

A reproducible benchmark for the Recommender's local (non-AI) ranking: `rankConnections` in `lib/search.ts`.
It scores a ranker against graded relevance labels on several synthetic LinkedIn networks and reports NDCG@10
and related metrics. Nothing in this folder is imported by the app, so it does not change the app bundle.

## Read this before quoting a number

- **The networks are synthetic.** Every person is invented. Companies are real or invented. No real user's
  data is in this folder.
- **The labels are AI-labeled, not human-judged.** Each set was graded by two independent AI agents, then a
  third pass adjudicated their disagreements (see each set's `ADJUDICATION.md`; holdout5's are in
  `holdout5/labeling/`). They are useful for comparing
  rankers, not ground truth about what a real person wants.
- **The query sets are small: 12 to 36 queries per set.** One query is 3-8% of a set's mean, so a single query
  moving from NDCG 1.0 to 0.5 shifts the set's score by 0.014 to 0.042. Treat differences below about 0.02-0.03
  as noise, and look at per-category and per-query changes before believing a gain.
- **Tuning scores are not honest scores.** `lib/search.ts` was tuned on the dev split, so its dev score
  (about 0.99) says little. Only a set nobody has tuned against or read per-query results for gives an
  honest number.

## The sets

| Set | Folder | Rows | Queries | Domains | Status |
|---|---|---|---|---|---|
| dev | `devtest/` (queries in `devtest/dev/`) | 242 | 24 | tech, startups, VC | tuning set: tune here only |
| test | `devtest/` (queries in `devtest/test/`) | 242 | 12 | same network as dev | used to choose the current ranker; not blind |
| holdout2 | `holdout2/` | 168 | 18 | health systems, pharma, law, consulting, insurance | per-query results were read; not blind |
| holdout3 | `holdout3/` | 162 | 18 | academia, energy policy, government, journalism, foundations | per-query results were read; not blind |
| holdout4 | `holdout4/` | 163 | 18 | retail, CPG, hospitality, logistics | only its aggregate score has been reported; keep its per-query results unread |
| holdout5 | `holdout5/` | 2,050 | 35 | aviation, aerospace and space, drones, public safety, agriculture, film and media, mining, maritime, sports, veterinary | was blind; labeled, then measured once on 2026-10-15 (lexical vs semantic fusion, aggregates only); now spent for fusion |

`all` = dev + test together (36 queries on the dev/test network).

Scores of `lib/search.ts` at commit `a7fdd19`, measured 2026-10-15 with this harness (identical to the
private harness it was copied from):

| Set | NDCG@10 | P@5 | MRR | R@10 | FP@10 |
|---|---|---|---|---|---|
| dev | 0.994 | 0.908 | 1.000 | 0.692 | 0.542 |
| test | 0.953 | 0.933 | 1.000 | 0.773 | 0.083 |
| holdout2 | 0.926 | 0.878 | 0.944 | 0.869 | 1.333 |
| holdout3 | 0.912 | 0.800 | 0.972 | 0.772 | 2.444 |

Holdout4 was not re-run for this table (its earlier blind result is recorded in the project's notes as
0.687). Holdout5 is not in this table: it was measured once for the semantic stage (see "The semantic
ranker").

## Running it

Node 24 or later (it runs the TypeScript directly through Node's type stripping). From the repo root:

```bash
node bench/eval.ts                                   # dev split, ranker = lib/search.ts
node bench/eval.ts --set test                        # dev | test | all | holdout2 | holdout3 | holdout4 | holdout5
node bench/eval.ts --set dev --detail                # per-query top 10 with grades, and missed grade-3 rows
node bench/eval.ts --set dev --ranker path/to/ranker.ts   # any module exporting rankConnections
node bench/eval.ts --set dev --perf                  # speed on the set and on a 30,000-row copy of it
node bench/eval.ts --set dev --json out.json         # machine-readable results
node bench/eval.ts --set dev --now 2026-10-15        # pin the date the ranker sees (see below)
node bench/eval.ts --data some/folder                # a folder with connections.json, context.json, queries.json, qrels.json
for s in dev test holdout2 holdout3; do node bench/eval.ts --set $s | sed -n 1,3p; done
```

The exit code is 1 when a returned row breaks the result contract (missing fields, `relevance <= 0`).

**Blind-set guards.** `--set holdout5` (or any `--data`/`--qdir` pointing at `bench/holdout5`) refuses to
run without `--unseal-holdout5`. `--detail` and `--json` on holdout4 or holdout5 refuse to run without
`--burn-holdout`, because whoever reads per-query results can no longer treat that set as blind.

**Dates.** The relationship bonus uses message recency relative to today, which only reorders rows within a
relevance tier. Scores can drift slightly as the calendar moves. Use `--now YYYY-MM-DD` to pin the date when
comparing runs made on different days.

**Ranker interface.** A ranker module exports
`rankConnections(rows, criteria, strictTitleOnly, ctx) -> { ranked }`, where each ranked item has `row`,
`relevance` (> 0), `terms`, `matchedTokens`, `reasons`, `score`, `chips` and `aiSummary`, sorted best
first (the shape `lib/search.ts` returns). Rows are LinkedIn-export objects with a stable `_id`. `ctx` is the
set's `context.json` passed through `toNetworkContext`.

## Metrics

All are computed on the top 10 (the Recommender shows 10 results) and averaged over queries.

- **NDCG@10**: graded, gain `2^grade - 1`, ideal = the query's labeled rows sorted by grade. A query with no
  labeled rows scores 1 only if the ranker returns nothing.
- **P@5**: share of the top 5 with grade >= 2.
- **MRR**: 1 / rank of the first grade >= 2 row.
- **R@10**: share of the query's grade >= 2 rows found in the top 10.
- **FP@10**: number of grade-0 rows in the top 10.
- **Empty**: share of queries with relevant rows where the ranker returned nothing.

## Labels

Each set has `queries.json` (`id`, `text`, `category`, `strict?`, `intent`), `qrels.json`
(`{ queryId: { rowId: grade } }`, grades 1-3, absent = 0), the two labelers' raw files `labels_A.json` and
`labels_B.json`, and `ADJUDICATION.md` (agreement, merge rule, every adjudicated case). Holdout5 keeps its
labeling files, including `ADJUDICATION_NOTES.md` and `ADJUDICATION_WORKSHEET.md`, in `holdout5/labeling/`.

Grade scale:

- **3**: exactly what the searcher asked for (right function or role, and any stated company or seniority
  constraint met).
- **2**: clearly relevant (right function, a constraint partly met, e.g. an adjacent seniority level or a
  closely related role).
- **1**: marginal (a related field, or only a company match on a role query).
- **0**: irrelevant.

Grades judge topical relevance only, never relationship strength.

Merge rule used for every set: equal grades are kept; grades one apart (both >= 1) round half up; 0-vs-1 and
gaps of two or more are adjudicated from the query's intent and the row, and 0-vs-1 becomes 1 unless the row is
plainly off-intent.

## Rules for using it

- Tune on `--set dev` only. Don't tune against test or a holdout, and don't read their per-query output
  while designing.
- Before quoting a number, say which set it is from and whether that set is still blind.
- When a holdout's per-query results have been read, it is no longer blind: build the next holdout (seeded
  generator, new domains, two independent labelers) before the next round.
- Rankers must read only `connections.json` and `context.json` of a set. Nothing in `labeling/`,
  `generators/` or the label files may feed a ranker.

## Generators and reproducibility

`generators/` holds the scripts that wrote each holdout network. Each takes an optional output folder and
defaults to its own set's folder:

```bash
node bench/generators/holdout2_gen.mjs  /tmp/h2     # connections.json, context.json, queries.json
python3 bench/generators/holdout3_gen.py /tmp/h3    # same three files
cp bench/holdout4/context.json /tmp/h4/ && node bench/generators/holdout4_gen.mjs /tmp/h4   # connections.json; patches context.json
node bench/generators/holdout5_gen.mjs  /tmp/h5     # connections, context, queries, labeling/sectors.json
```

Each one reproduces the committed files byte for byte (checked 2026-10-15). Gaps: the dev/test network's
generator was not kept (its files are the originals); holdout4's queries were written by hand and its
generator patches a hand-written `context.json` in place.

## Holdout 5: how the blind set was built and labeled

Holdout 5 was built before any tuning of the next ranker round, and no ranker was run on it until its labels
were final. It was then measured once (2026-10-15) and is now spent for the semantic fusion stage (see below).

- `generators/holdout5_gen.mjs`: seed 5021, no clock, no `Math.random`, re-runs byte-identically.
  2,050 connections (320 with relationship enrichment, 32 with an owner note, 12 with a blank title or
  company, plus a few deliberately messy rows), a `context.json` for the owner (a drone-services flight
  operations director, formerly an airline and Air Force pilot), and 35 queries written from the network's
  description, not from any ranking. Domains were picked from those the earlier sets used least: aviation,
  aerospace and space, drones and eVTOL, military aviation, public safety (fire, police, EMS, 911, emergency
  management), agriculture, film, TV, broadcast, music and games, mining and oil and gas, maritime, sports,
  veterinary, plus a background of everyday roles. The queries include natural-language requests,
  abbreviations (`a&p mechanic`, `dp`, `ems`, `uas`, `cfi`, `vfx`) and role words that mean different things
  in different fields (`dispatchers`, `airline captains`, `film producers`, with fire, ship and military
  captains, and insurance and farm producers, in the network).
- `holdout5/labeling/build_pools.mjs` builds one candidate pool per query, without any ranker: every row whose
  title, company or note matches the query's broad hand-written term list (word-start matches), every row in
  the query's related industries (the generator's `sectors.json`), every row with a note for note queries,
  plus 15 random rows from outside the rule as an audit sample. Labelers don't know which rows are audit rows.
  If they grade any of them above 0, the rule missed relevant people. Pools are listed in row-id order in
  `labeling/pools/<queryId>.md`, and `labeling/pool_manifest.json` records the rule and audit ids. Pool sizes
  shown to labelers: 49 to 354 per query, 6,144 in total (v01 135, v02 222, v03 251, v04 97, v05 152, v06 221,
  v07 221, v08 97, v09 164, v10 289, v11 210, v12 258, v13 143, v14 81, v15 67, v16 82, v17 254, v18 213,
  v19 276, v20 132, v21 144, v22 85, v23 305, v24 260, v25 49, v26 105, v27 183, v28 182, v29 289, v30 229,
  v31 88, v32 354, v33 93, v34 157, v35 56).
- `holdout5/labeling/LABELER_PROMPT.md` is the single instruction text both labelers get, word for word.
  Each labeler writes `labels_A.json` or `labels_B.json` (`{ queryId: { rowId: grade } }`, grades 1-3 only).
- `holdout5/labeling/merge_labels.mjs labels_A.json labels_B.json` reports agreement and Cohen's kappa,
  auto-merges per the rule above, lists audit-row hits, and writes `ADJUDICATION_WORKSHEET.md`,
  `merge_draft.json` and `decisions.template.json`. After adjudication,
  `merge_labels.mjs A B --decisions decisions.json --write-qrels` writes `holdout5/qrels.json`.
- Only then was `node bench/eval.ts --set holdout5 --unseal-holdout5` run, once per compared ranker, without
  `--detail`.

## The semantic ranker (meaning-based search: lexical + on-device embeddings)

`bench/rankers/semantic.ts` is the fused ranker behind the Recommender's "Meaning-based search" toggle
(`lib/semantic/`, on the live site, off by default for every user). It runs `lib/search.ts` unchanged, embeds each
connection's "title at company" (never notes) and the query with `Xenova/all-MiniLM-L6-v2` (q8, 384 dimensions,
about 23 MB downloaded once into `node_modules/@huggingface/transformers/.cache/Xenova/all-MiniLM-L6-v2/<revision>/`),
and fuses them in `tier` mode: the lexical relevance tiers stay, inside a tier rows sort by score + 10 x cosine
similarity, and rows the lexical ranker dropped are appended (at most 10) when their similarity is at least 0.6
(never with "Strict title-only" on). Its `rankConnections` is async; `eval.ts` awaits any ranker.

- **Pinned model.** `lib/semantic/model.ts` pins the Hub commit `751bff37182d3f1213fa05d7196b954e230abad9` (the
  repo's `sha` from `https://huggingface.co/api/models/Xenova/all-MiniLM-L6-v2` on 2026-10-15; the files cached
  before pinning matched it: ONNX sha256 = the LFS oid at that commit, JSON git blob ids equal). Node and the
  browser worker both pass it as `revision`, so the loaded config, tokenizer and weights (hence similarities)
  cannot drift when the repo's `main` moves. Dev numbers were identical before and after pinning. Caveat:
  transformers.js 4.3.0's `pipeline()` still reads `config.json` at `main` (and range-probes files at `main` for
  progress totals) to decide which files to load; it ignores `revision` there.
- **Runtime downloads in the browser.** Besides the model files (Hugging Face Hub: `huggingface.co` and its
  `us.aws.cdn.hf.co` Xet CDN, about 23 MB transferred), onnxruntime-web's WebAssembly files
  (`ort-wasm-simd-threaded.asyncify.wasm`, 26.9 MB raw, 5.55 MB brotli as served; measured in Chromium on
  2026-10-27) come from jsDelivr (`https://cdn.jsdelivr.net/npm/onnxruntime-web@<installed version>/dist/`, the version
  locked in `package-lock.json`; Vite resolves the `onnxruntime-web-use-extern-wasm` condition so the build does not
  bundle the 27 MB `.wasm`). If either host is down or blocked, the toggle reports an error and Search stays
  lexical: a load with no download progress for 60 s or an embedding batch that takes over 30 s stops the worker
  (`lib/semantic/engine.ts`); the next Search tries one fresh worker, then stays lexical until the toggle is
  switched off and on.
- **Known limitation: AI Rerank** keeps using the lexical pool (`rankConnections` in `RecommenderScreen`), so it
  never sees rows the semantic pass added or reordered.
- **Install weight.** `@huggingface/transformers` pulls `onnxruntime-node` (about 548 MB in `node_modules`) and
  `sharp` (about 29 MB with its `@img` binaries) although the app only uses the browser build; the benchmark's Node
  ranker is the only user of `onnxruntime-node`, and the semantic code never uses `sharp` (image processing).

```bash
node bench/eval.ts --set dev --now 2026-10-15 --ranker bench/rankers/semantic.ts
SEMANTIC_FUSION='{"mode":"rrf","k":60,"wSem":0.5}' node bench/eval.ts --set dev --ranker bench/rankers/semantic.ts
node bench/semantic_grid.mjs                 # the fusion grid, dev split only (66 settings)
node bench/semantic_perf.ts --cache-dir /tmp/x --sizes 1000,30000   # load, embedding and query timings
```

Fusion parameters were tuned on dev only (2026-10-15, `--now 2026-10-15`). Grid: `tier` wSem 0/2/5/10/20/40 x
add threshold 0.4/0.5/0.6/0.7/none; `rrf` k 10/30/60 x wSem 0.25/0.5/1 x add 0.5/0.6/none; `blend` wSem
0.1/0.25/0.5 x add 0.5/0.6/none; then add 0.52/0.55/0.57 and maxAdded 3/5. Every `tier` setting tied the lexical
NDCG@10 (0.994); added rows below 0.6 were all grade 0 (FP@10 up to +0.21); `rrf` lost at every setting (0.931 to
0.990); `blend` w=0.1 gained 0.002 from one query (noise) and breaks the tiers. Chosen: `tier`, wSem 10, add 0.6.

**These parameters are effectively unvalidated by dev.** Dev is saturated (lexical NDCG@10 0.994) and every `tier`
setting tied there, so dev could not tell wSem 10 from any other weight; 0.6 is only the lowest add threshold that
added no grade-0 row on dev. The only blind evidence is a single holdout5 measurement on 2026-10-15 (35 queries,
synthetic network, AI-labeled): lexical 0.739, fused 0.777 NDCG@10. Holdout5 is now spent for fusion: any further
change to the fusion mode, weights, thresholds or `fuse()` needs a new blind set.

| Set (status) | Lexical NDCG@10 | Fused NDCG@10 | Lexical P@5 / FP@10 | Fused P@5 / FP@10 |
|---|---|---|---|---|
| dev (tuning) | 0.994 | 0.994 | 0.908 / 0.542 | 0.908 / 0.542 |
| test (seen) | 0.953 | 0.953 | 0.933 / 0.083 | 0.917 / 0.083 |
| holdout2 (seen) | 0.926 | 0.926 | 0.878 / 1.333 | 0.867 / 1.278 |
| holdout3 (seen) | 0.912 | 0.909 | 0.800 / 2.444 | 0.800 / 2.444 |

The seen sets were run once, after the parameters were fixed, and only their aggregates were read. Holdout 5
was the honest test (`node bench/eval.ts --set holdout5 --unseal-holdout5 --now <date> --ranker bench/rankers/semantic.ts`,
next to the same command without `--ranker`) and has been run once (2026-10-15, result above); do not rerun it to
tune.

## TypeScript and the app build

`bench/eval.ts` type-checks under the repo's `tsconfig.json` (`npx tsc --noEmit` stays clean, so `bench/`
is not excluded). The Vite build starts from `index.html`, and nothing there imports `bench/`, so
`npm run build` output is unchanged.
