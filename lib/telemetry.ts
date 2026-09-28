// lib/telemetry.ts
//
// Ranking feedback, written together in one batch per thumbs up / down:
//   ranking_telemetry/{autoId}                      append-only log (write-only for clients)
//   users/{uid}/rankingFeedback/{queryKey}_{candId}  the user's latest vote, read back to
//                                                    reorder AI Rerank results for that search
// queryKey is a SHA-256 of the normalized search text, so a vote applies to the
// same search (ignoring case and spacing), not to every search.
//
// candidateId is a SHA-256 of the connection's profile URL (or name + company
// when there is no URL): stable across re-imports, since connection doc ids are
// regenerated on every save, and it keeps third-party identities out of a
// collection shared by all users.

import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { COMPANY_KEYS, FIRST_NAME_KEYS, FULL_NAME_KEYS, LAST_NAME_KEYS, URL_KEYS, getField } from './connectionFields.ts';

export type RankingFeedback = 'relevant' | 'irrelevant';

/** Mirrors the size limit enforced in firestore.rules. */
export const MAX_TELEMETRY_QUERY = 500;

async function sha256Hex(s: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Stable, non-reversible id for a connection row. */
export function candidateIdFor(row: Record<string, unknown>): Promise<string> {
  const url = getField(row, URL_KEYS).trim().toLowerCase().replace(/\/+$/, '');
  if (url) return sha256Hex(`url:${url}`);

  const name =
    getField(row, FULL_NAME_KEYS) || `${getField(row, FIRST_NAME_KEYS)} ${getField(row, LAST_NAME_KEYS)}`;
  const company = getField(row, COMPANY_KEYS);
  return sha256Hex(`nc:${name.trim().toLowerCase()}|${company.trim().toLowerCase()}`);
}

function queryKeyFor(queryText: string): Promise<string> {
  return sha256Hex(`q:${queryText.trim().toLowerCase().replace(/\s+/g, ' ')}`);
}

export async function recordRankingFeedback(input: {
  candidateId: string;
  queryText: string;
  feedback: RankingFeedback;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to send feedback.');

  const queryKey = await queryKeyFor(input.queryText);
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'ranking_telemetry')), {
    userId: user.uid,
    candidateId: input.candidateId,
    queryText: input.queryText.trim().slice(0, MAX_TELEMETRY_QUERY),
    feedback: input.feedback,
    timestamp: serverTimestamp(),
  });
  batch.set(doc(db, 'users', user.uid, 'rankingFeedback', `${queryKey}_${input.candidateId}`), {
    candidateId: input.candidateId,
    queryKey,
    feedback: input.feedback,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

/** The signed-in user's latest votes for this search: candidateId -> vote. Empty when signed out. */
export async function loadQueryFeedback(queryText: string): Promise<Map<string, RankingFeedback>> {
  const votes = new Map<string, RankingFeedback>();
  const user = auth.currentUser;
  if (!user || !queryText.trim()) return votes;

  const queryKey = await queryKeyFor(queryText);
  const snap = await getDocs(
    query(collection(db, 'users', user.uid, 'rankingFeedback'), where('queryKey', '==', queryKey))
  );
  for (const d of snap.docs) {
    const { candidateId, feedback } = d.data();
    if (typeof candidateId === 'string' && (feedback === 'relevant' || feedback === 'irrelevant')) {
      votes.set(candidateId, feedback);
    }
  }
  return votes;
}
