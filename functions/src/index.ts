import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";

admin.initializeApp();

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// Choose a stable, cost-effective model. You can change later.
const GEMINI_MODEL = "gemini-2.5-flash";

// Gemini API endpoint format is documented here. :contentReference[oaicite:1]{index=1}
async function callGeminiJSON(args: {
  system: string;
  contents: Array<{ role: "user" | "model"; text: string }>;
  maxOutputTokens?: number;
  temperature?: number;
}) {
  const key = GEMINI_API_KEY.value();
  if (!key) throw new Error("Missing GEMINI_API_KEY secret.");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(
    key
  )}`;

  const body = {
    systemInstruction: { parts: [{ text: args.system }] },
    contents: args.contents.map((c) => ({
      role: c.role,
      parts: [{ text: c.text }],
    })),
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: args.maxOutputTokens ?? 1400,
      temperature: args.temperature ?? 0.2,
      // gemini-2.5-flash bills "thinking" tokens against maxOutputTokens, which
      // truncates the JSON answer. Disable thinking for this structured task.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Gemini error ${resp.status}: ${txt}`);
  }

  const json = await resp.json() as any;
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  // Try strict JSON parse; if the model wrapped it, extract object bounds.
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // Truncated or otherwise unparseable model reply.
        throw new HttpsError("internal", "AI returned unparseable output");
      }
    }
    throw new HttpsError("internal", "AI returned unparseable output");
  }
}

function stringifyCandidates(candidates: any[]) {
  // Keep prompt compact and consistent
  return candidates
    .slice(0, 100)
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

export const geminiRerank = onCall(
  { secrets: [GEMINI_API_KEY] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }

    const criteria = String(request.data?.criteria ?? "").trim();
    const candidates = request.data?.candidates;

    if (!criteria) throw new HttpsError("invalid-argument", "Missing criteria.");
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new HttpsError("invalid-argument", "Missing candidates.");
    }

    const system =
      "You are helping a VC team choose the best people in a professional network for an introduction. " +
      "You MUST only recommend from the provided candidates. " +
      "Return ONLY JSON with shape: { recommendations: [{id: string, reason: string}] }";

    const user =
      `Criteria:\n${criteria}\n\n` +
      `Candidates:\n${stringifyCandidates(candidates)}\n\n` +
      `Task: Return the best 10 candidate ids in ranked order, with a short reason each.`;

    const result = await callGeminiJSON({
      system,
      contents: [{ role: "user", text: user }],
      maxOutputTokens: 1400,
      temperature: 0.2,
    });

    return {
      recommendations: Array.isArray(result?.recommendations)
        ? result.recommendations
        : [],
    };
  }
);

export const geminiChat = onCall(
  { secrets: [GEMINI_API_KEY] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }

    const query = String(request.data?.query ?? "").trim();
    const messages = request.data?.messages;
    const candidates = request.data?.candidates;

    if (!query) throw new HttpsError("invalid-argument", "Missing query.");
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new HttpsError("invalid-argument", "Missing candidates.");
    }

    const safeHistory = Array.isArray(messages) ? messages.slice(-8) : [];

    const system =
      "You are a helpful assistant that answers questions about a user's professional network. " +
      "You MUST base recommendations ONLY on the provided candidates. " +
      "If you recommend people, return JSON with shape: { answer: string, recommendations?: [{id: string, reason: string}] } " +
      "Return ONLY JSON.";

    const historyText = safeHistory
      .map((m: any) => `${m.role === "assistant" ? "AI" : "User"}: ${String(m.text ?? "")}`)
      .join("\n");

    const user =
      `Conversation so far:\n${historyText}\n\n` +
      `User question:\n${query}\n\n` +
      `Candidate pool:\n${stringifyCandidates(candidates)}\n\n` +
      `Task:\n1) Answer the question.\n2) If appropriate, recommend up to 10 candidate ids with short reasons.\n`;

    const result = await callGeminiJSON({
      system,
      contents: [{ role: "user", text: user }],
      maxOutputTokens: 1400,
      temperature: 0.3,
    });

    return {
      answer: typeof result?.answer === "string" ? result.answer : "",
      recommendations: Array.isArray(result?.recommendations)
        ? result.recommendations
        : [],
    };
  }
);