# 🚀 Guide de Déploiement Supabase - Logic Extractor MVP

## ✅ Ce qui est fait

- ✅ Code MVP prêt sur branche `claude/mvp-no-semantic-cache-011CV5azfg3uuQVz3XEvqFHV`
- ✅ Fichier `index.ts` renommé correctement
- ✅ Variables d'environnement configurées

## 📋 ÉTAPES À SUIVRE (par toi)

### **ÉTAPE 1 : Appliquer les migrations SQL** (5 min)

1. Va sur https://supabase.com/dashboard/project/pjkgjmkbrjpagksaznpk/sql
2. Clique **New query**
3. Copie-colle ce SQL (cumulé des Phases 3 & 4) :

```sql
-- 1. (Phase 4) Add file_hash column to documents table for exact reuse
ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS file_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_user_filehash
ON public.documents(user_id, file_hash);

COMMENT ON COLUMN public.documents.file_hash IS
'SHA-256 hash of PDF file content for exact reuse detection';

-- 2. (Phase 3) Add feedback column to test_cases table
ALTER TABLE test_cases 
ADD COLUMN IF NOT EXISTS feedback text DEFAULT 'none' CHECK (feedback IN ('up','down','none'));
```

4. Clique **RUN** → Tu devrais voir "Success"

---

### **ÉTAPE 2 : Configurer les secrets Edge Functions** (2 min)

1. Va sur https://supabase.com/dashboard/project/pjkgjmkbrjpagksaznpk/settings/functions
2. Scroll jusqu'à **Secrets**
3. Vérifie/Ajoute ces secrets :

| Name | Value |
|------|-------|
| `OPENAI_API_KEY` | `sk-proj-...` (Ta clé OpenAI) |
| `SEMANTIC_CACHE_ENABLED` | `true` (Activé en Phase 1) |
| `EXACT_REUSE_ENABLED` | `true` (Activé en Phase 4) |

---

### **ÉTAPE 3 : Déployer les Edge Functions** (5 min)

Tu dois déployer les fonctions modifiées et la nouvelle fonction d'export.

```bash
# Login (si nécessaire)
supabase login

# Deploy all updated functions
supabase functions deploy upload-documents
supabase functions deploy generate-tests
supabase functions deploy export-tests
supabase functions deploy generate-summary
```

---

### **ÉTAPE 4 : Mettre à jour le Service Python** (Phase 4)

Le service de parsing PDF a été mis à jour avec `pdfplumber`. Il doit être reconstruit.

**Si tu utilises Docker localement :**
```bash
cd services/parse-pdf-fast
docker build -t parse-pdf-fast .
docker run -p 8080:8080 -e PARSE_SERVICE_TOKEN="ton-token" parse-pdf-fast
```

**Si tu utilises Cloud Run / Fly.io :**
Relance la commande de déploiement (voir README du service) pour reconstruire l'image avec les nouvelles dépendances.

---

### **ÉTAPE 5 : Vérifier le déploiement** (2 min)

1. **Test Upload:** Upload un fichier. Vérifie qu'il passe (Status 202 puis Done).
2. **Test Feedback:** Va sur un document, génère des tests, et clique sur le pouce haut/bas.
3. **Test Export:** Clique sur "Exporter les tests".

---

## 🎯 Résumé Rapide

Si tu veux aller **VITE** :

1. ✅ Migration SQL → 2 min
2. ✅ Secrets Edge Functions → 2 min
3. ✅ Déploiement via CLI → 5 min

**Total : 9 minutes**

---

## 🆘 Besoin d'Aide ?

**Si bloqué** → Dis-moi où tu en es et je t'aide !

**Si CLI Supabase ne marche pas** → Je peux créer un script de déploiement alternatif via API
