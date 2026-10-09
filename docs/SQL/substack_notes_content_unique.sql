-- substack_notes_content_unique.sql
-- Substack Notes 4/7 (Loop Queue task 86bcet775): when Dane publishes a new
-- video, Substack article or blog post, a draft Note about it waits for his
-- approval. Run AFTER docs/SQL/substack_notes_setup.sql.
--
-- Two changes, both additive — nothing existing is altered or removed:
--
-- 1. NEVER TWICE FOR ONE PIECE OF CONTENT. One 'new_content' Note per content
--    address per project and account. lib/substackNotesContentWatch.js already
--    skips an address it has a Note for; this index is what stops two passes
--    running at the same moment from both writing one. A Note Dane jots by hand
--    is not covered (source must be new_content), so linking his own idea to a
--    piece he already has a Note for is still allowed.
--
-- 2. WHAT THE WATCH HAS ALREADY SEEN. `content_watch` holds, per source, when
--    watching began, when it last looked, why it could not, and the addresses
--    it has already seen. Everything published before watching began is
--    recorded here as seen and never drafted — the first pass does not flood
--    Approvals with his back catalogue. Until this column exists the watch
--    refuses to run and says so on the Ideas tab, rather than treating every
--    old video as new.
--
-- Idempotent: running the whole file twice changes nothing.

create unique index if not exists idx_substack_notes_items_new_content_url
  on public.substack_notes_items (project_id, account_key, content_url)
  where source = 'new_content' and content_url <> '';

alter table public.substack_notes_settings
  add column if not exists content_watch jsonb not null default '{}'::jsonb;
