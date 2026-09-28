// Round-trip test for the synthetic testdata/ fixtures against the real
// importer (lib/linkedinExport.ts / lib/connectionFields.ts).
//
// For every dataset listed in testdata/manifest.json:
//   - N* (networks/full/*.zip)     -> parseLinkedInExportZip -> compare against
//                                      testdata/expected/N*.json (summary, context
//                                      minus `source`, and per-row enrichment fields).
//   - C* (networks/classic/*.csv)  -> parseCsvToObjects -> compare against
//                                      testdata/expected/C*.json (row count, names,
//                                      company, position, URL).
// Also verifies every sha256/byte-length recorded in manifest.json.
//
// This file only reads testdata/ and lib/ - it never writes to either.
//
// Run from the repo root:
//   node --test testdata/tests/exports.test.ts

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseLinkedInExportZip } from '../../lib/linkedinExport.ts';
import {
  parseCsvToObjects,
  getField,
  URL_KEYS,
  FIRST_NAME_KEYS,
  LAST_NAME_KEYS,
  COMPANY_KEYS,
  POSITION_KEYS,
  CONNECTED_ON_ISO_KEYS,
  MESSAGE_COUNT_KEYS,
  MESSAGES_SENT_KEYS,
  MESSAGES_RECEIVED_KEYS,
  LAST_MESSAGED_KEYS,
  FIRST_MESSAGED_KEYS,
  INVITATION_KEYS,
  INVITED_AT_KEYS,
  NOTE_KEYS,
  ENDORSEMENT_COUNT_KEYS,
  RECOMMENDED_YOU_KEYS,
} from '../../lib/connectionFields.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESTDATA_DIR = path.join(__dirname, '..');

function readJson(relPath: string): any {
  return JSON.parse(readFileSync(path.join(TESTDATA_DIR, relPath), 'utf8'));
}
function readBytes(relPath: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(TESTDATA_DIR, relPath)));
}
function readText(relPath: string): string {
  return readFileSync(path.join(TESTDATA_DIR, relPath), 'utf8');
}

const manifest = readJson('manifest.json');

// ---------------------------------------------------------------------------
// manifest.json sha256 / byte-length integrity (generator determinism is NOT
// re-run here - this only checks the checked-in files match their recorded
// digests).
// ---------------------------------------------------------------------------
describe('manifest integrity', () => {
  for (const f of manifest.files as { path: string; sha256: string; bytes: number }[]) {
    test(`sha256 + size match: ${f.path}`, () => {
      const data = readFileSync(path.join(TESTDATA_DIR, f.path));
      const hash = createHash('sha256').update(data).digest('hex');
      assert.equal(hash, f.sha256, `sha256 mismatch for ${f.path}`);
      assert.equal(data.length, f.bytes, `byte length mismatch for ${f.path}`);
    });
  }
});

// ---------------------------------------------------------------------------
// Per-row optional-field helper. lib/linkedinExport.ts only sets an
// enrichment key on a row when it actually derived a value (see its "Enrich
// rows" block), and testdata's expected/*.json mirrors that by omitting the
// JSON key entirely rather than writing null - so "key present" is itself
// part of what's being asserted, not just the value.
// ---------------------------------------------------------------------------
function assertOptionalField(
  row: Record<string, unknown>,
  keys: string[],
  expected: unknown,
  label: string,
): void {
  const key = keys[0];
  const present = Object.prototype.hasOwnProperty.call(row, key);
  if (expected === undefined) {
    assert.equal(
      present,
      false,
      `${label}: expected key "${key}" to be absent, got ${JSON.stringify((row as any)[key])}`,
    );
  } else {
    assert.equal(present, true, `${label}: expected key "${key}" to be present`);
    assert.deepEqual((row as any)[key], expected, `${label}: value mismatch for "${key}"`);
  }
}

type Dataset = {
  id: string;
  file: string;
  format: string;
  expected: string;
};

// ---------------------------------------------------------------------------
// N* - full zip exports, round-tripped through parseLinkedInExportZip
// ---------------------------------------------------------------------------
for (const ds of (manifest.datasets as Dataset[]).filter((d) => d.id.startsWith('N'))) {
  describe(`zip import ${ds.id} (${ds.file})`, () => {
    const expected = readJson(ds.expected);
    const bytes = readBytes(ds.file);
    const result = parseLinkedInExportZip(bytes, path.basename(ds.file));

    test(`${ds.id}: summary`, () => {
      const { fileName, ...summary } = result.summary as any;
      assert.deepEqual(summary, expected.summary);
    });

    test(`${ds.id}: context (ignoring context.source)`, () => {
      if (expected.context === null) {
        assert.equal(result.context, null);
        return;
      }
      assert.notEqual(result.context, null, 'expected a non-null context');
      const { source, ...context } = result.context as any;
      assert.deepEqual(context, expected.context);
    });

    test(`${ds.id}: row count`, () => {
      assert.equal(result.rows.length, expected.rows.length);
    });

    test(`${ds.id}: per-row enrichment fields (file order)`, () => {
      const n = Math.min(result.rows.length, expected.rows.length);
      for (let i = 0; i < n; i++) {
        const row = result.rows[i];
        const exp = expected.rows[i];
        const label = `${ds.id} row ${i} (${exp.personId})`;

        const rawUrl = getField(row, URL_KEYS);
        assert.equal(rawUrl || null, exp.url, `${label}: url`);
        assert.equal(getField(row, FIRST_NAME_KEYS), exp.firstName, `${label}: firstName`);
        assert.equal(getField(row, LAST_NAME_KEYS), exp.lastName, `${label}: lastName`);
        assert.equal(getField(row, COMPANY_KEYS), exp.company, `${label}: company`);
        assert.equal(getField(row, POSITION_KEYS), exp.position, `${label}: position`);

        assertOptionalField(row, CONNECTED_ON_ISO_KEYS, exp.connectedOnIso, `${label}: connectedOnIso`);
        assertOptionalField(row, MESSAGE_COUNT_KEYS, exp.messageCount, `${label}: messageCount`);
        assertOptionalField(row, MESSAGES_SENT_KEYS, exp.messagesSent, `${label}: messagesSent`);
        assertOptionalField(row, MESSAGES_RECEIVED_KEYS, exp.messagesReceived, `${label}: messagesReceived`);
        assertOptionalField(row, LAST_MESSAGED_KEYS, exp.lastMessagedAt, `${label}: lastMessagedAt`);
        assertOptionalField(row, FIRST_MESSAGED_KEYS, exp.firstMessagedAt, `${label}: firstMessagedAt`);
        assertOptionalField(row, INVITATION_KEYS, exp.invitation, `${label}: invitation`);
        assertOptionalField(row, INVITED_AT_KEYS, exp.invitedAt, `${label}: invitedAt`);
        assertOptionalField(row, NOTE_KEYS, exp.note, `${label}: note`);
        assertOptionalField(row, ENDORSEMENT_COUNT_KEYS, exp.endorsementCount, `${label}: endorsementCount`);
        assertOptionalField(row, RECOMMENDED_YOU_KEYS, exp.recommendedYou, `${label}: recommendedYou`);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// C* - plain/legacy CSV exports, round-tripped through parseCsvToObjects
// ---------------------------------------------------------------------------
for (const ds of (manifest.datasets as Dataset[]).filter((d) => d.id.startsWith('C'))) {
  describe(`csv import ${ds.id} (${ds.file})`, () => {
    const expected = readJson(ds.expected);
    const csvText = readText(ds.file);
    const rows = parseCsvToObjects(csvText);

    test(`${ds.id}: row count`, () => {
      assert.equal(rows.length, expected.rows.length);
    });

    test(`${ds.id}: names, company, position, URL (file order)`, () => {
      const n = Math.min(rows.length, expected.rows.length);
      for (let i = 0; i < n; i++) {
        const row = rows[i];
        const exp = expected.rows[i];
        const label = `${ds.id} row ${i} (${exp.personId})`;

        const rawUrl = getField(row, URL_KEYS);
        const url = rawUrl || null;
        if (ds.format === 'classic-legacy') {
          assert.equal(url, null, `${label}: legacy export should have no URL column, got "${rawUrl}"`);
        }
        assert.equal(url, exp.url, `${label}: url`);
        assert.equal(getField(row, FIRST_NAME_KEYS), exp.firstName, `${label}: firstName`);
        assert.equal(getField(row, LAST_NAME_KEYS), exp.lastName, `${label}: lastName`);
        assert.equal(getField(row, COMPANY_KEYS), exp.company, `${label}: company`);
        assert.equal(getField(row, POSITION_KEYS), exp.position, `${label}: position`);
      }
    });
  });
}
