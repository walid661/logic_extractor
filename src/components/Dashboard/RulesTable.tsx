import { useState } from "react";
import { Rule } from "@/types/rule";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Search, Eye } from "lucide-react";

interface RulesTableProps {
  rules: Rule[];
  onRuleClick: (rule: Rule) => void;
}

export const RulesTable = ({ rules, onRuleClick }: RulesTableProps) => {
  const [search, setSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState<string>("all");

  const domains = Array.from(new Set(rules.map((r) => r.domain)));

  const filteredRules = rules.filter((rule) => {
    const matchesSearch =
      search === "" ||
      rule.text.toLowerCase().includes(search.toLowerCase()) ||
      rule.tags.some((tag) => tag.toLowerCase().includes(search.toLowerCase()));
    const matchesDomain = domainFilter === "all" || rule.domain === domainFilter;
    return matchesSearch && matchesDomain;
  });

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 0.9) return <Badge className="bg-success text-success-foreground">Haute</Badge>;
    if (confidence >= 0.8) return <Badge className="bg-warning text-warning-foreground">Moyenne</Badge>;
    return <Badge variant="destructive">Faible</Badge>;
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher dans les règles, tags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={domainFilter} onValueChange={setDomainFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Tous les domaines" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les domaines</SelectItem>
            {domains.map((domain) => (
              <SelectItem key={domain} value={domain}>
                {domain}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40%]">Règle</TableHead>
              <TableHead>Domaine</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Confiance</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRules.map((rule) => (
              <TableRow key={rule.id} className="group">
                <TableCell className="font-medium">
                  <p className="line-clamp-2 text-base">{rule.text}</p>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-sm">{rule.domain}</Badge>
                </TableCell>
                <TableCell className="text-base text-muted-foreground">
                  {rule.documentName}
                  <br />
                  <span className="text-sm">
                    Page {rule.source.page} · {rule.source.section}
                  </span>
                </TableCell>
                <TableCell>{getConfidenceBadge(rule.confidence)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {rule.tags.slice(0, 2).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-sm">
                        {tag}
                      </Badge>
                    ))}
                    {rule.tags.length > 2 && (
                      <Badge variant="secondary" className="text-sm">
                        +{rule.tags.length - 2}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRuleClick(rule)}
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    Détails
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-base text-muted-foreground">
        <p>
          Affichage de {filteredRules.length} sur {rules.length} règles
        </p>
      </div>
    </div>
  );
};
