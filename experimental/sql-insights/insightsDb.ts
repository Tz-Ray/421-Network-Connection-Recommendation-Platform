// experimental/sql-insights/insightsDb.ts
//
// EXPERIMENTAL (feature key `sql-insights`, only reachable when
// VITE_EXPERIMENTAL=on). The pure part of the Insights screen: builds an
// in-memory SQLite database (sql.js) from the signed-in user's saved
// connections, guards the read-only SQL box, and holds the ready-made cards.
//
// Pure module: no firebase, no React, no network. The sql.js module is passed
// in (the browser loads it with the bundled .wasm, tests load it from
// node_modules). Relative imports carry explicit '.ts' extensions so plain Node
// (type stripping) can import this file for tests.
//
// Privacy: note text never enters the database (only `has_note`). Nothing here
// writes anywhere: the database lives in this tab's memory and is discarded.

import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import type { ConnectionDoc } from '../../lib/connectionsStore.ts';
import type { NetworkContext } from '../../lib/connectionFields.ts';
import { companiesMatch } from '../../lib/relationship.ts';
import { parseLinkedInDate } from '../../lib/linkedinExport.ts';

/** Rows shown for one query; the result says when there were more. */
export const MAX_ROWS = 500;

// -----------------------------
// Schema
// -----------------------------

export type ColumnSpec = { name: string; type: 'TEXT' | 'INTEGER'; about: string };
export type TableSpec = { name: string; about: string; columns: ColumnSpec[] };

/** One column per ConnectionDoc field, except `note`, which becomes has_note. */
const CONNECTION_COLUMNS: { col: ColumnSpec; get: (d: ConnectionDoc) => SqlValue }[] = [
  { col: { name: 'first_name', type: 'TEXT', about: 'First name' }, get: (d) => d.firstName },
  { col: { name: 'last_name', type: 'TEXT', about: 'Last name' }, get: (d) => d.lastName },
  { col: { name: 'full_name', type: 'TEXT', about: 'Full name' }, get: (d) => d.fullName },
  { col: { name: 'company', type: 'TEXT', about: 'Current company' }, get: (d) => d.company },
  { col: { name: 'position', type: 'TEXT', about: 'Job title' }, get: (d) => d.position },
  { col: { name: 'email', type: 'TEXT', about: 'Email address (often empty)' }, get: (d) => d.email },
  { col: { name: 'url', type: 'TEXT', about: 'LinkedIn profile URL' }, get: (d) => d.url },
  {
    col: { name: 'connected_on_raw', type: 'TEXT', about: '"Connected On" as exported' },
    get: (d) => d.connectedOnRaw,
  },
  {
    col: {
      name: 'connected_on',
      type: 'TEXT',
      about: 'Date connected, YYYY-MM-DD (parsed from connected_on_raw when the import had no ISO date)',
    },
    get: (d) => d.connectedOn ?? (d.connectedOnRaw ? parseLinkedInDate(d.connectedOnRaw) : null),
  },
  { col: { name: 'message_count', type: 'INTEGER', about: 'Messages exchanged (all kept threads)' }, get: (d) => d.messageCount },
  { col: { name: 'messages_sent', type: 'INTEGER', about: '1:1 threads where you wrote' }, get: (d) => d.messagesSent },
  { col: { name: 'messages_received', type: 'INTEGER', about: '1:1 threads where they wrote' }, get: (d) => d.messagesReceived },
  { col: { name: 'last_messaged_at', type: 'TEXT', about: 'Last message, YYYY-MM-DD' }, get: (d) => d.lastMessagedAt },
  { col: { name: 'first_messaged_at', type: 'TEXT', about: 'First message, YYYY-MM-DD' }, get: (d) => d.firstMessagedAt },
  { col: { name: 'invitation', type: 'TEXT', about: "'incoming' or 'outgoing'" }, get: (d) => d.invitation },
  { col: { name: 'invited_at', type: 'TEXT', about: 'Invitation date, YYYY-MM-DD' }, get: (d) => d.invitedAt },
  {
    col: { name: 'has_note', type: 'INTEGER', about: '1 if you wrote a note about them (the note text is not loaded)' },
    get: (d) => (d.note && d.note.trim() ? 1 : 0),
  },
  { col: { name: 'endorsement_count', type: 'INTEGER', about: 'Endorsements they gave you' }, get: (d) => d.endorsementCount },
  {
    col: { name: 'recommended_you', type: 'INTEGER', about: '1 if they wrote you a recommendation' },
    get: (d) => (d.recommendedYou == null ? null : d.recommendedYou ? 1 : 0),
  },
];

export const SCHEMA: TableSpec[] = [
  {
    name: 'connections',
    about: 'One row per saved connection',
    columns: [
      { name: 'id', type: 'INTEGER', about: 'Row number (1..N)' },
      ...CONNECTION_COLUMNS.map((c) => c.col),
    ],
  },
  {
    name: 'my_positions',
    about: 'Your own positions (from a LinkedIn export zip; empty otherwise)',
    columns: [
      { name: 'company', type: 'TEXT', about: 'Employer' },
      { name: 'title', type: 'TEXT', about: 'Your title there' },
      { name: 'current', type: 'INTEGER', about: '1 if current' },
    ],
  },
  {
    name: 'my_skills',
    about: 'Your skills (from a LinkedIn export zip; empty otherwise)',
    columns: [{ name: 'skill', type: 'TEXT', about: 'Skill name' }],
  },
  {
    name: 'target_companies',
    about: 'Companies you follow, applied to, or listed as dream companies',
    columns: [
      { name: 'company', type: 'TEXT', about: 'Company name' },
      { name: 'list', type: 'TEXT', about: "'dream', 'applied' or 'followed'" },
    ],
  },
];

export const FUNCTIONS_ABOUT = [
  'companies_match(a, b): 1 when two company names mean the same employer (same rule as the Recommender), else 0.',
  'company_head(name): the first word of a company name as companies_match compares it. Two names can only match when their heads are equal, so join on it first (companies_match alone is slow on large networks).',
];

/**
 * First normalized token of a company name, mirroring companyBase/parseCompany
 * in lib/relationship.ts (diacritics, case, apostrophes, punctuation, leading
 * "the"). companiesMatch(a, b) implies companyHead(a) === companyHead(b), so it
 * is a safe join key that narrows companies_match to a few candidate pairs.
 * The test file checks that implication against testdata.
 */
export function companyHead(s: string): string {
  const tokens = s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ');
  while (tokens.length > 1 && tokens[0] === 'the') tokens.shift();
  return tokens[0] === 'the' ? '' : tokens[0];
}

function createTableSql(t: TableSpec): string {
  return `CREATE TABLE ${t.name} (${t.columns
    .map((c) => `${c.name} ${c.type}${c.name === 'id' ? ' PRIMARY KEY' : ''}`)
    .join(', ')})`;
}

function insertAll(db: Database, sql: string, rows: SqlValue[][]): void {
  if (!rows.length) return;
  const stmt = db.prepare(sql);
  try {
    for (const r of rows) stmt.run(r);
  } finally {
    stmt.free();
  }
}

/**
 * Builds the in-memory database from the user's saved connections and (when
 * present) network context, registers companies_match, and then switches the
 * connection to `PRAGMA query_only = ON`, so no later statement can write.
 * The caller owns the returned Database and must close() it.
 */
export function buildInsightsDb(
  SQL: SqlJsStatic,
  docs: ConnectionDoc[],
  ctx: NetworkContext | null
): Database {
  const db = new SQL.Database();
  try {
    db.run('BEGIN');
    for (const t of SCHEMA) db.run(createTableSql(t));

    const names = CONNECTION_COLUMNS.map((c) => c.col.name);
    insertAll(
      db,
      `INSERT INTO connections (id, ${names.join(', ')}) VALUES (?${', ?'.repeat(names.length)})`,
      docs.map((d, i) => [i + 1, ...CONNECTION_COLUMNS.map((c) => c.get(d))])
    );

    if (ctx) {
      insertAll(
        db,
        'INSERT INTO my_positions (company, title, current) VALUES (?, ?, ?)',
        ctx.positions.map((p) => [p.company || null, p.title || null, p.current ? 1 : 0])
      );
      insertAll(db, 'INSERT INTO my_skills (skill) VALUES (?)', ctx.skills.map((s) => [s]));
      insertAll(db, 'INSERT INTO target_companies (company, list) VALUES (?, ?)', [
        ...ctx.dreamCompanies.map((c) => [c, 'dream']),
        ...ctx.appliedCompanies.map((c) => [c, 'applied']),
        ...ctx.followedCompanies.map((c) => [c, 'followed']),
      ]);
    }
    db.run('COMMIT');

    db.create_function('companies_match', (a: unknown, b: unknown) =>
      typeof a === 'string' && typeof b === 'string' && companiesMatch(a, b) ? 1 : 0
    );
    db.create_function('company_head', (a: unknown) => (typeof a === 'string' ? companyHead(a) : null));
    db.run('PRAGMA query_only = ON');
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}

// -----------------------------
// Read-only statement guard
// -----------------------------

/** Removes leading whitespace and SQL comments. */
function stripLeadingTrivia(sql: string): string {
  let s = sql;
  for (;;) {
    const t = s.replace(/^\s+/, '');
    if (t.startsWith('--')) {
      const nl = t.indexOf('\n');
      s = nl === -1 ? '' : t.slice(nl + 1);
    } else if (t.startsWith('/*')) {
      const end = t.indexOf('*/', 2);
      s = end === -1 ? '' : t.slice(end + 2);
    } else {
      return t;
    }
  }
}

/** True when `rest` holds nothing but whitespace, comments and semicolons. */
export function isOnlyTrivia(rest: string): boolean {
  let s = rest;
  for (;;) {
    const t = stripLeadingTrivia(s).replace(/^;+/, '');
    if (t === s) return t === '';
    s = t;
  }
}

/** The first keyword of the statement, upper-cased ('' when none). */
export function firstKeyword(sql: string): string {
  const m = /^[A-Za-z_]+/.exec(stripLeadingTrivia(sql));
  return m ? m[0].toUpperCase() : '';
}

export type GuardResult = { ok: true } | { ok: false; error: string };

/** Text-level check: one statement whose first keyword is SELECT or WITH. */
export function checkQueryText(sql: string): GuardResult {
  if (!stripLeadingTrivia(sql)) return { ok: false, error: 'Type a SELECT query first.' };
  const kw = firstKeyword(sql);
  if (kw !== 'SELECT' && kw !== 'WITH') {
    return {
      ok: false,
      error: `Only read-only queries can run here: start with SELECT or WITH${kw ? ` (this one starts with ${kw})` : ''}.`,
    };
  }
  return { ok: true };
}

export class QueryRefused extends Error {}

export type QueryResult = {
  columns: string[];
  rows: SqlValue[][];
  /** True when the query had more than `maxRows` rows (only the first are kept). */
  capped: boolean;
  ms: number;
};

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

/**
 * Runs one read-only statement. Throws QueryRefused when the guard rejects
 * it (wrong first keyword, or more than one statement), and sql.js's own
 * Error for SQL errors. Writes that slip past the text check (for example
 * `WITH x AS (SELECT 1) DELETE ...`) fail on PRAGMA query_only.
 *
 * `filterRow` (optional) sees each row before it is kept and may return a
 * smaller copy (the Insights worker cuts long values there, so a huge value is
 * never collected 500 times), or null to stop reading rows (its own budget is
 * used up; it records that itself). Without it every row is kept as is.
 */
export type RowFilter = (row: SqlValue[]) => SqlValue[] | null;

export function runReadOnlyQuery(
  db: Database,
  sql: string,
  maxRows: number = MAX_ROWS,
  filterRow?: RowFilter
): QueryResult {
  const check = checkQueryText(sql);
  if (check.ok === false) throw new QueryRefused(check.error);

  const t0 = now();
  const it = db.iterateStatements(sql);
  const first = it.next();
  if (first.done || !first.value) throw new QueryRefused('Type a SELECT query first.');
  const stmt = first.value;
  try {
    // prepare compiles only the first statement; anything after it must be
    // empty, or the box would silently ignore (or later run) the rest.
    if (!isOnlyTrivia(it.getRemainingSQL())) {
      throw new QueryRefused('Run one statement at a time (remove everything after the first `;`).');
    }
    const columns = stmt.getColumnNames();
    const rows: SqlValue[][] = [];
    let capped = false;
    while (stmt.step()) {
      if (rows.length >= maxRows) {
        capped = true;
        break;
      }
      const row = filterRow ? filterRow(stmt.get()) : stmt.get();
      if (row === null) break;
      rows.push(row);
    }
    return { columns, rows, capped, ms: now() - t0 };
  } finally {
    stmt.free();
  }
}

// -----------------------------
// Ready-made cards
// -----------------------------

export type InsightCard = {
  id: string;
  title: string;
  about: string;
  /** 'bar': first column is the label, second the value. */
  view: 'bar' | 'table';
  sql: string;
};

export const CARDS: InsightCard[] = [
  {
    id: 'top-companies',
    title: 'Top companies',
    about: 'Where most of your connections work.',
    view: 'bar',
    sql: `SELECT company, COUNT(*) AS connections
FROM connections
WHERE company IS NOT NULL
GROUP BY company
ORDER BY connections DESC, company
LIMIT 10`,
  },
  {
    id: 'per-year',
    title: 'Connections added per year',
    about: 'How your network grew, by the year you connected.',
    view: 'bar',
    sql: `SELECT substr(connected_on, 1, 4) AS year, COUNT(*) AS added
FROM connections
WHERE connected_on IS NOT NULL
GROUP BY year
ORDER BY year`,
  },
  {
    id: 'message-buckets',
    title: 'Message activity',
    about: 'How many people you have talked to, and how much (needs a LinkedIn export zip).',
    view: 'bar',
    sql: `SELECT CASE
         WHEN COALESCE(message_count, 0) = 0 THEN 'never'
         WHEN message_count <= 2 THEN '1-2'
         WHEN message_count <= 9 THEN '3-9'
         ELSE '10+'
       END AS messages,
       COUNT(*) AS connections
FROM connections
GROUP BY messages
ORDER BY MIN(COALESCE(message_count, 0))`,
  },
  {
    id: 'most-messaged-companies',
    title: 'Most-messaged companies',
    about: 'Companies where you have the most conversation history.',
    view: 'table',
    sql: `SELECT company,
       SUM(message_count) AS messages,
       COUNT(*) AS people,
       SUM(messages_sent > 0 AND messages_received > 0) AS two_way,
       MAX(last_messaged_at) AS last_contact
FROM connections
WHERE message_count > 0 AND company IS NOT NULL
GROUP BY company
ORDER BY messages DESC, company
LIMIT 10`,
  },
  {
    id: 'title-functions',
    title: 'Titles by function',
    about: 'Rough keyword buckets over job titles (a simple LIKE match, not the Recommender\'s taxonomy).',
    view: 'bar',
    sql: `WITH t AS (
  SELECT ' ' || lower(COALESCE(position, '')) || ' ' AS p FROM connections
)
SELECT CASE
         WHEN p LIKE '% recruit%' OR p LIKE '% talent %' THEN 'Recruiting'
         WHEN p LIKE '% founder%' OR p LIKE '% ceo %' OR p LIKE '% chief %' THEN 'Founders and execs'
         WHEN p LIKE '% engineer%' OR p LIKE '% developer%' OR p LIKE '% software %' THEN 'Engineering'
         WHEN p LIKE '% data %' OR p LIKE '% analyst%' OR p LIKE '% scientist%' THEN 'Data'
         WHEN p LIKE '% product %' THEN 'Product'
         WHEN p LIKE '% design%' THEN 'Design'
         WHEN p LIKE '% sales %' OR p LIKE '% account %' THEN 'Sales'
         WHEN p LIKE '% marketing %' THEN 'Marketing'
         WHEN trim(p) = '' THEN 'No title'
         ELSE 'Other'
       END AS function,
       COUNT(*) AS connections
FROM t
GROUP BY function
ORDER BY connections DESC`,
  },
  {
    id: 'target-companies',
    title: 'People at your target companies',
    about: 'Connections at companies you follow, applied to, or listed as dream companies (needs a LinkedIn export zip).',
    view: 'table',
    sql: `WITH cc AS MATERIALIZED (
  SELECT company, company_head(company) AS head, COUNT(*) AS n
  FROM connections WHERE company IS NOT NULL GROUP BY company
), t AS MATERIALIZED (
  SELECT company, list, company_head(company) AS head FROM target_companies
)
SELECT t.company AS target, t.list, SUM(cc.n) AS connections,
       group_concat(cc.company, ', ') AS listed_as
FROM t
JOIN cc ON cc.head = t.head AND companies_match(cc.company, t.company)
GROUP BY t.company, t.list
ORDER BY CASE t.list WHEN 'dream' THEN 0 WHEN 'applied' THEN 1 ELSE 2 END,
         connections DESC, target
LIMIT 25`,
  },
  {
    id: 'recently-connected',
    title: 'Recently connected',
    about: 'The ten people you connected with most recently.',
    view: 'table',
    sql: `SELECT COALESCE(full_name, trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))) AS name,
       position, company, connected_on
FROM connections
WHERE connected_on IS NOT NULL
ORDER BY connected_on DESC, name
LIMIT 10`,
  },
];
