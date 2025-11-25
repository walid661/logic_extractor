import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, ThumbsUp, ThumbsDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface TestCase {
  id: string;
  rule_id: string;
  notes: string;
  inputs: any;
  expected: any;
  created_at: string;
  feedback?: "up" | "down" | "none";
}

interface TestsTableProps {
  testCases: TestCase[];
  documentId: string;
  onExport?: (format: "playwright" | "gherkin") => void;
}

export const TestsTable = ({ testCases: initialTestCases, documentId, onExport }: TestsTableProps) => {
  const [testCases, setTestCases] = useState<TestCase[]>(initialTestCases);
  const [search, setSearch] = useState("");
  const [ruleFilter, setRuleFilter] = useState<string>("all");
  const [exportFormat, setExportFormat] = useState<"playwright" | "gherkin">("playwright");
  const { toast } = useToast();

  // Extract unique rule IDs
  const uniqueRuleIds = Array.from(new Set(testCases.map(tc => tc.rule_id)));

  // Filter test cases
  const filteredTests = testCases.filter((test) => {
    const matchesSearch =
      test.notes?.toLowerCase().includes(search.toLowerCase()) ||
      JSON.stringify(test.inputs).toLowerCase().includes(search.toLowerCase()) ||
      JSON.stringify(test.expected).toLowerCase().includes(search.toLowerCase());

    const matchesRule = ruleFilter === "all" || test.rule_id === ruleFilter;

    return matchesSearch && matchesRule;
  });

  const formatJson = (data: any) => {
    if (!data) return "N/A";
    if (typeof data === "string") return data;
    return JSON.stringify(data, null, 2);
  };

  const handleExport = () => {
    if (onExport) {
      onExport(exportFormat);
    }
  };

  const handleFeedback = async (testId: string, value: "up" | "down") => {
    const { error } = await supabase
      .from("test_cases")
      .update({ feedback: value })
      .eq("id", testId);

    if (error) {
      toast({
        title: "Erreur",
        description: error.message,
        variant: "destructive",
      });
    } else {
      // Optimistic UI update
      setTestCases((prev) =>
        prev.map((t) => (t.id === testId ? { ...t, feedback: value } : t))
      );
      toast({ title: "Feedback enregistré" });
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters + Export */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher dans les tests..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Rule filter */}
        <Select value={ruleFilter} onValueChange={setRuleFilter}>
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue placeholder="Filtrer par règle" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les règles</SelectItem>
            {uniqueRuleIds.map((ruleId) => (
              <SelectItem key={ruleId} value={ruleId}>
                Règle {ruleId.slice(0, 8)}...
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Export format selector */}
        <Select
          value={exportFormat}
          onValueChange={(v) => setExportFormat(v as any)}
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Format d'export" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="playwright">Playwright (TS)</SelectItem>
            <SelectItem value="gherkin">Gherkin (Feature)</SelectItem>
          </SelectContent>
        </Select>

        {/* Export button */}
        <Button onClick={handleExport} variant="outline">
          Exporter les tests
        </Button>
      </div>

      {/* Table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Notes</TableHead>
              <TableHead>Règle ID</TableHead>
              <TableHead>Entrées</TableHead>
              <TableHead>Résultat attendu</TableHead>
              <TableHead>Feedback</TableHead>
              <TableHead>Date de création</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  Aucun cas de test trouvé
                </TableCell>
              </TableRow>
            ) : (
              filteredTests.map((test) => (
                <TableRow key={test.id}>
                  <TableCell className="font-medium max-w-xs">
                    {test.notes || "Sans description"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-xs">
                      {test.rule_id.slice(0, 8)}...
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-24">
                      {formatJson(test.inputs)}
                    </pre>
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-24">
                      {formatJson(test.expected)}
                    </pre>
                  </TableCell>
                  <TableCell className="flex items-center gap-2">
                    <Button
                      variant={test.feedback === "up" ? "default" : "ghost"}
                      size="icon"
                      onClick={() => handleFeedback(test.id, "up")}
                      className={test.feedback === "up" ? "bg-green-600 hover:bg-green-700" : ""}
                    >
                      <ThumbsUp className={`h-4 w-4 ${test.feedback === "up" ? "text-white" : "text-green-600"}`} />
                    </Button>
                    <Button
                      variant={test.feedback === "down" ? "default" : "ghost"}
                      size="icon"
                      onClick={() => handleFeedback(test.id, "down")}
                      className={test.feedback === "down" ? "bg-red-600 hover:bg-red-700" : ""}
                    >
                      <ThumbsDown className={`h-4 w-4 ${test.feedback === "down" ? "text-white" : "text-red-600"}`} />
                    </Button>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(test.created_at).toLocaleDateString('fr-FR', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Summary */}
      <p className="text-sm text-muted-foreground text-center">
        Affichage de {filteredTests.length} test(s) sur {testCases.length} au total
      </p>
    </div>
  );
};
