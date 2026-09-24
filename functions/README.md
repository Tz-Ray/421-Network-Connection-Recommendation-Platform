# Cloud Functions version of the AI proxy (unused)

## Status

This folder is an alternative, **unused** implementation of the AI proxy as two Firebase v2 `onCall`
callables, `geminiRerank` and `geminiChat`. The app never calls them and they are not deployed:

- The frontend sends plain `fetch` requests to the Node proxy in `server/`, all through `proxyFetch` in
  `lib/proxyClient.ts`. Nothing in the frontend imports `firebase/functions` or calls `httpsCallable`.
- `firebase.json` has no rewrite to these functions; its only Hosting rewrite sends every path to `/index.html`.

The live implementation is the Node proxy described in [server/README.md](../server/README.md).

## What it does

Everything is in `src/index.ts`. Both callables use the same helper, `callGeminiJSON`.

| Callable | Input (`request.data`) | Returns | Temperature |
|---|---|---|---|
| `geminiRerank` | `{ criteria, candidates }` | `{ recommendations }` | 0.2 |
| `geminiChat` | `{ query, messages?, candidates }` | `{ answer, recommendations }` | 0.3 |

- **Auth.** Both throw `HttpsError("unauthenticated", "Sign in required.")` when `request.auth` is empty (the
  callable framework fills it after verifying the caller's Firebase ID token). A blank `criteria` or `query`,
  or a missing or empty `candidates` array, throws `invalid-argument`.
- **Model.** The constant `GEMINI_MODEL = "gemini-2.5-flash"`, called through `generateContent` with JSON
  output, `maxOutputTokens: 1400` and always `thinkingConfig: { thinkingBudget: 0 }` (thinking tokens count
  against `maxOutputTokens` and would truncate the JSON reply).
- **Prompt.** `stringifyCandidates` keeps the first 100 candidates and only their `id`, `name`, `position` and
  `company`. `geminiChat` keeps the last 8 entries of `messages` (`role`, `text`).
- **Parsing.** One Gemini call. The reply text goes through `JSON.parse`, then, if that fails, the span from the
  first `{` to the last `}`; if both fail it throws `HttpsError("internal", "AI returned unparseable output")`.
  A non-OK Gemini response throws a plain `Error`, which the callable framework reports as `internal`.
- **Output.** `recommendations` is the model's array as returned (or `[]`), unchecked against the candidate
  ids; `answer` is the model's string (or `""`).
- **Secret.** `GEMINI_API_KEY`, declared with `defineSecret` and attached to both callables.
  `admin.initializeApp()` runs at load; nothing else from `firebase-admin` is used.

### Differences from `server/`

Both send JSON-mode requests with `maxOutputTokens` 1400, use temperature 0.2 for the first rerank call and 0.3
for chat, and keep the last 8 chat messages. Beyond that:

- **Protocol and errors.** Callable `HttpsError` codes here; the proxy uses HTTP routes and status codes with
  `{ "error": string }` bodies, and verifies the ID token itself (`verifyIdToken`).
- **Model.** Hardcoded here. The proxy reads `GEMINI_MODEL` (default `gemini-1.5-flash` when unset) and tries
  `GEMINI_FALLBACK_MODEL` once when the primary fails with 502 or 503. There is no fallback model here.
- **Thinking config.** Always sent here. The proxy sends it only for 2.5+/3.x model names, takes the budget from
  `GEMINI_THINKING_BUDGET` (default 0), and stops sending it to a model that rejects it with HTTP 400.
- **Retries and quota.** None here: one `fetch` with no timeout of its own. The proxy makes up to 3 attempts
  (1.5 s, then 3 s backoff, longer on a 429 when Google's `RetryInfo` asks, capped at 30 s; 40 s per attempt)
  and turns an exhausted per-day quota into a 503.
- **Candidates.** 100 in the prompt here, 120 in the proxy (`formatCandidates`). The proxy also drops
  non-object candidates and ones without a usable `id` (`filterValidCandidates`); nothing is dropped here.
- **Relationship and context.** Ignored here: the per-candidate `relationship` and per-request `context` are
  never read. The proxy sanitizes both (`sanitizeAiText`) and puts them in the prompt.
- **Parsing and fallbacks.** Single pass here. The proxy's `handleRerank` falls back from strict JSON to
  loose-text extraction, a second temperature-0 JSON-only call, extraction again, and finally the first 10
  candidates unranked with a `debug.note`, and filters results through `normalizeRecs` (known ids only, no
  duplicates, at most 10). Its `handleChat` gives a default answer for empty JSON and the raw text plus `debug`
  for unparseable output; this version returns `""` or throws `internal`.
- **Prompts.** The rerank system prompt here still says "helping a VC team choose the best people in a
  professional network for an introduction", and neither prompt mentions relationships. The proxy's prompts
  put relevance first and then prefer the stronger relationship.
- **Other.** No per-user rate limit (the proxy allows 10 requests per minute and 40 per day by default), no
  `GEMINI_MOCK` test mode, and no `/health` or `/models` equivalent.

## Build

```bash
cd functions && npm install && npm run build   # tsc -> functions/lib/ (gitignored)
```

`package.json` sets the Node engine to `20`. `npm run build` only compiles; it does not deploy.

## Deploy caution

`firebase.json` includes a `functions` target (`"source": "functions"`), so a bare `firebase deploy` would try
to deploy this folder too. Always pass `--only hosting` or `--only firestore`. The `deploy` script in this
folder's `package.json` runs `firebase deploy --only functions`; do not run it. Deploying Cloud Functions
requires the Blaze plan and a `GEMINI_API_KEY` secret (`firebase functions:secrets:set GEMINI_API_KEY`); this
project stays on the free Spark plan.

## What switching would take

The four proxy call sites (AI Rerank in `screens/RecommenderScreen.tsx`, the chat and rerank calls in
`screens/AIScreen.tsx`, and the chat widget in `components/ChatWidget.tsx`) would have to call `httpsCallable`
from `firebase/functions` instead of `proxyFetch`. `firebase.ts` does not set up the Functions SDK, the clients
read HTTP responses and `{ error }` bodies (for example `fetchJsonOrThrow` in the two screens) rather than
callable results and errors, and the `VITE_AI_PROXY_URL=off` switch in `lib/proxyClient.ts` would need an
equivalent. The functions themselves would need every gap listed under "Differences from `server/`" closed.
