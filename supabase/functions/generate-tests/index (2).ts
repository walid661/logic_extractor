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
    const body = await req.json().catch(() => ({}));
    const { ruleIds } = body;

    // If no ruleIds provided, fetch all rules (limited to 50)
    const fetchAllRules = !ruleIds || !Array.isArray(ruleIds) || ruleIds.length === 0;

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch rules
    let query = supabaseClient
      .from('rules')
      .select('id, text, conditions, domain');
    
    if (!fetchAllRules) {
      query = query.in('id', ruleIds);
    } else {
      query = query.limit(50); // Limit to 50 rules when fetching all
    }

    const { data: rules, error: rulesError } = await query;

    if (rulesError || !rules) {
      console.error('Failed to fetch rules:', rulesError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch rules' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (rules.length === 0) {
      return new Response(
        JSON.stringify({ generated: 0, message: 'No rules found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Generating tests for ${rules.length} rules`);

    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'OPENAI_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const allTests = [];

    for (const rule of rules) {
      const prompt = `Génère 2 cas de test pour cette règle métier:
Règle: ${rule.text}
Conditions: ${JSON.stringify(rule.conditions)}
Domaine: ${rule.domain}

Retourne un JSON strict:
{
  "tests": [
    {
      "description": "...",
      "inputs": { "key": "value" },
      "expected": "résultat attendu"
    }
  ]
}`;

      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: 'Tu génères des cas de test pour des règles métier.' },
              { role: 'user', content: prompt }
            ]
          })
        });

        if (!response.ok) {
          console.error(`OpenAI error for rule ${rule.id}: ${response.status}`);
          continue;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (content) {
          const parsed = JSON.parse(content);
          if (parsed.tests && Array.isArray(parsed.tests)) {
            for (const test of parsed.tests) {
              allTests.push({
                rule_id: rule.id,
                notes: test.description,
                inputs: test.inputs,
                expected: test.expected
              });
            }
          }
        }
      } catch (error) {
        console.error(`Error generating tests for rule ${rule.id}:`, error);
      }
    }

    // Insert test cases
    if (allTests.length > 0) {
      const { error: insertError } = await supabaseClient
        .from('test_cases')
        .insert(allTests);

      if (insertError) {
        console.error('Error inserting test cases:', insertError);
        return new Response(
          JSON.stringify({ error: 'Failed to insert test cases' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    return new Response(
      JSON.stringify({ generated: allTests.length, tests: allTests }),
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
