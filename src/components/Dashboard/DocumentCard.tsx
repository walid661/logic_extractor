import { useNavigate } from "react-router-dom";
import { CheckCircle2, Loader2, AlertCircle, FileText, FileSpreadsheet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface DocumentCardProps {
  id: string;
  name: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  created_at: string;
  rulesCount?: number;
  avgConfidence?: number;
  progress?: number;
}

export const DocumentCard = ({
  id,
  name,
  status,
  created_at,
  rulesCount,
  avgConfidence,
  progress
}: DocumentCardProps) => {
  const navigate = useNavigate();

  const getStatusBadge = () => {
    switch (status) {
      case 'processing':
      case 'queued':
        return (
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            {progress !== undefined ? `Extraction ${progress}%` : 'Extraction en cours…'}
          </Badge>
        );
      case 'done':
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Terminé {rulesCount ? `(${rulesCount} règles)` : ''}
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
            <AlertCircle className="h-3 w-3 mr-1" />
            Échec extraction
          </Badge>
        );
    }
  };

  const getFileIcon = () => {
    if (name.toLowerCase().endsWith('.xlsx') || name.toLowerCase().endsWith('.xls')) {
      return <FileSpreadsheet className="h-5 w-5 text-green-600" />;
    }
    return <FileText className="h-5 w-5 text-blue-600" />;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  const handleClick = () => {
    if (status === 'done') {
      navigate(`/documents/${id}`);
    }
  };

  return (
    <Card
      onClick={handleClick}
      className={`p-4 border border-border bg-card transition-all ${
        status === 'done' 
          ? 'cursor-pointer hover:shadow-md hover:border-primary/50' 
          : 'cursor-default opacity-70'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-1">
          {getFileIcon()}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3 className="font-semibold text-foreground truncate">{name}</h3>
            {getStatusBadge()}
          </div>
          
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>{formatDate(created_at)}</span>
            {avgConfidence !== undefined && status === 'done' && (
              <span className="text-primary font-medium">
                Confiance: {(avgConfidence * 100).toFixed(0)}%
              </span>
            )}
          </div>

          {/* Progress bar for processing documents */}
          {(status === 'processing' || status === 'queued') && progress !== undefined && (
            <div className="mt-3">
              <Progress value={progress} className="h-2" />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};
