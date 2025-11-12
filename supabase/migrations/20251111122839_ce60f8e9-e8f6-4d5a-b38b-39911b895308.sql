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