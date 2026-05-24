-- Backfill messaging_wyr_questions rows missing project_id (strict multitenancy hides them in the app).
-- Replace YOUR_PROJECT_ID and YOUR_USER_ID before running.

update public.messaging_wyr_questions
set
  project_id = 'YOUR_PROJECT_ID',
  owner_user_id = coalesce(nullif(owner_user_id, ''), 'YOUR_USER_ID'),
  updated_at = now()
where project_id is null;
