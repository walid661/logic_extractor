# Fast PDF Parsing Service

Microservice HTTP pour extraction PDF rapide via PyMuPDF (5× plus rapide que pdf-parse).

## Fonctionnalités

- **Parsing rapide:** PyMuPDF (fitz) - 400ms au lieu de 2000ms pour 20 pages
- **Extraction de tableaux:** pdfplumber - Intégration pour extraction structurée des tableaux
- **API simple:** POST /parse avec multipart ou raw body
- **Auth:** Bearer token optionnel
- **Logs JSON:** Compatible avec stack observabilité moderne
- **Santé:** Endpoints `/` et `/health`

## Déploiement

### Local (dev)

```bash
# Installer dépendances
cd services/parse-pdf-fast
pip install -r requirements.txt

# Lancer service
export PARSE_SERVICE_TOKEN="dev-secret-token"
python main.py

# Test
curl -X POST http://localhost:8080/parse \
  -H "Authorization: Bearer dev-secret-token" \
  -F "file=@test.pdf"
```

### Docker

```bash
# Build
docker build -t parse-pdf-fast .

# Run
docker run -p 8080:8080 \
  -e PARSE_SERVICE_TOKEN="your-secret-token" \
  parse-pdf-fast

# Test
curl -X POST http://localhost:8080/parse \
  -H "Authorization: Bearer your-secret-token" \
  -F "file=@test.pdf"
```

### Cloud Run (GCP)

```bash
# Build et push
gcloud builds submit --tag gcr.io/YOUR_PROJECT/parse-pdf-fast

# Deploy
gcloud run deploy parse-pdf-fast \
  --image gcr.io/YOUR_PROJECT/parse-pdf-fast \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars PARSE_SERVICE_TOKEN=your-secret-token \
  --max-instances 10 \
  --memory 512Mi \
  --cpu 1

# Récupérer URL
SERVICE_URL=$(gcloud run services describe parse-pdf-fast \
  --platform managed \
  --region us-central1 \
  --format 'value(status.url)')

echo "Service deployed at: $SERVICE_URL"
```

### Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Deploy
fly launch --name parse-pdf-fast --region iad
fly secrets set PARSE_SERVICE_TOKEN=your-secret-token
fly deploy

# Scale (optional)
fly scale count 2
fly scale vm shared-cpu-1x

# Get URL
fly info
```

## Configuration Supabase

Une fois déployé, configurer les secrets Supabase:

```bash
# Via CLI
supabase secrets set PARSE_SERVICE_URL="https://your-service.run.app"
supabase secrets set PARSE_SERVICE_TOKEN="your-secret-token"

# Ou via dashboard: Settings > Edge Functions > Secrets
```

## API Reference

### POST /parse

**Request:**
```bash
# Multipart
curl -X POST https://your-service/parse \
  -H "Authorization: Bearer TOKEN" \
  -F "file=@document.pdf"

# Raw binary
curl -X POST https://your-service/parse \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@document.pdf"
```

**Response:**
```json
{
  "pages": [
    {
      "page": 1,
      "text": "Extracted text from page 1..."
    },
    {
      "page": 2,
      "text": "Extracted text from page 2..."
    }
  ],
  "total_pages": 2,
  "parse_duration_ms": 423
}
```

## Performance

| Document | pdf-parse (Node) | PyMuPDF (Python) | Gain |
|----------|------------------|------------------|------|
| 10 pages | ~1000ms | ~200ms | 5× |
| 20 pages | ~2000ms | ~400ms | 5× |
| 50 pages | ~5000ms | ~1000ms | 5× |

## Coûts estimés

**Cloud Run (GCP):**
- Requêtes: $0.40/million
- CPU: $0.00002400/vCPU-second
- Mémoire: $0.00000250/GiB-second
- **Estimation:** ~$5/mois pour 10k docs/mois

**Fly.io:**
- shared-cpu-1x: $1.94/mo
- **Estimation:** $2-5/mois pour 10k docs/mois

## Troubleshooting

### Service ne démarre pas

```bash
# Vérifier logs
docker logs <container-id>

# Ou Cloud Run
gcloud run services logs read parse-pdf-fast --limit 50
```

### Auth errors (401/403)

```bash
# Vérifier token
echo $PARSE_SERVICE_TOKEN

# Test sans auth (dev uniquement)
unset PARSE_SERVICE_TOKEN
python main.py
```

### Parsing errors (500)

```bash
# Vérifier PDF valide
file document.pdf  # Should show "PDF document"

# Test avec PDF minimal
echo '%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R>>endobj
xref
0 4
trailer<</Size 4/Root 1 0 R>>
startxref
0
%%EOF' > test.pdf

curl -X POST http://localhost:8080/parse -F "file=@test.pdf"
```
