// bench/semantic_perf.ts — timings for the semantic stage (meaning-based search) in Node (onnxruntime-node).
//   node bench/semantic_perf.ts [--cache-dir <dir>] [--sizes 1000,30000]
// Model load (run once with an empty --cache-dir for a cold download, again for warm from cache),
// time to embed N synthetic connections with distinct "title at company" texts (from scratch),
// and warm query latency (every row already embedded) for the fused ranker vs the lexical one.
// Synthetic rows combine titles and companies from the dev/test, holdout2 and holdout3 networks
// (never holdout4/holdout5), walked with a prime stride, so every text is distinct.
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { COMPANY_KEYS, POSITION_KEYS, getField, toNetworkContext } from '../lib/connectionFields.ts';
import { rankConnections } from '../lib/search.ts';
import { createNodeEmbedder } from '../lib/semantic/nodeEmbedder.ts';
import { EmbeddingStore } from '../lib/semantic/store.ts';
import { semanticRank } from '../lib/semantic/semanticRank.ts';
import { connectionText } from '../lib/semantic/fusion.ts';
import { MODEL_DTYPE, MODEL_ID } from '../lib/semantic/model.ts';

type Row = Record<string, unknown>;
const { values } = parseArgs({ options: { 'cache-dir': { type: 'string' }, sizes: { type: 'string', default: '1000,30000' } } });
const BENCH = import.meta.dirname;
const read = (p: string) => JSON.parse(readFileSync(path.join(BENCH, p), 'utf8'));

const titles = new Set<string>();
const companies = new Set<string>();
for (const set of ['devtest', 'holdout2', 'holdout3']) {
  for (const r of read(`${set}/connections.json`) as Row[]) {
    const t = getField(r, POSITION_KEYS).trim();
    const c = getField(r, COMPANY_KEYS).trim();
    if (t) titles.add(t);
    if (c) companies.add(c);
  }
}
const T = [...titles];
const C = [...companies];
const ctx = toNetworkContext(read('devtest/context.json'));

function synth(n: number): Row[] {
  // Walk the title x company grid with a prime stride: deterministic, and every pair is distinct.
  const total = T.length * C.length;
  if (n > total) throw new Error(`only ${total} distinct title/company pairs`);
  const STRIDE = 7919;
  if (total % STRIDE === 0) throw new Error('stride must be coprime with the grid size');
  const out: Row[] = [];
  for (let i = 0; i < n; i++) {
    const k = (i * STRIDE) % total;
    const t = T[k % T.length];
    const c = C[Math.floor(k / T.length)];
    out.push({ _id: `s${i}`, 'First Name': `F${i}`, 'Last Name': `L${i}`, 'Full Name': `F${i} L${i}`, Position: t, Company: c });
  }
  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const ms = (x: number) => `${x.toFixed(0)} ms`;

console.log(`model ${MODEL_ID} (${MODEL_DTYPE}), node ${process.version}, ${os.cpus()[0]?.model} x${os.cpus().length}`);
console.log(`synthetic pool: ${T.length} titles x ${C.length} companies`);
let t0 = performance.now();
const embedder = await createNodeEmbedder({ cacheDir: values['cache-dir'] ? path.resolve(values['cache-dir']) : undefined });
console.log(`model load: ${ms(performance.now() - t0)}${values['cache-dir'] ? ` (cache dir ${values['cache-dir']})` : ''}`);

const QUERIES = ['software engineer', 'product manager at stripe', 'machine learning', 'vp sales', 'someone who can help me hire engineers'];
for (const n of values.sizes.split(',').map(Number)) {
  const rows = synth(n);
  const distinct = new Set(rows.map(connectionText)).size;
  const store = new EmbeddingStore(embedder, 64);
  t0 = performance.now();
  const first = await semanticRank(rows, QUERIES[0], false, ctx, store);
  const firstMs = performance.now() - t0;
  const fused: number[] = [];
  const lexical: number[] = [];
  for (const q of QUERIES) {
    for (let i = 0; i < 5; i++) {
      let t = performance.now();
      await semanticRank(rows, q, false, ctx, store);
      fused.push(performance.now() - t);
      t = performance.now();
      rankConnections(rows, q, false, ctx);
      lexical.push(performance.now() - t);
    }
  }
  console.log(
    `${n} rows (${distinct} distinct texts): first search, embedding every row = ${ms(firstMs)} ` +
      `(${(firstMs / distinct).toFixed(2)} ms/text, ${first.ranked.length} results); ` +
      `warm query median fused ${median(fused).toFixed(1)} ms vs lexical ${median(lexical).toFixed(1)} ms`
  );
}
