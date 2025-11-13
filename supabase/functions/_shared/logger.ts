/**
 * Structured logging utility with Pino
 *
 * Usage:
 *   import { logger } from "../_shared/logger.ts";
 *   logger.info({ documentId: "123", chunks: 10 }, "Extraction started");
 */

import pino from "npm:pino@8";

const LOG_LEVEL = Deno.env.get("LOG_LEVEL") || "info";

export const logger = pino({
  level: LOG_LEVEL,
  formatters: {
    level: (label) => ({ level: label }),
  },
  base: {
    env: Deno.env.get("DENO_DEPLOYMENT_ID") || "local",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Helper to generate request IDs for tracing
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Helper to calculate cost from token usage
 */
export function calculateCost(inputTokens: number, outputTokens: number, model = "gpt-4o-mini"): number {
  // Pricing per 1M tokens (as of 2025-01)
  const pricing: Record<string, { input: number; output: number }> = {
    "gpt-4o-mini": { input: 0.15, output: 0.60 },
    "gpt-4o": { input: 5.0, output: 15.0 },
    "text-embedding-3-small": { input: 0.02, output: 0 },
  };

  const rates = pricing[model] || pricing["gpt-4o-mini"];
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

/**
 * Typed log contexts for common operations
 */
export interface ExtractionStartedContext {
  event: "extraction_started";
  requestId: string;
  documentId: string;
  jobId: string;
  chunks: number;
  batches: number;
  totalPages: number;
}

export interface ExtractionCompletedContext {
  event: "extraction_completed";
  requestId: string;
  documentId: string;
  jobId: string;
  durationMs: number;
  rulesExtracted: number;
  uniqueRules: number;
  costUsd: number;
  cacheHit: boolean;
}

export interface SummaryContext {
  event: "summary_started" | "summary_completed";
  requestId: string;
  documentId: string;
  durationMs?: number;
  costUsd?: number;
}

export interface ErrorContext {
  event: "error";
  requestId: string;
  documentId?: string;
  errorType: string;
  errorMessage: string;
  stack?: string;
}
