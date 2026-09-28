// "New analytics" datasets: a LinkedIn "Get a copy of your data" zip per owner,
// plus the expected importer output computed from the generator's own truth
// model by the counting rules in FORMAT.md (never by calling lib/*.ts).

import { Rng } from './rng.mjs';
import {
  asciiSlug, collapse, csvText, dayOfSec, fmtDayMonYear, fmtMonYear, fmtShortDateTime, fmtSlashUtc, fmtUtc,
  iso, normalizePersonName, normalizeProfileUrl, ymdOf,
} from './text.mjs';
import { activePosition, latestOverlap } from './universe.mjs';

export const CONNECTIONS_PREAMBLE =
  'Notes:\r\n' +
  '"When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who have allowed their connections to see or download their email address using this setting https://www.linkedin.com/psettings/privacy/email. You can learn more here https://www.linkedin.com/help/linkedin/answer/261"\r\n' +
  '\r\n';

export const CONNECTIONS_HEADER = ['First Name', 'Last Name', 'URL', 'Email Address', 'Company', 'Position', 'Connected On'];
export const LEGACY_HEADER = ['First Name', 'Last Name', 'Email Address', 'Company', 'Position', 'Connected On'];

const WHITELIST = [
  ['connections', 'connections.csv'], ['messages', 'messages.csv'], ['invitations', 'invitations.csv'],
  ['notes', 'notes.csv'], ['endorsements', 'endorsement_received_info.csv'],
  ['recommendations', 'recommendations_received.csv'], ['profile', 'profile.csv'], ['positions', 'positions.csv'],
  ['education', 'education.csv'], ['skills', 'skills.csv'], ['follows', 'company follows.csv'],
  ['applications', 'job applications.csv'], ['savedJobs', 'saved jobs.csv'], ['preferences', 'job seeker preferences.csv'],
];
export const NETWORK_CONTEXT_CAPS = {
  positions: 30, schools: 10, skills: 50, followedCompanies: 200,
  appliedCompanies: 100, appliedTitles: 100, dreamCompanies: 50, desiredTitles: 50,
};
const MAX_THREAD_PARTICIPANTS = 5;
// Positions.csv Location per community: the metro area only for single-metro communities (a company's real
// campus may be anywhere in it); multi-city communities (LDN_RETAIL, TOR_ACADEMIA, HOU_ENERGY) leave it blank.
const METRO_AREA = {
  SEA_TECH: 'Greater Seattle Area',
  SF_FINTECH: 'San Francisco Bay Area',
  NYC_FINANCE: 'New York City Metropolitan Area',
  BOS_HEALTH: 'Greater Boston',
  CHI_CONSULT: 'Greater Chicago Area',
  DC_POLICY: 'Washington DC-Baltimore Area',
  LA_MEDIA: 'Greater Los Angeles Area',
};
const MAX_NOTE_CHARS = 500;

const SPONSORED_TEXT = [
  'Hi {firstName}, you are invited to our executive roundtable on {topic}. Reserve your seat today.',
  'Hi {firstName}, see how teams like yours are rethinking {topic} in 2026. Download the report.',
  '{firstName}, join our virtual summit on {topic} next month. Registration is free.',
];
const GROUP_TITLES = ['Offsite planning', 'Reunion planning', 'Hiring panel', 'Conference dinner', 'Book club', 'Q3 planning', 'Alumni meetup', 'Project sync', 'Panel prep', 'Launch retro'];

function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
}

/** Mirror of the importer's case-insensitive capped unique list (documented rule). */
function uniqueList(cap) {
  const items = [];
  const seen = new Set();
  return {
    items,
    add(value) {
      const v = collapse(value);
      if (!v || items.length >= cap) return;
      const key = v.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      items.push(v);
    },
  };
}
function splitList(s) {
  const sep = s.includes(';') ? ';' : ',';
  return s.split(sep).map((x) => x.trim()).filter(Boolean);
}

export function buildFullExport(W, pools, d, ctx) {
  const { byId, seed, ownerIds, sets } = ctx;
  const O = d.owner;
  const E = d.exportDay;
  const Eend = E * 86400 + 8 * 3600;
  const opts = d.opts;
  const rng = new Rng(seed, `full-${d.id}`);
  const files = []; // {path, text, whitelisted}
  const [ey, em, edd] = ymdOf(E);
  const prefix = opts.nested ? `Complete_LinkedInDataExport_${String(em).padStart(2, '0')}-${String(edd).padStart(2, '0')}-${ey}/` : '';
  const conns = d.rows;
  const connIds = sets.get(d.id);
  const idxOf = new Map(conns.map((r, i) => [r.person.id, i]));
  const nonConnections = [...byId.values()].filter((p) => !connIds.has(p.id) && p.id !== O.id && !ownerIds.has(p.id));
  const topicOf = () => rng.pick(pools.noteTopics);
  const compOf = (p, day) => (activePosition(p, day) || p.positions[p.positions.length - 1]).companyName;

  // ---------------- Connections.csv ----------------
  const connRows = conns.map((r) => [r.person.first, r.person.last, r.person.url, r.person.email || '', r.company, r.position, fmtDayMonYear(r.connectedOn)]);
  files.push({ path: `${prefix}Connections.csv`, text: csvText(CONNECTIONS_HEADER, connRows, { preamble: CONNECTIONS_PREAMBLE }), id: 'connections', rows: connRows.length });

  // join index over the rows exactly as written
  const urlIndex = new Map();
  const nameIndex = new Map();
  conns.forEach((r, i) => {
    const u = normalizeProfileUrl(r.person.url);
    if (u && !urlIndex.has(u)) urlIndex.set(u, i);
    const n = normalizePersonName(`${r.person.first} ${r.person.last}`.trim());
    if (n) {
      if (!nameIndex.has(n)) nameIndex.set(n, []);
      nameIndex.get(n).push(i);
    }
  });
  const join = (urlStr, name) => {
    const u = normalizeProfileUrl(urlStr || '');
    if (u) return urlIndex.has(u) ? urlIndex.get(u) : null;
    const n = normalizePersonName(name || '');
    if (!n) return null;
    const list = nameIndex.get(n);
    return list && list.length === 1 ? list[0] : null;
  };
  const dupNamePeople = conns.filter((r) => nameIndex.get(normalizePersonName(r.person.fullName)).length > 1).map((r) => r.person);
  const edgeNotes = [];

  // ---------------- messages.csv ----------------
  let msg = null;
  if (!opts.noMessages) {
    msg = buildMessages(W, pools, d, { rng, conns, nonConnections, idxOf, Eend, topicOf, compOf, ownerIds });
    const header = ['CONVERSATION ID', 'CONVERSATION TITLE', 'FROM', 'SENDER PROFILE URL', 'TO', 'RECIPIENT PROFILE URLS', 'DATE', 'SUBJECT', 'CONTENT', 'FOLDER', 'ATTACHMENTS'];
    if (opts.draftColumn) header.push('IS MESSAGE DRAFT');
    const out = [];
    for (const c of msg.convs) {
      for (const r of c.rows) {
        const line = [c.id, c.title, r.fromName, r.senderUrl, r.toNames.join('; '), r.recipientUrls.join(';'), fmtUtc(r.sec), r.subject, r.content, r.folder, ''];
        if (opts.draftColumn) line.push(r.draft ? 'TRUE' : 'FALSE');
        out.push(line);
      }
    }
    files.push({ path: `${prefix}messages.csv`, text: csvText(header, out, { quoteAll: true }), id: 'messages', rows: out.length });
    edgeNotes.push(...msg.notes);
  }

  // ---------------- Invitations.csv ----------------
  const inv = buildInvitations(pools, d, { rng, conns, nonConnections, dupNamePeople, E });
  files.push({ path: `${prefix}Invitations.csv`, text: csvText(['From', 'To', 'Sent At', 'Message', 'Direction', 'inviterProfileUrl', 'inviteeProfileUrl'], inv.rows.map((r) => [r.from, r.to, fmtShortDateTime(r.sec), r.message, r.direction, r.inviterUrl, r.inviteeUrl])), id: 'invitations', rows: inv.rows.length });

  // ---------------- Notes / endorsements / recommendations ----------------
  let notes = null;
  let endorse = null;
  let recs = null;
  if (!opts.basic) {
    notes = buildNotes(pools, d, { rng, conns, nonConnections, dupNamePeople, E, compOf });
    files.push({ path: `${prefix}Notes.csv`, text: csvText(['Connection First Name', 'Connection Last Name', 'Connection Profile URL', 'Note', 'Created On', 'Edited On'], notes.rows.map((r) => [r.first, r.last, r.url, r.note, fmtDayMonYear(r.created), r.edited == null ? '' : fmtDayMonYear(r.edited)])), id: 'notes', rows: notes.rows.length });
    endorse = buildEndorsements(d, { rng, conns, nonConnections, E });
    files.push({ path: `${prefix}Endorsement_Received_Info.csv`, text: csvText(['Endorsement Date', 'Skill Name', 'Endorser First Name', 'Endorser Last Name', 'Endorser Public Url', 'Endorsement Status'], endorse.rows.map((r) => [fmtSlashUtc(r.sec), r.skill, r.first, r.last, r.url, r.status])), id: 'endorsements', rows: endorse.rows.length });
    recs = buildRecommendations(pools, d, { rng, conns, nonConnections, dupNamePeople, E });
    files.push({ path: `${prefix}Recommendations_Received.csv`, text: csvText(['First Name', 'Last Name', 'Company', 'Job Title', 'Text', 'Creation Date', 'Status'], recs.rows.map((r) => [r.first, r.last, r.company, r.title, r.text, iso(r.day), r.status])), id: 'recommendations', rows: recs.rows.length });
  }

  // ---------------- owner files ----------------
  const own = buildOwnerFiles(W, pools, d, { rng, E, prefix });
  files.push(...own.files);

  // ---------------- files the importer must skip ----------------
  const skip = buildSkipFiles(W, d, { rng, E, prefix });
  files.push(...skip);

  // =============== expected (documented counting rules) ===============
  const expected = { rows: conns.map((r) => ({
    personId: r.person.id, url: r.person.url, firstName: r.person.first, lastName: r.person.last,
    email: r.person.email || '', company: r.company.trim(), position: r.position.trim(), connectedOnIso: iso(r.connectedOn),
  })) };

  // messages
  let ownerDetected = null;
  const warnings = [];
  let msgAcc = null;
  if (msg) {
    const ownerNameKey = normalizePersonName(collapse(`${O.first} ${O.last}`)) || null;
    const ownerUrl = detectOwner(msg.convs, urlIndex, ownerNameKey);
    if (!ownerUrl && !ownerNameKey) {
      ownerDetected = false;
      warnings.push('Could not tell which messages are yours; message history was not used');
    } else {
      ownerDetected = true;
      msgAcc = countMessages(msg.convs, { ownerUrl, ownerNameKey, urlIndex, join, n: conns.length });
    }
    expected.ownerDetectedVia = ownerUrl ? 'url' : ownerNameKey ? 'profile-name' : null;
  }
  // invitations: the latest dated qualifying row wins
  const invMap = new Map();
  for (const r of inv.rows) {
    const idx = r.direction === 'INCOMING' ? join(r.inviterUrl, r.from) : join(r.inviteeUrl, r.to);
    if (idx == null) continue;
    const at = iso(dayOfSec(r.sec));
    const prev = invMap.get(idx);
    if (!prev || !prev.at || at > prev.at) invMap.set(idx, { kind: r.direction === 'INCOMING' ? 'incoming' : 'outgoing', at });
  }
  // notes: concatenated per connection, collapsed, capped
  const noteMap = new Map();
  if (notes) {
    for (const r of notes.rows) {
      const note = collapse(r.note);
      if (!note) continue;
      const idx = join(r.url, `${r.first} ${r.last}`.trim());
      if (idx == null) continue;
      const prev = noteMap.get(idx);
      noteMap.set(idx, (prev ? `${prev} ${note}` : note).slice(0, MAX_NOTE_CHARS).trim());
    }
  }
  let endorseCounts = null;
  if (endorse) {
    endorseCounts = conns.map(() => 0);
    for (const r of endorse.rows) {
      r.counted = false;
      if (r.status.toUpperCase() !== 'ACCEPTED') continue;
      const idx = join(r.url, `${r.first} ${r.last}`.trim());
      if (idx != null) {
        endorseCounts[idx] += 1;
        r.counted = true;
      }
    }
  }
  let recommended = null;
  if (recs) {
    recommended = conns.map(() => false);
    for (const r of recs.rows) {
      if (r.status.toUpperCase() !== 'VISIBLE') continue;
      const idx = join(null, `${r.first} ${r.last}`.trim());
      if (idx != null) recommended[idx] = true;
    }
  }
  expected.rows.forEach((row, i) => {
    if (msgAcc) {
      const a = msgAcc[i];
      row.messageCount = a.count;
      row.messagesSent = a.sent;
      row.messagesReceived = a.received;
      if (a.last) row.lastMessagedAt = a.last;
      if (a.first) row.firstMessagedAt = a.first;
    }
    const iv = invMap.get(i);
    if (iv) {
      row.invitation = iv.kind;
      if (iv.at) row.invitedAt = iv.at;
    }
    if (noteMap.has(i)) row.note = noteMap.get(i);
    if (endorseCounts) row.endorsementCount = endorseCounts[i];
    if (recommended) row.recommendedYou = recommended[i];
  });

  // files used / skipped
  const filesUsed = [];
  for (const [id] of WHITELIST) {
    const f = files.find((x) => x.id === id);
    if (f) filesUsed.push({ name: f.path.split('/').pop(), rows: f.rows });
  }
  const filesSkipped = files.filter((f) => !f.id).map((f) => f.path.split('/').pop())
    .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));

  const summary = {
    connections: conns.length,
    filesUsed,
    filesSkipped,
    ownerDetected,
    matched: {
      messages: msgAcc ? msgAcc.filter((a) => a.count > 0).length : 0,
      invitations: invMap.size,
      notes: noteMap.size,
      endorsements: endorseCounts ? endorseCounts.filter((x) => x > 0).length : 0,
      recommendations: recommended ? recommended.filter(Boolean).length : 0,
    },
    warnings,
  };

  return {
    files,
    summary,
    context: own.context,
    rows: expected.rows,
    ownerDetectedVia: expected.ownerDetectedVia ?? null,
    endorsementRows: endorse ? endorse.rows : [],
    edgeNotes: [...edgeNotes, ...inv.notes, ...(notes ? notes.notes : []), ...(recs ? recs.notes : []), ...own.notes],
  };
}

// ---------------------------------------------------------------------------
// messages.csv
// ---------------------------------------------------------------------------

function heavyTail(rng) {
  const r = rng.next();
  if (r < 0.32) return 1;
  if (r < 0.6) return rng.int(2, 3);
  if (r < 0.84) return rng.int(4, 9);
  if (r < 0.96) return rng.int(10, 30);
  if (r < 0.992) return rng.int(31, 80);
  return rng.int(81, 300);
}

function timeline(rng, n, lo, hi) {
  const meanGap = rng.pick([3 * 3600, 86400, 3 * 86400, 10 * 86400, 30 * 86400]);
  const start = lo + Math.floor(rng.next() * Math.max(1, (hi - lo) * 0.7));
  const out = [start];
  for (let i = 1; i < n; i++) out.push(out[i - 1] + 60 + Math.floor(rng.expo(meanGap)));
  const last = out[n - 1];
  const end = Math.max(start + n, hi - Math.floor(rng.expo(12 * 86400)));
  if (last > end) {
    const scale = (end - start) / Math.max(1, last - start);
    for (let i = 0; i < n; i++) out[i] = start + Math.floor((out[i] - start) * scale);
  }
  for (let i = 1; i < n; i++) if (out[i] <= out[i - 1]) out[i] = out[i - 1] + 1;
  return out.map((t) => Math.min(t, hi));
}

function buildMessages(W, pools, d, c) {
  const { rng, conns, nonConnections, Eend, topicOf, compOf } = c;
  const O = d.owner;
  const opts = d.opts;
  const noOwnerUrl = !!opts.ownerUrlAbsent;
  const ownerUrl = noOwnerUrl ? '' : O.urlLower;
  const n = conns.length;
  const notes = [];
  const usedIds = new Set();
  const convId = () => {
    for (;;) {
      const id = `2-${rng.base64ish(46)}==`;
      if (!usedIds.has(id)) {
        usedIds.add(id);
        return id;
      }
    }
  };
  const P = (p) => ({ name: p.fullName, url: p.urlLower, person: p });
  const OWN = { name: O.fullName, url: ownerUrl, person: O };
  const mkRow = (from, to, sec, content, extra = {}) => ({
    fromName: from.name,
    senderUrl: from.url,
    toNames: to.map((t) => t.name),
    recipientUrls: to.map((t) => t.url).filter(Boolean),
    sec,
    subject: extra.subject || '',
    content,
    folder: extra.folder || 'INBOX',
    draft: !!extra.draft,
    fromPerson: from.person || null,
  });
  const convs = [];
  const lowOf = (day) => Math.max(day * 86400 + 3600, Eend - 5 * 365 * 86400);
  const clampLo = (lo) => Math.min(lo, Eend - 7200);

  // 1:1 threads
  const q = rng.uniform(0.18, 0.32);
  const messaged = rng.sampleWeighted(conns, Math.round(q * n), (r) =>
    r.person.sociability * (latestOverlap(O, r.person, d.exportDay) ? 2 : 1) * (r.connectedOn > d.exportDay - 3 * 365 ? 1.5 : 1));
  const bigCount = n >= 300 ? 3 : 1;
  const big = new Set(messaged.slice(0, bigCount).map((r) => r.person.id));
  const oneToOne = [];
  for (const r of messaged) {
    const p = r.person;
    const them = P(p);
    const nMsgs = big.has(p.id) ? (n >= 300 ? rng.int(50, 300) : rng.int(50, 90)) : heavyTail(rng);
    const pat = nMsgs === 1 ? (rng.chance(0.4) ? 'owner' : 'them') : nMsgs > 12 ? 'two' : rng.weightedKey({ two: 0.62, owner: 0.16, them: 0.22 });
    const times = timeline(rng, nMsgs, clampLo(lowOf(r.connectedOn)), Eend);
    let fromOwner = pat === 'owner' ? true : pat === 'them' ? false : rng.chance(0.55);
    const senders = [];
    for (let i = 0; i < nMsgs; i++) {
      senders.push(fromOwner);
      if (pat === 'two' && rng.chance(0.6)) fromOwner = !fromOwner;
    }
    if (pat === 'two' && senders.every((s) => s === senders[0])) senders[nMsgs - 1] = !senders[0];
    const rows = times.map((t, i) => {
      const own = senders[i];
      const kind = i === 0 ? 'opener' : rng.chance(0.25) ? 'followup' : 'reply';
      let text = fill(rng.pick(pools.messageSnippets[kind]), { firstName: own ? p.first : O.first, company: compOf(own ? p : O, dayOfSec(t)), topic: topicOf() });
      if (rng.chance(0.05)) text += `\n\nBest,\n${own ? O.first : p.first}`;
      return mkRow(own ? OWN : them, own ? [them] : [OWN], t, text, { subject: i === 0 && rng.chance(0.35) ? rng.pick(pools.messageSubjects) : '' });
    });
    const conv = { id: convId(), title: '', rows, kind: 'one-to-one', with: p.id };
    convs.push(conv);
    oneToOne.push(conv);
  }
  const messagedIds = new Set(messaged.map((r) => r.person.id));

  // small group threads (3-5 participants including the owner)
  const nGroups = Math.max(2, Math.round(n * 0.012));
  for (let g = 0; g < nGroups; g++) {
    const k = rng.int(2, 4);
    const members = rng.sampleWeighted(conns, k, (r) => r.person.sociability);
    const lo = clampLo(Math.max(...members.map((r) => lowOf(r.connectedOn))));
    const everyone = [OWN, ...members.map((r) => P(r.person))];
    const times = timeline(rng, rng.int(3, 16), lo, Eend);
    const rows = times.map((t) => {
      const from = rng.pick(everyone);
      const to = everyone.filter((x) => x !== from);
      return mkRow(from, to, t, fill(rng.pick(pools.messageSnippets.group), { firstName: to[0].person.first, company: compOf(from.person, dayOfSec(t)), topic: topicOf() }));
    });
    convs.push({ id: convId(), title: rng.pick(GROUP_TITLES), rows, kind: 'group' });
  }

  // large group threads (> 5 non-owner participants: ignored by the importer)
  const nLarge = rng.int(1, 3);
  for (let g = 0; g < nLarge; g++) {
    const k = rng.int(6, 9);
    const members = rng.sampleWeighted(conns, k, (r) => r.person.sociability).map((r) => P(r.person));
    const outsiders = noOwnerUrl ? [] : rng.sampleWeighted(nonConnections, rng.int(0, 2), (p) => p.sociability).map(P);
    const everyone = [OWN, ...members, ...outsiders];
    const times = timeline(rng, rng.int(3, 12), Eend - 400 * 86400, Eend);
    const rows = times.map((t) => {
      const from = rng.pick(everyone);
      const to = everyone.filter((x) => x !== from);
      return mkRow(from, to, t, fill(rng.pick(pools.messageSnippets.group), { firstName: to[0].person.first, company: '', topic: topicOf() }));
    });
    convs.push({ id: convId(), title: rng.pick(GROUP_TITLES), rows, kind: 'large-group', participants: members.length + outsiders.length });
  }
  notes.push({ kind: 'large-group-threads', count: nLarge });

  // recruiter / InMail threads from non-connections (distinct senders)
  const nInmail = Math.max(3, Math.round(n * 0.01));
  const inmailSenders = rng.sampleWeighted(nonConnections, nInmail, (p) => p.sociability * (p.functionId === 'hr_recruiting' ? 6 : 1));
  const usedOutsiders = new Set(inmailSenders.map((p) => p.id));
  for (const s of inmailSenders) {
    const from = P(s);
    const t0 = Eend - Math.floor(rng.next() * 700 * 86400);
    const rows = [mkRow(from, [OWN], t0, fill(rng.pick(pools.messageSnippets.recruiter), { firstName: O.first, company: compOf(s, dayOfSec(t0)), topic: topicOf() }), { subject: rng.pick(pools.messageSubjects) })];
    if (rng.chance(0.35)) {
      const t1 = Math.min(Eend, t0 + rng.int(3600, 5 * 86400));
      rows.push(mkRow(OWN, [from], t1, fill(rng.pick(pools.messageSnippets.reply), { firstName: s.first })));
    }
    convs.push({ id: convId(), title: '', rows, kind: 'inmail' });
  }

  // sponsored messages (company senders, no /in/ URL)
  const nSponsored = rng.int(2, 3);
  const sponsors = rng.sampleWeighted(W.companies.filter((x) => !x.generic), nSponsored, () => 1);
  for (const co of sponsors) {
    const from = { name: co.name, url: `https://www.linkedin.com/company/${asciiSlug(co.name)}/`, person: null };
    const t0 = Eend - Math.floor(rng.next() * 500 * 86400);
    convs.push({ id: convId(), title: '', rows: [mkRow(from, [OWN], t0, fill(rng.pick(SPONSORED_TEXT), { firstName: O.first, topic: topicOf() }), { subject: `Sponsored: ${co.name}` })], kind: 'sponsored' });
  }

  // SPAM folder threads
  if (opts.spam || opts.spamFromConnection) {
    const nSpam = rng.int(2, 4);
    const spammers = rng.sampleWeighted(nonConnections.filter((p) => !usedOutsiders.has(p.id)), nSpam, (p) => p.sociability);
    for (const s of spammers) {
      usedOutsiders.add(s.id);
      const t0 = Eend - Math.floor(rng.next() * 300 * 86400);
      convs.push({ id: convId(), title: '', rows: [mkRow(P(s), [OWN], t0, `Hi ${O.first}, quick opportunity to earn passive income from home. Reply YES for details.`, { folder: 'SPAM' })], kind: 'spam' });
    }
    notes.push({ kind: 'spam-threads', count: nSpam });
  }
  if (opts.spamFromConnection) {
    const quiet = conns.filter((r) => !messagedIds.has(r.person.id));
    const pickQuiet = rng.sampleWeighted(quiet, 2, (r) => r.person.sociability);
    const pickLoud = rng.sampleWeighted(messaged, 1, (r) => r.person.sociability);
    for (const r of [...pickQuiet, ...pickLoud]) {
      const t0 = clampLo(Math.max(lowOf(r.connectedOn), Eend - 200 * 86400)) + 600;
      convs.push({ id: convId(), title: '', rows: [mkRow(P(r.person), [OWN], Math.min(Eend, t0), `Hi ${O.first}, check out this limited-time crypto offer!!`, { folder: 'SPAM' })], kind: 'spam-from-connection' });
    }
    notes.push({ kind: 'spam-from-connection', personIds: [...pickQuiet, ...pickLoud].map((r) => r.person.id) });
  }

  // unsent drafts (IS MESSAGE DRAFT = TRUE)
  if (opts.draftColumn) {
    const withDraft = rng.sampleWeighted(oneToOne, Math.min(8, oneToOne.length), () => 1);
    for (const conv of withDraft) {
      const last = Math.max(...conv.rows.map((r) => r.sec));
      if (last >= Eend - 60) continue;
      const person = conns[idxOfPerson(conns, conv.with)].person;
      conv.rows.push(mkRow(OWN, [P(person)], Math.min(Eend, last + rng.int(60, 3 * 86400)), `Hi ${person.first}, draft - still thinking about how to phrase this`, { draft: true }));
    }
    const quiet = conns.filter((r) => !messagedIds.has(r.person.id));
    const draftOnly = rng.sampleWeighted(quiet, 2, (r) => r.person.sociability);
    for (const r of draftOnly) {
      const t0 = clampLo(Math.max(lowOf(r.connectedOn), Eend - 90 * 86400)) + 300;
      convs.push({ id: convId(), title: '', rows: [mkRow(OWN, [P(r.person)], Math.min(Eend, t0), `Hi ${r.person.first}, `, { draft: true })], kind: 'draft-only' });
    }
    notes.push({ kind: 'drafts', draftOnlyPersonIds: draftOnly.map((r) => r.person.id) });
  }

  // newest conversation first, newest row first (LinkedIn's export order)
  for (const conv of convs) conv.rows.sort((a, b) => b.sec - a.sec);
  convs.sort((a, b) => (b.rows[0].sec - a.rows[0].sec) || (a.id < b.id ? -1 : 1));
  return { convs, notes };
}

function idxOfPerson(conns, id) {
  return conns.findIndex((r) => r.person.id === id);
}

/** Owner = the non-connection URL present in the most distinct conversations (FORMAT.md 1.7). */
function detectOwner(convs, urlIndex, ownerNameKey) {
  const convsByUrl = new Map();
  const kept = [];
  for (const c of convs) for (const r of c.rows) {
    if (r.draft || r.folder.toUpperCase() === 'SPAM') continue;
    kept.push({ conv: c.id, r });
    const urls = [normalizeProfileUrl(r.senderUrl), ...r.recipientUrls.map(normalizeProfileUrl)];
    for (const u of urls) {
      if (!u || urlIndex.has(u)) continue;
      if (!convsByUrl.has(u)) convsByUrl.set(u, new Set());
      convsByUrl.get(u).add(c.id);
    }
  }
  let best = 0;
  let tied = [];
  for (const [u, s] of convsByUrl) {
    if (s.size > best) { best = s.size; tied = [u]; } else if (s.size === best) tied.push(u);
  }
  if (tied.length === 1) return tied[0];
  if (tied.length === 0 || !ownerNameKey) return null;
  const agree = new Map();
  for (const { r } of kept) {
    const rec = [...new Set(r.recipientUrls.map(normalizeProfileUrl).filter(Boolean))];
    for (const u of tied) {
      const asSender = normalizeProfileUrl(r.senderUrl) === u && normalizePersonName(r.fromName) === ownerNameKey;
      const asRecipient = rec.length === 1 && rec[0] === u && r.toNames.length === 1 && normalizePersonName(r.toNames[0]) === ownerNameKey;
      if (asSender || asRecipient) agree.set(u, (agree.get(u) || 0) + 1);
    }
  }
  let top = 0;
  let winners = [];
  for (const [u, k] of agree) {
    if (k > top) { top = k; winners = [u]; } else if (k === top) winners.push(u);
  }
  return winners.length === 1 ? winners[0] : null;
}

/** Per-connection message aggregates by the documented thread rules (FORMAT.md 1.7). */
function countMessages(convs, { ownerUrl, ownerNameKey, urlIndex, join, n }) {
  const acc = Array.from({ length: n }, () => ({ count: 0, sent: 0, received: 0, first: null, last: null }));
  const ownerSent = (r) => {
    const su = normalizeProfileUrl(r.senderUrl);
    if (ownerUrl) return su === ownerUrl;
    return !su && normalizePersonName(r.fromName) === ownerNameKey;
  };
  for (const c of convs) {
    const kept = c.rows.filter((r) => !r.draft && r.folder.toUpperCase() !== 'SPAM');
    if (!kept.length) continue;
    const participants = new Set();
    for (const r of kept) {
      if (!ownerSent(r)) {
        const su = normalizeProfileUrl(r.senderUrl);
        participants.add(su || `name:${normalizePersonName(r.fromName)}`);
      }
      const rec = r.recipientUrls.map(normalizeProfileUrl).filter(Boolean);
      if (rec.length) {
        for (const u of rec) if (u !== ownerUrl) participants.add(u);
      } else {
        for (const t of r.toNames) {
          const k = normalizePersonName(t);
          if (k && k !== ownerNameKey) participants.add(`name:${k}`);
        }
      }
    }
    if (participants.size === 0 || participants.size > MAX_THREAD_PARTICIPANTS) continue;
    const oneToOne = participants.size === 1;
    for (const r of kept) {
      const sent = ownerSent(r);
      const targets = new Set();
      if (sent) {
        const rec = r.recipientUrls.map(normalizeProfileUrl).filter(Boolean);
        for (const u of rec) if (urlIndex.has(u)) targets.add(urlIndex.get(u));
        if (!rec.length && oneToOne) {
          const idx = join(null, r.toNames.join('; '));
          if (idx != null) targets.add(idx);
        }
      } else {
        const idx = join(r.senderUrl, r.fromName);
        if (idx != null) targets.add(idx);
      }
      const day = iso(dayOfSec(r.sec));
      for (const i of targets) {
        const a = acc[i];
        a.count += 1;
        if (oneToOne && sent) a.sent += 1;
        if (oneToOne && !sent) a.received += 1;
        if (!a.first || day < a.first) a.first = day;
        if (!a.last || day > a.last) a.last = day;
      }
    }
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Invitations.csv
// ---------------------------------------------------------------------------

function buildInvitations(pools, d, { rng, conns, nonConnections, dupNamePeople, E }) {
  const O = d.owner;
  const rows = [];
  const notes = [];
  const sec = (day) => day * 86400 + rng.int(8, 21) * 3600 + rng.int(0, 59) * 60;
  const recent = conns.filter((r) => r.connectedOn >= E - 365 && !r.person.ownerOf);
  const mk = (p, direction, s, msg) => (direction === 'INCOMING'
    ? { from: p.fullName, to: O.fullName, sec: s, message: msg, direction, inviterUrl: p.urlLower, inviteeUrl: O.urlLower, personId: p.id }
    : { from: O.fullName, to: p.fullName, sec: s, message: msg, direction, inviterUrl: O.urlLower, inviteeUrl: p.urlLower, personId: p.id });
  const msgOf = () => (rng.chance(0.4) ? rng.pick(pools.invitationMessages) : '');
  const accepted = [];
  for (const r of recent) {
    if (!rng.chance(0.55)) continue;
    const dir = rng.chance(0.55) ? 'INCOMING' : 'OUTGOING';
    const row = mk(r.person, dir, sec(Math.max(E - 365, r.connectedOn - rng.int(0, 6))), msgOf());
    rows.push(row);
    accepted.push(row);
  }
  // an earlier withdrawn/ignored invitation to the same person: the later row wins
  const doubles = rng.sampleWeighted(accepted, Math.min(2, accepted.length), () => 1);
  for (const a of doubles) {
    const p = conns.find((r) => r.person.id === a.personId).person;
    rows.push(mk(p, a.direction === 'INCOMING' ? 'OUTGOING' : 'INCOMING', a.sec - rng.int(20, 60) * 86400, ''));
  }
  if (doubles.length) notes.push({ kind: 'invitation-latest-wins', personIds: doubles.map((a) => a.personId) });
  // rows without a profile URL join by (unique) name
  const blanks = rng.sampleWeighted(accepted.filter((a) => !dupNamePeople.some((p) => p.id === a.personId)), Math.min(2, accepted.length), () => 1);
  for (const a of blanks) {
    if (a.direction === 'INCOMING') a.inviterUrl = ''; else a.inviteeUrl = '';
  }
  if (blanks.length) notes.push({ kind: 'invitation-name-join', personIds: blanks.map((a) => a.personId) });
  const dupRecent = dupNamePeople.find((p) => recent.some((r) => r.person.id === p.id));
  if (dupRecent) {
    const r = recent.find((x) => x.person.id === dupRecent.id);
    const row = mk(dupRecent, 'INCOMING', sec(Math.max(E - 365, r.connectedOn - 1)), '');
    row.inviterUrl = '';
    rows.push(row);
    notes.push({ kind: 'invitation-ambiguous-name-dropped', personId: dupRecent.id });
  }
  // pending invitations to / from people who are not connections
  const pend = rng.sampleWeighted(nonConnections, rng.int(6, 20), (p) => p.sociability);
  pend.forEach((p, i) => rows.push(mk(p, i % 2 ? 'OUTGOING' : 'INCOMING', sec(E - rng.int(1, 360)), msgOf())));
  rows.sort((a, b) => b.sec - a.sec);
  return { rows, notes };
}

// ---------------------------------------------------------------------------
// Notes.csv
// ---------------------------------------------------------------------------

function buildNotes(pools, d, { rng, conns, nonConnections, dupNamePeople, E, compOf }) {
  const O = d.owner;
  const notes = [];
  const rows = [];
  const count = Math.max(2, Math.round(conns.length * rng.uniform(0.02, 0.05)));
  const picked = rng.sampleWeighted(conns.filter((r) => !dupNamePeople.some((p) => p.id === r.person.id)), count, (r) => r.person.sociability);
  const text = (p, day) => {
    const events = pools.noteEvents.filter((e) => day >= 20454 || !/2025/.test(e)); // 20454 = 2026-01-01
    return fill(rng.pick(pools.notes), { event: rng.pick(events), topic: rng.pick(pools.noteTopics), company: compOf(p, day), firstName: p.first });
  };
  const mk = (p, url, note, created) => ({ first: p.first, last: p.last, url, note, created, edited: rng.chance(0.3) ? Math.min(E, created + rng.int(1, 200)) : null, personId: p.id });
  for (const r of picked) {
    const created = r.connectedOn + Math.floor(rng.next() * (E - r.connectedOn));
    rows.push(mk(r.person, `${r.person.urlLower}/`, text(r.person, created), created));
  }
  // second note row for the same person: concatenated by the importer
  for (const r of picked.slice(0, 2)) {
    const created = Math.min(E, rows.find((x) => x.personId === r.person.id).created + rng.int(1, 90));
    rows.push(mk(r.person, `${r.person.urlLower}/`, text(r.person, created), created));
  }
  notes.push({ kind: 'note-concatenated', personIds: picked.slice(0, 2).map((r) => r.person.id) });
  // one very long note (capped at 500 characters after concatenation)
  if (picked.length > 2) {
    const r = picked[2];
    let long = '';
    while (long.length < 620) long += `${text(r.person, E)}. `;
    rows.find((x) => x.personId === r.person.id).note = long.trim();
    notes.push({ kind: 'note-over-500-chars', personId: r.person.id });
  }
  // a multi-line note (whitespace collapsed by the importer)
  if (picked.length > 3) {
    const row = rows.find((x) => x.personId === picked[3].person.id);
    row.note = `${row.note}\nFollow up:\n  ask about ${rng.pick(pools.noteTopics)}`;
    notes.push({ kind: 'note-multiline', personId: picked[3].person.id });
  }
  // blank-URL rows join by unique name
  for (const r of picked.slice(4, 6)) rows.find((x) => x.personId === r.person.id).url = '';
  notes.push({ kind: 'note-name-join', personIds: picked.slice(4, 6).map((r) => r.person.id) });
  // blank note (skipped), a non-connection (dropped), an ambiguous name (dropped)
  if (picked.length > 6) {
    rows.find((x) => x.personId === picked[6].person.id).note = '   ';
    notes.push({ kind: 'note-blank-skipped', personId: picked[6].person.id });
  }
  const outsider = rng.pick(nonConnections);
  rows.push(mk(outsider, `${outsider.urlLower}/`, text(outsider, E - 30), E - 30));
  notes.push({ kind: 'note-non-connection-dropped', personId: outsider.id });
  if (dupNamePeople.length) {
    const p = dupNamePeople[0];
    const created = E - rng.int(1, 60);
    rows.push(mk(p, '', text(p, created), created));
    notes.push({ kind: 'note-ambiguous-name-dropped', personId: p.id });
  }
  rows.sort((a, b) => (b.created - a.created) || (a.personId < b.personId ? -1 : 1));
  return { rows, notes };
}

// ---------------------------------------------------------------------------
// Endorsement_Received_Info.csv
// ---------------------------------------------------------------------------

function buildEndorsements(d, { rng, conns, nonConnections, E }) {
  const O = d.owner;
  const rows = [];
  const count = Math.max(3, Math.round(conns.length * rng.uniform(0.05, 0.15)));
  const endorsers = rng.sampleWeighted(conns, count, (r) => r.person.sociability * (latestOverlap(O, r.person, E) ? 3 : 1));
  const status = () => rng.weightedKey({ ACCEPTED: 0.85, PENDING: 0.08, REJECTED: 0.07 });
  const add = (p, since, url, st) => {
    const skills = rng.sampleWeighted(O.skills, rng.int(1, 4), () => 1);
    for (const s of skills) {
      const day = since + Math.floor(rng.next() * Math.max(1, E - since));
      rows.push({ sec: day * 86400 + rng.int(0, 86399), skill: s, first: p.first, last: p.last, url, status: st || status(), personId: p.id });
    }
  };
  endorsers.forEach((r, i) => {
    const url = i === 1 || i === 2 ? '' : `www.linkedin.com/in/${r.person.slug}`;
    add(r.person, r.connectedOn, i === 0 ? `www.linkedin.com/in/${r.person.slug}` : url, i === 0 ? 'PENDING' : null);
  });
  for (const p of rng.sampleWeighted(nonConnections, rng.int(1, 3), (x) => x.sociability)) add(p, E - 900, `www.linkedin.com/in/${p.slug}`, 'ACCEPTED');
  rows.sort((a, b) => b.sec - a.sec || (a.personId < b.personId ? -1 : 1));
  return { rows };
}

// ---------------------------------------------------------------------------
// Recommendations_Received.csv (no URL column: name join only)
// ---------------------------------------------------------------------------

function buildRecommendations(pools, d, { rng, conns, nonConnections, dupNamePeople, E }) {
  const O = d.owner;
  const rows = [];
  const notes = [];
  const n = d.id === 'N01' ? 6 : rng.int(0, 8);
  const recs = rng.sampleWeighted(conns.filter((r) => !dupNamePeople.some((p) => p.id === r.person.id)), n, (r) => r.person.sociability * (latestOverlap(O, r.person, E) ? 5 : 0.3));
  const mk = (p, since, status) => {
    const day = since + Math.floor(rng.next() * Math.max(1, E - since));
    const pos = activePosition(p, day) || p.positions[p.positions.length - 1];
    return { first: p.first, last: p.last, company: pos.companyName, title: pos.title.trim(), text: fill(rng.pick(pools.recommendationTexts), { firstName: O.first }), day, status, personId: p.id };
  };
  for (const r of recs) rows.push(mk(r.person, r.connectedOn, rng.weightedKey({ VISIBLE: 0.75, HIDDEN: 0.15, PENDING: 0.1 })));
  if (dupNamePeople.length && (d.id === 'N01' || d.id === 'N06' || d.id === 'N10')) {
    rows.push(mk(dupNamePeople[0], E - 400, 'VISIBLE'));
    notes.push({ kind: 'recommendation-ambiguous-name-dropped', personId: dupNamePeople[0].id });
  }
  if (d.id === 'N01' || d.id === 'N09') {
    const p = rng.pick(nonConnections);
    rows.push(mk(p, E - 1500, 'VISIBLE'));
    notes.push({ kind: 'recommendation-non-connection-dropped', personId: p.id });
  }
  rows.sort((a, b) => b.day - a.day || (a.personId < b.personId ? -1 : 1));
  return { rows, notes };
}

// ---------------------------------------------------------------------------
// Owner files
// ---------------------------------------------------------------------------

// Function-appropriate topics for the owner's free-text Profile summary and Positions descriptions
// (the global noteTopics pool mixes unrelated fields, e.g. "renewable energy" for a game-studio PM).
const FN_TOPICS = {
  software_engineering: ['platform reliability', 'developer tooling', 'cloud migration', 'engineering leadership'],
  data_science: ['experimentation', 'data infrastructure', 'forecasting models', 'ML platform'],
  product_management: ['product strategy', 'roadmap planning', 'customer discovery', 'launch'],
  design: ['design system', 'user research', 'accessibility', 'brand refresh'],
  marketing: ['brand partnerships', 'go-to-market strategy', 'demand generation', 'customer retention'],
  sales: ['enterprise sales', 'go-to-market strategy', 'channel partnerships', 'international expansion'],
  customer_success: ['customer retention', 'onboarding', 'renewals', 'support operations'],
  finance: ['FP&A', 'budget planning', 'treasury', 'cost optimization'],
  accounting: ['month-end close', 'audit readiness', 'revenue recognition', 'controls'],
  investment_banking: ['M&A due diligence', 'capital markets', 'deal execution', 'client coverage'],
  venture_capital: ['fundraising', 'portfolio support', 'deal sourcing', 'due diligence'],
  consulting: ['operating model', 'cost transformation', 'growth strategy', 'M&A due diligence'],
  operations: ['process improvement', 'supply chain resilience', 'store operations', 'cost optimization'],
  supply_chain: ['supply chain resilience', 'procurement', 'demand planning', 'logistics network'],
  hr_recruiting: ['talent acquisition', 'employer branding', 'people operations', 'career transitions'],
  legal: ['regulatory compliance', 'commercial contracts', 'M&A due diligence', 'litigation'],
  healthcare_clinical: ['clinical operations', 'patient safety', 'quality improvement', 'care coordination'],
  biotech_research: ['assay development', 'clinical trials', 'translational research', 'lab operations'],
  academia: ['research grants', 'graduate mentoring', 'curriculum design', 'research collaborations'],
  policy_government: ['policy research', 'program evaluation', 'stakeholder engagement', 'regulatory reform'],
  nonprofit: ['fundraising', 'program delivery', 'community partnerships', 'grant management'],
  energy_engineering: ['renewable energy projects', 'asset integrity', 'grid modernization', 'project execution'],
  media_production: ['content development', 'post-production', 'production scheduling', 'talent relations'],
  journalism: ['investigative reporting', 'editorial strategy', 'audience growth', 'newsroom operations'],
  retail_merchandising: ['range planning', 'buying strategy', 'supplier negotiations', 'e-commerce growth'],
  hospitality: ['guest experience', 'revenue management', 'venue operations', 'service standards'],
  executive: ['international expansion', 'growth strategy', 'organizational design', 'board relations'],
};
const fnTopic = (rng, pools, fnId) => rng.pick(FN_TOPICS[fnId] || pools.noteTopics);

function buildOwnerFiles(W, pools, d, { rng, E, prefix }) {
  const O = d.owner;
  const opts = d.opts;
  const files = [];
  const notes = [];
  const fn = W.fnById.get(O.functionId);
  const yearE = ymdOf(E)[0];
  const cur = activePosition(O, E);
  const past = O.positions.filter((p) => p.start <= E).sort((a, b) => b.start - a.start);
  const prev = past.find((p) => p !== cur && p.companyName !== cur.companyName);
  const hlTemplates = pools.headlines.filter((h) => prev || !h.includes('{prevCompany}'));
  const headline = fill(rng.pick(hlTemplates), { title: cur.title, company: cur.companyName, prevCompany: prev ? prev.companyName : '', function: fn.name });
  const industry = W.industryById.get(O.industryId)?.name || '';
  const companiesSeen = [...new Set(past.map((p) => p.companyName))];
  const summary = `${Math.max(1, O.yrs)}+ years in ${fn.name.toLowerCase()}, most recently at ${companiesSeen.slice(0, 3).join(', ')}.\nBased in ${O.location.split(',')[0]}; always happy to talk about ${fnTopic(rng, pools, O.functionId)}.`;
  const birth = `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][rng.int(0, 11)]} ${rng.int(1, 28)}`;
  files.push({ path: `${prefix}Profile.csv`, id: 'profile', rows: 1, text: csvText(
    ['First Name', 'Last Name', 'Maiden Name', 'Address', 'Birth Date', 'Headline', 'Summary', 'Industry', 'Zip Code', 'Geo Location', 'Twitter Handles', 'Websites', 'Instant Messengers'],
    [[O.first, O.last, '', '', birth, headline, summary, industry, '', O.location, '', '', '']]) });

  const posRows = past.map((p) => {
    // Location is not bound to the company's real site, so show only the community's metro area (single-metro
    // communities) or leave it blank (multi-city communities), as real exports often do. The pick is kept so
    // the random stream is unchanged.
    rng.pick(W.commById.get(p.community).locations);
    // use the position's community only when the employer is actually there, else the employer's own community
    const co = W.byId.get(p.companyId);
    const locComm = co && co.communities && co.communities.length && !co.communities.includes(p.community) ? co.communities[0] : p.community;
    const loc = METRO_AREA[locComm] || '';
    const desc = rng.chance(0.5) ? `Led ${fnTopic(rng, pools, O.functionId)} initiatives; partnered with cross-functional teams.` : '';
    return [p.companyName, p.title, desc, loc, fmtMonYear(p.start), p.end != null && p.end <= E ? fmtMonYear(p.end) : ''];
  });
  files.push({ path: `${prefix}Positions.csv`, id: 'positions', rows: posRows.length, text: csvText(['Company Name', 'Title', 'Description', 'Location', 'Started On', 'Finished On'], posRows) });

  const eduRows = O.education.filter((e) => e.startYear <= yearE)
    .map((e) => [W.schoolById.get(e.schoolId).name, String(e.startYear), e.endYear <= yearE ? String(e.endYear) : '', '', e.degree, ''])
    .reverse();
  files.push({ path: `${prefix}Education.csv`, id: 'education', rows: eduRows.length, text: csvText(['School Name', 'Start Date', 'End Date', 'Notes', 'Degree Name', 'Activities'], eduRows) });

  const skillRows = O.skills.map((s) => [s]);
  if (opts.skills) {
    skillRows.push([O.skills[3].toLowerCase()]); // case-insensitive duplicate
    notes.push({ kind: 'skills-over-cap-and-case-duplicate', skillsInFile: skillRows.length, cap: NETWORK_CONTEXT_CAPS.skills });
  }
  files.push({ path: `${prefix}Skills.csv`, id: 'skills', rows: skillRows.length, text: csvText(['Name'], skillRows) });

  let follows = [];
  let apps = [];
  let saved = [];
  let dream = [];
  let desired = [];
  if (!opts.basic) {
    const real = W.companies.filter((c) => !c.generic);
    const nFollow = Math.min(real.length, opts.follows || rng.int(8, 60));
    const followCos = rng.sampleWeighted(real, nFollow, (c) => (c.communities.includes(d.community) ? 5 : c.communities.includes(O.second) ? 3 : 1));
    follows = followCos.map((c) => ({ name: c.name, sec: (E - rng.int(1, 3000)) * 86400 + rng.int(0, 86399) }));
    if (follows.length > 3) follows.push({ name: follows[1].name, sec: follows[1].sec - 86400 * rng.int(30, 400) });
    follows.sort((a, b) => b.sec - a.sec);
    if (opts.follows) notes.push({ kind: 'company-follows-over-cap', rows: follows.length, cap: NETWORK_CONTEXT_CAPS.followedCompanies });
    files.push({ path: `${prefix}Company Follows.csv`, id: 'follows', rows: follows.length, text: csvText(['Organization', 'Followed On'], follows.map((f) => [f.name, fmtUtc(f.sec)])) });

    const titles = pools.jobSeeker.jobTitlesByFunction[O.functionId];
    const dreamPool = real.filter((c) => c.communities.includes(d.community) || c.communities.includes(O.second));
    dream = rng.sampleWeighted(dreamPool, rng.int(3, 8), (c) => (c.size === 'large' ? 2 : 1)).map((c) => c.name);
    desired = rng.sampleWeighted(titles, rng.int(2, 5), () => 1);
    const email = `${asciiSlug(O.first)}.${asciiSlug(O.last)}@example.com`;
    const nApps = d.id === 'N01' ? 6 : rng.int(0, 10);
    apps = Array.from({ length: nApps }, () => {
      const c = rng.pick(dreamPool);
      const day = E - rng.int(1, 540);
      return { sec: day * 86400 + rng.int(28800, 72000), company: c.name, title: rng.pick(titles), url: `https://www.linkedin.com/jobs/view/${rng.int(3000000000, 4299999999)}` };
    }).sort((a, b) => b.sec - a.sec);
    files.push({ path: `${prefix}Jobs/Job Applications.csv`, id: 'applications', rows: apps.length, text: csvText(
      ['Application Date', 'Contact Email', 'Contact Phone Number', 'Company Name', 'Job Title', 'Job Url', 'Resume Name', 'Question And Answers'],
      apps.map((a) => [fmtUtc(a.sec), email, `+1 555-01${String(rng.int(0, 99)).padStart(2, '0')}`, a.company, a.title, a.url, `${asciiSlug(O.first)}_${asciiSlug(O.last)}_Resume.pdf`, ''])) });
    const nSaved = rng.int(0, 8);
    saved = Array.from({ length: nSaved }, () => {
      const c = rng.pick(real);
      return { sec: (E - rng.int(1, 400)) * 86400 + rng.int(0, 86399), company: c.name, title: rng.pick(titles), url: `https://www.linkedin.com/jobs/view/${rng.int(3000000000, 4299999999)}` };
    }).sort((a, b) => b.sec - a.sec);
    files.push({ path: `${prefix}Jobs/Saved Jobs.csv`, id: 'savedJobs', rows: saved.length, text: csvText(['Saved Date', 'Job Url', 'Job Title', 'Company Name'], saved.map((s) => [fmtUtc(s.sec), s.url, s.title, s.company])) });
    const comm = W.commById.get(d.community);
    files.push({ path: `${prefix}Jobs/Job Seeker Preferences.csv`, id: 'preferences', rows: 1, text: csvText(
      ['Locations', 'Industries', 'Company Employee Count', 'Preferred Job Types', 'Job Titles', 'Open To Recruiters', 'Dream Companies', 'Profile Shared With Job Poster', 'Job Title For Searching Fast Growing Companies', 'Introduction Statement', 'Phone Number', 'Job Seeker Activity Level', 'Preferred Start Time Range', 'Commute Preference Starting Address', 'Commute Preference Starting Time', 'Mode Of Transportation', 'Maximum Commute Duration', 'Open Candidate Visibility', 'Job Seeking Urgency Level', 'Semantic Preferences'],
      [[comm.locations.slice(0, 2).join(' | '), industry, rng.pick(['1001-5000', '5001-10000', '10001+']), rng.pick(['Full-time', 'Full-time | Contract']), desired.join('; '), rng.pick(['Yes', 'No']), dream.join('; '), 'Yes', desired[0], '', '', rng.pick(['ACTIVE', 'CASUAL', 'PASSIVE']), '', '', '', '', '', rng.pick(['RECRUITERS_ONLY', 'ALL_LINKEDIN_MEMBERS']), rng.pick(['NEXT_THREE_MONTHS', 'NO_RUSH', 'ASAP']), '']]) });
  }

  // expected context (documented rules; source is omitted)
  const positions = [];
  const keys = new Set();
  for (const r of posRows) {
    if (positions.length >= NETWORK_CONTEXT_CAPS.positions) break;
    const company = collapse(r[0]);
    const title = collapse(r[1]);
    if (!company && !title) continue;
    const k = `${company.toLowerCase()}\u0000${title.toLowerCase()}`;
    if (keys.has(k)) continue;
    keys.add(k);
    positions.push({ company, title, current: r[5] === '' });
  }
  const L = (cap, values) => {
    const u = uniqueList(cap);
    for (const v of values) u.add(v);
    return u.items;
  };
  const context = {
    name: collapse(`${O.first} ${O.last}`) || null,
    headline: collapse(headline) || null,
    industry: collapse(industry) || null,
    positions,
    schools: L(NETWORK_CONTEXT_CAPS.schools, eduRows.map((r) => r[0])),
    skills: L(NETWORK_CONTEXT_CAPS.skills, skillRows.map((r) => r[0])),
    followedCompanies: L(NETWORK_CONTEXT_CAPS.followedCompanies, follows.map((f) => f.name)),
    appliedCompanies: L(NETWORK_CONTEXT_CAPS.appliedCompanies, [...apps.map((a) => a.company), ...saved.map((s) => s.company)]),
    appliedTitles: L(NETWORK_CONTEXT_CAPS.appliedTitles, [...apps.map((a) => a.title), ...saved.map((s) => s.title)]),
    dreamCompanies: L(NETWORK_CONTEXT_CAPS.dreamCompanies, opts.basic ? [] : splitList(dream.join('; '))),
    desiredTitles: L(NETWORK_CONTEXT_CAPS.desiredTitles, opts.basic ? [] : splitList(desired.join('; '))),
  };
  return { files, context, notes };
}

// ---------------------------------------------------------------------------
// Non-whitelisted files (never decompressed by the importer)
// ---------------------------------------------------------------------------

function buildSkipFiles(W, d, { rng, E, prefix }) {
  const O = d.owner;
  const ip = () => `${rng.pick(['192.0.2', '198.51.100', '203.0.113'])}.${rng.int(1, 254)}`;
  const t = (maxBack) => fmtUtc((E - rng.int(0, maxBack)) * 86400 + rng.int(0, 86399));
  const phone = () => `+1 (${rng.pick(['206', '415', '212', '617', '312', '416', '202', '713', '310'])}) 555-01${String(rng.int(0, 99)).padStart(2, '0')}`;
  const ua = ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)', 'LinkedIn/9.30 (iPhone; iOS 18.5)'];
  const many = (n, f) => Array.from({ length: n }, f);
  const email = `${asciiSlug(O.first)}.${asciiSlug(O.last)}@example.com`;
  const catalog = {
    'Registration.csv': () => [['Registered At', 'Ip Address', 'Ip Country Code'], [[fmtUtc(O.careerStart * 86400 + 40000), ip(), 'US']]],
    'Email Addresses.csv': () => [['Email Address', 'Confirmed', 'Primary', 'Updated At', 'Made Primary At'], [[email, 'Yes', 'Yes', t(2000), t(2500)]]],
    'PhoneNumbers.csv': () => [['Extension', 'Phone Number', 'Type'], [['', phone(), 'Mobile']]],
    'Ad_Targeting.csv': () => [['Category', 'Value'], [['Member Age', '35 to 54'], ['Company Names', W.byId.get(activePosition(O, E).companyId).name], ['Job Functions', W.fnById.get(O.functionId).name], ['Member Skills', O.skills.slice(0, 5).join('; ')]]],
    'Rich_Media.csv': () => [['Asset', 'Media Url', 'Filename'], many(rng.int(1, 4), () => ['Profile photo', `https://media.licdn.com/dms/image/${rng.base64ish(20)}`, `IMG_${rng.int(1000, 9999)}.jpg`])],
    'Learning.csv': () => [['Content Name', 'Content Type', 'Content Watched', 'Watched At', 'Learning Platform'], many(rng.int(2, 8), () => [`${rng.pick(O.skills)} Essential Training`, 'COURSE', rng.pick(['Yes', 'No']), t(900), 'LinkedIn Learning'])],
    'Reactions.csv': () => [['Date', 'Type', 'Link'], many(rng.int(5, 25), () => [t(800), rng.pick(['LIKE', 'PRAISE', 'EMPATHY', 'INTEREST']), `https://www.linkedin.com/feed/update/urn:li:activity:${rng.int(7000000000, 7299999999)}`])],
    'Comments.csv': () => [['Date', 'Link', 'Message'], many(rng.int(2, 10), () => [t(800), `https://www.linkedin.com/feed/update/urn:li:activity:${rng.int(7000000000, 7299999999)}`, rng.pick(['Congrats!', 'Great insights, thanks for sharing.', 'Well deserved!', 'Love this, so true.'])])],
    'Shares.csv': () => [['Date', 'SharedUrl', 'ShareCommentary', 'ShareLink', 'Visibility'], many(rng.int(1, 6), () => [t(900), '', rng.pick(['Excited to share some news!', 'We are hiring, DM me.', 'Great panel today.']), `https://www.linkedin.com/feed/update/urn:li:share:${rng.int(7000000000, 7299999999)}`, 'MEMBER_NETWORK'])],
    'SearchQueries.csv': () => [['Time', 'Search Query'], many(rng.int(5, 20), () => [t(400), rng.pick([...O.skills.slice(0, 4), W.byId.get(activePosition(O, E).companyId).name, 'product manager', 'recruiter'])])],
    'Inferences_about_you.csv': () => [['Category', 'Segment', 'Inference'], [['Professional', 'Seniority', O.seniorityId], ['Professional', 'Function', O.functionId]]],
    'Member_Follows.csv': () => [['Followed On', 'Entity', 'Preference'], many(rng.int(2, 8), () => [t(1500), `urn:li:member:${rng.int(10000000, 99999999)}`, 'ACTIVE'])],
    'Receipts_v2.csv': () => [['Transaction Date', 'Description', 'Amount', 'Currency', 'Payment Method'], many(rng.int(1, 4), () => [t(700), 'Premium Career - monthly', '39.99', 'USD', 'Card ending 4242'])],
    'Logins.csv': () => [['Login Type', 'Date', 'IP Address', 'User Agent'], many(rng.int(5, 20), () => [rng.pick(['WEB', 'MOBILE']), t(180), ip(), rng.pick(ua)])],
    'Security Challenges.csv': () => [['Challenge Type', 'Date'], many(rng.int(1, 3), () => [rng.pick(['EMAIL_PIN', 'SMS_PIN']), t(600)])],
    'Events.csv': () => [['Event Name', 'Event Time', 'Status', 'External Url'], many(rng.int(1, 4), () => [`${rng.pick(['Annual', 'Quarterly', 'Community'])} ${W.fnById.get(O.functionId).name} Meetup`, t(500), rng.pick(['ATTENDING', 'INTERESTED']), ''])],
  };
  const names = Object.keys(catalog);
  const basicSet = ['Registration.csv', 'Email Addresses.csv', 'PhoneNumbers.csv', 'Logins.csv', 'Security Challenges.csv', 'Ad_Targeting.csv', 'Inferences_about_you.csv', 'Member_Follows.csv'];
  const chosen = d.opts.basic ? basicSet : rng.shuffle(names).slice(0, rng.int(8, 14));
  return chosen.map((name) => {
    const [header, rows] = catalog[name]();
    return { path: `${prefix}${name}`, text: csvText(header, rows), id: null, rows: rows.length };
  });
}
