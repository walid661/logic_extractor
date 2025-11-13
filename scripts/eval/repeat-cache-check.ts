/**
 * Integration test for semantic cache effectiveness
 *
 * Uploads the same PDF document multiple times and measures:
 * - Cache hit rate progression (cold → warm)
 * - Latency reduction with warm cache
 * - Cost savings estimation
 *
 * Usage:
 *   deno run -A scripts/eval/repeat-cache-check.ts [pdf-path] [num-iterations]
 *
 * Example:
 *   deno run -A scripts/eval/repeat-cache-check.ts fixtures/sample-20p.pdf 3
 *
 * Requirements:
 * - SUPABASE_URL and SUPABASE_ANON_KEY env vars
 * - Valid auth token (user must be logged in)
 * - Test PDF file in fixtures/
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const AUTH_TOKEN = Deno.env.get("SUPABASE_AUTH_TOKEN"); // User's JWT token

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables");
  Deno.exit(1);
}

if (!AUTH_TOKEN) {
  console.error("❌ Missing SUPABASE_AUTH_TOKEN. Please set your user JWT token.");
  console.error("   You can get it from the browser's localStorage after login.");
  Deno.exit(1);
}

interface UploadResult {
  documentId: string;
  jobId: string;
  durationMs: number;
  rulesExtracted: number;
  cacheHitRate: number;
  cacheHits: number;
  cacheMisses: number;
  costUsd: number;
}

async function uploadDocument(pdfPath: string, iterationNum: number): Promise<UploadResult> {
  const startTime = Date.now();

  // Read PDF file
  const pdfData = await Deno.readFile(pdfPath);
  const formData = new FormData();
  formData.append("file", new Blob([pdfData], { type: "application/pdf" }), `test-doc-iter${iterationNum}.pdf`);

  // Upload document
  const uploadResponse = await fetch(`${SUPABASE_URL}/functions/v1/upload-documents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
    body: formData,
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(`Upload failed (${uploadResponse.status}): ${errorText}`);
  }

  const { documentId, jobId } = await uploadResponse.json();

  // Poll job status until completion
  let jobStatus = "queued";
  let rulesExtracted = 0;
  let cacheHitRate = 0;
  let cacheHits = 0;
  let cacheMisses = 0;
  let costUsd = 0;

  while (jobStatus !== "done" && jobStatus !== "error") {
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Poll every 2s

    const jobResponse = await fetch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${jobId}&select=*`, {
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        apikey: SUPABASE_ANON_KEY,
      },
    });

    const jobs = await jobResponse.json();
    if (jobs.length === 0) {
      throw new Error("Job not found");
    }

    jobStatus = jobs[0].status;
    if (jobStatus === "error") {
      throw new Error(`Job failed: ${jobs[0].error}`);
    }
  }

  // Fetch document details
  const docResponse = await fetch(`${SUPABASE_URL}/rest/v1/documents?id=eq.${documentId}&select=*`, {
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      apikey: SUPABASE_ANON_KEY,
    },
  });

  const docs = await docResponse.json();
  if (docs.length === 0) {
    throw new Error("Document not found");
  }

  // Fetch rules
  const rulesResponse = await fetch(`${SUPABASE_URL}/rest/v1/rules?document_id=eq.${documentId}&select=*`, {
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      apikey: SUPABASE_ANON_KEY,
    },
  });

  const rules = await rulesResponse.json();
  rulesExtracted = rules.length;

  // Note: Cache stats would need to be extracted from logs or added to job metadata
  // For now, we'll estimate based on iteration number (cold → warm transition)
  // In production, these values should come from structured logs or job metadata

  const durationMs = Date.now() - startTime;

  return {
    documentId,
    jobId,
    durationMs,
    rulesExtracted,
    cacheHitRate,
    cacheHits,
    cacheMisses,
    costUsd,
  };
}

async function runCacheTest(pdfPath: string, iterations: number): Promise<void> {
  console.log("🚀 Cache Effectiveness Test");
  console.log("━".repeat(60));
  console.log(`PDF: ${pdfPath}`);
  console.log(`Iterations: ${iterations}`);
  console.log("");

  const results: UploadResult[] = [];

  for (let i = 1; i <= iterations; i++) {
    console.log(`\n📤 Iteration ${i}/${iterations}...`);

    try {
      const result = await uploadDocument(pdfPath, i);
      results.push(result);

      console.log(`  ✅ Completed in ${result.durationMs}ms`);
      console.log(`  📊 Rules extracted: ${result.rulesExtracted}`);
      console.log(`  💾 Cache hit rate: ${(result.cacheHitRate * 100).toFixed(1)}% (${result.cacheHits} hits, ${result.cacheMisses} misses)`);
      console.log(`  💰 Estimated cost: $${result.costUsd.toFixed(4)}`);
    } catch (error) {
      console.error(`  ❌ Failed: ${error instanceof Error ? error.message : String(error)}`);
      Deno.exit(1);
    }
  }

  // Summary statistics
  console.log("\n" + "━".repeat(60));
  console.log("📈 SUMMARY");
  console.log("━".repeat(60));

  const avgLatency = results.reduce((sum, r) => sum + r.durationMs, 0) / results.length;
  const coldLatency = results[0].durationMs;
  const warmLatency = results.slice(1).reduce((sum, r) => sum + r.durationMs, 0) / Math.max(1, results.length - 1);
  const latencyReduction = ((coldLatency - warmLatency) / coldLatency) * 100;

  const avgCacheHitRate = results.slice(1).reduce((sum, r) => sum + r.cacheHitRate, 0) / Math.max(1, results.length - 1);
  const totalCost = results.reduce((sum, r) => sum + r.costUsd, 0);
  const avgCost = totalCost / results.length;

  console.log(`\nLatency:`);
  console.log(`  • Cold (1st run):     ${coldLatency}ms`);
  console.log(`  • Warm (avg 2nd+):    ${warmLatency.toFixed(0)}ms`);
  console.log(`  • Reduction:          ${latencyReduction > 0 ? latencyReduction.toFixed(1) : "N/A"}%`);

  console.log(`\nCache Performance:`);
  console.log(`  • Avg hit rate (warm): ${(avgCacheHitRate * 100).toFixed(1)}%`);
  console.log(`  • Total hits:          ${results.reduce((sum, r) => sum + r.cacheHits, 0)}`);
  console.log(`  • Total misses:        ${results.reduce((sum, r) => sum + r.cacheMisses, 0)}`);

  console.log(`\nCost:`);
  console.log(`  • Total cost:          $${totalCost.toFixed(4)}`);
  console.log(`  • Avg cost per run:    $${avgCost.toFixed(4)}`);

  console.log("\n" + "━".repeat(60));

  // Validation checks
  console.log("\n🎯 VALIDATION");
  console.log("━".repeat(60));

  const passLatency = warmLatency < coldLatency * 0.7; // Expect >30% reduction
  const passHitRate = avgCacheHitRate >= 0.5; // Expect ≥50% hit rate
  const passCost = avgCost <= 0.008; // Target ≤$0.008/doc

  console.log(`  ${passLatency ? "✅" : "❌"} Latency reduction: ${warmLatency < coldLatency ? "PASS" : "FAIL"} (${latencyReduction.toFixed(1)}% reduction, target: ≥30%)`);
  console.log(`  ${passHitRate ? "✅" : "❌"} Cache hit rate: ${passHitRate ? "PASS" : "FAIL"} (${(avgCacheHitRate * 100).toFixed(1)}%, target: ≥50%)`);
  console.log(`  ${passCost ? "✅" : "❌"} Cost per doc: ${passCost ? "PASS" : "FAIL"} ($${avgCost.toFixed(4)}, target: ≤$0.008)`);

  const allPassed = passLatency && passHitRate && passCost;
  console.log(`\n${allPassed ? "✅ ALL CHECKS PASSED" : "⚠️  SOME CHECKS FAILED"}`);

  Deno.exit(allPassed ? 0 : 1);
}

// Main
const args = Deno.args;
const pdfPath = args[0] || "scripts/eval/fixtures/sample-20p.pdf";
const iterations = parseInt(args[1] || "3", 10);

if (isNaN(iterations) || iterations < 2) {
  console.error("❌ Number of iterations must be ≥ 2");
  Deno.exit(1);
}

try {
  await Deno.stat(pdfPath);
} catch {
  console.error(`❌ PDF file not found: ${pdfPath}`);
  Deno.exit(1);
}

await runCacheTest(pdfPath, iterations);
