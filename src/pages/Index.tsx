import { useState } from "react";
import { Header } from "@/components/Dashboard/Header";
import { UploadDialog } from "@/components/Dashboard/UploadDialog";
import { RecentDocumentsList } from "@/components/Dashboard/RecentDocumentsList";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

const Index = () => {
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container max-w-4xl mx-auto px-6 py-12">
        {/* Bloc d'upload central */}
        <div className="mb-16">
          <div
            onClick={() => setUploadOpen(true)}
            className="cursor-pointer bg-muted/30 border-2 border-dashed border-border hover:border-primary/50 rounded-xl p-12 flex flex-col items-center justify-center text-center transition-all hover:bg-muted/50"
          >
            <div className="mb-6">
              <Upload className="h-10 w-10 text-primary mx-auto" />
            </div>
            <p className="text-muted-foreground text-lg mb-6 max-w-2xl">
              Déposez un document PDF ou PPTX à analyser. L'extraction commencera automatiquement.
            </p>
            <Button 
              onClick={(e) => {
                e.stopPropagation();
                setUploadOpen(true);
              }}
              size="lg"
              className="font-medium"
            >
              Sélectionner un fichier
            </Button>
          </div>
        </div>

        {/* Liste des documents récents */}
        <RecentDocumentsList />
      </main>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  );
};

export default Index;
