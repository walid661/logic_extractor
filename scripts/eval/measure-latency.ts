#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env

/**
 * Evaluation harness for Logic Extractor
 *
 * Measures end-to-end latency and rule extraction count
 * Future: Add P/R/F1 metrics when gold dataset is available
 *
 * Usage:
 *   deno run --allow-net --allow-read --allow-env scripts/eval/measure-latency.ts
 *
 * Requirements:
 *   - SUPABASE_URL env var
 *   - SUPABASE_ANON_KEY env var
 *   - Valid user auth token
 */

import { createClient } from "npm:@supabase/supabase-js@2";

interface UploadResponse {
  documentId: string;
  jobId: string;
}

interface JobStatus {
  status: "running" | "done" | "error";
  progress: number;
  error?: string;
}

interface Rule {
  id: string;
  text: string;
  confidence: number;
  domain: string | null;
  tags: string[];
}

interface EvalResult {
  documentId: string;
  fileName: string;
  latencyMs: number;
  rulesExtracted: number;
  avgConfidence: number;
  status: "success" | "error";
  error?: string;
}

// Configuration
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 180000; // 3 minutes timeout

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Error: SUPABASE_URL and SUPABASE_ANON_KEY must be set");
  Deno.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Upload document and wait for completion
 */
async function measureDocumentProcessing(filePath: string): Promise<EvalResult> {
  const startTime = Date.now();
  const fileName = filePath.split("/").pop() || "unknown";

  console.log(`\n📄 Processing: ${fileName}`);

  try {
    // Read file
    const fileData = await Deno.readFile(filePath);
    const file = new File([fileData], fileName, { type: "application/pdf" });

    // Get session
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw new Error("Not authenticated. Please login first.");
    }

    // Upload document
    const formData = new FormData();
    formData.append("file", file);

    const uploadResp = await supabase.functions.invoke("upload-documents", {
      body: formData,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    if (uploadResp.error) {
      throw new Error(`Upload failed: ${uploadResp.error.message}`);
    }

    const { documentId, jobId } = uploadResp.data as UploadResponse;
    console.log(`  ⏳ Job ID: ${jobId}`);

    // Poll job status
    let elapsedMs = 0;
    while (elapsedMs < MAX_WAIT_MS) {
      const statusResp = await supabase.functions.invoke("get-job-status", {
        body: { jobId },
      });

      if (statusResp.error) {
        throw new Error(`Status check failed: ${statusResp.error.message}`);
      }

      const jobStatus = statusResp.data as JobStatus;
      console.log(`  📊 Progress: ${jobStatus.progress}% (${jobStatus.status})`);

      if (jobStatus.status === "done") {
        const latencyMs = Date.now() - startTime;

        // Fetch extracted rules
        const { data: rules, error: rulesError } = await supabase
          .from("rules")
          .select("id, text, confidence, domain, tags")
          .eq("document_id", documentId);

        if (rulesError) {
          throw new Error(`Failed to fetch rules: ${rulesError.message}`);
        }

        const rulesData = rules as Rule[];
        const avgConfidence = rulesData.length > 0
          ? rulesData.reduce((sum, r) => sum + r.confidence, 0) / rulesData.length
          : 0;

        console.log(`  ✅ Completed in ${(latencyMs / 1000).toFixed(1)}s`);
        console.log(`  📝 Rules extracted: ${rulesData.length}`);
        console.log(`  🎯 Avg confidence: ${(avgConfidence * 100).toFixed(1)}%`);

        return {
          documentId,
          fileName,
          latencyMs,
          rulesExtracted: rulesData.length,
          avgConfidence,
          status: "success",
        };
      }

      if (jobStatus.status === "error") {
        throw new Error(`Job failed: ${jobStatus.error || "Unknown error"}`);
      }

      // Wait before next poll
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      elapsedMs += POLL_INTERVAL_MS;
    }

    throw new Error(`Timeout after ${MAX_WAIT_MS / 1000}s`);
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    console.log(`  ❌ Error: ${error instanceof Error ? error.message : String(error)}`);

    return {
      documentId: "",
      fileName,
      latencyMs,
      rulesExtracted: 0,
      avgConfidence: 0,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run evaluation on all fixtures
 */
async function runEvaluation() {
  console.log("🚀 Logic Extractor - Latency Evaluation Harness\n");
  console.log("=" .repeat(60));

  // Find all PDF files in fixtures directory
  const fixturesDir = "./scripts/eval/fixtures";
  const fixtures: string[] = [];

  try {
    for await (const entry of Deno.readDir(fixturesDir)) {
      if (entry.isFile && entry.name.endsWith(".pdf")) {
        fixtures.push(`${fixturesDir}/${entry.name}`);
      }
    }
  } catch (error) {
    console.error(`\n⚠️  No fixtures found in ${fixturesDir}`);
    console.error("   Please add sample PDF files to test.");
    console.error("\n   To create a simple test file:");
    console.error("   echo '%PDF-1.4\\n1 0 obj\\n<</Type/Catalog/Pages 2 0 R>>\\nendobj' > fixtures/sample.pdf");
    Deno.exit(1);
  }

  if (fixtures.length === 0) {
    console.error("\n⚠️  No PDF files found in fixtures directory");
    Deno.exit(1);
  }

  console.log(`\n📦 Found ${fixtures.length} fixture(s) to process\n`);

  // Process each fixture
  const results: EvalResult[] = [];
  for (const fixture of fixtures) {
    const result = await measureDocumentProcessing(fixture);
    results.push(result);
  }

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 EVALUATION SUMMARY\n");

  const successResults = results.filter((r) => r.status === "success");

  if (successResults.length > 0) {
    const avgLatency = successResults.reduce((sum, r) => sum + r.latencyMs, 0) / successResults.length;
    const totalRules = successResults.reduce((sum, r) => sum + r.rulesExtracted, 0);
    const avgConfidence = successResults.reduce((sum, r) => sum + r.avgConfidence, 0) / successResults.length;

    console.log(`✅ Successful: ${successResults.length}/${results.length}`);
    console.log(`⏱️  Avg latency: ${(avgLatency / 1000).toFixed(1)}s`);
    console.log(`📝 Total rules: ${totalRules}`);
    console.log(`🎯 Avg confidence: ${(avgConfidence * 100).toFixed(1)}%`);

    // Latency distribution
    const latencies = successResults.map((r) => r.latencyMs).sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];

    console.log(`\n📈 Latency distribution:`);
    console.log(`   p50: ${(p50 / 1000).toFixed(1)}s`);
    console.log(`   p95: ${(p95 / 1000).toFixed(1)}s`);
  }

  const errorResults = results.filter((r) => r.status === "error");
  if (errorResults.length > 0) {
    console.log(`\n❌ Failed: ${errorResults.length}/${results.length}`);
    errorResults.forEach((r) => {
      console.log(`   - ${r.fileName}: ${r.error}`);
    });
  }

  console.log("\n" + "=".repeat(60));
  console.log("\n💡 Next steps:");
  console.log("   1. Annotate fixtures with ground truth rules");
  console.log("   2. Add P/R/F1 calculation");
  console.log("   3. Track cost per document\n");
}

// Main
if (import.meta.main) {
  await runEvaluation();
}
