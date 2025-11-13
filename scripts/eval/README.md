# Evaluation Harness

Outils d'évaluation pour mesurer les performances du Logic Extractor.

## Utilisation

### 1. Prérequis

```bash
# Variables d'environnement nécessaires
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_ANON_KEY="your-anon-key"
```

### 2. Préparer les fixtures

Placer des fichiers PDF de test dans `scripts/eval/fixtures/` :

```bash
cp /path/to/test-document.pdf scripts/eval/fixtures/
```

### 3. Lancer l'évaluation

```bash
deno run --allow-net --allow-read --allow-env scripts/eval/measure-latency.ts
```

## Métriques mesurées

### Actuellement implémenté :
- ⏱️ **Latence E2E** (p50, p95)
- 📝 **Nombre de règles extraites**
- 🎯 **Confiance moyenne**
- ✅ **Taux de succès**

### À implémenter (avec gold dataset) :
- **Precision** : règles correctes / règles extraites
- **Recall** : règles correctes / règles attendues
- **F1 Score** : moyenne harmonique de P et R
- **Cost** : Estimation coût OpenAI par document

## Créer un gold dataset

1. Annoter des documents de référence :
   ```bash
   # Créer un fichier JSON pour chaque document
   cat > fixtures/doc1.gold.json << EOF
   {
     "documentId": "doc1",
     "rules": [
       {
         "text": "Les remboursements doivent être effectués sous 30 jours",
         "domain": "Finance",
         "confidence": 0.95
       }
     ]
   }
   EOF
   ```

2. Modifier `measure-latency.ts` pour calculer P/R/F1

## Exemple de sortie

```
🚀 Logic Extractor - Latency Evaluation Harness

============================================================

📦 Found 3 fixture(s) to process

📄 Processing: contract-sample.pdf
  ⏳ Job ID: 123e4567-e89b-12d3-a456-426614174000
  📊 Progress: 30% (running)
  📊 Progress: 70% (running)
  📊 Progress: 100% (done)
  ✅ Completed in 12.3s
  📝 Rules extracted: 45
  🎯 Avg confidence: 82.5%

============================================================
📊 EVALUATION SUMMARY

✅ Successful: 3/3
⏱️  Avg latency: 11.2s
📝 Total rules: 128
🎯 Avg confidence: 79.3%

📈 Latency distribution:
   p50: 11.2s
   p95: 14.5s
============================================================

💡 Next steps:
   1. Annotate fixtures with ground truth rules
   2. Add P/R/F1 calculation
   3. Track cost per document
```
