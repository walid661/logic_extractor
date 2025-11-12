import { createClient } from "npm:@supabase/supabase-js@2";

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

// ============================================================================
// CONFIGURATION DES OPTIMISATIONS DE PERFORMANCE - PHASE 1
// ============================================================================
// Phase 1 : Optimisations sans risque (gain estimé 35-40%)
// Ajustez ces valeurs selon vos besoins et votre budget OpenAI
const CONFIG = {
  // Parallélisation (inchangé pour Phase 1)
  BATCH_SIZE: 3,                      // Nombre de chunks par batch
  MAX_CONCURRENT_BATCHES: 2,          // Nombre de batches traités en parallèle
  
  // Pauses entre groupes (réduit pour accélérer)
  PAUSE_BETWEEN_GROUPS_MS: 300,       // Réduit de 1000ms à 300ms
  
  // Progression temps réel (mise à jour tous les N batches)
  UPDATE_PROGRESS_EVERY_N_BATCHES: 3, // Mettre à jour tous les 3 batches
  
  // Délais retry (optimisés mais sûrs)
  RETRY_DELAY_BASE_MS: 500,           // Délai de base pour retry (au lieu de 1000ms)
  RETRY_DELAY_MAX_MS: 10000,          // Max pour rate limit (10s au lieu de 30s)
  RETRY_DELAY_SERVER_ERROR_MAX_MS: 5000, // Max pour erreurs serveur (5s au lieu de 30s)
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

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

    const formData = await req.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return new Response(
        JSON.stringify({ error: 'No file provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing file: ${file.name}, size: ${file.size}`);

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
      console.error('Error creating document:', docError);
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
      console.error('Error creating job:', jobError);
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
        
        // Extract text from PDF using pdf-parse
        const pdfParse = await import('npm:pdf-parse@1.1.1');
        const pdfData = await pdfParse.default(buffer);
        const text = pdfData.text;
        const numPages = pdfData.numpages;

        if (!text || text.trim().length === 0) {
          throw new Error('Empty or unreadable PDF content');
        }

        console.log(`Extracted ${text.length} characters from ${numPages} pages`);
        
        await supabaseClient
          .from('jobs')
          .update({ progress: 30 })
          .eq('id', job.id);

        // Extract rules using OpenAI (avec jobId pour progression)
        const rules = await extractRulesFromText(text, numPages, supabaseClient, job.id);
        
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
            console.error('Error inserting rules:', rulesError);
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

        // Generate summary for the document
        await generateSummaryForDocument(document.id, rules, supabaseClient);

        // Mark job as done
        await supabaseClient
          .from('jobs')
          .update({ status: 'done', progress: 100 })
          .eq('id', job.id);

        console.log(`Successfully processed ${rules.length} rules from ${file.name}`);
      } catch (error) {
        console.error('Background processing error:', error);
        
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
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Upload error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function generateSummaryForDocument(documentId: string, rules: any[], supabaseClient: any) {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    console.error('OPENAI_API_KEY not configured for summary generation');
    return;
  }

  if (rules.length === 0) {
    console.log('No rules to summarize');
    return;
  }

  const summaryPrompt = `
Tu es un assistant qui résume des règles métier extraites d'un document.
Voici la liste des règles extraites :

${rules.map((r, i) => `${i + 1}. ${r.text}`).join("\n")}

Résume en 3 phrases maximum la logique métier principale du document,
en restant factuel et synthétique, sans ajout d'information externe.
  `;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Tu résumes des documents métier.' },
          { role: 'user', content: summaryPrompt }
        ],
      }),
    });

    if (!response.ok) {
      console.error(`OpenAI API error for summary: ${response.status}`);
      return;
    }

    const data = await response.json();
    const summary = data?.choices?.[0]?.message?.content?.trim() ?? null;

    if (summary) {
      await supabaseClient
        .from('documents')
        .update({ summary })
        .eq('id', documentId);
      
      console.log(`Summary generated for document ${documentId}`);
    }
  } catch (error) {
    console.error('Error generating summary:', error);
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
        console.error(`OpenAI API error (batch ${batchId}, attempt ${attempt + 1}):`, response.status);
        
        // Rate limiting - délai optimisé mais sûr
        if (response.status === 429) {
          const waitTime = Math.min(
            Math.pow(2, attempt) * CONFIG.RETRY_DELAY_BASE_MS,
            CONFIG.RETRY_DELAY_MAX_MS
          );
          console.log(`Rate limited, waiting ${waitTime}ms before retry...`);
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
        console.error(`JSON parsing error (batch ${batchId}, attempt ${attempt + 1}):`, err);
        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, CONFIG.RETRY_DELAY_BASE_MS));
          continue; // Retry en cas d'erreur de parsing
        }
        return [];
      }

      if (!parsed.rules || !Array.isArray(parsed.rules)) {
        console.warn(`Invalid response format (batch ${batchId}):`, parsed);
        return [];
      }

      return parsed.rules as RuleExtracted[];
    } catch (error) {
      console.error(`Error processing batch ${batchId} (attempt ${attempt + 1}):`, error);
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
  jobId?: string
): Promise<RuleExtracted[]> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    console.error('OPENAI_API_KEY not configured');
    return [];
  }
  
  // Monitoring de performance
  const startTime = Date.now();
  console.log(`[PERF] Starting extraction for ${totalPages} pages`);
  
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

  // Découpage amélioré : par paragraphes et sections
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 50);
  
  // Grouper les paragraphes en chunks intelligents (max 3000 caractères)
  const chunks: Array<{ text: string; startIndex: number }> = [];
  let currentChunk = '';
  let startIndex = 0;
  
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i].trim();
    if (currentChunk.length + para.length > 3000 && currentChunk.length > 0) {
      chunks.push({ text: currentChunk, startIndex });
      currentChunk = para;
      startIndex = i;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }
  if (currentChunk.length > 0) {
    chunks.push({ text: currentChunk, startIndex });
  }

  console.log(`[PERF] Created ${chunks.length} chunks from ${paragraphs.length} paragraphs`);

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
  console.log(`[PERF] Processing ${totalBatches} batches with ${maxConcurrentBatches} concurrent batches`);

  // Traiter les batches par groupes parallèles avec pause réduite
  for (let i = 0; i < batches.length; i += maxConcurrentBatches) {
    const batchGroup = batches.slice(i, i + maxConcurrentBatches);
    
    const batchPromises = batchGroup.map(async (batch) => {
      const userContent = batch.chunks.map((c, idx) => 
        `## Chunk ${batch.index + idx + 1}/${chunks.length}\n${c.text}`
      ).join('\n\n---\n\n');

      try {
        const rules = await callOpenAIWithRetry(
          apiKey,
          SYSTEM_PROMPT,
          userContent,
          `batch-${batch.index}`
        );
        
        processedBatches++;
        
        // Mise à jour de progression (tous les N batches)
        if (supabaseClient && jobId && processedBatches % CONFIG.UPDATE_PROGRESS_EVERY_N_BATCHES === 0) {
          const progress = 30 + Math.floor((processedBatches / totalBatches) * 40); // 30% -> 70%
          await supabaseClient
            .from('jobs')
            .update({ progress })
            .eq('id', jobId);
        }
        
        return rules;
      } catch (error) {
        console.error(`Error in batch ${batch.index}:`, error);
        processedBatches++;
        return [];
      }
    });

    const results = await Promise.all(batchPromises);
    allRules.push(...results.flat());
    
    // Pause réduite entre groupes (utilise CONFIG)
    if (i + maxConcurrentBatches < batches.length) {
      await new Promise(r => setTimeout(r, CONFIG.PAUSE_BETWEEN_GROUPS_MS));
    }
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

  // Dédoublonnage optimisé avec Set et hash (Phase 1)
  const uniqueRules: RuleExtracted[] = [];
  const seenTextHashes = new Set<string>();
  
  for (const rule of validatedRules) {
    // Créer un hash simple du texte pour comparaison rapide
    // Prendre les 10 premiers mots significatifs (>3 caractères)
    const textHash = rule.text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 10)
      .join(' ');
    
    // Vérifier si on a déjà vu un texte similaire
    let isDuplicate = false;
    for (const seenHash of seenTextHashes) {
      const similarity = calculateSimilarity(seenHash, textHash);
      if (similarity > 0.85) {
        isDuplicate = true;
        break;
      }
    }
    
    if (!isDuplicate) {
      seenTextHashes.add(textHash);
      uniqueRules.push(rule);
    }
  }

  const duration = Date.now() - startTime;
  console.log(`[PERF] Extraction completed in ${duration}ms: ${uniqueRules.length} unique rules from ${allRules.length} total rules`);
  console.log(`[PERF] Average: ${totalBatches > 0 ? (duration / totalBatches).toFixed(0) : 0}ms per batch`);
  
  return uniqueRules;
}
