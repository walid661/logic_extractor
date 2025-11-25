# 🚀 Guide de Déploiement Supabase - Logic Extractor MVP

## ✅ Ce qui est fait

- ✅ Code MVP prêt sur branche `claude/mvp-no-semantic-cache-011CV5azfg3uuQVz3XEvqFHV`
- ✅ Fichier `index.ts` renommé correctement
- ✅ Variables d'environnement configurées

## 📋 ÉTAPES À SUIVRE (par toi)

### **ÉTAPE 1 : Appliquer la migration SQL** (5 min)

1. Va sur https://supabase.com/dashboard/project/pjkgjmkbrjpagksaznpk/sql
2. Clique **New query**
3. Copie-colle ce SQL :

```sql
-- Add file_hash column to documents table
ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS file_hash TEXT;

-- Create index on (user_id, file_hash) for efficient exact reuse lookup
CREATE INDEX IF NOT EXISTS idx_documents_user_filehash
ON public.documents(user_id, file_hash);

-- Add comment explaining the purpose
COMMENT ON COLUMN public.documents.file_hash IS
'SHA-256 hash of PDF file content for exact reuse detection';
```

4. Clique **RUN** → Tu devrais voir "Success"

---

### **ÉTAPE 2 : Configurer les secrets Edge Functions** (2 min)

1. Va sur https://supabase.com/dashboard/project/pjkgjmkbrjpagksaznpk/settings/functions
2. Scroll jusqu'à **Secrets**
3. Ajoute ces secrets (clique **Add secret** pour chacun) :

| Name | Value |
|------|-------|
| `OPENAI_API_KEY` | `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` |
| `SEMANTIC_CACHE_ENABLED` | `false` |
| `EXACT_REUSE_ENABLED` | `true` |

**Note** : `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` sont déjà disponibles automatiquement.

---

### **ÉTAPE 3 : Déployer les Edge Functions via GitHub** (Option Recommandée)

#### **Option A : Via Supabase CLI (si tu l'as installé)**

```bash
# Installer Supabase CLI (si pas déjà fait)
# macOS
brew install supabase/tap/supabase

# Windows
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# Linux
brew install supabase/tap/supabase
```

Puis :

```bash
cd /path/to/logic_extractor

# Login
supabase login

# Link project
supabase link --project-ref pjkgjmkbrjpagksaznpk

# Deploy functions
supabase functions deploy upload-documents
supabase functions deploy generate-summary
```

---

#### **Option B : Via Dashboard (si pas de CLI)**

**upload-documents :**

1. Va sur https://supabase.com/dashboard/project/pjkgjmkbrjpagksaznpk/functions
2. Clique **Create a new function**
3. Name: `upload-documents`
4. Copie TOUT le contenu de `supabase/functions/upload-documents/index.ts` (29590 caractères)
5. **IMPORTANT** : Ajoute aussi les imports depuis :
   - `supabase/functions/_shared/logger.ts`
   - `supabase/functions/_shared/rate-limit.ts`
   - `supabase/functions/upload-documents/config.ts`
   - `supabase/functions/upload-documents/extraction/cache.ts`
6. Clique **Deploy function**

**generate-summary :**

1. Même procédure pour `supabase/functions/generate-summary/index.ts`

**⚠️ Problème** : Cette option est fastidieuse car tu dois copier/coller manuellement tous les fichiers et leurs dépendances.

---

#### **Option C : GitHub Integration (RECOMMANDÉ)** ⭐

1. Push ton code sur GitHub :
   ```bash
   git push origin claude/mvp-no-semantic-cache-011CV5azfg3uuQVz3XEvqFHV
   ```

2. Va sur https://supabase.com/dashboard/project/pjkgjmkbrjpagksaznpk/settings/integrations

3. Active **GitHub Integration**

4. Configure auto-deploy depuis ta branche

5. Supabase déploiera automatiquement les Edge Functions à chaque push

---

### **ÉTAPE 4 : Vérifier le déploiement** (2 min)

1. Va sur https://supabase.com/dashboard/project/pjkgjmkbrjpagksaznpk/functions

2. Tu devrais voir :
   - ✅ `upload-documents` (deployed)
   - ✅ `generate-summary` (deployed)

3. Teste avec curl :

```bash
curl -X POST https://pjkgjmkbrjpagksaznpk.supabase.co/functions/v1/upload-documents \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqa2dqbWticmpwYWdrc2F6bnBrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxMTkwODksImV4cCI6MjA3ODY5NTA4OX0._b3gCfOBHizlXoIxv1wNvAgajv5JmgeJYkVL2V_Z740" \
  -F "file=@test.pdf"
```

Tu devrais recevoir `{"documentId":"...", "jobId":"..."}`

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
