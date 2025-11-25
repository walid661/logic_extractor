-- ============================================================================
-- LOGIC EXTRACTOR - COMPLETE DATABASE SETUP
-- ============================================================================
-- This SQL file contains ALL migrations in chronological order
-- Apply this once to set up the entire database schema from scratch
-- ============================================================================

-- ============================================================================
-- MIGRATION 1: Create base tables (20251110185845)
-- ============================================================================

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

-- ============================================================================
-- MIGRATION 2: Add status column to documents (20251111091807)
-- ============================================================================

ALTER TABLE public.documents
ADD COLUMN status text NOT NULL DEFAULT 'queued'
CHECK (status IN ('queued', 'processing', 'done', 'error'));

-- ============================================================================
-- MIGRATION 3: Enable realtime (20251111092410)
-- ============================================================================

ALTER TABLE public.documents REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.documents;

-- ============================================================================
-- MIGRATION 4: Add user authentication & profiles (20251111122839)
-- ============================================================================

-- Create profiles table for user information
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own profile
CREATE POLICY "Users can view their own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- Policy: Users can update their own profile
CREATE POLICY "Users can update their own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id);

-- Add user_id column to documents table
ALTER TABLE public.documents ADD COLUMN user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Update RLS policies for documents
DROP POLICY IF EXISTS "Public read documents" ON public.documents;

CREATE POLICY "Users can view their own documents"
ON public.documents
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own documents"
ON public.documents
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own documents"
ON public.documents
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Update RLS policies for rules
DROP POLICY IF EXISTS "Public read rules" ON public.rules;

CREATE POLICY "Users can view rules from their documents"
ON public.rules
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.documents
    WHERE documents.id = rules.document_id
    AND documents.user_id = auth.uid()
  )
);

-- Update RLS policies for jobs
DROP POLICY IF EXISTS "Public read jobs" ON public.jobs;

CREATE POLICY "Users can view their own jobs"
ON public.jobs
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.documents
    WHERE documents.id = jobs.document_id
    AND documents.user_id = auth.uid()
  )
);

-- Update RLS policies for test_cases
DROP POLICY IF EXISTS "Public read test_cases" ON public.test_cases;

CREATE POLICY "Users can view test cases from their rules"
ON public.test_cases
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.rules
    JOIN public.documents ON documents.id = rules.document_id
    WHERE rules.id = test_cases.rule_id
    AND documents.user_id = auth.uid()
  )
);

-- Create trigger function to create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (new.id, new.email);
  RETURN new;
END;
$$;

-- Trigger to create profile when user signs up
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- MIGRATION 5: Add missing RLS policies (20251111172351)
-- ============================================================================

DROP POLICY IF EXISTS "Users can update their own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can insert jobs for their documents" ON public.jobs;
DROP POLICY IF EXISTS "Users can update jobs for their documents" ON public.jobs;
DROP POLICY IF EXISTS "Users can insert rules for their documents" ON public.rules;

-- Documents: allow owners to UPDATE their own documents (status, pages, summary)
CREATE POLICY "Users can update their own documents"
ON public.documents
FOR UPDATE
USING (auth.uid() = user_id);

-- Jobs: allow INSERT when the job is tied to a document owned by the user
CREATE POLICY "Users can insert jobs for their documents"
ON public.jobs
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id = document_id AND d.user_id = auth.uid()
  )
);

-- Jobs: allow UPDATE when the job is tied to a document owned by the user (progress/status updates)
CREATE POLICY "Users can update jobs for their documents"
ON public.jobs
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id = document_id AND d.user_id = auth.uid()
  )
);

-- Rules: allow INSERT when the rule belongs to a document owned by the user
CREATE POLICY "Users can insert rules for their documents"
ON public.rules
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id = document_id AND d.user_id = auth.uid()
  )
);

-- ============================================================================
-- MIGRATION 6: Add file_hash for exact reuse (20251113120000) - MVP
-- ============================================================================

-- Add file_hash column to documents table
ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS file_hash TEXT;

-- Create index on (user_id, file_hash) for efficient exact reuse lookup
CREATE INDEX IF NOT EXISTS idx_documents_user_filehash
ON public.documents(user_id, file_hash);

-- Add comment explaining the purpose
COMMENT ON COLUMN public.documents.file_hash IS
'SHA-256 hash of PDF file content for exact reuse detection. If same file is uploaded again by same user, rules are copied without re-extraction.';

-- ============================================================================
-- MIGRATION 7: Add summary column to documents (if not exists)
-- ============================================================================

ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS summary TEXT;

COMMENT ON COLUMN public.documents.summary IS
'Auto-generated executive summary of extracted rules (async generation)';

-- ============================================================================
-- SETUP COMPLETE
-- ============================================================================
-- You can now use the Logic Extractor application!
-- Next steps:
-- 1. Deploy Edge Functions (upload-documents, generate-summary)
-- 2. Configure secrets (OPENAI_API_KEY, etc.)
-- 3. Test with a PDF upload
-- ============================================================================
