// Ranking benchmark for the local (non-AI) ranker. See bench/README.md.
//   node bench/eval.ts [--set dev|test|all|holdout2|holdout3|holdout4|holdout5] [--ranker <path.ts>]
//                      [--detail] [--perf] [--json <outfile>] [--now YYYY-MM-DD]
//                      [--data <dir>] [--qdir <dir>] [--burn-holdout] [--unseal-holdout5]
// --ranker  a .ts/.js module (path relative to cwd) exporting rankConnections; default: the repo's lib/search.ts.
// --set     which labeled set to score (default dev). --split is accepted as an alias.
// --data    read connections.json + context.json (and, without --qdir, queries.json + qrels.json) from <dir>.
// --qdir    read queries.json + qrels.json from <dir>.
// --now     pin the clock the ranker sees (relationship recency); default: the real date.
// Blind sets: holdout5 cannot be run without --unseal-holdout5, and per-query output (--detail, --json) on
// holdout4/holdout5 needs --burn-holdout, because whoever reads it makes that set no longer blind.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { POSITION_KEYS, COMPANY_KEYS, getField, toNetworkContext } from '../lib/connectionFields.ts';
import type { NetworkContext } from '../lib/connectionFields.ts';

type Row = Record<string, unknown>;
type Query = { id: string; text: string; category: string; split?: string; strict?: boolean; intent?: string };
type Qrels = Record<string, Record<string, number>>;
type Metrics = { ndcg: number; p5: number; mrr: number; recall: number; fp: number; empty: number };
type BenchRankedRow = {
  row: Row;
  relevance: number;
  terms: number;
  matchedTokens: string[];
  reasons: string[];
  score: number;
  chips: string[];
  aiSummary: string;
};
type RankFn = (
  rows: Row[],
  criteria: string,
  strictTitleOnly: boolean,
  ctx: NetworkContext | null
) => RankOut | Promise<RankOut>; // async rankers (e.g. bench/rankers/semantic.ts) are awaited
type RankOut = { expanded?: string; roleQuery?: boolean; ranked: BenchRankedRow[] };

const BENCH = import.meta.dirname;
const DEFAULT_RANKER = path.join(BENCH, '..', 'lib', 'search.ts');
const K = 10; // the Recommender's MAX_RESULTS
const METRIC_KEYS: (keyof Metrics)[] = ['ndcg', 'p5', 'mrr', 'recall', 'fp', 'empty'];
const METRIC_LABELS: Record<keyof Metrics, string> = {
  ndcg: 'NDCG@10', p5: 'P@5', mrr: 'MRR', recall: 'R@10', fp: 'FP@10', empty: 'Empty',
};
const REQUIRED_FIELDS = ['row', 'relevance', 'terms', 'matchedTokens', 'reasons', 'score', 'chips', 'aiSummary'];

// Where each set lives: [data dir (connections.json, context.json), query dir (queries.json, qrels.json)].
const SETS: Record<string, [string, string]> = {
  dev: ['devtest', 'devtest/dev'],
  test: ['devtest', 'devtest/test'],
  all: ['devtest', 'devtest'],
  holdout2: ['holdout2', 'holdout2'],
  holdout3: ['holdout3', 'holdout3'],
  holdout4: ['holdout4', 'holdout4'],
  holdout5: ['holdout5', 'holdout5'],
};
const BLIND = new Set(['holdout4', 'holdout5']);

const { values: args } = parseArgs({
  options: {
    ranker: { type: 'string' },
    set: { type: 'string' },
    split: { type: 'string' },
    detail: { type: 'boolean', default: false },
    perf: { type: 'boolean', default: false },
    json: { type: 'string' },
    now: { type: 'string' },
    data: { type: 'string' },
    qdir: { type: 'string' },
    'burn-holdout': { type: 'boolean', default: false },
    'unseal-holdout5': { type: 'boolean', default: false },
  },
});

const set = (args.set ?? args.split ?? 'dev') as string;
if (!args.data && !(set in SETS)) throw new Error(`--set must be one of ${Object.keys(SETS).join('|')}, got ${set}`);
const [dataRel, qRel] = SETS[set] ?? ['', ''];
const DATA = args.data ? path.resolve(process.cwd(), args.data) : path.join(BENCH, dataRel);
const qdir = args.qdir ? path.resolve(process.cwd(), args.qdir) : args.data ? DATA : path.join(BENCH, qRel);

// The guards look at the folders actually read, so --data/--qdir cannot get around them.
const blindSet = [...BLIND].find((b) => [DATA, qdir].some((d) => path.resolve(d) === path.join(BENCH, b)));
if (blindSet === 'holdout5' && !args['unseal-holdout5']) {
  console.error('holdout5 is the blind set: nobody runs a ranker on it until its labels are final and the round is');
  console.error('ready for its one honest number. Re-run with --unseal-holdout5 only then (see bench/README.md).');
  process.exit(2);
}
if (blindSet && (args.detail || args.json) && !args['burn-holdout']) {
  console.error(`${blindSet} is blind: --detail/--json print per-query results, and reading them burns the set.`);
  console.error('Re-run with --burn-holdout only if you accept that (then build the next holdout).');
  process.exit(2);
}

// Pin the clock before the ranker module loads, so relationship recency is reproducible.
let nowLabel = new Date().toISOString().slice(0, 10);
if (args.now) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.now)) throw new Error(`--now must be YYYY-MM-DD, got ${args.now}`);
  const fixed = Date.parse(`${args.now}T12:00:00.000Z`);
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...a: unknown[]) {
      if (a.length === 0) super(fixed);
      else super(...(a as [string | number]));
    }
    static now() {
      return fixed;
    }
  }
  globalThis.Date = FixedDate as unknown as DateConstructor;
  nowLabel = args.now;
}

function readJson<T>(file: string): T {
  if (!existsSync(file)) throw new Error(`missing ${file}`);
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

async function loadRanker(spec: string | undefined): Promise<RankFn> {
  const abs = spec ? path.resolve(process.cwd(), spec) : DEFAULT_RANKER;
  const mod = (await import(pathToFileURL(abs).href)) as { rankConnections?: RankFn };
  if (typeof mod.rankConnections !== 'function') throw new Error(`${abs} does not export a rankConnections function`);
  return mod.rankConnections;
}

const rows = readJson<Row[]>(path.join(DATA, 'connections.json'));
const ctx: NetworkContext | null = toNetworkContext(readJson<unknown>(path.join(DATA, 'context.json')));
const queries = readJson<Query[]>(path.join(qdir, 'queries.json'));
const qrels = readJson<Qrels>(path.join(qdir, 'qrels.json'));
const rankConnections = await loadRanker(args.ranker);
const rankerLabel = args.ranker ?? 'lib/search.ts';

const byId = new Map<string, Row>();
for (const r of rows) byId.set(String(r._id), r);
const idOf = (r: Row) => String(r._id);
const posCo = (r: Row) => `${getField(r, POSITION_KEYS) || '-'} @ ${getField(r, COMPANY_KEYS) || '-'}`;

function dcg(gains: number[]): number {
  let s = 0;
  for (let i = 0; i < gains.length; i++) s += (2 ** gains[i] - 1) / Math.log2(i + 2);
  return s;
}

function metricsFor(topIds: string[], labels: Record<string, number>): Metrics {
  const grade = (id: string) => labels[id] ?? 0;
  const gains = topIds.map(grade);
  const ideal = Object.values(labels).filter((g) => g > 0).sort((a, b) => b - a).slice(0, K);
  const idcg = dcg(ideal);
  // No relevant rows at all: NDCG is 1 for an empty list, else 0.
  const ndcg = idcg > 0 ? dcg(gains) / idcg : topIds.length === 0 ? 1 : 0;
  const top5 = gains.slice(0, 5);
  const p5 = top5.filter((g) => g >= 2).length / 5;
  const firstRel = gains.findIndex((g) => g >= 2);
  const mrr = firstRel >= 0 ? 1 / (firstRel + 1) : 0;
  const relAll = Object.entries(labels).filter(([, g]) => g >= 2).map(([id]) => id);
  const found = relAll.filter((id) => topIds.includes(id)).length;
  const recall = relAll.length === 0 ? 1 : found / relAll.length;
  const fp = gains.filter((g) => g === 0).length;
  const empty = topIds.length === 0 && relAll.length > 0 ? 1 : 0;
  return { ndcg, p5, mrr, recall, fp, empty };
}

function validate(qid: string, ranked: BenchRankedRow[], out: string[]) {
  ranked.forEach((r, i) => {
    const rec = r as unknown as Record<string, unknown>;
    const missing = REQUIRED_FIELDS.filter((f) => !(f in rec) || rec[f] === undefined);
    if (missing.length) out.push(`${qid} #${i + 1}: missing ${missing.join(', ')}`);
    if (!(typeof r.relevance === 'number' && r.relevance > 0)) out.push(`${qid} #${i + 1}: relevance ${r.relevance}`);
    for (const f of ['matchedTokens', 'reasons', 'chips'] as const) {
      if (f in rec && !Array.isArray(rec[f])) out.push(`${qid} #${i + 1}: ${f} is not an array`);
    }
    if (typeof r.score !== 'number' || typeof r.terms !== 'number') out.push(`${qid} #${i + 1}: score/terms not numeric`);
  });
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const fmt = (x: number) => x.toFixed(3);

const perQuery: { id: string; category: string; text: string; metrics: Metrics; top: string[] }[] = [];
const violations: string[] = [];
const detailLines: string[] = [];

for (const q of queries) {
  const labels = qrels[q.id] ?? {};
  const { ranked } = await rankConnections(rows, q.text, !!q.strict, ctx);
  validate(q.id, ranked, violations);
  const top = ranked.slice(0, K);
  const topIds = top.map((r) => idOf(r.row));
  const m = metricsFor(topIds, labels);
  perQuery.push({ id: q.id, category: q.category, text: q.text, metrics: m, top: topIds });

  if (args.detail) {
    detailLines.push('');
    detailLines.push(`${q.id} [${q.category}] "${q.text}"${q.strict ? ' (strict)' : ''}  ` +
      METRIC_KEYS.map((k) => `${METRIC_LABELS[k]}=${k === 'fp' || k === 'empty' ? m[k] : fmt(m[k])}`).join(' ') +
      `  (${ranked.length} returned)`);
    top.forEach((r, i) => {
      const id = idOf(r.row);
      detailLines.push(`  ${String(i + 1).padStart(2)}. ${id} ${labels[id] ?? 0} | ${posCo(r.row)} | ${r.score}/${r.terms}`);
    });
    const missed = Object.entries(labels).filter(([id, g]) => g === 3 && !topIds.includes(id));
    if (missed.length) {
      detailLines.push(`  missed grade-3 (${missed.length}):`);
      for (const [id] of missed) {
        const r = byId.get(id);
        const rank = ranked.findIndex((x) => idOf(x.row) === id);
        detailLines.push(`     ${id} | ${r ? posCo(r) : '(unknown row)'} | ${rank >= 0 ? `rank ${rank + 1}` : 'not returned'}`);
      }
    }
  }
}

function summarize(items: typeof perQuery): Metrics {
  const out = {} as Metrics;
  for (const k of METRIC_KEYS) out[k] = mean(items.map((x) => x.metrics[k]));
  return out;
}

const overall = summarize(perQuery);
const categories = [...new Set(perQuery.map((x) => x.category))].sort();
const byCategory: Record<string, Metrics & { n: number }> = {};
for (const c of categories) {
  const items = perQuery.filter((x) => x.category === c);
  byCategory[c] = { ...summarize(items), n: items.length };
}

const pad = (s: string, n: number) => s.padEnd(n);
const header = pad('', 22) + pad('n', 5) + METRIC_KEYS.map((k) => pad(METRIC_LABELS[k], 9)).join('');
const line = (label: string, n: number, m: Metrics) =>
  pad(label, 22) + pad(String(n), 5) + METRIC_KEYS.map((k) => pad(fmt(m[k]), 9)).join('');

const setLabel = args.data ? `data:${path.relative(process.cwd(), DATA) || '.'}` : set;
console.log(`ranker=${rankerLabel} set=${setLabel} queries=${queries.length} rows=${rows.length} now=${nowLabel}`);
console.log(header);
console.log(line('OVERALL', perQuery.length, overall));
for (const c of categories) console.log(line(`  ${c}`, byCategory[c].n, byCategory[c]));
if (args.detail) for (const l of detailLines) console.log(l);
console.log('');
if (violations.length) {
  console.log(`RankedRow violations: ${violations.length}`);
  for (const v of violations.slice(0, 50)) console.log(`  ${v}`);
} else {
  console.log('RankedRow validation: OK (every row has relevance>0 and all fields)');
}

// -----------------------------
// Perf (synthetic 30k-row copy of the set's network)
// -----------------------------
type PerfResult = { rows: number; perQuery: Record<string, number>; overallMedian: number; firstCallMs: number };
let perf: { large: PerfResult; small: PerfResult } | null = null;

const PERF_QUERIES = [
  'software engineer',
  'product manager at stripe',
  'machine learning',
  'vp sales',
  'someone who can help me hire engineers',
];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function buildLarge(base: Row[], n: number): Row[] {
  // Deterministic LCG so names vary but runs are reproducible.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const firsts = base.map((r) => String(r['First Name'] ?? 'Alex'));
  const lasts = base.map((r) => String(r['Last Name'] ?? 'Doe'));
  const out: Row[] = [];
  for (let i = 0; i < n; i++) {
    const src = base[i % base.length];
    const first = firsts[Math.floor(rnd() * firsts.length)];
    const last = `${lasts[Math.floor(rnd() * lasts.length)]}${i >= base.length ? `-${i}` : ''}`;
    out.push({ ...src, _id: `p${String(i).padStart(5, '0')}`, 'First Name': first, 'Last Name': last, 'Full Name': `${first} ${last}` });
  }
  return out;
}

async function timeSet(rank: RankFn, data: Row[]): Promise<PerfResult> {
  const perQ: Record<string, number> = {};
  let firstCallMs = 0;
  for (const [qi, q] of PERF_QUERIES.entries()) {
    const t0 = performance.now();
    await rank(data, q, false, ctx); // warm-up
    if (qi === 0) firstCallMs = performance.now() - t0;
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      await rank(data, q, false, ctx);
      times.push(performance.now() - t);
    }
    perQ[q] = median(times);
  }
  return { rows: data.length, perQuery: perQ, overallMedian: median(Object.values(perQ)), firstCallMs };
}

if (args.perf) {
  const large = buildLarge(rows, 30_000);
  const small = rows.slice(); // separate array so per-array memoization starts cold
  const smallRes = await timeSet(rankConnections, small);
  const largeRes = await timeSet(rankConnections, large);
  perf = { large: largeRes, small: smallRes };
  console.log('');
  console.log('Perf (median of 5 runs after 1 warm-up, ms):');
  console.log(pad('query', 42) + pad(`${smallRes.rows} rows`, 12) + `${largeRes.rows} rows`);
  for (const q of PERF_QUERIES) {
    console.log(pad(`  ${q}`, 42) + pad(smallRes.perQuery[q].toFixed(2), 12) + largeRes.perQuery[q].toFixed(2));
  }
  console.log(pad('  MEDIAN', 42) + pad(smallRes.overallMedian.toFixed(2), 12) + largeRes.overallMedian.toFixed(2));
  console.log(pad('  first call (cold)', 42) + pad(smallRes.firstCallMs.toFixed(2), 12) + largeRes.firstCallMs.toFixed(2));
  const ok = largeRes.overallMedian < 250 && smallRes.overallMedian < 5;
  console.log(`  budget (<250 ms @30k, <5 ms @${smallRes.rows}): ${ok ? 'OK' : 'OVER'}`);
}

if (args.json) {
  const outFile = path.resolve(process.cwd(), args.json);
  writeFileSync(outFile, JSON.stringify({
    ranker: rankerLabel, set: setLabel, now: nowLabel, overall, byCategory,
    perQuery: perQuery.map(({ id, category, text, metrics, top }) => ({ id, category, text, ...metrics, top })),
    violations, perf,
  }, null, 2));
  console.log(`wrote ${outFile}`);
}
if (violations.length) process.exitCode = 1;
