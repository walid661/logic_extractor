import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader }
        }
      }
    );

    // Get authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { documentId } = await req.json();

    if (!documentId) {
      return new Response(
        JSON.stringify({ error: 'Missing documentId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Deleting document:', documentId);

    // Delete all test cases related to rules from this document
    const { data: rules } = await supabase
      .from('rules')
      .select('id')
      .eq('document_id', documentId);

    if (rules && rules.length > 0) {
      const ruleIds = rules.map(r => r.id);
      await supabase.from('test_cases').delete().in('rule_id', ruleIds);
      console.log('Deleted test cases for rules:', ruleIds);
    }

    // Delete all rules from this document
    await supabase.from('rules').delete().eq('document_id', documentId);
    console.log('Deleted rules for document:', documentId);

    // Delete all jobs related to this document
    await supabase.from('jobs').delete().eq('document_id', documentId);
    console.log('Deleted jobs for document:', documentId);

    // Delete the document itself
    const { error } = await supabase.from('documents').delete().eq('id', documentId);
    
    if (error) throw error;

    console.log('Document deleted successfully:', documentId);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error deleting document:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
