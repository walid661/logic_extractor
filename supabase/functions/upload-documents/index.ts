import { createClient } from "npm:@supabase/supabase-js@2";
import { RecursiveCharacterTextSplitter } from "npm:langchain@0.1.20/text_splitter";
import {
  logger,
  generateRequestId,
  calculateCost,
  type ExtractionStartedContext,
  type ExtractionCompletedContext,
  type ErrorContext,
} from "../_shared/logger.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { getCachedRules, cacheRules, getCacheStats } from "./extraction/cache.ts";
import { CONFIG, CACHE_BACKEND, PARSE_CONFIG, EXACT_REUSE_ENABLED } from "./config.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RuleExtracted {
  text: string;
  conditions: string[];
  domain: string | null;
  tags: string[];
  confidence: number;
  source: { page: number; section: string | null };
}

// CONFIG imported from config.ts (centralized configuration)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = generateRequestId();
  const startTime = Date.now();

  try {
    // Get user from authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader }
        }
      }
    );

    // Get authenticated user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Rate limiting check
    const rateLimitOk = await checkRateLimit(user.id, "upload");
    if (!rateLimitOk) {
      logger.warn({ requestId, userId: user.id }, "Rate limit exceeded");
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return new Response(
        JSON.stringify({ error: 'No file provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    logger.info({ requestId, fileName: file.name, fileSize: file.size, userId: user.id }, "Processing file upload");

    // Save document metadata with user_id
    const { data: document, error: docError } = await supabaseClient
      .from('documents')
      .insert({
        name: file.name,
        mime_type: file.type || 'application/pdf',
        size_bytes: file.size,
        path: `/uploads/${crypto.randomUUID()}-${file.name}`,
        status: 'queued',
        user_id: user.id
      })
      .select()
      .single();

    if (docError) {
      logger.error({ requestId, error: docError.message }, "Error creating document");
      return new Response(
        JSON.stringify({ error: 'Failed to create document' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create job
    const { data: job, error: jobError } = await supabaseClient
      .from('jobs')
      .insert({
        document_id: document.id,
        type: 'extract',
        status: 'running',
        progress: 10
      })
      .select()
      .single();

    if (jobError) {
      logger.error({ requestId, documentId: document.id, error: jobError.message }, "Error creating job");
      return new Response(
        JSON.stringify({ error: 'Failed to create job' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Process file in background (async, no await)
    (async () => {
      try {
        // Update document status to processing
        await supabaseClient
          .from('documents')
          .update({ status: 'processing' })
          .eq('id', document.id);

        const arrayBuffer = await file.arrayBuffer();
        const buffer = new Uint8Array(arrayBuffer);

        // Calculate file hash for exact reuse detection
        const fileHash = await calculateFileHash(buffer);

        // Update document with file_hash
        await supabaseClient
          .from('documents')
          .update({ file_hash: fileHash })
          .eq('id', document.id);

        logger.info({
          requestId,
          documentId: document.id,
          fileHash,
          exact_reuse_enabled: EXACT_REUSE_ENABLED,
        }, "File hash calculated");

        // Check for exact reuse: if same file was already processed by this user
        if (EXACT_REUSE_ENABLED) {
          const { data: existingDocs, error: existingError } = await supabaseClient
            .from('documents')
            .select('id')
            .eq('user_id', user.id)
            .eq('file_hash', fileHash)
            .eq('status', 'done')
            .neq('id', document.id) // Exclude current document
            .limit(1);

          if (!existingError && existingDocs && existingDocs.length > 0) {
            const sourceDocId = existingDocs[0].id;

            logger.info({
              requestId,
              documentId: document.id,
              sourceDocId,
              fileHash,
            }, "Exact file match found - reusing existing rules");

            // Copy rules from existing document
            const { data: existingRules, error: rulesError } = await supabaseClient
              .from('rules')
              .select('*')
              .eq('document_id', sourceDocId);

            if (!rulesError && existingRules && existingRules.length > 0) {
              // Copy pages from source document
              const { data: sourceDoc } = await supabaseClient
                .from('documents')
                .select('pages, summary')
                .eq('id', sourceDocId)
                .single();

              // Insert copied rules with new document_id
              const copiedRules = existingRules.map(rule => ({
                document_id: document.id,
                document_name: document.name,
                text: rule.text,
                conditions: rule.conditions,
                domain: rule.domain,
                tags: rule.tags,
                confidence: rule.confidence,
                source_page: rule.source_page,
                source_sect: rule.source_sect,
              }));

              await supabaseClient.from('rules').insert(copiedRules);

              // Update document to done with pages and summary from source
              await supabaseClient
                .from('documents')
                .update({
                  status: 'done',
                  pages: sourceDoc?.pages || null,
                  summary: sourceDoc?.summary || null,
                })
                .eq('id', document.id);

              // Mark job as done
              await supabaseClient
                .from('jobs')
                .update({ status: 'done', progress: 100 })
                .eq('id', job.id);

              logger.info({
                requestId,
                documentId: document.id,
                rulesReused: existingRules.length,
                sourceDocId,
              }, "Rules reused successfully - skipping extraction");

              return; // Exit early - no extraction needed
            }
          }
        }

        // No exact reuse - proceed with normal extraction
        // Parse PDF (PyMuPDF service with fallback to pdf-parse)
        const parsedPDF = await parsePDF(buffer, requestId);
        const text = parsedPDF.text;
        const numPages = parsedPDF.pages;

        if (!text || text.trim().length === 0) {
          throw new Error('Empty or unreadable PDF content');
        }

        logger.info({
          requestId,
          documentId: document.id,
          textLength: text.length,
          pages: numPages,
          parse_backend: parsedPDF.parseBackend,
          parse_duration_ms: parsedPDF.parseDurationMs,
        }, "PDF parsed successfully");

        await supabaseClient
          .from('jobs')
          .update({ progress: 30 })
          .eq('id', job.id);

        // Extract rules using OpenAI (avec jobId pour progression)
        const rules = await extractRulesFromText(text, numPages, supabaseClient, job.id, requestId);

        await supabaseClient
          .from('jobs')
          .update({ progress: 70 })
          .eq('id', job.id);

        // Save rules
        if (rules.length > 0) {
          const rulesData = rules.map(r => ({
            document_id: document.id,
            document_name: document.name,
            text: r.text,
            conditions: r.conditions,
            domain: r.domain,
            tags: r.tags.slice(0, 8),
            confidence: r.confidence,
            source_page: r.source.page,
            source_sect: r.source.section
          }));

          const { error: rulesError } = await supabaseClient
            .from('rules')
            .insert(rulesData);

          if (rulesError) {
            logger.error({ requestId, documentId: document.id, error: rulesError.message }, "Error inserting rules");
            await supabaseClient
              .from('jobs')
              .update({ status: 'error', error: rulesError.message })
              .eq('id', job.id);
            return;
          }
        }

        // Update document pages count and status
        await supabaseClient
          .from('documents')
          .update({ pages: numPages, status: 'done' })
          .eq('id', document.id);

        // Mark job as done (summary will be generated asynchronously)
        await supabaseClient
          .from('jobs')
          .update({ status: 'done', progress: 100 })
          .eq('id', job.id);

        logger.info({ requestId, documentId: document.id, rulesExtracted: rules.length }, "Document processing completed");

        // Fire-and-forget: trigger summary generation asynchronously
        triggerSummaryGeneration(document.id, rules).catch(err =>
          logger.error({ requestId, documentId: document.id, error: err.message }, "Failed to trigger summary generation")
        );
      } catch (error) {
        logger.error({
          event: "error",
          requestId,
          documentId: document.id,
          errorType: error instanceof Error ? error.constructor.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        } as ErrorContext, "Background processing error");

        // Update document status to error
        await supabaseClient
          .from('documents')
          .update({ status: 'error' })
          .eq('id', document.id);

        await supabaseClient
          .from('jobs')
          .update({
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
          })
          .eq('id', job.id);
      }
    })();

    return new Response(
      JSON.stringify({ documentId: document.id, jobId: job.id }),
      { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    logger.error({
      event: "error",
      requestId,
      errorType: error instanceof Error ? error.constructor.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
    } as Partial<ErrorContext>, "Upload error");

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Trigger summary generation asynchronously (fire-and-forget)
 * Calls the dedicated generate-summary Edge Function
 */
async function triggerSummaryGeneration(documentId: string, rules: RuleExtracted[]): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
  // Ensure we build the functions URL correctly regardless of SUPABASE_URL format
  const functionsUrl = supabaseUrl.includes('/rest/v1')
    ? supabaseUrl.replace('/rest/v1', '/functions/v1')
    : `${supabaseUrl}/functions/v1`;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!serviceRoleKey) {
    logger.warn({ documentId }, "SUPABASE_SERVICE_ROLE_KEY not configured, skipping summary generation");
    return;
  }

  // Await fetch initiation to ensure it starts before function shutdown
  try {
    await fetch(`${functionsUrl}/generate-summary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        documentId,
        rules: rules.map(r => ({ text: r.text }))
      })
    });
    logger.info({ documentId }, "Summary generation triggered successfully");
  } catch (err) {
    // Log error but don't throw (non-blocking)
    logger.warn({ documentId, error: err instanceof Error ? err.message : String(err) }, "Summary trigger failed (non-blocking)");
  }
}

/**
 * Calculate SHA-256 hash of file buffer for exact reuse detection
 */
async function calculateFileHash(buffer: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Parse PDF with PyMuPDF service (fallback to pdf-parse if unavailable)
 */
interface ParsedPDF {
  text: string;
  pages: number;
  parseBackend: "pymupdf" | "pdf-parse";
  parseDurationMs: number;
}

async function parsePDF(
  buffer: Uint8Array,
  requestId?: string
): Promise<ParsedPDF> {
  // Use centralized config from config.ts
  const { SERVICE_URL, SERVICE_TOKEN, TIMEOUT_MS, MAX_RETRIES } = PARSE_CONFIG;

  // Try PyMuPDF service if configured
  if (SERVICE_URL) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const startTime = Date.now();

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

        const formData = new FormData();
        const blob = new Blob([buffer], { type: "application/pdf" });
        formData.append("file", blob, "document.pdf");

        const headers: Record<string, string> = {};
        if (SERVICE_TOKEN) {
          headers["Authorization"] = `Bearer ${SERVICE_TOKEN}`;
        }

        const response = await fetch(`${SERVICE_URL}/parse`, {
          method: "POST",
          body: formData,
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          logger.warn({
            requestId,
            attempt: attempt + 1,
            status: response.status,
            error: errorText,
          }, "PyMuPDF service error");
          continue; // Retry or fallback
        }

        const data = await response.json();
        const pages = data.pages || [];
        const text = pages.map((p: any) => p.text).join("\n\n===PAGE_SEPARATOR===\n\n");
        const parseDuration = Date.now() - startTime;

        logger.info({
          requestId,
          parse_backend: "pymupdf",
          parse_duration_ms: parseDuration,
          pages: data.total_pages,
          textLength: text.length,
        }, "PDF parsed with PyMuPDF service");

        return {
          text,
          pages: data.total_pages,
          parseBackend: "pymupdf",
          parseDurationMs: parseDuration,
        };
      } catch (error) {
        logger.warn({
          requestId,
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
        }, "PyMuPDF service call failed");

        if (attempt === MAX_RETRIES - 1) {
          logger.info({ requestId }, "Falling back to pdf-parse");
          break; // Fall through to pdf-parse
        }
      }
    }
  }

  // Fallback: pdf-parse
  const startTime = Date.now();
  try {
    const pdfParse = await import("npm:pdf-parse@1.1.1");
    const pdfData = await pdfParse.default(buffer);
    const parseDuration = Date.now() - startTime;

    logger.info({
      requestId,
      parse_backend: "pdf-parse",
      parse_duration_ms: parseDuration,
      pages: pdfData.numpages,
      textLength: pdfData.text.length,
    }, "PDF parsed with pdf-parse (fallback)");

    return {
      text: pdfData.text,
      pages: pdfData.numpages,
      parseBackend: "pdf-parse",
      parseDurationMs: parseDuration,
    };
  } catch (error) {
    logger.error({
      requestId,
      error: error instanceof Error ? error.message : String(error),
    }, "PDF parsing failed completely");
    throw new Error("Failed to parse PDF with both PyMuPDF and pdf-parse");
  }
}

/**
 * Helper function pour appeler OpenAI avec retry et exponential backoff
 */
async function callOpenAIWithRetry(
  apiKey: string,
  systemPrompt: string,
  userContent: string,
  batchId: string,
  maxRetries = 3
): Promise<RuleExtracted[]> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini', // Corrigé : gpt-4o-mini au lieu de gpt-4.1-mini
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent }
          ],
          temperature: 0.3, // Réduit pour plus de cohérence
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn({ batchId, attempt: attempt + 1, status: response.status }, "OpenAI API error");

        // Rate limiting - délai optimisé mais sûr
        if (response.status === 429) {
          const waitTime = Math.min(
            Math.pow(2, attempt) * CONFIG.RETRY_DELAY_BASE_MS,
            CONFIG.RETRY_DELAY_MAX_MS
          );
          logger.info({ batchId, waitTime }, "Rate limited, waiting before retry");
          await new Promise(r => setTimeout(r, waitTime));
          continue;
        }

        // Erreur serveur - retry avec backoff optimisé
        if (response.status >= 500 && attempt < maxRetries - 1) {
          const waitTime = Math.min(
            Math.pow(2, attempt) * CONFIG.RETRY_DELAY_BASE_MS,
            CONFIG.RETRY_DELAY_SERVER_ERROR_MAX_MS
          );
          await new Promise(r => setTimeout(r, waitTime));
          continue;
        }

        return []; // Erreur non récupérable
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, CONFIG.RETRY_DELAY_BASE_MS));
          continue;
        }
        return [];
      }

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (err) {
        logger.error({ batchId, attempt: attempt + 1, error: err instanceof Error ? err.message : String(err) }, "JSON parsing error");
        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, CONFIG.RETRY_DELAY_BASE_MS));
          continue; // Retry en cas d'erreur de parsing
        }
        return [];
      }

      if (!parsed.rules || !Array.isArray(parsed.rules)) {
        logger.warn({ batchId, parsed }, "Invalid response format");
        return [];
      }

      return parsed.rules as RuleExtracted[];
    } catch (error) {
      logger.error({ batchId, attempt: attempt + 1, error: error instanceof Error ? error.message : String(error) }, "Error processing batch");
      if (attempt < maxRetries - 1) {
        const waitTime = Math.min(
          Math.pow(2, attempt) * CONFIG.RETRY_DELAY_BASE_MS,
          CONFIG.RETRY_DELAY_SERVER_ERROR_MAX_MS
        );
        await new Promise(r => setTimeout(r, waitTime));
      }
    }
  }

  return []; // Tous les retries ont échoué
}

/**
 * Calcule la similarité entre deux textes (Jaccard simplifié)
 */
function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

async function extractRulesFromText(
  text: string,
  totalPages: number,
  supabaseClient?: any,
  jobId?: string,
  requestId?: string
): Promise<RuleExtracted[]> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    logger.error({ requestId }, 'OPENAI_API_KEY not configured');
    return [];
  }

  // Monitoring de performance
  const startTime = Date.now();
  logger.info({ requestId, totalPages }, "[PERF] Starting extraction");

  // Prompt système amélioré avec instructions plus précises
  const SYSTEM_PROMPT = `
Tu es un expert en analyse de documents métier et extraction de règles.
Ton rôle est d'identifier des règles, contraintes, obligations ou conditions explicites dans le texte fourni.

UNE RÈGLE MÉTIER est :
- Une obligation claire (ex: "Les remboursements doivent être effectués sous 30 jours")
- Une condition explicite (ex: "Si le montant dépasse 1000€, une validation est requise")
- Une contrainte métier (ex: "Le délai maximum de traitement est de 5 jours ouvrés")
- Une règle de calcul ou de logique (ex: "La commission est calculée à 2% du montant HT")

Ce qui N'EST PAS une règle :
- Des descriptions générales sans contrainte
- Des exemples ou illustrations
- Des informations contextuelles sans obligation

Retourne STRICTEMENT un JSON de ce format :
{
  "rules": [
    {
      "text": "règle claire et concise (phrase complète extraite du document)",
      "conditions": ["condition 1", "condition 2"] ou [],
      "domain": "nom_du_domaine_ou_null" (ex: "Finance", "RH", "Logistique"),
      "tags": ["mots_clés", "pertinents"],
      "confidence": nombre_de_0_à_1 (0.9+ si très clair, 0.7-0.9 si ambigu, <0.7 si incertain),
      "source": {
        "page": numéro_de_page_estimé,
        "section": "titre_ou_numéro_de_section_ou_null"
      }
    }
  ]
}

Règles strictes :
- Ne pas inventer de règles qui n'existent pas dans le texte
- Une règle = une obligation/contrainte/condition métier explicite
- Baisse confidence si ambigu ou implicite
- Si aucune règle claire, retourne {"rules": []}
- Le texte de la règle doit être extrait tel quel du document (pas de reformulation)
`;

  // Token-aware chunking with LangChain
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: CONFIG.CHUNK_SIZE,
    chunkOverlap: CONFIG.CHUNK_OVERLAP,
    separators: ["\n\n", "\n", ". ", " ", ""]
  });

  const chunkTexts = await textSplitter.splitText(text);
  const chunks = chunkTexts.map((text, index) => ({ text, startIndex: index }));

  logger.info({ requestId, chunks: chunks.length }, "[PERF] Created chunks with LangChain");

  const allRules: RuleExtracted[] = [];

  // Configuration de parallélisation (utilise CONFIG)
  const batchSize = CONFIG.BATCH_SIZE;
  const maxConcurrentBatches = CONFIG.MAX_CONCURRENT_BATCHES;

  // Créer tous les batches
  const batches: Array<{ chunks: typeof chunks; index: number }> = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    batches.push({
      chunks: chunks.slice(i, i + batchSize),
      index: i
    });
  }

  const totalBatches = batches.length;
  let processedBatches = 0;

  logger.info({
    event: "extraction_started",
    requestId: requestId || "unknown",
    documentId: jobId || "unknown",
    jobId: jobId || "unknown",
    chunks: chunks.length,
    batches: totalBatches,
    totalPages,
    cache_backend: CACHE_BACKEND, // "none" for MVP (no semantic cache)
  } as ExtractionStartedContext, `[PERF] Processing ${totalBatches} batches with ${maxConcurrentBatches} concurrent (cache: ${CACHE_BACKEND})`);

  // Traiter les batches par groupes parallèles avec pause réduite
  for (let i = 0; i < batches.length; i += maxConcurrentBatches) {
    const batchGroup = batches.slice(i, i + maxConcurrentBatches);

    const batchPromises = batchGroup.map(async (batch) => {
      const userContent = batch.chunks.map((c, idx) =>
        `## Chunk ${batch.index + idx + 1}/${chunks.length}\n${c.text}`
      ).join('\n\n---\n\n');

      try {
        // Try cache first
        const cachedRules = await getCachedRules(userContent, requestId);

        let rules: RuleExtracted[];
        if (cachedRules) {
          rules = cachedRules;
          logger.debug({ requestId, batchIndex: batch.index }, "Using cached rules");
        } else {
          // Cache miss - call LLM
          rules = await callOpenAIWithRetry(
            apiKey,
            SYSTEM_PROMPT,
            userContent,
            `batch-${batch.index}`
          );

          // Cache extracted rules (fire-and-forget)
          cacheRules(userContent, rules, requestId, jobId, batch.index).catch((err) =>
            logger.debug({ requestId, error: err.message }, "Cache upsert failed (non-blocking)")
          );
        }

        processedBatches++;

        // Mise à jour de progression (tous les N batches) avec logs détaillés
        if (supabaseClient && jobId && processedBatches % CONFIG.UPDATE_PROGRESS_EVERY_N_BATCHES === 0) {
          const progress = 30 + Math.floor((processedBatches / totalBatches) * 40); // 30% -> 70%
          logger.info({ requestId, jobId, progress, batchesProcessed: processedBatches, totalBatches }, `[PROGRESS] Batch ${processedBatches}/${totalBatches} completed`);
          await supabaseClient
            .from('jobs')
            .update({ progress })
            .eq('id', jobId);
        }

        return rules;
      } catch (error) {
        logger.error({ requestId, batchIndex: batch.index, error: error instanceof Error ? error.message : String(error) }, "Error in batch");
        processedBatches++;
        return [];
      }
    });

    const results = await Promise.all(batchPromises);
    allRules.push(...results.flat());

    // No more pauses between groups - retry logic handles rate limiting
  }

  // Validation et nettoyage des règles
  const validatedRules = allRules
    .filter(r => {
      // Validation basique
      if (!r.text || r.text.trim().length < 10) return false;
      if (r.confidence < 0.3) return false; // Filtrer les règles trop peu confiantes
      return true;
    })
    .map(r => ({
      ...r,
      text: r.text.trim(),
      tags: r.tags.slice(0, 8), // Limiter à 8 tags
      confidence: Math.min(1, Math.max(0, r.confidence)), // S'assurer que confidence est entre 0 et 1
      source: {
        page: r.source?.page || 0,
        section: r.source?.section || null
      }
    }));

  // Déduplication O(n) avec SHA-256 hash
  const uniqueRules: RuleExtracted[] = [];
  const seenHashes = new Set<string>();

  for (const rule of validatedRules) {
    // Normalize text: remove punctuation, lowercase, take first 15 significant words
    const normalized = rule.text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 15)
      .join(' ');

    // Create SHA-256 hash for deterministic deduplication
    const encoder = new TextEncoder();
    const data = encoder.encode(normalized);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    if (!seenHashes.has(hashHex)) {
      seenHashes.add(hashHex);
      uniqueRules.push(rule);
    }
  }

  const duration = Date.now() - startTime;
  const estimatedCost = calculateCost(
    text.length * 0.4, // Approximation: 1 char ≈ 0.4 tokens
    uniqueRules.length * 100, // Avg 100 tokens per rule output
    "gpt-4o-mini"
  );

  // Get cache statistics
  const cacheStats = getCacheStats();

  logger.info({
    event: "extraction_completed",
    requestId: requestId || "unknown",
    documentId: jobId || "unknown",
    jobId: jobId || "unknown",
    durationMs: duration,
    rulesExtracted: allRules.length,
    uniqueRules: uniqueRules.length,
    costUsd: estimatedCost,
    cache_backend: CACHE_BACKEND, // "none" for MVP
    cacheHit: cacheStats.hitRate > 0, // Always false when cache disabled
    cacheHitRate: cacheStats.hitRate, // Always 0 when cache disabled
    cacheHits: cacheStats.hits, // Always 0 when cache disabled
    cacheMisses: cacheStats.misses, // Always 0 when cache disabled
  } as ExtractionCompletedContext, `[PERF] Extraction completed in ${duration}ms (cache: ${CACHE_BACKEND})`);

  logger.info({
    requestId,
    avgPerBatch: totalBatches > 0 ? (duration / totalBatches).toFixed(0) : 0,
    cache_backend: CACHE_BACKEND,
  }, "[PERF] Average per batch");

  return uniqueRules;
}
