// server/test/proxy.test.mjs
//
// Integration tests for the AI proxy: each suite starts a real `node index.js`
// child on a free port with GEMINI_MOCK=1 (canned replies, no Gemini call, no
// API key) and a test-only JWKS (AI_PROXY_TEST_JWKS, honored only with
// NODE_ENV=test). Run from server/: npm test

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import * as jose from "jose";
import {
  PROJECT_ID,
  ALLOWED_ORIGIN,
  DISALLOWED_ORIGIN,
  makeSigner,
  startProxy,
  call,
} from "./helpers.mjs";

const signer = await makeSigner();

const CANDIDATES = [
  { id: "c0", name: "Ada Lovelace", position: "Software Engineer", company: "Analytical Engines" },
  { id: "c1", name: "Grace Hopper", position: "Engineering Manager", company: "Navy" },
  { id: "c2", name: "Alan Turing", position: "Researcher", company: "Bletchley" },
];

function assertRecs(recs, validIds) {
  assert.ok(Array.isArray(recs), "recommendations is an array");
  assert.ok(recs.length <= 10, "at most 10 recommendations");
  const seen = new Set();
  for (const r of recs) {
    assert.deepEqual(Object.keys(r).sort(), ["id", "reason"]);
    assert.equal(typeof r.id, "string");
    assert.equal(typeof r.reason, "string");
    assert.ok(r.reason.length > 0, "reason is non-empty");
    assert.ok(validIds.has(r.id), `id ${r.id} was one of the candidates sent`);
    assert.ok(!seen.has(r.id), `id ${r.id} is not duplicated`);
    seen.add(r.id);
  }
}

describe("proxy in test mode (mock Gemini, test JWKS)", () => {
  let proxy;
  before(async () => {
    proxy = await startProxy({ AI_PROXY_TEST_JWKS: signer.jwks });
  });
  after(async () => {
    await proxy?.stop();
  });

  test("GET /health is public and reports the expected shape", async () => {
    const r = await call(proxy.url, "/health");
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json).sort(), [
      "authConfigured",
      "fallbackModel",
      "hint",
      "keyLoaded",
      "mock",
      "model",
      "ok",
    ]);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.model, "mock-model");
    assert.equal(r.json.keyLoaded, false);
    assert.equal(r.json.fallbackModel, null);
    assert.equal(r.json.mock, true);
    assert.equal(r.json.authConfigured, true);
    assert.equal(typeof r.json.hint, "string");
  });

  describe("authentication", () => {
    test("no Authorization header -> 401", async () => {
      const r = await call(proxy.url, "/gemini/rerank", {
        method: "POST",
        body: { criteria: "engineer", candidates: CANDIDATES },
      });
      assert.equal(r.status, 401);
      assert.deepEqual(r.json, { error: "Sign in to use the AI proxy." });
    });

    test("non-Bearer Authorization header -> 401", async () => {
      const r = await call(proxy.url, "/gemini/rerank", {
        method: "POST",
        headers: { Authorization: "Basic dXNlcjpwYXNz" },
        body: { criteria: "engineer", candidates: CANDIDATES },
      });
      assert.equal(r.status, 401);
    });

    test("an unknown path without a token is 401, not 404", async () => {
      const r = await call(proxy.url, "/does-not-exist");
      assert.equal(r.status, 401);
    });

    const bad = {
      "garbage token": async () => "not-a-jwt",
      "token signed by a different key with the trusted kid (forged)": async () => {
        const other = await makeSigner(signer.kid);
        return other.token({ sub: "forger" });
      },
      "token signed by an unknown kid": async () => (await makeSigner("unknown-kid")).token(),
      "wrong audience": () => signer.token({ aud: "some-other-project" }),
      "wrong issuer": () => signer.token({ iss: "https://securetoken.google.com/some-other-project" }),
      "expired token": () =>
        signer.token({
          iat: Math.floor(Date.now() / 1000) - 7200,
          exp: Math.floor(Date.now() / 1000) - 3600,
        }),
      "missing sub": () => signer.token({ sub: undefined }),
      "HS256 token (algorithm not allowed)": () =>
        new jose.SignJWT({ sub: "hs-user" })
          .setProtectedHeader({ alg: "HS256", kid: signer.kid })
          .setIssuer(`https://securetoken.google.com/${PROJECT_ID}`)
          .setAudience(PROJECT_ID)
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(new TextEncoder().encode("a-shared-secret-of-sufficient-length!!")),
    };
    for (const [name, make] of Object.entries(bad)) {
      test(`${name} -> 401 with a generic message`, async () => {
        const r = await call(proxy.url, "/gemini/rerank", {
          method: "POST",
          token: await make(),
          body: { criteria: "engineer", candidates: CANDIDATES },
        });
        assert.equal(r.status, 401);
        assert.deepEqual(r.json, { error: "Sign in again to use the AI proxy." });
      });
    }
  });

  describe("CORS", () => {
    test("preflight from a disallowed Origin -> 403", async () => {
      const r = await call(proxy.url, "/gemini/rerank", {
        method: "OPTIONS",
        origin: DISALLOWED_ORIGIN,
        headers: { "Access-Control-Request-Method": "POST" },
      });
      assert.equal(r.status, 403);
      assert.deepEqual(r.json, { error: "Origin not allowed." });
      assert.equal(r.headers.get("access-control-allow-origin"), null);
    });

    test("preflight from an allowed Origin -> 204 with CORS headers", async () => {
      const r = await call(proxy.url, "/gemini/rerank", {
        method: "OPTIONS",
        origin: ALLOWED_ORIGIN,
        headers: { "Access-Control-Request-Method": "POST" },
      });
      assert.equal(r.status, 204);
      assert.equal(r.text, "");
      assert.equal(r.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
      assert.match(r.headers.get("access-control-allow-headers") || "", /Authorization/);
    });

    test("a real request from a disallowed Origin gets no Access-Control-Allow-Origin", async () => {
      const r = await call(proxy.url, "/health", { origin: DISALLOWED_ORIGIN });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("access-control-allow-origin"), null);
    });
  });

  describe("request bodies", () => {
    test("body over 2 MB -> 413", async () => {
      const big = Buffer.alloc(2 * 1024 * 1024 + 1, 0x61); // 'a' x (2 MB + 1)
      const r = await call(proxy.url, "/gemini/rerank", {
        method: "POST",
        token: await signer.token({ sub: "user-413" }),
        body: big,
      });
      assert.equal(r.status, 413);
      assert.match(r.json.error, /too large/i);
    });

    test("malformed JSON -> 400", async () => {
      const r = await call(proxy.url, "/gemini/rerank", {
        method: "POST",
        token: await signer.token({ sub: "user-400" }),
        body: '{"criteria": "engineer", "candidates": [',
      });
      assert.equal(r.status, 400);
      assert.deepEqual(r.json, { error: "Malformed JSON body." });
    });

    test("missing criteria -> 400", async () => {
      const r = await call(proxy.url, "/gemini/rerank", {
        method: "POST",
        token: await signer.token({ sub: "user-400b" }),
        body: { candidates: CANDIDATES },
      });
      assert.equal(r.status, 400);
      assert.deepEqual(r.json, { error: "Missing criteria." });
    });
  });

  describe("mock routes", () => {
    const valid = new Set(CANDIDATES.map((c) => c.id));

    test("POST /gemini/rerank -> { recommendations: [{ id, reason }] }", async () => {
      const r = await call(proxy.url, "/gemini/rerank", {
        method: "POST",
        token: await signer.token({ sub: "user-rerank" }),
        origin: ALLOWED_ORIGIN,
        body: {
          criteria: "software engineer",
          candidates: [{ ...CANDIDATES[0], relationship: "10+ messages" }, ...CANDIDATES.slice(1)],
          context: "Headline: Engineer",
        },
      });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
      assert.deepEqual(Object.keys(r.json), ["recommendations"]);
      assertRecs(r.json.recommendations, valid);
      assert.deepEqual(r.json.recommendations, [
        { id: "c0", reason: "mock" },
        { id: "c1", reason: "mock" },
      ]);
    });

    test("POST /gemini/chat -> { answer, recommendations }", async () => {
      const r = await call(proxy.url, "/gemini/chat", {
        method: "POST",
        token: await signer.token({ sub: "user-chat" }),
        body: {
          query: "Who should I ask about engineering?",
          messages: [{ role: "user", text: "Hi" }],
          candidates: CANDIDATES,
        },
      });
      assert.equal(r.status, 200);
      assert.deepEqual(Object.keys(r.json).sort(), ["answer", "recommendations"]);
      assert.equal(typeof r.json.answer, "string");
      assert.ok(r.json.answer.length > 0);
      assertRecs(r.json.recommendations, valid);
      assert.equal(r.json.answer, "Mock answer.");
      assert.deepEqual(r.json.recommendations.map((x) => x.id), ["c0", "c1"]);
    });
  });
});

describe("rate limits", () => {
  describe("per minute", () => {
    let proxy;
    before(async () => {
      proxy = await startProxy({ AI_PROXY_TEST_JWKS: signer.jwks, AI_RATE_LIMIT_PER_MIN: "2" });
    });
    after(async () => {
      await proxy?.stop();
    });

    test("the third request in 60 s -> 429 with Retry-After <= 60; other users unaffected", async () => {
      const token = await signer.token({ sub: "minute-user" });
      // Unknown paths are charged too (the limiter runs before routing).
      assert.equal((await call(proxy.url, "/nope", { token })).status, 404);
      assert.equal((await call(proxy.url, "/nope", { token })).status, 404);
      const r = await call(proxy.url, "/gemini/rerank", {
        method: "POST",
        token,
        body: { criteria: "x", candidates: CANDIDATES },
      });
      assert.equal(r.status, 429);
      const retry = Number(r.headers.get("retry-after"));
      assert.ok(Number.isInteger(retry) && retry >= 1 && retry <= 60, `Retry-After ${retry}`);
      assert.match(r.json.error, /Rate limit reached/);

      const other = await call(proxy.url, "/nope", { token: await signer.token({ sub: "someone-else" }) });
      assert.equal(other.status, 404);
    });
  });

  describe("per UTC day", () => {
    let proxy;
    before(async () => {
      proxy = await startProxy({ AI_PROXY_TEST_JWKS: signer.jwks, AI_RATE_LIMIT_PER_DAY: "2" });
    });
    after(async () => {
      await proxy?.stop();
    });

    test("the third request today -> 429 with Retry-After = seconds to UTC midnight", async () => {
      const token = await signer.token({ sub: "day-user" });
      assert.equal((await call(proxy.url, "/nope", { token })).status, 404);
      assert.equal((await call(proxy.url, "/nope", { token })).status, 404);
      const r = await call(proxy.url, "/nope", { token });
      assert.equal(r.status, 429);
      const retry = Number(r.headers.get("retry-after"));
      const now = new Date();
      const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
      const expected = Math.ceil((midnight - now.getTime()) / 1000);
      assert.ok(Number.isInteger(retry) && retry >= 1 && retry <= 86400, `Retry-After ${retry}`);
      assert.ok(Math.abs(retry - expected) <= 5, `Retry-After ${retry}, expected about ${expected}`);
    });
  });
});

describe("AI_PROXY_TEST_JWKS is ignored outside NODE_ENV=test", () => {
  // Without NODE_ENV=test the proxy uses Google's securetoken JWKS, which does
  // not hold the test key: verification fails (unknown kid, or no network) -> 401.
  for (const [label, nodeEnv] of [
    ["NODE_ENV=production", "production"],
    ["NODE_ENV unset", undefined],
  ]) {
    test(`${label}: a token signed by the test key -> 401`, async () => {
      const proxy = await startProxy({ AI_PROXY_TEST_JWKS: signer.jwks, NODE_ENV: nodeEnv });
      try {
        const r = await call(proxy.url, "/gemini/rerank", {
          method: "POST",
          token: await signer.token({ sub: "should-not-pass" }),
          body: { criteria: "engineer", candidates: CANDIDATES },
        });
        assert.equal(r.status, 401);
        assert.deepEqual(r.json, { error: "Sign in again to use the AI proxy." });
      } finally {
        await proxy.stop();
      }
    });
  }
});
