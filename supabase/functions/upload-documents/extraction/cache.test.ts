/**
 * Unit tests for semantic cache (cache.ts)
 *
 * Run with: deno test --allow-env --allow-net cache.test.ts
 */

import { assertEquals, assertExists, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { stub } from "https://deno.land/std@0.208.0/testing/mock.ts";

// Mock environment variables
Deno.env.set("UPSTASH_VECTOR_URL", "https://mock-vector.upstash.io");
Deno.env.set("UPSTASH_VECTOR_TOKEN", "mock-token");
Deno.env.set("OPENAI_API_KEY", "mock-openai-key");
Deno.env.set("CACHE_THRESHOLD", "0.93");

// Import after env setup
import { getCachedRules, cacheRules, getCacheStats } from "./cache.ts";

Deno.test("getCacheStats - should return initial stats with zero values", () => {
  const stats = getCacheStats();
  assertExists(stats);
  assertEquals(typeof stats.hits, "number");
  assertEquals(typeof stats.misses, "number");
  assertEquals(typeof stats.hitRate, "number");
  assert(stats.hitRate >= 0 && stats.hitRate <= 1);
});

Deno.test("getCachedRules - should return null when cache disabled", async () => {
  // Temporarily disable cache
  const originalUrl = Deno.env.get("UPSTASH_VECTOR_URL");
  Deno.env.delete("UPSTASH_VECTOR_URL");

  const result = await getCachedRules("test chunk", "req_test");
  assertEquals(result, null);

  // Restore
  if (originalUrl) Deno.env.set("UPSTASH_VECTOR_URL", originalUrl);
});

Deno.test("getCachedRules - should return null on cache miss (low similarity)", async () => {
  // Mock OpenAI embedding endpoint
  const embeddingStub = stub(
    globalThis,
    "fetch",
    (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("openai.com/v1/embeddings")) {
        return Promise.resolve(
          new Response(JSON.stringify({
            data: [{
              embedding: Array(1536).fill(0.1), // Mock embedding
            }],
            usage: { total_tokens: 10 }
          }), { status: 200 })
        );
      }

      if (url.includes("upstash.io/query")) {
        // Return low similarity result
        return Promise.resolve(
          new Response(JSON.stringify([
            {
              id: "chunk_abc",
              score: 0.85, // Below threshold (0.93)
              metadata: {
                rules: [{ text: "cached rule", conditions: [], domain: null, tags: [], confidence: 0.9, source: { page: 1, section: null } }]
              }
            }
          ]), { status: 200 })
        );
      }

      return Promise.resolve(new Response("Not found", { status: 404 }));
    }
  );

  try {
    const result = await getCachedRules("test chunk text", "req_test_001");
    assertEquals(result, null); // Should be null due to low similarity
  } finally {
    embeddingStub.restore();
  }
});

Deno.test("getCachedRules - should return cached rules on cache hit (high similarity)", async () => {
  const mockRules = [
    { text: "cached rule 1", conditions: ["cond1"], domain: "test", tags: ["tag1"], confidence: 0.95, source: { page: 1, section: "intro" } },
    { text: "cached rule 2", conditions: [], domain: null, tags: [], confidence: 0.88, source: { page: 2, section: null } }
  ];

  const embeddingStub = stub(
    globalThis,
    "fetch",
    (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("openai.com/v1/embeddings")) {
        return Promise.resolve(
          new Response(JSON.stringify({
            data: [{ embedding: Array(1536).fill(0.2) }],
            usage: { total_tokens: 12 }
          }), { status: 200 })
        );
      }

      if (url.includes("upstash.io/query")) {
        // Return high similarity result (cache hit)
        return Promise.resolve(
          new Response(JSON.stringify([
            {
              id: "chunk_xyz",
              score: 0.96, // Above threshold (0.93)
              metadata: {
                rules: mockRules,
                docId: "doc_123",
                chunkIndex: 0,
                model: "gpt-4o-mini",
                createdAt: Date.now()
              }
            }
          ]), { status: 200 })
        );
      }

      return Promise.resolve(new Response("Not found", { status: 404 }));
    }
  );

  try {
    const result = await getCachedRules("exact same chunk text", "req_test_002");
    assertExists(result);
    assertEquals(result.length, 2);
    assertEquals(result[0].text, "cached rule 1");
    assertEquals(result[1].text, "cached rule 2");
  } finally {
    embeddingStub.restore();
  }
});

Deno.test("getCachedRules - should handle OpenAI API errors gracefully", async () => {
  const embeddingStub = stub(
    globalThis,
    "fetch",
    (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("openai.com/v1/embeddings")) {
        // Simulate OpenAI error
        return Promise.resolve(
          new Response(JSON.stringify({ error: { message: "Rate limit exceeded" } }), { status: 429 })
        );
      }

      return Promise.resolve(new Response("Not found", { status: 404 }));
    }
  );

  try {
    const result = await getCachedRules("test chunk", "req_test_003");
    assertEquals(result, null); // Should return null on error (fail-open)
  } finally {
    embeddingStub.restore();
  }
});

Deno.test("cacheRules - should upsert rules to vector index", async () => {
  let upsertCalled = false;
  let upsertPayload: any = null;

  const embeddingStub = stub(
    globalThis,
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("openai.com/v1/embeddings")) {
        return Promise.resolve(
          new Response(JSON.stringify({
            data: [{ embedding: Array(1536).fill(0.3) }],
            usage: { total_tokens: 15 }
          }), { status: 200 })
        );
      }

      if (url.includes("upstash.io/upsert")) {
        upsertCalled = true;
        if (init?.body) {
          upsertPayload = JSON.parse(init.body as string);
        }
        return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      }

      return Promise.resolve(new Response("Not found", { status: 404 }));
    }
  );

  try {
    const testRules = [
      { text: "new rule", conditions: ["c1"], domain: "legal", tags: ["t1"], confidence: 0.92, source: { page: 3, section: "body" } }
    ];

    await cacheRules("chunk to cache", testRules, "req_test_004", "doc_456", 2);

    assert(upsertCalled, "Upsert should have been called");
    assertExists(upsertPayload);
    assertEquals(upsertPayload.metadata.rules.length, 1);
    assertEquals(upsertPayload.metadata.docId, "doc_456");
    assertEquals(upsertPayload.metadata.chunkIndex, 2);
    assertEquals(upsertPayload.metadata.model, "gpt-4o-mini");
  } finally {
    embeddingStub.restore();
  }
});

Deno.test("cacheRules - should handle Upstash upsert errors gracefully", async () => {
  const embeddingStub = stub(
    globalThis,
    "fetch",
    (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("openai.com/v1/embeddings")) {
        return Promise.resolve(
          new Response(JSON.stringify({
            data: [{ embedding: Array(1536).fill(0.4) }],
            usage: { total_tokens: 20 }
          }), { status: 200 })
        );
      }

      if (url.includes("upstash.io/upsert")) {
        // Simulate Upstash error
        return Promise.resolve(new Response("Internal error", { status: 500 }));
      }

      return Promise.resolve(new Response("Not found", { status: 404 }));
    }
  );

  try {
    const testRules = [
      { text: "rule to cache", conditions: [], domain: null, tags: [], confidence: 0.85, source: { page: 1, section: null } }
    ];

    // Should not throw - fail-open pattern
    await cacheRules("chunk text", testRules, "req_test_005");
    // Test passes if no error is thrown
  } finally {
    embeddingStub.restore();
  }
});
