import { Rule } from "@/types/rule";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { FileText, MapPin, Tag, CheckCircle2 } from "lucide-react";

interface RuleDetailsDialogProps {
  rule: Rule | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const RuleDetailsDialog = ({ rule, open, onOpenChange }: RuleDetailsDialogProps) => {
  if (!rule) return null;

  const confidencePercentage = Math.round(rule.confidence * 100);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-3">
            <div className="mt-1 rounded-lg bg-primary/10 p-2">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-semibold">Détails de la règle</h3>
              <p className="mt-1 text-sm font-normal text-muted-foreground">{rule.id}</p>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div>
            <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CheckCircle2 className="h-4 w-4" />
              Règle métier
            </h4>
            <p className="rounded-lg bg-white border-2 border-primary/20 p-6 text-lg font-medium leading-relaxed text-black shadow-sm">{rule.text}</p>
          </div>

          <Separator />

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="mb-2 text-sm font-medium text-muted-foreground">Domaine</h4>
              <Badge variant="outline" className="text-sm">
                {rule.domain}
              </Badge>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-medium text-muted-foreground">Confiance</h4>
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${confidencePercentage}%` }}
                  />
                </div>
                <span className="text-sm font-medium">{confidencePercentage}%</span>
              </div>
            </div>
          </div>

          <Separator />

          <div>
            <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <MapPin className="h-4 w-4" />
              Source
            </h4>
            <div className="rounded-lg bg-muted p-4">
              <p className="font-medium text-sm">{rule.documentName}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Page {rule.source.page} · {rule.source.section}
              </p>
            </div>
          </div>

          <Separator />

          <div>
            <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CheckCircle2 className="h-4 w-4" />
              Conditions ({rule.conditions.length})
            </h4>
            <ul className="space-y-2">
              {rule.conditions.map((condition, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm">
                  <div className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
                  <span>{condition}</span>
                </li>
              ))}
            </ul>
          </div>

          <Separator />

          <div>
            <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Tag className="h-4 w-4" />
              Tags
            </h4>
            <div className="flex flex-wrap gap-2">
              {rule.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
