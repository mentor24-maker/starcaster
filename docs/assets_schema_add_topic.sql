-- Execute this block inside the Supabase SQL Editor to append our new tracking bounds
ALTER TABLE public.assets 
ADD COLUMN IF NOT EXISTS topic text default '';

ALTER TABLE public.assets 
ADD COLUMN IF NOT EXISTS comments text default '';
