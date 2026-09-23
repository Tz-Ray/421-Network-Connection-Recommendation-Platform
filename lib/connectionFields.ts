// lib/connectionFields.ts
//
// Pure helpers shared by the Recommender, the Firestore store, the LinkedIn
// export importer and the relationship scorer. No firebase, no React: this
// module must stay importable from plain Node (type stripping), so relative
// imports elsewhere use explicit '.ts' extensions and nothing here has runtime
// TypeScript-only syntax.

// -----------------------------
// Types
// -----------------------------
export type NetworkPosition = { company: string; title: string; current: boolean };

/**
 * Owner context derived from a LinkedIn data export. Every key is always
 * present (null or []), arrays are deduped case-insensitively and capped by
 * NETWORK_CONTEXT_CAPS. appliedCompanies / appliedTitles are for local scoring
 * only and must never be sent to the AI proxy.
 */
export type NetworkContext = {
  name: string | null;
  headline: string | null;
  industry: string | null;
  positions: NetworkPosition[];
  schools: string[];
  skills: string[];
  followedCompanies: string[];
  appliedCompanies: string[];
  appliedTitles: string[];
  dreamCompanies: string[];
  desiredTitles: string[];
  source: { fileName: string; importedAt: string };
};

export const NETWORK_CONTEXT_CAPS = {
  positions: 30,
  schools: 10,
  skills: 50,
  followedCompanies: 200,
  appliedCompanies: 100,
  appliedTitles: 100,
  dreamCompanies: 50,
  desiredTitles: 50,
} as const;

// -----------------------------
// sessionStorage keys
// -----------------------------

/**
 * sessionStorage key holding the compact copy of the confirmed dataset.
 * Shared by RecommenderScreen (writer), AIScreen (reader) and Sidebar (clears
 * it on sign-out so the next user never sees the previous user's network).
 */
export const SESSION_KEY = 'network_connections_compact_v1';

/** sessionStorage key holding the NetworkContext of the confirmed dataset. */
export const CONTEXT_SESSION_KEY = 'network_context_v1';

// -----------------------------
// Accepted header names
// -----------------------------
// Every getField call site in the app reads these exact synonyms, so scoring,
// previews, the compact copy and the Firestore mapping can never disagree about
// what counts as a Position or a Company. The first entry of each list is the
// canonical header written by the importer and by docToRow.
export const FIRST_NAME_KEYS = ['First Name', 'first_name', 'firstname'];
export const LAST_NAME_KEYS = ['Last Name', 'last_name', 'lastname'];
export const FULL_NAME_KEYS = ['Full Name'];
export const POSITION_KEYS = ['Position', 'title', 'role', 'position'];
export const COMPANY_KEYS = ['Company', 'org', 'company', 'organization', 'firm'];
export const EMAIL_KEYS = ['Email Address'];
export const URL_KEYS = ['URL'];
export const CONNECTED_ON_KEYS = ['Connected On'];

// Enrichment keys (present only on rows enriched from a LinkedIn export zip).
// Counts are stored as numbers, dates as 'YYYY-MM-DD'.
export const CONNECTED_ON_ISO_KEYS = ['Connected On (ISO)'];
export const MESSAGE_COUNT_KEYS = ['Messages'];
export const MESSAGES_SENT_KEYS = ['Messages Sent'];
export const MESSAGES_RECEIVED_KEYS = ['Messages Received'];
export const LAST_MESSAGED_KEYS = ['Last Messaged'];
export const FIRST_MESSAGED_KEYS = ['First Messaged'];
export const INVITATION_KEYS = ['Invitation'];
export const INVITED_AT_KEYS = ['Invited At'];
export const NOTE_KEYS = ['Note'];
export const ENDORSEMENT_COUNT_KEYS = ['Endorsements'];
export const RECOMMENDED_YOU_KEYS = ['Recommended You'];

// -----------------------------
// Field lookup
// -----------------------------
export function toText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(toText).join(' ');
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

export function normalizeKey(k: string): string {
  return k.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function getField(row: Record<string, unknown>, keys: string[]): string {
  const keySet = new Set(keys.map(normalizeKey));
  for (const [k, v] of Object.entries(row)) {
    if (keySet.has(normalizeKey(k))) return toText(v);
  }
  return '';
}

/** Like getField, but returns the raw value (undefined when no key matches). */
export function getRawField(row: Record<string, unknown>, keys: string[]): unknown {
  const keySet = new Set(keys.map(normalizeKey));
  for (const [k, v] of Object.entries(row)) {
    if (keySet.has(normalizeKey(k))) return v;
  }
  return undefined;
}

/** A finite number, or a numeric string; anything else is null. */
export function getNumberField(row: Record<string, unknown>, keys: string[]): number | null {
  const v = getRawField(row, keys);
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
}

/** A boolean, or the strings 'true' / 'false'; anything else is null. */
export function getBooleanField(row: Record<string, unknown>, keys: string[]): boolean | null {
  const v = getRawField(row, keys);
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return null;
}

// Company stopwords / low-signal tokens that cause junk matches
export const COMPANY_STOPWORDS: ReadonlySet<string> = new Set([
  'inc', 'llc', 'ltd', 'co', 'company', 'corp', 'corporation',
  'group', 'partners', 'capital', 'ventures', 'holdings',
  'technologies', 'technology', 'tech', 'systems', 'solutions', 'services',
  'engineering', 'engineer', 'web', 'app', 'apps', 'labs', 'studio', 'studios',
  'consulting', 'associates'
]);

// -----------------------------
// RFC-4180-ish CSV parser
// -----------------------------
export function parseCsvRfc4180(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const next = clean[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;

      row.push(cell);
      cell = '';

      const isEmpty = row.every((v) => v.trim() === '');
      if (!isEmpty) rows.push(row.map((v) => v.trim()));

      row = [];
      continue;
    }

    cell += ch;
  }

  row.push(cell);
  if (!row.every((v) => v.trim() === '')) {
    rows.push(row.map((v) => v.trim()));
  }

  return rows;
}

function findHeaderRowIndex(table: string[][]): number {
  const hasHeader = (r: string[], header: string) =>
    r.some((c) => normalizeKey(c) === normalizeKey(header));

  for (let i = 0; i < table.length; i++) {
    const r = table[i];
    if (hasHeader(r, 'First Name') && hasHeader(r, 'Last Name')) return i;
  }

  return table.length > 0 ? 0 : -1;
}

/**
 * Parses a Connections-style CSV into row objects keyed by header. LinkedIn's
 * "Notes:" preamble is skipped by finding the row containing both `First Name`
 * and `Last Name` (else row 0); `Full Name` is synthesized only when absent.
 */
export function parseCsvToObjects(text: string): Record<string, unknown>[] {
  const table = parseCsvRfc4180(text);
  const headerIdx = findHeaderRowIndex(table);
  if (headerIdx === -1) return [];

  const headers = table[headerIdx].map((h) => h.trim());
  const dataRows = table.slice(headerIdx + 1);

  const out: Record<string, unknown>[] = [];

  for (const r of dataRows) {
    if (r.every((v) => v.trim() === '')) continue;

    const obj: Record<string, unknown> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c] || `col_${c}`;
      obj[key] = (r[c] ?? '').trim();
    }

    // Only synthesize a full name when the export did not already supply one.
    if (!getField(obj, FULL_NAME_KEYS).trim()) {
      const first = getField(obj, FIRST_NAME_KEYS);
      const last = getField(obj, LAST_NAME_KEYS);
      if (first || last) obj['Full Name'] = `${first} ${last}`.trim();
    }

    out.push(obj);
  }

  return out;
}

// -----------------------------
// NetworkContext validation
// -----------------------------
function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === 'string';
}

function stringArray(v: unknown, cap: number): string[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every((s) => typeof s === 'string')) return null;
  return (v as string[]).slice(0, cap);
}

/**
 * Validates an untrusted value (a Firestore field, a parsed sessionStorage
 * entry) as a NetworkContext. Returns a fresh, capped copy, or null when
 * anything is malformed.
 */
export function toNetworkContext(v: unknown): NetworkContext | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;

  if (!isStringOrNull(o.name) || !isStringOrNull(o.headline) || !isStringOrNull(o.industry)) {
    return null;
  }

  if (!Array.isArray(o.positions)) return null;
  const positions: NetworkPosition[] = [];
  for (const p of o.positions) {
    if (!p || typeof p !== 'object') return null;
    const q = p as Record<string, unknown>;
    if (typeof q.company !== 'string' || typeof q.title !== 'string' || typeof q.current !== 'boolean') {
      return null;
    }
    positions.push({ company: q.company, title: q.title, current: q.current });
  }

  const caps = NETWORK_CONTEXT_CAPS;
  const schools = stringArray(o.schools, caps.schools);
  const skills = stringArray(o.skills, caps.skills);
  const followedCompanies = stringArray(o.followedCompanies, caps.followedCompanies);
  const appliedCompanies = stringArray(o.appliedCompanies, caps.appliedCompanies);
  const appliedTitles = stringArray(o.appliedTitles, caps.appliedTitles);
  const dreamCompanies = stringArray(o.dreamCompanies, caps.dreamCompanies);
  const desiredTitles = stringArray(o.desiredTitles, caps.desiredTitles);
  if (
    !schools || !skills || !followedCompanies || !appliedCompanies ||
    !appliedTitles || !dreamCompanies || !desiredTitles
  ) {
    return null;
  }

  const src = o.source;
  if (!src || typeof src !== 'object') return null;
  const s = src as Record<string, unknown>;
  if (typeof s.fileName !== 'string' || typeof s.importedAt !== 'string') return null;

  return {
    name: o.name,
    headline: o.headline,
    industry: o.industry,
    positions: positions.slice(0, caps.positions),
    schools,
    skills,
    followedCompanies,
    appliedCompanies,
    appliedTitles,
    dreamCompanies,
    desiredTitles,
    source: { fileName: s.fileName, importedAt: s.importedAt },
  };
}
