// lib/connectionsStore.ts
//
// Single source of truth for the per-user Firestore collection
//   users/{uid}/connections/{autoId}
//
// The row <-> doc mapping mirrors RecommenderScreen's getField/compactRow so a
// document loaded from Firestore scores identically to a freshly imported CSV row.

import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';

export type ConnectionDoc = {
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  company: string | null;
  position: string | null;
  email: string | null;
  url: string | null;
  connectedOnRaw: string | null;
};

export type CompactConnection = {
  name: string;
  position: string;
  company: string;
  email?: string;
  url?: string;
  connectedOn?: string;
};

/**
 * sessionStorage key holding the compact copy of the confirmed dataset.
 * Shared by RecommenderScreen (writer), AIScreen (reader) and Sidebar (clears
 * it on sign-out so the next user never sees the previous user's network).
 */
export const SESSION_KEY = 'network_connections_compact_v1';

// Firestore allows 500 operations per batch; stay under it.
const BATCH_LIMIT = 400;

// -----------------------------
// Field lookup (same semantics as RecommenderScreen)
// -----------------------------
function toText(v: unknown): string {
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

function normalizeKey(k: string): string {
  return k.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function getField(row: Record<string, unknown>, keys: string[]): string {
  const keySet = new Set(keys.map(normalizeKey));
  for (const [k, v] of Object.entries(row)) {
    if (keySet.has(normalizeKey(k))) return toText(v);
  }
  return '';
}

// Accepted header names. Exported (and imported by RecommenderScreen) so every
// getField call site in the app and rowToDoc here read the exact same synonyms
// and can never disagree about what counts as a Position or a Company.
export const FIRST_NAME_KEYS = ['First Name', 'first_name', 'firstname'];
export const LAST_NAME_KEYS = ['Last Name', 'last_name', 'lastname'];
export const FULL_NAME_KEYS = ['Full Name'];
export const POSITION_KEYS = ['Position', 'title', 'role', 'position'];
export const COMPANY_KEYS = ['Company', 'org', 'company', 'organization', 'firm'];
export const EMAIL_KEYS = ['Email Address'];
export const URL_KEYS = ['URL'];
export const CONNECTED_ON_KEYS = ['Connected On'];

function orNull(s: string): string | null {
  const t = s.trim();
  return t ? t : null;
}

export function rowToDoc(row: Record<string, unknown>): ConnectionDoc {
  const first = getField(row, FIRST_NAME_KEYS);
  const last = getField(row, LAST_NAME_KEYS);
  const full = getField(row, FULL_NAME_KEYS) || `${first} ${last}`.trim();

  return {
    firstName: orNull(first),
    lastName: orNull(last),
    fullName: orNull(full),
    company: orNull(getField(row, COMPANY_KEYS)),
    position: orNull(getField(row, POSITION_KEYS)),
    email: orNull(getField(row, EMAIL_KEYS)),
    url: orNull(getField(row, URL_KEYS)),
    connectedOnRaw: orNull(getField(row, CONNECTED_ON_KEYS)),
  };
}

/**
 * Produces a row keyed with the LinkedIn-style header names that
 * RecommenderScreen's getField recognizes, so loaded docs score identically to
 * a freshly imported CSV.
 */
export function docToRow(d: ConnectionDoc): Record<string, unknown> {
  const first = d.firstName ?? '';
  const last = d.lastName ?? '';

  return {
    'First Name': first,
    'Last Name': last,
    'Full Name': d.fullName ?? `${first} ${last}`.trim(),
    Company: d.company ?? '',
    Position: d.position ?? '',
    'Email Address': d.email ?? '',
    URL: d.url ?? '',
    'Connected On': d.connectedOnRaw ?? '',
  };
}

/** Same shape RecommenderScreen's compactRow produces. */
export function docToCompact(d: ConnectionDoc): CompactConnection {
  const name = d.fullName || `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim();

  return {
    name: name || '(no name)',
    position: d.position ?? '',
    company: d.company ?? '',
    email: d.email ?? '',
    url: d.url ?? '',
    connectedOn: d.connectedOnRaw ?? '',
  };
}

// -----------------------------
// Firestore I/O
// -----------------------------

/**
 * In-flight saveConnections chain per uid. Two overlapping saves for the same
 * user would interleave (the second one's delete pass runs against a snapshot
 * taken before the first one's writes land, leaving duplicate docs behind), so
 * every call for a uid waits for the previous one to settle, and loadConnections
 * waits on the same entry so a read never lands mid-replace.
 *
 * The guarantee is per browser tab / module instance ONLY: this map lives in
 * module scope, so two tabs (or two devices) saving the same account at the same
 * time still interleave, and nothing here prevents that. It is not a lock on the
 * Firestore collection.
 */
const saveChains = new Map<string, Promise<unknown>>();

/**
 * REPLACES users/{uid}/connections with `rows`: deletes every existing doc,
 * then writes one doc per row. Returns the number of docs written.
 *
 * Calls for the same uid are serialized; calls for different uids run freely.
 */
export function saveConnections(
  uid: string,
  rows: Record<string, unknown>[]
): Promise<number> {
  const previous = saveChains.get(uid) ?? Promise.resolve();

  // Chain off the previous call's *settlement* so one failure does not poison
  // every later save for this user.
  const run = previous
    .catch(() => undefined)
    .then(() => saveConnectionsNow(uid, rows));

  saveChains.set(uid, run);

  // Drop the entry once this is the last call in the chain, so the map does not
  // hold on to settled promises for the life of the tab.
  void run.catch(() => undefined).then(() => {
    if (saveChains.get(uid) === run) saveChains.delete(uid);
  });

  return run;
}

async function saveConnectionsNow(
  uid: string,
  rows: Record<string, unknown>[]
): Promise<number> {
  const col = collection(db, 'users', uid, 'connections');

  // 1. Delete everything that is there now.
  const existing = await getDocs(col);
  const staleRefs = existing.docs.map((d) => d.ref);

  for (let i = 0; i < staleRefs.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const ref of staleRefs.slice(i, i + BATCH_LIMIT)) batch.delete(ref);
    await batch.commit();
  }

  // 2. Write one doc per row.
  for (let i = 0; i < rows.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const row of rows.slice(i, i + BATCH_LIMIT)) {
      batch.set(doc(col), rowToDoc(row));
    }
    await batch.commit();
  }

  return rows.length;
}

export async function loadConnections(uid: string): Promise<ConnectionDoc[]> {
  // A save for this uid deletes every doc before rewriting them, so a read that
  // lands mid-replace sees a half-empty collection. Wait for the in-flight save
  // in this tab to settle first; its failure is the saver's problem, not ours.
  const inFlight = saveChains.get(uid);
  if (inFlight) await inFlight.catch(() => undefined);

  const col = collection(db, 'users', uid, 'connections');
  const snap = await getDocs(col);
  return snap.docs.map((d) => d.data() as ConnectionDoc);
}
