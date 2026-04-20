-- Backfill the entire contacts table to 'personality' per your request
UPDATE public.contacts 
SET contact_class = 'personality';
