-- Add status column to documents table
ALTER TABLE public.documents 
ADD COLUMN status text NOT NULL DEFAULT 'queued' 
CHECK (status IN ('queued', 'processing', 'done', 'error'));