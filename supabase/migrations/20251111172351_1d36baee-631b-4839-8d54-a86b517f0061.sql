-- Drop existing policies if they exist
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