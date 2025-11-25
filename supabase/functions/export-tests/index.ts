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
        const format = url.searchParams.get('format') || 'playwright';

        if (!documentId) {
            return new Response(
                JSON.stringify({ error: 'documentId is required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            {
                global: {
                    headers: { Authorization: req.headers.get('Authorization')! },
                },
            }
        );

        // Fetch test cases with rule details
        const { data: testCases, error } = await supabase
            .from('test_cases')
            .select(`
        *,
        rules (
          text,
          domain
        )
      `)
            .eq('rules.document_id', documentId);

        if (error) throw error;

        if (!testCases || testCases.length === 0) {
            return new Response(
                JSON.stringify({ error: 'No tests found for this document' }),
                { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        let content = '';
        let filename = '';
        let contentType = '';

        if (format === 'playwright') {
            filename = `tests-${documentId}.spec.ts`;
            contentType = 'application/typescript';

            content = `import { test, expect } from '@playwright/test';\n\n`;

            // Group by rule
            const testsByRule = testCases.reduce((acc: any, tc: any) => {
                const ruleId = tc.rule_id;
                if (!acc[ruleId]) {
                    acc[ruleId] = {
                        rule: tc.rules,
                        tests: []
                    };
                }
                acc[ruleId].tests.push(tc);
                return acc;
            }, {});

            Object.values(testsByRule).forEach(({ rule, tests }: any) => {
                content += `// Rule: ${rule.text}\n`;
                content += `test.describe('${rule.domain || 'General'} - Rule ${rule.text.slice(0, 50)}...', () => {\n`;

                tests.forEach((tc: any, index: number) => {
                    content += `  test('${tc.notes || `Scenario ${index + 1}`}', async ({ page }) => {\n`;
                    content += `    // Inputs: ${JSON.stringify(tc.inputs)}\n`;
                    content += `    // Expected: ${JSON.stringify(tc.expected)}\n`;
                    content += `    // TODO: Implement test logic here\n`;
                    content += `  });\n\n`;
                });

                content += `});\n\n`;
            });

        } else if (format === 'gherkin') {
            filename = `tests-${documentId}.feature`;
            contentType = 'text/plain';

            content = `Feature: Generated Tests for Document ${documentId}\n\n`;

            testCases.forEach((tc: any) => {
                content += `  Scenario: ${tc.notes || 'Unnamed Scenario'}\n`;
                content += `    # Rule: ${tc.rules?.text}\n`;
                content += `    Given the following inputs:\n`;
                content += `      """\n      ${JSON.stringify(tc.inputs, null, 2)}\n      """\n`;
                content += `    Then the result should be:\n`;
                content += `      """\n      ${JSON.stringify(tc.expected, null, 2)}\n      """\n\n`;
            });
        } else {
            return new Response(
                JSON.stringify({ error: 'Invalid format. Use "playwright" or "gherkin"' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        return new Response(content, {
            headers: {
                ...corsHeaders,
                'Content-Type': contentType,
                'Content-Disposition': `attachment; filename="${filename}"`,
            },
        });

    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
