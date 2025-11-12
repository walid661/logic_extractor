import { FileText, Trash2, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

interface Document {
  id: string;
  name: string;
  pages: number;
  created_at: string;
  status: 'queued' | 'processing' | 'done' | 'error';
}

interface DocumentsListProps {
  documents: Document[];
  onDelete: (id: string) => void;
}

export const DocumentsList = ({ documents, onDelete }: DocumentsListProps) => {
  const navigate = useNavigate();

  if (documents.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Aucun document analysé pour le moment.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {documents.map((doc) => {
        const isClickable = doc.status === 'done';
        
        return (
          <div
            key={doc.id}
            className={`border border-border rounded-xl p-4 flex justify-between items-center transition-colors ${
              isClickable 
                ? 'hover:bg-accent/50 cursor-pointer' 
                : 'opacity-60 cursor-not-allowed'
            }`}
            onClick={() => isClickable && navigate(`/documents/${doc.id}`)}
          >
            <div className="flex items-center gap-3 flex-1">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-foreground">{doc.name}</h3>
                  {doc.status === "queued" && (
                    <span className="px-2 py-1 rounded-full bg-yellow-100 text-yellow-700 text-xs font-medium">
                      En attente
                    </span>
                  )}
                  {doc.status === "processing" && (
                    <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-medium flex items-center space-x-1">
                      <Loader2 className="animate-spin w-3 h-3" />
                      <span>Extraction...</span>
                    </span>
                  )}
                  {doc.status === "done" && (
                    <span className="px-2 py-1 rounded-full bg-green-100 text-green-700 text-xs font-medium flex items-center space-x-1">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Terminé</span>
                    </span>
                  )}
                  {doc.status === "error" && (
                    <span className="px-2 py-1 rounded-full bg-red-100 text-red-700 text-xs font-medium">
                      Échec
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {doc.pages || 0} pages · Analysé le {new Date(doc.created_at).toLocaleDateString('fr-FR')}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(doc.id);
              }}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      })}
    </div>
  );
};
