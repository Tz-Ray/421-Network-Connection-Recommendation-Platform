-- Portable relational schema for testdata/graph/*.csv
-- Works on SQLite 3.32+ and PostgreSQL 13+. Column order matches each CSV's header.
--
-- SQLite:
--   sqlite3 network.db < schema.sql
--   sqlite3 network.db ".import --csv --skip 1 people.csv people"   (repeat per table)
--   Note: SQLite imports empty fields as '' (not NULL); use NULLIF(col, '') in queries.
-- PostgreSQL (psql, from this folder):
--   \i schema.sql
--   \copy people FROM 'people.csv' WITH (FORMAT csv, HEADER true)   (repeat per table)
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
