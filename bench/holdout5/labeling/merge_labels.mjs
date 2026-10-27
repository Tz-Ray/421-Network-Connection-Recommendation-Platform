// Merges two independent label files for holdout 5 and writes the adjudication worksheet.
//
//   node bench/holdout5/labeling/merge_labels.mjs <labels_A.json> <labels_B.json> [--out <dir>]
//       -> <dir>/ADJUDICATION_WORKSHEET.md, <dir>/merge_draft.json, <dir>/decisions.template.json
//   node bench/holdout5/labeling/merge_labels.mjs <labels_A.json> <labels_B.json> --decisions <file> [--write-qrels]
//       -> checks that every pending pair has a decision; with --write-qrels writes bench/holdout5/qrels.json
//
// Merge rule (the one holdouts 2-4 used):
//   A == B                      -> kept
//   |A-B| == 1, both >= 1       -> round half up of the mean (1/2 -> 2, 2/3 -> 3)
//   0 vs 1                      -> pending: 1 unless the row is plainly off-intent (adjudicator decides)
//   |A-B| >= 2                  -> pending: adjudicated from the intent and the row
//   graded by a labeler but not shown to that query's labelers (out of pool) -> pending
// Audit rows (random rows outside the pool rule, see build_pools.mjs) graded > 0 by either labeler are listed
// as evidence that the pool rule missed relevant people.
// <dir> defaults to this folder (bench/holdout5/labeling). Default (no --decisions) never writes qrels.json.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const HERE = import.meta.dirname;
const H5 = path.join(HERE, '..');
const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    decisions: { type: 'string' },
    'write-qrels': { type: 'boolean', default: false },
  },
});
if (positionals.length !== 2) {
  console.error('usage: merge_labels.mjs <labels_A.json> <labels_B.json> [--out <dir>] [--decisions <file> [--write-qrels]]');
  process.exit(2);
}
const OUTDIR = path.resolve(opts.out ?? HERE);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const rows = readJson(path.join(H5, 'connections.json'));
const queries = readJson(path.join(H5, 'queries.json'));
const manifest = readJson(path.join(HERE, 'pool_manifest.json')).pools;
const byId = new Map(rows.map((r) => [r._id, r]));
const qText = Object.fromEntries(queries.map((q) => [q.id, q]));
const qids = queries.map((q) => q.id);

// ---------------------------------------------------------------- load and validate
const warnings = [];
function loadLabels(file, tag) {
  const raw = readJson(file);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${tag}: top level must be an object`);
  const out = {};
  for (const k of Object.keys(raw)) if (!qText[k]) throw new Error(`${tag}: unknown query id ${k}`);
  for (const q of qids) {
    const v = raw[q];
    out[q] = {};
    if (v === undefined) { warnings.push(`${tag}: query ${q} missing (treated as no relevant rows)`); continue; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${tag}: ${q} must be an object`);
    for (const [id, g] of Object.entries(v)) {
      if (!byId.has(id)) throw new Error(`${tag}: ${q}: unknown row id ${id}`);
      if (!Number.isInteger(g) || g < 0 || g > 3) throw new Error(`${tag}: ${q}/${id}: grade must be an integer 0-3, got ${JSON.stringify(g)}`);
      if (g === 0) { warnings.push(`${tag}: ${q}/${id}: grade 0 listed (ignored)`); continue; }
      out[q][id] = g;
    }
  }
  return out;
}
const A = loadLabels(positionals[0], 'A');
const B = loadLabels(positionals[1], 'B');

// ---------------------------------------------------------------- compare
const confusion = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
let poolPairs = 0, poolExact = 0, poolWithin1 = 0;
let unionPairs = 0, unionExact = 0, unionWithin1 = 0;
const auto = {};
const pending = [];
const rounded = [];
const auditHits = [];
const outOfPool = [];

for (const q of qids) {
  auto[q] = {};
  const shown = new Set([...manifest[q].rule, ...manifest[q].audit]);
  const audit = new Set(manifest[q].audit);
  for (const id of shown) {
    const a = A[q][id] ?? 0, b = B[q][id] ?? 0;
    poolPairs++; confusion[a][b]++;
    if (a === b) poolExact++;
    if (Math.abs(a - b) <= 1) poolWithin1++;
    if (a || b) {
      unionPairs++;
      if (a === b) unionExact++;
      if (Math.abs(a - b) <= 1) unionWithin1++;
    }
    if (audit.has(id) && (a || b)) auditHits.push({ q, id, a, b });
    if (!a && !b) continue;
    if (a === b) auto[q][id] = a;
    else if (Math.abs(a - b) === 1 && a >= 1 && b >= 1) {
      auto[q][id] = Math.max(a, b); // round half up of the mean
      rounded.push({ q, id, a, b, final: Math.max(a, b) });
    } else pending.push({ q, id, a, b, kind: Math.abs(a - b) >= 2 ? 'gap>=2' : '0-vs-1' });
  }
  for (const id of new Set([...Object.keys(A[q]), ...Object.keys(B[q])])) {
    if (shown.has(id)) continue;
    const a = A[q][id] ?? 0, b = B[q][id] ?? 0;
    outOfPool.push({ q, id, a, b });
    pending.push({ q, id, a, b, kind: 'out-of-pool' });
  }
}

// quadratic-weighted Cohen's kappa over every shown pair
function weightedKappa(m) {
  const n = m.flat().reduce((x, y) => x + y, 0);
  if (!n) return NaN;
  const rowS = m.map((r) => r.reduce((x, y) => x + y, 0));
  const colS = [0, 1, 2, 3].map((j) => m.reduce((x, r) => x + r[j], 0));
  let obs = 0, exp = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const w = ((i - j) ** 2) / 9;
    obs += w * m[i][j] / n;
    exp += w * (rowS[i] * colS[j]) / (n * n);
  }
  return exp ? 1 - obs / exp : NaN;
}
const kappa = weightedKappa(confusion);
const pct = (x, n) => (n ? `${x} / ${n} = ${(100 * x / n).toFixed(1)}%` : 'n/a');

// ---------------------------------------------------------------- finalize mode
if (opts.decisions) {
  const dec = readJson(opts.decisions);
  const missing = [];
  const final = JSON.parse(JSON.stringify(auto));
  for (const p of pending) {
    const g = dec?.[p.q]?.[p.id];
    if (!Number.isInteger(g) || g < 0 || g > 3) { missing.push(`${p.q}/${p.id}`); continue; }
    if (g > 0) final[p.q][p.id] = g;
  }
  if (missing.length) {
    console.error(`${missing.length} pending pairs have no valid decision (integer 0-3): ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ' ...' : ''}`);
    process.exit(1);
  }
  const thin = qids.filter((q) => !Object.values(final[q]).some((g) => g >= 2));
  if (thin.length) console.warn(`warning: no grade-2/3 row for ${thin.join(', ')}`);
  const qrels = Object.fromEntries(qids.map((q) => [q, Object.fromEntries(Object.entries(final[q]).sort(([x], [y]) => (x < y ? -1 : 1)))]));
  const dist = { 1: 0, 2: 0, 3: 0 };
  for (const q of qids) for (const g of Object.values(qrels[q])) dist[g]++;
  console.log(`decisions complete for ${pending.length} pending pairs; grade distribution 3=${dist[3]} 2=${dist[2]} 1=${dist[1]}`);
  if (opts['write-qrels']) {
    fs.writeFileSync(path.join(H5, 'qrels.json'), JSON.stringify(qrels, null, 2) + '\n');
    console.log(`wrote ${path.join(H5, 'qrels.json')}`);
  } else console.log('dry run: add --write-qrels to write bench/holdout5/qrels.json');
  process.exit(0);
}

// ---------------------------------------------------------------- worksheet
const rowText = (id) => {
  const r = byId.get(id);
  const t = `${r.Position || '(no title)'} @ ${r.Company || '(no company)'}`;
  return (r.Note ? `${t} — note: ${r.Note}` : t).replace(/\|/g, '/');
};
const table = (items) => [
  '| Query | Row | Title @ Company | A | B | Final | Reason |',
  '|---|---|---|---|---|---|---|',
  ...items.map((p) => `| ${p.q} "${qText[p.q].text}" | ${p.id} | ${rowText(p.id)} | ${p.a} | ${p.b} |  |  |`),
];
const kinds = (k) => pending.filter((p) => p.kind === k);
const perQuery = qids.map((q) => {
  const c = { 1: 0, 2: 0, 3: 0 };
  for (const g of Object.values(auto[q])) c[g]++;
  const pend = pending.filter((p) => p.q === q).length;
  return `| ${q} | ${qText[q].text} | ${manifest[q].rule.length + manifest[q].audit.length} | ${c[3]} | ${c[2]} | ${c[1]} | ${pend} |`;
});

const md = [
  '# Holdout 5 adjudication worksheet',
  '',
  `Inputs: \`${path.basename(positionals[0])}\` (A), \`${path.basename(positionals[1])}\` (B), the pools in \`pool_manifest.json\`.`,
  'Fill in Final (0-3) and Reason for every pending row, copy the finals into a decisions file shaped like',
  '`decisions.template.json`, then run `merge_labels.mjs A B --decisions <file> --write-qrels`.',
  '',
  '## Agreement',
  '',
  `- Pairs shown to labelers (every query x every candidate in its pool, absent = 0): ${poolPairs}`,
  `- Exact agreement, all shown pairs: ${pct(poolExact, poolPairs)} (inflated by agreed zeros)`,
  `- Pairs graded > 0 by at least one labeler: ${unionPairs}; exact: ${pct(unionExact, unionPairs)}; within one grade: ${pct(unionWithin1, unionPairs)}`,
  `- Within one grade, all shown pairs: ${pct(poolWithin1, poolPairs)}`,
  `- Quadratic-weighted Cohen's kappa, all shown pairs: ${Number.isNaN(kappa) ? 'n/a' : kappa.toFixed(3)}`,
  '',
  'Confusion (rows = A, columns = B, grades 0-3):',
  '',
  '| A \\ B | 0 | 1 | 2 | 3 |',
  '|---|---|---|---|---|',
  ...confusion.map((r, i) => `| ${i} | ${r.join(' | ')} |`),
  '',
  '## Pool check (audit rows)',
  '',
  `Each query's pool included ${manifest[qids[0]].audit.length} random rows from outside its pool rule. Audit rows graded > 0 by either labeler: ${auditHits.length}.`,
  auditHits.length ? 'A hit means the rule may have missed relevant people for that query; consider widening the rule and re-labeling.' : 'None: no evidence that the pool rules missed relevant people.',
  '',
  ...(auditHits.length ? [
    '| Query | Row | Title @ Company | A | B |', '|---|---|---|---|---|',
    ...auditHits.map((h) => `| ${h.q} "${qText[h.q].text}" | ${h.id} | ${rowText(h.id)} | ${h.a} | ${h.b} |`), '',
  ] : []),
  '## Auto-merged',
  '',
  `- Agreed pairs kept as is: ${Object.values(auto).reduce((n, o) => n + Object.keys(o).length, 0) - rounded.length}`,
  `- |A-B| = 1 with both >= 1, rounded half up: ${rounded.length}`,
  rounded.length ? `  ${rounded.map((r) => `${r.q}/${r.id} ${r.a}/${r.b}->${r.final}`).join('; ')}` : '',
  '',
  '| Query | Text | Shown | auto 3 | auto 2 | auto 1 | pending |',
  '|---|---|---|---|---|---|---|',
  ...perQuery,
  '',
  `## Pending: |A-B| >= 2 (${kinds('gap>=2').length})`,
  '',
  ...table(kinds('gap>=2')),
  '',
  `## Pending: 0 vs 1 (${kinds('0-vs-1').length}) — 1 unless plainly off-intent`,
  '',
  ...table(kinds('0-vs-1')),
  '',
  `## Pending: graded but not in that query's pool (${kinds('out-of-pool').length})`,
  '',
  ...table(kinds('out-of-pool')),
  '',
  ...(warnings.length ? ['## Warnings', '', ...warnings.map((w) => `- ${w}`), ''] : []),
];
fs.mkdirSync(OUTDIR, { recursive: true });
fs.writeFileSync(path.join(OUTDIR, 'ADJUDICATION_WORKSHEET.md'), md.join('\n'));
fs.writeFileSync(path.join(OUTDIR, 'merge_draft.json'), JSON.stringify({ auto, pending, rounded, auditHits }, null, 1) + '\n');
const template = {};
for (const p of pending) (template[p.q] ??= {})[p.id] = null;
fs.writeFileSync(path.join(OUTDIR, 'decisions.template.json'), JSON.stringify(template, null, 1) + '\n');
console.log(`shown pairs ${poolPairs}; labeled by either ${unionPairs}; exact ${pct(unionExact, unionPairs)}; kappa(q) ${Number.isNaN(kappa) ? 'n/a' : kappa.toFixed(3)}`);
console.log(`auto-merged ${Object.values(auto).reduce((n, o) => n + Object.keys(o).length, 0)}; pending ${pending.length} (gap>=2 ${kinds('gap>=2').length}, 0-vs-1 ${kinds('0-vs-1').length}, out-of-pool ${kinds('out-of-pool').length}); audit hits ${auditHits.length}`);
console.log(`wrote ${path.join(OUTDIR, 'ADJUDICATION_WORKSHEET.md')}, merge_draft.json, decisions.template.json`);
if (warnings.length) console.log(`${warnings.length} warnings (listed in the worksheet)`);
