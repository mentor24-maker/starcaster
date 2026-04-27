-- /docs/contacts_add_entity_type.sql
-- Adds the entity_type column to the contacts table and updates the 3 most recent to 'Agent'

ALTER TABLE public.contacts 
  ADD COLUMN IF NOT EXISTS entity_type text not null default 'Human' 
  CHECK (entity_type in ('Human', 'Agent'));

-- Update the 3 most recently created contacts to 'Agent'
UPDATE public.contacts 
SET entity_type = 'Agent' 
WHERE id IN (
  SELECT id FROM public.contacts 
  ORDER BY created_at DESC 
  LIMIT 3
);
