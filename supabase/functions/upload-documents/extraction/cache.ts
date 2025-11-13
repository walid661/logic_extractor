/**
 * Semantic cache for rule extraction using Upstash Vector + OpenAI embeddings
 *
 * Feature flagged: only active if UPSTASH_VECTOR_URL is set
 *
 * Architecture:
 * - Embed chunk text with text-embedding-3-small (OpenAI)
 * - Query Upstash Vector index (cosine similarity)
 * - Return cached rules if similarity > CACHE_THRESHOLD (0.93)
 * - Store extracted rules after successful LLM call
 *
 * Resilience:
 * - All errors are caught and logged, never block extraction
 * - Fail-open: if cache unavailable, continue without it
 */

import { logger } from "../../_shared/logger.ts";

interface RuleExtracted {
  text: string;
  conditions: string[];
  domain: string | null;
  tags: string[];
  confidence: number;
  source: { page: number; section: string | null };
}

interface CacheMetadata {
  rules: RuleExtracted[];
  docId?: string;
  chunkIndex?: number;
  model: string;
  createdAt: number;
}

interface VectorQueryResult {
  id: string;
  score: number;
  metadata: CacheMetadata;
}

// Configuration
const CACHE_ENABLED = Deno.env.get("CACHE_ENABLED") !== "false"; // Enabled by default if env vars present
const UPSTASH_VECTOR_URL = Deno.env.get("UPSTASH_VECTOR_URL");
const UPSTASH_VECTOR_TOKEN = Deno.env.get("UPSTASH_VECTOR_TOKEN");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const CACHE_THRESHOLD = parseFloat(Deno.env.get("CACHE_THRESHOLD") || "0.93");
const EMBEDDING_MODEL = "text-embedding-3-small";
const MAX_EMBEDDING_CHARS = 8000; // Truncate to avoid token limit

// Stats (in-memory, per-process)
let cacheHits = 0;
let cacheMisses = 0;
let totalRequests = 0; // Total cache lookups for periodic logging

/**
 * Check if cache is available
 */
function isCacheAvailable(): boolean {
  return CACHE_ENABLED && !!UPSTASH_VECTOR_URL && !!UPSTASH_VECTOR_TOKEN && !!OPENAI_API_KEY;
}

/**
 * Get embedding vector for text
 */
async function getEmbedding(text: string, requestId?: string): Promise<number[] | null> {
  if (!OPENAI_API_KEY) {
    return null;
  }

  const startTime = Date.now();

  try {
    // Truncate text to avoid token limits (1 char ≈ 0.4 tokens, safe margin)
    const truncatedText = text.slice(0, MAX_EMBEDDING_CHARS);

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: truncatedText,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ requestId, status: response.status, error: errorText }, "OpenAI embedding API error");
      return null;
    }

    const data = await response.json();
    const embedding = data.data[0]?.embedding;
    const tokensUsed = data.usage?.total_tokens || 0;

    const duration = Date.now() - startTime;
    logger.debug({
      requestId,
      embedding_ms: duration,
      embed_tokens: tokensUsed,
      embed_cost_usd: (tokensUsed * 0.02) / 1_000_000, // $0.02/1M tokens
    }, "Embedding generated");

    return embedding;
  } catch (error) {
    logger.error({
      requestId,
      error: error instanceof Error ? error.message : String(error),
    }, "Error generating embedding");
    return null;
  }
}

/**
 * Create deterministic hash for chunk (for vector ID)
 */
async function createChunkHash(text: string): Promise<string> {
  const normalized = text.toLowerCase().trim().slice(0, 2000);
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Query cache for similar chunk
 * Returns cached rules if similarity > threshold, null otherwise
 */
export async function getCachedRules(
  chunkText: string,
  requestId?: string
): Promise<RuleExtracted[] | null> {
  if (!isCacheAvailable()) {
    return null;
  }

  const startTime = Date.now();

  try {
    // Generate embedding
    const embedding = await getEmbedding(chunkText, requestId);
    if (!embedding) {
      cacheMisses++;
      return null;
    }

    // Query vector index
    const queryResponse = await fetch(`${UPSTASH_VECTOR_URL}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_VECTOR_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        vector: embedding,
        topK: 1,
        includeMetadata: true,
      }),
    });

    if (!queryResponse.ok) {
      logger.warn({ requestId, status: queryResponse.status }, "Upstash Vector query failed");
      cacheMisses++;
      return null;
    }

    const results: VectorQueryResult[] = await queryResponse.json();
    const duration = Date.now() - startTime;

    if (results.length === 0 || results[0].score < CACHE_THRESHOLD) {
      cacheMisses++;
      totalRequests++;
      logPeriodicStats(); // Log stats every 100 requests
      logger.debug({
        requestId,
        cache_hit: false,
        cache_score: results[0]?.score || 0,
        cache_query_ms: duration,
      }, "Cache miss");
      return null;
    }

    // Cache hit!
    cacheHits++;
    totalRequests++;
    logPeriodicStats(); // Log stats every 100 requests
    const cachedRules = results[0].metadata.rules;

    logger.info({
      requestId,
      cache_hit: true,
      cache_score: results[0].score,
      cache_query_ms: duration,
      cached_rules_count: cachedRules.length,
    }, "Cache HIT");

    return cachedRules;
  } catch (error) {
    cacheMisses++;
    totalRequests++;
    logPeriodicStats(); // Log stats every 100 requests
    logger.error({
      requestId,
      error: error instanceof Error ? error.message : String(error),
      event: "cache_error",
    }, "Cache query error (non-blocking)");
    return null;
  }
}

/**
 * Store extracted rules in cache
 */
export async function cacheRules(
  chunkText: string,
  rules: RuleExtracted[],
  requestId?: string,
  docId?: string,
  chunkIndex?: number
): Promise<void> {
  if (!isCacheAvailable()) {
    return;
  }

  const startTime = Date.now();

  try {
    // Generate embedding
    const embedding = await getEmbedding(chunkText, requestId);
    if (!embedding) {
      return;
    }

    // Create deterministic ID
    const chunkHash = await createChunkHash(chunkText);
    const vectorId = `chunk_${chunkHash}`;

    // Prepare metadata
    const metadata: CacheMetadata = {
      rules,
      docId,
      chunkIndex,
      model: "gpt-4o-mini",
      createdAt: Date.now(),
    };

    // Upsert to vector index
    const upsertResponse = await fetch(`${UPSTASH_VECTOR_URL}/upsert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_VECTOR_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: vectorId,
        vector: embedding,
        metadata,
      }),
    });

    if (!upsertResponse.ok) {
      const errorText = await upsertResponse.text();
      logger.warn({ requestId, status: upsertResponse.status, error: errorText }, "Upstash Vector upsert failed");
      return;
    }

    const duration = Date.now() - startTime;
    logger.debug({
      requestId,
      cache_upsert_ms: duration,
      vectorId,
      rules_count: rules.length,
    }, "Rules cached successfully");
  } catch (error) {
    logger.error({
      requestId,
      error: error instanceof Error ? error.message : String(error),
      event: "cache_error",
    }, "Cache upsert error (non-blocking)");
  }
}

/**
 * Log cache stats every 100 requests (sliding window)
 */
function logPeriodicStats(): void {
  if (totalRequests % 100 === 0 && totalRequests > 0) {
    const stats = getCacheStats();
    logger.info({
      event: "cache_stats_periodic",
      total_requests: totalRequests,
      cache_hits: stats.hits,
      cache_misses: stats.misses,
      cache_hit_rate: `${(stats.hitRate * 100).toFixed(1)}%`,
      hit_rate_decimal: stats.hitRate,
    }, `[CACHE] Stats at ${totalRequests} requests: ${(stats.hitRate * 100).toFixed(1)}% hit rate`);
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { hits: number; misses: number; hitRate: number } {
  const total = cacheHits + cacheMisses;
  return {
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: total > 0 ? cacheHits / total : 0,
  };
}
