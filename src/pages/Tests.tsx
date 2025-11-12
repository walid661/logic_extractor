import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Header } from "@/components/Dashboard/Header";
import { TestsTable } from "@/components/Tests/TestsTable";

interface TestCase {
  id: string;
  rule_id: string;
  notes: string;
  inputs: any;
  expected: any;
  created_at: string;
}

const Tests = () => {
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    loadTestCases();
  }, []);

  const loadTestCases = async () => {
    try {
      const { data, error } = await supabase
        .from("test_cases")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setTestCases(data || []);
    } catch (error) {
      toast({
        title: "Erreur de chargement",
        description: error instanceof Error ? error.message : "Échec du chargement des tests",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-6 py-8">
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Cas de test</h1>
            <p className="text-muted-foreground mt-2">
              Visualisez et filtrez tous les cas de test générés automatiquement
            </p>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Chargement des tests...</p>
            </div>
          ) : (
            <TestsTable testCases={testCases} />
          )}
        </div>
      </main>
    </div>
  );
};

export default Tests;
