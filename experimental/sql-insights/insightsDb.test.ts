// Tests for experimental/sql-insights/insightsDb.ts (feature key sql-insights).
//
// Run from the repo root:
//   node --test experimental/sql-insights/insightsDb.test.ts
//
// Data: testdata/ networks (N04 zip, N01 zip, C01 classic CSV) and a
// deterministic synthetic 30k-row network built in fixtures.ts.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { companiesMatch } from '../../lib/relationship.ts';
import type { Database, SqlJsStatic, SqlValue } from 'sql.js';

import {
  CARDS,
  MAX_ROWS,
  QueryRefused,
  SCHEMA,
  buildInsightsDb,
  checkQueryText,
  companyHead,
  isOnlyTrivia,
  runReadOnlyQuery,
} from './insightsDb.ts';
import {
  SYNTHETIC_NOTE_MARKER,
  loadCsvNetwork,
  REPO,
  loadZipNetwork,
  syntheticNetwork,
} from './fixtures.ts';

let SQL: SqlJsStatic;
before(async () => {
  SQL = await initSqlJs();
});

function count(db: Database, sql: string): number {
  return Number(db.exec(sql)[0].values[0][0]);
}

function allCells(db: Database): string[] {
  const out: string[] = [];
  for (const t of SCHEMA) {
    for (const r of db.exec(`SELECT * FROM ${t.name}`)) {
      for (const row of r.values) for (const v of row) if (typeof v === 'string') out.push(v);
    }
  }
  return out;
}

describe('schema', () => {
  test('tables and columns match SCHEMA; no note column', () => {
    const { docs, ctx } = loadZipNetwork('N04_kristine-chua');
    const db = buildInsightsDb(SQL, docs, ctx);
    try {
      const tables = db
        .exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")[0]
        .values.map((r) => r[0]);
      assert.deepEqual(tables, SCHEMA.map((t) => t.name).sort());
      for (const t of SCHEMA) {
        const cols = db.exec(`SELECT name FROM pragma_table_info('${t.name}')`)[0].values.map((r) => r[0]);
        assert.deepEqual(cols, t.columns.map((c) => c.name), t.name);
      }
      const connCols = SCHEMA[0].columns.map((c) => c.name);
      assert.ok(!connCols.includes('note'));
      assert.ok(connCols.includes('has_note'));
      // One column per ConnectionDoc field (note -> has_note) plus id.
      assert.equal(connCols.length, Object.keys(docs[0]).length + 1);
    } finally {
      db.close();
    }
  });

  test('N04 zip: row counts, has_note, context tables', () => {
    const { docs, ctx } = loadZipNetwork('N04_kristine-chua');
    assert.ok(ctx);
    const db = buildInsightsDb(SQL, docs, ctx);
    try {
      assert.equal(count(db, 'SELECT COUNT(*) FROM connections'), docs.length);
      const withNote = docs.filter((d) => d.note && d.note.trim()).length;
      assert.ok(withNote > 0, 'fixture has notes');
      assert.equal(count(db, 'SELECT SUM(has_note) FROM connections'), withNote);
      assert.equal(
        count(db, 'SELECT COUNT(*) FROM connections WHERE message_count IS NOT NULL'),
        docs.filter((d) => d.messageCount != null).length
      );
      assert.equal(count(db, 'SELECT COUNT(*) FROM my_positions'), ctx.positions.length);
      assert.equal(count(db, 'SELECT COUNT(*) FROM my_skills'), ctx.skills.length);
      assert.equal(
        count(db, 'SELECT COUNT(*) FROM target_companies'),
        ctx.dreamCompanies.length + ctx.appliedCompanies.length + ctx.followedCompanies.length
      );
    } finally {
      db.close();
    }
  });

  test('classic CSV: connected_on is parsed from the raw date', () => {
    const docs = loadCsvNetwork('C01_fang-chen');
    assert.ok(docs.every((d) => d.connectedOn === null));
    const db = buildInsightsDb(SQL, docs, null);
    try {
      assert.equal(count(db, 'SELECT COUNT(*) FROM connections'), docs.length);
      assert.equal(
        count(db, "SELECT COUNT(*) FROM connections WHERE connected_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'"),
        docs.filter((d) => d.connectedOnRaw).length
      );
      assert.equal(count(db, 'SELECT COUNT(*) FROM target_companies'), 0);
    } finally {
      db.close();
    }
  });

  test('note text never enters the database', () => {
    const zip = loadZipNetwork('N04_kristine-chua');
    const synth = syntheticNetwork(2000);
    for (const { docs, ctx } of [zip, synth]) {
      const notes = docs.map((d) => d.note).filter((n): n is string => !!n && n.trim().length >= 8);
      assert.ok(notes.length > 0);
      const db = buildInsightsDb(SQL, docs, ctx);
      try {
        const cells = allCells(db);
        for (const n of notes) assert.ok(!cells.some((c) => c.includes(n)), 'note text found in a cell');
        assert.ok(!cells.some((c) => c.includes(SYNTHETIC_NOTE_MARKER)));
        // Byte-level: the serialized database file holds no note text either.
        const bytes = Buffer.from(db.export()).toString('latin1');
        for (const n of notes) assert.ok(!bytes.includes(Buffer.from(n, 'utf8').toString('latin1')));
        assert.ok(!bytes.includes(SYNTHETIC_NOTE_MARKER));
      } finally {
        db.close();
      }
    }
  });
});

describe('statement guard', () => {
  let db: Database;
  let rows: number;
  before(() => {
    const { docs, ctx } = loadZipNetwork('N04_kristine-chua');
    rows = docs.length;
    db = buildInsightsDb(SQL, docs, ctx);
  });

  const allowed = [
    'SELECT COUNT(*) FROM connections',
    'select company from connections limit 3',
    'WITH x AS (SELECT company FROM connections) SELECT COUNT(*) FROM x',
    '  -- a comment\n/* another */ SELECT 1',
    'SELECT 1;',
    'SELECT 1; -- trailing comment\n ;  ',
    "SELECT * FROM pragma_table_info('connections')",
  ];
  for (const sql of allowed) {
    test(`allows: ${JSON.stringify(sql)}`, () => {
      assert.deepEqual(checkQueryText(sql), { ok: true });
      const r = runReadOnlyQuery(db, sql);
      assert.ok(r.columns.length > 0);
    });
  }

  const refusedByKeyword = [
    "INSERT INTO connections (id) VALUES (99999)",
    "UPDATE connections SET company = 'x'",
    'DELETE FROM connections',
    'DROP TABLE connections',
    'PRAGMA query_only = OFF',
    "ATTACH DATABASE ':memory:' AS other",
    'CREATE TABLE t (x)',
    'VACUUM',
    'EXPLAIN SELECT 1',
    'REPLACE INTO connections (id) VALUES (1)',
    '/* SELECT */ DELETE FROM connections',
    '',
    '   -- only a comment',
  ];
  for (const sql of refusedByKeyword) {
    test(`refuses: ${JSON.stringify(sql)}`, () => {
      assert.equal(checkQueryText(sql).ok, false);
      assert.throws(() => runReadOnlyQuery(db, sql), QueryRefused);
      assert.equal(count(db, 'SELECT COUNT(*) FROM connections'), rows);
    });
  }

  const multi = [
    'SELECT 1; SELECT 2',
    'SELECT 1; DELETE FROM connections',
    'SELECT 1; PRAGMA query_only = OFF',
    "SELECT 1;\nATTACH DATABASE ':memory:' AS other",
    'SELECT 1 /* c */ ; DROP TABLE connections',
  ];
  for (const sql of multi) {
    test(`refuses two statements: ${JSON.stringify(sql)}`, () => {
      assert.throws(() => runReadOnlyQuery(db, sql), (e: unknown) => e instanceof QueryRefused && /one statement/.test(e.message));
      assert.equal(count(db, 'SELECT COUNT(*) FROM connections'), rows);
      assert.equal(count(db, 'PRAGMA query_only'), 1);
    });
  }

  test('query_only blocks writes that get past the text check', () => {
    // WITH ... DELETE passes the keyword check; PRAGMA query_only stops it.
    assert.throws(
      () => runReadOnlyQuery(db, 'WITH x AS (SELECT 1) DELETE FROM connections'),
      (e: unknown) => e instanceof Error && !(e instanceof QueryRefused) && /readonly/i.test(e.message)
    );
    // Guard bypassed entirely: the connection itself refuses every write.
    for (const sql of [
      'DELETE FROM connections',
      "UPDATE connections SET company = 'x'",
      'INSERT INTO connections (id) VALUES (99999)',
      'DROP TABLE connections',
      'CREATE TABLE t (x)',
    ]) {
      assert.throws(() => db.run(sql), /readonly/i, sql);
    }
    assert.equal(count(db, 'SELECT COUNT(*) FROM connections'), rows);
  });

  test('SQL errors surface as plain Errors', () => {
    assert.throws(
      () => runReadOnlyQuery(db, 'SELECT nope FROM connections'),
      (e: unknown) => e instanceof Error && !(e instanceof QueryRefused) && /no such column/.test(e.message)
    );
    assert.throws(() => runReadOnlyQuery(db, 'SELEC 1'), QueryRefused);
  });

  test(`caps results at ${MAX_ROWS} rows and says so`, () => {
    const over = runReadOnlyQuery(
      db,
      'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c LIMIT 1000) SELECT x FROM c'
    );
    assert.equal(over.rows.length, MAX_ROWS);
    assert.equal(over.capped, true);
    const exact = runReadOnlyQuery(
      db,
      `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c LIMIT ${MAX_ROWS}) SELECT x FROM c`
    );
    assert.equal(exact.rows.length, MAX_ROWS);
    assert.equal(exact.capped, false);
  });

  test('isOnlyTrivia', () => {
    assert.ok(isOnlyTrivia(''));
    assert.ok(isOnlyTrivia(' ; -- x\n /* y */ ;'));
    assert.ok(!isOnlyTrivia(' ; SELECT 1'));
    assert.ok(!isOnlyTrivia('/* x */ DROP TABLE t'));
  });
});

describe('ready-made cards', () => {
  test('ids are unique and every card starts with SELECT or WITH', () => {
    assert.equal(new Set(CARDS.map((c) => c.id)).size, CARDS.length);
    assert.ok(CARDS.length >= 5 && CARDS.length <= 7);
    for (const c of CARDS) assert.deepEqual(checkQueryText(c.sql), { ok: true }, c.id);
  });

  const datasets: { name: string; load: () => { docs: any[]; ctx: any } }[] = [
    { name: 'N04 zip', load: () => loadZipNetwork('N04_kristine-chua') },
    { name: 'N01 zip', load: () => loadZipNetwork('N01_kavita-raghavan') },
    { name: 'C01 csv', load: () => ({ docs: loadCsvNetwork('C01_fang-chen'), ctx: null }) },
    { name: 'synthetic 30k', load: () => syntheticNetwork(30_000) },
    { name: 'empty', load: () => ({ docs: [], ctx: null }) },
  ];
  for (const ds of datasets) {
    test(`every card runs on ${ds.name}`, () => {
      const { docs, ctx } = ds.load();
      const db = buildInsightsDb(SQL, docs, ctx);
      try {
        for (const c of CARDS) {
          const r = runReadOnlyQuery(db, c.sql);
          assert.ok(r.columns.length >= 2, c.id);
          assert.equal(r.capped, false, c.id);
          if (docs.length && c.id !== 'target-companies' && c.id !== 'most-messaged-companies') {
            assert.ok(r.rows.length > 0, `${c.id} returned rows on ${ds.name}`);
          }
          if (c.view === 'bar') {
            for (const row of r.rows) assert.equal(typeof row[1], 'number', `${c.id} value column`);
          }
        }
      } finally {
        db.close();
      }
    });
  }

  test('card answers agree with plain JS (N04)', () => {
    const { docs, ctx } = loadZipNetwork('N04_kristine-chua');
    const db = buildInsightsDb(SQL, docs, ctx);
    try {
      const byId = (id: string): SqlValue[][] => runReadOnlyQuery(db, CARDS.find((c) => c.id === id)!.sql).rows;

      const counts = new Map<string, number>();
      for (const d of docs) if (d.company) counts.set(d.company, (counts.get(d.company) ?? 0) + 1);
      const top = Math.max(...counts.values());
      assert.equal(byId('top-companies')[0][1], top);

      const buckets = byId('message-buckets');
      assert.equal(buckets.reduce((s, r) => s + Number(r[1]), 0), docs.length);
      const never = buckets.find((r) => r[0] === 'never');
      assert.equal(never?.[1], docs.filter((d) => !d.messageCount).length);

      const perYear = byId('per-year');
      assert.equal(perYear.reduce((s, r) => s + Number(r[1]), 0), docs.filter((d) => d.connectedOn).length);

      assert.ok(byId('most-messaged-companies').length > 0);
      assert.ok(byId('target-companies').length > 0, 'N04 has connections at target companies');

      const recent = byId('recently-connected');
      const latest = docs.map((d) => d.connectedOn).filter(Boolean).sort().at(-1);
      assert.equal(recent[0][3], latest);
    } finally {
      db.close();
    }
  });
});

describe('company_head prefilter', () => {
  test('companiesMatch implies equal heads (all testdata zips, connections x targets/positions)', () => {
    const zips = readdirSync(path.join(REPO, 'testdata', 'networks', 'full'))
      .filter((f) => f.endsWith('.zip'))
      .map((f) => f.replace(/\.zip$/, ''));
    assert.equal(zips.length, 10);
    let pairs = 0;
    let matches = 0;
    const extra = ['The Walt Disney Company', 'Walt Disney', 'Café Nero Ltd', 'Cafe Nero', "McDonald's", 'McDonalds Corp', 'the the Co', 'Self-Employed'];
    for (const z of zips) {
      const { docs, ctx } = loadZipNetwork(z);
      const companies = [...new Set([...docs.map((d) => d.company).filter((c): c is string => !!c), ...extra])];
      const targets = ctx
        ? [...ctx.dreamCompanies, ...ctx.appliedCompanies, ...ctx.followedCompanies, ...ctx.positions.map((p) => p.company), ...extra]
        : extra;
      for (const a of companies) {
        for (const b of targets) {
          pairs++;
          if (companiesMatch(a, b)) {
            matches++;
            assert.equal(companyHead(a), companyHead(b), `${a} ~ ${b}`);
          }
        }
      }
    }
    assert.ok(matches > 50, `matches=${matches} of ${pairs}`);
  });

  test('target-companies card equals the brute-force companies_match join (N01, synthetic 3k)', () => {
    const brute = `WITH cc AS (SELECT company, COUNT(*) AS n FROM connections WHERE company IS NOT NULL GROUP BY company)
SELECT t.company AS target, t.list, SUM(cc.n) AS connections
FROM target_companies t JOIN cc ON companies_match(cc.company, t.company)
GROUP BY t.company, t.list ORDER BY t.list, target`;
    const card = CARDS.find((c) => c.id === 'target-companies')!;
    const fast = `SELECT target, list, connections FROM (${card.sql.replace(/LIMIT \d+\s*$/, '')}) ORDER BY list, target`;
    for (const { docs, ctx } of [loadZipNetwork('N01_kavita-raghavan'), syntheticNetwork(3_000)]) {
      const db = buildInsightsDb(SQL, docs, ctx);
      try {
        const a = runReadOnlyQuery(db, brute, 100_000);
        const b = runReadOnlyQuery(db, fast, 100_000);
        assert.ok(a.rows.length > 0);
        assert.deepEqual(b.rows, a.rows);
      } finally {
        db.close();
      }
    }
  });
});
