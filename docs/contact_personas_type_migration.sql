-- Migration to add robust polymorphic 'type' routing to the global custom trait schema

ALTER TABLE public.contact_personas 
ADD COLUMN type varchar(50) NOT NULL DEFAULT 'persona';

-- Create an index to optimize rapid filtered UI queries 
CREATE INDEX IF NOT EXISTS contact_personas_type_idx
  ON public.contact_personas (type);
