// Graph reconstruction + integrity test for testdata/graph/*.
//
// This file independently rebuilds the "who is connected to whom" network from
// the raw export files (testdata/networks/full/*.zip via the real importer,
// testdata/networks/classic/*.csv via the real CSV parser) and checks the
// result against testdata/graph/*.csv and testdata/graph/expected_graph.json.
// It never imports or trusts testdata/expected/*.json (that file's ground-truth
// personId is exports.test.ts's concern, not this one's) - identity here is
// resolved the same way an outside consumer of these exports would have to.
//
// Identity-resolution rule (must match FORMAT.md's join rule for exports that
// HAVE a URL column, and is this test's own documented rule for the two that
// don't):
//   1. 18 of the 20 exports (all `full` zips and 8 of the 10 `classic` CSVs)
//      have a URL column. A row's normalizeProfileUrl(URL) is looked up
//      directly against graph/people.csv's `url` column (also normalized).
//      No URL, or a URL matching no one in people.csv -> unresolved.
//   2. The 2 `classic-legacy` CSVs (C08, C09; owners.csv `format`) predate
//      LinkedIn's URL column, so there is no URL to join on. For these,
//      identity is resolved through graph/people.csv ONLY (not through any
//      other graph/edges_*.csv file, and not through testdata/expected/*.json):
//        a. normalizePersonName(full name) is looked up against every
//           people.csv row's normalizePersonName(fullName).
//        b. Exactly one candidate -> resolved by name alone.
//        c. Zero candidates -> unresolved.
//        d. More than one candidate (people.csv has real duplicate full names)
//           -> disambiguate by company: keep candidates whose
//           currentCompanyName either string-equals (case-insensitive) or
//           lib/relationship.ts's companiesMatch()es the row's Company. Exactly
//           one survivor -> resolved by name+company. Otherwise -> unresolved.
//      This is inherently lossy: people.csv only records a person's CURRENT
//      company (as of the dataset's "today", 2026-09-28), while a `classic-
//      legacy` row records their company as of that file's own (older)
//      export date - someone who changed jobs since can fail to disambiguate.
//      A small number of unresolved rows on C08/C09 is therefore an expected
//      property of this join rule, not a generator defect; this file asserts
//      an explicit small ceiling on it instead of requiring zero.
//
// Run from the repo root:
//   node --test testdata/tests/graph.test.ts

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseLinkedInExportZip, normalizeProfileUrl, normalizePersonName, parseLinkedInDate } from '../../lib/linkedinExport.ts';
import { companiesMatch } from '../../lib/relationship.ts';
import {
  parseCsvToObjects,
  getField,
  FULL_NAME_KEYS,
  FIRST_NAME_KEYS,
  LAST_NAME_KEYS,
  COMPANY_KEYS,
  URL_KEYS,
  CONNECTED_ON_KEYS,
  CONNECTED_ON_ISO_KEYS,
  INVITED_AT_KEYS,
} from '../../lib/connectionFields.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESTDATA_DIR = path.join(__dirname, '..');

function readText(relPath: string): string {
  return readFileSync(path.join(TESTDATA_DIR, relPath), 'utf8');
}
function readBytes(relPath: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(TESTDATA_DIR, relPath)));
}
function readJson(relPath: string): any {
  return JSON.parse(readText(relPath));
}
function readCsv(relPath: string): Record<string, string>[] {
  return parseCsvToObjects(readText(relPath)) as Record<string, string>[];
}

// ---------------------------------------------------------------------------
// Load graph/*.csv + graph/expected_graph.json once.
// ---------------------------------------------------------------------------

type PersonRow = {
  personId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  url: string;
  currentCompanyName: string;
  exportsAppearingIn: string;
};
type OwnerRow = {
  datasetId: string;
  personId: string;
  fullName: string;
  url: string;
  format: string; // full | classic | classic-legacy
  community: string;
  exportDate: string;
  file: string;
  connections: string;
};
type ConnectedEdgeRow = { sourcePersonId: string; targetPersonId: string; connectedOn: string; datasetId: string };
type MessagedEdgeRow = { ownerPersonId: string; personId: string; datasetId: string; firstMessagedAt: string; lastMessagedAt: string };
type EndorsedEdgeRow = { endorserPersonId: string; endorseePersonId: string; datasetId: string; endorsedOn: string };

const people = readCsv('graph/people.csv') as unknown as PersonRow[];
const owners = readCsv('graph/owners.csv') as unknown as OwnerRow[];
const edgesConnected = readCsv('graph/edges_connected.csv') as unknown as ConnectedEdgeRow[];
const edgesMessaged = readCsv('graph/edges_messaged.csv') as unknown as MessagedEdgeRow[];
const edgesEndorsed = readCsv('graph/edges_endorsed.csv') as unknown as EndorsedEdgeRow[];
const expectedGraph = readJson('graph/expected_graph.json');

const exportDateByDataset = new Map(owners.map((o) => [o.datasetId, o.exportDate]));
const ownerByDataset = new Map(owners.map((o) => [o.datasetId, o]));

// ---------------------------------------------------------------------------
// people.csv indices used for identity resolution.
// ---------------------------------------------------------------------------

const peopleByUrl = new Map<string, string>(); // normalized url -> personId
for (const p of people) {
  const norm = normalizeProfileUrl(p.url);
  if (norm) peopleByUrl.set(norm, p.personId);
}
const peopleByNormName = new Map<string, PersonRow[]>();
for (const p of people) {
  const key = normalizePersonName(p.fullName);
  const list = peopleByNormName.get(key) ?? [];
  list.push(p);
  peopleByNormName.set(key, list);
}
function companyEquivalent(a: string, b: string): boolean {
  const na = (a || '').trim().toLowerCase();
  const nb = (b || '').trim().toLowerCase();
  if (na && na === nb) return true;
  return companiesMatch(a || '', b || '');
}

type Resolution = { personId: string; kind: 'url' | 'unique-name' | 'name+company' } | { personId: null; kind: 'unresolved' };

function resolveRow(row: Record<string, unknown>, hasUrlColumn: boolean): Resolution {
  if (hasUrlColumn) {
    const norm = normalizeProfileUrl(getField(row, URL_KEYS));
    if (!norm) return { personId: null, kind: 'unresolved' };
    const personId = peopleByUrl.get(norm);
    return personId ? { personId, kind: 'url' } : { personId: null, kind: 'unresolved' };
  }
  const full = getField(row, FULL_NAME_KEYS) || `${getField(row, FIRST_NAME_KEYS)} ${getField(row, LAST_NAME_KEYS)}`.trim();
  const candidates = peopleByNormName.get(normalizePersonName(full)) ?? [];
  if (candidates.length === 1) return { personId: candidates[0].personId, kind: 'unique-name' };
  if (candidates.length === 0) return { personId: null, kind: 'unresolved' };
  const company = getField(row, COMPANY_KEYS);
  const filtered = candidates.filter((c) => companyEquivalent(company, c.currentCompanyName));
  if (filtered.length === 1) return { personId: filtered[0].personId, kind: 'name+company' };
  return { personId: null, kind: 'unresolved' };
}

// ---------------------------------------------------------------------------
// Per-dataset independent reconstruction from the raw export files.
// ---------------------------------------------------------------------------

type DatasetRecon = {
  owner: OwnerRow;
  rowCount: number;
  edges: Map<string, string | null>; // resolved personId -> connectedOn ISO (or null if unparseable)
  unresolvedCount: number;
  dateExceedCount: number; // Connected On strictly after the file's export date
  invitedExceedCount: number; // Invited At strictly after the file's export date
};

const recon = new Map<string, DatasetRecon>();

for (const owner of owners) {
  const isFull = owner.format === 'full';
  const hasUrlColumn = owner.format !== 'classic-legacy';
  let rows: Record<string, unknown>[];
  if (isFull) {
    const result = parseLinkedInExportZip(readBytes(owner.file), path.basename(owner.file));
    rows = result.rows;
  } else {
    rows = readCsv(owner.file);
  }

  const edges = new Map<string, string | null>();
  let unresolvedCount = 0;
  let dateExceedCount = 0;
  let invitedExceedCount = 0;
  const exportDate = owner.exportDate;

  for (const row of rows) {
    const resolution = resolveRow(row, hasUrlColumn);
    const connectedOnIso = isFull ? getField(row, CONNECTED_ON_ISO_KEYS) || null : parseLinkedInDate(getField(row, CONNECTED_ON_KEYS));
    if (connectedOnIso && connectedOnIso > exportDate) dateExceedCount++;
    const invitedAt = getField(row, INVITED_AT_KEYS);
    if (invitedAt && invitedAt > exportDate) invitedExceedCount++;

    if (resolution.kind === 'unresolved') {
      unresolvedCount++;
      continue;
    }
    edges.set(resolution.personId, connectedOnIso);
  }

  recon.set(owner.datasetId, { owner, rowCount: rows.length, edges, unresolvedCount, dateExceedCount, invitedExceedCount });
}

// ---------------------------------------------------------------------------
// Global observed graph, built from graph/edges_connected.csv (the file
// expected_graph.json's own `graphDefinition` says it is derived from:
// "undirected union of owner->connection edges ... nodes = every person in
// any of the 20 datasets, owners included").
// ---------------------------------------------------------------------------

const neighbors = new Map<string, Set<string>>();
function addUndirectedEdge(a: string, b: string): void {
  if (!neighbors.has(a)) neighbors.set(a, new Set());
  if (!neighbors.has(b)) neighbors.set(b, new Set());
  neighbors.get(a)!.add(b);
  neighbors.get(b)!.add(a);
}
for (const e of edgesConnected) addUndirectedEdge(e.sourcePersonId, e.targetPersonId);

const csvEdgesByDataset = new Map<string, Map<string, string>>(); // datasetId -> target -> connectedOn
for (const e of edgesConnected) {
  const m = csvEdgesByDataset.get(e.datasetId) ?? new Map<string, string>();
  m.set(e.targetPersonId, e.connectedOn);
  csvEdgesByDataset.set(e.datasetId, m);
}

function bfsHops(a: string, b: string): number {
  if (a === b) return 0;
  const dist = new Map<string, number>([[a, 0]]);
  const queue: string[] = [a];
  while (queue.length) {
    const n = queue.shift()!;
    for (const nb of neighbors.get(n) ?? []) {
      if (!dist.has(nb)) {
        dist.set(nb, dist.get(n)! + 1);
        if (nb === b) return dist.get(nb)!;
        queue.push(nb);
      }
    }
  }
  return -1;
}

function connectedComponentCount(): number {
  const visited = new Set<string>();
  let components = 0;
  for (const node of neighbors.keys()) {
    if (visited.has(node)) continue;
    components++;
    const stack = [node];
    visited.add(node);
    while (stack.length) {
      const n = stack.pop()!;
      for (const nb of neighbors.get(n)!) {
        if (!visited.has(nb)) {
          visited.add(nb);
          stack.push(nb);
        }
      }
    }
  }
  return components;
}

// ===========================================================================
// people.csv ids / URLs unique
// ===========================================================================

describe('graph/people.csv integrity', () => {
  test('personId is unique', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const p of people) {
      if (seen.has(p.personId)) dupes.push(p.personId);
      seen.add(p.personId);
    }
    assert.deepEqual(dupes, [], `duplicate personId values: ${dupes.join(', ')}`);
  });

  test('url is unique', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const p of people) {
      if (seen.has(p.url)) dupes.push(p.url);
      seen.add(p.url);
    }
    assert.deepEqual(dupes, [], `duplicate url values: ${dupes.join(', ')}`);
  });

  test('exportsAppearingIn matches datasets-appearing-as-a-target-in derived from graph/edges_connected.csv', () => {
    // A person's exportsAppearingIn counts every OTHER dataset that lists them
    // as a connection (a dataset owner does not list themselves).
    const datasetsAppearingIn = new Map<string, Set<string>>();
    for (const e of edgesConnected) {
      const s = datasetsAppearingIn.get(e.targetPersonId) ?? new Set<string>();
      s.add(e.datasetId);
      datasetsAppearingIn.set(e.targetPersonId, s);
    }
    const mismatches: string[] = [];
    for (const p of people) {
      const actual = datasetsAppearingIn.get(p.personId)?.size ?? 0;
      const expected = Number(p.exportsAppearingIn);
      if (actual !== expected) mismatches.push(`${p.personId}: people.csv says ${expected}, edges_connected.csv implies ${actual}`);
    }
    assert.deepEqual(mismatches.slice(0, 10), [], `${mismatches.length} mismatch(es), e.g.: ${mismatches.slice(0, 10).join('; ')}`);
  });
});

// ===========================================================================
// graph/load_neo4j.cypher and graph/schema.sql: static reference check
// ===========================================================================

describe('graph reference files reference only files/columns that exist (static check)', () => {
  const CSV_HEADERS: Record<string, string[]> = {
    'people.csv': Object.keys(people[0]),
    'companies.csv': Object.keys(readCsv('graph/companies.csv')[0]),
    'schools.csv': Object.keys(readCsv('graph/schools.csv')[0]),
    'owners.csv': Object.keys(owners[0]),
    'edges_connected.csv': Object.keys(edgesConnected[0]),
    'edges_employment.csv': Object.keys(readCsv('graph/edges_employment.csv')[0]),
    'edges_education.csv': Object.keys(readCsv('graph/edges_education.csv')[0]),
    'edges_messaged.csv': Object.keys(edgesMessaged[0]),
    'edges_endorsed.csv': Object.keys(edgesEndorsed[0]),
  };

  test('load_neo4j.cypher: every LOAD CSV file and every row.<field> exists', () => {
    const cypher = readText('graph/load_neo4j.cypher');
    const blockRe = /LOAD CSV WITH HEADERS FROM 'file:\/\/\/([\w.]+)' AS row([\s\S]*?)(?=LOAD CSV WITH HEADERS FROM|\n\/\/ Example checks|$)/g;
    let match: RegExpExecArray | null;
    let blockCount = 0;
    const problems: string[] = [];
    while ((match = blockRe.exec(cypher))) {
      blockCount++;
      const [, fileName, block] = match;
      const header = CSV_HEADERS[fileName];
      if (!header) {
        problems.push(`references unknown file ${fileName}`);
        continue;
      }
      const fieldRe = /row\.(\w+)/g;
      let fieldMatch: RegExpExecArray | null;
      while ((fieldMatch = fieldRe.exec(block))) {
        const field = fieldMatch[1];
        if (!header.includes(field)) problems.push(`${fileName}: row.${field} is not a column (has: ${header.join(', ')})`);
      }
    }
    assert.ok(blockCount >= 7, `expected at least 7 LOAD CSV blocks, found ${blockCount}`);
    assert.deepEqual(problems, []);
  });

  test('schema.sql: every CREATE TABLE column list exactly matches its CSV header, in order', () => {
    const sql = readText('graph/schema.sql');
    const TABLE_TO_FILE: Record<string, string> = {
      people: 'people.csv',
      companies: 'companies.csv',
      schools: 'schools.csv',
      owners: 'owners.csv',
      edges_connected: 'edges_connected.csv',
      edges_employment: 'edges_employment.csv',
      edges_education: 'edges_education.csv',
      edges_messaged: 'edges_messaged.csv',
      edges_endorsed: 'edges_endorsed.csv',
    };
    const tableRe = /CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g;
    let match: RegExpExecArray | null;
    let tableCount = 0;
    const problems: string[] = [];
    while ((match = tableRe.exec(sql))) {
      tableCount++;
      const [, tableName, body] = match;
      const file = TABLE_TO_FILE[tableName];
      if (!file) {
        problems.push(`unknown table ${tableName}`);
        continue;
      }
      const columns = body
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !/^--/.test(l))
        .map((l) => l.split(/\s+/)[0])
        .filter((tok) => !/^(PRIMARY|CONSTRAINT|FOREIGN|UNIQUE)$/i.test(tok));
      const camel = columns.map((c) => c.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase()));
      const header = CSV_HEADERS[file];
      if (camel.join(',') !== header.join(',')) {
        problems.push(`table ${tableName} columns [${camel.join(', ')}] != ${file} header [${header.join(', ')}]`);
      }
    }
    assert.ok(tableCount >= 9, `expected at least 9 CREATE TABLE statements, found ${tableCount}`);
    assert.deepEqual(problems, []);
  });
});

// ===========================================================================
// Per-dataset: independent file reconstruction <-> graph/edges_connected.csv
// ===========================================================================

// classic-legacy (C08, C09) rows can legitimately fail to resolve under the
// documented name+company rule (see file header). Cap how much of that we'll
// tolerate before treating it as a real regression.
const MAX_UNRESOLVED_FRACTION_PER_LEGACY_DATASET = 0.02;

describe('per-dataset: raw file <-> graph/edges_connected.csv traceability', () => {
  for (const owner of owners) {
    const isLegacy = owner.format === 'classic-legacy';
    describe(`${owner.datasetId} (${owner.format}, ${owner.file})`, () => {
      const r = recon.get(owner.datasetId)!;
      const csvMap = csvEdgesByDataset.get(owner.datasetId) ?? new Map<string, string>();

      test('row count matches owners.csv connections', () => {
        assert.equal(r.rowCount, Number(owner.connections));
      });

      test('no Connected On date after this file\'s export date', () => {
        assert.equal(r.dateExceedCount, 0, `${r.dateExceedCount} row(s) had a Connected On after ${owner.exportDate}`);
      });

      test('no Invited At date after this file\'s export date', () => {
        assert.equal(r.invitedExceedCount, 0, `${r.invitedExceedCount} row(s) had an Invited At after ${owner.exportDate}`);
      });

      if (isLegacy) {
        test('unresolved row count is small (documented join-rule limitation)', () => {
          const fraction = r.unresolvedCount / r.rowCount;
          assert.ok(
            fraction <= MAX_UNRESOLVED_FRACTION_PER_LEGACY_DATASET,
            `${r.unresolvedCount}/${r.rowCount} (${(fraction * 100).toFixed(1)}%) rows unresolved, exceeds ${MAX_UNRESOLVED_FRACTION_PER_LEGACY_DATASET * 100}% ceiling`,
          );
        });
      } else {
        test('every row resolves (URL join, no ambiguity possible)', () => {
          assert.equal(r.unresolvedCount, 0, `${r.unresolvedCount} row(s) failed to resolve by URL`);
        });
      }

      test('every resolved file row is traceable to a graph/edges_connected.csv row (same target + date)', () => {
        const problems: string[] = [];
        for (const [personId, connectedOn] of r.edges) {
          if (!csvMap.has(personId)) {
            problems.push(`resolved target ${personId} has no edges_connected.csv row for ${owner.datasetId}`);
          } else if (csvMap.get(personId) !== connectedOn) {
            problems.push(`${personId}: file says connectedOn=${connectedOn}, edges_connected.csv says ${csvMap.get(personId)}`);
          }
        }
        assert.deepEqual(problems, []);
      });

      test('every graph/edges_connected.csv row for this dataset is traceable to a file row', () => {
        const untraced: string[] = [];
        for (const target of csvMap.keys()) {
          if (!r.edges.has(target)) untraced.push(target);
        }
        if (isLegacy) {
          // Untraced rows here must be explained by this dataset's own
          // unresolved-row count (the join-rule limitation documented above),
          // not by some other discrepancy.
          assert.equal(
            untraced.length,
            r.unresolvedCount,
            `${untraced.length} edges_connected.csv row(s) untraceable to a file row, but only ${r.unresolvedCount} file row(s) were unresolved`,
          );
        } else {
          assert.deepEqual(untraced, []);
        }
      });

      test('resolved edge count + unresolved row count accounts for every row', () => {
        assert.equal(r.edges.size + r.unresolvedCount, r.rowCount);
      });
    });
  }
});

// ===========================================================================
// Owner degrees
// ===========================================================================

describe('owner degrees', () => {
  for (const owner of owners) {
    test(`${owner.datasetId}: owners.csv connections == edges_connected.csv rows for this dataset == expected_graph.json degree`, () => {
      const csvCount = csvEdgesByDataset.get(owner.datasetId)?.size ?? 0;
      assert.equal(csvCount, Number(owner.connections), 'edges_connected.csv row count for dataset vs owners.csv connections');

      const expectedDataset = expectedGraph.datasets.find((d: any) => d.datasetId === owner.datasetId);
      assert.ok(expectedDataset, `no expected_graph.json datasets[] entry for ${owner.datasetId}`);
      assert.equal(expectedDataset.degree, Number(owner.connections), 'expected_graph.json degree vs owners.csv connections');
      assert.equal(expectedDataset.ownerObservedDegree, neighbors.get(owner.personId)?.size ?? 0, 'expected_graph.json ownerObservedDegree vs graph-computed degree');
    });
  }
});

// ===========================================================================
// Global graph structure vs graph/expected_graph.json
// ===========================================================================

describe('global graph structure vs expected_graph.json', () => {
  test('distinct people count', () => {
    assert.equal(neighbors.size, expectedGraph.distinctPeople);
  });

  test('connected component count', () => {
    assert.equal(connectedComponentCount(), expectedGraph.connectedComponents);
  });

  test('top-10 by observed degree', () => {
    const ranked = [...neighbors.entries()]
      .map(([personId, set]) => ({ personId, observedDegree: set.size }))
      .sort((a, b) => b.observedDegree - a.observedDegree)
      .slice(0, 10);
    const actual = ranked.map((r) => `${r.personId}:${r.observedDegree}`);
    const expected = expectedGraph.topByObservedDegree.map((r: any) => `${r.personId}:${r.observedDegree}`);
    assert.deepEqual(actual, expected);
  });

  test('every owner-pair mutual-connection count and direct-link flag (all 190 pairs)', () => {
    assert.equal(expectedGraph.ownerPairs.length, (owners.length * (owners.length - 1)) / 2);
    const problems: string[] = [];
    for (const pair of expectedGraph.ownerPairs) {
      const a = ownerByDataset.get(pair.a)!;
      const b = ownerByDataset.get(pair.b)!;
      const na = neighbors.get(a.personId) ?? new Set<string>();
      const nb = neighbors.get(b.personId) ?? new Set<string>();
      let mutual = 0;
      for (const x of na) if (nb.has(x)) mutual++;
      const directlyConnected = na.has(b.personId);
      const directInBothFiles = directlyConnected && nb.has(a.personId);
      if (mutual !== pair.mutualConnections) problems.push(`${pair.a}/${pair.b}: mutual ${mutual} != expected ${pair.mutualConnections}`);
      if (directlyConnected !== pair.directlyConnected) problems.push(`${pair.a}/${pair.b}: directlyConnected ${directlyConnected} != expected ${pair.directlyConnected}`);
      if (directInBothFiles !== pair.directInBothFiles) problems.push(`${pair.a}/${pair.b}: directInBothFiles ${directInBothFiles} != expected ${pair.directInBothFiles}`);
    }
    assert.deepEqual(problems, []);
  });

  test('all 15 shortest paths (BFS hop count)', () => {
    assert.equal(expectedGraph.shortestPaths.length, 15);
    const problems: string[] = [];
    for (const sp of expectedGraph.shortestPaths) {
      const hops = bfsHops(sp.aPersonId, sp.bPersonId);
      if (hops !== sp.hops) problems.push(`${sp.a}(${sp.aPersonId}) <-> ${sp.b}(${sp.bPersonId}): computed ${hops} hops, expected ${sp.hops}`);
    }
    assert.deepEqual(problems, []);
  });

  test('symmetry of owner-owner links: same Connected On date recorded in both files', () => {
    const bothDirectionPairs = expectedGraph.ownerPairs.filter((p: any) => p.directInBothFiles);
    assert.ok(bothDirectionPairs.length > 0, 'expected at least one mutually-direct owner pair to check');
    const problems: string[] = [];
    for (const pair of bothDirectionPairs) {
      const a = ownerByDataset.get(pair.a)!;
      const b = ownerByDataset.get(pair.b)!;
      const dateAtoB = csvEdgesByDataset.get(pair.a)?.get(b.personId);
      const dateBtoA = csvEdgesByDataset.get(pair.b)?.get(a.personId);
      if (dateAtoB !== dateBtoA) problems.push(`${pair.a}->${pair.b} connectedOn=${dateAtoB} vs ${pair.b}->${pair.a} connectedOn=${dateBtoA}`);
    }
    assert.deepEqual(problems, []);
  });
});

// ===========================================================================
// Message / endorsement date invariants (graph/edges_messaged.csv,
// graph/edges_endorsed.csv): no date after the owning dataset's export date.
// ===========================================================================

describe('edges_messaged.csv / edges_endorsed.csv date invariants', () => {
  test('no firstMessagedAt/lastMessagedAt after the dataset export date', () => {
    const problems: string[] = [];
    for (const e of edgesMessaged) {
      const exportDate = exportDateByDataset.get(e.datasetId);
      if (e.firstMessagedAt && e.firstMessagedAt > exportDate!) problems.push(`${e.datasetId}/${e.personId}: firstMessagedAt ${e.firstMessagedAt} > export ${exportDate}`);
      if (e.lastMessagedAt && e.lastMessagedAt > exportDate!) problems.push(`${e.datasetId}/${e.personId}: lastMessagedAt ${e.lastMessagedAt} > export ${exportDate}`);
    }
    assert.deepEqual(problems.slice(0, 10), []);
  });

  test('no endorsedOn after the dataset export date', () => {
    const problems: string[] = [];
    for (const e of edgesEndorsed) {
      const exportDate = exportDateByDataset.get(e.datasetId);
      if (e.endorsedOn > exportDate!) problems.push(`${e.datasetId}: endorsedOn ${e.endorsedOn} > export ${exportDate}`);
    }
    assert.deepEqual(problems.slice(0, 10), []);
  });

  test('no connectedOn (edges_connected.csv) after the dataset export date', () => {
    const problems: string[] = [];
    for (const e of edgesConnected) {
      const exportDate = exportDateByDataset.get(e.datasetId);
      if (e.connectedOn > exportDate!) problems.push(`${e.datasetId}: connectedOn ${e.connectedOn} > export ${exportDate}`);
    }
    assert.deepEqual(problems.slice(0, 10), []);
  });
});
