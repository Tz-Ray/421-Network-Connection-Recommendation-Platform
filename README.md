# Network Connection Recommendation Platform

## Project summary

### One-sentence description of the project

Upload your LinkedIn connections export, say who you are looking for in plain language, and get a ranked,
explained shortlist of the people already in your own network to reach out to first.

### Additional information about the project

Most people's best introduction is already somewhere in their LinkedIn contacts, buried under a few thousand
rows they will never scroll through. This platform turns that export into something searchable: you sign in,
upload the full LinkedIn data export `.zip` (or just `Connections.csv`, or a JSON file), confirm the parsed
rows, and then type what you actually want ("VP of Sales at a fintech company", "someone who can review my
data engineering resume"). A local ranker reads each title by its meaning, ranks every connection, and shows
its score and the reasons it matched, so the ranking is never a black box. When you upload the full export,
the app also reads how well you know each person (message counts and dates, shared employers, endorsements,
recommendations) without keeping any message text, and among equally good matches it puts the people you know
better first. You can mark any result Relevant or Irrelevant, and the next run of the same search follows your
votes. An optional meaning-based search runs a small language model in your browser to also find people whose
titles mean what you asked for without using the same words. You can save searches and star people to come back
to, and, if you choose to share, see which other members know the same people you do.

From there you can ask Google Gemini to rerank the top candidates and explain each pick, or open a chat and ask
about your network in sentences. The AI only ever reorders and explains candidates the local pass already
produced, so it cannot invent a contact you do not have. Your uploaded network stays in your own account:
connections live in Firestore under `users/{uid}/connections` and the security rules make them readable and
writable only by you.

This is the project of Tz-Ray Wang and Alan Qiu for Washington State University's CptS 421 (sprints 1-3) and
CptS 423 (sprints 4-6). The frontend is Vite, React 19 and TypeScript; authentication and storage are Firebase
Auth and Cloud Firestore; the AI features go through a small proxy that holds the Gemini API key server-side so
it never reaches the browser (a Node server for local development, a free Cloudflare Worker for the hosted site). Sprint reports and plans are linked under Additional
Documentation below.

## Installation

### Prerequisites

- Node.js 20 or newer (developed and verified on v24.13.1) and npm.
- A Firebase project with Email/Password and Google sign-in enabled in Authentication, and Cloud Firestore
  created. Firebase authorizes `localhost` by default; any other domain you serve the app from must be added
  to Authentication's authorized domains, or Google sign-in fails with a domain error (this was issue #18).
- A Google Gemini API key, for the AI Rerank button and the chat screens. Everything else works without one.
- The Firebase CLI (`npm install -g firebase-tools`) only if you intend to deploy.
- A Cloudflare account only if you intend to deploy the hosted AI proxy (`worker/`). Running the Worker locally
  needs no account.

### Add-ons

- **Firebase Authentication** - email/password and Google popup sign-in; the single source of session state.
- **Cloud Firestore** - stores the profile document `users/{uid}`, the per-user `users/{uid}/connections`
  collection, your ranking votes (`users/{uid}/rankingFeedback`), saved searches (`users/{uid}/savedSearches`)
  and Saved Connections (`users/{uid}/favorites`), all restricted to the owner by `firestore.rules`, plus a
  create-only feedback log (`ranking_telemetry`) that clients cannot read and the opt-in shared graph
  (`graph_people`, `graph_members`), which holds only a hash of each profile link and members' ids and display
  names.
- **Firebase Hosting** - serves the built `dist/` folder with an SPA rewrite.
- **Google Gemini, via the AI proxy** - reranks search results and answers chat questions; the proxy keeps the
  API key off the client. `server/index.js` is the Node proxy for local development; `worker/` is the same proxy
  as a Cloudflare Worker for the hosted site.
- **Cloudflare Workers, Wrangler and a Durable Object** (`worker/`) - host the AI proxy on Cloudflare's free plan;
  Wrangler runs it locally and deploys it, and a SQLite-backed Durable Object keeps the rate-limit counters
  across restarts.
- **Transformers.js** (`@huggingface/transformers`, with the `all-MiniLM-L6-v2` sentence-embedding model) - runs
  meaning-based search in a Web Worker in the browser; it is downloaded only when a user turns the feature on.
- **Recharts** - the chart component on the Dashboard screen.
- **React Router** - hash-based routing and the auth-aware route guards.
- **Tailwind CSS via CDN** - styling and the shared glass/bento utility classes, configured inline in
  `index.html`; there is no Tailwind build step.

### Installation Steps

Clone the repo, then install and run the frontend:

```bash
npm install
npm run dev          # http://localhost:3000
```

In a second terminal, install and run the AI proxy (needed for AI Rerank and the chat screens):

```bash
cd server
npm install
npm run dev          # http://localhost:8787
curl localhost:8787/health
```

The proxy's routes, request and response shapes, error codes and limits are described in
[server/README.md](server/README.md).

The hosted site uses the Cloudflare Worker version of the proxy in `worker/` instead. To run it locally (no
Cloudflare account needed; it uses mock replies here):

```bash
cd worker
npm install
printf 'GEMINI_MOCK=1\nAI_ACCESS=public\n' > .dev.vars   # gitignored local settings
npx wrangler dev                                        # http://localhost:8788
curl localhost:8788/health
```

Then start the frontend against it with `VITE_AI_PROXY_URL=http://localhost:8788 npm run dev`. The Worker's
access switch (`off`, `allowlist`, `public`), limits, secrets, tests and deploy steps are described in
[worker/README.md](worker/README.md).

Copy `.env.example` to `.env.local` in the repository root and fill in the values. They come from your own
Firebase console and Google AI Studio account. Never commit `.env.local`; it is gitignored:

```bash
cp .env.example .env.local
```

The `VITE_*` variables are read by the browser bundle; `GEMINI_*` are read only by the proxy, which loads
`.env.local` and then `.env` from the repository root. `AI_PROXY_PORT` overrides the proxy port if 8787 is
taken. Restart `npm run dev` after changing any `VITE_*` value.

The proxy only serves signed-in users: every AI request carries the user's Firebase ID token, which the proxy
verifies against `VITE_FIREBASE_PROJECT_ID` (or `FIREBASE_PROJECT_ID` if set). Optional proxy settings, all
with working defaults: `AI_PROXY_ALLOWED_ORIGINS` (comma-separated CORS allowlist; defaults to localhost:3000
and the Firebase Hosting domains), `AI_RATE_LIMIT_PER_MIN` (10) and `AI_RATE_LIMIT_PER_DAY` (40) per user, and
`GEMINI_MOCK=1` to answer with canned replies during testing without spending Gemini quota.

There is no lint script and no `npm test` script in this repo. The checks to run before committing are the
typechecker, the test-data tests (286 tests covering the sample files and the importer's expected output) and
the meaning-based search tests (19 tests, no network needed):

```bash
npx tsc --noEmit
node --test testdata/tests/*.test.ts
node --test lib/semantic/*.test.ts
```

**Sample data.** Real data is your own LinkedIn export (see Functionality, step 2). To try the app without
one, upload any of the synthetic sample files in `testdata/`: ten full export zips in
`testdata/networks/full/` (for example `N04_kristine-chua.zip`) and ten plain `Connections.csv` files in
`testdata/networks/classic/`. All people in them are fictional. [testdata/README.md](testdata/README.md)
describes each file and the expected importer output. The files are generated from a fixed seed; edit the
generator rather than the outputs, then regenerate with:

```bash
node testdata/generator/generate.mjs
```

To deploy the frontend (Firebase project `connectionrecommender`), a production build must be told where the
AI proxy lives. Set `VITE_AI_PROXY_URL` in the shell to the deployed Worker's URL, or to `off` to ship with the AI
features switched off (the AI page, AI Rerank and the chat bubble then say so instead of failing). The build
fails on purpose when the variable is missing or points at `localhost`, which is what `.env.local` holds for
development, since the bundle would otherwise call each visitor's own machine. The shell value overrides
`.env.local`:

```bash
VITE_AI_PROXY_URL=https://<your-worker>.workers.dev npm run build && firebase deploy --only hosting
firebase deploy --only firestore    # after editing firestore.rules
```

The Worker itself is deployed with `npx wrangler deploy` from `worker/`, and its secrets (the Gemini API key, the
access switch and the allowlist) are set with `npx wrangler secret put`, never written to a file; see
[worker/README.md](worker/README.md). Hosting the proxy on Google Cloud (Cloud Run or Cloud Functions) would need
the Firebase project on the paid Blaze plan, which this project does not use. The `functions/` folder holds an
unused Cloud Functions version of the proxy that the app never calls; see
[functions/README.md](functions/README.md).

## Functionality

1. **Register or log in.** Open http://localhost:3000. You land on `/login`. Create an account at
   `/register` with an email and password, or use the Google button on either screen. "Forgot Password?"
   sends a Firebase reset email to the address typed in the email field. The app also has its own
   `/reset-password` page for choosing the new password; the emailed link opens it once the Firebase
   project's email action URL (Authentication, Templates) points at the deployed site, and until then it
   opens Firebase's hosted reset page. Signed-in users who visit `/login` are sent straight to `/dashboard`.
2. **Upload your connections.** Go to Recommender in the sidebar. Download your data from LinkedIn
   (Settings, Data privacy, Get a copy of your data), either the full archive or just Connections, and choose
   the `.zip` LinkedIn sends you as-is. The zip is opened in your browser and only these files are ever
   decompressed: `Connections.csv` (required), `messages.csv`, `Invitations.csv`, `Notes.csv`,
   `Endorsement_Received_Info.csv`, `Recommendations_Received.csv`, `Profile.csv`, `Positions.csv`,
   `Education.csv`, `Skills.csv`, `Company Follows.csv`, `Job Applications.csv`, `Saved Jobs.csv` and
   `Job Seeker Preferences.csv`. Everything else in the archive (logins, ads, search history and so on) is
   listed as "skipped (not read)". From those files the app keeps only derived facts per connection (message
   counts and dates, who sent the invitation, your own note, endorsements, recommendations) plus a short
   profile context (headline, industry, positions, skills, target companies). An import summary shows the
   files used, how many connections each one matched, any warnings, and two privacy notes: "Message text is
   never stored; only counts and dates." and "AI requests include relationship facts (message counts, last
   contact month, shared employers) but never your notes or job applications." A plain `Connections.csv`, or
   a `.json` file with a top-level array of objects, still works as before. The CSV parser skips LinkedIn's
   "Notes:" preamble and recognizes the usual column names plus common synonyms (`Title` or `Role` for
   Position, `Org` or `Company` for Company).
3. **Review and confirm.** The staged rows appear in a preview table with a count and the percentage of rows
   missing a job title. Nothing is saved until you press Confirm. Confirming writes the rows to your Firestore
   account and caches a compact copy for the session, so searching never waits on the network.
4. **Search (local, no AI needed).** Type your criteria in the textarea, for example `VP Sales fintech` or
   `swe at Google`. Press Search. You get up to 10 results, each with a score, up to eight reason bullets, and
   the matched-token chips. The scorer reads a title by its meaning: whole-word matching, abbreviations
   including ambiguous ones that match every sense (`PM` = product or project manager, `CMO` = marketing or
   medical), word forms (`underwriting` finds `underwriter`), and a title's head noun (a "Physician Recruiter"
   is a recruiter, not a physician). Acronyms from initials also match (`ed` = Executive Director), industry
   queries (utilities, government, nonprofit, …) credit everyone at a matching company, and phrases like
   "covers energy" map to occupations. It normalizes company name variants (`J.P. Morgan`, `JPMorgan Chase &
   Co.`), reads an industry off the company name when the title alone doesn't say enough (a "Partner" at a law
   firm is legal), understands hiring and leadership phrasing ("hire designers", "hospital leadership"), and
   corrects typos it can't otherwise place with a `(you typed "...")` note. Words from your own LinkedIn notes
   on a person count as matches too. People who match more of your query terms always rank first; among people
   who match comparably well, a relationship bonus of up to 15 points (recent and two-way messages, a shared
   current or former employer, a company on your target list, an endorsement or recommendation, an invitation
   they sent you) moves the people you know better up, shown as chips such as `12 msgs · Aug 2026`, `Former
   colleague`, `Also at Acme` or `Target company`, plus a `Relationship:` line. The bonus needs a zip import
   and only applies to people who already match the query. "Strict title-only" restricts a role query to title
   matches and has no effect on non-role queries. The "Meaning-based search" checkbox (off by default) also
   matches by meaning: turning it on downloads a ~23 MB model from Hugging Face (plus ~6 MB of runtime from
   jsDelivr) once and runs it in your browser; your connections never leave it.
5. **AI Rerank (needs the AI proxy).** Locally, run one of the proxies above. On the hosted site, AI is
   available only to allowlisted accounts; other accounts see a short note saying why. Press AI Rerank instead
   of Search. The top 50 locally scored
   candidates are sent to Gemini, which reorders them and adds an `AI:` explanation line per result. The score
   badge and chips still come from the local pass. AI Rerank always works from the keyword ranking, even when
   meaning-based search is on.
6. **Ranking feedback.** Each result card has Relevant and Irrelevant buttons. A vote is saved to your account
   for that query (case and extra spaces ignored) and takes effect the next time you run it. Search and AI
   Rerank then take the top 50 local matches, put the people you marked relevant first, keep the rest in
   order, and put the people you marked irrelevant last, before showing the first 10. A person you marked
   relevant is shown even if they were outside the first 10, and after AI Rerank even if Gemini did not pick
   them. Each moved result gets a `Moved up:`, `Moved down:` or `Added:` reason line, and the status line says
   how many of the shown results your votes moved. People you marked irrelevant appear in a collapsed "Marked
   irrelevant (N)" section below the results, where you can switch them back to Relevant. While a search loads
   your votes, the button shows "Searching…", and a double click saves only one vote.
7. **Saved searches and Saved Connections.** On the Recommender, save the current search under a title and run
   it again later with one click (Run needs a confirmed set of connections). The star on each result card saves
   that person to the Saved Connections panel. Both lists are stored in your account, visible only to you, and
   survive a reload.
8. **Connections page.** The Connections screen lists what is saved in your account, independent of this
   browser session. "Use in Recommender" loads that saved set back into the Recommender so you can search it
   without re-uploading.
9. **Network page.** The Network item in the sidebar lets you opt in to sharing your connections with other
   members (only a one-way hash of each profile link and your display name are stored). It shows an interactive
   graph: you in the centre, the other sharing members around you, and the people you have in common in
   between, named from your own list only. Hover or click a member to see the people you both know. A "What the
   database stores" view shows the stored records next to the names your own list gives them. While you share,
   the Connections page also has an "In common" column and a "Most in common" sort. Stop sharing removes you from
   the shared graph.
10. **AI chat (needs the AI proxy, as in step 5).** The AI item in the sidebar opens a full-page chat over your
   connections, and a floating chat button is available on every signed-in screen. Ask things like "who can
   introduce me to someone in medical devices". Both surfaces read your saved connections and answer with a
   numbered list of people and why each was picked.
11. **Dashboard.** Shows how many connections are saved in your account, the share missing a job title, the
   number of distinct companies, a Top companies chart, and your five most recent connections.
12. **Profile.** Click your avatar in the header to edit your display name, photo URL, job title, date of
   birth, bio, gender and pronouns. The header shows your name and job title from that document.
13. **Log out.** The sidebar's Logout button signs you out and clears the cached connections from the browser
    session, so the next person to sign in on that machine never sees your network.

## Known Problems

- The local Node proxy's per-user rate limit is held in memory, so it resets whenever the proxy restarts and is
  not shared between proxy instances. The hosted Cloudflare Worker keeps its limits in a Durable Object instead.
- The sidebar's Portfolio, Pipeline, Insights and Documents entries are placeholders marked "Soon".
- On the hosted site (connectionrecommender.web.app), AI Rerank, the AI page and the chat bubble work only for
  allowlisted accounts. The AI proxy runs on the Gemini free tier, which allows about 20 requests per model per
  day, so it is not open to everyone; other accounts see a note explaining why. When the Worker's access switch
  is `off`, every account sees the AI-off notice.
- The Gemini free tier allows 20 requests per day per model per project. When it is exhausted the proxy
  returns a 503 naming the model instead of retrying (`server/index.js:536-541`); setting
  `GEMINI_FALLBACK_MODEL` buys one more model's daily budget.
- The CSV parser finds the header row by looking for one containing both "First Name" and "Last Name"; if no
  row matches (renamed columns, a non-English export) it falls back to treating row 0 as the header
  (`lib/connectionFields.ts:222`), which for a real LinkedIn export is the "Notes:" preamble. Only
  comma-delimited, UTF-8 files are handled; there is no delimiter detection, no encoding handling beyond a
  BOM strip, no row cap and no per-row error reporting.
- A connection that matches nothing in your query scores 0 and is filtered out of results entirely (the
  `rankConnections` loop in `lib/search.ts`), so rows with a missing title or company can be invisible rather
  than ranked low (issue #30). Meaning-based search adds back at most 10 such rows, and only when their title
  and company are close in meaning to the query (`lib/semantic/fusion.ts`); a row with neither a title nor a
  company is never added, and nothing is added with "Strict title-only" on.
- AI Rerank always starts from the keyword ranking (`aiRerank` in `screens/RecommenderScreen.tsx`), even when
  meaning-based search is on, so people that meaning-based search added or moved up are not sent to Gemini.
- Meaning-based search downloads about 23 MB of model and about 6 MB of runtime the first time it is turned on
  in a browser, and it has to read every connection's title once per page load: on 1,450 connections the first
  search took 17.5 s in our test.
- The job-title and industry knowledge (abbreviations, head nouns, company-to-industry keywords) is a
  hand-written English list in `lib/searchTaxonomy.ts`, not a general model: an unusual or niche title, or a
  non-English export, falls back to plain word matching instead of being understood.
- Saving connections replaces the whole collection and is serialized only within one browser tab
  (`lib/connectionsStore.ts:245-257`). Confirming uploads from two tabs or two devices at the same time can
  interleave.
- Signals from a LinkedIn export zip are joined to connections by profile URL. When a file's row has no
  usable profile URL (always the case for `Recommendations_Received.csv`), the importer falls back to the
  person's name, and only when exactly one connection has that name: people who share a name with another
  connection get no signals from those rows, and a name spelled differently in two files does not match.
- Which side of a message thread is yours is inferred, not read: the owner is taken to be the profile URL
  that appears in the most conversations without being one of your connections, with the name in
  `Profile.csv` as a tiebreaker. If that cannot be decided, message history is skipped with a warning in the
  import summary; a wrong guess would misattribute sent and received counts. Group threads with more than
  five other people are ignored.
- The zip is read and unzipped entirely in the browser, in memory. Only the whitelisted files are
  decompressed, but the whole archive is loaded first, so a very large export (years of messages) can be
  slow or run out of memory on a phone or low-memory machine; uploading `Connections.csv` alone still works.
- The shared connection graph has no server of its own, so the database rules cannot check that a member really
  knows a person: a sharing member who knows someone's profile link can add themselves to that person's record
  and see which other members know them. The opt-in text on the Network page says so. People without a valid
  LinkedIn profile link are not shared at all.

## Contributing

This is a course project with an all-rights-reserved license (see License below), so changes come only from
the two team members, Tz-Ray Wang and Alan Qiu. Anyone else can propose a change or report a bug by opening a
GitHub issue.

The team's own workflow:

1. Open or pick a GitHub issue for the change.
2. Work on a feature branch, or on `main` with a commit the other team member has reviewed.
3. Before pushing, run `npx tsc --noEmit`, `node --test testdata/tests/*.test.ts` and
   `node --test lib/semantic/*.test.ts`; all must pass.
4. Reference the issue in the commit message or pull request, and close it when the change is merged.

## Additional Documentation

Sprints 1-3 were part of CptS 421 (spring 2026); sprints 4-6 are part of CptS 423 (fall 2026).

Sprint reports and plans:

- [Sprint reports index](reports/README.md) - every sprint's report, slides and video in one table.
- [Sprint 5 report](reports/sprint-5/sprint-5-report.md) and
  [Sprint 5 presentation](reports/sprint-5/sprint-5-presentation.pptx) - the current sprint (CptS 423).
- [Sprint 4 report](reports/sprint-4/sprint-4-report.md) and
  [Sprint 4 presentation](reports/sprint-4/sprint-4-presentation.pptx) (CptS 423; video:
  https://youtu.be/mZMDa78OG2M).
- [CptS 423 sprint 4-6 plan](reports/plans/cpts423-sprint-4-6-deliverables.pdf) - planned deliverables and
  owners for sprints 4-6.
- [Sprint 3 report](reports/archive/sprint-3/sprint-3-report.md) (CptS 421).
- [Sprint 2 report](reports/archive/sprint-2/sprint-2-report.pdf),
  [Sprint 2 presentation](reports/archive/sprint-2/sprint-2-presentation.pptx) and
  [Sprint 2 video links](reports/archive/sprint-2/sprint-2-video-links.txt) (CptS 421; video:
  https://youtu.be/2E1b6IBm9fI).

Developer references:

- [testdata/README.md](testdata/README.md) - the synthetic sample networks, expected outputs and tests.
- [server/README.md](server/README.md) - the AI proxy's configuration, routes, errors and limits.
- [worker/README.md](worker/README.md) - the Cloudflare Worker version of the proxy used by the hosted site:
  access switch, limits, local run, tests and deploy.
- [bench/README.md](bench/README.md) - the reproducible ranking benchmark and how to read its numbers.
- [functions/README.md](functions/README.md) - why the Cloud Functions copy of the proxy is unused.
- [.env.example](.env.example) - every environment variable the frontend and the proxy read.

User links:

- Hosted app: https://connectionrecommender.web.app (AI features work there only for allowlisted accounts; see
  Known Problems).

## License

Copyright (c) 2026 Tz-Ray Wang and Alan Qiu. All rights reserved.

This project was built at a client's request, and no open-source license has been granted. The code is
publicly viewable for course review only; it may not be used, copied, modified or redistributed without
written permission from the authors. See [LICENSE](LICENSE).
