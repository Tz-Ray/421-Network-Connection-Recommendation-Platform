# testdata generator — file-format spec

Ground truth for every claim below is the shipped importer (`lib/linkedinExport.ts`,
`lib/connectionFields.ts`) and the existing Python fixture generator
(`local/fixtures/make_fixtures.py`). Citations are `path:line`. This file does not
itself generate data — it is the contract a generator script must follow so its
output parses through the real importer the same way a real LinkedIn export does.

Dataset universe "today" = **2026-09-28**. No date in any generated file may be
later than that file's own export date.

---

## 1. What the importer actually reads

### 1.1 Whitelist — the only 14 files ever decompressed

`lib/linkedinExport.ts:87-102` (`WHITELIST`), matched by **basename only, case-insensitive,
at any folder depth** (`lib/linkedinExport.ts:548-549`, `basename()` at `:130-133`). Anything
else is never inflated (`unzipSync` `filter` returns `false` and only records the basename
in `filesSkipped`, `:546-561`).

| FileId | Required basename (case-insensitive) |
|---|---|
| connections | `Connections.csv` |
| messages | `messages.csv` |
| invitations | `Invitations.csv` |
| notes | `Notes.csv` |
| endorsements | `Endorsement_Received_Info.csv` |
| recommendations | `Recommendations_Received.csv` |
| profile | `Profile.csv` |
| positions | `Positions.csv` |
| education | `Education.csv` |
| skills | `Skills.csv` |
| follows | `Company Follows.csv` |
| applications | `Job Applications.csv` |
| savedJobs | `Saved Jobs.csv` |
| preferences | `Job Seeker Preferences.csv` |

`Connections.csv` is mandatory — its absence throws (`lib/linkedinExport.ts:577-581`).
The other 13 are optional. A duplicate basename inside one zip: the first occurrence found
by `unzipSync` wins, a warning is recorded (`lib/linkedinExport.ts:554-558`).

**Owner files** (`OWNER_FILES`, `lib/linkedinExport.ts:110-119`): profile, positions,
education, skills, follows, applications, savedJobs, preferences. If a zip contains **none**
of these, `context` is `null` (`:933-949`) — e.g. a Connections-only zip. The real export's
job-related files live under a `Jobs/` folder (see `local/fixtures/make_fixtures.py:353-381`
writing `Jobs/Job Applications.csv` etc.) but folder depth doesn't matter to the matcher.

### 1.2 Header lookup mechanics

- Every column is read by **header name**, never position (`lib/linkedinExport.ts:11`,
  `:197-200` `cellAt`, `readTable` at `:170-195`).
- `readTable(text, expected)` finds the header row as **the first of the first 10 rows**
  that contains any of `expected` (normalized), else falls back to row 0
  (`lib/linkedinExport.ts:174-195`). This is how `Connections.csv`'s "Notes:" preamble is
  skipped for the zip path too, though it always uses `Connections.csv`'s own rule (below).
- `normalizeKey(k)` = trim, lowercase, strip everything but `[a-z0-9]`
  (`lib/connectionFields.ts:105-107`) — so header spacing/punctuation/case never matters
  (e.g. "Sent At" ≡ "sentat" ≡ "SENT-AT").
- **Placeholder cells**: any cell matching `^\[[a-z0-9]+\](?:\s+\[[a-z0-9]+\])*$` (e.g.
  `[firstname]`, `[url]`, `[firstname] [lastname]`) counts as empty everywhere
  (`lib/linkedinExport.ts:135-146`, `clean()`).
- Every real value coming out of `cellAt`/`clean` is `.trim()`-ed
  (`lib/linkedinExport.ts:143-146`).

### 1.3 CSV parsing / BOM

`parseCsvRfc4180` (`lib/connectionFields.ts:162-211`) and `parseCsvToObjects`
(`lib/connectionFields.ts:230-260`, which calls the former) are the only CSV parsers used
by both the `.csv`-upload path and every whitelisted file inside a `.zip`
(`lib/linkedinExport.ts:174-175` `readTable` calls `parseCsvRfc4180`; `:588`
`parseCsvToObjects(connectionsText)` for `Connections.csv`).

**UTF-8 BOM: YES, stripped.** `lib/connectionFields.ts:163`:
`const clean = text.replace(/^﻿/, '');` — a leading BOM is removed before parsing, in
both `parseCsvRfc4180` and (transitively) `parseCsvToObjects`. Generated files may include or
omit a BOM; either round-trips identically.

Quoting: standard RFC-4180 double-quote escaping (`""` inside a quoted field), fields may
contain embedded `\r`/`\n`/`,` only inside quotes (`lib/connectionFields.ts:169-207`). `\r\n`,
`\n` and bare `\r` are all accepted line terminators; a `\r\n` pair is consumed as one
terminator (`:189-190`). Blank rows are dropped (`:195-196`, `:206-208`, and again in
`parseCsvToObjects` at `:241`).

### 1.4 `Connections.csv` specifics

- Header row = **the first row containing both `First Name` and `Last Name`**
  (`findHeaderRowIndex`, `lib/connectionFields.ts:213-223`); LinkedIn's "Notes:" preamble
  (multi-line, see §2.2) is skipped this way. If no such row exists, row 0 is used; if the
  table is empty, no rows are produced (`:222`, `:233`).
- `Full Name` is **synthesized only when the export didn't already supply a non-blank one**
  (`lib/connectionFields.ts:250-253`), as `"<First> <Last>".trim()`.
- Accepted header synonyms actually read anywhere downstream (`lib/connectionFields.ts:67-74`,
  used via `getField`): `First Name`/`first_name`/`firstname`; `Last Name`/`last_name`/
  `lastname`; `Full Name`; `Position`/`title`/`role`/`position`; `Company`/`org`/`company`/
  `organization`/`firm`; `Email Address`; `URL`; `Connected On`. `Connections.csv` itself must
  literally use LinkedIn's own headers (`First Name, Last Name, URL, Email Address, Company,
  Position, Connected On`, confirmed at `local/fixtures/make_fixtures.py:189` and `:482`) — the
  synonym lists exist for CSV/JSON imports of already-cleaned data, not for the zip's
  `Connections.csv` itself.
- **Legacy pre-2020 header** (no `URL` column, no preamble): `First Name,Last Name,Email
  Address,Company,Position,Connected On`. It still parses: `First Name`+`Last Name` are found
  for the header row, `URL` is simply absent so every row's join falls back to name-matching
  (§1.6).

### 1.5 Profile URL / person-name normalization

- `normalizeProfileUrl(s)` (`lib/linkedinExport.ts:231-251`): trims, lowercases, strips a
  URI scheme and `www.` or a two-letter locale subdomain (e.g. `de.linkedin.com`), strips
  query/fragment, requires `(?:[a-z]{2}\.)?linkedin\.com/in/<slug>`, URL-decodes and
  lowercases the slug, returns `linkedin.com/in/<slug>` or `null`. A non-`/in/` URL (e.g. a
  company page) or a placeholder returns `null`.
- `normalizePersonName(s)` (`lib/linkedinExport.ts:254-265`): NFKD-normalize, strip
  diacritics, lowercase, drop all non-letter/non-digit/non-space characters, collapse
  whitespace, trim.

### 1.6 Join rule (used by every enrichment file)

`lib/linkedinExport.ts:609-620` (`join(url, rawName)`):
1. If a **valid** profile URL is given, join **by URL only** — no match means the row's
   signal is dropped (no name fallback attempted).
2. Otherwise (URL blank/not a profile URL), fall back to `normalizePersonName`, and only
   join **when that name maps to exactly one connection** (ambiguous name ⇒ dropped).

`Recommendations_Received.csv` has no URL column at all, so it **always** joins by name
(`lib/linkedinExport.ts:846-862`, `join(null, name)`).

### 1.7 `messages.csv`

Header lookup done via `readMessages`/`readTable(text, ['CONVERSATION ID','FROM','SENDER
PROFILE URL'])` (`lib/linkedinExport.ts:422-462`). Columns read by name: `CONVERSATION ID`,
`FROM`, `SENDER PROFILE URL`, `TO`, `RECIPIENT PROFILE URLS`, `DATE`, `FOLDER`, `IS MESSAGE
DRAFT` (`:424-431`). `RECIPIENT PROFILE URLS` and `TO` are **multi-valued**, split by
`splitList` — semicolon if present, else comma (`lib/linkedinExport.ts:152-159`).

- **Draft skip**: rows where `IS MESSAGE DRAFT` is truthy (`true|yes|y|1`, case-insensitive,
  `isTruthyCell` at `:161-163`) are skipped entirely (`:435`). The 12th column is only
  present on some real exports; its absence is fine (`cDraft` becomes `-1`, guard short-circuits).
- **SPAM skip**: rows where `FOLDER` (case-insensitive) is `SPAM` are skipped (`:436`).
- A row with **no** `CONVERSATION ID` is treated as its own singleton conversation
  (`\u0000row<i>` synthetic id, `:450`).
- **Owner detection** (`detectOwnerUrl`, `:469-522`): the owner is the **non-connection**
  URL (i.e. not present in `Connections.csv`) appearing in the **most distinct conversation
  ids**; ties are broken by agreement with the `Profile.csv` name against `FROM`/`TO` names;
  otherwise `null`. If both the detected URL and the Profile.csv name are absent,
  `ownerDetected = false` and the warning `"Could not tell which messages are yours; message
  history was not used"` is recorded and **no message enrichment happens at all**
  (`:650-652`, `OWNER_UNKNOWN_WARNING` at `:124-125`). `ownerDetected` is `null` only when
  there is no `messages.csv` at all (`:641`).
- **>5-participant rule**: per conversation, all non-owner participant identities
  (URL, or `name:<key>` when no URL resolves) are collected into a `Set`; if that set has
  **0 or more than `MAX_THREAD_PARTICIPANTS = 5`** distinct participants, the **entire
  conversation is ignored** for every counter (`lib/linkedinExport.ts:121`, `:705-722`).
  `oneToOne = participants.size === 1`.
- **Counting** (`:725-769`): every kept row increments the target connection's `count` by 1
  (attributed via `join()` on sender for a received row, recipients for a sent row, or both
  when direction is ambiguous, `:752-757`). `sent`/`received` increment **only when
  `oneToOne`** (`:762-763`) — so `messagesSent`/`messagesReceived` are strictly 1:1-thread
  counts, while `messageCount` covers all kept threads (1:1 and small-group alike). A 1:1 row
  with no `RECIPIENT PROFILE URLS` may fall back to joining the `TO` name (`:746-749`,
  "by URL only; a 1:1 row with no recipient URL may use the TO name").
- `firstMessagedAt`/`lastMessagedAt` track the min/max `DATE` seen across counted rows for
  that connection (`:764-767`), as `YYYY-MM-DD` via `parseLinkedInDate`.
- **Never kept**: message `CONTENT`, `SUBJECT`, or conversation `CONVERSATION TITLE` — only
  derived counts/dates are written to rows (`lib/linkedinExport.ts:9-10`, `:957-964`).

### 1.8 `Invitations.csv`

Columns by name: `From`, `To`, `Sent At`, `Direction`, `inviterProfileUrl`,
`inviteeProfileUrl` (`lib/linkedinExport.ts:778-784`). `Direction` (case-insensitive)
must be exactly `INCOMING` or `OUTGOING`; anything else is skipped (`:786-797`).
- `INCOMING` → joins by `inviterProfileUrl` first, else `From` name (`:789-791`).
- `OUTGOING` → joins by `inviteeProfileUrl` first, else `To` name (`:792-794`).
- `Sent At` parsed via `parseLinkedInDate` into `invitedAt`. When a connection has more than
  one qualifying invitation row, the **latest dated one wins** (ties/undated keep the first
  seen) (`:799-801`).

### 1.9 `Notes.csv`

Columns: `Connection First Name`, `Connection Last Name`, `Connection Profile URL`, `Note`
(`lib/linkedinExport.ts:810-814`). Blank notes are skipped (`:817`). Joins via
`join(normalizeProfileUrl(url), "<first> <last>")`. Multiple note rows for the same
connection are **concatenated with a space**, then whitespace-collapsed and **capped at
`MAX_NOTE_CHARS = 500`** (`lib/linkedinExport.ts:122`, `:806-825`). Note text is never sent
anywhere beyond the app itself (`:9-10`).

### 1.10 `Endorsement_Received_Info.csv`

Columns read (`lib/linkedinExport.ts:832-836`): `Endorser First Name`, `Endorser Last Name`,
`Endorser Public Url`, `Endorsement Status`. `t.col()` looks up the exact normalized header, so the
URL column must be spelled `Endorser Public Url` (`endorserpublicurl`); `Endorser Public Profile Url`
normalizes to a different key and would silently force name-only joins. The generator writes
`Endorsement Date, Skill Name, Endorser First Name, Endorser Last Name, Endorser Public Url,
Endorsement Status`.

Only rows whose `Endorsement Status` (case-insensitive) is exactly `ACCEPTED` count (`:838`); a
missing status column counts every row. Presence rule (`:828-831`, `:975`): when the file exists,
**every** connection row gets `endorsementCount` (0 when nothing accepted joined to it, including
connections that never appear in the file); when the file is absent the key is absent on every row.
`matched.endorsements` = connections with a count > 0.

> Corrected 2026-09-28 by the generator author: an earlier draft of this section contradicted itself
> (recommended `Endorser Public Profile Url`, and said "no row => null"). The text above matches the code.

### 1.11 `Recommendations_Received.csv`

Columns: `First Name`, `Last Name`, `Status` (`lib/linkedinExport.ts:851-862`). No URL
column exists on this file in real LinkedIn exports, so it always joins by name (§1.6). Only
rows with `Status` (case-insensitive) exactly `VISIBLE` set `recommendedYou = true`; a
matched-but-non-`VISIBLE` row (e.g. `PENDING`) leaves it `false` (not `null`) — mirrors the
endorsement ambiguity, same reasoning at `local/fixtures/make_fixtures.py:675-683`.
Recommendation `Text` is never kept.

### 1.12 Owner-context files

- `Profile.csv` (`lib/linkedinExport.ts:626-638`): first row's `First Name`, `Last Name`
  (joined for `ownerDisplayName`), `Headline`, `Industry`.
- `Positions.csv` (`:876-893`): `Company Name`, `Title`, `Finished On` (blank ⇒
  `current: true`). Deduped by lowercase `company\u0000title`, capped at
  `NETWORK_CONTEXT_CAPS.positions = 30` (`lib/connectionFields.ts:36`).
- `Education.csv` → `School Name` into a capped unique list (`schools`, cap 10,
  `lib/linkedinExport.ts:904`, caps at `lib/connectionFields.ts:37`).
- `Skills.csv` → `Name` into a capped unique list (`skills`, cap 50, case-insensitive dedupe
  via `uniqueList`, `lib/linkedinExport.ts:905`, `:205-219`).
- `Company Follows.csv` → `Organization` into `followedCompanies` (cap 200,
  `lib/linkedinExport.ts:906`).
- `Job Applications.csv` / `Saved Jobs.csv` → `Company Name`, `Job Title` (applications
  only) into `appliedCompanies`/`appliedTitles` (caps 100/100, `:908-919`). **Local-scoring
  only — never sent to the AI proxy** (`lib/connectionFields.ts:18`, `:28-29`).
- `Job Seeker Preferences.csv` → `Dream Companies`, `Job Titles`, each **semicolon-or-comma
  split** via `splitList` into `dreamCompanies`/`desiredTitles` (caps 50/50,
  `lib/linkedinExport.ts:921-931`).

### 1.13 Date formats `parseLinkedInDate` accepts

`lib/linkedinExport.ts:270-398`. Returns `YYYY-MM-DD` (UTC) or `null`; never throws. Two-digit
years → `20YY` (`:294`). Recognized shapes, in match order:
1. ISO-ish: `YYYY-MM-DD` or `YYYY/MM/DD`, optional `[T ]HH:MM[:SS[.ms]]`, optional zone
   (`Z`/`UTC`/`GMT`/`±HH:MM`) — `RE_ISO` at `:306-309`. A numeric offset with a time
   component converts to the UTC calendar date (`:333-345`).
2. `YYYY-MM` → day 1 (`RE_YEAR_MONTH`, `:310`).
3. `YYYY` alone → Jan 1 (`RE_YEAR`, `:311`).
4. `M/D/YY` or `M/D/YYYY`, optional trailing time (`, h:mm[:ss][am/pm][ tz]`) — `RE_SLASH`
   at `:312`; ambiguous `M/D` vs `D/M` resolved as `D/M` **only** when the first number is
   `>12` (`:355-363`), i.e. LinkedIn's own `M/D/YY` convention is assumed by default.
5. `D Mon[.] YYYY` or `D Mon[.] YY` (e.g. `15 Sep 2026`) — `RE_DAY_MON_YEAR` at `:313-316`.
6. `[Weekday ]Mon D[st/nd/rd/th][, ][time ]YYYY` (e.g. `Mon Sep 15 17:23:45 UTC 2026`,
   `Sep 15, 2026`) — `RE_MON_DAY_YEAR` at `:318-319`.
7. `Mon[.] YYYY` (e.g. `Sep 2026`) → day 1 — `RE_MON_YEAR` at `:320`.

Any string not matching one of these → `null` (silently drops that date, not the row).

---

## 2. Reference generator: `local/fixtures/make_fixtures.py`

Treat this script's `--demo` mode (`write_demo_export()`, lines 113-402, writing
`out/demo_export.zip`) as the canonical example of realistic LinkedIn formatting, and its
default (no-flag) mode (lines 416-885) as the canonical example of deliberately-adversarial
test fixtures with documented edge cases. Full header rows and date-format usage below are
taken from both modes; where they differ, both variants are listed (either is acceptable
LinkedIn-realistic input).

### 2.1 Per-file headers (verbatim)

| File | Header row |
|---|---|
| `Connections.csv` | `First Name, Last Name, URL, Email Address, Company, Position, Connected On` (`make_fixtures.py:189`, `:482`) |
| `messages.csv` | `CONVERSATION ID, CONVERSATION TITLE, FROM, SENDER PROFILE URL, TO, RECIPIENT PROFILE URLS, DATE, SUBJECT, CONTENT, FOLDER, ATTACHMENTS, IS MESSAGE DRAFT` (`make_fixtures.py:405-409`/`496-500`) |
| `Invitations.csv` | `From, To, Sent At, Message, Direction, inviterProfileUrl, inviteeProfileUrl` (`:274-275`/`572`) |
| `Notes.csv` | `Connection First Name, Connection Last Name, Connection Profile URL, Note, Created On, Edited On` (`:287`/`606`) |
| `Endorsement_Received_Info.csv` | reference fixture uses `Endorser Public Profile Url` (`:292-293`/`650`), which the importer does **not** read; generate `Endorsement Date, Skill Name, Endorser First Name, Endorser Last Name, Endorser Public Url, Endorsement Status` (see §1.10). |
| `Recommendations_Received.csv` | `First Name, Last Name, Company, Job Title, Text, Creation Date, Status` (`:302-303`/`668`) |
| `Profile.csv` | `First Name, Last Name, Maiden Name, Address, Birth Date, Headline, Summary, Industry, Zip Code, Geo Location, Twitter Handles, Websites, Instant Messengers` (`:315-317`/`690`) |
| `Positions.csv` | `Company Name, Title, Description, Location, Started On, Finished On` (`:323-324`/`697`) |
| `Education.csv` | `School Name, Start Date, End Date, Notes, Degree Name, Activities` (`:334-335`/`703`) |
| `Skills.csv` | `Name` (`:345`/`714`) |
| `Company Follows.csv` | `Organization, Followed On` (`:351-352`/`717`) |
| `Job Applications.csv` (real path `Jobs/Job Applications.csv`) | `Application Date, Contact Email, Contact Phone Number, Company Name, Job Title, Job Url, Resume Name, Question And Answers` (`:353-355`/`722`) |
| `Saved Jobs.csv` (real path `Jobs/Saved Jobs.csv`) | `Saved Date, Job Url, Job Title, Company Name` (`:365-366`/`728`) |
| `Job Seeker Preferences.csv` (real path `Jobs/Job Seeker Preferences.csv`) | `Locations, Industries, Company Employee Count, Preferred Job Types, Job Titles, Open To Recruiters, Dream Companies, Profile Shared With Job Poster, Job Title For Searching Fast Growing Companies, Introduction Statement, Phone Number, Job Seeker Activity Level, Preferred Start Time Range, Commute Preference Starting Address, Commute Preference Starting Time, Mode Of Transportation, Maximum Commute Duration, Open Candidate Visibility, Job Seeking Urgency Level, Semantic Preferences` (`:369-376`/`733`) |

### 2.2 `Connections.csv` "Notes:" preamble (verbatim, both modes identical)

```
Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who have allowed their connections to see or download their email address using this setting https://www.linkedin.com/psettings/privacy/email. You can learn more here https://www.linkedin.com/help/linkedin/answer/261"

```
(One quoted paragraph line, then one blank line, then the header row. Source:
`make_fixtures.py:103-110` and `:468-475`, byte-identical.) Line terminator throughout is
`CRLF` (`make_fixtures.py:34`, `CRLF = "\r\n"`, used by `csv_text()` at `:79-89`).

### 2.3 Date string formats actually used per file

| File / field | Example string | Parses via (§1.13 rule) |
|---|---|---|
| `Connections.csv` "Connected On" | `15 Sep 2026` | rule 5 |
| " | `2026-09-15 17:23:45 UTC` | rule 1 |
| " | `2026/09/10 09:00:00 UTC` | rule 1 |
| " | `9/1/26, 3:15 PM` | rule 4 |
| " | `9/5/2026` | rule 4 |
| " | `Tue Sep 15 17:23:45 UTC 2026` | rule 6 |
| " | `Sep 2026` | rule 7 |
| " | `2026` | rule 3 |
| " | `2026-09-01` | rule 1 (bare ISO) |
| `messages.csv` DATE | `2026-08-14 17:23:45 UTC` (demo mode `d_utc`, `make_fixtures.py:122-123`) or bare `2026-06-01 10:00:00 UTC` (test-fixture mode, `:518` etc.) | rule 1 |
| `Invitations.csv` "Sent At" | `9/15/26, 5:23 PM` style, generated by `d_short()` (`make_fixtures.py:128-129`, `"%d/%d/%s, %s" % (month, day, yy, "%I:%M %p".lstrip("0"))`) e.g. `9/1/26, 10:00 AM` | rule 4 |
| `Endorsement_Received_Info.csv` "Endorsement Date" | `2026/08/01 10:00:00 UTC` (`d_slash_utc`, `make_fixtures.py:125-126`, `:295-299`) | rule 1 |
| `Positions.csv` "Started On"/"Finished On" | `Jan 2023` (month+year, blank when current) | rule 7 / empty |
| `Recommendations_Received.csv` "Creation Date" | `2026-08-10` (bare ISO) | rule 1 |
| `Company Follows.csv` "Followed On" | `2026-01-01 00:00:00 UTC` | rule 1 |
| `Job Applications.csv` / `Saved Jobs.csv` dates | `2026-07-01 00:00:00 UTC` | rule 1 |
| `Notes.csv` "Created On" | `15 Sep 2026` | rule 5 |

### 2.4 Other realism notes worth mirroring

- LinkedIn profile URLs are written in full form, e.g. `https://www.linkedin.com/in/maria-garcia/`
  (`url_for()`, `make_fixtures.py:92-93`) — the trailing slash and `https://www.` prefix are
  both stripped by `normalizeProfileUrl` (§1.5), so either the bare `linkedin.com/in/<slug>`
  or the full URL round-trips identically.
- `messages.csv` rows are written fully quoted (`quote_all=True`, `make_fixtures.py:262`,
  `:567`) — not required by the parser, but realistic.
- Multi-recipient fields (`RECIPIENT PROFILE URLS`, `TO` names in a group thread) are
  semicolon-joined (`make_fixtures.py:201-208`, `:536-558`).
- A believable network graph clusters people by employer and by small friend/former-colleague
  groups (`make_fixtures.py:133-175` — dozens of connections sharing ~10 companies, e.g.
  `Northgate Analytics`, `Brightwave Health`, `Ledgerline`, `Cobalt Pay`), which is what makes
  `companiesMatch`/former-colleague relationship bonuses exercise meaningfully.

---

## 3. Real-export realism: files the importer skips, and the legacy header

### 3.1 Legacy (pre-2020-ish) `Connections.csv` header

No `URL` column, no "Notes:" preamble:
```
First Name,Last Name,Email Address,Company,Position,Connected On
```
Still parses fully under §1.4's rules (header row found by `First Name`+`Last Name`
presence; absent `URL` column means every row's enrichment joins fall back to
name-matching only, §1.6).

### 3.2 ~12 common non-whitelisted files in a real "Get a copy of your data" export

None of these are ever read (basename not in `WHITELIST`, §1.1) — they exist purely to make
a generated zip realistic and to prove the importer's whitelist behavior (files should land
in `summary.filesSkipped`, `lib/linkedinExport.ts:49`, `:984-988`).

| File | Plausible header row |
|---|---|
| `Registration.csv` | `Registered At, Ip Address, Ip Country Code` |
| `Email Addresses.csv` | `Email Address, Confirmed, Primary, Updated At, Made Primary At` |
| `PhoneNumbers.csv` | `Extension, Phone Number, Type` |
| `Ad_Targeting.csv` | `Category, Value` |
| `Rich_Media.csv` | `Asset, Media Url, Filename` |
| `Learning.csv` | `Content Name, Content Type, Content Watched, Watched At, Learning Platform` |
| `Reactions.csv` | `Date, Type, Link` |
| `Comments.csv` | `Date, Link, Message` |
| `Shares.csv` | `Date, SharedUrl, ShareCommentary, ShareLink, Visibility` |
| `SearchQueries.csv` | `Time, Search Query` |
| `Inferences_about_you.csv` | `Category, Segment, Inference` |
| `Member_Follows.csv` | `Followed On, Entity, Preference` |
| `Receipts_v2.csv` | `Transaction Date, Description, Amount, Currency, Payment Method` |
| `Logins.csv` | `Login Type, Date, IP Address, User Agent` (already used as a "must-skip" fixture in `make_fixtures.py:384-388`, `:763-765`) |
| `Security Challenges.csv` | `Challenge Type, Date` (`make_fixtures.py:390`, `:769`) |

**Basic vs Complete export**: LinkedIn's "Basic" export is a much smaller subset — in
practice `Registration.csv`, `Profile.csv`, `Email Addresses.csv`, `PhoneNumbers.csv`,
`Connections.csv`, and a handful of security/account files, with **no** `messages.csv`,
`Invitations.csv`, `Notes.csv`, `Endorsement_Received_Info.csv`,
`Recommendations_Received.csv`, `Positions.csv`, `Education.csv`, `Skills.csv`, learning,
ads, or activity files. "Complete" (the "Download the larger archive" checkbox) additionally
includes essentially every file in the two tables above plus all 14 whitelisted files. A
"Basic"-shaped generated zip should therefore include `Connections.csv` + `Profile.csv` +
maybe `Email Addresses.csv`/`PhoneNumbers.csv`/`Registration.csv`, and omit the rest; a
"Complete"-shaped one includes the full whitelist plus most/all of the 12+ skip-files above.

---

## 4. Summary for generator authors

1. Every whitelisted file must use one of the header spellings in §1's tables (exact
   strings the code's `readTable`/`t.col()` calls look up) — anything else silently produces
   empty enrichment for that file, not an error.
2. Dates must use one of the seven `parseLinkedInDate` shapes (§1.13) and must be ≤ the
   dataset's "today" (2026-09-28) and ≤ the file's own export date.
3. Profile URLs must be `https://www.linkedin.com/in/<slug>/`-shaped (or the bare
   `linkedin.com/in/<slug>` form) to join by URL; anything else forces a name-only join,
   which requires the name to be unique across `Connections.csv`.
4. Keep People fictional; keep Companies/universities/cities/industries real.
5. A BOM at the start of any generated CSV text is optional — the importer strips it either
   way (§1.3).
