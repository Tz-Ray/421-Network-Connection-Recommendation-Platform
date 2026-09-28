# testdata/

Synthetic LinkedIn network data for automated tests of the connection-ranking
algorithm, and for future graph-database work. All people are fictional
(invented names, invented LinkedIn slugs). Companies, universities, cities and
industries are real and used realistically. No real person's name is paired
with a real employer on purpose.

This is a self-contained universe of 4,588 fictional people (4,436 of them
appear in at least one of the 20 exported datasets below) spread across 10
"communities" (metro + industry clusters: `SEA_TECH`, `SF_FINTECH`,
`NYC_FINANCE`, `BOS_HEALTH`, `CHI_CONSULT`, `LDN_RETAIL`, `TOR_ACADEMIA`,
`DC_POLICY`, `HOU_ENERGY`, `LA_MEDIA`). People and their employers, schools,
messages, invitations, notes, endorsements and recommendations are generated
together so that the 20 exported files below overlap realistically: the same
fictional person can show up as a connection in several different owners'
exports, with a consistent name, company and profile URL each time.

"Today" for this universe is **2026-09-28**. No date in any generated file is
later than that file's own export date.

## The 20 datasets

10 "new" full LinkedIn exports (zip files, the richest format the app
supports) and 10 "old" classic connection exports (plain `Connections.csv`,
what most people still download). Each has a different fictional owner in a
different community. `manifest.json` is the machine-readable source of this
table; `expected` points at the JSON file test code can diff the importer's
output against.

| id | file | format | community | owner | connections | export date |
|---|---|---|---|---|---:|---|
| N01 | `networks/full/N01_kavita-raghavan.zip` | full | SEA_TECH | Kavita Raghavan | 1450 | 2026-09-28 |
| N02 | `networks/full/N02_vivek-singh.zip` | full | SF_FINTECH | Vivek Singh | 820 | 2026-08-14 |
| N03 | `networks/full/N03_aminata-adeyemi.zip` | full | NYC_FINANCE | Aminata Adeyemi | 610 | 2026-03-02 |
| N04 | `networks/full/N04_kristine-chua.zip` | full | BOS_HEALTH | Kristine Chua | 390 | 2025-11-19 |
| N05 | `networks/full/N05_jaewoo-cho.zip` | full | CHI_CONSULT | Jaewoo Cho | 260 | 2026-06-30 |
| N06 | `networks/full/N06_larisa-fedorov.zip` | full | LDN_RETAIL | Larisa Fedorov | 540 | 2025-09-08 |
| N07 | `networks/full/N07_lars-desai.zip` | full | TOR_ACADEMIA | Lars Desai | 175 | 2026-01-22 |
| N08 | `networks/full/N08_antoine-braun.zip` | full | DC_POLICY | Antoine Braun | 95 | 2025-05-12 |
| N09 | `networks/full/N09_christopher-turner.zip` | full | HOU_ENERGY | Christopher Turner | 330 | 2026-04-17 |
| N10 | `networks/full/N10_lorenzo-russo.zip` | full | LA_MEDIA | Lorenzo Russo | 1050 | 2025-07-25 |
| C01 | `networks/classic/C01_fang-chen.csv` | classic | SEA_TECH | Fang Chen | 900 | 2026-05-05 |
| C02 | `networks/classic/C02_sota-wang.csv` | classic | SF_FINTECH | Sota Wang | 420 | 2026-09-20 |
| C03 | `networks/classic/C03_james-paquette.csv` | classic | NYC_FINANCE | James Paquette | 300 | 2025-10-06 |
| C04 | `networks/classic/C04_sofia-de-la-cruz.csv` | classic | BOS_HEALTH | Sofía De La Cruz | 210 | 2026-07-11 |
| C05 | `networks/classic/C05_victoria-turner.csv` | classic | CHI_CONSULT | Victoria Turner | 150 | 2025-12-15 |
| C06 | `networks/classic/C06_hannah-walker.csv` | classic | LDN_RETAIL | Hannah Walker | 120 | 2026-02-09 |
| C07 | `networks/classic/C07_abigail-harris.csv` | classic | TOR_ACADEMIA | Abigail Harris | 640 | 2025-08-27 |
| C08 | `networks/classic/C08_megan-turner.csv` | classic-legacy | DC_POLICY | Megan Turner | 75 | 2025-06-20 |
| C09 | `networks/classic/C09_rafael-medina.csv` | classic-legacy | HOU_ENERGY | Rafael Medina | 480 | 2025-05-28 |
| C10 | `networks/classic/C10_edward-belov.csv` | classic | LA_MEDIA | Edward Belov | 250 | 2026-09-01 |

Each `N*`/`C*` pair (N01/C01, N02/C02, ...) shares the same community and a
realistic slice of overlapping connections (roughly 28%-43% of the smaller
file's rows also appear in the paired file), so a graph built from all 20
files has cross-links, not 20 disconnected stars. The exact overlap counts
and shares are in `manifest.json` under `pairOverlap`.

Each network leans on its owner's community: about 66-72% of connections are
members of it (their `homeCommunity` or `secondCommunity` is the owner's), and
about 55% have it as their primary `homeCommunity`. The rest come from the
owner's second community, school cohort and weak ties anywhere. Per-set shares
are in `manifest.json` under `composition`.

## `full` format: what's inside a zip

Each `networks/full/*.zip` is shaped like a real "Complete LinkedIn Data
Export". Files are matched by basename only, case-insensitive, at any folder
depth. Only these 14 are ever read by the app's importer; everything else in
the zip is listed but never opened:

Required: `Connections.csv`.

Optional, enrich existing connections: `messages.csv`, `Invitations.csv`,
`Notes.csv`, `Endorsement_Received_Info.csv`, `Recommendations_Received.csv`.

Optional, describe the zip's owner (their headline, current job, skills,
target companies): `Profile.csv`, `Positions.csv`, `Education.csv`,
`Skills.csv`, `Company Follows.csv`, `Job Applications.csv`,
`Saved Jobs.csv`, `Job Seeker Preferences.csv`.

Every full export also ships 8 extra files that are not on the whitelist
(things like `Ad_Targeting.csv`, `PhoneNumbers.csv`) so tests can confirm
they're skipped and never decompressed. N08 is deliberately a thinner
"basic" export: only `Connections.csv`, `messages.csv`, `Invitations.csv`,
`Profile.csv`, `Positions.csv`, `Education.csv`, `Skills.csv` plus its own
non-whitelisted files, no notes/endorsements/recommendations.

`classic` vs `classic-legacy`: both are a single `Connections.csv`-shaped
file with no zip. `classic` uses the modern header
(`First Name, Last Name, URL, Email Address, Company, Position, Connected On`)
plus LinkedIn's "Notes:" preamble lines before the header row. `classic-legacy`
(C08, C09) uses the pre-2020 header with **no URL column**
(`First Name, Last Name, Email Address, Company, Position, Connected On`) and
no preamble, so every row has to be joined by name instead of by profile URL.

## Edge cases included, and why

Real exports are messy; the importer has to handle all of this, so the test
data does too. `manifest.json`'s `edgeCases` array has the exact rows/ids for
each one. Highlights:

- **Duplicate names within one file** (e.g. two different "Andrew Brown"s in
  N01, each with their own URL) — a name-only join must treat them as
  ambiguous, never silently pick one.
- **Same full name reused across two different datasets** for two different
  fictional people — identity must resolve by profile URL, not name.
- **Special-character names**: embedded quotes ("Kate" O'Donnell), commas and
  suffixes (Robert "Bobby" McAllister, Jr.), diacritics, hyphenated and
  multi-part names, and one CJK name whose URL slug is percent-encoded.
- **Blank Company and/or Position** on some rows (hidden or no current role),
  and **generic employers** (Self-employed, Freelance, Stealth Startup,
  Independent Consultant, Open to work, Retired) that should never
  company-match a real employer.
- **Messy titles**: ALL CAPS, pipes, emoji, double/leading spaces, embedded
  commas and quotes.
- **Company names needing CSV quoting**, e.g. `Bain & Company, Inc.`,
  `Skadden, Arps, Slate, Meagher & Flom`.
- **Mixed-case vanity URL slugs** in `Connections.csv` vs. lowercase in
  `messages.csv`/`Invitations.csv` — joins must normalize case.
- **URL shape variants**: endorsement URLs without a scheme
  (`www.linkedin.com/in/<slug>`), Notes URLs with a trailing slash.
- **UTF-8 BOM** at the start of a classic file (C03).
- **Nested zip folder**: every file inside N02's zip sits under a
  `Complete_LinkedInDataExport_<date>/` folder.
- **messages.csv edge cases**: a 12th `IS MESSAGE DRAFT` column with true
  rows that must be skipped (N01); `FOLDER=SPAM` rows skipped (N01, N03,
  N10); no `messages.csv` at all, so `ownerDetected` must come back `null`
  (N05); an export where the owner's own URL never appears in the file, so
  owner detection must fall back to matching the `Profile.csv` name against
  senders/recipients (N04); conversations with more than 5 non-owner
  participants, which must be ignored entirely (per-dataset counts in
  `edgeCases`); sponsored/company-page senders and recruiter InMail from
  non-connections, which must never credit a connection.
- **Invitations.csv edge cases**: an older opposite-direction row that a
  newer-dated row should override, a blank-URL row joined by a unique name,
  and an ambiguous-name row that must be dropped.

## The `graph/` folder

A flattened, already-joined view of the same 20 datasets' underlying truth,
for building a proper graph or relational store instead of parsing 20 raw
exports by hand. Every row here was generated before the zips/CSVs were
written, so it is ground truth, not something derived from the exports.

Node files:

- `people.csv` — every one of the 4,588 fictional people. Columns:
  `personId, firstName, lastName, fullName, url, slug, homeCommunity,
  secondCommunity, functionId, seniorityId, industryId, currentCompanyId,
  currentCompanyName, currentTitle, location, email, isOwner,
  ownerDatasetId, exportsAppearingIn`.
- `companies.csv` — `companyId, name, industryId, industryName, size,
  communities (';'-separated), generic (true for placeholders like
  "Self-employed")`.
- `schools.csv` — `schoolId, name, communities`.
- `owners.csv` — the 20 dataset owners: `datasetId, personId, fullName, url,
  format, community, exportDate, file, connections`.

Edge files:

- `edges_connected.csv` — `sourcePersonId, targetPersonId, connectedOn,
  datasetId`. One row per (dataset owner) -> (their connection) edge; this
  is the graph a "who is connected to whom" reconstruction should match.
- `edges_employment.csv` — `personId, companyId, companyName, title,
  startDate, endDate` (blank `endDate` = current job). Every person's full
  work history, not just their current role.
- `edges_education.csv` — `personId, schoolId, schoolName, degree,
  startYear, endYear`.
- `edges_messaged.csv` — `ownerPersonId, personId, datasetId, messageCount,
  messagesSent, messagesReceived, firstMessagedAt, lastMessagedAt`
  (`messagesSent`/`messagesReceived` count 1:1 threads only, matching the
  importer's own rule).
- `edges_endorsed.csv` — `endorserPersonId, endorseePersonId, datasetId,
  skill, endorsedOn, status, countedByImporter` (`status` is `ACCEPTED`,
  `PENDING` or `REJECTED`; only `ACCEPTED` rows count toward the app's
  `endorsementCount`).

`graph/expected_graph.json` is the graph's own ground truth: total distinct
people, connected-component count, per-dataset owner degree, mutual-connection
counts between every owner pair, shortest-path hop counts between selected
owner pairs, the people with the most exports/highest observed degree, how
many people changed jobs between two dataset snapshots, and the same edge
cases listed above indexed by dataset.

### Loading into a database

- **Neo4j**: copy the CSV files in `graph/` into the database's `import/`
  directory, then run
  `cypher-shell -u neo4j -p <password> -f testdata/graph/load_neo4j.cypher`.
  It creates uniqueness constraints on `Person.personId`, `Company.companyId`
  and `School.schoolId`, loads all four node files, tags dataset owners with
  an extra `:Owner` label, then creates `CONNECTED_TO`, `WORKED_AT`,
  `STUDIED_AT`, `MESSAGED` and `ENDORSED` relationships. It ends with example
  queries for cross-checking mutual-connection counts and shortest-path hop
  counts against `expected_graph.json`.
- **SQLite or Postgres**: `graph/schema.sql` defines matching tables
  (`people`, `companies`, `schools`, `owners`, `edges_connected`,
  `edges_employment`, `edges_education`, `edges_messaged`, `edges_endorsed`)
  with foreign keys and two indexes. For SQLite:
  `sqlite3 network.db < testdata/graph/schema.sql` then
  `sqlite3 network.db ".import --csv --skip 1 testdata/graph/people.csv people"`
  (repeat per table; SQLite imports empty cells as `''`, not `NULL`, so use
  `NULLIF(col, '')` in queries). For Postgres:
  `\i testdata/graph/schema.sql` then
  `\copy people FROM 'testdata/graph/people.csv' WITH (FORMAT csv, HEADER true)`
  (repeat per table; unquoted empty fields load as `NULL` there).

### Truth tags for ranking relevance labels

`people.csv`'s `functionId`, `seniorityId`, `industryId`, `currentCompanyId`
and `homeCommunity`/`secondCommunity` columns are the ground truth behind
every row in the exports — the ranking algorithm never sees them, but a test
harness can use them to build relevance labels for a search query without
guessing. For example, to grade a query like "senior software engineers at
Microsoft in Seattle": filter `people.csv` to `functionId=software_engineering`,
`seniorityId in (senior, lead)`, `currentCompanyId=microsoft`,
`homeCommunity=SEA_TECH`, then look up which of those `personId`s actually
appear as connections in the dataset under test (via `edges_connected.csv`,
or by `url` inside the export file itself). That gives a should-rank-highly
set independent of whatever the ranker itself does. `isOwner`/
`ownerDatasetId` mark the 20 dataset owners; `exportsAppearingIn` says how
many of the 20 datasets a person shows up as a connection in.

## Regenerating and testing

Regenerate everything from scratch (deterministic — same seed, same output
every time, so re-running is safe and reproducible):

```
node testdata/generator/generate.mjs
```

It prints a one-line summary per dataset (row counts, overlap shares,
matched-file counts) and rewrites `manifest.json`, `networks/`, `graph/` and
`expected/` in place. `testdata/generator/FORMAT.md` is the spec it follows,
grounded in the real importer's code; `testdata/generator/catalog/` holds the
static company/school/name pools it draws from; `testdata/generator/lib/`
holds the generation logic (`universe.mjs` for people/companies/schools,
`egos.mjs` for the 20 owners, `fullzip.mjs` for zip assembly, `graph.mjs` for
the `graph/` output, `text.mjs` for names/titles/messages, `rng.mjs` for the
seeded random source, `famous.mjs` for the "avoid famous names" checks).

Run the tests (Node 24's built-in test runner and TypeScript type-stripping,
from the repo root):

```
node --test testdata/tests/exports.test.ts
node --test testdata/tests/graph.test.ts
```

`exports.test.ts` runs every one of the 20 files through the app's real
importer (`lib/linkedinExport.ts` for the zips, `lib/connectionFields.ts` for
the CSVs) and diffs the result against `testdata/expected/<id>.json`, and
checks every file's recorded sha256/byte length in `manifest.json`.
`graph.test.ts` independently rebuilds the connection graph from the raw
export files and checks it against `graph/edges_connected.csv` and
`graph/expected_graph.json`, including the classic-legacy (no-URL) name+company
identity resolution for C08/C09.

## Uploading a set in the app

`RecommenderScreen` accepts `.zip`, `.csv` or `.json`. To try a dataset:
sign in, go to Recommender, and upload any `networks/full/*.zip` or
`networks/classic/*.csv` file directly — no unzipping or conversion needed.
