-- Create a vector extension if not exists
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

-- Drop table format if recreating
DROP TABLE IF EXISTS public.training_corpus;

-- Build the core unified knowledge base table
CREATE TABLE public.training_corpus (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    title TEXT NOT NULL,
    source_type TEXT NOT NULL,          -- e.g., 'Code', 'Discussion', 'Schema', 'Rule', 'API_Config'
    category TEXT DEFAULT 'General',    -- High-level grouping namespace
    content_text TEXT NOT NULL,         -- The raw, explicit markdown or code text chunk
    embedding vector(1536),             -- OpenAI default vector sizing format
    metadata JSONB DEFAULT '{}'::jsonb  -- Key-value dump for file paths, urls, timestamps, authors
);

-- Enable RLS
ALTER TABLE public.training_corpus ENABLE ROW LEVEL SECURITY;

-- Allow all access for local development
CREATE POLICY "Allow all access on training corpus" 
ON public.training_corpus
FOR ALL 
TO public
USING (true) 
WITH CHECK (true);

-- Create a matching function to perform similarity search natively in Supabase via RPC
CREATE OR REPLACE FUNCTION match_training_corpus (
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id uuid,
  title text,
  source_type text,
  category text,
  content_text text,
  metadata jsonb,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    training_corpus.id,
    training_corpus.title,
    training_corpus.source_type,
    training_corpus.category,
    training_corpus.content_text,
    training_corpus.metadata,
    1 - (training_corpus.embedding <=> query_embedding) AS similarity
  FROM training_corpus
  WHERE 1 - (training_corpus.embedding <=> query_embedding) > match_threshold
  ORDER BY training_corpus.embedding <=> query_embedding
  LIMIT match_count;
$$;
