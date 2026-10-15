// worker/src/gemini.js
//
// The Gemini side of the AI proxy, ported from server/index.js so the Worker
// serves the same contract: prompts, candidate formatting, the rerank fallback
// chain, chat handling, retries, the fallback model and the GEMINI_MOCK replies.
// Keep it in step with server/index.js when either changes.
//
// The only structural difference: server/index.js reads its configuration once
// from process.env, while a Worker gets `env` per request, so every function that
// needs configuration takes a `cfg` object built by `geminiConfig(env)`.

// Small typed error so handlers can pick their own HTTP status.
export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const TRUTHY = /^(1|true|yes|on)$/i;

// Normalize model so it works whether user sets "gemini-2.5-flash" or "models/gemini-2.5-flash"
export function normalizeModel(raw) {
  let m = String(raw || "").trim();
  if (!m) return "gemini-1.5-flash";
  if (m.startsWith("models/")) m = m.slice("models/".length);
  return m;
}

export function geminiConfig(env) {
  const apiKey = String(env.GEMINI_API_KEY || "").trim();
  const budgetRaw = env.GEMINI_THINKING_BUDGET;
  return {
    apiKey,
    model: normalizeModel(env.GEMINI_MODEL || "gemini-1.5-flash"),
    // Unset or blank means "no fallback" (normalizeModel would turn "" into its default model).
    fallbackModel: String(env.GEMINI_FALLBACK_MODEL || "").trim() ? normalizeModel(env.GEMINI_FALLBACK_MODEL) : "",
    // Matches server/index.js: Number(undefined) is NaN -> 0; Number("") is 0.
    thinkingBudget: Number.isFinite(Number(budgetRaw)) ? Number(budgetRaw) : 0,
    mock: TRUTHY.test(String(env.GEMINI_MOCK || "").trim()),
  };
}

// Some models (e.g. gemini-3.5-flash-lite) reject thinkingConfig with HTTP 400 even
// though they match the version regex; we learn that at runtime and remember it
// (per Worker isolate here, per process in server/index.js).
const thinkingUnsupported = new Set();
function wantsThinkingConfig(model) {
  return /gemini-(2\.5|[3-9])/i.test(model) && !thinkingUnsupported.has(model);
}

// Optional relationship (per-candidate) / context (per-request) strings from the
// client: accept strings only, collapse all whitespace (incl. newlines) to one
// space, replace '|' with '/' (formatCandidates uses '|' as a field separator,
// and the mock parser keys off it), trim, then cap length.
export const RELATIONSHIP_MAX_LEN = 200;
export const CONTEXT_MAX_LEN = 600;
// Worker-only caps (server/index.js has none): keep one request's prompt small, so
// a single caller can't eat the free tier's per-minute input-token allowance.
export const FIELD_MAX_LEN = 200; // candidate name / position / company
export const QUERY_MAX_LEN = 1000; // rerank criteria, chat query, each chat message
export const MAX_PROMPT_CANDIDATES = 120;
// Candidates read before filtering; formatCandidates() only ever shows the first 120.
const MAX_CANDIDATES_READ = 500;
export function sanitizeAiText(raw, maxLen) {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").replace(/\|/g, "/").trim().slice(0, maxLen);
}

// Keep only entries the prompt/normalizer can actually use: real objects with a
// non-empty string or finite number id. Also sanitizes the optional
// `relationship` string (or drops it if it's missing/invalid/blank).
export function filterValidCandidates(candidates) {
  if (!Array.isArray(candidates)) return [];
  return candidates
    .slice(0, MAX_CANDIDATES_READ)
    .filter((c) => {
      if (!c || typeof c !== "object" || Array.isArray(c)) return false;
      const id = c.id;
      if (typeof id === "number") return Number.isFinite(id);
      return typeof id === "string" && id.trim() !== "";
    })
    .map((c) => {
      const relationship = sanitizeAiText(c.relationship, RELATIONSHIP_MAX_LEN);
      const next = { ...c };
      if (relationship) next.relationship = relationship;
      else delete next.relationship;
      return next;
    });
}

// Strings and numbers only; one line, no "|" (the field separator), capped.
function clipField(v) {
  if (typeof v !== "string" && typeof v !== "number") return "";
  return sanitizeAiText(String(v), FIELD_MAX_LEN);
}

export function formatCandidates(candidates) {
  return candidates
    .slice(0, MAX_PROMPT_CANDIDATES)
    .map((c, i) => {
      const position = clipField(c.position);
      const company = clipField(c.company);
      const bits = [
        `id=${clipField(c.id)}`,
        `name=${clipField(c.name)}`,
        position ? `position=${position}` : "",
        company ? `company=${company}` : "",
        c.relationship ? `relationship=${c.relationship}` : "",
      ].filter(Boolean);
      return `${i + 1}) ${bits.join(" | ")}`;
    })
    .join("\n");
}

export async function listModels(cfg) {
  if (!cfg.apiKey) {
    throw new Error("GEMINI_API_KEY is missing. Set it with `wrangler secret put GEMINI_API_KEY`");
  }

  // The key goes in a header, never the URL, so it can't end up in request logs.
  const resp = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
    headers: { "x-goog-api-key": cfg.apiKey },
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`ListModels HTTP ${resp.status}: ${text}`);
  }

  const data = JSON.parse(text);
  const models = Array.isArray(data?.models) ? data.models : [];

  const usable = models.filter((m) =>
    Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods.includes("generateContent") : false
  );

  return usable.map((m) => {
    const name = String(m.name || "");
    return {
      name,
      envValue: name.startsWith("models/") ? name.slice("models/".length) : name,
      displayName: m.displayName,
      supportedGenerationMethods: m.supportedGenerationMethods,
    };
  });
}

// Best-effort JSON parse: handles plain JSON, code-fenced JSON, and embedded { ... } blocks.
function tryParseJson(text) {
  if (!text || typeof text !== "string") return null;

  // 1) Direct parse
  try {
    return JSON.parse(text);
  } catch {}

  // 2) Strip code fences ```json ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }

  // 3) Extract first {...} block
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }

  return null;
}

/**
 * Extract recommendations from "JSON-ish" or plain text outputs.
 * Handles cases like:
 * {"recommendations":[{"id":"c0","reason":"..."}]}
 * or broken JSON where parsing fails but text still contains id/reason fields.
 */
function extractRecsFromLooseText(outText, candidates) {
  if (!outText || typeof outText !== "string") return [];

  const validIds = new Set(candidates.map((c) => String(c.id)));
  const seen = new Set();
  const recs = [];

  // 1) Try global regex for JSON-ish objects (double quotes)
  //    This catches most "almost JSON" cases even if overall JSON is invalid.
  const reObjDq = /["']id["']\s*:\s*["'](c\d+)["'][\s\S]*?["']reason["']\s*:\s*["']([\s\S]*?)["']/g;

  let m;
  while ((m = reObjDq.exec(outText)) !== null) {
    const id = m[1];
    let reason = m[2] || "";
    if (!validIds.has(id) || seen.has(id)) continue;

    // clean reason a bit (stop at common terminators)
    reason = reason.replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
    if (!reason) reason = "Recommended by AI.";

    recs.push({ id, reason });
    seen.add(id);
    if (recs.length >= 10) break;
  }

  if (recs.length >= 3) return recs;

  // 2) Line-by-line fallback: look for cNN and reason:"..."
  const lines = outText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const idMatch = line.match(/\b(c\d+)\b/);
    if (!idMatch) continue;
    const id = idMatch[1];
    if (!validIds.has(id) || seen.has(id)) continue;

    // Try to capture reason from the same line if present
    const reasonMatch1 = line.match(/["']reason["']\s*:\s*["']([^"']+)["']/i);
    let reason = reasonMatch1 ? reasonMatch1[1] : "";

    // Otherwise, remove numbering/id and use remaining text
    if (!reason) {
      reason = line
        .replace(/^\s*\d+[\)\.\-:]\s*/g, "")
        .replace(new RegExp(`\\b${id}\\b\\s*[-:|]*\\s*`, "g"), "")
        .trim();
    }

    reason = reason.replace(/\s+/g, " ").trim();
    if (!reason) reason = "Recommended by AI (text output).";

    recs.push({ id, reason });
    seen.add(id);
    if (recs.length >= 10) break;
  }

  return recs;
}

const RETRYABLE_UPSTREAM_STATUS = new Set([429, 500, 502, 503, 504]);
const UPSTREAM_MAX_ATTEMPTS = 3;
const UPSTREAM_RETRY_DELAY_MS = 1500; // doubles each retry: 1.5s, 3s
const UPSTREAM_ATTEMPT_TIMEOUT_MS = 40_000; // Gemini has been observed hanging ~50s before a 503

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Quota/rate-limit hints from a Gemini 429 body: {retryDelayMs, perDay}
function parseQuotaHints(text) {
  try {
    const j = JSON.parse(text);
    const details = Array.isArray(j?.error?.details) ? j.error.details : [];
    let retryDelayMs = null;
    let perDay = false;
    for (const d of details) {
      const type = String(d?.["@type"] || "");
      if (type.endsWith("RetryInfo") && typeof d.retryDelay === "string") {
        const secs = parseFloat(d.retryDelay);
        if (Number.isFinite(secs)) retryDelayMs = Math.round(secs * 1000);
      }
      if (type.endsWith("QuotaFailure")) {
        for (const v of d.violations || []) {
          if (/PerDay/i.test(String(v?.quotaId || ""))) perDay = true;
        }
      }
    }
    return { retryDelayMs, perDay };
  } catch {
    return { retryDelayMs: null, perDay: false };
  }
}

// fetch with a per-attempt timeout via AbortController. A timeout surfaces as an
// error named "TimeoutError" (as AbortSignal.timeout does in server/index.js).
async function fetchWithTimeout(url, init, ms) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    const text = await resp.text();
    return { resp, text };
  } catch (e) {
    if (timedOut) {
      const err = new Error(`timeout after ${ms}ms`);
      err.name = "TimeoutError";
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// One model, with retries. Throws httpError(502/503) on failure.
async function callGeminiModel(cfg, { model, system, user, maxOutputTokens, temperature }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const buildBody = () => ({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens,
      temperature,
      // Gemini 2.5+ "thinking" tokens are billed against maxOutputTokens. With the
      // default budget the model spends ~600+ tokens thinking and the JSON answer is
      // truncated (finishReason MAX_TOKENS), which the loose-text extractor then
      // salvages into garbage like {id:"c0", reason:"Position"}. Disable thinking
      // for this structured-output task (override with GEMINI_THINKING_BUDGET).
      ...(wantsThinkingConfig(model) ? { thinkingConfig: { thinkingBudget: cfg.thinkingBudget } } : {}),
    },
  });

  let resp = null;
  let text = "";
  for (let attempt = 1; attempt <= UPSTREAM_MAX_ATTEMPTS; attempt++) {
    let transient = null;
    let delay = UPSTREAM_RETRY_DELAY_MS * 2 ** (attempt - 1);
    try {
      const sentThinking = wantsThinkingConfig(model);
      // Every upstream attempt counts against the shared daily allowance (index.js);
      // throws httpError(503) when it is used up.
      if (cfg.chargeCall) await cfg.chargeCall();
      ({ resp, text } = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey },
          body: JSON.stringify(buildBody()),
        },
        UPSTREAM_ATTEMPT_TIMEOUT_MS
      ));
      if (resp.ok) break;

      if (resp.status === 400 && sentThinking && /thinking/i.test(text)) {
        // Model rejects thinkingConfig: remember and retry immediately without it.
        thinkingUnsupported.add(model);
        console.warn(`Gemini ${model} rejected thinkingConfig; retrying without it.`);
        attempt--;
        continue;
      }
      if (resp.status === 429) {
        const hints = parseQuotaHints(text);
        if (hints.perDay) {
          const err = httpError(
            503,
            `Gemini free-tier daily quota exhausted for ${model}. Try again tomorrow, set GEMINI_FALLBACK_MODEL / GEMINI_MODEL to another model, or enable billing.`
          );
          // What non-allowlisted callers see instead (the text above is a configuration hint).
          err.publicMessage = "The AI service has used up today's free quota. Please try again tomorrow.";
          throw err;
        }
        if (hints.retryDelayMs) delay = Math.min(30_000, Math.max(delay, hints.retryDelayMs));
      }
      if (!RETRYABLE_UPSTREAM_STATUS.has(resp.status)) break;
      transient = `HTTP ${resp.status}`;
    } catch (e) {
      if (e?.status) throw e; // our own httpError
      resp = null;
      transient =
        e?.name === "TimeoutError"
          ? `timeout after ${UPSTREAM_ATTEMPT_TIMEOUT_MS}ms`
          : `network error: ${e?.message || e}`;
    }
    if (attempt === UPSTREAM_MAX_ATTEMPTS) {
      if (!resp) throw httpError(502, `Gemini ${model} unreachable (${transient}) after ${attempt} attempts.`);
      break;
    }
    console.warn(`Gemini ${model} ${transient}; retry ${attempt}/${UPSTREAM_MAX_ATTEMPTS - 1} in ${delay}ms.`);
    await sleep(delay);
  }

  if (!resp.ok) {
    throw httpError(502, `Gemini upstream error ${resp.status} (${model}): ${String(text ?? "").slice(0, 300)}`);
  }

  const parsedEnvelope = JSON.parse(text);
  const outText = parsedEnvelope?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const parsedJson = tryParseJson(outText);
  return { outText, parsedJson, model };
}

// GEMINI_MOCK stand-in: canned JSON of exactly the shape the handlers parse, so
// tests exercise the whole request path without spending free-tier quota.
function mockGeminiReply(cfg, { kind, user }) {
  // formatCandidates() emits lines like "1) id=c0 | name=... | position=...".
  const ids = [];
  const re = /^\s*\d+\)\s*id=([^\s|]+)/gm;
  let m;
  while ((m = re.exec(String(user || ""))) !== null) {
    ids.push(m[1]);
    if (ids.length >= 2) break;
  }
  const recommendations = ids.map((id) => ({ id, reason: "mock" }));
  const payload = kind === "chat" ? { answer: "Mock answer.", recommendations } : { recommendations };
  return { outText: JSON.stringify(payload), parsedJson: payload, model: `${cfg.model} (mock)` };
}

// Calls Gemini (primary model, then GEMINI_FALLBACK_MODEL if the primary is
// rate-limited / out of quota / unavailable). Returns BOTH raw text and parsed JSON.
async function callGemini(cfg, { system, user, maxOutputTokens = 900, temperature = 0.2, kind = "rerank" }) {
  if (cfg.mock) return mockGeminiReply(cfg, { kind, user });
  if (!cfg.apiKey) {
    throw new Error("GEMINI_API_KEY is missing. Set it with `wrangler secret put GEMINI_API_KEY`");
  }
  const { model, fallbackModel } = cfg;
  try {
    return await callGeminiModel(cfg, { model, system, user, maxOutputTokens, temperature });
  } catch (e) {
    const canFallback = fallbackModel && fallbackModel !== model && (e?.status === 502 || e?.status === 503);
    if (!canFallback) throw e;
    console.warn(
      `Primary model ${model} failed (${String(e?.message || e).slice(0, 120)}); trying fallback ${fallbackModel}.`
    );
    return await callGeminiModel(cfg, { model: fallbackModel, system, user, maxOutputTokens, temperature });
  }
}

// Stricter second-pass call when Gemini ignores JSON the first time.
async function callGeminiStrictJSON(cfg, { criteria, candidates, context }) {
  const system =
    "Return ONLY a JSON object. No markdown. No prose. No code fences. " +
    "You MUST ONLY recommend from the provided candidate ids exactly (like c0, c1, c2...). " +
    'Schema exactly: {"recommendations":[{"id":"c0","reason":"..."}, ...]}';

  const user =
    `CRITERIA:\n${criteria}\n\n` +
    (context ? `About the user: ${context}\n\n` : "") +
    `CANDIDATES:\n${formatCandidates(candidates)}\n\n` +
    `Return EXACTLY the JSON object described.`;

  return await callGemini(cfg, {
    system,
    user,
    maxOutputTokens: 1400,
    temperature: 0.0,
    kind: "rerank",
  });
}

function fallbackRerank(candidates) {
  return candidates.slice(0, 10).map((c) => ({
    id: c.id,
    reason: "Fallback: AI response was not parseable; kept baseline ordering.",
  }));
}

export function normalizeRecs(recs, candidates) {
  const valid = new Set(candidates.map((c) => String(c.id)));
  const out = [];
  const seen = new Set();
  for (const r of recs || []) {
    if (!r) continue;
    const id = String(r.id || "").trim();
    if (!id || !valid.has(id) || seen.has(id)) continue;

    let reason = r.reason;
    if (typeof reason !== "string") {
      try {
        reason = JSON.stringify(reason);
      } catch {
        reason = String(reason ?? "");
      }
    }
    reason = String(reason || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!reason) reason = "Recommended by AI.";

    out.push({ id, reason });
    seen.add(id);
    if (out.length >= 10) break;
  }
  return out;
}

export async function handleRerank(cfg, body) {
  const criteria = String(body?.criteria ?? "").trim().slice(0, QUERY_MAX_LEN);
  const candidates = body?.candidates;
  const context = sanitizeAiText(body?.context, CONTEXT_MAX_LEN);

  if (!criteria) throw httpError(400, "Missing criteria.");
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw httpError(400, "Missing candidates.");
  }

  const pool = filterValidCandidates(candidates);
  if (pool.length === 0) throw httpError(400, "No valid candidates.");

  // Pass 1: normal call
  const system =
    "You are helping a professional choose whom in their own network to contact first. " +
    "Relevance to the criteria comes first; among people who are comparably relevant, prefer " +
    "the one with a stronger relationship, and mention the relationship in the reason when it " +
    'matters. Write each reason to the user in the second person ("you", "your"), never ' +
    '"the user", and never mention candidate ids in the reason text. ' +
    "You MUST ONLY recommend from the provided candidates using ids like c0,c1,c2... " +
    'Return ONLY JSON: {"recommendations":[{"id":string,"reason":string}]}';

  const user =
    `Criteria:\n${criteria}\n\n` +
    (context ? `About the user: ${context}\n\n` : "") +
    `Candidates:\n${formatCandidates(pool)}\n\n` +
    `Return the best 10 candidate ids in ranked order with a short reason each.`;

  let { outText, parsedJson } = await callGemini(cfg, {
    system,
    user,
    maxOutputTokens: 1400,
    temperature: 0.2,
    kind: "rerank",
  });

  // Try JSON response
  let recs =
    parsedJson && Array.isArray(parsedJson?.recommendations) ? normalizeRecs(parsedJson.recommendations, pool) : [];

  if (recs.length > 0) return { recommendations: recs };

  // If not JSON, try extracting from text (JSON-ish or plain)
  const extracted = extractRecsFromLooseText(outText, pool);
  const extractedNorm = normalizeRecs(extracted, pool);
  if (extractedNorm.length > 0) return { recommendations: extractedNorm };

  // Pass 2: strict JSON coercion. If it fails (upstream error, or the shared daily
  // allowance ran out), fall through to the baseline ordering instead of an error.
  let strict = { outText: "", parsedJson: null };
  try {
    strict = await callGeminiStrictJSON(cfg, { criteria, candidates: pool, context });
  } catch (e) {
    console.warn(`Strict JSON pass failed: ${String(e?.message || e).slice(0, 200)}`);
  }
  const strictJson = strict.parsedJson;

  recs =
    strictJson && Array.isArray(strictJson?.recommendations) ? normalizeRecs(strictJson.recommendations, pool) : [];

  if (recs.length > 0) return { recommendations: recs };

  // Try extracting from strict output text too
  const extracted2 = extractRecsFromLooseText(strict.outText, pool);
  const extracted2Norm = normalizeRecs(extracted2, pool);
  if (extracted2Norm.length > 0) return { recommendations: extracted2Norm };

  // Final fallback
  return {
    recommendations: fallbackRerank(pool),
    debug: {
      note: "AI did not return parseable JSON or parsable text. Used baseline ordering.",
      model: cfg.model,
    },
  };
}

export async function handleChat(cfg, body) {
  const query = String(body?.query ?? "").trim().slice(0, QUERY_MAX_LEN);
  const candidates = body?.candidates;
  const messages = Array.isArray(body?.messages) ? body.messages.slice(-8) : [];
  const context = sanitizeAiText(body?.context, CONTEXT_MAX_LEN);

  if (!query) throw httpError(400, "Missing query.");
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw httpError(400, "Missing candidates.");
  }

  const pool = filterValidCandidates(candidates);
  if (pool.length === 0) throw httpError(400, "No valid candidates.");

  const system =
    "You answer questions about a user's professional network and suggest intros. " +
    "Relevance to the question comes first; among people who are comparably relevant, prefer " +
    "the one with a stronger relationship, and mention the relationship in the reason when it " +
    'matters. Address the user as "you" (never "the user") and never mention candidate ids ' +
    "such as c0 in the answer or reason text. " +
    "You MUST ONLY recommend from the provided candidates. " +
    'Preferred JSON: {"answer":string,"recommendations":[{"id":string,"reason":string}]}. ' +
    "If you cannot return JSON, return a helpful plain-text answer.";

  const historyText = messages
    .map((m) => `${m?.role === "assistant" ? "AI" : "User"}: ${String(m?.text ?? "").slice(0, QUERY_MAX_LEN)}`)
    .join("\n");

  const user =
    `Conversation so far:\n${historyText}\n\n` +
    `User question:\n${query}\n\n` +
    (context ? `About the user: ${context}\n\n` : "") +
    `Candidate pool:\n${formatCandidates(pool)}\n\n` +
    `1) Answer the question.\n2) If appropriate, recommend up to 10 candidate ids with reasons.\n`;

  const { outText, parsedJson } = await callGemini(cfg, {
    system,
    user,
    maxOutputTokens: 1400,
    temperature: 0.3,
    kind: "chat",
  });

  // Preferred: parseable JSON
  if (parsedJson && typeof parsedJson === "object") {
    const answer = typeof parsedJson.answer === "string" ? parsedJson.answer : "";
    // Same rules as rerank: only ids that were sent, no duplicates, at most 10.
    const recommendations = normalizeRecs(
      Array.isArray(parsedJson.recommendations) ? parsedJson.recommendations : [],
      pool
    );
    if (answer || recommendations.length) {
      return { answer, recommendations };
    }
    // Valid JSON, but the model found nothing. Do NOT fall through to raw text:
    // outText here is just the empty JSON envelope.
    return {
      answer: "I couldn't find anything relevant in the loaded connections for that.",
      recommendations: [],
    };
  }

  // Fallback (parsedJson === null): plain text answer
  return {
    answer: String(outText || "AI returned an empty response. Please try rephrasing."),
    recommendations: [],
    debug: {
      note: "AI did not return parseable JSON. Returned raw text as answer.",
      model: cfg.model,
    },
  };
}
