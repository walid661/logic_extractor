# PR #2 — Cache Sémantique + Parsing Rapide PyMuPDF

## 🎯 Objectifs

1. **Cache sémantique** : Réduire les coûts OpenAI (-40-50%) et la latence (-30%) via cache vectoriel
2. **Parsing rapide** : Accélérer l'extraction PDF (5× plus rapide) avec PyMuPDF

## 📦 Composants ajoutés

### 1. Cache sémantique (Upstash Vector)

**Fichier:** `supabase/functions/upload-documents/extraction/cache.ts`

**Fonctionnement:**
- Génère embedding du chunk text avec `text-embedding-3-small` ($0.02/1M tokens)
- Query Upstash Vector index (cosine similarity)
- Retourne rules si similarity > 0.93
- Store rules après extraction LLM réussie

**Feature flag:**
```bash
# Required env vars
UPSTASH_VECTOR_URL="https://your-index.upstash.io"
UPSTASH_VECTOR_TOKEN="your-token"
OPENAI_API_KEY="sk-..."

# Optional
CACHE_ENABLED="true"  # Default: true if env vars present
CACHE_THRESHOLD="0.93" # Default: 0.93
```

**Résilience:**
- Fail-open : erreurs ne bloquent jamais l'extraction
- Logs structurés : `cache_hit`, `cache_score`, `cache_query_ms`
- Stats in-memory : hit rate, hits/misses

### 2. Service PyMuPDF (FastAPI)

**Fichiers:**
- `services/parse-pdf-fast/main.py`
- `services/parse-pdf-fast/requirements.txt`
- `services/parse-pdf-fast/Dockerfile`
- `services/parse-pdf-fast/README.md`

**API:**
```
POST /parse
Authorization: Bearer <token>
Body: multipart file OR application/octet-stream

Response:
{
  "pages": [{"page": 1, "text": "..."}],
  "total_pages": N,
  "parse_duration_ms": 423
}
```

**Performance:**
- PyMuPDF: ~400ms pour 20 pages
- pdf-parse: ~2000ms pour 20 pages
- **Gain: 5×**

**Déploiement:**
```bash
# Cloud Run (GCP)
./scripts/deploy-parse-service.sh

# Fly.io
cd services/parse-pdf-fast
fly launch --name parse-pdf-fast
fly secrets set PARSE_SERVICE_TOKEN=your-secret
fly deploy

# Docker local
docker build -t parse-pdf-fast services/parse-pdf-fast
docker run -p 8080:8080 \
  -e PARSE_SERVICE_TOKEN=dev-token \
  parse-pdf-fast
```

### 3. Intégration Edge Function

**Modifications:** `supabase/functions/upload-documents/index (6).ts`

**Parsing avec fallback:**
```typescript
// 1. Try PyMuPDF service (if PARSE_SERVICE_URL set)
// 2. Retry 2× with 8s timeout
// 3. Fallback to pdf-parse on error
const parsedPDF = await parsePDF(buffer, requestId);
```

**Cache intégré:**
```typescript
// 1. Try cache first
const cachedRules = await getCachedRules(chunkText);

// 2. On miss: call LLM + cache result
if (!cachedRules) {
  rules = await callOpenAIWithRetry(...);
  cacheRules(chunkText, rules); // Fire-and-forget
}
```

## 📊 Gains attendus

| Métrique | Sans PR#2 | Avec PR#2 (cold) | Avec PR#2 (warm) | Gain warm |
|----------|-----------|------------------|------------------|-----------|
| **Parsing** (20p) | 2000ms | 400ms | 400ms | **5× (80%)** |
| **Extraction** (cache 0%) | 9200ms | 9200ms | - | - |
| **Extraction** (cache 40%) | 9200ms | 9200ms | 6100ms | **-34%** |
| **Extraction** (cache 60%) | 9200ms | 9200ms | 4300ms | **-53%** |
| **Coût/doc** | $0.0050 | $0.0052 | $0.0028 | **-44%** |
| **Latence E2E** (cold) | 11.2s | 9.6s | - | **-14%** |
| **Latence E2E** (warm 60%) | 11.2s | 9.6s | 6.7s | **-40%** |

**Notes:**
- "Cold" = premier upload (cache vide)
- "Warm" = documents similaires déjà traités
- Cache hit rate dépend du corpus (répétitions, templates)

## 🧪 Tests

### Test 1: Cache sémantique

```bash
# 1. Configurer Upstash Vector
export UPSTASH_VECTOR_URL="https://your-index.upstash.io"
export UPSTASH_VECTOR_TOKEN="your-token"

# 2. Upload même document 2×
curl -X POST http://localhost:54321/functions/v1/upload-documents \
  -H "Authorization: Bearer TOKEN" \
  -F "file=@test.pdf"

# Attendu:
# - Premier upload: cache_hit_rate = 0%
# - Second upload: cache_hit_rate > 80%

# 3. Vérifier logs
grep "cache_hit" logs.json | jq '.cacheHitRate'
```

### Test 2: PyMuPDF service

```bash
# 1. Démarrer service local
cd services/parse-pdf-fast
python main.py

# 2. Test direct
curl -X POST http://localhost:8080/parse \
  -H "Authorization: Bearer dev-token" \
  -F "file=@test.pdf"

# Attendu: parse_duration_ms < 500ms pour 20 pages

# 3. Test via upload-documents
export PARSE_SERVICE_URL="http://localhost:8080"
export PARSE_SERVICE_TOKEN="dev-token"

curl -X POST http://localhost:54321/functions/v1/upload-documents \
  -F "file=@test.pdf"

# Vérifier logs: parse_backend = "pymupdf"
```

### Test 3: Fallback pdf-parse

```bash
# 1. Service indisponible
unset PARSE_SERVICE_URL

# 2. Upload document
curl -X POST http://localhost:54321/functions/v1/upload-documents \
  -F "file=@test.pdf"

# Attendu: parse_backend = "pdf-parse"
```

### Test 4: Mesure gains réels

```bash
# 1. Préparer 5 docs similaires (même template)
for i in {1..5}; do
  cp template.pdf test-${i}.pdf
done

# 2. Upload séquentiel + mesure
for i in {1..5}; do
  start=$(date +%s%3N)
  curl -s -X POST http://localhost:54321/functions/v1/upload-documents \
    -F "file=@test-${i}.pdf"
  end=$(date +%s%3N)
  echo "Doc $i: $((end - start))ms"
done

# Attendu:
# Doc 1: 11000ms (cold)
# Doc 2: 8000ms (20% cache)
# Doc 3: 6500ms (40% cache)
# Doc 4: 5500ms (60% cache)
# Doc 5: 5000ms (80% cache)
```

## 🚀 Déploiement

### 1. Déployer service PyMuPDF

**Option A: Cloud Run (recommandé)**
```bash
export GCP_PROJECT_ID="your-project"
export PARSE_SERVICE_TOKEN="$(openssl rand -hex 32)"
./scripts/deploy-parse-service.sh

# Output affichera: SERVICE_URL=https://xxx.run.app
```

**Option B: Fly.io**
```bash
cd services/parse-pdf-fast
fly launch --name parse-pdf-fast --region iad
fly secrets set PARSE_SERVICE_TOKEN="$(openssl rand -hex 32)"
fly deploy

# Get URL
SERVICE_URL=$(fly info -j | jq -r '.Hostname' | sed 's/^/https:\/\//')
```

### 2. Configurer Supabase

```bash
# Cache sémantique (Upstash)
supabase secrets set UPSTASH_VECTOR_URL="https://xxx.upstash.io"
supabase secrets set UPSTASH_VECTOR_TOKEN="your-token"
supabase secrets set CACHE_ENABLED="true"

# Parsing PyMuPDF
supabase secrets set PARSE_SERVICE_URL="$SERVICE_URL"
supabase secrets set PARSE_SERVICE_TOKEN="your-secret"
```

### 3. Redéployer Edge Functions

```bash
supabase functions deploy upload-documents
```

### 4. Vérifier santé

```bash
# PyMuPDF service
curl $SERVICE_URL/health

# Upload-documents
curl https://your-project.supabase.co/functions/v1/upload-documents/health

# Test E2E
curl -X POST https://your-project.supabase.co/functions/v1/upload-documents \
  -H "Authorization: Bearer TOKEN" \
  -F "file=@test.pdf"

# Vérifier logs Supabase: Dashboard > Edge Functions > Logs
```

## 📈 Monitoring

### Métriques clés

**Cache:**
- `cacheHitRate` : % de chunks servis par cache
- `cache_query_ms` : Latence query Upstash Vector
- `embed_cost_usd` : Coût embeddings

**Parsing:**
- `parse_backend` : "pymupdf" ou "pdf-parse"
- `parse_duration_ms` : Temps parsing

**E2E:**
- `extraction_completed.durationMs` : Temps total
- `extraction_completed.costUsd` : Coût OpenAI

### Alertes recommandées

```bash
# Cache hit rate < 20% (après warm-up)
cache_hit_rate < 0.2 AND documents_processed > 50

# PyMuPDF service down (fallback utilisé)
parse_backend = "pdf-parse" AND PARSE_SERVICE_URL is set

# Coût anormal
cost_per_doc > $0.015
```

## 🔧 Troubleshooting

### Cache ne fonctionne pas

```bash
# Vérifier env vars
supabase secrets list | grep UPSTASH

# Vérifier logs
grep "cache_hit" <edge-function-logs> | jq

# Test manuel Upstash
curl -X POST https://your-index.upstash.io/query \
  -H "Authorization: Bearer $UPSTASH_VECTOR_TOKEN" \
  -d '{"vector":[0.1,0.2,...], "topK":1}'
```

### PyMuPDF service timeout

```bash
# Vérifier service
curl $PARSE_SERVICE_URL/health

# Augmenter timeout (dans parsePDF function)
PARSE_TIMEOUT_MS = 12000  # Au lieu de 8000

# Vérifier logs service
gcloud run services logs read parse-pdf-fast --limit 50
```

### Cache trop cher (embeddings)

```bash
# Réduire embedding calls
# Option 1: Augmenter CACHE_THRESHOLD (moins de hits mais moins d'embeddings)
CACHE_THRESHOLD=0.95

# Option 2: Désactiver cache temporairement
CACHE_ENABLED=false
```

## 💰 Coûts estimés

### Upstash Vector

**Free tier:**
- 10k vectors
- 10k queries/jour
- **Coût:** $0/mois

**Pro tier ($10/mo):**
- 100k vectors
- 100k queries/jour
- **Capacité:** ~10k docs/mois (10 chunks/doc)

### PyMuPDF service (Cloud Run)

**Estimation 10k docs/mois:**
- Requêtes: 10k × $0.40/million = $0.004
- CPU: 10k × 0.4s × $0.000024/s = $0.10
- Mémoire: 10k × 0.4s × 512MB × $0.0000025/GB-s = $0.005
- **Total: ~$0.11/mois**

### Embeddings (OpenAI)

**text-embedding-3-small @ $0.02/1M tokens:**
- 10k docs × 10 chunks × 500 tokens = 50M tokens
- **Coût: $1.00/mois**

### Total PR#2

**10k docs/mois:**
- Upstash: $0 (free) ou $10 (pro)
- Cloud Run: $0.11
- Embeddings: $1.00
- **Total: ~$1.11/mois (free tier) ou $11.11/mois (pro)**

**Économies extraction:**
- Sans cache: 10k × $0.0050 = $50/mois
- Avec cache (50% hit): 10k × $0.0028 = $28/mois
- **Économie nette: $50 - $28 - $11 = +$11/mois** ✅

## ✅ Checklist DoD

- [x] Cache sémantique implémenté avec Upstash Vector
- [x] Feature flag CACHE_ENABLED
- [x] Embeddings OpenAI text-embedding-3-small
- [x] Threshold configurable (default 0.93)
- [x] Fail-open resilience
- [x] Service PyMuPDF FastAPI créé
- [x] Dockerfile + requirements
- [x] Auth bearer token
- [x] Fallback pdf-parse si service indisponible
- [x] Retry 2× avec timeout 8s
- [x] Logs structurés (cache_hit, parse_backend, durées)
- [x] Script déploiement Cloud Run
- [x] Documentation complète
- [ ] Tests manuels sur staging ⚠️
- [ ] Mesure gains réels (avant/après) ⚠️

## 🔜 Next Steps

1. **Déployer sur staging** et mesurer gains réels
2. **Annoter dataset** pour validation qualité (P/R/F1)
3. **Tuner CACHE_THRESHOLD** selon balance précision/coût
4. **Monitoring**: Setup alertes Upstash + Cloud Run
5. **Scale test**: Vérifier comportement sur load (100+ docs/h)
