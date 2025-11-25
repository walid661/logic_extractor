/**
 * Configuration for upload-documents Edge Function
 *
 * Centralized configuration management with environment variables
 */

// ============================================================================
// SEMANTIC CACHE CONFIGURATION
// ============================================================================

/**
 * Feature flag for semantic cache (Upstash Vector + OpenAI embeddings)
 *
 * MVP Decision: Disabled by default for confidentiality/compliance reasons
 * - false: No embeddings, no vector DB calls (NLP-only extraction)
 * - true: Enable semantic cache (requires UPSTASH_VECTOR_URL, UPSTASH_VECTOR_TOKEN)
 *
 * @default false
 */
export const SEMANTIC_CACHE_ENABLED = true;

// ============================================================================
// PERFORMANCE & PARALLELIZATION CONFIG (PR #1 Quick Wins)
// ============================================================================

export const CONFIG = {
  // Parallélisation augmentée
  BATCH_SIZE: 4,                      // 4 chunks par batch
  MAX_CONCURRENT_BATCHES: 3,          // 3 batches en parallèle

  // Pauses supprimées - retry gère le rate limiting
  PAUSE_BETWEEN_GROUPS_MS: 0,         // Supprimé : pas de pause artificielle

  // Progression en temps réel - mise à jour CHAQUE batch
  UPDATE_PROGRESS_EVERY_N_BATCHES: 1, // Mise à jour après CHAQUE batch

  // Délais retry optimisés
  RETRY_DELAY_BASE_MS: 300,
  RETRY_DELAY_MAX_MS: 8000,
  RETRY_DELAY_SERVER_ERROR_MAX_MS: 3000,

  // LangChain chunking config
  CHUNK_SIZE: 1500,                   // Token-aware chunking
  CHUNK_OVERLAP: 200,                 // Overlap pour contexte
};

// ============================================================================
// PARSING CONFIGURATION (PR #2 PyMuPDF)
// ============================================================================

export const PARSE_CONFIG = {
  // PyMuPDF service URL (optional, fallback to pdf-parse if not set)
  SERVICE_URL: Deno.env.get("PARSE_SERVICE_URL"),
  SERVICE_TOKEN: Deno.env.get("PARSE_SERVICE_TOKEN"),
  TIMEOUT_MS: 8000,
  MAX_RETRIES: 2,
};

// ============================================================================
// EXACT REUSE CONFIGURATION
// ============================================================================

/**
 * Enable exact document reuse via file hash
 * If a PDF with identical hash is re-uploaded, reuse existing rules without re-extraction
 *
 * @default true
 */
export const EXACT_REUSE_ENABLED = (Deno.env.get("EXACT_REUSE_ENABLED") ?? "true") === "true";

// ============================================================================
// LOGGING CONFIGURATION
// ============================================================================

export const LOG_LEVEL = Deno.env.get("LOG_LEVEL") || "info";

/**
 * Cache backend identifier for logs
 * - "none": No semantic cache (MVP default)
 * - "upstash-vector": Semantic cache with Upstash Vector (future)
 */
export const CACHE_BACKEND = SEMANTIC_CACHE_ENABLED ? "upstash-vector" : "none";
