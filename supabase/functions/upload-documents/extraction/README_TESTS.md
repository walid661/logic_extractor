# Cache Tests Documentation

## Unit Tests

### Running Unit Tests

The cache module (`cache.ts`) has comprehensive unit tests using Deno's native test runner:

```bash
# Run all tests
cd supabase/functions/upload-documents/extraction
deno test --allow-env --allow-net cache.test.ts

# Run with coverage
deno test --allow-env --allow-net --coverage=coverage cache.test.ts
deno coverage coverage

# Run specific test
deno test --allow-env --allow-net --filter "getCacheStats" cache.test.ts
```

### Test Coverage

The unit tests cover:

1. **getCacheStats()** - Initial state validation
2. **getCachedRules()**
   - Returns null when cache disabled
   - Returns null on cache miss (low similarity)
   - Returns cached rules on cache hit (high similarity)
   - Handles OpenAI API errors gracefully (fail-open)
3. **cacheRules()**
   - Successfully upserts rules to vector index
   - Handles Upstash upsert errors gracefully (fail-open)

All tests use mocked fetch to avoid external API calls.

## Integration Tests

### Repeat Cache Check Script

The `repeat-cache-check.ts` script tests cache effectiveness in a real environment:

```bash
# Prerequisites
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_ANON_KEY="your-anon-key"
export SUPABASE_AUTH_TOKEN="your-user-jwt-token"  # Get from browser localStorage after login

# Run test (default: 3 iterations)
deno run -A scripts/eval/repeat-cache-check.ts fixtures/sample-20p.pdf 3

# Run with more iterations
deno run -A scripts/eval/repeat-cache-check.ts fixtures/sample-20p.pdf 5
```

### What It Measures

1. **Latency Progression**
   - Cold latency (1st upload, cache empty)
   - Warm latency (2nd+ uploads, cache populated)
   - Expected: ≥30% reduction on warm cache

2. **Cache Hit Rate**
   - Tracks hits/misses across iterations
   - Expected: ≥50% hit rate on 2nd+ uploads

3. **Cost Savings**
   - Estimates OpenAI API costs
   - Expected: ≤$0.008 per document

### Success Criteria

The script validates against the PR #2 DoD (Definition of Done):

- ✅ Warm latency ≥30% faster than cold
- ✅ Cache hit rate ≥50% on repeated uploads
- ✅ Cost per document ≤$0.008

### Example Output

```
🚀 Cache Effectiveness Test
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PDF: fixtures/sample-20p.pdf
Iterations: 3

📤 Iteration 1/3...
  ✅ Completed in 11200ms
  📊 Rules extracted: 45
  💾 Cache hit rate: 0.0% (0 hits, 15 misses)
  💰 Estimated cost: $0.0075

📤 Iteration 2/3...
  ✅ Completed in 5300ms
  📊 Rules extracted: 45
  💾 Cache hit rate: 60.0% (9 hits, 6 misses)
  💰 Estimated cost: $0.0030

📤 Iteration 3/3...
  ✅ Completed in 4800ms
  📊 Rules extracted: 45
  💾 Cache hit rate: 73.3% (11 hits, 4 misses)
  💰 Estimated cost: $0.0020

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Latency:
  • Cold (1st run):     11200ms
  • Warm (avg 2nd+):    5050ms
  • Reduction:          54.9%

Cache Performance:
  • Avg hit rate (warm): 66.7%
  • Total hits:          20
  • Total misses:        25

Cost:
  • Total cost:          $0.0125
  • Avg cost per run:    $0.0042

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 VALIDATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ Latency reduction: PASS (54.9% reduction, target: ≥30%)
  ✅ Cache hit rate: PASS (66.7%, target: ≥50%)
  ✅ Cost per doc: PASS ($0.0042, target: ≤$0.008)

✅ ALL CHECKS PASSED
```

## Manual Testing Procedures

### 1. Test Cache with Real Document

```bash
# Upload a document (cold cache)
curl -X POST https://your-project.supabase.co/functions/v1/upload-documents \
  -H "Authorization: Bearer <your-token>" \
  -F "file=@test-doc.pdf"

# Check logs for cache_miss events
# Should see: cache_hit: false

# Upload same document again (warm cache)
curl -X POST https://your-project.supabase.co/functions/v1/upload-documents \
  -H "Authorization: Bearer <your-token>" \
  -F "file=@test-doc.pdf"

# Check logs for cache_hit events
# Should see: cache_hit: true, cache_score: 0.95+
```

### 2. Test Periodic Stats Logging

After 100 cache requests, logs should include:

```json
{
  "event": "cache_stats_periodic",
  "total_requests": 100,
  "cache_hits": 58,
  "cache_misses": 42,
  "cache_hit_rate": "58.0%",
  "hit_rate_decimal": 0.58
}
```

### 3. Test Fallback Behavior

Disable cache to verify fail-open:

```bash
# Temporarily unset cache env vars
unset UPSTASH_VECTOR_URL

# Upload should still work (cache bypassed)
# Logs should show: "Cache not available"
```

## Troubleshooting

### Tests Fail to Connect to Upstash

If unit tests fail with network errors, ensure env vars are set:

```bash
export UPSTASH_VECTOR_URL="https://your-vector-db.upstash.io"
export UPSTASH_VECTOR_TOKEN="your-token"
export OPENAI_API_KEY="sk-..."
```

Or mock the endpoints in your test (already done in `cache.test.ts`).

### Integration Test Shows 0% Hit Rate

Possible causes:

1. **Cache disabled** - Check `CACHE_ENABLED` env var
2. **Different chunks** - PDF chunking must be deterministic
3. **Threshold too high** - Lower `CACHE_THRESHOLD` from 0.93 to 0.90
4. **Cold start** - Vector index needs time to propagate (wait 1-2s between uploads)

### Logs Missing Cache Events

Check log level:

```bash
export LOG_LEVEL=debug  # Show cache_miss events
export LOG_LEVEL=info   # Show cache_hit events only
```
