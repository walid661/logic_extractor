import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Rule } from "@/types/rule";
import { Header } from "@/components/Dashboard/Header";
import { StatsCards } from "@/components/Dashboard/StatsCards";
import { RulesTable } from "@/components/Dashboard/RulesTable";
import { RuleDetailsDialog } from "@/components/Dashboard/RuleDetailsDialog";
import { UploadDialog } from "@/components/Dashboard/UploadDialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

const DocumentDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [rules, setRules] = useState<Rule[]>([]);
  const [documentName, setDocumentName] = useState("");
  const [documentSummary, setDocumentSummary] = useState<string | null>(null);
  const [selectedRule, setSelectedRule] = useState<Rule | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [isGeneratingTests, setIsGeneratingTests] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (id) {
      fetchDocument();
      fetchRules();
    }
  }, [id]);

  const fetchDocument = async () => {
    const { data, error } = await supabase
      .from("documents")
      .select("name, summary")
      .eq("id", id)
      .maybeSingle() as { data: { name: string; summary: string | null } | null; error: any };

    if (error) {
      console.error("Error fetching document:", error);
      navigate("/");
      return;
    }

    if (!data) {
      navigate("/");
      return;
    }

    setDocumentName(data.name || "");
    setDocumentSummary(data.summary || null);
  };

  const fetchRules = async () => {
    const { data, error } = await supabase
      .from("rules")
      .select("*")
      .eq("document_id", id);

    if (error) {
      console.error("Error fetching rules:", error);
      return;
    }

    if (data) {
      setRules(data.map((r: any) => ({
        ...r,
        conditions: r.conditions || [],
        source: { page: r.source_page || 0, section: r.source_sect || "" },
      })));
    }
  };

  const handleRuleClick = (rule: Rule) => {
    setSelectedRule(rule);
    setDetailsOpen(true);
  };

  const handleExport = async () => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-rules?format=xlsx&documentId=${id}`,
        {
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        }
      );

      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rules-${documentName}.xlsx`;
      a.click();

      toast({
        title: "Export réussi",
        description: "Le fichier Excel a été téléchargé.",
      });
    } catch (error) {
      toast({
        title: "Erreur d'export",
        description: error instanceof Error ? error.message : "Échec de l'export",
        variant: "destructive",
      });
    }
  };

  const handleGenerateTests = async () => {
    setIsGeneratingTests(true);
    try {
      const ruleIds = rules.map(r => r.id);
      const { data, error } = await supabase.functions.invoke("generate-tests", {
        body: { ruleIds }
      });

      if (error) throw error;

      toast({
        title: "Tests générés",
        description: `${data.generated || 0} cas de test ont été créés avec succès.`,
      });
    } catch (error) {
      toast({
        title: "Erreur de génération",
        description: error instanceof Error ? error.message : "Échec de la génération des tests",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingTests(false);
    }
  };

          </div >

  <StatsCards totalRules={rules.length} totalDocuments={1} rules={rules} />

{
  documentSummary && (
    <div className="bg-white rounded-lg p-8 border border-border shadow-sm">
      <h3 className="text-2xl font-bold text-black mb-4">
        Aperçu global du document
      </h3>
      <p className="text-lg text-black leading-relaxed">
        {documentSummary}
      </p>
    </div>
  )
}

<div>
  <div className="mb-4">
    <h2 className="text-2xl font-semibold text-foreground">Règles extraites</h2>
    <p className="text-sm text-muted-foreground">
      Gérez et explorez les règles métier extraites
    </p>
    import {useState, useEffect} from "react";
    import {useParams, useNavigate} from "react-router-dom";
    import {Rule} from "@/types/rule";
    import {Header} from "@/components/Dashboard/Header";
    import {StatsCards} from "@/components/Dashboard/StatsCards";
    import {RulesTable} from "@/components/Dashboard/RulesTable";
    import {RuleDetailsDialog} from "@/components/Dashboard/RuleDetailsDialog";
    import {UploadDialog} from "@/components/Dashboard/UploadDialog";
    import {useToast} from "@/hooks/use-toast";
    import {supabase} from "@/integrations/supabase/client";
    import {Button} from "@/components/ui/button";
    import {ArrowLeft} from "lucide-react";

const DocumentDetails = () => {
  const {id} = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [rules, setRules] = useState<Rule[]>([]);
    const [documentName, setDocumentName] = useState("");
    const [documentSummary, setDocumentSummary] = useState<string | null>(null);
    const [selectedRule, setSelectedRule] = useState<Rule | null>(null);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [uploadOpen, setUploadOpen] = useState(false);
    const [isGeneratingTests, setIsGeneratingTests] = useState(false);
    const {toast} = useToast();

  useEffect(() => {
    if (id) {
      fetchDocument();
    fetchRules();
    }
  }, [id]);

  const fetchDocument = async () => {
    const {data, error} = await supabase
    .from("documents")
    .select("name, summary")
    .eq("id", id)
    .maybeSingle() as {data: {name: string; summary: string | null } | null; error: any };

    if (error) {
      console.error("Error fetching document:", error);
    navigate("/");
    return;
    }

    if (!data) {
      navigate("/");
    return;
    }

    setDocumentName(data.name || "");
    setDocumentSummary(data.summary || null);
  };

  const fetchRules = async () => {
    const {data, error} = await supabase
    .from("rules")
    .select("*")
    .eq("document_id", id);

    if (error) {
      console.error("Error fetching rules:", error);
    return;
    }

    if (data) {
      setRules(data.map((r: any) => ({
        ...r,
        conditions: r.conditions || [],
        source: { page: r.source_page || 0, section: r.source_sect || "" },
      })));
    }
  };

  const handleRuleClick = (rule: Rule) => {
      setSelectedRule(rule);
    setDetailsOpen(true);
  };

  const handleExport = async () => {
    try {
      const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-rules?format=xlsx&documentId=${id}`,
    {
      headers: {
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        }
    );

    if (!response.ok) throw new Error("Export failed");

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rules-${documentName}.xlsx`;
    a.click();

    toast({
      title: "Export réussi",
    description: "Le fichier Excel a été téléchargé.",
      });
    } catch (error) {
      toast({
        title: "Erreur d'export",
        description: error instanceof Error ? error.message : "Échec de l'export",
        variant: "destructive",
      });
    }
  };

  const handleGenerateTests = async () => {
      setIsGeneratingTests(true);
    try {
      const ruleIds = rules.map(r => r.id);
    const {data, error} = await supabase.functions.invoke("generate-tests", {
      body: {ruleIds}
      });

    if (error) throw error;

    toast({
      title: "Tests générés",
    description: `${data.generated || 0} cas de test ont été créés avec succès.`,
      });
    } catch (error) {
      toast({
        title: "Erreur de génération",
        description: error instanceof Error ? error.message : "Échec de la génération des tests",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingTests(false);
    }
  };

  </div>

  <StatsCards totalRules={rules.length} totalDocuments={1} rules={rules} />

  {documentSummary && (
    <div className="bg-white rounded-lg p-8 border border-border shadow-sm">
      <h3 className="text-2xl font-bold text-black mb-4">
        Aperçu global du document
      </h3>
      <p className="text-lg text-black leading-relaxed">
        {documentSummary}
      </p>
    </div>
  )}

  <div>
    <div className="mb-4">
      <h2 className="text-2xl font-semibold text-foreground">Règles extraites</h2>
      <p className="text-sm text-muted-foreground">
        Gérez et explorez les règles métier extraites
      </p>
    </div>
    <RulesTable rules={rules} onRuleClick={handleRuleClick} />
  </div>
</div>
      </main >

        <RuleDetailsDialog
          rule={selectedRule}
          open={!!selectedRule}
          onOpenChange={(open) => !open && setSelectedRule(null)}
          onRuleUpdated={fetchRules}
        />
      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </div >
  );
};

export default DocumentDetails;
