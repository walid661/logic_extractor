import { FileText, CheckCircle2, AlertCircle, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";

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

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D', '#FFC658', '#FF6B9D'];

export const StatsCards = ({ totalRules, totalDocuments, rules = [] }: StatsCardsProps) => {
  // Calculer la confiance moyenne réelle
  const validConfidences = rules
    .map(r => r.confidence)
    .filter((c): c is number => c !== null && c !== undefined && !isNaN(c));

  const avgConfidence = validConfidences.length > 0
    ? (validConfidences.reduce((sum, c) => sum + c, 0) / validConfidences.length) * 100
    : 0;

  // Compter les domaines uniques et leur fréquence
  const domainCounts = rules.reduce((acc, rule) => {
    const domain = rule.domain || 'Non classé';
    acc[domain] = (acc[domain] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const domainData = Object.entries(domainCounts).map(([name, value]) => ({
    name,
    value,
  }));

  const domainsCount = Object.keys(domainCounts).length;

  // Distribution de confiance par tranches
  const confidenceRanges = [
    { range: '0-20%', min: 0, max: 0.2, count: 0 },
    { range: '20-40%', min: 0.2, max: 0.4, count: 0 },
    { range: '40-60%', min: 0.4, max: 0.6, count: 0 },
    { range: '60-80%', min: 0.6, max: 0.8, count: 0 },
    { range: '80-100%', min: 0.8, max: 1.0, count: 0 },
  ];

  validConfidences.forEach(conf => {
    const rangeIndex = confidenceRanges.findIndex(r => conf >= r.min && conf < r.max);
    if (rangeIndex >= 0) {
      confidenceRanges[rangeIndex].count++;
    } else if (conf === 1.0) {
      confidenceRanges[4].count++; // 100% goes in the last range
    }
  });

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
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

      {/* Charts */}
      {rules.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Pie Chart - Domain Distribution */}
          <Card className="p-6">
            <h3 className="mb-4 text-lg font-semibold">Distribution par domaine</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={domainData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {domainData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </Card>

          {/* Bar Chart - Confidence Distribution */}
          <Card className="p-6">
            <h3 className="mb-4 text-lg font-semibold">Distribution de confiance</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={confidenceRanges}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="range" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#8884d8" />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}
    </div>
  );
};
