// lib/search.ts
//
// Local (non-AI) search for the Recommender screen: "structured intent" ranking.
//
// The query is parsed into facets instead of being matched as a bag of
// substrings:
//   - role / domain concepts (software engineering, nursing, underwriting,
//     payments, healthcare, ...) from the taxonomy in ./searchTaxonomy.ts, which
//     also knows abbreviations (SWE, PM, RN, CMO, ...; ambiguous ones carry every
//     sense) and word families (recruiter / recruiting),
//   - a seniority band (intern .. senior .. staff .. director / VP / C-level),
//   - a company constraint ("at X", or words that name a company in the rows),
//   - an intent verb ("hire engineers" -> recruiters and engineering managers),
//     and occupation cues ("covers X for a newspaper" -> journalists),
//   - residual words, matched literally (whole words) as a fallback, or as
//     acronyms by initials ("ed" = Executive Director, "doe" = Department of
//     Energy; dotted forms such as "E.D." collapse).
// A typed role that titles themselves use ("postdoc") puts titles containing it
// a tier above sibling roles of the same family ("Professor"). An industry ask
// ("utilities") credits everyone at a company in that industry; next to a role
// it only refines the role.
// Every row's title is mapped onto the same taxonomy (its head noun decides the
// function: a "Physician Recruiter" is a recruiter), its company name onto
// industries (which also give generic titles such as "Partner" at a law firm
// their function), and rows are scored by facet satisfaction: function match
// dominates, then the company constraint, then seniority closeness. Literal
// words the user typed add a small bonus so an exact title always beats a
// synonym-padded one. Relevance is bucketed into tiers; the relationship bonus
// only reorders rows inside the same tier (compareRanked on terms = tier).
//
// Pure, synchronous and browser-safe: per-row parsing is memoized on the rows
// array (a WeakMap), so repeated searches over the same dataset only do
// per-query work. Rows are read only through getField and the key lists.

import { COMPANY_KEYS, COMPANY_STOPWORDS, NOTE_KEYS, POSITION_KEYS, getField } from './connectionFields.ts';
import type { NetworkContext } from './connectionFields.ts';
import { compareRanked, noteMatches, relationshipSignals } from './relationship.ts';
import type { Relationship } from './relationship.ts';
import {
  ABBREVIATIONS,
  BAND_LEADERSHIP,
  COMPANY_ALIAS_GROUPS,
  COMMON_ENGLISH_WORDS,
  COMPANY_KEYWORDS,
  DEFAULT_LEVEL,
  DIRECTED,
  ENGINEERING_FAMILY,
  FUNCTION_NOUNS,
  GENERIC_TITLES,
  INDUSTRY_ROLE_DUAL,
  KNOWN_INDUSTRY,
  LEADERSHIP_NOUN_STRENGTH,
  LEADERSHIP_WORDS,
  LEGAL_SUFFIXES,
  LEVEL_WORDS,
  PEOPLE_MANAGER_LEVEL,
  PEOPLE_MANAGER_NOUNS,
  PHYSICAL_ENGINEERING_INDUSTRIES,
  QUERY_STOPWORDS_RAW,
  QUERY_TRIGGERS,
  RELATED_PAIRS,
  TITLE_PATTERNS,
  TOPIC_DEFAULT_LEVEL,
  TOPIC_LABELS,
  WORD_FAMILIES,
  bandForLevel,
  isIndustryTopic,
} from './searchTaxonomy.ts';
import type { AbbreviationSense, Band, TopicWeights } from './searchTaxonomy.ts';

type Row = Record<string, unknown>;

/** Output of the relevance pass. relevance 0 = no match (never returned). */
export type ScoredRow = {
  row: Row;
  relevance: number; // > 0 for every returned row
  terms: number; // relevance tier (floor(relevance / TIER_WIDTH)); compareRanked sorts on it first
  matchedTokens: string[];
  reasons: string[];
};

export type RankedRow = ScoredRow & {
  score: number; // relevance + relationship bonus (the displayed badge)
  chips: string[]; // relationship chips
  aiSummary: string; // privacy-safe relationship facts for AI candidates
};

// =============================================================================
// Tunables
// =============================================================================
/** Full satisfaction of one role / domain concept: the dominant facet. */
const W_CONCEPT = 60;
/** Company constraint when the query also names a role / domain (below a full role match). */
const W_COMPANY_WITH_ROLE = 40;
/** Company constraint when it is the whole query ("stripe"). */
const W_COMPANY_ONLY = 60;
/** Seniority band satisfaction (only counted when the role matched). */
const W_SENIORITY = 30;
/** Each typed (non-seniority) word found verbatim in the title: exact beats synonym padding. */
const W_LITERAL = 8;
/** The typed multi-word phrase found contiguously in the title. */
const W_PHRASE = 12;
/** Literal / phrase hits that only exist after abbreviation expansion count this fraction. */
const ABBREVIATION_FACTOR = 0.5;
/** A title word from the typed word's family ("underwriter" for "underwriting") counts this fraction. */
const WORD_FORM_FACTOR = 0.5;
/** A typed word the taxonomy does not know, found in the title. */
const W_RESIDUAL = 30;
/**
 * A typed word the taxonomy does not know, found only in the company name while
 * other rows have it in their title: a weak signal, below any title match.
 */
const W_RESIDUAL_COMPANY = 8;
/** Each query word found in the owner's note (noteMatches semantics). */
const W_NOTE = 30;
/** A note hit on a word the row already satisfies only breaks ties: the note adds no new evidence. */
const W_NOTE_REDUNDANT = 4;
/** A single typed word found in the title satisfies its concept at least this much. */
const LITERAL_ONLY_SAT = 0.5;
/** Credit at or above which a title is a synonym of the ask; below it is a related role. */
const SYNONYM_CREDIT = 0.8;
/** Two concepts whose asks credit each other at least this much are merged into one. */
const MERGE_OVERLAP = 0.5;
/** "hire designers": design people at this level or above (managers, leads) can help. */
const HIRING_LEADER_MIN_LEVEL = 4;
/** A seniority-only query ("intern", "senior") needs at least this band closeness to match. */
const SENIORITY_ONLY_MIN_SAT = 0.6;
/** Relevance tier width. MAX_RELATIONSHIP_BONUS (15) only reorders within a tier. */
const TIER_WIDTH = 10;
/**
 * Company evidence strengths for industry topics: a well-known company vs a name
 * keyword. An industry query ("utilities", "higher education") is about where
 * people work, so membership is strong evidence whatever the title says.
 */
const KNOWN_COMPANY_STRENGTH = 0.95;
const COMPANY_KEYWORD_STRENGTH = 0.9;
/**
 * A domain word in a title at an organization outside that domain (a think
 * tank's "Energy Program Director" on "energy"): comparable to, not above,
 * working at a company in the domain.
 */
const TITLE_DOMAIN_ONLY = 0.8;
/**
 * Exact role above sibling roles: when the user typed a specific role that
 * titles use ("postdoc", "paralegal", "reporter"), a title in the same family
 * that doesn't contain it ("Professor", "Correspondent") keeps this fraction,
 * which puts it at least a tier below every title that does.
 */
const SIBLING_FACTOR = 0.75;
/**
 * An industry facet next to a role facet ("someone who covers energy for a
 * newspaper"): the role is the requirement, the industry a refinement. A
 * journalist without energy beats an energy person who isn't a journalist.
 */
const REFINEMENT_FACTOR = 0.5;
/**
 * Acronyms read by initials ("ed", "pi", "doe"): a title phrase that is an
 * established expansion of the typed acronym, vs a phrase whose initials merely
 * spell it; and a company whose name's initials spell it.
 */
const ACRONYM_KNOWN = 1;
const ACRONYM_INITIALS = 0.6;
const COMPANY_ACRONYM = 1;
/**
 * Acronym length range (letters). Company acronyms and bare title initials need
 * at least 3 letters: 2-letter words ("hi", "so", "no", "up") spell the initials
 * of some title phrase far too often, so a 2-letter word reads as an acronym
 * only through an established expansion in the taxonomy ("ed", "pi", "ta").
 */
const ACRONYM_MIN = 2;
const ACRONYM_MAX = 5;
const COMPANY_ACRONYM_MIN = 3;
const BARE_INITIALS_MIN = 3;
/** Role evidence inferred from an industry (an AI lab -> ML, a "... Ventures" -> investing). */
const DUAL_COMPANY_STRENGTH = 0.6;
/** Company-derived role evidence when the title names an unrelated function (a recruiter at a VC firm). */
const COMPANY_ROLE_CONFLICT_DAMP = 0.5;
/** A generic title's function inferred from the employer's industry: below an explicit title match. */
const EMPLOYER_INFERRED_STRENGTH = 0.75;
/** What a generic title word's own reading keeps when the employer says otherwise ("Consultant" at a hospital). */
const GENERIC_OVERRIDDEN_DAMP = 0.3;
/** Unexplained title words a generic title may carry and still take its function from the employer. */
const GENERIC_MAX_EXTRA_WORDS = 2;
/**
 * Head-noun rule: a function word modifying a different head noun ("Physician"
 * in "Physician Recruiter") keeps only this fraction of its evidence.
 */
const MODIFIER_FACTOR = 0.3;
/** Two functions whose mutual credit is below this are "unrelated" for the head-noun rule. */
const MODIFIER_UNRELATED_BELOW = 0.3;
/** A head noun must name its function at least this strongly to demote the modifiers before it. */
const HEAD_MIN_STRENGTH = 0.9;
/** A bare "Engineer" (no discipline) is read as this discipline at this strength. */
const BARE_ENGINEER_STRENGTH = 0.85;
/** On a row, an abbreviation sense tied to other industries than the employer's keeps this fraction. */
const OFF_INDUSTRY_SENSE = 0.3;
/** Company constraint satisfaction levels. */
const COMPANY_EXACT = 1;
const COMPANY_INNER = 0.95; // query words inside the company name ("aws" in "Amazon Web Services (AWS)")
const COMPANY_ALIAS = 0.9; // parent / brand ("google" -> "Alphabet Inc.")
const COMPANY_IN_TITLE = 0.5; // "SWE Intern @ Google" at another employer
const COMPANY_FORMER = 0.35; // "(ex-McKinsey)" in the title: a former employer
/** Typo repair: minimum typed-word length, and the length from which distance 2 is allowed. */
const TYPO_MIN_LEN = 5;
const TYPO_LEN_2 = 9;
/**
 * Long-input guard. The search box has no length limit, and a pasted paragraph
 * (a bio, a job description) would otherwise cost O(rows x words) in scoring and
 * O(words x vocabulary) in typo repair, freezing the UI for seconds on a large
 * network. Only the first MAX_QUERY_WORDS words are read (real searches are a
 * handful of words), and at most MAX_TYPO_LOOKUPS unknown words are fuzzy-matched.
 */
const MAX_QUERY_WORDS = 32;
const MAX_TYPO_LOOKUPS = 8;
/** Max reasons produced by the relevance pass (the relationship line is appended). */
const MAX_REASONS = 7;
/** `expanded` (sent to Gemini as criteria) stays under this many characters. */
const MAX_EXPANDED = 299;

// =============================================================================
// Text helpers
// =============================================================================
function fold(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
}

/**
 * Lowercased, diacritic-free words; "app's" -> "app", "co-founder" -> "co",
 * "founder"; dotted initials collapse ("E.D." -> "ed", "U.S." -> "us").
 */
function wordsOf(s: string): string[] {
  return fold(s)
    .replace(/(?<![\p{L}\p{N}])((?:\p{L}\.){2,})/gu, (m) => m.replace(/\./g, ''))
    .replace(/['’]s\b/g, '')
    .replace(/['’]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const NO_STEM = new Set([
  'sales', 'news', 'series', 'species', 'devops', 'ios', 'aws', 'kubernetes', 'business', 'analytics', 'logistics',
  'economics', 'physics', 'ethics', 'mathematics', 'statistics', 'robotics', 'genomics', 'diagnostics', 'services',
  'gas', 'press', 'bus', 'status', 'campus', 'cyprus', 'lens', 'always', 'various', 'previous', 'does',
]);

/** Conservative plural stripper, applied identically to queries, titles and the taxonomy. */
function stem(w: string): string {
  if (w.length <= 3 || NO_STEM.has(w)) return w;
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
  return w;
}

const stems = (s: string): string[] => wordsOf(s).map(stem);

const hasAll = (set: Set<string>, words: string[]) => words.length > 0 && words.every((w) => set.has(w));

function containsSeq(words: string[], seq: string[]): boolean {
  if (!seq.length || seq.length > words.length) return false;
  outer: for (let i = 0; i + seq.length <= words.length; i++) {
    for (let k = 0; k < seq.length; k++) if (words[i + k] !== seq[k]) continue outer;
    return true;
  }
  return false;
}

// =============================================================================
// Acronyms by initials
// =============================================================================
/** Small words an acronym may include or skip ("doe" = Department of Energy, "nih" = National Institutes of Health). */
const ACRONYM_SMALL = new Set(['of', 'the', 'for', 'and', 'on', 'in', 'at', 'to', 'a', 'an', 'de', 'du', 'des', 'la', 'le', 'del']);
const isAcronymShaped = (w: string, min = ACRONYM_MIN) => w.length >= min && w.length <= ACRONYM_MAX && /^[a-z]+$/.test(w);

const COMMON_WORDS: ReadonlySet<string> = new Set(COMMON_ENGLISH_WORDS);
/**
 * A lowercase word that is ordinary English after plural / verb folding ("runs",
 * "acted", "using") is read as itself, never as bare initials. Typed in capitals
 * ("RUN", "DOE") it may still be an acronym.
 */
function isCommonWord(w: string): boolean {
  if (COMMON_WORDS.has(w) || COMMON_WORDS.has(stem(w))) return true;
  const m = /^(.{2,}?)(ing|ed|es|s|d)$/.exec(w);
  return m != null && (COMMON_WORDS.has(m[1]) || COMMON_WORDS.has(`${m[1]}e`));
}
const plausibleAcronym = (w: string, caps: boolean) => caps || !isCommonWord(w);
const NO_CAPS: ReadonlySet<string> = new Set();

/** Every initials spelling of a word run (small words optional), 2-5 letters. Runs with digits spell nothing. */
function acronymVariants(run: string[]): string[] {
  let acc = [''];
  let significant = 0;
  for (const w of run) {
    if (!/^[a-z]/.test(w) || /\d/.test(w)) return [];
    const small = ACRONYM_SMALL.has(w);
    if (!small) significant++;
    const next: string[] = [];
    for (const a of acc) {
      if (small) next.push(a);
      if (a.length < ACRONYM_MAX) next.push(a + w[0]);
    }
    acc = next;
  }
  if (significant < 2) return [];
  return acc.filter((a) => a.length >= ACRONYM_MIN);
}

/** Acronym -> phrase for every run of 2-6 words inside one title part that starts and ends with a significant word. */
function titleAcronyms(parts: string[][]): Map<string, string> {
  const out = new Map<string, string>();
  for (const words of parts) {
    for (let i = 0; i < words.length; i++) {
      if (ACRONYM_SMALL.has(words[i])) continue;
      for (let j = i + 1; j < words.length && j < i + 6; j++) {
        if (ACRONYM_SMALL.has(words[j])) continue;
        const run = words.slice(i, j + 1);
        for (const a of acronymVariants(run)) if (!out.has(a)) out.set(a, run.join(' '));
      }
    }
  }
  return out;
}

/** Initials of a company name (leading runs of 2+ significant words; a "U.S." / "United States" prefix is optional). */
function companyAcronyms(name: string): Set<string> {
  const out = new Set<string>();
  let toks = wordsOf(name.replace(/\([^)]*\)/g, ' '));
  while (toks.length && toks[0] === 'the') toks.shift();
  while (toks.length > 1 && LEGAL_SUFFIXES.has(toks[toks.length - 1])) toks.pop();
  const starts: { prefix: string; words: string[] }[] = [{ prefix: '', words: toks }];
  if (toks[0] === 'us') starts.push({ prefix: '', words: toks.slice(1) }, { prefix: 'us', words: toks.slice(1) });
  else if (toks[0] === 'united' && toks[1] === 'states') starts.push({ prefix: '', words: toks.slice(2) }, { prefix: 'us', words: toks.slice(2) });
  if (toks[0] === 'us') starts.shift();
  for (const { prefix, words } of starts) {
    for (let j = 1; j < Math.min(words.length, 7); j++) {
      if (ACRONYM_SMALL.has(words[j])) continue;
      for (const a of acronymVariants(words.slice(0, j + 1))) {
        const x = prefix + a;
        if (x.length >= COMPANY_ACRONYM_MIN && x.length <= ACRONYM_MAX) out.add(x);
      }
    }
  }
  return out;
}

/** Optimal-string-alignment edit distance, bailing out above `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2: number[] = new Array(b.length + 1).fill(0);
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

// =============================================================================
// Topic relations
// =============================================================================
const REL = new Map<string, Map<string, number>>();
function setRel(a: string, b: string, w: number) {
  if (!REL.has(a)) REL.set(a, new Map());
  const m = REL.get(a)!;
  m.set(b, Math.max(m.get(b) ?? 0, w));
}
for (const t of Object.keys(TOPIC_LABELS)) setRel(t, t, 1);
for (const [a, b, ab, ba] of RELATED_PAIRS) { setRel(a, b, ab); setRel(b, a, ba ?? ab); }
for (const [a, b, w] of DIRECTED) setRel(a, b, w);

const relCredit = (a: string, b: string) => Math.max(REL.get(a)?.get(b) ?? 0, REL.get(b)?.get(a) ?? 0);
const related = (a: string, b: string) => relCredit(a, b) > 0;
const topicLabel = (t: string) => TOPIC_LABELS[t] ?? t;
const hasRoleTopic = (topics: TopicWeights) => Object.keys(topics).some((t) => !isIndustryTopic(t));

// =============================================================================
// Abbreviations
// =============================================================================
type Sense = { label: string; stems: string[]; weight: number; industries: string[] | null };

const ABBR_SENSES = new Map<string, Sense[]>();
for (const [abbr, spec] of Object.entries(ABBREVIATIONS)) {
  const list: readonly AbbreviationSense[] = typeof spec === 'string' ? [{ expansion: spec }] : spec;
  ABBR_SENSES.set(stem(abbr), list.map((s) => ({
    label: s.expansion,
    stems: stems(s.expansion),
    weight: s.weight ?? 1,
    industries: s.industries ? [...s.industries] : null,
  })));
}
const isAmbiguousAbbr = (senses: Sense[]) => senses.length > 1 || senses.some((s) => s.industries);

/** Unambiguous abbreviations expanded (for literal / phrase matching only). */
const CANON = new Map<string, string[]>();
for (const [k, senses] of ABBR_SENSES) if (!isAmbiguousAbbr(senses) && senses[0].stems.join(' ') !== k) CANON.set(k, senses[0].stems);

function canon(words: string[]): string[] {
  const out: string[] = [];
  for (const w of words) {
    const x = CANON.get(w);
    if (x) out.push(...x);
    else out.push(w);
  }
  return out;
}

// =============================================================================
// Word families
// =============================================================================
const FAMILY_OF = new Map<string, string>(); // stem -> family key
const FAMILY_MEMBERS = new Map<string, string[]>(); // family key -> member stems
for (const fam of WORD_FAMILIES) {
  const members = fam.map(stem);
  FAMILY_MEMBERS.set(members[0], members);
  for (const m of members) if (!FAMILY_OF.has(m)) FAMILY_OF.set(m, members[0]);
}
const sameFamily = (a: string, b: string) => a !== b && FAMILY_OF.get(a) != null && FAMILY_OF.get(a) === FAMILY_OF.get(b);

// =============================================================================
// Title phrasings (compiled) and the title analyzer
// =============================================================================
type SenseData = { label: string; topics: TopicWeights; level: number | null; weight: number; industries: string[] | null };
type PatternData = { topics: TopicWeights; level?: number; senses?: SenseData[]; agent: boolean };
type Compiled<T> = { words: string[]; data: T };

function compile<T>(entries: { words: string[]; data: T }[]): Map<string, Compiled<T>[]> {
  const byFirst = new Map<string, Compiled<T>[]>();
  for (const e of entries) {
    if (!e.words.length) continue;
    const list = byFirst.get(e.words[0]) ?? [];
    list.push({ words: e.words, data: e.data });
    byFirst.set(e.words[0], list);
  }
  for (const list of byFirst.values()) list.sort((a, b) => b.words.length - a.words.length);
  return byFirst;
}

function longestMatch<T>(index: Map<string, Compiled<T>[]>, words: string[], i: number, end = words.length): Compiled<T> | null {
  const list = index.get(words[i]);
  if (!list) return null;
  for (const c of list) {
    if (i + c.words.length > end) continue;
    let ok = true;
    for (let k = 1; k < c.words.length; k++) if (words[i + k] !== c.words[k]) { ok = false; break; }
    if (ok) return c;
  }
  return null;
}

/** Agent nouns name a person doing a job ("recruiter", "physician", "nurse"): the head of a title. */
const AGENT_WORDS = new Set([
  'nurse', 'attorney', 'counsel', 'paralegal', 'clerk', 'chef', 'coach', 'surgeon', 'advocate', 'midwife',
  'actuary', 'associate', 'agent', 'rn', 'np', 'md', 'pa', 'cpa', 'dentist', 'pharmacist',
]);
function isAgentWord(w: string): boolean {
  return AGENT_WORDS.has(w) || /(?:er|or|ist|ian|ant|ent|eer|ee)$/.test(w);
}

const BASE_PATTERNS: { words: string[]; data: PatternData }[] = TITLE_PATTERNS.map(([phrase, topics, level]) => {
  const words = stems(phrase);
  return { words, data: { topics, level, agent: isAgentWord(words[words.length - 1]) } };
});
const BASE_INDEX = compile(BASE_PATTERNS);

type Evidence = {
  topic: string;
  strength: number;
  source: string; // the title / company text that produced it
  via: 'title' | 'company' | 'employer';
  sense?: string; // abbreviation sense ("cmo = chief medical officer")
  modifier?: boolean; // demoted by the head-noun rule ("Physician" in "Physician Recruiter")
  phrase?: string; // stems of the title phrasing that produced it (title evidence only)
  inferred?: string; // employer label for generic titles ("a law firm")
};

function addEvidence(list: Evidence[], e: Evidence) {
  const prev = list.find((x) => x.topic === e.topic && x.via === e.via);
  if (!prev) list.push({ ...e });
  else if (e.strength > prev.strength) {
    prev.strength = e.strength; prev.source = e.source; prev.sense = e.sense; prev.inferred = e.inferred; prev.modifier = e.modifier;
    prev.phrase = e.phrase;
  }
}

type Match = { start: number; end: number; data: PatternData; source: string; part: number };

type TitleInfo = {
  words: string[]; // stems, in order (whole title)
  wordSet: Set<string>;
  canon: string[]; // stems with abbreviations expanded (literal / phrase matching)
  canonSet: Set<string>;
  familySet: Set<string>; // family keys of the title words (word-form matching)
  evidence: Evidence[]; // unambiguous title evidence (after the head-noun rule)
  ambiguous: { source: string; senses: SenseData[] }[]; // resolved per row, with the employer's industry
  level: number; // -1 when no level marker (resolved per row)
  bareEngineer: boolean; // "... Engineer" with no discipline
  extraWords: string[]; // content words no phrase, level word or filler explained
  exCompanies: string[][]; // "(ex-McKinsey)": former employers named in the title
  modifierWords: Set<string>; // stems of function words demoted by the head-noun rule
  roleWords: string[]; // title stems outside former-employer mentions
  acronyms: Map<string, string>; // initials of title phrases ("ed" -> "executive director")
};

const TITLE_FILLER = new Set([
  'of', 'the', 'and', 'for', 'to', 'in', 'at', 'a', 'an', 'division', 'department', 'dept', 'team', 'group', 'unit',
  'practice', 'office', 'global', 'north', 'america', 'americas', 'emea', 'apac', 'us', 'usa', 'uk', 'region',
  'regional', 'national', 'area', 'with', 'on', 'i', 'ii', 'iii', 'iv', 'v',
]);

/**
 * Generated phrasings for abbreviations: each expansion analyzed like a title.
 * Unambiguous ones become ordinary phrasings; ambiguous ones keep their senses.
 */
const ABBR_PATTERNS: { words: string[]; data: PatternData }[] = [];
/**
 * Abbreviations whose main sense only names a seniority ("ED" = executive
 * director). Read that way only when the abbreviation stands alone as a title
 * part ("E.D.", "ED, Arts Council"), since inside a phrase it often means
 * something else ("Special Ed Teacher").
 */
const STANDALONE_LEVEL = new Map<string, { stems: string[]; level: number }>();

function analyzeParts(title: string, index: Map<string, Compiled<PatternData>[]>): {
  raw: string[]; words: string[]; matches: Match[]; exCompanies: string[][]; parts: string[][];
} {
  let text = fold(title);
  // "(ex-McKinsey)", "ex-Google", "formerly at Deloitte": former employers, not roles.
  const exCompanies: string[][] = [];
  text = text.replace(/(^|[\s(\[,|/;•·])(?:ex|former|formerly)(?:\s*[-–]\s*|\s+)(?:at\s+|@\s*)?([^,|/()\[\];•·]+)/g, (_m, pre: string, name: string) => {
    const toks = companyTokens(name).slice(0, 4);
    if (toks.length) exCompanies.push(toks);
    return `${pre} | `;
  });
  // Separate roles and descriptors: "Founder | Angel Investor", "Director, Product", "SWE @ Stripe".
  const parts = text.split(/\s*(?:[|/;•·()\[\],@]|\s[-–—]\s|\bat\b)\s*/);
  const raw: string[] = [];
  const words: string[] = [];
  const matches: Match[] = [];
  const partWords: string[][] = [];
  parts.forEach((part, p) => {
    let pr = wordsOf(part);
    // "Chief of Staff to the CEO", "Assistant to the CFO": what follows is someone else's role.
    for (let i = 1; i + 1 < pr.length; i++) if (pr[i] === 'to' && pr[i + 1] === 'the') { pr = pr.slice(0, i); break; }
    if (!pr.length) return;
    partWords.push(pr);
    const offset = words.length;
    for (const w of pr) { raw.push(w); words.push(stem(w)); }
    const end = words.length;
    for (let i = offset; i < end;) {
      const m = longestMatch(index, words, i, end);
      if (!m) { i++; continue; }
      matches.push({ start: i, end: i + m.words.length, data: m.data, source: raw.slice(i, i + m.words.length).join(' '), part: p });
      i += m.words.length;
    }
  });
  return { raw, words, matches, exCompanies, parts: partWords };
}

/** Title -> topic evidence and level, independent of the employer (cached per title string). */
function analyzeTitle(title: string, index: Map<string, Compiled<PatternData>[]> = TITLE_INDEX): TitleInfo {
  const { raw, words, matches, exCompanies, parts } = analyzeParts(title, index);
  const evidence: Evidence[] = [];
  const ambiguous: { source: string; senses: SenseData[] }[] = [];
  const consumed = new Set<number>();
  let level = -1;

  // Head-noun rule: within one role part, a function word before a different
  // head noun is a modifier ("Physician Recruiter" is a recruiter; "Nurse
  // Educator" an educator). Related functions ("Machine Learning Engineer")
  // and industries ("Payments Engineer") are not demoted.
  const damp = new Array<number>(matches.length).fill(1);
  for (let a = 0; a < matches.length; a++) {
    const ma = matches[a];
    if (ma.data.senses || !hasRoleTopic(ma.data.topics)) continue;
    for (let b = a + 1; b < matches.length; b++) {
      const mb = matches[b];
      if (mb.part !== ma.part || !mb.data.agent || mb.data.senses) continue;
      const headTopics = Object.entries(mb.data.topics).filter(([t, s]) => !isIndustryTopic(t) && s >= HEAD_MIN_STRENGTH).map(([t]) => t);
      if (!headTopics.length) continue;
      const modTopics = Object.keys(ma.data.topics).filter((t) => !isIndustryTopic(t));
      const close = modTopics.some((t) => headTopics.some((h) => relCredit(t, h) >= MODIFIER_UNRELATED_BELOW));
      if (!close) { damp[a] = MODIFIER_FACTOR; break; }
    }
  }

  const modifierWords = new Set<string>();
  matches.forEach((m, k) => {
    for (let i = m.start; i < m.end; i++) consumed.add(i);
    if (damp[k] < 1) for (let i = m.start; i < m.end; i++) modifierWords.add(words[i]);
    if (m.data.senses) {
      ambiguous.push({ source: m.source, senses: m.data.senses });
      return;
    }
    for (const [topic, strength] of Object.entries(m.data.topics)) {
      const s = isIndustryTopic(topic) ? strength : strength * damp[k];
      addEvidence(evidence, {
        topic, strength: s, source: m.source, via: 'title', modifier: s < strength || undefined,
        phrase: words.slice(m.start, m.end).join(' '),
      });
    }
    if (m.data.level != null) level = Math.max(level, m.data.level);
  });

  // "... Engineer" with no specific discipline (resolved per row: software in
  // tech, physical engineering at a manufacturer or utility).
  const hasEngFamily = evidence.some((e) => ENGINEERING_FAMILY.has(e.topic) && e.topic !== 'engmgmt')
    || ambiguous.some((a) => a.senses.some((s) => Object.keys(s.topics).some((t) => ENGINEERING_FAMILY.has(t))));
  const bareEngineer = words.some((w, i) => w === 'engineer' && !consumed.has(i)) && !hasEngFamily;

  // Leadership word + function noun ("Head of Talent", "Growth Lead", "Director
  // of Pharmacy"). Only words no fixed phrase already explained take part, so
  // "Product Marketing Manager" does not become a product manager.
  if (words.some((w, i) => LEADERSHIP_WORDS.has(w) && !consumed.has(i))) {
    for (let i = 0; i < words.length; i++) {
      const topic = FUNCTION_NOUNS[words[i]];
      if (topic && !consumed.has(i)) addEvidence(evidence, { topic, strength: LEADERSHIP_NOUN_STRENGTH, source: raw[i], via: 'title' });
    }
  }
  for (let i = 1; i < words.length; i++) {
    if (words[i] === 'manager' && !consumed.has(i) && PEOPLE_MANAGER_NOUNS.has(words[i - 1])) {
      level = Math.max(level, PEOPLE_MANAGER_LEVEL);
    }
  }
  // Level words count only outside matched phrasings ("Executive Assistant" is
  // not an executive, "Talent Partner" not a partner).
  const extraWords: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (consumed.has(i)) continue;
    const l = LEVEL_WORDS[words[i]];
    if (l != null) { level = Math.max(level, l); continue; }
    if (!TITLE_FILLER.has(words[i]) && !LEADERSHIP_WORDS.has(words[i])) extraWords.push(words[i]);
  }
  for (const e of evidence) {
    const d = TOPIC_DEFAULT_LEVEL[e.topic];
    if (d != null) level = Math.max(level, d);
  }

  for (const p of parts) {
    const sl = p.length === 1 ? STANDALONE_LEVEL.get(p[0]) : undefined;
    if (sl) level = Math.max(level, sl.level);
  }

  const allWords = stems(title);
  const standalone = new Set(parts.filter((p) => p.length === 1 && STANDALONE_LEVEL.has(p[0])).map((p) => p[0]));
  const cw = canon(allWords).flatMap((w) => (standalone.has(w) ? STANDALONE_LEVEL.get(w)!.stems : [w]));
  const familySet = new Set<string>();
  for (const w of allWords) { const f = FAMILY_OF.get(w); if (f) familySet.add(f); }
  return {
    words: allWords, wordSet: new Set(allWords), canon: cw, canonSet: new Set(cw), familySet,
    evidence, ambiguous, level, bareEngineer, extraWords, exCompanies, modifierWords, roleWords: words,
    acronyms: index === BASE_INDEX ? new Map() : titleAcronyms(parts),
  };
}

// Abbreviation phrasings: analyze each expansion with the base phrasings.
for (const [abbr, senses] of ABBR_SENSES) {
  if (BASE_INDEX.get(abbr)?.some((c) => c.words.length === 1)) continue; // an explicit phrasing wins
  const analyzed: SenseData[] = senses.map((s) => {
    const ti = analyzeTitle(s.label, BASE_INDEX);
    const topics: Record<string, number> = {};
    for (const e of ti.evidence) topics[e.topic] = Math.max(topics[e.topic] ?? 0, e.strength);
    if (ti.bareEngineer) topics.engineering = Math.max(topics.engineering ?? 0, BARE_ENGINEER_STRENGTH);
    // A sense names a role; the industry words of its expansion ("medical doctor") are not evidence on their own.
    if (hasRoleTopic(topics)) for (const t of Object.keys(topics)) if (isIndustryTopic(t)) delete topics[t];
    return { label: s.label, topics, level: ti.level >= 0 ? ti.level : null, weight: s.weight, industries: s.industries };
  });
  if (!analyzed.some((s) => Object.keys(s.topics).length)) {
    // Level-only: LEVEL_WORDS handle "vp", "sr"; others ("ED" = executive director) set a standalone part's level.
    if (analyzed[0].level != null && LEVEL_WORDS[abbr] == null) STANDALONE_LEVEL.set(abbr, { stems: senses[0].stems, level: analyzed[0].level });
    continue;
  }
  if (!isAmbiguousAbbr(senses)) {
    ABBR_PATTERNS.push({ words: [abbr], data: { topics: analyzed[0].topics, level: analyzed[0].level ?? undefined, agent: true } });
  } else {
    ABBR_PATTERNS.push({ words: [abbr], data: { topics: {}, senses: analyzed, agent: true } });
  }
}

const TITLE_INDEX = compile([...BASE_PATTERNS, ...ABBR_PATTERNS]);
// Standalone-only abbreviations are not expanded inside phrases ("Special Ed Teacher").
for (const k of STANDALONE_LEVEL.keys()) CANON.delete(k);

// =============================================================================
// Query-side vocabulary
// =============================================================================
/**
 * `specific`: a role phrasing titles themselves use ("postdoc", "paralegal"):
 * titles that don't contain it are siblings (SIBLING_FACTOR). Query-only
 * phrasings (generic words, cues like "covers") are not specific.
 * `titlePhrase`: a seniority-only title phrasing ("executive director",
 * "managing partner"): the title must say it for full credit.
 */
type Trigger = {
  words: string[]; topics?: TopicWeights; band?: Band; hire?: boolean; skill?: boolean; senses?: SenseData[];
  specific?: boolean; titlePhrase?: boolean;
};

function normalizedTopics(topics: TopicWeights): Record<string, number> {
  // The ask is the role: drop industry topics a role phrasing carries ("underwriting" is not "anyone at an
  // insurer"), and umbrella topics a specialty implies ("mechanical engineer" is not any hardware engineer).
  const roleOnly = hasRoleTopic(topics);
  const keys = Object.keys(topics);
  const umbrella = (t: string) => keys.some((o) => o !== t && (REL.get(t)?.get(o) ?? 0) >= 0.9 && (REL.get(o)?.get(t) ?? 0) < 0.9);
  const entries = Object.entries(topics).filter(([t]) => (!roleOnly || !isIndustryTopic(t)) && !umbrella(t));
  const max = Math.max(...entries.map(([, s]) => s));
  const out: Record<string, number> = {};
  for (const [t, s] of entries) out[t] = s / max;
  return out;
}

/**
 * A phrasing asks for a seniority only when it says so ("chief ...", "head of
 * ...", "managing director"); "professor" or "store manager" ask for the role.
 */
function namesSeniority(words: string[]): boolean {
  return words.some((w) => w !== 'manager' && (LEVEL_WORDS[w] != null || LEADERSHIP_WORDS.has(w)))
    || words.some((w) => CANON.get(w)?.some((x) => x !== 'manager' && (LEVEL_WORDS[x] != null || LEADERSHIP_WORDS.has(x))));
}

/** Query triggers: every title phrasing (as an exact topic ask), overridden by QUERY_TRIGGERS. */
const TRIGGERS = new Map<string, Trigger>();
for (const p of [...BASE_PATTERNS, ...ABBR_PATTERNS]) {
  const key = p.words.join(' ');
  if (p.data.senses) {
    const union: Record<string, number> = {};
    for (const s of p.data.senses) {
      if (!Object.keys(s.topics).length) continue;
      for (const [t, w] of Object.entries(normalizedTopics(s.topics))) union[t] = Math.max(union[t] ?? 0, w * s.weight);
    }
    const bands = p.data.senses.map((s) => (s.level != null && s.level >= 3 && namesSeniority(stems(s.label)) ? bandForLevel(s.level) : undefined));
    const band = bands.every((b) => b && b === bands[0]) ? bands[0] : undefined;
    TRIGGERS.set(key, { words: p.words, topics: union, band, senses: p.data.senses, specific: true });
    continue;
  }
  const topics = Object.keys(p.data.topics).length ? normalizedTopics(p.data.topics) : {};
  const band = p.data.level != null && p.data.level >= 3 && namesSeniority(p.words) ? bandForLevel(p.data.level) : undefined;
  const hasTopics = Object.keys(topics).length > 0;
  TRIGGERS.set(key, { words: p.words, topics, band, specific: hasTopics, titlePhrase: !hasTopics && band != null });
}
for (const q of QUERY_TRIGGERS) {
  const words = stems(q.phrase);
  TRIGGERS.set(words.join(' '), { words, topics: q.topics, band: q.band, hire: q.hire, skill: q.skill });
}
// Word forms: a family member stands in for a typed word no phrasing knows ("underwriters").
for (const members of FAMILY_MEMBERS.values()) {
  const known = members.find((m) => TRIGGERS.has(m) && Object.keys(TRIGGERS.get(m)!.topics ?? {}).length);
  if (!known) continue;
  const t = TRIGGERS.get(known)!;
  for (const m of members) if (!TRIGGERS.has(m)) TRIGGERS.set(m, { words: [m], topics: t.topics, band: t.band, senses: t.senses, specific: t.specific });
}
const TRIGGER_INDEX = compile([...TRIGGERS.values()].map((t) => ({ words: t.words, data: t })));

const QUERY_STOPWORDS = new Set(QUERY_STOPWORDS_RAW.map((w) => stem(fold(w).replace(/['’]/g, ''))));

/** Every word the lexicon knows: never typo-corrected, and a correction target. */
const LEXICON_WORDS = new Set<string>();
for (const t of TRIGGERS.values()) for (const w of t.words) LEXICON_WORDS.add(w);
for (const k of ABBR_SENSES.keys()) LEXICON_WORDS.add(k);
for (const members of FAMILY_MEMBERS.values()) for (const m of members) LEXICON_WORDS.add(m);
for (const w of Object.keys(LEVEL_WORDS)) LEXICON_WORDS.add(w);
for (const w of Object.keys(FUNCTION_NOUNS)) LEXICON_WORDS.add(w);

// =============================================================================
// Companies: identity, aliases, industries
// =============================================================================
/** Company name -> name tokens before legal-suffix stripping (lowercase, no punctuation, no "and", no leading "the"). */
function companyNameTokens(s: string): string[] {
  const toks = wordsOf(s).filter((t) => t !== 'and');
  while (toks.length && toks[0] === 'the') toks.shift();
  return toks;
}
/** Company name -> identity tokens (companyNameTokens without trailing legal suffixes). */
function companyTokens(s: string): string[] {
  const toks = companyNameTokens(s);
  while (toks.length > 1 && LEGAL_SUFFIXES.has(toks[toks.length - 1])) toks.pop();
  return toks;
}
const compact = (toks: string[]) => toks.join('');

const ALIASES_OF = new Map<string, string[]>(); // compact -> other members' compacts
for (const group of COMPANY_ALIAS_GROUPS) {
  const keys = group.map((g) => compact(companyTokens(g)));
  for (const k of keys) ALIASES_OF.set(k, [...new Set([...(ALIASES_OF.get(k) ?? []), ...keys.filter((o) => o !== k)])]);
}

/** Words that may follow a well-known name and still be that company ("Walmart Global Tech", "Chase Bank"). */
const COMPANY_TAIL = new Set([
  'group', 'holdings', 'holding', 'international', 'global', 'usa', 'us', 'america', 'americas', 'north', 'worldwide',
  'enterprises', 'technologies', 'technology', 'tech', 'labs', 'systems', 'services', 'bank', 'financial', 'web',
  'securities', 'markets', 'digital', 'cloud', 'consulting', 'advisory', 'foundation', 'university', 'school',
]);

type Known = { tokens: number; industries: string[] };
const KNOWN_BY_COMPACT = new Map<string, Known>();
for (const [industry, names] of Object.entries(KNOWN_INDUSTRY)) {
  for (const n of names) {
    const toks = companyTokens(n);
    const key = compact(toks);
    const prev = KNOWN_BY_COMPACT.get(key);
    if (prev) { if (!prev.industries.includes(industry)) prev.industries.push(industry); }
    else KNOWN_BY_COMPACT.set(key, { tokens: toks.length, industries: [industry] });
  }
}

type KeywordRule = { industry: string; words: Set<string>; phrases: string[][]; prefixes: string[]; last: Set<string>; unlessKnown: boolean };
const KEYWORD_RULES: KeywordRule[] = COMPANY_KEYWORDS.map((k) => ({
  industry: k.industry,
  words: new Set(k.words ?? []),
  phrases: (k.phrases ?? []).map((p) => wordsOf(p)),
  prefixes: k.prefixes ? [...k.prefixes] : [],
  last: new Set(k.last ?? []),
  unlessKnown: !!k.unlessKnown,
}));

type CompanyInfo = {
  name: string;
  tokens: string[];
  key: string;
  full: string; // compact of all tokens
  written: string; // compact of the name as written, legal suffix kept ("baincompany")
  stripped: boolean; // a legal suffix was dropped ("Bain & Company" -> "bain")
  lead: Set<string>; // compacts of leading token runs ("j", "jp", "jpmorgan")
  inner: Set<string>; // compacts of inner token runs
  industries: Map<string, number>; // industry topic -> strength
  known: boolean;
  evidence: Evidence[];
  rows: number; // rows at this company (for query parsing)
  acronyms: Set<string>; // initials of the name ("doe" for "U.S. Department of Energy")
};

/** Investing-firm words that a nonprofit's name ("Community Fund") doesn't carry. */
const INVESTING_NAME_WORDS = new Set(['ventures', 'venture', 'vc', 'equity', 'capital', 'investments', 'investment', 'asset', 'assets', 'hedge', 'partners']);

function analyzeCompany(name: string): CompanyInfo {
  const tokens = companyTokens(name);
  const nameTokens = companyNameTokens(name);
  const rawTokens = wordsOf(name);
  const lead = new Set<string>();
  const inner = new Set<string>();
  const n = Math.min(tokens.length, 8);
  for (let i = 0; i < n; i++) {
    let acc = '';
    for (let j = i; j < n; j++) {
      acc += tokens[j];
      // After a "U.S." prefix, the rest leads too ("department of energy" -> "U.S. Department of Energy").
      (i === 0 || (i === 1 && tokens[0] === 'us' && j >= 2) ? lead : inner).add(acc);
    }
  }

  const industries = new Map<string, number>();
  const put = (t: string, s: number) => industries.set(t, Math.max(industries.get(t) ?? 0, s));
  // Well-known companies: the longest leading run that names one, when the rest is a generic tail.
  let known = false;
  let acc = '';
  let best: Known | null = null;
  for (let j = 0; j < n; j++) {
    acc += tokens[j];
    const k = KNOWN_BY_COMPACT.get(acc);
    if (!k) continue;
    const rest = tokens.slice(j + 1);
    if (!rest.length || k.tokens >= 2 || rest.every((t) => COMPANY_TAIL.has(t))) best = k;
  }
  if (best) { known = true; for (const ind of best.industries) put(ind, KNOWN_COMPANY_STRENGTH); }
  for (const rule of KEYWORD_RULES) {
    if (rule.unlessKnown && known) continue;
    let hit = rawTokens.some((t) => rule.words.has(t) || rule.prefixes.some((p) => t.startsWith(p) && t.length > p.length));
    if (!hit && rule.last.size && tokens.length > 1 && rule.last.has(tokens[tokens.length - 1])) hit = true;
    if (!hit) hit = rule.phrases.some((p) => containsSeq(rawTokens, p));
    if (hit) put(rule.industry, COMPANY_KEYWORD_STRENGTH);
  }
  // A bank's lending arm is still a bank, but "Capital One" is not an investment firm.
  if (industries.has('i_investing') && industries.has('i_bank') && !(best && best.industries.includes('i_investing'))) industries.delete('i_investing');
  // "Riverbend Community Fund" is a nonprofit, not a fund manager.
  if (industries.has('i_investing') && (industries.has('i_nonprofit') || industries.has('i_foundation'))
    && !(best && best.industries.includes('i_investing')) && !rawTokens.some((t) => INVESTING_NAME_WORDS.has(t))) industries.delete('i_investing');

  const evidence: Evidence[] = [];
  for (const [ind, s] of industries) {
    addEvidence(evidence, { topic: ind, strength: s, source: name, via: 'company' });
    const role = INDUSTRY_ROLE_DUAL[ind];
    if (role) addEvidence(evidence, { topic: role, strength: DUAL_COMPANY_STRENGTH, source: name, via: 'company' });
  }
  return {
    name, tokens, key: tokens.join(' '), full: compact(tokens), lead, inner, industries, known, evidence, rows: 0,
    written: compact(nameTokens), stripped: nameTokens.length > tokens.length,
    acronyms: companyAcronyms(name),
  };
}

function industryLabel(ci: CompanyInfo): string {
  let best = '';
  let bs = 0;
  for (const [t, s] of ci.industries) if (s > bs) { best = t; bs = s; }
  return best ? topicLabel(best) : '';
}

/**
 * A typed word that may be a company acronym ("doe", "nih"): letters only, not a word the lexicon knows,
 * and not an ordinary English word unless typed in capitals ("act" is not "Arts Council of Toronto").
 */
const isCompanyAcronymWord = (w: string, caps: boolean) => isAcronymShaped(w, COMPANY_ACRONYM_MIN) && !LEXICON_WORDS.has(w)
  && !QUERY_STOPWORDS.has(w) && plausibleAcronym(w, caps);

const QUERY_ACRONYMS = new Map<string, string[]>();
function queryAcronyms(q: string[]): string[] {
  const key = q.join(' ');
  let v = QUERY_ACRONYMS.get(key);
  if (!v) {
    v = acronymVariants(q).filter((a) => a.length >= COMPANY_ACRONYM_MIN);
    if (QUERY_ACRONYMS.size > 1000) QUERY_ACRONYMS.clear();
    QUERY_ACRONYMS.set(key, v);
  }
  return v;
}

/** How well a company satisfies one typed company phrase (tokens), 0 if not at all. `caps`: words typed in capitals. */
function companyMatchesClause(c: CompanyInfo, q: string[], allowAcronym = true, caps: ReadonlySet<string> = NO_CAPS): number {
  if (!q.length || !c.tokens.length) return 0;
  const qc = compact(q);
  // Query words as the company's leading words ("amazon" -> "Amazon Web Services", "jp morgan" -> "J.P. Morgan").
  if (c.lead.has(qc) || c.written === qc) return COMPANY_EXACT;
  // Company name as the leading words of the query ("google cloud platform" -> "Google"). Not for
  // a one-word name left by suffix stripping: "Bain & Company" is not "Bain Capital".
  if (c.full.length >= 4 && c.tokens.length < q.length && !(c.stripped && c.tokens.length === 1)
    && c.tokens.every((t, i) => q[i] === t)) return COMPANY_EXACT;
  // Query words inside the company name ("aws", "deepmind").
  if (qc.length >= 3 && !(q.length === 1 && COMPANY_STOPWORDS.has(qc)) && c.inner.has(qc)) return COMPANY_INNER;
  for (const alias of ALIASES_OF.get(qc) ?? []) if (c.lead.has(alias)) return COMPANY_ALIAS;
  // Acronyms: "doe" -> "U.S. Department of Energy"; "department of energy" -> a company named "DOE".
  if (!allowAcronym) return 0;
  if (q.length === 1 && c.acronyms.has(qc) && isCompanyAcronymWord(qc, caps.has(qc))) return COMPANY_ACRONYM;
  if (q.length >= 2 && c.tokens.length === 1 && isAcronymShaped(c.full, COMPANY_ACRONYM_MIN) && queryAcronyms(q).includes(c.full)) return COMPANY_ACRONYM;
  return 0;
}

// =============================================================================
// Per-row index (memoized on the rows array)
// =============================================================================
type RowInfo = {
  row: Row;
  title: string;
  titleInfo: TitleInfo;
  company: CompanyInfo;
  combo: Combined; // shared by every row with the same title and company (per-query score cache key)
  evidence: Evidence[]; // title evidence (senses resolved) + employer inference + company evidence
  level: number;
  demoted: Set<string>; // title words read differently at this employer ("Consultant" at a hospital)
  noteWords: Set<string> | null; // for a cheap pre-check; noteMatches decides
};

type Index = {
  length: number;
  infos: RowInfo[];
  titleVocab: Map<string, number>; // stem -> document frequency
  companyVocab: Map<string, number>; // raw company token -> rows
  noteVocab: Set<string>;
  acronymVocab: Set<string>; // initials of title phrases and company names (never typo-corrected)
  companies: CompanyInfo[]; // distinct
  relCache: { ctx: NetworkContext | null; day: string; values: (Relationship | undefined)[] } | null;
};

const INDEXES = new WeakMap<Row[], Index>();

/** Title evidence resolved against the employer: senses, bare "Engineer", generic titles, company. */
type Combined = { evidence: Evidence[]; level: number; demoted: Set<string> };

function combine(ti: TitleInfo, ci: CompanyInfo): Combined {
  const evidence = ti.evidence.map((e) => ({ ...e }));
  let level = ti.level;
  const demoted = new Set<string>(); // title words whose own reading the employer overrides

  // Ambiguous abbreviations: a sense tied to the employer's industry wins.
  for (const amb of ti.ambiguous) {
    const bound = amb.senses.filter((s) => s.industries && s.industries.some((i) => ci.industries.has(i)));
    for (const s of amb.senses) {
      let w = s.weight;
      if (bound.length) w = bound.includes(s) ? 1 : OFF_INDUSTRY_SENSE;
      else if (s.industries && ci.industries.size) w *= OFF_INDUSTRY_SENSE;
      for (const [topic, strength] of Object.entries(s.topics)) {
        addEvidence(evidence, { topic, strength: strength * w, source: amb.source, via: 'title', sense: `${amb.source} = ${s.label}` });
      }
      if (s.level != null && w >= 0.5) level = Math.max(level, s.level);
    }
  }

  if (ti.bareEngineer) {
    const physical = [...ci.industries.keys()].some((i) => PHYSICAL_ENGINEERING_INDUSTRIES.has(i));
    addEvidence(evidence, { topic: physical ? 'hardware' : 'software', strength: BARE_ENGINEER_STRENGTH, source: 'engineer', via: 'title' });
  }

  // Generic titles take their function from the employer's industry ("Partner"
  // at a law firm, "Analyst" at a bank, "Consultant" at a hospital).
  if (ci.industries.size) {
    for (const g of GENERIC_TITLES) {
      if (!g.industries.some((i) => ci.industries.has(i))) continue;
      const hit = g.words.map((w) => stems(w)).filter((ws) => containsSeq(ti.roleWords, ws)).sort((a, b) => b.length - a.length)[0];
      if (!hit) continue;
      const source = hit.join(' ');
      const targets = Object.keys(g.topics);
      const isGenericSource = (e: Evidence) => stems(e.source).every((w) => hit.includes(w));
      // The title must not name another function itself, and carry few unexplained words.
      const supports = evidence.some((e) => e.strength >= 0.5 && targets.some((t) => relCredit(e.topic, t) >= 0.5));
      const explicitRole = evidence.some((e) => e.via === 'title' && !isIndustryTopic(e.topic) && e.strength >= 0.5 && !isGenericSource(e));
      const extra = ti.extraWords.filter((w) => !hit.includes(w)).length;
      if (explicitRole && !supports) continue;
      if (extra > GENERIC_MAX_EXTRA_WORDS || (extra > 0 && !supports && g.replacesTitleReading)) continue;
      for (const [topic, s] of Object.entries(g.topics)) {
        addEvidence(evidence, { topic, strength: s * EMPLOYER_INFERRED_STRENGTH, source, via: 'employer', inferred: g.label });
      }
      // The generic word's own reading gives way ("Consultant" at a hospital is not management consulting).
      if (g.replacesTitleReading) {
        for (const e of evidence) {
          if (e.via === 'title' && isGenericSource(e) && !isIndustryTopic(e.topic) && !targets.some((t) => relCredit(e.topic, t) >= 0.5)) {
            e.strength *= GENERIC_OVERRIDDEN_DAMP;
            e.modifier = true;
            e.inferred = g.label;
            for (const w of hit) demoted.add(w);
          }
        }
      }
    }
  }
  if (level < 0) level = DEFAULT_LEVEL;
  for (const e of evidence) {
    const d = TOPIC_DEFAULT_LEVEL[e.topic];
    if (d != null) level = Math.max(level, d);
  }

  // A domain word in the title at an organization outside that domain ("Energy
  // Program Director" at a think tank) is below working in the domain.
  for (const e of evidence) {
    if (e.via !== 'title' || !isIndustryTopic(e.topic)) continue;
    if (![...ci.industries.keys()].some((i) => relCredit(i, e.topic) >= 0.5)) e.strength *= TITLE_DOMAIN_ONLY;
  }

  // Company evidence: industries stand as they are; a role inferred from the
  // company ("... AI" -> ML) is halved when the title names an unrelated function.
  if (ci.evidence.length) {
    const titleRoles = evidence.filter((e) => !isIndustryTopic(e.topic) && e.strength >= 0.5).map((e) => e.topic);
    for (const e of ci.evidence) {
      const conflict = !isIndustryTopic(e.topic) && titleRoles.length > 0 && !titleRoles.some((t) => related(t, e.topic));
      evidence.push(conflict ? { ...e, strength: e.strength * COMPANY_ROLE_CONFLICT_DAMP } : e);
    }
  }
  return { evidence, level, demoted };
}

/**
 * The index is reused while the array holds the same row objects in the same
 * order (a length check alone misses an in-place `rows[i] = newRow`). Editing a
 * row object's fields in place is not detected: pass a new row object instead.
 */
function sameRows(index: Index, rows: Row[]): boolean {
  if (index.length !== rows.length) return false;
  const infos = index.infos;
  for (let i = 0; i < rows.length; i++) if (infos[i].row !== rows[i]) return false;
  return true;
}

function getIndex(rows: Row[]): Index {
  const cached = INDEXES.get(rows);
  if (cached && sameRows(cached, rows)) return cached;

  const titleCache = new Map<string, TitleInfo>();
  const companyCache = new Map<string, CompanyInfo>();
  const comboCache = new Map<string, Combined>();
  const titleVocab = new Map<string, number>();
  const companyVocab = new Map<string, number>();
  const noteVocab = new Set<string>();
  const acronymVocab = new Set<string>();
  const titleRows = new Map<TitleInfo, number>();
  const infos: RowInfo[] = [];

  for (const row of rows) {
    const title = getField(row, POSITION_KEYS);
    const companyName = getField(row, COMPANY_KEYS);
    const note = getField(row, NOTE_KEYS);

    let ti = titleCache.get(title);
    if (!ti) {
      ti = analyzeTitle(title);
      titleCache.set(title, ti);
      for (const a of ti.acronyms.keys()) acronymVocab.add(a);
    }
    titleRows.set(ti, (titleRows.get(ti) ?? 0) + 1);

    let ci = companyCache.get(companyName);
    if (!ci) {
      ci = analyzeCompany(companyName);
      companyCache.set(companyName, ci);
      for (const a of ci.acronyms) acronymVocab.add(a);
    }
    ci.rows++;

    const comboKey = `${title}\u0000${companyName}`;
    let combo = comboCache.get(comboKey);
    if (!combo) { combo = combine(ti, ci); comboCache.set(comboKey, combo); }

    let nw: Set<string> | null = null;
    if (note.trim()) {
      nw = new Set(wordsOf(note));
      for (const w of nw) noteVocab.add(stem(w));
    }
    infos.push({ row, title, titleInfo: ti, company: ci, combo, evidence: combo.evidence, level: combo.level, demoted: combo.demoted, noteWords: nw });
  }

  // Vocabularies count rows, accumulated per distinct title / company.
  for (const [ti, n] of titleRows) for (const w of new Set(ti.roleWords)) titleVocab.set(w, (titleVocab.get(w) ?? 0) + n);
  for (const [name, ci] of companyCache) for (const t of new Set(wordsOf(name))) companyVocab.set(t, (companyVocab.get(t) ?? 0) + ci.rows);

  const index: Index = {
    length: rows.length, infos, titleVocab, companyVocab, noteVocab, acronymVocab,
    companies: [...companyCache.values()].filter((c) => c.tokens.length > 0),
    relCache: null,
  };
  INDEXES.set(rows, index);
  return index;
}

// =============================================================================
// Query parsing
// =============================================================================
type Credit = { w: number; minLevel?: number };

type Concept = {
  typed: string; // the words the user typed for this concept (display)
  typedWords: string[]; // stems of non-seniority typed words (literal bonus)
  spanWords: string[]; // stems of the whole typed span (phrase bonus)
  alts: TopicWeights; // what the user asked for
  credit: Map<string, Credit>; // row topic -> credit, after relations
  isRole: boolean; // any non-industry topic
  literalBonus: boolean; // false for "hire X": X describes the hire, not the helper
  hire: boolean;
  senses?: SenseData[]; // an ambiguous abbreviation's senses (for the reason line)
  specific: boolean; // the typed words are a role phrasing titles use (sibling rule)
};

/** One or more companies (alternatives: "stripe or plaid"). */
type CompanyClause = { typed: string; alts: string[][] };

function addCompany(clause: CompanyClause | null, typed: string, tokens: string[]): CompanyClause {
  if (!clause) return { typed, alts: [tokens] };
  return { typed: `${clause.typed} / ${typed}`, alts: [...clause.alts, tokens] };
}

type ParsedQuery = {
  concepts: Concept[];
  band: Band | null;
  bandTyped: string;
  company: CompanyClause | null;
  residual: string[]; // stems
  residualTyped: string[];
  residualCompany: string[]; // residual words that also name companies (weak company-name signal)
  noteQuery: string; // content words for noteMatches
  phraseWords: string[]; // stems of all non-company content words, in order (whole-query phrase bonus)
  corrections: { from: string; to: string }[];
  hire: boolean;
  acronyms: Map<string, AcronymAsk>; // residual words that may be acronyms, by stem
  caps: ReadonlySet<string>; // words typed in capitals ("DOE"): may be read as bare initials
  titlePhrases: { typed: string; words: string[] }[]; // seniority-only title phrasings ("executive director")
};

/** A residual word read as an acronym: established expansions from the taxonomy, and whether bare initials count. */
type AcronymAsk = { expansions: { label: string; stems: string[] }[]; initials: boolean };

function buildCredit(alts: TopicWeights, minLevel?: number): Map<string, Credit> {
  const out = new Map<string, Credit>();
  for (const [alt, w] of Object.entries(alts)) {
    const rel = REL.get(alt);
    if (!rel) continue;
    for (const [t, r] of rel) {
      const c = w * r;
      const prev = out.get(t);
      if (!prev || c > prev.w) out.set(t, { w: c, minLevel });
    }
  }
  return out;
}

/**
 * Two concepts that ask for overlapping functions are one ask, not two facets
 * to sum. The one that credits the other's ask more is the more general
 * ("engineer" fully accepts security engineers, "security" barely accepts
 * generic engineers), so the specific ask wins and the generic word only adds
 * its literal bonus ("security engineer", "backend developer"). Equal coverage
 * unions the asks. Concepts on unrelated functions ("payments engineer") stay
 * separate and must both be satisfied for full marks.
 */
function coverage(x: Concept, y: Concept): number {
  let best = 0;
  for (const [t, w] of Object.entries(y.alts)) best = Math.max(best, (x.credit.get(t)?.w ?? 0) * w);
  return best;
}

function normalized(alts: TopicWeights): Record<string, number> {
  const max = Math.max(...Object.values(alts));
  const out: Record<string, number> = {};
  for (const [t, w] of Object.entries(alts)) out[t] = w / max;
  return out;
}

function mergeOverlapping(concepts: Concept[]) {
  for (let i = 0; i < concepts.length; i++) {
    for (let j = i + 1; j < concepts.length; j++) {
      const a = concepts[i];
      const b = concepts[j];
      const ab = coverage(a, b);
      const ba = coverage(b, a);
      if (Math.max(ab, ba) < MERGE_OVERLAP) continue;
      let alts: Record<string, number>;
      if (ab > ba) alts = normalized(b.alts);
      else if (ba > ab) alts = normalized(a.alts);
      else {
        alts = { ...a.alts };
        for (const [t, w] of Object.entries(b.alts)) alts[t] = Math.max(alts[t] ?? 0, w);
      }
      concepts[i] = {
        typed: `${a.typed} ${b.typed}`,
        typedWords: [...a.typedWords, ...b.typedWords],
        spanWords: [...a.spanWords, ...b.spanWords],
        alts,
        credit: buildCredit(alts),
        isRole: a.isRole || b.isRole,
        literalBonus: true,
        hire: false,
        senses: a.senses ?? b.senses,
        specific: a.specific && b.specific,
      };
      concepts.splice(j, 1);
      j = i;
    }
  }
}

function isCompanyCandidate(q: string[]): boolean {
  if (!q.length) return false;
  if (q.length > 1) return true;
  const w = q[0];
  if (COMPANY_STOPWORDS.has(w) || QUERY_STOPWORDS.has(w)) return false;
  // Two-letter names only when they are well-known ("ey", "ge").
  return w.length >= 3 || ALIASES_OF.has(w) || KNOWN_BY_COMPACT.has(w);
}

/** Rows whose company matches the typed phrase (0 = not a company in this network). */
function companyRows(index: Index, q: string[], allowAcronym = true, caps: ReadonlySet<string> = NO_CAPS): number {
  if (!isCompanyCandidate(q)) return 0;
  let n = 0;
  for (const c of index.companies) if (companyMatchesClause(c, q, allowAcronym, caps) > 0) n += c.rows;
  return n;
}

function isKnownWord(index: Index, w: string): boolean {
  const s = stem(w);
  return QUERY_STOPWORDS.has(s) || LEXICON_WORDS.has(s) || index.titleVocab.has(s) || index.companyVocab.has(w)
    || index.noteVocab.has(s) || ALIASES_OF.has(w) || KNOWN_BY_COMPACT.has(w) || index.acronymVocab.has(w);
}

/**
 * "Did you mean": a word found nowhere in the network (titles, companies,
 * notes) and not in the lexicon is replaced by the closest title, company or
 * lexicon word that shares its first letter (edit distance 1, or 2 for words of
 * TYPO_LEN_2+ letters; ties -> the more frequent word in the network).
 */
function fuzzyCorrect(index: Index, w: string): string | null {
  const max = w.length >= TYPO_LEN_2 ? 2 : 1;
  let best: string | null = null;
  let bestD = max + 1;
  let bestF = -1;
  const consider = (cand: string, freq: number) => {
    if (cand.length < 3 || cand[0] !== w[0]) return;
    const d = editDistance(w, cand, max);
    if (d < bestD || (d === bestD && (freq > bestF || (freq === bestF && best !== null && cand < best)))) {
      best = cand; bestD = d; bestF = freq;
    }
  };
  for (const [t, f] of index.titleVocab) consider(t, f);
  for (const [t, f] of index.companyVocab) if (!COMPANY_STOPWORDS.has(t) && !LEGAL_SUFFIXES.has(t)) consider(t, f);
  for (const t of LEXICON_WORDS) if (!index.titleVocab.has(t) && !index.companyVocab.has(t)) consider(t, 0);
  return bestD <= max ? best : null;
}

function parseQuery(criteria: string, index: Index): ParsedQuery {
  const rawWords = wordsOf(criteria.replace(/@/g, ' at ')).slice(0, MAX_QUERY_WORDS);
  // Words typed in capitals ("IT"); meaningless when a multi-word query is all capitals.
  const typedCaps = new Set<string>();
  if (/\p{Ll}/u.test(criteria) || rawWords.length === 1) {
    for (const tok of criteria.split(/[^\p{L}\p{N}.]+/u)) {
      const t = tok.replace(/\./g, '');
      if (t.length >= 2 && /\p{Lu}/u.test(t) && !/\p{Ll}/u.test(t)) typedCaps.add(wordsOf(t).join(''));
    }
  }
  const corrections: { from: string; to: string }[] = [];

  // 1) Typo repair: only words nobody's title, company or note contains and the lexicon doesn't know.
  let lookups = 0;
  const words = rawWords.map((w) => {
    if (w.length < TYPO_MIN_LEN || /\d/.test(w) || isKnownWord(index, w)) return w;
    if (++lookups > MAX_TYPO_LOOKUPS) return w;
    const fixed = fuzzyCorrect(index, stem(w));
    if (fixed && fixed !== stem(w)) {
      corrections.push({ from: w, to: fixed });
      return fixed;
    }
    return w;
  });
  const st = words.map(stem);
  const used = new Array<boolean>(st.length).fill(false);

  // 2) Explicit company: "... at <company> ...": the longest run of words right
  //    after "at" (skipping articles) that names a company in the network, so
  //    "people at google working on ai" keeps "ai" as a topic.
  let company: CompanyClause | null = null;
  for (let at = 0; at < st.length; at++) {
    if (st[at] !== 'at') continue;
    let start = at + 1;
    while (start < st.length && (st[start] === 'a' || st[start] === 'an' || st[start] === 'the')) start++;
    let end = start;
    while (end < st.length && !QUERY_STOPWORDS.has(st[end]) && end - start < 4) end++;
    for (let n = end - start; n >= 1; n--) {
      const toks = words.slice(start, start + n);
      if (companyRows(index, toks, true, typedCaps) > 0) {
        company = addCompany(company, toks.join(' '), toks);
        for (let k = start; k < start + n; k++) used[k] = true;
        break;
      }
    }
  }

  // 3) Multi-word company names typed in full ("capital one", "j p morgan").
  for (let i = 0; i < st.length; i++) {
    for (let n = Math.min(4, st.length - i); n >= 2; n--) {
      if (used.slice(i, i + n).some(Boolean)) continue;
      const typed = words.slice(i, i + n).join(' ');
      let toks = companyTokens(typed);
      // A name whose suffix is part of how it is written ("bain & company"): keep the suffix when a
      // company in the network is written that way, so the clause names that company only.
      if (toks.length < 2) {
        const full = companyNameTokens(typed);
        const written = compact(full);
        if (full.length >= 2 && index.companies.some((c) => c.stripped && c.written === written)) toks = full;
      }
      if (toks.length < 2) continue;
      const key = compact(toks);
      const aliases = ALIASES_OF.get(key) ?? [];
      const initials = queryAcronyms(toks);
      if (index.companies.some((c) => c.full === key || c.written === key || c.lead.has(key) || aliases.some((a) => c.lead.has(a))
        || (c.tokens.length === 1 && initials.includes(c.full)))) {
        company = addCompany(company, words.slice(i, i + n).join(' '), toks);
        for (let k = i; k < i + n; k++) used[k] = true;
        break;
      }
    }
  }

  // 4) Taxonomy triggers, longest first.
  type Hit = { start: number; end: number; trig: Trigger };
  const hits: Hit[] = [];
  for (let i = 0; i < st.length;) {
    if (used[i]) { i++; continue; }
    const m = longestMatch(TRIGGER_INDEX, st, i);
    // A filler word that is also an abbreviation ("it" = information technology) is filler unless it
    // is typed in capitals ("IT") or sits in a role phrase ("it manager", "director of it").
    if (m && m.words.length === 1 && QUERY_STOPWORDS.has(st[i]) && !typedCaps.has(words[i])) {
      const prev = hits[hits.length - 1];
      const next = st[i + 1];
      const nextRole = next != null && !used[i + 1] && !QUERY_STOPWORDS.has(next)
        && (LEXICON_WORDS.has(next) || LEADERSHIP_WORDS.has(next) || longestMatch(TRIGGER_INDEX, st, i + 1) != null);
      const afterRole = prev != null && (prev.end === i || (prev.end === i - 1 && st[i - 1] === 'of'));
      if (!nextRole && !afterRole) { i++; continue; }
    }
    if (m && !used.slice(i, i + m.words.length).some(Boolean)) {
      hits.push({ start: i, end: i + m.words.length, trig: m.data });
      for (let k = i; k < i + m.words.length; k++) used[k] = true;
      i += m.words.length;
    } else {
      i++;
    }
  }

  let band: Band | null = null;
  let bandTyped = '';
  let bandEnd = -1;
  let hire = false;
  const concepts: Concept[] = [];
  const titlePhrases: { typed: string; words: string[] }[] = [];
  for (const h of hits) {
    if (h.trig.hire) { hire = true; continue; }
    if (h.trig.band) {
      if (!band || h.trig.band.lo > band.lo) band = h.trig.band;
      if (!h.trig.topics || !Object.keys(h.trig.topics).length) {
        bandTyped = words.slice(h.start, h.end).join(' ');
        bandEnd = h.end;
        if (h.trig.titlePhrase) titlePhrases.push({ typed: bandTyped, words: h.trig.words });
        continue;
      }
    }
    if (!h.trig.topics || !Object.keys(h.trig.topics).length) continue;
    // A seniority word right before the role ("head of product", "senior engineer")
    // is part of the typed phrase for the phrase bonus, not a literal word.
    let spanStart = h.start;
    if (bandEnd >= 0 && (bandEnd === h.start || (bandEnd === h.start - 1 && st[bandEnd] === 'of'))) {
      spanStart = st.lastIndexOf(stems(bandTyped)[0], h.start - 1);
      if (spanStart < 0) spanStart = h.start;
    }
    const typedWords = st.slice(h.start, h.end).filter((w) => !QUERY_STOPWORDS.has(w));
    concepts.push({
      typed: words.slice(spanStart, h.end).join(' '),
      typedWords,
      spanWords: st.slice(spanStart, h.end),
      alts: h.trig.topics,
      credit: buildCredit(h.trig.topics),
      isRole: hasRoleTopic(h.trig.topics) && !h.trig.skill,
      literalBonus: true,
      hire: false,
      senses: h.trig.senses,
      specific: !!h.trig.specific,
    });
  }
  mergeOverlapping(concepts);

  // "Head of engineering", "VP of engineering": at leadership level, engineering
  // means engineering leadership, not engineers.
  if (band && band.lo >= BAND_LEADERSHIP.lo) {
    for (const c of concepts) {
      if (Object.keys(c.alts).some((t) => ENGINEERING_FAMILY.has(t) && t !== 'engmgmt' && t !== 'security' && t !== 'ml')) {
        c.alts = { engmgmt: 1 };
        c.credit = buildCredit(c.alts);
      }
    }
  }

  // 5) Remaining words: a company named in the network, else a literal residual
  //    word. A word more rows carry in their title than in their company name is
  //    a title word first ("underwriters" is not "UL (Underwriters Laboratories)").
  const residual: string[] = [];
  const residualTyped: string[] = [];
  const residualCompany: string[] = [];
  const acronyms = new Map<string, AcronymAsk>();
  for (let i = 0; i < st.length; i++) {
    if (used[i] || QUERY_STOPWORDS.has(st[i])) continue;
    const nTitle = index.titleVocab.get(st[i]) ?? 0;
    // A word some titles use literally is not read as a company's initials ("art" is not "Arts Resource Trust").
    const nCompany = companyRows(index, [words[i]], nTitle === 0, typedCaps);
    if (nCompany > 0 && nCompany >= nTitle) {
      company = addCompany(company, words[i], [words[i]]);
      used[i] = true;
      continue;
    }
    residual.push(st[i]);
    residualTyped.push(words[i]);
    if (nCompany > 0) residualCompany.push(words[i]);
    // A short word may be an acronym ("ed", "pi"): established expansions always; bare initials
    // only for a word of BARE_INITIALS_MIN+ letters that isn't itself a title word, a lexicon
    // word or (unless typed in capitals) an ordinary English word ("art" means art; "hi" never
    // spells "Head of Innovation"; "runs" is not "Retail Unit Navigator").
    const w = words[i];
    if (isAcronymShaped(w) && !acronyms.has(st[i])) {
      const expansions = (ABBR_SENSES.get(w) ?? []).filter((s) => s.stems.length >= 2).map((s) => ({ label: s.label, stems: s.stems }));
      const initials = w.length >= BARE_INITIALS_MIN && (ABBR_SENSES.has(w)
        || (!index.titleVocab.has(w) && !LEXICON_WORDS.has(w) && plausibleAcronym(w, typedCaps.has(w))));
      if (expansions.length || initials) acronyms.set(st[i], { expansions, initials });
    }
  }

  // 6) Hiring intent: "hire engineers" asks for recruiters and the people who
  //    manage engineers, not for engineers.
  if (hire) {
    const roles = concepts.filter((c) => c.isRole);
    if (!roles.length) {
      const alts = { recruiting: 1, hr: 0.6 };
      concepts.push({ typed: 'hire', typedWords: [], spanWords: [], alts, credit: buildCredit(alts), isRole: true, literalBonus: false, hire: true, specific: false });
    }
    for (const c of roles) {
      const engineering = Object.keys(c.alts).some((t) => ENGINEERING_FAMILY.has(t));
      if (engineering) {
        c.alts = { recruiting: 1, engmgmt: 1 };
        c.credit = buildCredit(c.alts);
      } else {
        // Leaders of that function (manager level and up) or recruiters.
        const leaders = buildCredit(c.alts, HIRING_LEADER_MIN_LEVEL);
        for (const [t, cr] of buildCredit({ recruiting: 1 })) {
          const prev = leaders.get(t);
          if (!prev || cr.w > prev.w) leaders.set(t, cr);
        }
        c.alts = { ...c.alts, recruiting: 1 };
        c.credit = leaders;
      }
      c.typed = `hire ${c.typed}`;
      c.literalBonus = false;
      c.hire = true;
    }
  }

  const contentWords = rawWords.filter((w, i) => !QUERY_STOPWORDS.has(stem(w)) && !(st[i] === 'at'));
  const phraseWords = st.filter((w, i) => !QUERY_STOPWORDS.has(w) && !(company && used[i] && !hits.some((h) => i >= h.start && i < h.end)));
  return {
    concepts, band, bandTyped, company, residual, residualTyped, residualCompany,
    noteQuery: contentWords.join(' '),
    phraseWords: hire ? [] : phraseWords,
    corrections, hire, acronyms, caps: typedCaps, titlePhrases,
  };
}

// =============================================================================
// Scoring
// =============================================================================
function bandSatisfaction(level: number, band: Band): number {
  const dist = level < band.lo ? band.lo - level : level > band.hi ? level - band.hi : 0;
  if (dist === 0) return 1;
  if (dist <= 0.5) return 0.6;
  if (dist <= 1) return 0.3;
  if (dist <= 2) return 0.1;
  return 0;
}

function levelName(level: number): string {
  if (level >= 7) return 'C-level / founder';
  if (level >= 6) return 'VP / partner / board';
  if (level >= 5) return 'head / director';
  if (level >= 4.5) return 'manager';
  if (level >= 4) return 'staff / principal / lead';
  if (level >= 3) return 'senior';
  if (level >= 2) return 'mid-level';
  if (level >= 1) return 'junior';
  return 'intern / student';
}

/** Literal weight of one typed word in a title: exact, abbreviation-expanded, or another word form. */
type LiteralHit = { weight: number; kind: 'exact' | 'abbreviation' | 'form' | 'modifier'; sense?: string };

function literalWeight(ti: TitleInfo, w: string, full: number, demoted?: Set<string>): LiteralHit | null {
  // A word the head-noun rule demoted ("physician" in "Physician Recruiter"), or one the employer reads
  // differently ("Consultant" at a hospital), is only a small related signal.
  if (ti.modifierWords.has(w) || demoted?.has(w)) return { weight: full * MODIFIER_FACTOR, kind: 'modifier' };
  if (ti.wordSet.has(w)) return { weight: full, kind: 'exact' };
  const cw = canon([w]);
  if (hasAll(ti.canonSet, cw)) return { weight: full * ABBREVIATION_FACTOR, kind: 'abbreviation' };
  // An ambiguous abbreviation ("pm") spelled out in the title in any of its senses.
  const senses = ABBR_SENSES.get(w);
  if (senses && senses.length) {
    let best = 0;
    let label = '';
    for (const s of senses) if (s.stems.length > 1 && hasAll(ti.canonSet, s.stems) && s.weight > best) { best = s.weight; label = s.label; }
    if (best > 0) return { weight: full * ABBREVIATION_FACTOR * best, kind: 'abbreviation', sense: `${w} = ${label}` };
  }
  const fam = FAMILY_OF.get(w);
  if (fam && ti.familySet.has(fam) && ti.words.some((x) => sameFamily(x, w))) return { weight: full * WORD_FORM_FACTOR, kind: 'form' };
  return null;
}

type Scored = { relevance: number; tieBreak: number; titleHit: boolean; matched: string[]; reasons: string[] };

/** A residual word read as an acronym of a title phrase: an established expansion first, then bare initials. */
function acronymHit(ti: TitleInfo, w: string, ask: AcronymAsk): { weight: number; label: string; bare: boolean } | null {
  for (const e of ask.expansions) {
    if (containsSeq(ti.words, e.stems)) return { weight: W_RESIDUAL * ACRONYM_KNOWN, label: `${w} = ${e.label}`, bare: false };
  }
  if (!ask.initials) return null;
  const phrase = ti.acronyms.get(w);
  return phrase ? { weight: W_RESIDUAL * ACRONYM_INITIALS, label: `${w} = ${phrase}`, bare: true } : null;
}

function evidenceReason(c: Concept, e: Evidence, exact: boolean, sibling = false): string {
  if (sibling) return `Similar role (synonym or sibling of ${c.typed}): "${e.source}" (${topicLabel(e.topic)})`;
  if (e.via === 'employer') {
    return `Role from employer: "${e.source}" at ${e.inferred} → ${topicLabel(e.topic)}${exact ? '' : `, related to ${c.typed}`}`;
  }
  if (e.via === 'company') {
    return `Industry match (company): ${e.source} → ${topicLabel(e.topic)}${exact ? '' : `, related to ${c.typed}`}`;
  }
  if (e.modifier && e.inferred) return `Weak match: "${e.source}" at ${e.inferred} is a different role (related to ${c.typed})`;
  if (e.modifier) return `Title mentions "${e.source}" as a specialty, not the role (related to ${c.typed})`;
  if (e.sense) {
    return exact
      ? `Title match (abbreviation: ${e.sense}) for ${c.typed}`
      : `Related role (abbreviation: ${e.sense}): ${topicLabel(e.topic)} is related to ${c.typed}`;
  }
  return exact
    ? `Title match (synonym): "${e.source}" for ${c.typed}`
    : `Related role: "${e.source}" (${topicLabel(e.topic)}) is related to ${c.typed}`;
}

function scoreRow(info: RowInfo, q: ParsedQuery, noteHits: string[], companySat: number, companyLabel: string): Scored {
  const ti = info.titleInfo;
  const satisfied = new Set<string>(); // query stems this row already satisfies (note redundancy)
  const wholeCanon = canon(q.phraseWords);
  const wholePhrase = q.phraseWords.length >= 2 && containsSeq(ti.canon, wholeCanon);
  let relevance = 0;
  let titleHit = false;
  let anyRoleSat = false;
  const matched: string[] = [];
  const reasons: string[] = [];
  const roleAsked = q.concepts.some((c) => c.isRole);

  for (const c of q.concepts) {
    let best = 0;
    let bestEv: Evidence | null = null;
    let bestCredit = 0;
    const typedPhrase = c.typedWords.join(' ');
    for (const e of info.evidence) {
      const cr = c.credit.get(e.topic);
      if (!cr) continue;
      if (cr.minLevel != null && info.level < cr.minLevel) continue;
      // The title is the very phrasing the user typed ("Analyst" for "analyst"): a full match
      // for its topic, however weakly that phrasing names the topic in general.
      const s = cr.w * (c.literalBonus && !e.modifier && e.phrase === typedPhrase && e.phrase && !isIndustryTopic(e.topic) ? 1 : e.strength);
      if (s > best) { best = s; bestEv = e; bestCredit = cr.w; }
    }
    const lits = c.literalBonus ? c.typedWords.map((w) => ({ w, hit: literalWeight(ti, w, W_LITERAL, info.demoted) })).filter((x) => x.hit) : [];
    const litWeight = lits.reduce((sum, x) => sum + x.hit!.weight, 0);
    if (c.literalBonus && c.typedWords.length === 1 && lits.length === 1 && lits[0].hit!.kind !== 'modifier') {
      const floor = lits[0].hit!.kind === 'form' ? LITERAL_ONLY_SAT * WORD_FORM_FACTOR : LITERAL_ONLY_SAT;
      if (best < floor) { best = floor; bestEv = null; }
    }
    if (best <= 0) continue;
    // Exact role above sibling roles: the user typed a role titles use, and this title names
    // another role of the family without the typed one ("Professor" on "postdocs").
    const sibling = c.specific && c.isRole && c.literalBonus && !!bestEv && bestEv.via === 'title'
      && !isIndustryTopic(bestEv.topic) && !lits.some((x) => x.hit!.kind !== 'modifier');
    if (sibling) best *= SIBLING_FACTOR;
    if (best >= LITERAL_ONLY_SAT && c.literalBonus) for (const w of c.typedWords) satisfied.add(w);

    // An industry facet beside a role facet refines the role; it doesn't stand in for it.
    relevance += W_CONCEPT * best * (roleAsked && !c.isRole ? REFINEMENT_FACTOR : 1);
    if (c.isRole) anyRoleSat = true;
    if (!bestEv || bestEv.via !== 'company') titleHit = true;

    const spanCanon = canon(c.spanWords);
    const phrase = c.literalBonus && c.spanWords.length >= 2 && containsSeq(ti.canon, spanCanon)
      && !(wholePhrase && c.spanWords.join(' ') === q.phraseWords.join(' '));
    if (phrase) {
      const raw = containsSeq(ti.words, c.spanWords);
      relevance += raw ? W_PHRASE : W_PHRASE * ABBREVIATION_FACTOR;
      reasons.push(raw
        ? `Title phrase match: "${c.typed}"`
        : `Title phrase match (abbreviation): "${c.typed}" = ${spanCanon.join(' ')}`);
    }
    if (lits.length) {
      relevance += litWeight;
      titleHit = true;
      if (!phrase) {
        const exact = lits.filter((x) => x.hit!.kind === 'exact').map((x) => x.w);
        const abbr = lits.filter((x) => x.hit!.kind === 'abbreviation' && !x.hit!.sense).map((x) => x.w);
        for (const x of lits) if (x.hit!.sense) reasons.push(`Title match (abbreviation: ${x.hit!.sense})`);
        const form = lits.filter((x) => x.hit!.kind === 'form').map((x) => x.w);
        const modifier = lits.filter((x) => x.hit!.kind === 'modifier').map((x) => x.w);
        const atEmployer = modifier.filter((w) => info.demoted.has(w));
        const specialty = modifier.filter((w) => !info.demoted.has(w));
        if (specialty.length) reasons.push(`Title mentions (as a specialty, not the role): ${specialty.join(', ')}`);
        if (atEmployer.length) reasons.push(`Weak match: ${atEmployer.join(', ')} means a different role at ${info.company.name}`);
        if (exact.length) reasons.push(`Title match: ${exact.join(', ')}`);
        if (abbr.length) reasons.push(`Title match (abbreviation): ${abbr.join(', ')}`);
        if (form.length) reasons.push(`Title match (word form): ${form.join(', ')}`);
      }
      matched.push(...lits.map((x) => x.w));
    }
    if (bestEv) {
      const exact = bestCredit >= SYNONYM_CREDIT;
      if (c.hire) {
        reasons.push(`Can help you ${c.typed}: "${bestEv.source}" (${topicLabel(bestEv.topic)})`);
        matched.push(bestEv.source);
      } else if (bestEv.via !== 'title' || bestEv.sense || !exact || lits.length < c.typedWords.length) {
        reasons.push(evidenceReason(c, bestEv, exact, sibling && exact));
        matched.push(bestEv.via === 'company' ? topicLabel(bestEv.topic) : bestEv.source);
      }
    }
  }

  // Seniority-only title phrasings the user typed ("executive director"): the title must say it.
  for (const tp of q.titlePhrases) {
    if (!containsSeq(ti.canon, canon(tp.words))) continue;
    relevance += W_RESIDUAL + (tp.words.length >= 2 ? W_PHRASE : 0);
    titleHit = true;
    reasons.push(`Title match: ${tp.typed}`);
    matched.push(tp.typed);
  }

  // The whole query typed as a title phrase ("product designer" is two concepts but one exact title).
  if (wholePhrase && relevance > 0) {
    const raw = containsSeq(ti.words, q.phraseWords);
    relevance += raw ? W_PHRASE : W_PHRASE * ABBREVIATION_FACTOR;
    reasons.unshift(`Title phrase match${raw ? '' : ' (abbreviation)'}: "${q.phraseWords.join(' ')}"`);
  }

  // Seniority counts only when the role itself matched (a "Senior Accountant"
  // is not a partial "senior engineer"), or when there is no role to match.
  const seniorityOnly = !q.concepts.length && !q.company && !q.residual.length;
  if (q.band && (anyRoleSat || !q.concepts.some((c) => c.isRole))) {
    let s = bandSatisfaction(info.level, q.band);
    if (seniorityOnly && s < SENIORITY_ONLY_MIN_SAT) s = 0;
    if (s > 0) {
      // Alone, the typed seniority word in the title breaks ties ("intern" vs "student").
      if (seniorityOnly && q.bandTyped && containsSeq(ti.canon, canon(stems(q.bandTyped)))) relevance += W_LITERAL;
      relevance += W_SENIORITY * s;
      const lvl = levelName(info.level);
      reasons.push(s === 1 ? `Seniority match: ${lvl}` : `Seniority close: ${lvl} (asked ${q.band.label})`);
      matched.push(lvl);
      if (!q.concepts.some((c) => c.isRole)) titleHit = true;
    }
  }

  if (q.company && companySat > 0) {
    const w = q.concepts.length ? W_COMPANY_WITH_ROLE : W_COMPANY_ONLY;
    relevance += w * companySat;
    const companyOnly = q.concepts.some((c) => c.isRole) && !anyRoleSat;
    reasons.push(companyOnly ? `Weak match (company-only): ${companyLabel.replace(/^Company match: /, '').replace(/^Company match \(alias\): /, 'alias ')}` : companyLabel);
    matched.push(q.company.typed);
    for (const alt of q.company.alts) for (const t of alt) satisfied.add(stem(t));
  }

  const residualHits: string[] = [];
  let residualForms = false;
  const acronymReasons: string[] = [];
  const plainHits: string[] = [];
  let firmResidual = false; // a residual title hit other than bare initials (those alone don't pass Strict title-only)
  q.residual.forEach((w, i) => {
    const hit = literalWeight(ti, w, W_RESIDUAL, info.demoted);
    const acr = q.acronyms.get(w);
    const ah = acr ? acronymHit(ti, w, acr) : null;
    if (ah && (!hit || ah.weight > hit.weight)) {
      relevance += ah.weight;
      acronymReasons.push(`Title match (acronym): ${ah.label}`);
      residualHits.push(q.residualTyped[i]);
      if (!ah.bare) firmResidual = true;
      return;
    }
    if (!hit) return;
    relevance += hit.weight;
    if (hit.kind === 'form') residualForms = true;
    plainHits.push(q.residualTyped[i]);
    residualHits.push(q.residualTyped[i]);
    firmResidual = true;
  });
  if (residualHits.length) {
    if (firmResidual) titleHit = true;
    if (plainHits.length) reasons.push(`Title match${residualForms ? ' (word form)' : ''}: ${plainHits.join(', ')}`);
    reasons.push(...acronymReasons);
    matched.push(...residualHits);
  }
  // A residual word only in the company name: weak, below every title match.
  const companyWordHits = q.residualCompany.filter((w) => !residualHits.includes(w) && info.company.tokens.includes(w));
  if (companyWordHits.length) {
    relevance += W_RESIDUAL_COMPANY * companyWordHits.length;
    reasons.push(`Weak match (company name): ${info.company.name}`);
    matched.push(...companyWordHits);
  }

  for (const h of residualHits) satisfied.add(stem(h));
  let tieBreak = 0;
  if (noteHits.length) {
    for (const h of noteHits) {
      if (stems(h).every((w) => satisfied.has(w))) { relevance += W_NOTE_REDUNDANT; tieBreak += W_NOTE_REDUNDANT; }
      else relevance += W_NOTE;
    }
    reasons.push(`Note match: ${noteHits.join(', ')}`);
    matched.push(...noteHits);
  }

  if (relevance > 0 && q.corrections.length) {
    reasons.unshift(`Fuzzy match: ${q.corrections.map((c) => `"${c.to}" (you typed "${c.from}")`).join(', ')}`);
  }
  return { relevance, tieBreak, titleHit, matched: [...new Set(matched)], reasons: reasons.slice(0, MAX_REASONS) };
}

function relationshipFor(index: Index, i: number, ctx: NetworkContext | null, now: Date): Relationship {
  // Cached per dataset, context object and UTC day (the only time-dependent
  // input is day-granular message recency).
  const day = now.toISOString().slice(0, 10);
  if (!index.relCache || index.relCache.ctx !== ctx || index.relCache.day !== day) {
    index.relCache = { ctx, day, values: new Array(index.length) };
  }
  let r = index.relCache.values[i];
  if (!r) {
    r = relationshipSignals(index.infos[i].row, ctx, now);
    index.relCache.values[i] = r;
  }
  return r;
}

/** The raw query first, then a short clarification of how it was read (sent to Gemini as criteria). */
function describe(q: ParsedQuery, criteria: string): string {
  const parts: string[] = [];
  for (const c of q.corrections) parts.push(`${c.from} → ${c.to}`);
  for (const c of q.concepts) {
    const labels = Object.entries(c.alts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => topicLabel(t));
    parts.push(`${c.typed}: ${labels.join(' or ')}`);
  }
  if (q.band) parts.push(`seniority: ${q.band.label}`);
  if (q.company) parts.push(`company: ${q.company.typed}`);
  if (!parts.length) return criteria.slice(0, MAX_EXPANDED);
  const room = MAX_EXPANDED - criteria.length - 3;
  if (room < 10) return criteria.slice(0, MAX_EXPANDED);
  let extra = parts.join('; ');
  if (extra.length > room) extra = `${extra.slice(0, room - 1)}…`;
  return `${criteria} (${extra})`;
}

/**
 * Local relevance pass + relationship bonus, in display order. terms is the
 * relevance tier, so compareRanked (terms desc, then relevance + bonus desc)
 * lets the relationship bonus reorder only comparably relevant rows. The AI
 * pool is a prefix of this order.
 */
export function rankConnections(
  rows: Row[],
  criteria: string,
  strictTitleOnly: boolean,
  ctx: NetworkContext | null
): { expanded: string; roleQuery: boolean; ranked: RankedRow[] } {
  const index = getIndex(rows);
  const q = parseQuery(criteria, index);
  const roleQuery = q.concepts.some((c) => c.isRole) || q.band != null;
  const now = new Date();

  const noteTerms = new Set(wordsOf(q.noteQuery));
  const companyCache = new Map<CompanyInfo, number>();
  const scoreCache = new Map<Combined, Scored>();
  const ranked: RankedRow[] = [];

  /** The company facet for one row: depends only on its company and title (so on its combo). */
  const companyFor = (info: RowInfo): { sat: number; label: string } => {
    if (!q.company) return { sat: 0, label: '' };
    let sat = companyCache.get(info.company);
    if (sat == null) {
      sat = 0;
      for (const alt of q.company.alts) sat = Math.max(sat, companyMatchesClause(info.company, alt, true, q.caps));
      companyCache.set(info.company, sat);
    }
    if (sat === COMPANY_ALIAS) return { sat, label: `Company match (alias): ${info.company.name} for ${q.company.typed}` };
    if (sat > 0 && !q.company.alts.some((alt) => companyMatchesClause(info.company, alt, false) > 0)) {
      return { sat, label: `Company match (acronym): ${info.company.name} for ${q.company.typed}` };
    }
    if (sat > 0) return { sat, label: `Company match: ${info.company.name}` };
    const ti = info.titleInfo;
    if (q.company.alts.some((alt) => containsSeq(ti.roleWords, alt.map(stem)))) {
      return { sat: COMPANY_IN_TITLE, label: `Company mentioned in title: ${q.company.typed}` };
    }
    for (const ex of ti.exCompanies) {
      const pseudo = analyzeCompanyCached(ex);
      if (q.company.alts.some((alt) => companyMatchesClause(pseudo, alt, true, q.caps) > 0)) {
        return { sat: COMPANY_FORMER, label: `Former employer (from title): ${ex.join(' ')}` };
      }
    }
    return { sat: 0, label: '' };
  };

  for (let i = 0; i < index.infos.length; i++) {
    const info = index.infos[i];

    let noteHits: string[] = [];
    if (info.noteWords && noteTerms.size) {
      let any = false;
      for (const w of noteTerms) if (info.noteWords.has(w)) { any = true; break; }
      if (any) noteHits = noteMatches(getField(info.row, NOTE_KEYS), q.noteQuery);
    }

    // Rows sharing a title and company (and no note hit) score identically: score once per query.
    let s = noteHits.length ? undefined : scoreCache.get(info.combo);
    if (!s) {
      const co = companyFor(info);
      s = scoreRow(info, q, noteHits, co.sat, co.label);
      if (!noteHits.length) scoreCache.set(info.combo, s);
    }
    if (s.relevance <= 0) continue;
    if (roleQuery && strictTitleOnly && !s.titleHit) continue;

    const relevance = Math.max(1, Math.round(s.relevance));
    // A redundant note hit only breaks ties: it never lifts a row into a higher tier.
    const tier = Math.floor(Math.max(0, s.relevance - s.tieBreak) / TIER_WIDTH);
    const reasons = s.reasons.length ? [...s.reasons] : ['Matched your search'];
    if (roleQuery && !info.title.trim()) reasons.push('Note: this connection has no title in the CSV export.');
    const rel = relationshipFor(index, i, ctx, now);
    ranked.push({
      row: info.row,
      relevance,
      terms: tier,
      matchedTokens: s.matched.length ? [...s.matched] : [criteria.trim()],
      reasons: [...reasons, ...rel.reasons],
      score: relevance + rel.bonus,
      chips: rel.chips,
      aiSummary: rel.aiSummary,
    });
  }

  ranked.sort(compareRanked);
  return { expanded: describe(q, criteria), roleQuery, ranked };
}

const PSEUDO_COMPANIES = new Map<string, CompanyInfo>();
function analyzeCompanyCached(tokens: string[]): CompanyInfo {
  const key = tokens.join(' ');
  let c = PSEUDO_COMPANIES.get(key);
  if (!c) { c = analyzeCompany(key); PSEUDO_COMPANIES.set(key, c); }
  return c;
}

// Exported for tests / debugging only.
export { parseQuery as _parseQuery, getIndex as _getIndex, analyzeTitle as _analyzeTitle };
