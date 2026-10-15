# AI proxy on Cloudflare Workers

The hosted version of the AI proxy. It serves the same contract as the Node proxy in `server/` (routes, request
and response shapes, error statuses; see `server/README.md`), so the app's AI Rerank button, the `/ai` chat
screen and the floating chat widget work unchanged against either one. It runs on the Cloudflare **Workers
Free** plan (no card on file). `server/` stays as it is: local development and the demo driver keep using it.

Files: `src/index.js` (routing, CORS, Firebase ID-token check, access switch), `src/gemini.js` (prompts, Gemini
calls, the rerank fallback chain, chat, mock replies; a port of `server/index.js`, keep the two in step),
`src/limiter.js` (rate limits in a SQLite-backed Durable Object), `wrangler.toml` (non-secret settings),
`test/` (integration tests against `wrangler dev`).

## The access switch

`AI_ACCESS` decides who may use the AI routes. It is a secret, so changing it needs no code change and no
rebuild of the website:

```bash
npx wrangler secret put AI_ACCESS      # then type: off | allowlist | public
```

| Value | Behavior |
|---|---|
| `off` (default; also used for a missing or unknown value) | Every AI route answers 503 "AI features are switched off right now." before any token check. `/health` reports `access: "off"`, and the website then shows its AI-off notice and hides the chat bubble. |
| `allowlist` | Only signed-in users whose uid is in the `AI_ALLOWED_UIDS` secret (comma-separated). Everyone else gets 403. |
| `public` | Any signed-in user, with the per-user and per-address daily limits, the shared daily cap and its demo reserve (below). Visitors from the EEA, Switzerland and the UK (`request.cf.country` in `AI_BLOCKED_COUNTRIES`) get 403, and so do visitors whose country Cloudflare can't tell (empty, `XX`) or who come through Tor (`T1`), because the Gemini API Additional Terms allow only paid services for API clients offered to users there (checked 2026-10-15 at https://ai.google.dev/gemini-api/terms). The website shows a one-line free-tier disclosure next to the AI features. |

The plan is `public` (or `allowlist`) on a demo day and `off` afterwards. The website reads `/health` once per
page load (a change shows up on the next reload). When it says `allowlist` or `public`, the website also calls
`GET /access` (needs the user's token, never counted against any limit), which answers `{ "allowed": true }` or
`{ "allowed": false, "error": "<why>" }` for this user from where they are, so someone who isn't allowlisted, or
is in a blocked region, sees the reason instead of an AI button that only fails. `/access` exists only on the
Worker; `server/` doesn't need it.

## Limits

All counters live in one Durable Object with SQLite storage, so they are shared by every Worker instance and
survive restarts and deploys. A "day" is the calendar date in America/Los_Angeles, because the Gemini free-tier
daily quota resets at midnight Pacific time. A refused request is not counted, and neither are unknown routes,
`/access` or `/models`. A request is counted before its body is read, so malformed requests count too.

| Setting (`wrangler.toml`) | Default | Meaning |
|---|---|---|
| `AI_RATE_LIMIT_PER_MIN` | 10 | Requests per user in any sliding 60 seconds. |
| `AI_RATE_LIMIT_PER_DAY` | 5 | Requests per user per Pacific day. Allowlisted uids are exempt. |
| `AI_RATE_LIMIT_PER_IP_DAY` | 10 | Requests per network address (`CF-Connecting-IP`) per Pacific day, so throwaway accounts from one place can't use up the shared cap. Allowlisted uids are exempt. The address is kept only as a hash and dropped the next day. |
| `AI_GLOBAL_DAILY_CAP` | 34 | **Gemini calls** per Pacific day for everyone together, kept below the free tier (about 20 calls per model per day, primary plus fallback model). One request can make several calls (a retry, the fallback model, the strict second pass of rerank); each one counts. When the cap runs out in the middle of a request, a rerank falls back to the local order and a chat answers 503. |
| `AI_DEMO_RESERVE` | 6 | The last 6 calls of the shared cap are usable only by allowlisted uids, so a demo still works after public use. |

A refused request gets 429 with `Retry-After` (seconds until the window frees up, or until Pacific midnight).

## Configuration

Non-secret settings are `[vars]` in `wrangler.toml`: `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`,
`FIREBASE_PROJECT_ID`, `AI_PROXY_ALLOWED_ORIGINS`, the four limits above and `AI_BLOCKED_COUNTRIES`. Optional:
`GEMINI_THINKING_BUDGET` (same meaning as in `server/`).

Secrets are never written to a file in this repository. Set them with `npx wrangler secret put <NAME>`:

| Secret | Meaning |
|---|---|
| `GEMINI_API_KEY` | The Gemini API key. Only the project owner sets it. |
| `AI_ACCESS` | The access switch above. |
| `AI_ALLOWED_UIDS` | Comma-separated Firebase uids for `allowlist` mode and the demo reserve. Uids identify people, so they never go in `wrangler.toml`. |

Test-only settings, for local `.dev.vars` and the tests, **never** set on the deployed Worker:

| Setting | Meaning |
|---|---|
| `GEMINI_MOCK=1` | Canned replies, no Gemini call (same replies as `server/`). |
| `ALLOW_TEST_COUNTRY=1` | Lets an `X-Test-Country` header stand in for `request.cf.country`, to test the region check. Honored only while `GEMINI_MOCK` is on, so it can't be used to get around the region check on a real deployment. |

## Run it locally

```bash
cd worker
npm install
printf 'GEMINI_MOCK=1\nAI_ACCESS=public\n' > .dev.vars     # gitignored; local settings and secrets
npx wrangler dev                                          # http://localhost:8788, runs fully on this machine
curl localhost:8788/health
```

`wrangler dev` (without `--remote`) runs the Worker locally in `workerd`; nothing goes to Cloudflare and no
Cloudflare account is needed. Port 8788 avoids the Node proxy's 8787. Local Durable Object data is kept under
`.wrangler/` (gitignored).

To point a local website at it: `VITE_AI_PROXY_URL=http://localhost:8788 npm run dev` from the repository root
(port 3000 is in the CORS allowlist).

**Older Linux:** `workerd` needs glibc 2.35 or newer. On an older system (e.g. Ubuntu 20.04), set
`MINIFLARE_WORKERD_PATH` to a wrapper that runs it under a newer glibc. The tests pick up such a wrapper
automatically from `local/workerd-glibc/workerd.sh` (gitignored, machine-specific) when it exists.

## Tests

```bash
cd worker && npm test
```

Each test file starts `wrangler dev` in local mode from a temporary folder with its own settings (the
developer's own `.dev.vars` is never used) and signs in to the shared Firebase test account to get real ID tokens
(its `NCRP_TEST_EMAIL`/`NCRP_TEST_PASSWORD` and the web API key come from the shell, else the repository's
`.env.local` or `.env`; the tests stop with a clear error when one is missing). They cover `/health`, `/access`, missing or bad tokens, CORS, the body-size cap, malformed JSON, every access
mode, the region check (and that the test-country header does nothing without mock replies), `/models` being
allowlist-only, unknown routes not being counted, the per-minute, per-user daily, per-address daily and shared
daily limits with the demo reserve, counters surviving a restart, long fields being clipped, and that the mock
rerank and chat replies match `server/`. Counting each extra Gemini call can't be tested with mock replies
(they make no call); it is covered by code review only. Run them one at a time with any
other job that signs in to the test account.

## Deploying (each step on the project owner's go-ahead)

```bash
npx wrangler login
npx wrangler deploy                       # public https://ncrp-ai-proxy.<account>.workers.dev
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put AI_ALLOWED_UIDS
npx wrangler secret put AI_ACCESS         # off until a demo day
```

Then build the website against it: `VITE_AI_PROXY_URL=https://ncrp-ai-proxy.<account>.workers.dev npm run build`
and deploy Hosting. With `AI_ACCESS=off` the site shows the AI-off notice, exactly like the old AI-off build.
Rollback: `AI_ACCESS=off`, or roll Hosting back to the previous release.

## Differences from `server/`

- Configuration comes from `wrangler.toml` and secrets, not `.env` files.
- The access switch, the region check, the per-address limit, the shared daily cap and the demo reserve are
  new; `/health` also reports `access`, and `GET /access` is new.
- The body cap is 256 KB instead of 2 MB (a real request is well under 100 KB, and parsing megabytes risks the
  Workers Free CPU limit). Criteria, the chat query and each chat message are cut to 1,000 characters, candidate
  names, titles and companies to 200, and only the first 500 candidates are read (the prompt shows 120).
- `/models` is for allowlisted accounts only. 500 and 502 errors show a generic message to everyone else, and the
  503 for an exhausted Gemini daily quota shows "used up today's free quota" without the configuration hint (the
  details are logged).
- If the strict second rerank pass fails, the answer is the local order with a `debug` note instead of an error.
- The API key travels in the `x-goog-api-key` header, never in a URL.
- A 400 from Gemini counts as "this model rejects `thinkingConfig`" only when its text mentions thinking.
- Rate limits are persistent (Durable Object) instead of in memory, and the day is the Pacific day, not UTC.
  The per-user daily default is 5 instead of 40.
- The models that reject `thinkingConfig` are remembered per Worker instance instead of per process.

## Privacy

Unchanged from `server/`: only names, titles, companies, a short derived relationship summary per candidate and a
short summary of the user's own profile reach Gemini; never message text, notes or the user's name. Free-tier
Gemini may use what it receives to improve Google's products, which is why `public` mode shows the disclosure and
why demos use the test account and the fictional networks in `testdata/`.
