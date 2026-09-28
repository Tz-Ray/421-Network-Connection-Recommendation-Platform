#!/usr/bin/env node
// testdata generator: a seeded, deterministic universe of fictional LinkedIn
// members at real employers/schools, 10 full data-export zips ("new
// analytics"), 10 classic Connections.csv files, the importer output each
// file must produce (expected/), and graph-database exports (graph/).
//
//   node testdata/generator/generate.mjs
//
// Re-running reproduces byte-identical files (fixed seed, fixed zip mtimes).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { strToU8, unzipSync, zipSync } from 'fflate';

import { buildDatasets, DATASETS, MUTUAL_FRACTION, peopleTargets } from './lib/egos.mjs';
import { buildFullExport, CONNECTIONS_HEADER, CONNECTIONS_PREAMBLE, LEGACY_HEADER } from './lib/fullzip.mjs';
import { buildGraphFiles, computeExpectedGraph } from './lib/graph.mjs';
import { asciiSlug, csvText, dn, fmtDayMonYear, fmtMdyShort, iso, ymdOf } from './lib/text.mjs';
import { buildWorld, generatePeople } from './lib/universe.mjs';

const SEED = 'cr-testdata-v1';
const TODAY = '2026-09-28';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');

const world = JSON.parse(fs.readFileSync(path.join(HERE, 'catalog/world.json'), 'utf8'));
const pools = JSON.parse(fs.readFileSync(path.join(HERE, 'catalog/pools.json'), 'utf8'));

// ---------------------------------------------------------------------------
// Build the truth model
// ---------------------------------------------------------------------------
const W = buildWorld(world);
const { people, usedNames, usedSlugs } = generatePeople(W, pools, SEED, peopleTargets());
const { datasets, links, ownerIds, sets, edge } = buildDatasets(W, pools, people, usedNames, usedSlugs, SEED);
const byId = new Map(people.map((p) => [p.id, p]));

for (const d of datasets) {
  const slug = `${asciiSlug(d.owner.first)}-${asciiSlug(d.owner.last)}`;
  d.file = d.format === 'full' ? `networks/full/${d.id}_${slug}.zip` : `networks/classic/${d.id}_${slug}.csv`;
}

// ---------------------------------------------------------------------------
// Write outputs (only generated folders are cleared)
// ---------------------------------------------------------------------------
for (const dir of ['networks', 'expected', 'graph']) fs.rmSync(path.join(OUT, dir), { recursive: true, force: true });
fs.rmSync(path.join(OUT, 'manifest.json'), { force: true });

const written = []; // manifest entries
function writeOut(rel, data, meta = {}) {
  const abs = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  fs.writeFileSync(abs, buf);
  written.push({ path: rel, sha256: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf.length, ...meta });
}
const json = (o) => `${JSON.stringify(o, null, 2)}\n`;
const ownerOf = (d) => ({ personId: d.owner.id, name: d.owner.fullName, url: d.owner.url });

const fullResults = new Map();
for (const d of datasets) {
  const meta = { datasetId: d.id, format: d.format, owner: d.owner.id, community: d.community, exportDate: d.exportDate, rows: d.rows.length };
  if (d.format === 'full') {
    const res = buildFullExport(W, pools, d, { byId, seed: SEED, ownerIds, sets });
    fullResults.set(d.id, res);
    const [y, m, day] = ymdOf(d.exportDay);
    const mtime = new Date(y, m - 1, day, 9, 0, 0); // local-time components => same DOS time in any TZ
    const entries = {};
    for (const f of [...res.files].sort((a, b) => (a.path.toLowerCase() < b.path.toLowerCase() ? -1 : 1))) entries[f.path] = [strToU8(f.text), { mtime }];
    writeOut(d.file, zipSync(entries, { level: 6, mtime }), meta);
    writeOut(`expected/${d.id}.json`, json({
      id: d.id,
      file: d.file,
      format: 'full',
      owner: ownerOf(d),
      exportDate: d.exportDate,
      summary: res.summary,
      context: res.context,
      notes: { ownerDetectedVia: res.ownerDetectedVia, edgeCases: res.edgeNotes },
      rows: res.rows,
    }), { datasetId: d.id, format: 'expected', owner: d.owner.id, community: d.community, exportDate: d.exportDate, rows: res.rows.length });
  } else {
    const legacy = d.opts.legacy;
    const fmtDate = d.opts.dateStyle === 'mdy' ? fmtMdyShort : fmtDayMonYear;
    const rows = d.rows.map((r) => (legacy
      ? [r.person.first, r.person.last, r.person.email || '', r.company, r.position, fmtDate(r.connectedOn)]
      : [r.person.first, r.person.last, r.person.url, r.person.email || '', r.company, r.position, fmtDate(r.connectedOn)]));
    const text = csvText(legacy ? LEGACY_HEADER : CONNECTIONS_HEADER, rows, { preamble: legacy ? '' : CONNECTIONS_PREAMBLE, bom: !!d.opts.bom });
    writeOut(d.file, text, meta);
    writeOut(`expected/${d.id}.json`, json({
      id: d.id,
      file: d.file,
      format: d.format,
      owner: ownerOf(d),
      exportDate: d.exportDate,
      rows: d.rows.map((r) => ({
        personId: r.person.id, url: legacy ? null : r.person.url, firstName: r.person.first, lastName: r.person.last,
        email: r.person.email || '', company: r.company.trim(), position: r.position.trim(), connectedOnIso: iso(r.connectedOn),
      })),
    }), { datasetId: d.id, format: 'expected', owner: d.owner.id, community: d.community, exportDate: d.exportDate, rows: d.rows.length });
  }
}

// ---------------------------------------------------------------------------
// Edge-case register (also embedded in expected_graph.json)
// ---------------------------------------------------------------------------
const perDataset = (fn) => Object.fromEntries(datasets.map((d) => [d.id, fn(d)]));
const COMMA_COMPANY = /,/;
const edgeCases = [
  { id: 'duplicate-names-within-dataset', description: 'Different people (different URLs) with identical full names in one file; name-only joins must treat them as ambiguous.', details: edge.duplicateNamesWithin },
  { id: 'same-name-across-datasets', description: 'Different people sharing a full name across two datasets; entity resolution must use the profile URL.', details: edge.sameNameAcrossDatasets },
  { id: 'special-character-names', description: 'Names needing CSV quoting or Unicode handling: embedded double quotes, apostrophes, commas in last names (credentials/suffixes), diacritics, hyphens, a CJK name with a percent-encoded profile slug.', details: edge.specialNames },
  { id: 'blank-company-or-position', description: 'Rows with blank Company and/or Position (hidden current role, no current role).', details: perDataset((d) => ({ blankCompany: d.rows.filter((r) => !r.company.trim()).length, blankPosition: d.rows.filter((r) => !r.position.trim()).length, rows: d.rows.length })) },
  { id: 'generic-employers', description: 'Current employer is Self-employed / Freelance / Stealth Startup / Independent Consultant / Open to work / Retired (or a variant).', details: perDataset((d) => d.rows.filter((r) => { const pos = r.person.positions.find((x) => x.companyName === r.company); return pos && pos.generic; }).length) },
  { id: 'messy-titles', description: 'Titles with ALL CAPS, pipes, emoji, double spaces, leading spaces (trimmed by the parser), commas and embedded quotes.', details: perDataset((d) => d.rows.filter((r) => r.person.flags.messy && r.position).map((r) => r.person.id)) },
  { id: 'company-names-with-commas', description: 'Company cells that need CSV quoting (e.g. "Bain & Company, Inc.", "Block, Inc.", "Skadden, Arps, Slate, Meagher & Flom").', details: perDataset((d) => d.rows.filter((r) => COMMA_COMPANY.test(r.company)).length) },
  { id: 'mixed-case-vanity-urls', description: 'Vanity slugs written with capitals in Connections.csv but lowercase in messages/invitations; joins must normalize case.', details: perDataset((d) => d.rows.filter((r) => r.person.slugDisplay !== r.person.slug && !/%/.test(r.person.slugDisplay)).map((r) => r.person.id)) },
  { id: 'url-shapes', description: 'Endorsement URLs are written without scheme (www.linkedin.com/in/<slug>), Notes URLs with a trailing slash; both normalize to linkedin.com/in/<slug>.', details: ['N01', 'N02', 'N03', 'N04', 'N05', 'N06', 'N07', 'N09', 'N10'] },
  { id: 'legacy-header', description: 'Pre-2020 header "First Name,Last Name,Email Address,Company,Position,Connected On" with no URL column and no Notes preamble; C08 also uses M/D/YY dates.', details: ['C08', 'C09'] },
  { id: 'utf8-bom', description: 'Classic file starting with a UTF-8 BOM (FORMAT.md 1.3: stripped by parseCsvRfc4180).', details: ['C03'] },
  { id: 'nested-zip-folder', description: 'Every file sits under Complete_LinkedInDataExport_<MM-DD-YYYY>/ inside the zip.', details: ['N02'] },
  { id: 'basic-export', description: 'Basic-shaped export: Connections, messages, Invitations, Profile, Positions, Education, Skills only (plus 8 non-whitelisted files).', details: ['N08'] },
  { id: 'message-drafts', description: 'messages.csv has the 12th IS MESSAGE DRAFT column; TRUE rows are skipped (including 2 draft-only conversations).', details: ['N01'] },
  { id: 'spam-folder', description: 'FOLDER=SPAM rows are skipped; N03 also has SPAM threads from connections.', details: ['N01', 'N03', 'N10'] },
  { id: 'no-messages-file', description: 'Zip without messages.csv: ownerDetected must be null and no message fields on rows.', details: ['N05'] },
  { id: 'owner-detected-by-profile-name', description: "messages.csv never shows the owner's own URL (blank SENDER PROFILE URL on owner rows, owner omitted from RECIPIENT PROFILE URLS); every non-connection URL appears in exactly one conversation, so URL detection ties and fails and the importer falls back to the Profile.csv name.", details: ['N04'] },
  { id: 'large-group-threads', description: 'Conversations with more than 5 non-owner participants are ignored for every counter.', details: perDataset((d) => (fullResults.get(d.id)?.edgeNotes.find((n) => n.kind === 'large-group-threads') || {}).count ?? null) },
  { id: 'sponsored-and-inmail', description: 'Sponsored messages from company pages (non-/in/ sender URL) and recruiter InMail from non-connections; neither credits a connection.', details: ['N01', 'N02', 'N03', 'N04', 'N06', 'N07', 'N08', 'N09', 'N10'] },
  { id: 'invitation-rules', description: 'Pending invitations to/from non-connections (dropped), blank-URL rows joined by unique name, an older opposite-direction row where the latest-dated row wins, ambiguous-name rows dropped.', details: perDataset((d) => (fullResults.get(d.id)?.edgeNotes || []).filter((n) => n.kind.startsWith('invitation'))) },
  { id: 'notes-rules', description: 'Multiple notes per connection concatenated, one note > 500 chars (capped), multi-line note (collapsed), blank note (skipped), note for a non-connection and for an ambiguous name (dropped), blank-URL name joins.', details: perDataset((d) => (fullResults.get(d.id)?.edgeNotes || []).filter((n) => n.kind.startsWith('note'))) },
  { id: 'endorsement-rules', description: 'PENDING/REJECTED rows not counted (one endorser has only PENDING rows => endorsementCount 0), blank-URL rows joined by unique name, endorsers who are not connections dropped.', details: ['N01', 'N02', 'N03', 'N04', 'N05', 'N06', 'N07', 'N09', 'N10'] },
  { id: 'recommendation-rules', description: 'Name-only join: non-VISIBLE rows leave recommendedYou false, an ambiguous-name VISIBLE row and a non-connection VISIBLE row are dropped.', details: perDataset((d) => (fullResults.get(d.id)?.edgeNotes || []).filter((n) => n.kind.startsWith('recommendation'))) },
  { id: 'context-caps', description: 'NETWORK_CONTEXT_CAPS exercised: N01 Company Follows.csv has 216 rows (one duplicate) => 200 followedCompanies; N07 Skills.csv has 57 rows (one case-duplicate) => 50 skills.', details: ['N01', 'N07'] },
  { id: 'job-changes-across-snapshots', description: 'The same person shows a different employer/title in two exports taken at different dates (see expected_graph.json jobChangesAcrossSnapshots).', details: null },
  { id: 'owner-owner-links', description: 'Owner-to-owner connections appear in both owners\' files with the same Connected On date.', details: links.map((l) => ({ a: l.a, b: l.b, connectedOn: iso(l.connectedOn) })) },
  { id: 'fictional-contact-data', description: 'Emails use example.com/.net/.org, phone numbers use 555-01xx, IPs use documentation ranges.', details: null },
];

// ---------------------------------------------------------------------------
// Graph exports + expected_graph.json
// ---------------------------------------------------------------------------
for (const f of buildGraphFiles(W, people, datasets, sets, fullResults, dn(TODAY))) writeOut(f.path, f.text, { format: 'graph', rows: f.rows });
const expectedGraph = computeExpectedGraph(people, datasets, sets, edgeCases);
const jc = expectedGraph.jobChangesAcrossSnapshots;
edgeCases.find((e) => e.id === 'job-changes-across-snapshots').details = { count: jc.count, examplePersonIds: jc.examplePersonIds };
writeOut('graph/expected_graph.json', json(expectedGraph), { format: 'graph-expected', rows: null });

// ---------------------------------------------------------------------------
// Composition stats + manifest
// ---------------------------------------------------------------------------
const composition = datasets.map((d) => {
  const ids = [...sets.get(d.id)];
  const home = ids.filter((id) => byId.get(id).home === d.community).length;
  const member = ids.filter((id) => byId.get(id).home === d.community || byId.get(id).second === d.community).length;
  return { datasetId: d.id, connections: ids.length, primaryHomeShare: Number((home / ids.length).toFixed(3)), homeMembershipShare: Number((member / ids.length).toFixed(3)) };
});
const pairOverlap = datasets.filter((d) => d.format === 'full').map((n) => {
  const c = datasets.find((x) => x.k === n.k && x.format !== 'full');
  let m = 0;
  for (const id of sets.get(n.id)) if (sets.get(c.id).has(id)) m += 1;
  return { pair: [n.id, c.id], mutual: m, shareOfSmaller: Number((m / Math.min(n.rows.length, c.rows.length)).toFixed(3)), target: MUTUAL_FRACTION[n.k] };
});

const manifest = {
  generator: 'testdata/generator/generate.mjs',
  command: 'node testdata/generator/generate.mjs',
  seed: SEED,
  today: TODAY,
  universe: {
    people: people.length,
    distinctPeopleInDatasets: expectedGraph.distinctPeople,
    owners: datasets.length,
    communities: world.communities.map((c) => c.id),
    note: 'All people are fictional; companies, schools, cities and industries are real.',
  },
  datasets: datasets.map((d) => ({
    id: d.id, file: d.file, format: d.format, community: d.community, exportDate: d.exportDate,
    owner: ownerOf(d), connections: d.rows.length, expected: `expected/${d.id}.json`,
  })),
  composition,
  pairOverlap,
  edgeCases,
  files: written.sort((a, b) => (a.path < b.path ? -1 : 1)),
};
const manifestText = json(manifest);
fs.writeFileSync(path.join(OUT, 'manifest.json'), manifestText);

// ---------------------------------------------------------------------------
// Self-checks: every zip opens with fflate; no date after its export date
// ---------------------------------------------------------------------------
for (const d of datasets.filter((x) => x.format === 'full')) {
  const entries = unzipSync(new Uint8Array(fs.readFileSync(path.join(OUT, d.file))));
  if (!Object.keys(entries).some((k) => k.toLowerCase().endsWith('connections.csv'))) throw new Error(`${d.file}: no Connections.csv`);
}
for (const d of datasets) {
  const e = JSON.parse(fs.readFileSync(path.join(OUT, `expected/${d.id}.json`), 'utf8'));
  for (const r of e.rows) {
    for (const k of ['connectedOnIso', 'lastMessagedAt', 'firstMessagedAt', 'invitedAt']) {
      if (r[k] && r[k] > d.exportDate) throw new Error(`${d.id} ${r.personId} ${k} ${r[k]} after ${d.exportDate}`);
    }
  }
}

const totalBytes = written.reduce((s, f) => s + f.bytes, 0);
console.log(`people=${people.length} distinctInDatasets=${expectedGraph.distinctPeople} components=${expectedGraph.connectedComponents} files=${written.length + 1} bytes=${totalBytes + manifestText.length}`);
console.log(`jobChangesAcrossSnapshots=${jc.count}/${jc.peopleInMultipleExports} (${jc.fraction})`);
for (const p of pairOverlap) console.log(`overlap ${p.pair.join('/')} mutual=${p.mutual} share=${p.shareOfSmaller}`);
for (const d of datasets) {
  const c = composition.find((x) => x.datasetId === d.id);
  const s = fullResults.get(d.id)?.summary;
  console.log(`${d.id} ${d.file} rows=${d.rows.length} home=${c.primaryHomeShare} member=${c.homeMembershipShare}` + (s ? ` owner=${s.ownerDetected} matched=${JSON.stringify(s.matched)}` : ''));
}
