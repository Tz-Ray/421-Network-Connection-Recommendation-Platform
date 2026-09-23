// lib/linkedinExport.ts
//
// Reads LinkedIn's "Get a copy of your data" .zip (Complete or Basic export, or
// a zip holding only Connections.csv) entirely in the browser.
//
// Privacy contract:
// - Only whitelisted files are ever decompressed (fflate's unzip filter returns
//   false for everything else, so those bytes are never inflated).
// - Only derived aggregates are kept: message counts and dates, never message
//   text, subjects, conversation titles or invitation messages.
// - CSV columns are always looked up by header name, never by position.
//
// Pure module: no firebase, no React. Relative imports carry explicit '.ts'
// extensions so plain Node (type stripping) can import it for tests.

import { strFromU8, unzipSync } from 'fflate';
import {
  CONNECTED_ON_ISO_KEYS,
  CONNECTED_ON_KEYS,
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
  NETWORK_CONTEXT_CAPS,
  NOTE_KEYS,
  RECOMMENDED_YOU_KEYS,
  URL_KEYS,
  getField,
  normalizeKey,
  parseCsvRfc4180,
  parseCsvToObjects,
} from './connectionFields.ts';
import type { NetworkContext, NetworkPosition } from './connectionFields.ts';

// -----------------------------
// Public types
// -----------------------------
export type ImportSummary = {
  fileName: string;
  connections: number;
  filesUsed: { name: string; rows: number }[];
  filesSkipped: string[]; // basenames, sorted
  ownerDetected: boolean | null; // null = no messages.csv
  matched: {
    messages: number;
    invitations: number;
    notes: number;
    endorsements: number;
    recommendations: number;
  };
  warnings: string[];
};

export type ImportResult = {
  rows: Record<string, unknown>[];
  context: NetworkContext | null;
  summary: ImportSummary;
};

// -----------------------------
// Whitelist (matched by basename, case-insensitive, at any folder depth)
// -----------------------------
type FileId =
  | 'connections'
  | 'messages'
  | 'invitations'
  | 'notes'
  | 'endorsements'
  | 'recommendations'
  | 'profile'
  | 'positions'
  | 'education'
  | 'skills'
  | 'follows'
  | 'applications'
  | 'savedJobs'
  | 'preferences';

// Order here is the order of summary.filesUsed.
const WHITELIST: [FileId, string][] = [
  ['connections', 'connections.csv'],
  ['messages', 'messages.csv'],
  ['invitations', 'invitations.csv'],
  ['notes', 'notes.csv'],
  ['endorsements', 'endorsement_received_info.csv'],
  ['recommendations', 'recommendations_received.csv'],
  ['profile', 'profile.csv'],
  ['positions', 'positions.csv'],
  ['education', 'education.csv'],
  ['skills', 'skills.csv'],
  ['follows', 'company follows.csv'],
  ['applications', 'job applications.csv'],
  ['savedJobs', 'saved jobs.csv'],
  ['preferences', 'job seeker preferences.csv'],
];

const WHITELIST_BY_BASENAME = new Map<string, FileId>(
  WHITELIST.map(([id, base]) => [base, id])
);

// Files that make up the owner context. A zip holding none of them gets
// context = null (e.g. a Connections-only zip).
const OWNER_FILES: FileId[] = [
  'profile',
  'positions',
  'education',
  'skills',
  'follows',
  'applications',
  'savedJobs',
  'preferences',
];

const MAX_THREAD_PARTICIPANTS = 5;
const MAX_NOTE_CHARS = 500;

const OWNER_UNKNOWN_WARNING =
  'Could not tell which messages are yours; message history was not used';

// -----------------------------
// Small helpers
// -----------------------------
function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? '';
}

// `[url]`, `[firstname]`, and cells made only of placeholders such as
// `[firstname] [lastname]` count as empty everywhere.
const PLACEHOLDER_RE = /^\[[a-z0-9]+\](?:\s+\[[a-z0-9]+\])*$/i;

function isPlaceholder(s: string): boolean {
  return PLACEHOLDER_RE.test(s.trim());
}

function clean(s: string): string {
  const t = (s ?? '').trim();
  return t && !isPlaceholder(t) ? t : '';
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Split on ';', or on ',' only when no ';' is present. */
function splitList(s: string): string[] {
  const sep = s.includes(';') ? ';' : ',';
  return s
    .split(sep)
    .map((x) => clean(x))
    .filter(Boolean);
}

function isTruthyCell(s: string): boolean {
  return /^(true|yes|y|1)$/i.test(s.trim());
}

type Table = {
  rows: string[][];
  col: (header: string) => number;
};

/**
 * Parses a CSV and indexes its columns by header name. The header row is the
 * first of the leading rows that contains one of `expected` (else row 0).
 */
function readTable(text: string, expected: string[]): Table {
  const table = parseCsvRfc4180(text);
  const wanted = new Set(expected.map(normalizeKey));
  let headerIdx = 0;
  for (let i = 0; i < Math.min(table.length, 10); i++) {
    if (table[i].some((c) => wanted.has(normalizeKey(c)))) {
      headerIdx = i;
      break;
    }
  }

  const headers = (table[headerIdx] ?? []).map(normalizeKey);
  const index = new Map<string, number>();
  headers.forEach((h, i) => {
    if (h && !index.has(h)) index.set(h, i);
  });

  return {
    rows: table.slice(headerIdx + 1),
    col: (header: string) => index.get(normalizeKey(header)) ?? -1,
  };
}

function cellAt(r: string[], idx: number): string {
  if (idx < 0) return '';
  return clean(r[idx] ?? '');
}

/** Case-insensitive dedupe + cap, preserving first-seen order and spelling. */
type UniqueList = { items: string[]; add: (value: string) => void };

function uniqueList(cap: number): UniqueList {
  const items: string[] = [];
  const seen = new Set<string>();
  return {
    items,
    add(value: string) {
      const v = collapse(clean(value));
      if (!v || items.length >= cap) return;
      const key = v.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      items.push(v);
    },
  };
}

// -----------------------------
// Keys
// -----------------------------

/**
 * Normalizes a LinkedIn profile URL to `linkedin.com/in/<slug>`: trims,
 * lowercases, strips scheme, `www.` (or a two-letter locale subdomain), query,
 * fragment, trailing slash and any path after the slug. Returns null for
 * anything that is not a /in/ profile URL (including placeholders).
 */
export function normalizeProfileUrl(s: string): string | null {
  if (typeof s !== 'string') return null;
  let t = s.trim().toLowerCase();
  if (!t || isPlaceholder(t)) return null;

  t = t.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^\/\//, '');
  t = t.replace(/[?#].*$/, '');
  t = t.replace(/^www\./, '');

  const m = /^(?:[a-z]{2}\.)?linkedin\.com\/in\/([^/]+)/.exec(t);
  if (!m) return null;

  let slug = m[1];
  try {
    slug = decodeURIComponent(slug).toLowerCase();
  } catch {
    // keep the raw (still lowercased) slug
  }
  slug = slug.trim();
  return slug ? `linkedin.com/in/${slug}` : null;
}

/** NFKD, strip diacritics, lowercase, drop punctuation, collapse whitespace. */
export function normalizePersonName(s: string): string {
  if (typeof s !== 'string') return '';
  const t = s.trim();
  if (!t || isPlaceholder(t)) return '';
  return t
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// -----------------------------
// Dates
// -----------------------------
const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function monthOf(name: string): number | null {
  return MONTHS[name.toLowerCase()] ?? null;
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

function ymd(year: number, month: number, day: number): string | null {
  const y = year < 100 ? 2000 + year : year;
  if (!Number.isInteger(y) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (y < 1900 || y > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const t = new Date(Date.UTC(y, month - 1, day));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== month - 1 || t.getUTCDate() !== day) {
    return null;
  }
  return `${pad(y, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

const TIME_SUFFIX = String.raw`(?:,?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:\s*[ap]\.?m\.?)?(?:\s+[a-z]{2,5})?)?`;

const RE_ISO = new RegExp(
  String.raw`^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[t\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(z|utc|gmt|[+-]\d{2}(?::?\d{2})?)?$`,
  'i'
);
const RE_YEAR_MONTH = /^(\d{4})-(\d{1,2})$/;
const RE_YEAR = /^(\d{4})$/;
const RE_SLASH = new RegExp(String.raw`^(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})${TIME_SUFFIX}$`, 'i');
const RE_DAY_MON_YEAR = new RegExp(
  String.raw`^(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{2}|\d{4})${TIME_SUFFIX}$`,
  'i'
);
// "Mon Sep 15 17:23:45 UTC 2026", "Sep 15, 2026", "September 15 2026"
const RE_MON_DAY_YEAR =
  /^(?:[a-z]{3,9},?\s+)?([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(?:\d{1,2}:\d{2}(?::\d{2})?\s+(?:[a-z]{2,5}\s+)?)?(\d{4})$/i;
const RE_MON_YEAR = /^([a-z]{3,9})\.?,?\s+(\d{4})$/i;

function parseDateUnsafe(input: string): string | null {
  const s = collapse(input);
  if (!s || isPlaceholder(s)) return null;

  let m = RE_ISO.exec(s);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const base = ymd(y, mo, d);
    if (!base) return null;
    const zone = m[7];
    // A numeric offset with a time: convert to the UTC calendar date.
    if (m[4] != null && zone && /^[+-]/.test(zone)) {
      const sign = zone[0] === '-' ? -1 : 1;
      const digits = zone.slice(1).replace(':', '');
      const oh = Number(digits.slice(0, 2));
      const om = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
      const ms =
        Date.UTC(y, mo - 1, d, Number(m[4]), Number(m[5]), Number(m[6] ?? 0)) -
        sign * (oh * 60 + om) * 60_000;
      const t = new Date(ms);
      return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    }
    return base;
  }

  m = RE_YEAR_MONTH.exec(s);
  if (m) return ymd(Number(m[1]), Number(m[2]), 1);

  m = RE_YEAR.exec(s);
  if (m) return ymd(Number(m[1]), 1, 1);

  m = RE_SLASH.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    // LinkedIn writes M/D/YY; accept D/M/YY only when M/D is impossible.
    if (a > 12 && b <= 12) return ymd(y, b, a);
    return ymd(y, a, b);
  }

  m = RE_DAY_MON_YEAR.exec(s);
  if (m) {
    const mo = monthOf(m[2]);
    return mo ? ymd(Number(m[3]), mo, Number(m[1])) : null;
  }

  m = RE_MON_DAY_YEAR.exec(s);
  if (m) {
    const mo = monthOf(m[1]);
    return mo ? ymd(Number(m[3]), mo, Number(m[2])) : null;
  }

  m = RE_MON_YEAR.exec(s);
  if (m) {
    const mo = monthOf(m[1]);
    return mo ? ymd(Number(m[2]), mo, 1) : null;
  }

  return null;
}

/**
 * Parses the date formats found across LinkedIn exports into 'YYYY-MM-DD'
 * (UTC, no local-time drift). Two-digit years map to 20YY; month-only and
 * year-only values map to the first day. Never throws; null on placeholders
 * or anything unrecognized.
 */
export function parseLinkedInDate(s: string): string | null {
  try {
    return typeof s === 'string' ? parseDateUnsafe(s) : null;
  } catch {
    return null;
  }
}

// -----------------------------
// Messages
// -----------------------------
type MessageRow = {
  conv: string;
  fromRaw: string;
  fromKey: string;
  senderUrl: string | null;
  toRaw: string;
  toKeys: string[];
  recipientUrls: string[];
  date: string | null;
};

type MessageAcc = {
  count: number;
  sent: number;
  received: number;
  first: string | null;
  last: string | null;
};

function readMessages(text: string): { rows: MessageRow[]; total: number } {
  const t = readTable(text, ['CONVERSATION ID', 'FROM', 'SENDER PROFILE URL']);
  const cConv = t.col('CONVERSATION ID');
  const cFrom = t.col('FROM');
  const cSender = t.col('SENDER PROFILE URL');
  const cTo = t.col('TO');
  const cRecipients = t.col('RECIPIENT PROFILE URLS');
  const cDate = t.col('DATE');
  const cFolder = t.col('FOLDER');
  const cDraft = t.col('IS MESSAGE DRAFT');

  const out: MessageRow[] = [];
  t.rows.forEach((r, i) => {
    if (cDraft >= 0 && isTruthyCell(cellAt(r, cDraft))) return;
    if (cFolder >= 0 && cellAt(r, cFolder).toUpperCase() === 'SPAM') return;

    const fromRaw = cellAt(r, cFrom);
    const toRaw = cellAt(r, cTo);
    const recipientUrls = Array.from(
      new Set(
        splitList(cellAt(r, cRecipients))
          .map(normalizeProfileUrl)
          .filter((u): u is string => !!u)
      )
    );

    out.push({
      // A row without a conversation id is treated as its own conversation.
      conv: cellAt(r, cConv) || `\u0000row${i}`,
      fromRaw,
      fromKey: normalizePersonName(fromRaw),
      senderUrl: normalizeProfileUrl(cellAt(r, cSender)),
      toRaw,
      toKeys: splitList(toRaw).map(normalizePersonName).filter(Boolean),
      recipientUrls,
      date: parseLinkedInDate(cellAt(r, cDate)),
    });
  });

  return { rows: out, total: t.rows.length };
}

/**
 * The owner is in every conversation but is never their own connection: the
 * non-connection URL present in the most distinct conversations. Ties are
 * broken with the Profile.csv name against FROM / TO names; else null.
 */
function detectOwnerUrl(
  msgs: MessageRow[],
  isConnectionUrl: (u: string) => boolean,
  ownerName: string | null
): string | null {
  const convsByUrl = new Map<string, Set<string>>();
  for (const m of msgs) {
    for (const u of [m.senderUrl, ...m.recipientUrls]) {
      if (!u || isConnectionUrl(u)) continue;
      let set = convsByUrl.get(u);
      if (!set) convsByUrl.set(u, (set = new Set()));
      set.add(m.conv);
    }
  }

  let best = 0;
  let tied: string[] = [];
  for (const [u, set] of convsByUrl) {
    if (set.size > best) {
      best = set.size;
      tied = [u];
    } else if (set.size === best) {
      tied.push(u);
    }
  }

  if (tied.length === 1) return tied[0];
  if (tied.length === 0 || !ownerName) return null;

  const agreement = new Map<string, number>();
  for (const m of msgs) {
    for (const u of tied) {
      const asSender = m.senderUrl === u && m.fromKey === ownerName;
      const asRecipient =
        m.recipientUrls.length === 1 &&
        m.recipientUrls[0] === u &&
        m.toKeys.length === 1 &&
        m.toKeys[0] === ownerName;
      if (asSender || asRecipient) agreement.set(u, (agreement.get(u) ?? 0) + 1);
    }
  }

  let top = 0;
  let winners: string[] = [];
  for (const [u, n] of agreement) {
    if (n > top) {
      top = n;
      winners = [u];
    } else if (n === top) {
      winners.push(u);
    }
  }
  return winners.length === 1 ? winners[0] : null;
}

// -----------------------------
// Main entry point
// -----------------------------

/**
 * Parses a LinkedIn data export zip. Throws an Error with a user-facing
 * message when the file is not a readable zip or holds no Connections.csv.
 */
export function parseLinkedInExportZip(bytes: Uint8Array, fileName: string): ImportResult {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error(
      'This file is not a .zip archive. Upload the .zip LinkedIn sent you, or a Connections.csv file.'
    );
  }

  const picked = new Map<FileId, string>(); // id -> full archive path
  const skipped = new Set<string>();
  const warnings: string[] = [];

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (f) => {
        if (f.name.endsWith('/') || f.name.endsWith('\\')) return false;
        const base = basename(f.name);
        const id = WHITELIST_BY_BASENAME.get(base.toLowerCase());
        if (!id) {
          if (base) skipped.add(base);
          return false;
        }
        if (picked.has(id)) {
          warnings.push(`Found more than one ${base}; used "${picked.get(id)}".`);
          return false;
        }
        picked.set(id, f.name);
        return true;
      },
    });
  } catch {
    throw new Error(
      'Could not read this .zip archive. It may be damaged or use an unsupported format; try downloading the export from LinkedIn again.'
    );
  }

  const textOf = (id: FileId): string | null => {
    const path = picked.get(id);
    if (!path) return null;
    const data = entries[path];
    return data ? strFromU8(data) : null;
  };
  const baseOf = (id: FileId): string => basename(picked.get(id) ?? '');

  const connectionsText = textOf('connections');
  if (connectionsText == null) {
    throw new Error(
      'No Connections.csv found in this .zip. Upload the archive from LinkedIn\'s "Get a copy of your data" (Complete or Basic), or Connections.csv itself.'
    );
  }

  const filesUsed: { name: string; rows: number }[] = [];
  const used = new Map<FileId, number>();
  const markUsed = (id: FileId, rows: number) => used.set(id, rows);

  // ---- Connections (rows exactly as the .csv path produces them) ----
  const rows = parseCsvToObjects(connectionsText).map((r) => ({ ...r }));
  markUsed('connections', rows.length);
  if (rows.length === 0) warnings.push('Connections.csv has no connections in it.');

  const urlIndex = new Map<string, number>();
  const nameIndex = new Map<string, number[]>();
  rows.forEach((row, i) => {
    const u = normalizeProfileUrl(clean(getField(row, URL_KEYS)));
    if (u && !urlIndex.has(u)) urlIndex.set(u, i);

    const first = clean(getField(row, FIRST_NAME_KEYS));
    const last = clean(getField(row, LAST_NAME_KEYS));
    const display = `${first} ${last}`.trim() || clean(getField(row, FULL_NAME_KEYS));
    const n = normalizePersonName(display);
    if (n) {
      const list = nameIndex.get(n);
      if (list) list.push(i);
      else nameIndex.set(n, [i]);
    }
  });

  /**
   * Join rule: a valid profile URL joins by URL only (no match = not a
   * connection). The name fallback is used only when the URL is blank or not
   * a profile URL, and only when the name maps to exactly one connection.
   */
  const join = (url: string | null, rawName: string): number | null => {
    if (url) return urlIndex.get(url) ?? null;
    const n = normalizePersonName(rawName);
    if (!n) return null;
    const list = nameIndex.get(n);
    return list && list.length === 1 ? list[0] : null;
  };

  // ---- Profile (owner name is needed for message owner detection) ----
  let ownerDisplayName: string | null = null;
  let headline: string | null = null;
  let industry: string | null = null;
  const profileText = textOf('profile');
  if (profileText != null) {
    const t = readTable(profileText, ['First Name', 'Last Name', 'Headline']);
    const r = t.rows[0];
    if (r) {
      const name = `${cellAt(r, t.col('First Name'))} ${cellAt(r, t.col('Last Name'))}`.trim();
      ownerDisplayName = collapse(name) || null;
      headline = collapse(cellAt(r, t.col('Headline'))) || null;
      industry = collapse(cellAt(r, t.col('Industry'))) || null;
    }
    markUsed('profile', t.rows.length);
  }
  const ownerName = ownerDisplayName ? normalizePersonName(ownerDisplayName) || null : null;

  // ---- messages.csv ----
  let ownerDetected: boolean | null = null;
  let messageAcc: MessageAcc[] | null = null;
  const messagesText = textOf('messages');
  if (messagesText != null) {
    const { rows: msgs, total } = readMessages(messagesText);
    markUsed('messages', total);

    const ownerUrl = detectOwnerUrl(msgs, (u) => urlIndex.has(u), ownerName);

    if (!ownerUrl && !ownerName) {
      ownerDetected = false;
      warnings.push(OWNER_UNKNOWN_WARNING);
    } else {
      ownerDetected = true;
      messageAcc = rows.map(() => ({ count: 0, sent: 0, received: 0, first: null, last: null }));

      // Names the export pairs with the owner URL (as sender, or as the only
      // recipient), plus the Profile.csv name. Used only to leave the owner out
      // of thread participants when their own rows carry no sender URL.
      const ownerNameKeys = new Set<string>();
      if (ownerName) ownerNameKeys.add(ownerName);
      if (ownerUrl) {
        for (const m of msgs) {
          if (m.senderUrl === ownerUrl && m.fromKey) ownerNameKeys.add(m.fromKey);
          if (m.recipientUrls.length === 1 && m.recipientUrls[0] === ownerUrl && m.toKeys.length === 1) {
            ownerNameKeys.add(m.toKeys[0]);
          }
        }
      }

      // Group rows by conversation.
      const byConv = new Map<string, MessageRow[]>();
      for (const m of msgs) {
        const list = byConv.get(m.conv);
        if (list) list.push(m);
        else byConv.set(m.conv, [m]);
      }

      for (const convRows of byConv.values()) {
        // Resolve names to URLs where a row pairs them unambiguously, so one
        // person is not counted twice (once by URL, once by name).
        const urlByName = new Map<string, string>();
        for (const m of convRows) {
          if (m.senderUrl && m.fromKey) urlByName.set(m.fromKey, m.senderUrl);
          if (m.recipientUrls.length === 1 && m.toKeys.length === 1) {
            urlByName.set(m.toKeys[0], m.recipientUrls[0]);
          }
        }
        // Without a detected owner URL, the owner's URL in this thread is the
        // one paired with the Profile.csv name (if any).
        const convOwnerUrl = ownerUrl ?? (ownerName ? urlByName.get(ownerName) ?? null : null);
        const isOwner = (url: string | null, nameKey: string): boolean => {
          if (url && convOwnerUrl) return url === convOwnerUrl;
          if (!nameKey) return false;
          return (
            ownerNameKeys.has(nameKey) || (!!convOwnerUrl && urlByName.get(nameKey) === convOwnerUrl)
          );
        };
        const identity = (url: string | null, nameKey: string): string | null => {
          if (url) return url;
          if (!nameKey) return null;
          return urlByName.get(nameKey) ?? `name:${nameKey}`;
        };

        const participants = new Set<string>();
        for (const m of convRows) {
          if (!isOwner(m.senderUrl, m.fromKey)) {
            const id = identity(m.senderUrl, m.fromKey);
            if (id) participants.add(id);
          }
          if (m.recipientUrls.length > 0) {
            for (const u of m.recipientUrls) if (!isOwner(u, '')) participants.add(u);
          } else {
            for (const k of m.toKeys) {
              if (isOwner(null, k)) continue;
              const id = identity(null, k);
              if (id) participants.add(id);
            }
          }
        }

        if (participants.size === 0 || participants.size > MAX_THREAD_PARTICIPANTS) continue;
        const oneToOne = participants.size === 1;

        for (const m of convRows) {
          const sent =
            (!!convOwnerUrl && m.senderUrl === convOwnerUrl) ||
            (!m.senderUrl && !!ownerName && m.fromKey === ownerName) ||
            (!convOwnerUrl && !!ownerName && m.fromKey === ownerName);
          const received =
            !sent &&
            ((!!m.senderUrl && m.senderUrl !== convOwnerUrl) ||
              (!m.senderUrl && !!ownerName && !!m.fromKey && m.fromKey !== ownerName));

          const targets = new Set<number>();
          const creditSender = () => {
            const idx = join(m.senderUrl, m.fromRaw);
            if (idx != null) targets.add(idx);
          };
          const creditRecipients = () => {
            // By URL only; a 1:1 row with no recipient URL may use the TO name.
            for (const u of m.recipientUrls) {
              const idx = urlIndex.get(u);
              if (idx != null) targets.add(idx);
            }
            if (m.recipientUrls.length === 0 && oneToOne) {
              const idx = join(null, m.toRaw);
              if (idx != null) targets.add(idx);
            }
          };

          if (received) creditSender();
          else if (sent) creditRecipients();
          else {
            creditSender();
            creditRecipients();
          }

          for (const idx of targets) {
            const acc = messageAcc[idx];
            acc.count += 1;
            if (oneToOne && sent) acc.sent += 1;
            if (oneToOne && received) acc.received += 1;
            if (m.date) {
              if (!acc.first || m.date < acc.first) acc.first = m.date;
              if (!acc.last || m.date > acc.last) acc.last = m.date;
            }
          }
        }
      }
    }
  }

  // ---- Invitations.csv ----
  const invitations = new Map<number, { kind: 'incoming' | 'outgoing'; at: string | null }>();
  const invitationsText = textOf('invitations');
  if (invitationsText != null) {
    const t = readTable(invitationsText, ['From', 'To', 'Direction']);
    const cFrom = t.col('From');
    const cTo = t.col('To');
    const cAt = t.col('Sent At');
    const cDir = t.col('Direction');
    const cInviter = t.col('inviterProfileUrl');
    const cInvitee = t.col('inviteeProfileUrl');
    for (const r of t.rows) {
      const dir = cellAt(r, cDir).toUpperCase();
      let idx: number | null = null;
      let kind: 'incoming' | 'outgoing';
      if (dir === 'INCOMING') {
        kind = 'incoming';
        idx = join(normalizeProfileUrl(cellAt(r, cInviter)), cellAt(r, cFrom));
      } else if (dir === 'OUTGOING') {
        kind = 'outgoing';
        idx = join(normalizeProfileUrl(cellAt(r, cInvitee)), cellAt(r, cTo));
      } else {
        continue;
      }
      if (idx == null) continue;
      const at = parseLinkedInDate(cellAt(r, cAt));
      const prev = invitations.get(idx);
      if (!prev || (at && (!prev.at || at > prev.at))) invitations.set(idx, { kind, at });
    }
    markUsed('invitations', t.rows.length);
  }

  // ---- Notes.csv ----
  const notes = new Map<number, string>();
  const notesText = textOf('notes');
  if (notesText != null) {
    const t = readTable(notesText, ['Connection Profile URL', 'Note']);
    const cFirst = t.col('Connection First Name');
    const cLast = t.col('Connection Last Name');
    const cUrl = t.col('Connection Profile URL');
    const cNote = t.col('Note');
    for (const r of t.rows) {
      const note = collapse(cellAt(r, cNote));
      if (!note) continue;
      const name = `${cellAt(r, cFirst)} ${cellAt(r, cLast)}`.trim();
      const idx = join(normalizeProfileUrl(cellAt(r, cUrl)), name);
      if (idx == null) continue;
      const prev = notes.get(idx);
      notes.set(idx, (prev ? `${prev} ${note}` : note).slice(0, MAX_NOTE_CHARS).trim());
    }
    markUsed('notes', t.rows.length);
  }

  // ---- Endorsement_Received_Info.csv ----
  let endorsements: number[] | null = null;
  const endorsementsText = textOf('endorsements');
  if (endorsementsText != null) {
    endorsements = rows.map(() => 0);
    const t = readTable(endorsementsText, ['Endorser Public Url', 'Endorser First Name']);
    const cFirst = t.col('Endorser First Name');
    const cLast = t.col('Endorser Last Name');
    const cUrl = t.col('Endorser Public Url');
    const cStatus = t.col('Endorsement Status');
    for (const r of t.rows) {
      if (cStatus >= 0 && cellAt(r, cStatus).toUpperCase() !== 'ACCEPTED') continue;
      const name = `${cellAt(r, cFirst)} ${cellAt(r, cLast)}`.trim();
      const idx = join(normalizeProfileUrl(cellAt(r, cUrl)), name);
      if (idx != null) endorsements[idx] += 1;
    }
    markUsed('endorsements', t.rows.length);
  }

  // ---- Recommendations_Received.csv (no URL column: joins by name) ----
  let recommended: boolean[] | null = null;
  const recommendationsText = textOf('recommendations');
  if (recommendationsText != null) {
    recommended = rows.map(() => false);
    const t = readTable(recommendationsText, ['First Name', 'Last Name', 'Status']);
    const cFirst = t.col('First Name');
    const cLast = t.col('Last Name');
    const cStatus = t.col('Status');
    for (const r of t.rows) {
      if (cStatus >= 0 && cellAt(r, cStatus).toUpperCase() !== 'VISIBLE') continue;
      const name = `${cellAt(r, cFirst)} ${cellAt(r, cLast)}`.trim();
      const idx = join(null, name);
      if (idx != null) recommended[idx] = true;
    }
    markUsed('recommendations', t.rows.length);
  }

  // ---- Owner context ----
  const caps = NETWORK_CONTEXT_CAPS;
  const positions: NetworkPosition[] = [];
  const positionKeys = new Set<string>();
  const schools = uniqueList(caps.schools);
  const skills = uniqueList(caps.skills);
  const followedCompanies = uniqueList(caps.followedCompanies);
  const appliedCompanies = uniqueList(caps.appliedCompanies);
  const appliedTitles = uniqueList(caps.appliedTitles);
  const dreamCompanies = uniqueList(caps.dreamCompanies);
  const desiredTitles = uniqueList(caps.desiredTitles);

  const positionsText = textOf('positions');
  if (positionsText != null) {
    const t = readTable(positionsText, ['Company Name', 'Title']);
    const cCompany = t.col('Company Name');
    const cTitle = t.col('Title');
    const cFinished = t.col('Finished On');
    for (const r of t.rows) {
      if (positions.length >= caps.positions) break;
      const company = collapse(cellAt(r, cCompany));
      const title = collapse(cellAt(r, cTitle));
      if (!company && !title) continue;
      const key = `${company.toLowerCase()}\u0000${title.toLowerCase()}`;
      if (positionKeys.has(key)) continue;
      positionKeys.add(key);
      positions.push({ company, title, current: cellAt(r, cFinished) === '' });
    }
    markUsed('positions', t.rows.length);
  }

  const readColumn = (id: FileId, header: string, list: UniqueList) => {
    const text = textOf(id);
    if (text == null) return;
    const t = readTable(text, [header]);
    const c = t.col(header);
    for (const r of t.rows) list.add(cellAt(r, c));
    markUsed(id, t.rows.length);
  };

  readColumn('education', 'School Name', schools);
  readColumn('skills', 'Name', skills);
  readColumn('follows', 'Organization', followedCompanies);

  for (const id of ['applications', 'savedJobs'] as FileId[]) {
    const text = textOf(id);
    if (text == null) continue;
    const t = readTable(text, ['Company Name', 'Job Title']);
    const cCompany = t.col('Company Name');
    const cTitle = t.col('Job Title');
    for (const r of t.rows) {
      appliedCompanies.add(cellAt(r, cCompany));
      appliedTitles.add(cellAt(r, cTitle));
    }
    markUsed(id, t.rows.length);
  }

  const preferencesText = textOf('preferences');
  if (preferencesText != null) {
    const t = readTable(preferencesText, ['Dream Companies', 'Job Titles']);
    const cDream = t.col('Dream Companies');
    const cTitles = t.col('Job Titles');
    for (const r of t.rows) {
      for (const c of splitList(cellAt(r, cDream))) dreamCompanies.add(c);
      for (const c of splitList(cellAt(r, cTitles))) desiredTitles.add(c);
    }
    markUsed('preferences', t.rows.length);
  }

  const hasOwnerFiles = OWNER_FILES.some((id) => picked.has(id));
  const context: NetworkContext | null = hasOwnerFiles
    ? {
        name: ownerDisplayName,
        headline,
        industry,
        positions,
        schools: schools.items,
        skills: skills.items,
        followedCompanies: followedCompanies.items,
        appliedCompanies: appliedCompanies.items,
        appliedTitles: appliedTitles.items,
        dreamCompanies: dreamCompanies.items,
        desiredTitles: desiredTitles.items,
        source: { fileName, importedAt: new Date().toISOString() },
      }
    : null;

  // ---- Enrich rows (canonical keys, present only when known) ----
  const connectedOnKey = CONNECTED_ON_ISO_KEYS[0];
  rows.forEach((row, i) => {
    const connectedOn = parseLinkedInDate(clean(getField(row, CONNECTED_ON_KEYS)));
    if (connectedOn) row[connectedOnKey] = connectedOn;

    if (messageAcc) {
      const acc = messageAcc[i];
      row[MESSAGE_COUNT_KEYS[0]] = acc.count;
      row[MESSAGES_SENT_KEYS[0]] = acc.sent;
      row[MESSAGES_RECEIVED_KEYS[0]] = acc.received;
      if (acc.last) row[LAST_MESSAGED_KEYS[0]] = acc.last;
      if (acc.first) row[FIRST_MESSAGED_KEYS[0]] = acc.first;
    }

    const inv = invitations.get(i);
    if (inv) {
      row[INVITATION_KEYS[0]] = inv.kind;
      if (inv.at) row[INVITED_AT_KEYS[0]] = inv.at;
    }

    const note = notes.get(i);
    if (note) row[NOTE_KEYS[0]] = note;

    if (endorsements) row[ENDORSEMENT_COUNT_KEYS[0]] = endorsements[i];
    if (recommended) row[RECOMMENDED_YOU_KEYS[0]] = recommended[i];
  });

  for (const [id] of WHITELIST) {
    const n = used.get(id);
    if (n != null) filesUsed.push({ name: baseOf(id), rows: n });
  }

  const filesSkipped = Array.from(skipped).sort((a, b) => {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });

  const summary: ImportSummary = {
    fileName,
    connections: rows.length,
    filesUsed,
    filesSkipped,
    ownerDetected,
    matched: {
      messages: messageAcc ? messageAcc.filter((a) => a.count > 0).length : 0,
      invitations: invitations.size,
      notes: notes.size,
      endorsements: endorsements ? endorsements.filter((n) => n > 0).length : 0,
      recommendations: recommended ? recommended.filter(Boolean).length : 0,
    },
    warnings,
  };

  return { rows, context, summary };
}
