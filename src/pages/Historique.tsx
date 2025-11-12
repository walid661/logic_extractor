import { useState, useEffect, useMemo } from "react";
import { Header } from "@/components/Dashboard/Header";
import { DocumentsList } from "@/components/Dashboard/DocumentsList";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";

interface Document {
  id: string;
  name: string;
  pages: number;
  created_at: string;
  status: 'queued' | 'processing' | 'done' | 'error';
}

const Historique = () => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<string>("recent");
  const { toast } = useToast();

  useEffect(() => {
    fetchDocuments();

    // Subscribe to realtime updates
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'documents'
        },
        (payload) => {
          console.log('Document change:', payload);
          fetchDocuments();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchDocuments = async () => {
    const { data, error } = await supabase
      .from("documents")
      .select("id, name, pages, created_at, status")
      .order("created_at", { ascending: false });
    
    if (error) {
      console.error("Error fetching documents:", error);
      return;
    }
    
    setDocuments((data || []) as Document[]);
  };

  const handleDeleteDocument = async (documentId: string) => {
    try {
      const { error } = await supabase.functions.invoke("delete-document", {
        body: { documentId },
      });

      if (error) throw error;

      toast({
        title: "Document supprimé",
        description: "Le document et ses règles ont été supprimés.",
      });

      fetchDocuments();
    } catch (error) {
      toast({
        title: "Erreur de suppression",
        description: error instanceof Error ? error.message : "Impossible de supprimer le document",
        variant: "destructive",
      });
    }
  };

  const filteredDocuments = useMemo(() => {
    let filtered = [...documents];

    // Filter by search query
    if (searchQuery.trim()) {
      filtered = filtered.filter(doc =>
        doc.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Filter by document type
    if (typeFilter !== "all") {
      filtered = filtered.filter(doc => {
        const extension = doc.name.toLowerCase().split('.').pop();
        return extension === typeFilter;
      });
    }

    // Sort by date
    filtered.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return sortOrder === "recent" ? dateB - dateA : dateA - dateB;
    });

    return filtered;
  }, [documents, searchQuery, typeFilter, sortOrder]);



  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-6 py-12">
        <div className="max-w-4xl mx-auto space-y-6">
          <h2 className="text-2xl font-semibold text-foreground">Mes documents analysés</h2>

          {/* Search and filters bar */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher un document par nom..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Type de document" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les types</SelectItem>
                  <SelectItem value="pdf">PDF uniquement</SelectItem>
                  <SelectItem value="pptx">PPTX uniquement</SelectItem>
                </SelectContent>
              </Select>

              <Select value={sortOrder} onValueChange={setSortOrder}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Trier par" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">Plus récent</SelectItem>
                  <SelectItem value="oldest">Plus ancien</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {filteredDocuments.length === 0 && documents.length > 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[30vh] space-y-4">
              <p className="text-muted-foreground text-lg">Aucun document ne correspond à vos critères de recherche</p>
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
              <p className="text-muted-foreground text-lg">Aucun document analysé pour le moment</p>
            </div>
          ) : (
            <DocumentsList documents={filteredDocuments} onDelete={handleDeleteDocument} />
          )}
        </div>
      </main>
    </div>
  );
};

export default Historique;
