export interface RuleSource {
  page: number;
  section: string;
}

export interface Rule {
  id: string;
  documentId: string;
  documentName: string;
  text: string;
  conditions: string[];
  domain: string;
  tags: string[];
  confidence: number;
  source: RuleSource;
  createdAt: string;
}

export interface Document {
  id: string;
  name: string;
  type: 'pdf' | 'pptx';
  uploadedAt: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  rulesCount?: number;
}

export interface TestCase {
  id: string;
  ruleId: string;
  inputs: Record<string, any>;
  expected: any;
  description: string;
}
