// Graph exports (node/edge CSVs, Neo4j loader, portable SQL DDL) and the
// precomputed answers graph tests assert against.

import { csvText, iso } from './text.mjs';
import { activePosition } from './universe.mjs';

export function buildGraphFiles(W, people, datasets, sets, fullResults, today) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const appearIn = new Map();
  for (const d of datasets) for (const id of sets.get(d.id)) appearIn.set(id, (appearIn.get(id) || 0) + 1);
  const files = [];
  const bool = (b) => (b ? 'true' : 'false');

  const peopleRows = people.map((p) => {
    const cur = activePosition(p, today);
    return [p.id, p.first, p.last, p.fullName, p.url, p.slug, p.home, p.second || '', p.functionId, p.seniorityId, p.industryId,
      cur ? cur.companyId : '', cur ? cur.companyName : '', cur ? cur.title : '', p.location, p.email || '',
      bool(!!p.ownerOf), p.ownerOf || '', String(appearIn.get(p.id) || 0)];
  });
  files.push({ path: 'graph/people.csv', rows: peopleRows.length, text: csvText(
    ['personId', 'firstName', 'lastName', 'fullName', 'url', 'slug', 'homeCommunity', 'secondCommunity', 'functionId', 'seniorityId', 'industryId',
      'currentCompanyId', 'currentCompanyName', 'currentTitle', 'location', 'email', 'isOwner', 'ownerDatasetId', 'exportsAppearingIn'], peopleRows) });

  const compRows = W.companies.map((c) => [c.id, c.name, c.industryId || '', c.industryId ? W.industryById.get(c.industryId).name : '', c.size || '', c.communities.join(';'), bool(!!c.generic)]);
  files.push({ path: 'graph/companies.csv', rows: compRows.length, text: csvText(['companyId', 'name', 'industryId', 'industryName', 'size', 'communities', 'generic'], compRows) });

  const schoolRows = W.world.schools.map((s) => [s.id, s.name, s.communities.join(';')]);
  files.push({ path: 'graph/schools.csv', rows: schoolRows.length, text: csvText(['schoolId', 'name', 'communities'], schoolRows) });

  const ownerRows = datasets.map((d) => [d.id, d.owner.id, d.owner.fullName, d.owner.url, d.format, d.community, d.exportDate, d.file, String(d.rows.length)]);
  files.push({ path: 'graph/owners.csv', rows: ownerRows.length, text: csvText(['datasetId', 'personId', 'fullName', 'url', 'format', 'community', 'exportDate', 'file', 'connections'], ownerRows) });

  const conRows = [];
  for (const d of datasets) for (const r of d.rows) conRows.push([d.owner.id, r.person.id, iso(r.connectedOn), d.id]);
  files.push({ path: 'graph/edges_connected.csv', rows: conRows.length, text: csvText(['sourcePersonId', 'targetPersonId', 'connectedOn', 'datasetId'], conRows) });

  const empRows = [];
  for (const p of people) for (const pos of p.positions) empRows.push([p.id, pos.companyId, pos.companyName, pos.title, iso(pos.start), pos.end == null ? '' : iso(pos.end)]);
  files.push({ path: 'graph/edges_employment.csv', rows: empRows.length, text: csvText(['personId', 'companyId', 'companyName', 'title', 'startDate', 'endDate'], empRows) });

  const eduRows = [];
  for (const p of people) for (const e of p.education) eduRows.push([p.id, e.schoolId, W.schoolById.get(e.schoolId).name, e.degree, String(e.startYear), String(e.endYear)]);
  files.push({ path: 'graph/edges_education.csv', rows: eduRows.length, text: csvText(['personId', 'schoolId', 'schoolName', 'degree', 'startYear', 'endYear'], eduRows) });

  const msgRows = [];
  const endRows = [];
  for (const d of datasets) {
    const res = fullResults.get(d.id);
    if (!res) continue;
    for (const r of res.rows) {
      if (r.messageCount > 0) msgRows.push([d.owner.id, r.personId, d.id, String(r.messageCount), String(r.messagesSent), String(r.messagesReceived), r.firstMessagedAt || '', r.lastMessagedAt || '']);
    }
    for (const e of res.endorsementRows) endRows.push([e.personId, d.owner.id, d.id, e.skill, iso(Math.floor(e.sec / 86400)), e.status, bool(!!e.counted)]);
  }
  files.push({ path: 'graph/edges_messaged.csv', rows: msgRows.length, text: csvText(['ownerPersonId', 'personId', 'datasetId', 'messageCount', 'messagesSent', 'messagesReceived', 'firstMessagedAt', 'lastMessagedAt'], msgRows) });
  files.push({ path: 'graph/edges_endorsed.csv', rows: endRows.length, text: csvText(['endorserPersonId', 'endorseePersonId', 'datasetId', 'skill', 'endorsedOn', 'status', 'countedByImporter'], endRows) });

  files.push({ path: 'graph/load_neo4j.cypher', rows: null, text: NEO4J });
  files.push({ path: 'graph/schema.sql', rows: null, text: SQL });
  return files;
}

// ---------------------------------------------------------------------------
// expected_graph.json
// ---------------------------------------------------------------------------

export const SHORTEST_PATH_PAIRS = [
  ['N01', 'C01'], ['N01', 'N02'], ['C03', 'C05'], ['N08', 'C10'], ['C04', 'C05'],
  ['C06', 'C08'], ['N01', 'N05'], ['N02', 'C09'], ['C08', 'C04'], ['N04', 'N09'],
  ['C03', 'N10'], ['N06', 'C02'], ['N07', 'C05'], ['C06', 'C09'], ['C01', 'C10'],
];

export function computeExpectedGraph(people, datasets, sets, edgeCases) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const adj = new Map();
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  };
  for (const d of datasets) for (const id of sets.get(d.id)) link(d.owner.id, id);
  const nodes = [...adj.keys()].sort();

  const bfs = (src) => {
    const dist = new Map([[src, 0]]);
    const q = [src];
    for (let i = 0; i < q.length; i++) {
      for (const n of adj.get(q[i])) if (!dist.has(n)) { dist.set(n, dist.get(q[i]) + 1); q.push(n); }
    }
    return dist;
  };
  let components = 0;
  const seen = new Set();
  for (const n of nodes) {
    if (seen.has(n)) continue;
    components += 1;
    for (const m of bfs(n).keys()) seen.add(m);
  }

  const dsById = new Map(datasets.map((d) => [d.id, d]));
  const ownerPairs = [];
  for (let i = 0; i < datasets.length; i++) {
    for (let j = i + 1; j < datasets.length; j++) {
      const a = datasets[i];
      const b = datasets[j];
      const sa = sets.get(a.id);
      const sb = sets.get(b.id);
      let mutual = 0;
      for (const id of sa) if (sb.has(id)) mutual += 1;
      ownerPairs.push({ a: a.id, b: b.id, mutualConnections: mutual, directlyConnected: sa.has(b.owner.id) || sb.has(a.owner.id), directInBothFiles: sa.has(b.owner.id) && sb.has(a.owner.id) });
    }
  }
  const shortestPaths = SHORTEST_PATH_PAIRS.map(([a, b]) => {
    const dist = bfs(dsById.get(a).owner.id);
    return { a, b, aPersonId: dsById.get(a).owner.id, bPersonId: dsById.get(b).owner.id, hops: dist.get(dsById.get(b).owner.id) ?? null };
  });

  const appear = new Map();
  for (const d of datasets) for (const id of sets.get(d.id)) {
    if (!appear.has(id)) appear.set(id, []);
    appear.get(id).push(d.id);
  }
  const topByExportsAppearing = [...appear.entries()]
    .map(([id, list]) => ({ personId: id, name: byId.get(id).fullName, exportsAppearingIn: list.length, datasets: list, observedDegree: adj.get(id).size, isOwner: !!byId.get(id).ownerOf }))
    .sort((x, y) => (y.exportsAppearingIn - x.exportsAppearingIn) || (y.observedDegree - x.observedDegree) || (x.personId < y.personId ? -1 : 1))
    .slice(0, 10);
  const topByObservedDegree = nodes
    .map((id) => ({ personId: id, name: byId.get(id).fullName, observedDegree: adj.get(id).size, isOwner: !!byId.get(id).ownerOf }))
    .sort((x, y) => (y.observedDegree - x.observedDegree) || (x.personId < y.personId ? -1 : 1))
    .slice(0, 10);

  // same person, different job between two snapshots
  const snaps = new Map();
  for (const d of datasets) for (const r of d.rows) {
    if (!snaps.has(r.person.id)) snaps.set(r.person.id, []);
    snaps.get(r.person.id).push({ datasetId: d.id, exportDate: d.exportDate, company: r.company.trim(), position: r.position.trim() });
  }
  const multi = [...snaps.entries()].filter(([, s]) => s.length >= 2);
  const changed = multi.filter(([, s]) => new Set(s.map((x) => `${x.company}\u0000${x.position}`)).size > 1).sort((a, b) => (a[0] < b[0] ? -1 : 1));

  return {
    graphDefinition: 'Observed graph = undirected union of owner->connection edges in graph/edges_connected.csv (nodes = every person in any of the 20 datasets, owners included).',
    distinctPeople: nodes.length,
    connectedComponents: components,
    datasets: datasets.map((d) => ({ datasetId: d.id, ownerPersonId: d.owner.id, community: d.community, format: d.format, exportDate: d.exportDate, degree: d.rows.length, ownerObservedDegree: adj.get(d.owner.id).size })),
    ownerPairs,
    shortestPaths,
    topByExportsAppearing,
    topByObservedDegree,
    jobChangesAcrossSnapshots: {
      definition: 'People listed in >= 2 exports whose trimmed (Company, Position) differ between at least two of those exports.',
      count: changed.length,
      peopleInMultipleExports: multi.length,
      fraction: Number((changed.length / Math.max(1, multi.length)).toFixed(4)),
      examples: changed.slice(0, 10).map(([id, s]) => ({ personId: id, snapshots: s })),
      examplePersonIds: changed.slice(0, 10).map(([id]) => id),
    },
    edgeCases,
  };
}

const NEO4J = `// Neo4j loader for testdata/graph/*.csv (Neo4j 5.x).
// 1. Copy the CSV files in this folder into the database's import/ directory.
// 2. Run: cypher-shell -u neo4j -p <password> -f load_neo4j.cypher
// Empty CSV fields load as null. Dates are ISO (YYYY-MM-DD).

CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.personId IS UNIQUE;
CREATE CONSTRAINT company_id IF NOT EXISTS FOR (c:Company) REQUIRE c.companyId IS UNIQUE;
CREATE CONSTRAINT school_id IF NOT EXISTS FOR (s:School) REQUIRE s.schoolId IS UNIQUE;

LOAD CSV WITH HEADERS FROM 'file:///people.csv' AS row
MERGE (p:Person {personId: row.personId})
SET p.firstName = row.firstName, p.lastName = row.lastName, p.fullName = row.fullName,
    p.url = row.url, p.slug = row.slug, p.homeCommunity = row.homeCommunity,
    p.secondCommunity = row.secondCommunity, p.functionId = row.functionId,
    p.seniorityId = row.seniorityId, p.industryId = row.industryId,
    p.currentCompanyId = row.currentCompanyId, p.currentTitle = row.currentTitle,
    p.location = row.location, p.email = row.email, p.isOwner = (row.isOwner = 'true'),
    p.exportsAppearingIn = toInteger(row.exportsAppearingIn);

LOAD CSV WITH HEADERS FROM 'file:///companies.csv' AS row
MERGE (c:Company {companyId: row.companyId})
SET c.name = row.name, c.industryId = row.industryId, c.industryName = row.industryName,
    c.size = row.size, c.communities = split(row.communities, ';'), c.generic = (row.generic = 'true');

LOAD CSV WITH HEADERS FROM 'file:///schools.csv' AS row
MERGE (s:School {schoolId: row.schoolId})
SET s.name = row.name, s.communities = split(row.communities, ';');

LOAD CSV WITH HEADERS FROM 'file:///owners.csv' AS row
MATCH (p:Person {personId: row.personId})
SET p:Owner, p.datasetId = row.datasetId, p.datasetFormat = row.format,
    p.exportDate = date(row.exportDate), p.datasetFile = row.file;

LOAD CSV WITH HEADERS FROM 'file:///edges_connected.csv' AS row
MATCH (a:Person {personId: row.sourcePersonId}), (b:Person {personId: row.targetPersonId})
CREATE (a)-[:CONNECTED_TO {connectedOn: date(row.connectedOn), datasetId: row.datasetId}]->(b);

LOAD CSV WITH HEADERS FROM 'file:///edges_employment.csv' AS row
MATCH (p:Person {personId: row.personId}), (c:Company {companyId: row.companyId})
CREATE (p)-[:WORKED_AT {companyName: row.companyName, title: row.title, startDate: date(row.startDate),
  endDate: CASE WHEN row.endDate IS NULL OR row.endDate = '' THEN null ELSE date(row.endDate) END}]->(c);

LOAD CSV WITH HEADERS FROM 'file:///edges_education.csv' AS row
MATCH (p:Person {personId: row.personId}), (s:School {schoolId: row.schoolId})
CREATE (p)-[:STUDIED_AT {degree: row.degree, startYear: toInteger(row.startYear), endYear: toInteger(row.endYear)}]->(s);

LOAD CSV WITH HEADERS FROM 'file:///edges_messaged.csv' AS row
MATCH (o:Person {personId: row.ownerPersonId}), (p:Person {personId: row.personId})
CREATE (o)-[:MESSAGED {datasetId: row.datasetId, messageCount: toInteger(row.messageCount),
  messagesSent: toInteger(row.messagesSent), messagesReceived: toInteger(row.messagesReceived),
  firstMessagedAt: date(row.firstMessagedAt), lastMessagedAt: date(row.lastMessagedAt)}]->(p);

LOAD CSV WITH HEADERS FROM 'file:///edges_endorsed.csv' AS row
MATCH (e:Person {personId: row.endorserPersonId}), (o:Person {personId: row.endorseePersonId})
CREATE (e)-[:ENDORSED {datasetId: row.datasetId, skill: row.skill, endorsedOn: date(row.endorsedOn),
  status: row.status, countedByImporter: (row.countedByImporter = 'true')}]->(o);

// Example checks against expected_graph.json:
// Mutual connections of two owners (ownerPairs[].mutualConnections):
//   MATCH (a:Owner {datasetId: 'N01'})-[:CONNECTED_TO]->(m)<-[:CONNECTED_TO]-(b:Owner {datasetId: 'C01'})
//   RETURN count(DISTINCT m);
// Hops between owners (shortestPaths[].hops), ignoring direction:
//   MATCH (a:Owner {datasetId: 'N01'}), (b:Owner {datasetId: 'N05'})
//   MATCH p = shortestPath((a)-[:CONNECTED_TO*..10]-(b)) RETURN length(p);
`;

const SQL = `-- Portable relational schema for testdata/graph/*.csv
-- Works on SQLite 3.32+ and PostgreSQL 13+. Column order matches each CSV's header.
--
-- SQLite:
--   sqlite3 network.db < schema.sql
--   sqlite3 network.db ".import --csv --skip 1 people.csv people"   (repeat per table)
--   Note: SQLite imports empty fields as '' (not NULL); use NULLIF(col, '') in queries.
-- PostgreSQL (psql, from this folder):
--   \\i schema.sql
--   \\copy people FROM 'people.csv' WITH (FORMAT csv, HEADER true)   (repeat per table)
--   Unquoted empty fields load as NULL.

CREATE TABLE people (
  person_id            TEXT PRIMARY KEY,
  first_name           TEXT NOT NULL,
  last_name            TEXT NOT NULL,
  full_name            TEXT NOT NULL,
  url                  TEXT NOT NULL,
  slug                 TEXT NOT NULL,
  home_community       TEXT NOT NULL,
  second_community     TEXT,
  function_id          TEXT NOT NULL,
  seniority_id         TEXT NOT NULL,
  industry_id          TEXT,
  current_company_id   TEXT,
  current_company_name TEXT,
  current_title        TEXT,
  location             TEXT,
  email                TEXT,
  is_owner             BOOLEAN NOT NULL,
  owner_dataset_id     TEXT,
  exports_appearing_in INTEGER NOT NULL
);

CREATE TABLE companies (
  company_id    TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  industry_id   TEXT,
  industry_name TEXT,
  size          TEXT,
  communities   TEXT,           -- ';'-separated community ids
  generic       BOOLEAN NOT NULL
);

CREATE TABLE schools (
  school_id   TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  communities TEXT
);

CREATE TABLE owners (
  dataset_id  TEXT PRIMARY KEY,
  person_id   TEXT NOT NULL REFERENCES people(person_id),
  full_name   TEXT NOT NULL,
  url         TEXT NOT NULL,
  format      TEXT NOT NULL,    -- full | classic | classic-legacy
  community   TEXT NOT NULL,
  export_date DATE NOT NULL,
  file        TEXT NOT NULL,
  connections INTEGER NOT NULL
);

CREATE TABLE edges_connected (
  source_person_id TEXT NOT NULL REFERENCES people(person_id),  -- dataset owner
  target_person_id TEXT NOT NULL REFERENCES people(person_id),
  connected_on     DATE NOT NULL,
  dataset_id       TEXT NOT NULL REFERENCES owners(dataset_id),
  PRIMARY KEY (dataset_id, target_person_id)
);

CREATE TABLE edges_employment (
  person_id    TEXT NOT NULL REFERENCES people(person_id),
  company_id   TEXT NOT NULL REFERENCES companies(company_id),
  company_name TEXT NOT NULL,   -- name as displayed on the profile (may be a variant)
  title        TEXT,
  start_date   DATE NOT NULL,
  end_date     DATE             -- NULL = current
);

CREATE TABLE edges_education (
  person_id   TEXT NOT NULL REFERENCES people(person_id),
  school_id   TEXT NOT NULL REFERENCES schools(school_id),
  school_name TEXT NOT NULL,
  degree      TEXT,
  start_year  INTEGER,
  end_year    INTEGER
);

CREATE TABLE edges_messaged (
  owner_person_id   TEXT NOT NULL REFERENCES people(person_id),
  person_id         TEXT NOT NULL REFERENCES people(person_id),
  dataset_id        TEXT NOT NULL REFERENCES owners(dataset_id),
  message_count     INTEGER NOT NULL,
  messages_sent     INTEGER NOT NULL,   -- 1:1 threads only
  messages_received INTEGER NOT NULL,   -- 1:1 threads only
  first_messaged_at DATE,
  last_messaged_at  DATE,
  PRIMARY KEY (dataset_id, person_id)
);

CREATE TABLE edges_endorsed (
  endorser_person_id  TEXT NOT NULL REFERENCES people(person_id),
  endorsee_person_id  TEXT NOT NULL REFERENCES people(person_id),  -- the dataset owner
  dataset_id          TEXT NOT NULL REFERENCES owners(dataset_id),
  skill               TEXT NOT NULL,
  endorsed_on         DATE NOT NULL,
  status              TEXT NOT NULL,   -- ACCEPTED | PENDING | REJECTED
  counted_by_importer BOOLEAN NOT NULL
);

CREATE INDEX idx_connected_target ON edges_connected(target_person_id);
CREATE INDEX idx_employment_company ON edges_employment(company_id);

-- Mutual connections of two owners (compare with expected_graph.json ownerPairs):
--   SELECT COUNT(*) FROM edges_connected a JOIN edges_connected b
--     ON a.target_person_id = b.target_person_id
--   WHERE a.dataset_id = 'N01' AND b.dataset_id = 'C01';
`;
