-- Create documents table
CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INT,
  pages INT,
  path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create jobs table
CREATE TABLE public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INT NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create rules table
CREATE TABLE public.rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  document_name TEXT NOT NULL,
  text TEXT NOT NULL,
  conditions JSONB,
  domain TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  confidence FLOAT,
  source_page INT,
  source_sect TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create test_cases table
CREATE TABLE public.test_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES public.rules(id) ON DELETE CASCADE,
  inputs JSONB NOT NULL,
  expected JSONB NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_cases ENABLE ROW LEVEL SECURITY;

-- Public read policies (MVP - later add user-based restrictions)
CREATE POLICY "Public read documents" ON public.documents FOR SELECT USING (true);
CREATE POLICY "Public read jobs" ON public.jobs FOR SELECT USING (true);
CREATE POLICY "Public read rules" ON public.rules FOR SELECT USING (true);
CREATE POLICY "Public read test_cases" ON public.test_cases FOR SELECT USING (true);

-- Indexes for performance
CREATE INDEX idx_jobs_document ON public.jobs(document_id);
CREATE INDEX idx_rules_document ON public.rules(document_id);
CREATE INDEX idx_rules_domain ON public.rules(domain);
CREATE INDEX idx_rules_tags ON public.rules USING GIN(tags);
CREATE INDEX idx_test_cases_rule ON public.test_cases(rule_id);