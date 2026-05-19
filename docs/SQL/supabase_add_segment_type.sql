-- docs/supabase_add_segment_type.sql
-- Add segment_type to segments table

ALTER TABLE public.segments
ADD COLUMN IF NOT EXISTS segment_type text DEFAULT 'email_list';

-- Optional: foreign key constraint to segment_types table
-- ALTER TABLE public.segments ADD CONSTRAINT segments_segment_type_fkey FOREIGN KEY (segment_type) REFERENCES public.segment_types(key) ON DELETE SET NULL;
