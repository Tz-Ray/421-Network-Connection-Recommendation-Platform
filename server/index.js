import http from "node:http";
import { URL } from "node:url";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load root .env.local (NOT VITE_ key)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../.env") }); // fallback if you prefer

const PORT = Number(process.env.AI_PROXY_PORT || 8787);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Normalize model so it works whether user sets "gemini-2.5-flash" or "models/gemini-2.5-flash"
function normalizeModel(raw) {
  let m = String(raw || "").trim();
  if (!m) return "gemini-1.5-flash";
  if (m.startsWith("models/")) m = m.slice("models/".length);
  return m;
}

let MODEL = normalizeModel(process.env.GEMINI_MODEL || "gemini-1.5-flash");

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain" });
  res.end(text);
}

function setCors(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function readJson(req) {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function formatCandidates(candidates) {
  return candidates
    .slice(0, 120)
    .map((c, i) => {
      const bits = [
        `id=${c.id}`,
        `name=${c.name}`,
        c.position ? `position=${c.position}` : "",
        c.company ? `company=${c.company}` : "",
      ].filter(Boolean);
      return `${i + 1}) ${bits.join(" | ")}`;
    })
    .join("\n");
}

async function listModels() {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing. Put it in root .env.local");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
    GEMINI_API_KEY
  )}`;

  const resp = await fetch(url);
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`ListModels HTTP ${resp.status}: ${text}`);
  }

  const data = JSON.parse(text);
  const models = Array.isArray(data?.models) ? data.models : [];

  const usable = models.filter((m) =>
    Array.isArray(m.supportedGenerationMethods)
      ? m.supportedGenerationMethods.includes("generateContent")
      : false
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
  const reObjDq =
    /["']id["']\s*:\s*["'](c\d+)["'][\s\S]*?["']reason["']\s*:\s*["']([\s\S]*?)["']/g;

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
  const lines = outText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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

// Calls Gemini, returns BOTH raw text and parsed JSON if possible.
async function callGemini({ system, user, maxOutputTokens = 900, temperature = 0.2 }) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing. Put it in root .env.local");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(
    GEMINI_API_KEY
  )}`;

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens,
      temperature,
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Gemini HTTP ${resp.status}: ${text}`);
  }

  const parsedEnvelope = JSON.parse(text);
  const outText = parsedEnvelope?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const parsedJson = tryParseJson(outText);

  return { outText, parsedJson };
}

// Stricter second-pass call when Gemini ignores JSON the first time.
async function callGeminiStrictJSON({ criteria, candidates }) {
  const system =
    "Return ONLY a JSON object. No markdown. No prose. No code fences. " +
    "You MUST ONLY recommend from the provided candidate ids exactly (like c0, c1, c2...). " +
    'Schema exactly: {"recommendations":[{"id":"c0","reason":"..."}, ...]}';

  const user =
    `CRITERIA:\n${criteria}\n\n` +
    `CANDIDATES:\n${formatCandidates(candidates)}\n\n` +
    `Return EXACTLY the JSON object described.`;

  return await callGemini({
    system,
    user,
    maxOutputTokens: 700,
    temperature: 0.0,
  });
}

function fallbackRerank(candidates) {
  return candidates.slice(0, 10).map((c) => ({
    id: c.id,
    reason: "Fallback: AI response was not parseable; kept baseline ordering.",
  }));
}

function normalizeRecs(recs, candidates) {
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
    reason = String(reason || "").replace(/\s+/g, " ").trim();
    if (!reason) reason = "Recommended by AI.";

    out.push({ id, reason });
    seen.add(id);
    if (out.length >= 10) break;
  }
  return out;
}

async function handleRerank(body) {
  const criteria = String(body?.criteria ?? "").trim();
  const candidates = body?.candidates;

  if (!criteria) throw new Error("Missing criteria.");
  if (!Array.isArray(candidates) || candidates.length === 0) throw new Error("Missing candidates.");

  // Pass 1: normal call
  const system =
    "You are helping a VC team pick the best intro candidates from a provided list. " +
    "You MUST ONLY recommend from the provided candidates using ids like c0,c1,c2... " +
    'Return ONLY JSON: {"recommendations":[{"id":string,"reason":string}]}';

  const user =
    `Criteria:\n${criteria}\n\n` +
    `Candidates:\n${formatCandidates(candidates)}\n\n` +
    `Return the best 10 candidate ids in ranked order with a short reason each.`;

  let { outText, parsedJson } = await callGemini({
    system,
    user,
    maxOutputTokens: 700,
    temperature: 0.2,
  });

  // Try JSON response
  let recs =
    parsedJson && Array.isArray(parsedJson?.recommendations)
      ? normalizeRecs(parsedJson.recommendations, candidates)
      : [];

  if (recs.length > 0) return { recommendations: recs };

  // If not JSON, try extracting from text (JSON-ish or plain)
  const extracted = extractRecsFromLooseText(outText, candidates);
  const extractedNorm = normalizeRecs(extracted, candidates);
  if (extractedNorm.length > 0) return { recommendations: extractedNorm };

  // Pass 2: strict JSON coercion
  const strict = await callGeminiStrictJSON({ criteria, candidates });
  const strictJson = strict.parsedJson;

  recs =
    strictJson && Array.isArray(strictJson?.recommendations)
      ? normalizeRecs(strictJson.recommendations, candidates)
      : [];

  if (recs.length > 0) return { recommendations: recs };

  // Try extracting from strict output text too
  const extracted2 = extractRecsFromLooseText(strict.outText, candidates);
  const extracted2Norm = normalizeRecs(extracted2, candidates);
  if (extracted2Norm.length > 0) return { recommendations: extracted2Norm };

  // Final fallback
  return {
    recommendations: fallbackRerank(candidates),
    debug: {
      note: "AI did not return parseable JSON or parsable text. Used baseline ordering.",
      model: MODEL,
    },
  };
}

async function handleChat(body) {
  const query = String(body?.query ?? "").trim();
  const candidates = body?.candidates;
  const messages = Array.isArray(body?.messages) ? body.messages.slice(-8) : [];

  if (!query) throw new Error("Missing query.");
  if (!Array.isArray(candidates) || candidates.length === 0) throw new Error("Missing candidates.");

  const system =
    "You answer questions about a user's professional network and suggest intros. " +
    "You MUST ONLY recommend from the provided candidates. " +
    'Preferred JSON: {"answer":string,"recommendations":[{"id":string,"reason":string}]}. ' +
    "If you cannot return JSON, return a helpful plain-text answer.";

  const historyText = messages
    .map((m) => `${m.role === "assistant" ? "AI" : "User"}: ${String(m.text ?? "")}`)
    .join("\n");

  const user =
    `Conversation so far:\n${historyText}\n\n` +
    `User question:\n${query}\n\n` +
    `Candidate pool:\n${formatCandidates(candidates)}\n\n` +
    `1) Answer the question.\n2) If appropriate, recommend up to 10 candidate ids with reasons.\n`;

  const { outText, parsedJson } = await callGemini({
    system,
    user,
    maxOutputTokens: 900,
    temperature: 0.3,
  });

  // Preferred: parseable JSON
  if (parsedJson && typeof parsedJson === "object") {
    const answer = typeof parsedJson.answer === "string" ? parsedJson.answer : "";
    const recommendations = Array.isArray(parsedJson.recommendations) ? parsedJson.recommendations : [];
    if (answer || recommendations.length) {
      return { answer, recommendations };
    }
  }

  // Fallback: plain text answer
  return {
    answer: String(outText || "AI returned an empty response. Please try rephrasing."),
    recommendations: [],
    debug: {
      note: "AI did not return parseable JSON. Returned raw text as answer.",
      model: MODEL,
    },
  };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || "/", "http://localhost");
  const origin = req.headers.origin;

  setCors(res, origin);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  try {
    if (req.method === "GET" && u.pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        model: MODEL,
        keyLoaded: !!GEMINI_API_KEY,
        hint: 'Set GEMINI_MODEL like "gemini-2.5-flash" (no "models/")',
      });
    }

    if (req.method === "GET" && u.pathname === "/models") {
      const models = await listModels();
      return sendJson(res, 200, {
        currentModel: MODEL,
        note: "Use envValue in .env.local as GEMINI_MODEL=<envValue>",
        generateContentModels: models,
      });
    }

    if (req.method === "POST" && u.pathname === "/gemini/rerank") {
      const body = await readJson(req);
      const out = await handleRerank(body);
      return sendJson(res, 200, out);
    }

    if (req.method === "POST" && u.pathname === "/gemini/chat") {
      const body = await readJson(req);
      const out = await handleChat(body);
      return sendJson(res, 200, out);
    }

    return sendText(res, 404, "Not found");
  } catch (e) {
    return sendJson(res, 500, { error: String(e?.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`AI proxy running on http://localhost:${PORT}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Key loaded: ${GEMINI_API_KEY ? "YES" : "NO"}`);
});