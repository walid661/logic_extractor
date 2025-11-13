/**
 * Rate limiting middleware using Upstash Redis
 *
 * Feature flagged: only active if UPSTASH_REDIS_REST_URL is set
 *
 * Usage:
 *   import { checkRateLimit } from "../_shared/rate-limit.ts";
 *   const allowed = await checkRateLimit(userId, "upload");
 *   if (!allowed) return new Response("Rate limit exceeded", { status: 429 });
 */

import { logger } from "./logger.ts";

const UPSTASH_URL = Deno.env.get("UPSTASH_REDIS_REST_URL");
const UPSTASH_TOKEN = Deno.env.get("UPSTASH_REDIS_REST_TOKEN");

// Rate limit config: 100 requests per user per hour
const RATE_LIMIT_MAX = parseInt(Deno.env.get("RATE_LIMIT_MAX") || "100", 10);
const RATE_LIMIT_WINDOW_SECONDS = parseInt(Deno.env.get("RATE_LIMIT_WINDOW") || "3600", 10);

/**
 * Check if user is within rate limit
 * Returns true if allowed, false if exceeded
 */
export async function checkRateLimit(
  userId: string,
  action: string
): Promise<boolean> {
  // Feature flag: if Upstash not configured, allow all requests
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    logger.debug({ userId, action }, "Rate limiting disabled (no Upstash config)");
    return true;
  }

  const key = `ratelimit:${action}:${userId}`;

  try {
    // Use Redis INCR + EXPIRE pattern
    const incrResponse = await fetch(`${UPSTASH_URL}/incr/${key}`, {
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
      },
    });

    if (!incrResponse.ok) {
      logger.warn({ status: incrResponse.status }, "Upstash INCR failed, allowing request");
      return true; // Fail open
    }

    const { result: count } = await incrResponse.json();

    // Set expiry on first increment
    if (count === 1) {
      await fetch(`${UPSTASH_URL}/expire/${key}/${RATE_LIMIT_WINDOW_SECONDS}`, {
        headers: {
          Authorization: `Bearer ${UPSTASH_TOKEN}`,
        },
      });
    }

    const allowed = count <= RATE_LIMIT_MAX;

    if (!allowed) {
      logger.warn(
        { userId, action, count, max: RATE_LIMIT_MAX },
        "Rate limit exceeded"
      );
    }

    return allowed;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Rate limit check error, allowing request"
    );
    return true; // Fail open
  }
}

/**
 * Get current rate limit status for a user
 */
export async function getRateLimitStatus(
  userId: string,
  action: string
): Promise<{ count: number; limit: number; remaining: number; resetAt: number }> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    return { count: 0, limit: RATE_LIMIT_MAX, remaining: RATE_LIMIT_MAX, resetAt: 0 };
  }

  const key = `ratelimit:${action}:${userId}`;

  try {
    const [countResp, ttlResp] = await Promise.all([
      fetch(`${UPSTASH_URL}/get/${key}`, {
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      }),
      fetch(`${UPSTASH_URL}/ttl/${key}`, {
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      }),
    ]);

    const { result: count } = await countResp.json();
    const { result: ttl } = await ttlResp.json();

    const currentCount = count ? parseInt(count, 10) : 0;
    const resetAt = ttl > 0 ? Date.now() + ttl * 1000 : 0;

    return {
      count: currentCount,
      limit: RATE_LIMIT_MAX,
      remaining: Math.max(0, RATE_LIMIT_MAX - currentCount),
      resetAt,
    };
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) });
    return { count: 0, limit: RATE_LIMIT_MAX, remaining: RATE_LIMIT_MAX, resetAt: 0 };
  }
}
