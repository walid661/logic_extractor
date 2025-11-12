import { FileText, CheckCircle2, AlertCircle, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: string;
}

const StatCard = ({ title, value, icon, trend }: StatCardProps) => {
  return (
    <Card className="p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-semibold text-foreground">{value}</p>
          {trend && (
            <p className="mt-2 flex items-center text-xs text-success">
              <TrendingUp className="mr-1 h-3 w-3" />
              {trend}
            </p>
          )}
        </div>
        <div className="rounded-lg bg-primary/10 p-3 text-primary">{icon}</div>
      </div>
    </Card>
  );
};

interface StatsCardsProps {
  totalRules: number;
  totalDocuments: number;
  rules?: Array<{ 
    domain: string | null;
    confidence?: number | null;
  }>;
}

export const StatsCards = ({ totalRules, totalDocuments, rules = [] }: StatsCardsProps) => {
  // Calculer la confiance moyenne réelle
  const validConfidences = rules
    .map(r => r.confidence)
    .filter((c): c is number => c !== null && c !== undefined && !isNaN(c));
  
  const avgConfidence = validConfidences.length > 0
    ? (validConfidences.reduce((sum, c) => sum + c, 0) / validConfidences.length) * 100
    : 0;

  // Compter les domaines uniques
  const uniqueDomains = new Set(rules.filter(r => r.domain).map(r => r.domain));
  const domainsCount = uniqueDomains.size;

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <StatCard
        title="Total règles"
        value={totalRules}
        icon={<CheckCircle2 className="h-5 w-5" />}
      />
      <StatCard
        title="Confiance moyenne"
        value={validConfidences.length > 0 ? `${avgConfidence.toFixed(1)}%` : "N/A"}
        icon={<AlertCircle className="h-5 w-5" />}
      />
      <StatCard
        title="Domaines"
        value={domainsCount}
        icon={<TrendingUp className="h-5 w-5" />}
      />
    </div>
  );
};
