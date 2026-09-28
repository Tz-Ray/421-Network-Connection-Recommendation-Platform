// CSV writing, date formatting and the two normalizers the importer's join
// rule documents (FORMAT.md 1.5). These are independent re-implementations of
// the documented rules, not imports of lib/linkedinExport.ts.

export const CRLF = '\r\n';

export function csvField(v, quoteAll = false) {
  const s = v == null ? '' : String(v);
  if (quoteAll || /[",\r\n]/.test(s) || /^\s|\s$/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvText(header, rows, { quoteAll = false, preamble = '', bom = false } = {}) {
  const lines = [header, ...rows].map((r) => r.map((f) => csvField(f, quoteAll)).join(','));
  return (bom ? '﻿' : '') + preamble + lines.join(CRLF) + CRLF;
}

// ---- dates (day numbers = days since 1970-01-01 UTC) ----
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86400000;

export function dn(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}
export function ymdOf(day) {
  const t = new Date(day * DAY_MS);
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}
const p2 = (n) => String(n).padStart(2, '0');
export function iso(day) {
  const [y, m, d] = ymdOf(day);
  return `${y}-${p2(m)}-${p2(d)}`;
}
export function monthStart(day) {
  const [y, m] = ymdOf(day);
  return dn(`${y}-${p2(m)}-01`);
}
/** "15 Sep 2026" (Connections.csv modern, Notes.csv). */
export function fmtDayMonYear(day) {
  const [y, m, d] = ymdOf(day);
  return `${p2(d)} ${MON[m - 1]} ${y}`;
}
/** "9/15/16" (legacy Connections.csv). */
export function fmtMdyShort(day) {
  const [y, m, d] = ymdOf(day);
  return `${m}/${d}/${p2(y % 100)}`;
}
/** "Sep 2026" (Positions.csv). */
export function fmtMonYear(day) {
  const [y, m] = ymdOf(day);
  return `${MON[m - 1]} ${y}`;
}
/** seconds since epoch -> "2026-08-14 17:23:45 UTC". */
export function fmtUtc(sec) {
  const t = new Date(sec * 1000);
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())} UTC`;
}
/** seconds -> "2026/08/01 10:00:00 UTC". */
export function fmtSlashUtc(sec) {
  return fmtUtc(sec).replace(/^(\d{4})-(\d{2})-(\d{2})/, '$1/$2/$3');
}
/** seconds -> "9/15/26, 5:23 PM". */
export function fmtShortDateTime(sec) {
  const t = new Date(sec * 1000);
  const h = t.getUTCHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()}/${p2(t.getUTCFullYear() % 100)}, ${h12}:${p2(t.getUTCMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}
export function dayOfSec(sec) {
  return Math.floor(sec / 86400);
}

// ---- normalizers (documented rules, FORMAT.md 1.5) ----
const PLACEHOLDER_RE = /^\[[a-z0-9]+\](?:\s+\[[a-z0-9]+\])*$/i;

export function normalizeProfileUrl(s) {
  if (typeof s !== 'string') return null;
  let t = s.trim().toLowerCase();
  if (!t || PLACEHOLDER_RE.test(t)) return null;
  t = t.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^\/\//, '');
  t = t.replace(/[?#].*$/, '').replace(/^www\./, '');
  const m = /^(?:[a-z]{2}\.)?linkedin\.com\/in\/([^/]+)/.exec(t);
  if (!m) return null;
  let slug = m[1];
  try {
    slug = decodeURIComponent(slug).toLowerCase();
  } catch {
    /* keep */
  }
  slug = slug.trim();
  return slug ? `linkedin.com/in/${slug}` : null;
}

export function normalizePersonName(s) {
  if (typeof s !== 'string') return '';
  const t = s.trim();
  if (!t || PLACEHOLDER_RE.test(t)) return '';
  return t
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function collapse(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

const FOLD = { ø: 'o', æ: 'ae', ß: 'ss', ł: 'l', đ: 'd', ı: 'i', œ: 'oe', þ: 'th', ð: 'd' };
/** ASCII slug fragment: "José-Luis O'Brien" -> "jose-luis-obrien". */
export function asciiSlug(s) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[øæßłđıœþð]/g, (c) => FOLD[c])
    .replace(/['"’.,]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
