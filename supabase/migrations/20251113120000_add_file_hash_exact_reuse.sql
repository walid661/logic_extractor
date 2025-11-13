-- Add file_hash column for exact document reuse detection
-- MVP: No semantic cache, but exact file hash reuse for identical PDFs

-- Add file_hash column to documents table
ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS file_hash TEXT;

-- Create index on (user_id, file_hash) for efficient exact reuse lookup
CREATE INDEX IF NOT EXISTS idx_documents_user_filehash
ON public.documents(user_id, file_hash);

-- Add comment explaining the purpose
COMMENT ON COLUMN public.documents.file_hash IS
'SHA-256 hash of PDF file content for exact reuse detection. If same file is uploaded again by same user, rules are copied without re-extraction.';
