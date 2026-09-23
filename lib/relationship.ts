// lib/relationship.ts
//
// Relationship strength between the signed-in user and one connection, derived
// from the enrichment keys written by lib/linkedinExport.ts plus the owner's
// NetworkContext. Relevance always ranks first (compareRanked sorts by matched
// query terms before score); the bonus only reorders rows that matched the same
// number of terms, and callers apply it only when relevance > 0.
//
// Pure module: no firebase, no React. Relative imports carry explicit '.ts'
// extensions so plain Node (type stripping) can import it for tests.

import {
  COMPANY_KEYS,
  COMPANY_STOPWORDS,
  ENDORSEMENT_COUNT_KEYS,
  INVITATION_KEYS,
  LAST_MESSAGED_KEYS,
  MESSAGE_COUNT_KEYS,
  MESSAGES_RECEIVED_KEYS,
  MESSAGES_SENT_KEYS,
  NOTE_KEYS,
  RECOMMENDED_YOU_KEYS,
  getBooleanField,
  getField,
  getNumberField,
} from './connectionFields.ts';
import type { NetworkContext } from './connectionFields.ts';

export const MAX_RELATIONSHIP_BONUS = 15;

export type Relationship = {
  bonus: number;
  reasons: string[];
  chips: string[];
  aiSummary: string;
};

const MAX_AI_SUMMARY = 200;
const MAX_AI_CONTEXT = 600;
const MAX_AI_COMPANY = 60;

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// -----------------------------
// Small helpers
// -----------------------------
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Safe for a single-line proxy prompt field: one line, no '|'. */
function promptSafe(s: string): string {
  return collapse(s.replace(/\|/g, '/'));
}

function stripDiacritics(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}+/gu, '');
}

/** 'YYYY-MM-DD...' -> UTC ms, or null. */
function isoDateMs(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const t = new Date(ms);
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return ms;
}

function monthLabel(ms: number): string {
  const t = new Date(ms);
  return `${MONTH_LABELS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
}

function truncateAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, Math.max(0, max - 1));
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:]+$/, '')}…`;
}

// -----------------------------
// Notes
// -----------------------------
const NOTE_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'about', 'who', 'what', 'that', 'this', 'from',
  'into', 'you', 'your', 'are', 'was', 'met', 'someone', 'people', 'person',
  'looking', 'find', 'need', 'want', 'can',
]);

function words(s: string): string[] {
  return stripDiacritics(s)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Query terms (from the raw query, no alias expansion, split on whitespace,
 * ',' and ';' like the Recommender's query tokens) whose words all appear as
 * whole words in the owner's note. Words shorter than 3 characters and
 * stopwords (note stopwords plus COMPANY_STOPWORDS) are ignored. One term
 * yields at most one hit, even when it holds several words ("front-end" ->
 * "front end"). Unique, in query order.
 */
export function noteMatches(note: string, rawQuery: string): string[] {
  if (!note || !rawQuery) return [];
  const noteWords = new Set(words(note));
  const out: string[] = [];
  for (const term of rawQuery.split(/[\s,;]+/)) {
    const eligible = words(term).filter(
      (w) => w.length >= 3 && !NOTE_STOPWORDS.has(w) && !COMPANY_STOPWORDS.has(w)
    );
    if (!eligible.length || !eligible.every((w) => noteWords.has(w))) continue;
    const hit = eligible.join(' ');
    if (!out.includes(hit)) out.push(hit);
  }
  return out;
}

// -----------------------------
// Company identity
// -----------------------------
const LEGAL_SUFFIXES = new Set([
  'inc', 'llc', 'ltd', 'corp', 'corporation', 'co', 'company', 'plc', 'gmbh', 'sa', 'ag',
]);

function companyBase(s: string): string {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const GENERIC_EMPLOYERS = new Set(
  [
    'self-employed', 'self employed', 'freelance', 'freelancer', 'independent',
    'independent consultant', 'stealth', 'stealth startup', 'confidential', 'retired',
    'student', 'unemployed', 'n/a', 'none', '-',
  ].map(companyBase)
);

type CompanyName = { tokens: string[]; hadLegalSuffix: boolean; generic: boolean };

function parseCompany(s: string): CompanyName {
  const base = companyBase(typeof s === 'string' ? s : '');
  const tokens = base ? base.split(' ') : [];
  while (tokens.length && tokens[0] === 'the') tokens.shift();

  let hadLegalSuffix = false;
  while (tokens.length) {
    const last = tokens[tokens.length - 1];
    if (last === 'the') {
      tokens.pop();
    } else if (LEGAL_SUFFIXES.has(last)) {
      tokens.pop();
      hadLegalSuffix = true;
    } else {
      break;
    }
  }

  const generic =
    !base || GENERIC_EMPLOYERS.has(base) || GENERIC_EMPLOYERS.has(tokens.join(' '));
  return { tokens, hadLegalSuffix, generic };
}

/**
 * Same employer? Lowercase, strip punctuation, drop a leading "the" and
 * trailing legal suffixes. Equal names match; otherwise one name's tokens must
 * be a leading prefix of the other's, with the shorter name having >= 2 tokens
 * or >= 4 characters, and the shorter name must not itself have carried a
 * legal suffix ("Bain & Company" is a complete name, so it does not prefix-match
 * "Bain Capital"). Generic employers (self-employed, stealth, ...) never match.
 */
export function companiesMatch(a: string, b: string): boolean {
  const A = parseCompany(a);
  const B = parseCompany(b);
  if (A.generic || B.generic || !A.tokens.length || !B.tokens.length) return false;

  if (A.tokens.length === B.tokens.length) {
    return A.tokens.every((t, i) => t === B.tokens[i]);
  }

  const [short, long] = A.tokens.length < B.tokens.length ? [A, B] : [B, A];
  if (!short.tokens.every((t, i) => long.tokens[i] === t)) return false;
  if (short.hadLegalSuffix) return false;
  return short.tokens.length >= 2 || short.tokens.join(' ').length >= 4;
}

// -----------------------------
// Relationship signals
// -----------------------------
function messageBucket(n: number): string {
  if (n >= 10) return '10+';
  if (n >= 3) return '3-9';
  return '1-2';
}

/**
 * Relationship bonus (capped at MAX_RELATIONSHIP_BONUS), one `Relationship:`
 * reason line, display chips, and a privacy-safe AI summary (derived facts
 * only: never note text, conversation data, or anything about applications).
 */
export function relationshipSignals(
  row: Record<string, unknown>,
  ctx: NetworkContext | null,
  now: Date
): Relationship {
  const count = Math.max(0, getNumberField(row, MESSAGE_COUNT_KEYS) ?? 0);
  const sent = getNumberField(row, MESSAGES_SENT_KEYS) ?? 0;
  const received = getNumberField(row, MESSAGES_RECEIVED_KEYS) ?? 0;
  const lastMs = isoDateMs(getField(row, LAST_MESSAGED_KEYS));
  const endorsements = getNumberField(row, ENDORSEMENT_COUNT_KEYS) ?? 0;
  const recommendedYou = getBooleanField(row, RECOMMENDED_YOU_KEYS) === true;
  const invitedYou = getField(row, INVITATION_KEYS).trim().toLowerCase() === 'incoming';
  const hasNote = getField(row, NOTE_KEYS).trim() !== '';
  const company = collapse(getField(row, COMPANY_KEYS));

  let bonus = 0;
  const parts: string[] = [];
  const chips: string[] = [];
  const ai: string[] = [];

  // Messages: recency, volume, two-way.
  const twoWay = sent > 0 && received > 0;
  if (count > 0 || lastMs != null) {
    const month = lastMs != null ? monthLabel(lastMs) : null;

    if (lastMs != null) {
      const days = Math.floor((now.getTime() - lastMs) / 86_400_000);
      if (Number.isFinite(days)) bonus += days <= 90 ? 6 : days <= 365 ? 4 : 2;
    }
    bonus += Math.min(5, Math.floor(Math.log2(1 + count)));
    if (twoWay) bonus += 2;

    if (count > 0) {
      chips.push(`${count} ${count === 1 ? 'msg' : 'msgs'}${month ? ` · ${month}` : ''}`);
      ai.push(`${messageBucket(count)} messages`);
    }
    if (month) ai.push(`last contact ${month}`);
    if (twoWay) ai.push('two-way');

    const bits = [
      count > 0 ? `${count} message${count === 1 ? '' : 's'}` : 'messaged',
      month ? `last ${month}` : '',
      twoWay ? 'two-way' : '',
    ].filter(Boolean);
    parts.push(bits.join(', '));
  } else if (twoWay) {
    bonus += 2;
    ai.push('two-way');
    parts.push('two-way messages');
  }

  // Owner context: shared employers, target and followed companies.
  if (ctx && company) {
    const aiCompany = promptSafe(company).slice(0, MAX_AI_COMPANY);
    const positions = ctx.positions.filter((p) => p.company && companiesMatch(company, p.company));
    if (positions.some((p) => p.current)) {
      bonus += 4;
      chips.push(`Also at ${company}`);
      parts.push(`also at ${company}`);
      ai.push(`also at ${aiCompany}`);
    } else if (positions.length) {
      bonus += 4;
      chips.push('Former colleague');
      parts.push(`works at your former employer ${company}`);
      ai.push(`former colleague at ${aiCompany}`);
    }

    const targets = [...ctx.dreamCompanies, ...ctx.appliedCompanies];
    if (targets.some((c) => companiesMatch(company, c))) {
      bonus += 3;
      chips.push('Target company');
      parts.push('at a company on your target list');
      ai.push("at a company on the user's target list");
    }

    if (ctx.followedCompanies.some((c) => companiesMatch(company, c))) {
      bonus += 1;
      parts.push(`you follow ${company}`);
    }
  }

  if (endorsements > 0) {
    bonus += 2;
    chips.push('Endorsed you');
    parts.push('endorsed you');
    ai.push('endorsed the user');
  }
  if (recommendedYou) {
    bonus += 3;
    chips.push('Recommended you');
    parts.push('recommended you');
    ai.push('recommended the user');
  }
  if (invitedYou) {
    bonus += 1;
    chips.push('Invited you');
    parts.push('invited you');
    ai.push('invited the user');
  }
  if (hasNote) chips.push('Has note');

  // Fixed template, whole facts only, <= 200 chars.
  let aiSummary = '';
  for (const fact of ai) {
    const next = aiSummary ? `${aiSummary}; ${fact}` : fact;
    if (next.length > MAX_AI_SUMMARY) break;
    aiSummary = next;
  }

  return {
    bonus: Math.min(MAX_RELATIONSHIP_BONUS, bonus),
    reasons: parts.length ? [`Relationship: ${parts.join('; ')}`] : [],
    chips,
    aiSummary: promptSafe(aiSummary),
  };
}

// -----------------------------
// AI context
// -----------------------------

/**
 * Owner context for AI prompts (<= 600 chars, '' when null): headline,
 * industry, current title and company, desired titles, dream companies and the
 * top 10 skills. Never includes the owner's name, schools, follows, or any
 * job-application data.
 */
export function buildAiContext(ctx: NetworkContext | null): string {
  if (!ctx) return '';

  const parts: string[] = [];
  if (ctx.headline) parts.push(`Headline: ${ctx.headline}`);
  if (ctx.industry) parts.push(`Industry: ${ctx.industry}`);

  const current = ctx.positions.find((p) => p.current && (p.title || p.company));
  if (current) {
    const role =
      current.title && current.company
        ? `${current.title} at ${current.company}`
        : current.title || current.company;
    parts.push(`Current role: ${role}`);
  }

  if (ctx.desiredTitles.length) parts.push(`Wants roles: ${ctx.desiredTitles.join(', ')}`);
  if (ctx.dreamCompanies.length) parts.push(`Target companies: ${ctx.dreamCompanies.join(', ')}`);
  if (ctx.skills.length) parts.push(`Skills: ${ctx.skills.slice(0, 10).join(', ')}`);

  let out = '';
  for (const raw of parts) {
    const part = promptSafe(raw);
    if (!part) continue;
    const sep = out ? '; ' : '';
    const budget = MAX_AI_CONTEXT - out.length - sep.length;
    if (budget <= 0) break;
    if (part.length <= budget) {
      out += sep + part;
    } else {
      if (budget > 20) out += sep + truncateAtWord(part, budget);
      break;
    }
  }
  return out;
}

// -----------------------------
// Ranking
// -----------------------------

/** Matched query terms desc, then score (relevance + bonus) desc. */
export function compareRanked(
  a: { terms: number; score: number },
  b: { terms: number; score: number }
): number {
  return b.terms - a.terms || b.score - a.score;
}
