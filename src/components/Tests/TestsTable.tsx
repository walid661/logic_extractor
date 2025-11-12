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
import { Search } from "lucide-react";

interface TestCase {
  id: string;
  rule_id: string;
  notes: string;
  inputs: any;
  expected: any;
  created_at: string;
}

interface TestsTableProps {
  testCases: TestCase[];
}

export const TestsTable = ({ testCases }: TestsTableProps) => {
  const [search, setSearch] = useState("");
  const [ruleFilter, setRuleFilter] = useState<string>("all");

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

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher dans les tests..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
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
              <TableHead>Date de création</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
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
