import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const format = url.searchParams.get('format') || 'json';
    const documentId = url.searchParams.get('documentId');

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    let query = supabaseClient.from('rules').select('*');
    if (documentId) {
      query = query.eq('document_id', documentId);
    }

    const { data: rules, error } = await query;

    if (error) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch rules' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (format === 'xlsx') {
      const rows = rules?.map(r => ({
        text: r.text,
        domain: r.domain || '',
        tags: Array.isArray(r.tags) ? r.tags.join(',') : '',
        conditions: JSON.stringify(r.conditions || []),
        confidence: r.confidence || 0,
        page: r.source_page || 0,
        section: r.source_sect || ''
      })) || [];

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'rules');
      
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      return new Response(buffer, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="rules.xlsx"'
        }
      });
    }

    return new Response(
      JSON.stringify(rules || []),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Export error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
