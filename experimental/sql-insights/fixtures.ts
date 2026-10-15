// experimental/sql-insights/fixtures.ts
//
// Test/benchmark helpers for the sql-insights feature (Node only; never
// imported by the app). Loads testdata/ networks as ConnectionDoc[] and builds
// a deterministic synthetic network of any size.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConnectionDoc } from '../../lib/connectionsStore.ts';
import {
  COMPANY_KEYS,
  CONNECTED_ON_ISO_KEYS,
  CONNECTED_ON_KEYS,
  EMAIL_KEYS,
  ENDORSEMENT_COUNT_KEYS,
  FIRST_MESSAGED_KEYS,
  FIRST_NAME_KEYS,
  FULL_NAME_KEYS,
  INVITATION_KEYS,
  INVITED_AT_KEYS,
  LAST_MESSAGED_KEYS,
  LAST_NAME_KEYS,
  MESSAGE_COUNT_KEYS,
  MESSAGES_RECEIVED_KEYS,
  MESSAGES_SENT_KEYS,
  NOTE_KEYS,
  POSITION_KEYS,
  RECOMMENDED_YOU_KEYS,
  URL_KEYS,
  getBooleanField,
  getField,
  getNumberField,
  parseCsvToObjects,
} from '../../lib/connectionFields.ts';
import type { NetworkContext } from '../../lib/connectionFields.ts';
import { parseLinkedInExportZip } from '../../lib/linkedinExport.ts';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const orNull = (s: string): string | null => (s.trim() ? s.trim() : null);

/**
 * Same mapping as rowToDoc in lib/connectionsStore.ts (that module imports
 * firebase, so Node cannot load it); keep the two in step.
 */
export function docFromRow(row: Record<string, unknown>): ConnectionDoc {
  const first = getField(row, FIRST_NAME_KEYS);
  const last = getField(row, LAST_NAME_KEYS);
  const full = getField(row, FULL_NAME_KEYS) || `${first} ${last}`.trim();
  const inv = getField(row, INVITATION_KEYS).trim().toLowerCase();
  return {
    firstName: orNull(first),
    lastName: orNull(last),
    fullName: orNull(full),
    company: orNull(getField(row, COMPANY_KEYS)),
    position: orNull(getField(row, POSITION_KEYS)),
    email: orNull(getField(row, EMAIL_KEYS)),
    url: orNull(getField(row, URL_KEYS)),
    connectedOnRaw: orNull(getField(row, CONNECTED_ON_KEYS)),
    connectedOn: orNull(getField(row, CONNECTED_ON_ISO_KEYS)),
    messageCount: getNumberField(row, MESSAGE_COUNT_KEYS),
    messagesSent: getNumberField(row, MESSAGES_SENT_KEYS),
    messagesReceived: getNumberField(row, MESSAGES_RECEIVED_KEYS),
    lastMessagedAt: orNull(getField(row, LAST_MESSAGED_KEYS)),
    firstMessagedAt: orNull(getField(row, FIRST_MESSAGED_KEYS)),
    invitation: inv === 'incoming' || inv === 'outgoing' ? inv : null,
    invitedAt: orNull(getField(row, INVITED_AT_KEYS)),
    note: orNull(getField(row, NOTE_KEYS)),
    endorsementCount: getNumberField(row, ENDORSEMENT_COUNT_KEYS),
    recommendedYou: getBooleanField(row, RECOMMENDED_YOU_KEYS),
  };
}

export function loadZipNetwork(name: string): { docs: ConnectionDoc[]; ctx: NetworkContext | null } {
  const file = path.join(REPO, 'testdata', 'networks', 'full', `${name}.zip`);
  const r = parseLinkedInExportZip(new Uint8Array(readFileSync(file)), `${name}.zip`);
  return { docs: r.rows.map(docFromRow), ctx: r.context };
}

export function loadCsvNetwork(name: string): ConnectionDoc[] {
  const file = path.join(REPO, 'testdata', 'networks', 'classic', `${name}.csv`);
  return parseCsvToObjects(readFileSync(file, 'utf8')).map(docFromRow);
}

// Deterministic PRNG (mulberry32).
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'Acme', 'Blue', 'River', 'North', 'Summit', 'Bright', 'Cedar', 'Delta', 'Echo', 'Falcon', 'Granite',
  'Harbor', 'Iron', 'Juniper', 'Kite', 'Lumen', 'Maple', 'Nova', 'Orbit', 'Pine', 'Quartz', 'Ridge',
  'Signal', 'Tidal', 'Union', 'Vertex', 'Willow', 'Zenith',
];
const SUFFIXES = ['Inc', 'Labs', 'Health', 'Capital', 'Systems', 'LLC', 'Group', 'Analytics', 'Bank', 'Studio'];
const TITLES = [
  'Software Engineer', 'Senior Software Engineer', 'Data Scientist', 'Product Manager', 'Technical Recruiter',
  'Account Executive', 'UX Designer', 'Marketing Manager', 'Co-Founder & CEO', 'Data Analyst',
  'Engineering Manager', 'Sales Director', 'Chief Financial Officer', 'Nurse Practitioner', 'Teacher', '',
];
const FIRST = ['Ana', 'Ben', 'Chen', 'Dina', 'Eli', 'Fatima', 'Goran', 'Hana', 'Ivan', 'Jia', 'Kofi', 'Lena'];
const LAST = ['Park', 'Okafor', 'Silva', 'Novak', 'Kim', 'Haddad', 'Ito', 'Moreau', 'Rossi', 'Shah'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Every synthetic note contains this marker, so tests can prove notes stay out of the DB. */
export const SYNTHETIC_NOTE_MARKER = 'SYNTHETIC-NOTE-TEXT-7f3a';

const iso = (y: number, m: number, d: number): string =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** A deterministic synthetic network (labelled synthetic; not real people). */
export function syntheticNetwork(
  n: number,
  seed = 421
): { docs: ConnectionDoc[]; ctx: NetworkContext; companies: string[] } {
  const r = rng(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const companies: string[] = [];
  for (let i = 0; i < 2000; i++) companies.push(`${pick(WORDS)} ${pick(WORDS)} ${pick(SUFFIXES)} ${i}`);

  const docs: ConnectionDoc[] = [];
  for (let i = 0; i < n; i++) {
    const first = pick(FIRST);
    const last = pick(LAST);
    const y = 2008 + Math.floor(r() * 19);
    const m = 1 + Math.floor(r() * 12);
    const d = 1 + Math.floor(r() * 28);
    const messaged = r() < 0.3;
    const count = messaged ? 1 + Math.floor(r() * 40) : null;
    const company = r() < 0.05 ? null : companies[Math.floor(Math.pow(r(), 2) * companies.length)];
    const title = pick(TITLES);
    docs.push({
      firstName: first,
      lastName: last,
      fullName: `${first} ${last}`,
      company,
      position: title || null,
      email: r() < 0.1 ? `person${i}@example.com` : null,
      url: `https://www.linkedin.com/in/synthetic-${i}`,
      connectedOnRaw: `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`,
      // Half the rows carry the ISO date, half rely on the raw-date fallback.
      connectedOn: i % 2 ? iso(y, m, d) : null,
      messageCount: count,
      messagesSent: messaged ? Math.floor(r() * 3) : null,
      messagesReceived: messaged ? Math.floor(r() * 3) : null,
      lastMessagedAt: messaged ? iso(2020 + Math.floor(r() * 7), m, d) : null,
      firstMessagedAt: messaged ? iso(2015 + Math.floor(r() * 5), m, d) : null,
      invitation: r() < 0.5 ? (r() < 0.5 ? 'incoming' : 'outgoing') : null,
      invitedAt: null,
      note: r() < 0.02 ? `${SYNTHETIC_NOTE_MARKER} met at conference ${i}` : null,
      endorsementCount: r() < 0.1 ? 1 + Math.floor(r() * 5) : null,
      recommendedYou: r() < 0.01 ? true : null,
    });
  }

  // Context at NETWORK_CONTEXT_CAPS (the worst case for the target-companies card).
  const ctx: NetworkContext = {
    name: 'Synthetic Owner',
    headline: 'Synthetic headline',
    industry: 'Software',
    positions: [
      { company: companies[0], title: 'Engineer', current: true },
      { company: companies[1], title: 'Intern', current: false },
    ],
    schools: [],
    skills: ['SQL', 'TypeScript', 'React'],
    followedCompanies: companies.slice(100, 300),
    appliedCompanies: companies.slice(0, 100),
    appliedTitles: [],
    dreamCompanies: companies.slice(300, 350),
    desiredTitles: [],
    source: { fileName: 'synthetic.zip', importedAt: '2026-10-15T00:00:00.000Z' },
  };
  return { docs, ctx, companies };
}
