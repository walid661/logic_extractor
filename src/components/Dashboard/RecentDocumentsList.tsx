import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DocumentCard } from "./DocumentCard";
import { Loader2 } from "lucide-react";

interface Document {
  id: string;
  name: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  created_at: string;
}

interface Rule {
  document_id: string;
  confidence: number;
}

export const RecentDocumentsList = () => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [rulesStats, setRulesStats] = useState<Record<string, { count: number; avgConfidence: number }>>({});
  const [loading, setLoading] = useState(true);

  const fetchDocuments = async () => {
    const { data, error } = await supabase
      .from('documents')
      .select('id, name, status, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('Error fetching documents:', error);
      return;
    }

    setDocuments((data || []) as Document[]);
    
    // Fetch rules stats for done documents
    if (data && data.length > 0) {
      const doneDocIds = data.filter(d => d.status === 'done').map(d => d.id);
      if (doneDocIds.length > 0) {
        const { data: rulesData } = await supabase
          .from('rules')
          .select('document_id, confidence')
          .in('document_id', doneDocIds);

        if (rulesData) {
          const stats: Record<string, { count: number; avgConfidence: number }> = {};
          (rulesData as Rule[]).forEach(rule => {
            if (!stats[rule.document_id]) {
              stats[rule.document_id] = { count: 0, avgConfidence: 0 };
            }
            stats[rule.document_id].count++;
            stats[rule.document_id].avgConfidence += (rule.confidence || 0);
          });

          // Calculate averages
          Object.keys(stats).forEach(docId => {
            if (stats[docId].count > 0) {
              stats[docId].avgConfidence = stats[docId].avgConfidence / stats[docId].count;
            }
          });

          setRulesStats(stats);
        }
      }
    }
    
    setLoading(false);
  };

  useEffect(() => {
    fetchDocuments();

    // Subscribe to document changes
    const channel = supabase
      .channel('documents-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'documents'
        },
        () => {
          fetchDocuments();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Auto-refresh when there are processing documents
  useEffect(() => {
    const hasProcessing = documents.some(
      doc => doc.status === 'processing' || doc.status === 'queued'
    );

    if (!hasProcessing) return;

    const interval = setInterval(() => {
      fetchDocuments();
    }, 5000); // Refresh every 5 seconds

    return () => clearInterval(interval);
  }, [documents]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground text-lg">
          Aucun document récent. Commencez par en télécharger un.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold text-foreground mb-4">Documents récents</h2>
      {documents.map((doc) => (
        <DocumentCard
          key={doc.id}
          id={doc.id}
          name={doc.name}
          status={doc.status}
          created_at={doc.created_at}
          rulesCount={rulesStats[doc.id]?.count}
          avgConfidence={rulesStats[doc.id]?.avgConfidence}
        />
      ))}
    </div>
  );
};
