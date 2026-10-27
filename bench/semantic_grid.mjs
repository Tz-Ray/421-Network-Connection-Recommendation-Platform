// bench/semantic_grid.mjs — the fusion-parameter grid for the semantic ranker, on the
// dev split ONLY (tuning set). Runs bench/eval.ts once per combination with SEMANTIC_FUSION set.
//   node bench/semantic_grid.mjs [--now 2026-10-15] [--out results.json]
// Never point it at test or a holdout: it hardcodes --set dev on purpose.
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { now: { type: 'string', default: '2026-10-15' }, out: { type: 'string' } } });
const ROOT = path.join(import.meta.dirname, '..');
const NONE = 1.01; // addThreshold above any cosine similarity: no rows added

const grid = [];
for (const wSem of [0, 2, 5, 10, 20, 40])
  for (const addThreshold of [0.4, 0.5, 0.6, 0.7, NONE]) grid.push({ mode: 'tier', wSem, addThreshold, maxAdded: 10 });
for (const k of [10, 30, 60])
  for (const wSem of [0.25, 0.5, 1])
    for (const addThreshold of [0.5, 0.6, NONE]) grid.push({ mode: 'rrf', k, wSem, addThreshold, maxAdded: 10 });
for (const wSem of [0.1, 0.25, 0.5])
  for (const addThreshold of [0.5, 0.6, NONE]) grid.push({ mode: 'blend', wSem, addThreshold, maxAdded: 10 });

const tmp = mkdtempSync(path.join(tmpdir(), 'semgrid-'));
const run = (args, env) =>
  new Promise((resolve, reject) =>
    execFile('node', args, { cwd: ROOT, env: { ...process.env, ...env } }, (err, stdout, stderr) =>
      err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(stdout)
    )
  );

async function evalOnce(params, i) {
  const out = path.join(tmp, `r${i}.json`);
  const args = ['bench/eval.ts', '--set', 'dev', '--now', values.now, '--json', out];
  if (params) args.push('--ranker', 'bench/rankers/semantic.ts');
  await run(args, params ? { SEMANTIC_FUSION: JSON.stringify(params) } : {});
  return JSON.parse(readFileSync(out, 'utf8')).overall;
}

const results = [{ params: 'lexical (lib/search.ts)', overall: await evalOnce(null, 'lex') }];
const queue = grid.map((p, i) => [p, i]);
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const [p, i] = job;
      results.push({ params: p, overall: await evalOnce(p, i) });
    }
  })
);
rmSync(tmp, { recursive: true, force: true });

const f = (x) => x.toFixed(3);
const label = (p) =>
  typeof p === 'string' ? p : `${p.mode} ${p.mode === 'rrf' ? `k=${p.k} ` : ''}w=${p.wSem} add>=${p.addThreshold === NONE ? 'none' : p.addThreshold}`;
console.log(`dev split, now=${values.now}, ${grid.length} combinations (+ lexical baseline)`);
console.log('params'.padEnd(34) + ['NDCG@10', 'P@5', 'MRR', 'R@10', 'FP@10'].map((h) => h.padEnd(9)).join(''));
const sorted = [results[0], ...results.slice(1).sort((a, b) => b.overall.ndcg - a.overall.ndcg || a.overall.fp - b.overall.fp)];
for (const r of sorted) {
  const o = r.overall;
  console.log(label(r.params).padEnd(34) + [o.ndcg, o.p5, o.mrr, o.recall, o.fp].map((x) => f(x).padEnd(9)).join(''));
}
if (values.out) writeFileSync(values.out, JSON.stringify(sorted, null, 2));
