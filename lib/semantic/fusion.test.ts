// lib/semantic/fusion.test.ts — node --test lib/semantic/fusion.test.ts
// Pure tests of the semantic stage with deterministic fake embeddings (no model, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankConnections } from '../search.ts';
import type { RankedRow } from '../search.ts';
import { DEFAULT_FUSION, SEMANTIC_CHIP, connectionText, dot, fuse, queryText, similarities } from './fusion.ts';
import { EmbeddingStore } from './store.ts';
import { semanticRank } from './semanticRank.ts';
import type { Embedder, FusionParams, RankResult, Row } from './types.ts';

const NOW = new Date('2026-10-15T12:00:00Z');
const person = (i: number, position: string, company: string, extra: Row = {}): Row => ({
  _id: `r${i}`,
  'First Name': `First${i}`,
  'Last Name': `Last${i}`,
  'Full Name': `First${i} Last${i}`,
  Position: position,
  Company: company,
  ...extra,
});

/** A lexical-shaped item, for fuse() tests that don't need the real ranker. */
const item = (row: Row, relevance: number, terms: number, chips: string[] = []): RankedRow => ({
  row,
  relevance,
  terms,
  matchedTokens: ['x'],
  reasons: [`lexical ${String(row._id)}`],
  score: relevance,
  chips,
  aiSummary: '',
});

const P = (over: Partial<FusionParams>): FusionParams => ({ ...DEFAULT_FUSION, ...over });

// Fake embedder: one axis per concept keyword, L2-normalized; counts every text it embeds.
const AXES = [/engineer|developer|programmer|coder/i, /sales|account exec/i, /chef|cook/i, /nurse|clinic/i];
function fakeEmbedder(): Embedder & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    modelId: 'fake',
    calls,
    async embed(texts) {
      calls.push([...texts]);
      return texts.map((t) => {
        const v = new Float32Array(AXES.length + 1);
        AXES.forEach((re, k) => (v[k] = re.test(t) ? 1 : 0));
        v[AXES.length] = 0.2; // shared "background" component so nothing is exactly orthogonal
        const n = Math.hypot(...v);
        return v.map((x) => x / n);
      });
    },
  };
}

test('connectionText uses title and company only, never the note', () => {
  assert.equal(connectionText(person(1, 'Chef', 'Bistro', { Note: 'secret hackathon' })), 'Chef at Bistro');
  assert.equal(connectionText(person(2, 'Chef', '')), 'Chef');
  assert.equal(connectionText(person(3, '', ' Acme  Corp ')), 'Acme Corp');
  assert.equal(connectionText(person(4, ' ', '')), '');
  assert.equal(queryText('  find   me\na cook '), 'find me a cook');
  assert.equal(queryText('x'.repeat(400)).length, 300);
});

test('dot / similarities: 0 for rows without a vector', () => {
  const q = new Float32Array([1, 0]);
  const sims = similarities([new Float32Array([0.6, 0.8]), null], q);
  assert.ok(Math.abs(sims[0] - 0.6) < 1e-6);
  assert.equal(sims[1], 0);
  assert.equal(dot([1, 2, 3], [1, 1]), 3);
});

test('tier mode with wSem 0, nothing added, no chip = exactly the lexical result', () => {
  const rows = [0, 1, 2, 3].map((i) => person(i, `T${i}`, 'C'));
  const lexical: RankResult = {
    expanded: 'q',
    roleQuery: false,
    ranked: [item(rows[2], 30, 3), item(rows[0], 25, 2), item(rows[1], 20, 2)],
  };
  const out = fuse(lexical, rows, [0.9, 0.9, 0.9, 0.99], false, null, P({ mode: 'tier', wSem: 0, maxAdded: 0, chipThreshold: 2 }), NOW);
  assert.deepEqual(out, lexical);
  for (let i = 0; i < out.ranked.length; i++) assert.equal(out.ranked[i], lexical.ranked[i]);
});

test('tier mode reorders only inside a relevance tier, by score + wSem * similarity', () => {
  const rows = [0, 1, 2, 3].map((i) => person(i, `T${i}`, 'C'));
  const lexical: RankResult = {
    expanded: 'q',
    roleQuery: false,
    ranked: [item(rows[0], 30, 3), item(rows[1], 22, 2), item(rows[2], 21, 2), item(rows[3], 20, 2)],
  };
  // rows[3] is far more similar: inside tier 2 it overtakes 1 and 2, but never the tier-3 row 0.
  const sims = [0.0, 0.1, 0.3, 0.9]; // tier-2 keys: r1 23, r2 24, r3 29
  const out = fuse(lexical, rows, sims, false, null, P({ mode: 'tier', wSem: 10, maxAdded: 0, chipThreshold: 0.5 }), NOW);
  assert.deepEqual(out.ranked.map((r) => r.row._id), ['r0', 'r3', 'r2', 'r1']);
  assert.deepEqual(out.ranked[1].chips, [SEMANTIC_CHIP]);
  assert.deepEqual(out.ranked[0].chips, []);
  assert.deepEqual(out.ranked[1].reasons, ['lexical r3'], 'lexical reasons stay unchanged');
  assert.deepEqual(lexical.ranked[3].chips, [], 'input items are not mutated');
});

test('rows the lexical ranker dropped are added only above the threshold, capped, below every lexical row in tier mode', () => {
  const rows = [0, 1, 2, 3, 4].map((i) => person(i, `T${i}`, 'C'));
  const lexical: RankResult = { expanded: 'q', roleQuery: false, ranked: [item(rows[0], 10, 1)] };
  const sims = [0.1, 0.55, 0.49, 0.8, 0.6];
  const out = fuse(lexical, rows, sims, false, null, P({ mode: 'tier', addThreshold: 0.5, maxAdded: 2, chipThreshold: 0.5 }), NOW);
  assert.deepEqual(out.ranked.map((r) => r.row._id), ['r0', 'r3', 'r4']);
  const added = out.ranked[1];
  assert.equal(added.terms, 0);
  assert.ok(added.relevance >= 1);
  assert.equal(added.relevance, 8);
  assert.deepEqual(added.matchedTokens, []);
  assert.match(added.reasons[0], /^Semantic match: similar in meaning to your search \(similarity 0\.80\)$/);
  assert.equal(added.chips[0], SEMANTIC_CHIP);
  for (const r of out.ranked) {
    for (const f of ['row', 'relevance', 'terms', 'matchedTokens', 'reasons', 'score', 'chips', 'aiSummary']) {
      assert.ok(f in r && (r as Record<string, unknown>)[f] !== undefined, `field ${f}`);
    }
  }
});

test('added rows carry their relationship signals (bonus, chips, reasons)', () => {
  const warm = person(1, 'Cook', 'Diner', { Messages: 12, 'Last Messaged': '2026-09-01', 'Recommended You': true });
  const rows = [person(0, 'X', 'Y'), warm];
  const out = fuse({ expanded: 'q', roleQuery: false, ranked: [] }, rows, [0, 0.9], false, null, P({ maxAdded: 5 }), NOW);
  assert.equal(out.ranked.length, 1);
  const r = out.ranked[0];
  assert.ok(r.score > r.relevance, 'relationship bonus is added to the score');
  assert.ok(r.chips.length > 1 && r.chips[0] === SEMANTIC_CHIP);
  assert.ok(r.reasons.some((x) => x.startsWith('Relationship:')));
});

test('strict title-only adds no semantic-only row (role query or not); loose mode does', () => {
  const rows = [person(0, '', 'Engineer Corp'), person(1, 'Developer', 'Acme')];
  for (const roleQuery of [true, false]) {
    const lexical: RankResult = { expanded: 'q', roleQuery, ranked: [] };
    const strict = fuse(lexical, rows, [0.9, 0.8], true, null, P({ maxAdded: 5 }), NOW);
    assert.deepEqual(strict.ranked, [], `roleQuery=${roleQuery}`);
    const loose = fuse(lexical, rows, [0.9, 0.8], false, null, P({ maxAdded: 5 }), NOW);
    assert.deepEqual(loose.ranked.map((r) => r.row._id), ['r0', 'r1']);
  }
  for (const mode of ['rrf', 'blend'] as const) {
    const lexical: RankResult = { expanded: 'q', roleQuery: true, ranked: [] };
    assert.deepEqual(fuse(lexical, rows, [0.9, 0.8], true, null, P({ mode, maxAdded: 5 }), NOW).ranked, [], mode);
  }
});

test('strict title-only still gives lexical rows the chip and the in-tier reordering', () => {
  const rows = [0, 1, 2, 3].map((i) => person(i, `T${i}`, 'C'));
  const lexical: RankResult = {
    expanded: 'q',
    roleQuery: true,
    ranked: [item(rows[0], 22, 2), item(rows[1], 21, 2)],
  };
  const out = fuse(lexical, rows, [0.1, 0.9, 0.95, 0.99], true, null, P({ mode: 'tier', wSem: 10, maxAdded: 10, addThreshold: 0.5, chipThreshold: 0.6 }), NOW);
  assert.deepEqual(out.ranked.map((r) => r.row._id), ['r1', 'r0'], 'r2/r3 are similar but not added; r1 overtakes r0 in the tier');
  assert.deepEqual(out.ranked[0].chips, [SEMANTIC_CHIP]);
  assert.deepEqual(out.ranked[1].chips, []);
});

test('rrf can lift a strongly similar row above a weak lexical one; blend with wSem 0 keeps the lexical order', () => {
  const rows = [0, 1, 2].map((i) => person(i, `T${i}`, 'C'));
  const lexical: RankResult = { expanded: 'q', roleQuery: false, ranked: [item(rows[0], 50, 5), item(rows[1], 5, 0)] };
  const sims = [0.1, 0.05, 0.95];
  const rrf = fuse(lexical, rows, sims, false, null, P({ mode: 'rrf', k: 1, wSem: 1, addThreshold: 0.5, maxAdded: 5 }), NOW);
  // r0: 1/2 + 1/3 ; r2: 0 + 1/2 ; r1: 1/3 + 1/4
  assert.deepEqual(rrf.ranked.map((r) => r.row._id), ['r0', 'r1', 'r2']);
  const rrf2 = fuse(lexical, rows, sims, false, null, P({ mode: 'rrf', k: 1, wSem: 2, addThreshold: 0.5, maxAdded: 5 }), NOW);
  // r0: 1/2 + 2/3 ; r2: 2/2 ; r1: 1/3 + 2/4
  assert.deepEqual(rrf2.ranked.map((r) => r.row._id), ['r0', 'r2', 'r1']);
  const blend = fuse(lexical, rows, sims, false, null, P({ mode: 'blend', wSem: 0, maxAdded: 0 }), NOW);
  assert.deepEqual(blend.ranked.map((r) => r.row._id), ['r0', 'r1']);
  // Deterministic: same input, same output.
  assert.deepEqual(fuse(lexical, rows, sims, false, null, P({ mode: 'rrf', k: 1, wSem: 2, maxAdded: 5 }), NOW), rrf2);
});

test('EmbeddingStore embeds each distinct text once and re-embeds only changed rows', async () => {
  const emb = fakeEmbedder();
  const store = new EmbeddingStore(emb, 2);
  const a = [person(0, 'Chef', 'Bistro'), person(1, 'Chef', 'Bistro'), person(2, 'Nurse', 'Clinic'), person(3, '', '')];
  const va = await store.vectorsForRows(a);
  assert.equal(va[3], null);
  assert.equal(va[0], va[1], 'shared title + company share one vector');
  assert.deepEqual(emb.calls, [['Chef at Bistro', 'Nurse at Clinic']]);
  assert.equal(await store.vectorsForRows(a), va, 'same array: memoized');
  const b = [...a.slice(0, 2), person(2, 'Sales Lead', 'Acme')];
  await store.vectorsForRows(b);
  assert.deepEqual(emb.calls.at(-1), ['Sales Lead at Acme'], 'new dataset: only the changed text is embedded');
});

test('semanticRank: a synonym the lexical ranker misses is added with a Semantic match chip; lexical rows keep their place', async () => {
  const rows = [
    person(0, 'Software Engineer', 'Acme'),
    person(1, 'Line Cook', 'Diner'),
    person(2, 'Registered Nurse', 'Clinic'),
    person(3, 'Account Executive', 'Acme'),
  ];
  const store = new EmbeddingStore(fakeEmbedder());
  const lexical = rankConnections(rows, 'software engineer', false, null);
  const fused = await semanticRank(rows, 'software engineer', false, null, store, P({ mode: 'tier', wSem: 10, addThreshold: 0.5 }));
  assert.equal(fused.ranked[0].row, lexical.ranked[0].row);
  assert.ok(fused.ranked[0].chips.includes(SEMANTIC_CHIP));

  // "programmer": the fake embedder maps it to the engineer axis.
  const q = 'programmer';
  const lex2 = rankConnections(rows, q, false, null);
  const fused2 = await semanticRank(rows, q, false, null, store, P({ mode: 'tier', addThreshold: 0.5 }));
  assert.ok(!lex2.ranked.some((r) => r.row === rows[0]) || lex2.ranked[0].row === rows[0]);
  const top = fused2.ranked.find((r) => r.row === rows[0]);
  assert.ok(top && top.chips.includes(SEMANTIC_CHIP));
  assert.ok(!fused2.ranked.some((r) => r.row === rows[1]), 'the cook is not similar enough to be added');
  // Blank query: exactly the lexical result.
  assert.deepEqual(await semanticRank(rows, '   ', false, null, store), rankConnections(rows, '   ', false, null));
});

test('EmbeddingStore with a tiny maxEntries: evicts oldest-first and every call still gets all its vectors', async () => {
  const emb = fakeEmbedder();
  const store = new EmbeddingStore(emb, 2, 2);
  const texts = ['Chef', 'Nurse', 'Sales', 'Engineer', 'Cook'];
  const expected = await fakeEmbedder().embed(texts);
  const got = await store.vectorsForTexts(texts);
  assert.deepEqual(got, expected, 'all five vectors although the cache holds two');
  assert.equal(store.size, 2);
  const again = await store.vectorsForTexts(['Engineer', 'Cook', 'Chef']);
  assert.deepEqual(again, [expected[3], expected[4], expected[0]]);
  assert.deepEqual(emb.calls.at(-1), ['Chef'], 'the two newest were cached; the evicted one is re-embedded');
  // Rows: 3 distinct texts, cache of 1.
  const tiny = new EmbeddingStore(fakeEmbedder(), 1, 1);
  const rows = [person(0, 'Chef', 'Bistro'), person(1, 'Nurse', 'Clinic'), person(2, 'Chef', 'Bistro'), person(3, 'Sales', 'Acme')];
  const v = await tiny.vectorsForRows(rows);
  assert.ok(v.every((x) => x instanceof Float32Array));
  assert.equal(v[0], v[2]);
  assert.equal(tiny.size, 1);
});

test('EmbeddingStore: a concurrent call that evicts entries cannot take vectors from an in-flight call', async () => {
  const base = fakeEmbedder();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let holdNext = false;
  const emb: Embedder = {
    modelId: 'gated',
    async embed(texts) {
      if (holdNext) {
        holdNext = false;
        await gate;
      }
      return base.embed(texts);
    },
  };
  const store = new EmbeddingStore(emb, 1, 2);
  const [chef] = await store.vectorsForTexts(['Chef']); // cached
  holdNext = true;
  const a = store.vectorsForTexts(['Chef', 'Nurse']); // 'Chef' looked up now, 'Nurse' waits on the gate
  await new Promise((r) => setTimeout(r, 0));
  const b = await store.vectorsForTexts(['Sales', 'Engineer', 'Cook']); // evicts 'Chef'
  assert.equal(b.length, 3);
  release();
  const got = await a;
  assert.equal(got[0], chef, 'the vector looked up at the start of the call');
  assert.deepEqual(got[1], (await fakeEmbedder().embed(['Nurse']))[0]);
  assert.ok(store.size <= 2);
});
