import type { CompactConnection, ConnectionDoc } from './connectionsStore';
import type { RankedRow } from './search';
import { normalizeProfileUrl } from './linkedinExport.ts';

/** What a person id is made of: the same fields on a saved doc, an imported row or the compact session copy. */
export type PersonIdParts = {
  url?: string | null;
  name?: string | null;
  position?: string | null;
  company?: string | null;
};
const idText = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
/** FNV-1a (32 bit) in base 36: a short label for an id, not a security hash. */
function shortHash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
/**
 * UI identity only (selection and `?person=`); vote and favorite keys keep their own hashing rules.
 * A row's normalized profile URL, else a short hash of its name, title and company; repeats get `~2`,
 * `~3`, ... in list order. Every row gets its own id, and the id does not depend on the order the list
 * was loaded in (an import file and Firestore order the same people differently), so a link made from
 * one screen's copy of the connections opens the same person on another screen.
 */
export function personIds<T>(rows: readonly T[], parts: (row: T) => PersonIdParts): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const p = parts(row);
    const name = idText(p.name) === '(no name)' ? '' : idText(p.name);
    const base =
      normalizeProfileUrl(p.url || '') ||
      `p-${shortHash(`${name}|${idText(p.position)}|${idText(p.company)}`)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base}~${n}` : base;
  });
}
export const docIdParts = (d: ConnectionDoc): PersonIdParts => ({
  url: d.url,
  name: personName(d),
  position: d.position,
  company: d.company,
});
export const compactIdParts = (c: CompactConnection): PersonIdParts => ({
  url: c.url,
  name: c.name,
  position: c.position,
  company: c.company,
});

export const initials = (name: string) =>
  (name === '(no name)' ? '' : name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase() || '?';
export const personName = (d: ConnectionDoc) =>
  d.fullName || `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim() || '(no name)';
export function dateLabel(date: string | null | undefined, monthOnly = false) {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    ...(monthOnly ? {} : { day: 'numeric' as const }),
    year: 'numeric',
    timeZone: 'UTC',
  });
}
const sentence = (text: string) => {
  const clean = text.trim().replace(/[.;]+$/, '');
  return clean ? clean[0].toUpperCase() + clean.slice(1) + '.' : '';
};
/** Every recorded relationship fact, without the compact row's two-fact limit. */
export function relationshipFacts(reason: string, chip = ''): string[] {
  return reason
    .replace(/^Relationship:\s*/i, '')
    .split(/;\s*/)
    .flatMap((raw) => {
      const fact = raw.trim();
      if (!fact || fact.toLowerCase() === chip.toLowerCase()) return [];
      if (chip === 'Former colleague' && /^works at your former employer/i.test(fact)) return [];
      if (chip === 'Target company' && /^at a company on your target list/i.test(fact)) return [];
      if (/msgs?|messages?|last contact/i.test(chip) && /messag|last contact/i.test(fact))
        return /two-way/i.test(fact) ? ['You have written both ways.'] : [];
      return [
        sentence(
          fact
            .replace(/two-way(?: messages)?/i, 'you have written both ways')
            .replace(/recommended you/i, 'wrote you a recommendation'),
        ),
      ];
    });
}
export function plainRelationship(reason: string, chip = '') {
  return relationshipFacts(reason, chip).slice(0, 2).join(' ');
}

const quote = (s: string) => `“${s.trim().replace(/^"|"$/g, '')}”`;
const quoteList = (list: string) =>
  list
    .split(/,\s*/)
    .filter(Boolean)
    .map(quote)
    .join(', ')
    .replace(/, ([^,]*)$/, ' and $1');
/** "cmo = chief medical officer" -> “CMO” (chief medical officer). */
const abbreviation = (sense: string) => {
  const [short, ...long] = sense.split(' = ');
  return long.length ? `${quote(short.toUpperCase())} (${long.join(' = ')})` : quote(sense);
};
/**
 * One ranking reason from lib/search.ts (or the semantic pass) in plain words. Only rewords the facts
 * the reason already states; unknown formats are passed through as a sentence.
 */
export function plainReason(reason: string): string {
  const r = reason.trim();
  let m: RegExpMatchArray | null;
  if (/^(Moved up|Moved down|Added):/.test(r)) return sentence(r);
  if (r.startsWith('Relationship:')) return relationshipFacts(r).join(' ');
  if ((m = r.match(/^AI:\s*(.*)$/))) return `AI: ${sentence(m[1])}`;
  if (r.startsWith('Semantic match:')) return 'Similar in meaning to your search.';
  if ((m = r.match(/^Fuzzy match: (.+)$/))) return `Matched ${m[1].replace(/"([^"]+)"/g, '“$1”')}.`;
  if ((m = r.match(/^Title phrase match \(abbreviation\): "([^"]+)"/)))
    return `Title has an abbreviation for ${quote(m[1])}.`;
  if ((m = r.match(/^Title phrase match: "([^"]+)"$/))) return `Title fits ${quote(m[1])}.`;
  if ((m = r.match(/^Title match: (.+)$/))) return `Title fits ${quoteList(m[1])}.`;
  if ((m = r.match(/^Title match \(word form\): (.+)$/))) return `Title uses a form of ${quoteList(m[1])}.`;
  if ((m = r.match(/^Title match \(abbreviation\): (.+)$/)))
    return `Title has an abbreviation for ${quoteList(m[1])}.`;
  if ((m = r.match(/^Title match \(abbreviation: (.+?)\)(?: for .+)?$/)))
    return `Title has ${abbreviation(m[1])}.`;
  if ((m = r.match(/^Title match \(acronym\): (.+?) = (.+)$/)))
    return `Title has ${quote(m[2])}, which matches ${quote(m[1])}.`;
  if ((m = r.match(/^Title match \(synonym\): "([^"]+)" for (.+)$/)))
    return `${quote(m[1])} is another name for ${quote(m[2])}.`;
  if ((m = r.match(/^Similar role \(synonym or sibling of (.+)\): "([^"]+)"/)))
    return `${quote(m[2])} is a role similar to ${quote(m[1])}.`;
  if ((m = r.match(/^Related role: "([^"]+)" \(.*\) is related to (.+)$/)))
    return `${quote(m[1])} is a role related to ${quote(m[2])}.`;
  if ((m = r.match(/^Related role \(abbreviation: (.+?)\): .* is related to (.+)$/)))
    return `Title has ${abbreviation(m[1])}, a role related to ${quote(m[2])}.`;
  if ((m = r.match(/^Role from employer: "([^"]+)" at (.+?) → (.+?)(?:, related to (.+))?$/)))
    return `${quote(m[1])} at ${m[2]} counts as ${m[3].toLowerCase()}${m[4] ? `, related to ${quote(m[4])}` : ''}.`;
  if ((m = r.match(/^Industry match \(company\): (.+?) → (.+?)(?:, related to (.+))?$/)))
    return `Works at ${m[1]}, a ${m[2].toLowerCase()} company${m[3] ? `, related to ${quote(m[3])}` : ''}.`;
  if ((m = r.match(/^Weak match: "([^"]+)" at (.+?) is a different role/)))
    return `${quote(m[1])} at ${m[2]} is a different role.`;
  if ((m = r.match(/^Weak match: (.+) means a different role at (.+)$/)))
    return `${quoteList(m[1])} means a different role at ${m[2]}.`;
  if ((m = r.match(/^Title mentions "([^"]+)" as a specialty, not the role/)))
    return `Title mentions ${quote(m[1])} as a specialty, not the role.`;
  if ((m = r.match(/^Title mentions \(as a specialty, not the role\): (.+)$/)))
    return `Title mentions ${quoteList(m[1])} as a specialty, not the role.`;
  if ((m = r.match(/^Weak match \(company-only\): alias (.+?) for (.+)$/)))
    return `Only the company matches: ${m[1]} (${quote(m[2])}).`;
  if ((m = r.match(/^Weak match \(company-only\): (.+)$/))) return `Only the company matches: ${m[1]}.`;
  if ((m = r.match(/^Weak match \(company name\): (.+)$/))) return `Only the company name matches: ${m[1]}.`;
  if ((m = r.match(/^Company match(?: \((?:alias|acronym)\))?: (.+?)(?: for (.+))?$/)))
    return `Works at ${m[1]}${m[2] ? ` (${quote(m[2])})` : ''}.`;
  if ((m = r.match(/^Company mentioned in title: (.+)$/))) return `Title mentions ${quote(m[1])}.`;
  if ((m = r.match(/^Former employer \(from title\): (.+)$/)))
    return `Title mentions a former employer: ${m[1]}.`;
  if ((m = r.match(/^Can help you (.+?): "([^"]+)"/))) return `Can help you ${m[1]}: ${quote(m[2])}.`;
  if ((m = r.match(/^Seniority match: (.+)$/))) return `Seniority fits: ${m[1]}.`;
  if ((m = r.match(/^Seniority close: (.+?) \(asked (.+)\)$/)))
    return `Seniority is close: ${m[1]}; you asked for ${m[2]}.`;
  if ((m = r.match(/^Note match: (.+)$/))) return `Your note mentions ${quoteList(m[1])}.`;
  if (/^Note: this connection has no title/.test(r)) return 'No job title in the export.';
  return sentence(r);
}
const PARTIAL =
  /synonym|word form|weak|partial|related|close|specialty|Role from employer|Industry match|Fuzzy|Semantic/i;
/** The one plain "why" line under a result row (never repeats its chip). */
export function rowWhy(row: RankedRow) {
  // The row shows one chip: the first relationship chip, else "Semantic match".
  const relationshipChip = row.chips.find((c) => c !== 'Semantic match') || '';
  const relationship = row.reasons.find((r) => r.startsWith('Relationship:'));
  if (relationship) {
    const line = plainRelationship(relationship, relationshipChip);
    if (line) return line;
  }
  const semanticChip = !relationshipChip && row.chips.includes('Semantic match');
  const reasons = row.reasons.filter(
    (r) =>
      !/^(Moved |Added:|AI:|Relationship:)/.test(r) && !(semanticChip && r.startsWith('Semantic match:')),
  );
  const partial = reasons.find((r) => PARTIAL.test(r));
  if (partial) return plainReason(partial);
  const reason = reasons[0];
  if (!reason) return '';
  // A full title match is visible in the title line itself.
  return /^Title (?:phrase )?match\b/.test(reason) ? 'Matches your search.' : plainReason(reason);
}
/** Merge repeated title evidence while preserving partial-match and voting qualifications. */
export function detailReasons(row: RankedRow): string[] {
  const exact = row.reasons.filter((r) => /^Title (?:phrase )?match:/.test(r));
  const phrases = exact
    .filter((r) => /^Title phrase/.test(r))
    .map((r) => r.match(/"([^"]+)"/)?.[1])
    .filter((t): t is string => !!t);
  const words = exact
    .filter((r) => /^Title match:/.test(r))
    .flatMap((r) => r.slice(r.indexOf(': ') + 2).split(/,\s*/));
  const terms = phrases.length ? phrases : [...new Set(words)];
  const lines = terms.length ? [`Title fits ${terms.map(quote).join(' and ')}.`] : [];
  const abbreviated = row.reasons
    .filter((r) => /^Title phrase match \(abbreviation\):/.test(r))
    .map((r) => r.match(/"([^"]+)"/)?.[1])
    .filter((t): t is string => !!t);
  for (const reason of row.reasons) {
    if (exact.includes(reason)) continue;
    // A word-form or abbreviation fact already contained in a phrase line adds no new evidence.
    const covered = /^Title match \(word form\):/.test(reason)
      ? terms
      : /^Title match \(abbreviation\):/.test(reason)
        ? abbreviated
        : null;
    if (
      covered &&
      reason
        .slice(reason.indexOf(': ') + 2)
        .split(/,\s*/)
        .every((w) => covered.some((t) => t.includes(w)))
    )
      continue;
    if (reason.startsWith('Relationship:')) lines.push(...relationshipFacts(reason));
    else lines.push(plainReason(reason));
  }
  return [...new Set(lines)].filter(Boolean);
}
