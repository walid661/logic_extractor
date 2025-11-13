/**
 * Generate document summary from extracted rules
 *
 * This function is called asynchronously (fire-and-forget) by upload-documents
 * to avoid blocking the main extraction flow.
 *
 * Expects POST body: { documentId: string, rules: Array<{text: string}> }
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { logger, generateRequestId, calculateCost, type SummaryContext } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Rule {
  text: string;
}

interface RequestBody {
  documentId: string;
  rules: Rule[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = generateRequestId();
  const startTime = Date.now();

  try {
    // Parse request body
    const body: RequestBody = await req.json();
    const { documentId, rules } = body;

    if (!documentId || !rules || !Array.isArray(rules)) {
      return new Response(
        JSON.stringify({ error: "Invalid request body. Expected { documentId, rules }" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logger.info({
      event: "summary_started",
      requestId,
      documentId,
      rulesCount: rules.length,
    } as Partial<SummaryContext>, "Starting summary generation");

    // Create Supabase client with service role key
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured");
    }

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);

    // Generate summary
    const summary = await generateSummary(rules, requestId);

    if (summary) {
      // Update document with summary
      const { error: updateError } = await supabaseClient
        .from("documents")
        .update({ summary })
        .eq("id", documentId);

      if (updateError) {
        logger.error({ requestId, documentId, error: updateError.message }, "Failed to update document summary");
        throw updateError;
      }

      const durationMs = Date.now() - startTime;
      logger.info({
        event: "summary_completed",
        requestId,
        documentId,
        durationMs,
        summaryLength: summary.length,
      } as Partial<SummaryContext>, "Summary generation completed");

      return new Response(
        JSON.stringify({ success: true, documentId, summaryLength: summary.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      throw new Error("Summary generation returned empty result");
    }
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error({
      event: "error",
      requestId,
      errorType: error instanceof Error ? error.constructor.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs,
    }, "Summary generation failed");

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function generateSummary(rules: Rule[], requestId: string): Promise<string | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    logger.error({ requestId }, "OPENAI_API_KEY not configured");
    return null;
  }

  if (rules.length === 0) {
    logger.info({ requestId }, "No rules to summarize");
    return null;
  }

  const summaryPrompt = `
Tu es un assistant qui résume des règles métier extraites d'un document.
Voici la liste des règles extraites :

${rules.map((r, i) => `${i + 1}. ${r.text}`).join("\n")}

Résume en 3 phrases maximum la logique métier principale du document,
en restant factuel et synthétique, sans ajout d'information externe.
  `;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Tu résumes des documents métier." },
          { role: "user", content: summaryPrompt },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ requestId, status: response.status, error: errorText }, "OpenAI API error for summary");
      return null;
    }

    const data = await response.json();
    const summary = data?.choices?.[0]?.message?.content?.trim() ?? null;

    // Log cost
    if (data.usage) {
      const cost = calculateCost(data.usage.prompt_tokens, data.usage.completion_tokens, "gpt-4o-mini");
      logger.info({ requestId, costUsd: cost, tokens: data.usage }, "Summary cost");
    }

    return summary;
  } catch (error) {
    logger.error(
      { requestId, error: error instanceof Error ? error.message : String(error) },
      "Error generating summary"
    );
    return null;
  }
}
