# AI proxy

A small Node server that sits between the app and Google Gemini. It keeps `GEMINI_API_KEY` on the server so the
key never reaches the browser, and it serves the frontend's three AI features: the AI Rerank button on the
Recommender screen, the `/ai` chat screen and the floating chat widget. It is plain `node:http` with no
framework; everything is in `index.js`, and the only dependencies are `dotenv` and `jose`.

The proxy is for local development. The hosted site (https://connectionrecommender.web.app) is built with
`VITE_AI_PROXY_URL=off`, so it never calls a proxy and shows a notice where the AI features would be.

## Run it

```bash
cd server
npm install
npm run dev                  # node index.js on http://localhost:8787
curl localhost:8787/health
```

On startup `index.js` loads `.env.local` and then `.env` from the repository root (one level above `server/`).
A variable that is already set is never overwritten, so a value set in the shell wins over `.env.local`, which
wins over `.env`. `AI_PROXY_PORT` changes the port; a value that is not an integer from 1 to 65535 logs a
warning and falls back to 8787. The startup log shows the model, whether the key loaded, the rate limits, the
allowed origins and, when a Firebase project id is configured, the project whose tokens are accepted (otherwise
it warns that no project id is set and that every route except `/health` will answer 503).

The frontend finds the proxy through `VITE_AI_PROXY_URL`, resolved once in `lib/proxyClient.ts` (a dev build
with the variable unset uses `http://localhost:8787`). Every request goes through `proxyFetch` in that file,
which adds `Authorization: Bearer <Firebase ID token>` for the signed-in user.

## Configuration

Every environment variable the proxy reads:

| Variable | Default | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | none | Gemini API key. Without it `/health` reports `keyLoaded: false`, and rerank, chat (unless `GEMINI_MOCK` is on) and `/models` fail with a 500. |
| `GEMINI_MODEL` | `gemini-1.5-flash` | Primary model, for example `gemini-2.5-flash`. A leading `models/` is stripped. |
| `GEMINI_FALLBACK_MODEL` | `gemini-1.5-flash` | Model tried once when the primary fails with a 502 or 503. An empty value normalizes to `gemini-1.5-flash`, so leaving it unset does not disable the fallback; it is skipped only when it equals the primary model. |
| `GEMINI_THINKING_BUDGET` | `0` | `thinkingBudget` sent to models that take `thinkingConfig` (see below). A non-numeric value means 0. |
| `AI_PROXY_PORT` | `8787` | Listening port. Invalid values fall back to 8787 with a warning. |
| `FIREBASE_PROJECT_ID` | value of `VITE_FIREBASE_PROJECT_ID` | Firebase project whose ID tokens are accepted. If both are empty, every route except `/health` answers 503. |
| `VITE_FIREBASE_PROJECT_ID` | none | Read only as the fallback for `FIREBASE_PROJECT_ID`; it is the same variable the frontend uses. |
| `AI_PROXY_ALLOWED_ORIGINS` | see below | Comma-separated CORS allowlist. Entries are trimmed and trailing slashes dropped. A non-empty list replaces the defaults. |
| `AI_RATE_LIMIT_PER_MIN` | `10` | Requests per user in any sliding 60-second window. |
| `AI_RATE_LIMIT_PER_DAY` | `40` | Requests per user per UTC day. |
| `GEMINI_MOCK` | off | `1`, `true`, `yes` or `on` (any case): rerank and chat answer with canned replies and make no Gemini call. Testing only: set it in the shell, never leave it in `.env.local`. |

The default origins are `http://localhost:3000`, `http://127.0.0.1:3000`,
`https://connectionrecommender.web.app` and `https://connectionrecommender.firebaseapp.com`. For the two rate
limits, a value that is not a positive integer logs a warning and uses the default.

## Request handling order

Every request passes through these steps in this order:

1. **CORS.** A request with no `Origin` header (curl, scripts) passes with no CORS headers. An allowed `Origin`
   (compared after trimming and dropping trailing slashes) gets `Access-Control-Allow-Origin` set to that
   origin, `Vary: Origin`, allowed methods `GET, POST, PUT, DELETE, OPTIONS`, allowed headers
   `Content-Type, Authorization` and `Access-Control-Max-Age: 600`. A disallowed `Origin` gets only
   `Vary: Origin`: its preflight is refused (next step), and a real request is still processed and still needs
   a token, but without `Access-Control-Allow-Origin` the browser does not let the page read the response.
2. **`OPTIONS`**, on any path: 403 `{"error": "Origin not allowed."}` for a disallowed origin, otherwise 204
   with an empty body.
3. **`GET /health`**, the only public route.
4. **Token check** (`verifyIdToken`). The `Authorization: Bearer <token>` header must hold a Firebase ID token.
   It is verified with `jose` against Google's public keys for Firebase ID tokens (the `securetoken` JWKS,
   cached, and refetched when an unknown key id appears), algorithm RS256, issuer
   `https://securetoken.google.com/<project id>` and audience `<project id>`, and it must carry a `sub` (the
   user id). `email_verified` is not required. A missing or
   malformed header gets 401 `Sign in to use the AI proxy.`; a token that fails verification gets 401
   `Sign in again to use the AI proxy.` The underlying JWT error is logged on the server, never returned. With
   no project id configured this step answers 503 `Proxy auth is not configured.`
5. **Rate limit** (`rateLimit`), per user id: a sliding 60-second window and a counter that resets at UTC
   midnight. Over either limit the answer is 429 with a `Retry-After` header in seconds (until the oldest
   request leaves the window, or until UTC midnight). A request is charged here, before the body is read, so
   malformed bodies, `/models` calls and requests to unknown paths all count. Requests the limiter rejects are
   not charged.
6. **Routing.** `GET /models`, `POST /gemini/rerank`, `POST /gemini/chat`; anything else is a 404. Only the two
   POST routes read a body.

Because the token check comes first, an unknown path without a token answers 401, not 404.

## Routes

### `POST /gemini/rerank`

Picks and orders the best candidates for a search. Used by AI Rerank on the Recommender screen and as a
fallback by the `/ai` screen.

```json
{
  "criteria": "VP of Sales at a fintech company",
  "candidates": [
    { "id": "c0", "name": "Jane Doe", "position": "VP Sales", "company": "Stripe",
      "relationship": "10+ messages; last contact Aug 2026; two-way" },
    { "id": "c1", "name": "John Roe", "position": "Account Executive", "company": "Plaid" }
  ],
  "context": "Headline: Sales leader; Current role: Account Executive at Acme"
}
```

```json
{
  "recommendations": [
    { "id": "c0", "reason": "Your most relevant match, and you message each other often." },
    { "id": "c1", "reason": "Sells for a fintech company." }
  ]
}
```

- `criteria` (required) is trimmed; an empty value is a 400. `candidates` (required) must be a non-empty array.
- Candidates that are not objects, or whose `id` is not a non-empty string or finite number, are dropped
  first; if none are left the answer is 400 `No valid candidates.`
- Only `id`, `name`, `position`, `company` and `relationship` go into the prompt, and only for the first 120
  candidates. Other fields are accepted and ignored. Use ids of the form `c0`, `c1`, `c2`: the prompts tell the
  model ids look like that, and the loose-text extractor only recognizes that form.
- `relationship` (optional, per candidate) and `context` (optional, per request) are free text about the user's
  relationship with a candidate and about the user. `sanitizeAiText` accepts strings only, collapses every run
  of whitespace (newlines included) to one space, replaces `|` with `/` (the prompt uses `|` as its field
  separator), trims, and caps the result at `RELATIONSHIP_MAX_LEN` (200) or `CONTEXT_MAX_LEN` (600) characters.
  A value that is not a string or is blank afterwards is dropped. `context` reaches the prompt as
  `About the user: ...`.
- Every returned `id` is one of the valid candidates sent, with no duplicates, at most 10 of them, each
  with a non-empty `reason`. `debug` appears only when the proxy gave up on the model (see the rerank fallback
  chain below).

### `POST /gemini/chat`

Answers a question about the user's network. Used by the `/ai` screen and the chat widget.

```json
{
  "query": "Who could introduce me to someone in fintech sales?",
  "messages": [
    { "role": "user", "text": "Who do I know at Stripe?" },
    { "role": "assistant", "text": "Jane Doe is a VP of Sales there." }
  ],
  "candidates": [ { "id": "c0", "name": "Jane Doe", "position": "VP Sales", "company": "Stripe" } ],
  "context": "Headline: Sales leader"
}
```

```json
{
  "answer": "Jane Doe leads sales at Stripe and is the closest match.",
  "recommendations": [ { "id": "c0", "reason": "VP of Sales at a fintech company." } ]
}
```

- `query` (required) is trimmed; an empty value is a 400. `candidates`, `relationship` and `context` follow the
  same rules as rerank.
- `messages` (optional) is the prior conversation; only the last 8 entries are kept. An entry with
  `role: "assistant"` is labelled as the AI, anything else as the user.
- `recommendations` is passed through as the model produced it: the proxy does not check the ids against the
  candidates, remove duplicates or cap the list (the prompt asks for up to 10). Match ids against the
  candidates you sent. `answer` can be an empty string when `recommendations` is not empty.
- `debug` appears only when the model's reply was not parseable JSON (see below).

Keep both response shapes stable: `{ recommendations: [{ id, reason }], debug? }` and
`{ answer, recommendations, debug? }`. The Recommender screen, the `/ai` screen and the chat widget depend on
them.

### `GET /health`

Public. No token, not rate limited.

```json
{
  "ok": true,
  "model": "gemini-2.5-flash",
  "keyLoaded": true,
  "fallbackModel": "gemini-3.5-flash-lite",
  "mock": false,
  "authConfigured": true,
  "hint": "Set GEMINI_MODEL like \"gemini-2.5-flash\" (no \"models/\")"
}
```

### `GET /models`

Needs a token and counts against the rate limit. Lists the models your key can call with `generateContent`;
`envValue` is the string to put in `GEMINI_MODEL`.

```json
{
  "currentModel": "gemini-2.5-flash",
  "note": "Use envValue in .env.local as GEMINI_MODEL=<envValue>",
  "generateContentModels": [
    { "name": "models/gemini-2.5-flash", "envValue": "gemini-2.5-flash", "displayName": "...",
      "supportedGenerationMethods": ["generateContent", "..."] }
  ]
}
```

## Errors

Errors are JSON `{ "error": string }` with the status below. The one exception is 404, which is plain text.

| Status | When |
|---|---|
| 400 | `Malformed JSON body.`; `Missing criteria.` (rerank); `Missing query.` (chat); `Missing candidates.` (absent, not an array, or empty); `No valid candidates.` |
| 401 | Missing or malformed `Authorization` header, or a token that fails verification. |
| 403 | `OPTIONS` preflight from an origin that is not on the allowlist. |
| 404 | An authenticated request for any other method or path; the body is the plain text `Not found`. There is no 405: a wrong method on a known path is also a 404. |
| 413 | Body larger than 2 MB (`MAX_BODY_BYTES`, 2,097,152 bytes). |
| 429 | Per-user rate limit reached; see `Retry-After`. |
| 502 | Gemini unreachable after all attempts (timeouts, network errors), or an upstream error status that is not retried or still failed on the last attempt. |
| 503 | Gemini reports a per-day quota (the free tier's daily limit) exhausted for the model; or proxy auth is not configured (no project id). |
| 500 | Anything unexpected, including a missing `GEMINI_API_KEY` and a failed `/models` lookup. |

When the fallback model is tried, the status comes from whichever model was tried last.

## Gemini behavior

- **Model.** `GEMINI_MODEL`, with any leading `models/` stripped, defaults to `gemini-1.5-flash`. Calls go to
  the `v1beta` `generateContent` endpoint with `responseMimeType: application/json` and
  `maxOutputTokens: 1400`. Temperature is 0.2 for rerank, 0.0 for the strict rerank pass and 0.3 for chat.
- **Thinking.** For models whose name matches `gemini-2.5` or `gemini-3` through `gemini-9`
  (`wantsThinkingConfig`), the request carries `thinkingConfig: { thinkingBudget: 0 }` (or
  `GEMINI_THINKING_BUDGET`). Thinking tokens count against `maxOutputTokens`; with the default budget the
  model spent 600+ tokens thinking, the JSON answer was truncated (`finishReason` `MAX_TOKENS`) and the
  loose-text extractor salvaged it into nonsense. Raising the budget or lowering `maxOutputTokens` brings that
  back.
- **Models that reject `thinkingConfig`.** A 400 on a request that carried `thinkingConfig` is taken as the
  model rejecting it: the model is added to `thinkingUnsupported` (for the life of the process) and the
  request is resent at once without it. That resend does not count as an attempt.
- **Retries.** Up to 3 attempts per model (`UPSTREAM_MAX_ATTEMPTS`) on HTTP 429, 500, 502, 503 and 504, on
  network errors and on timeouts (40 seconds per attempt, `UPSTREAM_ATTEMPT_TIMEOUT_MS`). The waits are 1.5 s
  and then 3 s. Any other error status fails at once with a 502.
- **429 from Gemini.** If the quota that failed is a per-day quota (a `quotaId` containing `PerDay`), there is
  no retry: the proxy throws a 503 naming the model. Otherwise it waits for Google's `RetryInfo.retryDelay`
  when that is longer than the normal backoff, capped at 30 seconds.
- **Fallback model.** When the primary model ends in a 502 or 503 and `GEMINI_FALLBACK_MODEL` names a
  different model, `callGemini` runs the same request once more on the fallback model, with the same retry
  loop. Free tier quotas are per model, so the fallback can still answer after the primary's daily quota is
  gone.
- **Rerank fallback chain** (`handleRerank`). 1) Parse the reply as JSON (directly, from a code fence, or from
  the first `{` to the last `}`) and keep valid `recommendations`. 2) If that yields nothing, extract
  `id`/`reason` pairs from the loose text. 3) If that yields nothing, make a second call at temperature 0 that
  demands only JSON (`callGeminiStrictJSON`). 4) Extract from that reply's text. 5) Return the first 10 valid
  candidates in the order sent, each with the reason
  `Fallback: AI response was not parseable; kept baseline ordering.`, plus `debug: { note, model }`. A rerank
  request can therefore cost two Gemini requests.
- **Chat replies** (`handleChat`). Parseable JSON with an `answer` or any `recommendations` is returned as
  `{ answer, recommendations }`. Valid JSON with neither returns the fixed answer
  `I couldn't find anything relevant in the loaded connections for that.` with no recommendations and no
  `debug`. A reply that is not parseable JSON is returned as the `answer` (raw model text), with
  `recommendations: []` and `debug: { note, model }`.

## Limits

| Limit | Value |
|---|---|
| Request body | 2 MB (`MAX_BODY_BYTES`) |
| Candidates in the prompt | first 120 (`formatCandidates`) |
| Recommendations returned by rerank | 10 (`normalizeRecs`, `fallbackRerank`); chat asks the model for up to 10 but does not enforce it |
| Chat history kept | last 8 `messages` |
| `relationship` per candidate | 200 characters (`RELATIONSHIP_MAX_LEN`) |
| `context` per request | 600 characters (`CONTEXT_MAX_LEN`) |
| Per-user rate limit | 10 per minute, 40 per UTC day (`AI_RATE_LIMIT_PER_MIN`, `AI_RATE_LIMIT_PER_DAY`) |
| Gemini call | 3 attempts per model, 40 seconds each |

## Testing without spending quota

Start a second proxy in mock mode on a spare port, and point a dev server at it:

```bash
cd server
AI_PROXY_PORT=8799 GEMINI_MOCK=1 node index.js
curl localhost:8799/health        # "mock": true

# in another terminal, from the repository root
VITE_AI_PROXY_URL=http://localhost:8799 npx vite --port 3000 --strictPort
```

The shell value of `VITE_AI_PROXY_URL` beats the one in `.env.local`. Port 3000 is on the default CORS
allowlist, and `--strictPort` stops Vite from moving to a port the proxy would refuse; for another port, start
the proxy with `AI_PROXY_ALLOWED_ORIGINS=http://localhost:<port>`.

In mock mode the two POST routes make no Gemini call and need no API key (`/models` still asks Google). Rerank
returns the first two candidate ids that appear in the prompt, each with the reason `mock`; chat returns the
same with the answer `Mock answer.`. The token check and the rate limit still apply, so you still have to sign
in.

## Known limitations

- The rate limit lives in memory: it resets whenever the proxy restarts and is not shared between processes
  or instances. Users idle for more than 24 hours are dropped from it.
- The Gemini free tier allows 20 requests per day per model per project. The default per-user day limit (40)
  is above that, so a single account can use up a model's daily quota; a rerank that needs the strict second
  pass uses two requests.
- Leaving `GEMINI_FALLBACK_MODEL` unset makes `gemini-1.5-flash` the fallback model (see Configuration).
- There is no public deployment of this proxy; the hosted site ships with the AI features switched off.
