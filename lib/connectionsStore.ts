// lib/connectionsStore.ts
//
// Single source of truth for the per-user Firestore data:
//   users/{uid}/connections/{autoId}   one doc per connection
//   users/{uid}.networkContext         owner context from a LinkedIn export zip
//
// The row <-> doc mapping uses the same header synonyms (lib/connectionFields)
// as RecommenderScreen, so a document loaded from Firestore scores identically
// to a freshly imported row.

import { collection, doc, getDoc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
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
  toNetworkContext,
} from './connectionFields.ts';
import type { NetworkContext } from './connectionFields.ts';

// Existing importers read SESSION_KEY, the *_KEYS lists and the helpers from
// here; they now live in the pure module and are re-exported unchanged.
export * from './connectionFields.ts';

/**
 * Firestore shape of one connection. Fields are `null`, never `undefined`
 * (the default Firestore instance rejects undefined). Docs saved before the
 * LinkedIn export import lack the enrichment fields; loadConnections coerces
 * every missing field to null.
 */
export type ConnectionDoc = {
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  company: string | null;
  position: string | null;
  email: string | null;
  url: string | null;
  connectedOnRaw: string | null;
  connectedOn: string | null; // 'YYYY-MM-DD'
  messageCount: number | null;
  messagesSent: number | null;
  messagesReceived: number | null;
  lastMessagedAt: string | null; // 'YYYY-MM-DD'
  firstMessagedAt: string | null; // 'YYYY-MM-DD'
  invitation: string | null; // 'incoming' | 'outgoing'
  invitedAt: string | null; // 'YYYY-MM-DD'
  note: string | null;
  endorsementCount: number | null;
  recommendedYou: boolean | null;
};

/**
 * Compact copy kept in sessionStorage[SESSION_KEY]. `connectedOn` keeps its
 * existing meaning (the raw "Connected On" text); the normalized date is
 * `connectedOnIso`. Enrichment fields are present only when known.
 */
export type CompactConnection = {
  name: string;
  position: string;
  company: string;
  email?: string;
  url?: string;
  connectedOn?: string;
  connectedOnIso?: string | null;
  messageCount?: number | null;
  messagesSent?: number | null;
  messagesReceived?: number | null;
  lastMessagedAt?: string | null;
  firstMessagedAt?: string | null;
  invitation?: string | null;
  invitedAt?: string | null;
  note?: string | null;
  endorsementCount?: number | null;
  recommendedYou?: boolean | null;
};

// Firestore allows 500 operations per batch; stay under it.
const BATCH_LIMIT = 400;

function orNull(s: string): string | null {
  const t = s.trim();
  return t ? t : null;
}

function invitationOrNull(s: string): string | null {
  const t = s.trim().toLowerCase();
  return t === 'incoming' || t === 'outgoing' ? t : null;
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
    connectedOn: orNull(getField(row, CONNECTED_ON_ISO_KEYS)),
    messageCount: getNumberField(row, MESSAGE_COUNT_KEYS),
    messagesSent: getNumberField(row, MESSAGES_SENT_KEYS),
    messagesReceived: getNumberField(row, MESSAGES_RECEIVED_KEYS),
    lastMessagedAt: orNull(getField(row, LAST_MESSAGED_KEYS)),
    firstMessagedAt: orNull(getField(row, FIRST_MESSAGED_KEYS)),
    invitation: invitationOrNull(getField(row, INVITATION_KEYS)),
    invitedAt: orNull(getField(row, INVITED_AT_KEYS)),
    note: orNull(getField(row, NOTE_KEYS)),
    endorsementCount: getNumberField(row, ENDORSEMENT_COUNT_KEYS),
    recommendedYou: getBooleanField(row, RECOMMENDED_YOU_KEYS),
  };
}

/**
 * Produces a row keyed with the canonical LinkedIn-style header names, so
 * loaded docs score identically to a freshly imported export. Enrichment keys
 * are emitted only when the doc field is non-null, exactly as the importer
 * writes them.
 */
export function docToRow(d: ConnectionDoc): Record<string, unknown> {
  const first = d.firstName ?? '';
  const last = d.lastName ?? '';

  const row: Record<string, unknown> = {
    'First Name': first,
    'Last Name': last,
    'Full Name': d.fullName ?? `${first} ${last}`.trim(),
    Company: d.company ?? '',
    Position: d.position ?? '',
    'Email Address': d.email ?? '',
    URL: d.url ?? '',
    'Connected On': d.connectedOnRaw ?? '',
  };

  const put = (keys: string[], v: string | number | boolean | null | undefined) => {
    if (v != null) row[keys[0]] = v;
  };
  put(CONNECTED_ON_ISO_KEYS, d.connectedOn);
  put(MESSAGE_COUNT_KEYS, d.messageCount);
  put(MESSAGES_SENT_KEYS, d.messagesSent);
  put(MESSAGES_RECEIVED_KEYS, d.messagesReceived);
  put(LAST_MESSAGED_KEYS, d.lastMessagedAt);
  put(FIRST_MESSAGED_KEYS, d.firstMessagedAt);
  put(INVITATION_KEYS, d.invitation);
  put(INVITED_AT_KEYS, d.invitedAt);
  put(NOTE_KEYS, d.note);
  put(ENDORSEMENT_COUNT_KEYS, d.endorsementCount);
  put(RECOMMENDED_YOU_KEYS, d.recommendedYou);

  return row;
}

/** Same base shape RecommenderScreen's compactRow produces, plus enrichment. */
export function docToCompact(d: ConnectionDoc): CompactConnection {
  const name = d.fullName || `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim();

  const out: CompactConnection = {
    name: name || '(no name)',
    position: d.position ?? '',
    company: d.company ?? '',
    email: d.email ?? '',
    url: d.url ?? '',
    connectedOn: d.connectedOnRaw ?? '',
  };

  if (d.connectedOn != null) out.connectedOnIso = d.connectedOn;
  if (d.messageCount != null) out.messageCount = d.messageCount;
  if (d.messagesSent != null) out.messagesSent = d.messagesSent;
  if (d.messagesReceived != null) out.messagesReceived = d.messagesReceived;
  if (d.lastMessagedAt != null) out.lastMessagedAt = d.lastMessagedAt;
  if (d.firstMessagedAt != null) out.firstMessagedAt = d.firstMessagedAt;
  if (d.invitation != null) out.invitation = d.invitation;
  if (d.invitedAt != null) out.invitedAt = d.invitedAt;
  if (d.note != null) out.note = d.note;
  if (d.endorsementCount != null) out.endorsementCount = d.endorsementCount;
  if (d.recommendedYou != null) out.recommendedYou = d.recommendedYou;

  return out;
}

// Firestore data is untrusted and may predate the enrichment fields: coerce
// every field to its declared type or null.
function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function boolOrNull(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

function normalizeConnectionDoc(data: Record<string, unknown>): ConnectionDoc {
  return {
    firstName: strOrNull(data.firstName),
    lastName: strOrNull(data.lastName),
    fullName: strOrNull(data.fullName),
    company: strOrNull(data.company),
    position: strOrNull(data.position),
    email: strOrNull(data.email),
    url: strOrNull(data.url),
    connectedOnRaw: strOrNull(data.connectedOnRaw),
    connectedOn: strOrNull(data.connectedOn),
    messageCount: numOrNull(data.messageCount),
    messagesSent: numOrNull(data.messagesSent),
    messagesReceived: numOrNull(data.messagesReceived),
    lastMessagedAt: strOrNull(data.lastMessagedAt),
    firstMessagedAt: strOrNull(data.firstMessagedAt),
    invitation: invitationOrNull(strOrNull(data.invitation) ?? ''),
    invitedAt: strOrNull(data.invitedAt),
    note: strOrNull(data.note),
    endorsementCount: numOrNull(data.endorsementCount),
    recommendedYou: boolOrNull(data.recommendedYou),
  };
}

// -----------------------------
// Firestore I/O
// -----------------------------

/**
 * In-flight write chain per uid. Two overlapping saves for the same user would
 * interleave (the second one's delete pass runs against a snapshot taken
 * before the first one's writes land, leaving duplicate docs behind), so every
 * write for a uid (saveConnections and saveNetworkContext) waits for the
 * previous one to settle, and the loaders wait on the same entry so a read
 * never lands mid-replace.
 *
 * The guarantee is per browser tab / module instance ONLY: this map lives in
 * module scope, so two tabs (or two devices) saving the same account at the same
 * time still interleave, and nothing here prevents that. It is not a lock on the
 * Firestore data.
 */
const saveChains = new Map<string, Promise<unknown>>();

function enqueue<T>(uid: string, task: () => Promise<T>): Promise<T> {
  const previous = saveChains.get(uid) ?? Promise.resolve();

  // Chain off the previous call's *settlement* so one failure does not poison
  // every later save for this user.
  const run = previous.catch(() => undefined).then(task);

  saveChains.set(uid, run);

  // Drop the entry once this is the last call in the chain, so the map does not
  // hold on to settled promises for the life of the tab.
  void run.catch(() => undefined).then(() => {
    if (saveChains.get(uid) === run) saveChains.delete(uid);
  });

  return run;
}

async function waitForWrites(uid: string): Promise<void> {
  // Its failure is the saver's problem, not the reader's.
  const inFlight = saveChains.get(uid);
  if (inFlight) await inFlight.catch(() => undefined);
}

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
  return enqueue(uid, () => saveConnectionsNow(uid, rows));
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
  // in this tab to settle first.
  await waitForWrites(uid);

  const col = collection(db, 'users', uid, 'connections');
  const snap = await getDocs(col);
  return snap.docs.map((d) => normalizeConnectionDoc(d.data()));
}

/**
 * Writes (or clears, with null) users/{uid}.networkContext. mergeFields
 * replaces the whole map, so two imports never mix, and leaves the profile
 * fields of the same document untouched. Serialized with saveConnections.
 */
export function saveNetworkContext(uid: string, ctx: NetworkContext | null): Promise<void> {
  // Validate into a fresh copy: no undefined can reach Firestore.
  const value = ctx === null ? null : toNetworkContext(ctx);
  if (ctx !== null && value === null) {
    return Promise.reject(new Error('saveNetworkContext: malformed network context.'));
  }

  return enqueue(uid, () =>
    setDoc(doc(db, 'users', uid), { networkContext: value }, { mergeFields: ['networkContext'] })
  );
}

/** users/{uid}.networkContext, or null when absent or malformed. */
export async function loadNetworkContext(uid: string): Promise<NetworkContext | null> {
  await waitForWrites(uid);

  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  return toNetworkContext(snap.get('networkContext'));
}
