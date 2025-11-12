import { createClient } from "npm:@supabase/supabase-js@2";

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
    const documentId = url.searchParams.get('documentId');
    const q = url.searchParams.get('q') || '';
    const domain = url.searchParams.get('domain');
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = Math.min(parseInt(url.searchParams.get('pageSize') || '50'), 100);

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    let query = supabaseClient.from('rules').select('*', { count: 'exact' });

    if (documentId) {
      query = query.eq('document_id', documentId);
    }

    if (domain && domain !== 'all') {
      query = query.eq('domain', domain);
    }

    if (q) {
      query = query.or(`text.ilike.%${q}%,tags.cs.{${q}}`);
    }

    const { data: items, error, count } = await query
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (error) {
      console.error('Query error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch rules' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ 
        items: items || [], 
        total: count || 0, 
        page, 
        pageSize 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
