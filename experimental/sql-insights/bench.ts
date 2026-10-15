// Benchmark for experimental/sql-insights (Node). Prints DB build time and each
// card's query time (median of 5 runs) for the N01 testdata network (1,450
// rows) and the synthetic network at 1k and 30k rows.
//
//   node experimental/sql-insights/bench.ts

import os from 'node:os';
import initSqlJs from 'sql.js';
import { CARDS, buildInsightsDb, runReadOnlyQuery } from './insightsDb.ts';
import { loadZipNetwork, syntheticNetwork } from './fixtures.ts';

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const RUNS = 5;

const t0 = performance.now();
const SQL = await initSqlJs();
console.log(`machine: ${os.arch()} / ${os.cpus()[0]?.model} / node ${process.version}`);
console.log(`sql.js init (wasm compile): ${(performance.now() - t0).toFixed(1)} ms`);

const sets = [
  { name: 'N01 zip (testdata)', ...loadZipNetwork('N01_kavita-raghavan') },
  { name: 'synthetic 1k', ...syntheticNetwork(1_000) },
  { name: 'synthetic 30k', ...syntheticNetwork(30_000) },
];

for (const s of sets) {
  const builds: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const b0 = performance.now();
    buildInsightsDb(SQL, s.docs, s.ctx).close();
    builds.push(performance.now() - b0);
  }
  const db = buildInsightsDb(SQL, s.docs, s.ctx);
  const targets = s.ctx
    ? s.ctx.dreamCompanies.length + s.ctx.appliedCompanies.length + s.ctx.followedCompanies.length
    : 0;
  console.log(`\n${s.name}: ${s.docs.length} rows, ${targets} target companies`);
  console.log(`  build: median ${median(builds).toFixed(1)} ms (first ${builds[0].toFixed(1)} ms)`);
  for (const c of CARDS) {
    const times: number[] = [];
    let rows = 0;
    for (let i = 0; i < RUNS; i++) {
      const r = runReadOnlyQuery(db, c.sql);
      times.push(r.ms);
      rows = r.rows.length;
    }
    console.log(`  ${c.id.padEnd(26)} median ${median(times).toFixed(2).padStart(8)} ms  (${rows} rows)`);
  }
  db.close();
}
