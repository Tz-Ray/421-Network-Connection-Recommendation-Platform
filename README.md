# Network Connection Recommendation Platform

## Project summary

### One-sentence description of the project

Upload your LinkedIn connections export, say who you are looking for in plain language, and get a ranked,
explained shortlist of the people already in your own network to reach out to first.

### Additional information about the project

Most people's best introduction is already somewhere in their LinkedIn contacts, buried under a few thousand
rows they will never scroll through. This platform turns that export into something searchable: you sign in,
upload the CSV or JSON file LinkedIn gives you, confirm the parsed rows, and then type what you actually want
("VP of Sales at a fintech company", "someone who can review my data engineering resume"). A local scorer
ranks every connection and shows its score and the exact tokens that matched, so the ranking is never a black
box. From there you can ask Google Gemini to rerank the top candidates and explain each pick, or open a chat
and ask about your network in sentences. The AI only ever reorders and explains candidates the local pass
already produced, so it cannot invent a contact you do not have. Your uploaded network stays in your own
account: connections live in Firestore under `users/{uid}/connections` and the security rules make them
readable and writable only by you.

This is the course-421 project of Tz-Ray Wang and Alan Qiu. The frontend is Vite, React 19 and TypeScript;
authentication and storage are Firebase Auth and Cloud Firestore; the AI features go through a small Node
proxy that holds the Gemini API key server-side so it never reaches the browser. Sprint materials and a
full requirements and traceability document are linked under Additional Documentation below.

## Installation

### Prerequisites

- Node.js 20 or newer (developed and verified on v24.13.1) and npm.
- A Firebase project with Email/Password and Google sign-in enabled in Authentication, and Cloud Firestore
  created. Firebase authorizes `localhost` by default; any other domain you serve the app from must be added
  to Authentication's authorized domains, or Google sign-in fails with a domain error (this was issue #18).
- A Google Gemini API key, for the AI Rerank button and the chat screens. Everything else works without one.
- The Firebase CLI (`npm install -g firebase-tools`) only if you intend to deploy.

### Add-ons

- **Firebase Authentication** - email/password and Google popup sign-in; the single source of session state.
- **Cloud Firestore** - stores the profile document `users/{uid}` and the per-user `users/{uid}/connections`
  collection, restricted to the owner by `firestore.rules`.
- **Firebase Hosting** - serves the built `dist/` folder with an SPA rewrite.
- **Google Gemini, via the local AI proxy** (`server/index.js`) - reranks search results and answers chat
  questions; the proxy keeps the API key off the client.
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

Create a `.env.local` file in the repository root with the following variable names (values come from your own
Firebase console and Google AI Studio account; never commit this file, it is gitignored):

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
VITE_AI_PROXY_URL=http://localhost:8787
GEMINI_API_KEY=
GEMINI_MODEL=
GEMINI_FALLBACK_MODEL=
```

The `VITE_*` variables are read by the browser bundle; `GEMINI_*` are read only by the proxy, which loads
`.env.local` and then `.env` from the repository root. `AI_PROXY_PORT` overrides the proxy port if 8787 is
taken. Restart `npm run dev` after changing any `VITE_*` value.

The proxy only serves signed-in users: every AI request carries the user's Firebase ID token, which the proxy
verifies against `VITE_FIREBASE_PROJECT_ID` (or `FIREBASE_PROJECT_ID` if set). Optional proxy settings, all
with working defaults: `AI_PROXY_ALLOWED_ORIGINS` (comma-separated CORS allowlist; defaults to localhost:3000
and the Firebase Hosting domains), `AI_RATE_LIMIT_PER_MIN` (10) and `AI_RATE_LIMIT_PER_DAY` (40) per user, and
`GEMINI_MOCK=1` to answer with canned replies during testing without spending Gemini quota.

There is no lint or unit-test script in this repo. The one check to run before committing is the typechecker:

```bash
npx tsc --noEmit
```

To deploy the frontend (Firebase project `connectionrecommender`), set `VITE_AI_PROXY_URL` to a reachable
proxy URL first; a production build without it fails on purpose, since the bundle would otherwise call
`http://localhost:8787` from each visitor's own machine. Then:

```bash
npm run build && firebase deploy --only hosting
firebase deploy --only firestore    # after editing firestore.rules
```

## Functionality

1. **Register or log in.** Open http://localhost:3000. You land on `/login`. Create an account at
   `/register` with an email and password, or use the Google button on either screen. "Forgot Password?"
   sends a Firebase reset email to the address typed in the email field. Signed-in users who visit `/login`
   are sent straight to `/dashboard`.
2. **Upload your connections.** Go to Recommender in the sidebar. Download your connections from LinkedIn
   (Settings, Data privacy, Get a copy of your data, Connections) and drop the `.csv` in. A `.json` file with
   a top-level array of objects also works. The parser skips LinkedIn's "Notes:" preamble and recognizes the
   usual column names plus common synonyms (`Title` or `Role` for Position, `Org` or `Company` for Company).
3. **Review and confirm.** The staged rows appear in a preview table with a count and the percentage of rows
   missing a job title. Nothing is saved until you press Confirm. Confirming writes the rows to your Firestore
   account and caches a compact copy for the session, so searching never waits on the network.
4. **Search (local, no AI needed).** Type your criteria in the textarea, for example `VP Sales fintech` or
   `swe at Google`. Press Search. You get up to 10 results, each with a score, up to five reason bullets, and
   the matched-token chips. "Strict title-only" restricts a role query to title matches and has no effect on
   non-role queries.
5. **AI Rerank (needs the proxy running).** Press AI Rerank instead of Search. The top 50 locally scored
   candidates are sent to Gemini, which reorders them and adds an `AI:` explanation line per result. The score
   badge and chips still come from the local pass.
6. **Connections page.** The Connections screen lists what is saved in your account, independent of this
   browser session. "Use in Recommender" loads that saved set back into the Recommender so you can search it
   without re-uploading.
7. **AI chat (needs the proxy running).** The AI item in the sidebar opens a full-page chat over your
   connections, and a floating chat button is available on every signed-in screen. Ask things like "who can
   introduce me to someone in medical devices". Both surfaces read your saved connections and answer with a
   numbered list of people and why each was picked.
8. **Dashboard.** Shows how many connections are saved in your account, the share missing a job title, the
   number of distinct companies, a Top companies chart, and your five most recent connections.
9. **Profile.** Click your avatar in the header to edit your display name, photo URL, job title, date of
   birth, bio, gender and pronouns. The header shows your name and job title from that document.
10. **Log out.** The sidebar's Logout button signs you out and clears the cached connections from the browser
   session, so the next person to sign in on that machine never sees your network.

## Known Problems

- The AI proxy's per-user rate limit is held in memory, so it resets whenever the proxy restarts and is not
  shared between proxy instances.
- The sidebar's Portfolio, Pipeline, Insights and Documents entries are placeholders marked "Soon".
- The Gemini free tier allows 20 requests per day per model per project. When it is exhausted the proxy
  returns a 503 naming the model instead of retrying (`server/index.js:513-516`); setting
  `GEMINI_FALLBACK_MODEL` buys one more model's daily budget.
- The CSV parser finds the header row by looking for one containing both "First Name" and "Last Name"; if no
  row matches (renamed columns, a non-English export) it falls back to treating row 0 as the header
  (`screens/RecommenderScreen.tsx:316`), which for a real LinkedIn export is the "Notes:" preamble. Only
  comma-delimited, UTF-8 files are handled; there is no delimiter detection, no encoding handling beyond a
  BOM strip, no row cap and no per-row error reporting.
- A connection that matches nothing in your query scores 0 and is filtered out of results entirely
  (`screens/RecommenderScreen.tsx:725`), so rows with a missing title or company can be invisible rather than
  ranked low (issue #30).
- Saving connections replaces the whole collection and is serialized only within one browser tab
  (`lib/connectionsStore.ts:148-153`). Confirming uploads from two tabs or two devices at the same time can
  interleave.
- Repository metadata is still partly scaffold: `package.json` is named `clever-app-name`, its `description`
  field holds a stray fragment, and no LICENSE file exists (see License below).

## Contributing

1. Fork it!
2. Create your feature branch: `git checkout -b my-new-feature`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin my-new-feature`
5. Submit a pull request :D

## Additional Documentation

- [Sprint 2 report](Sprint%202/Sprint%202%20report.pdf) - what shipped in Sprint 2, unfinished work,
  retrospective and Sprint 3 plans.
- [Business Plan Presentation](Sprint%202/Business%20Plan%20Presentation.pptx) - the Sprint 2 deck.
- Sprint 2 video: https://youtu.be/2E1b6IBm9fI

## License

No license file has been added to this repository yet, so the code is currently "all rights reserved" by
default and nobody else has permission to reuse it. The team should pick a license and add it as
`LICENSE.txt`; the course template recommends the MIT license
(<https://choosealicense.com/licenses/mit/>). Note that `package.json` currently declares `"license": "ISC"`,
which does not match any file in the repo; whichever license is chosen, that field should be updated to agree
with it.
