# StarCaster — SQL migrations tracker

**Canonical SQL location:** `docs/*.sql` in this repo only.  
**Do not use:** `ai-daemon/sandbox/isit-app/docs/` (stale duplicate tree).

StarCaster has **no automated migration runner**. Apply scripts manually in the **StarCaster Supabase** SQL editor (or `psql`), then record them here so local, preview, and production stay aligned.

---

## How to use this file

1. **Before coding** — grep `docs/` for the table or column you need; confirm the script exists.
2. **Apply** — run the full file in order (respect `begin;` / `commit;` blocks when present).
3. **Record** — add a row to [Applied log](#applied-log) with date, environment, and your initials.
4. **New schema** — add `docs/NNN_short_name.sql` (next sequence number), document it in [Migration catalog](#migration-catalog), append to the applied log when run.

### Environment columns

| Code | Meaning |
|------|---------|
| `local` | Dev machine against dev/staging Supabase |
| `preview` | Vercel preview deployment DB (if separate) |
| `prod` | Production Supabase (Vercel production) |

Use `✓` and date (`2026-05-18`) or `—` if not applicable.

---

## Applied log

Record **packs** or individual files after you run them. Oldest first.

| Date | File / pack | local | preview | prod | Notes |
|------|-------------|-------|---------|------|-------|
| | `projects_multitenancy_setup.sql` | | | | Foundation: `app_projects`, memberships |
| | `auth_supabase_setup.sql` | | | | Login tables |
| 2026-05-18 | `011_multitenancy_acquire_engage.sql` | ✓ | | | Item 2 — engage + acquire tables |
| 2026-05-18 | `012_multitenancy_backfill_primary_project.sql` | ✓ | | | Item 2 — backfill (your project/user IDs) |
| 2026-05-18 | `supabase_connection_ops_setup.sql` | ✓ | | | Item 3 — Connection Ops smoke tests passed |
| 2026-05-18 | `013_file_stores_supabase.sql` | ✓ | ✓ | ✓ | acquire_job_mirror, orchestrator_runs, develop_icons; SQL run in Supabase **ISITAS** (prod); preview uses same DB as prod on Vercel |
| | | | | | |

*Add rows above as you apply scripts. Do not delete history—strike through superseded entries if needed.*

---

## Recommended apply order (greenfield / new Supabase)

Run only what your deployment needs. Many files are **domain setup** (safe `create if not exists`); others are **one-time alters** (run once per environment).

### Tier 0 — Auth & projects (required)

| Order | File | Purpose |
|------:|------|---------|
| 1 | `auth_supabase_setup.sql` | `app_auth_users`, `app_auth_sessions` |
| 2 | `projects_multitenancy_setup.sql` | `app_projects`, `app_project_memberships` |

### Tier 1 — Core product tables (typical production)

| Order | File | Purpose |
|------:|------|---------|
| 3 | `app_profiles_setup.sql` | Settings profile |
| 4 | `app_profiles_youtube_context_migration.sql` | YouTube prompt column on profiles |
| 5 | `contacts` setup / alters | See [Contacts](#contacts--personas) |
| 6 | `channels_*` / `channels_password_encryption_migration.sql` | Channel accounts |
| 7 | `segments_setup.sql` | Segments |
| 8 | `campaigns_schema_add_topic.sql` | Campaigns (if not in `app_tables_setup`) |
| 9 | `assets_*` / `asset_categories_*` | Assets + categories |
| 10 | `messaging_project_scope_setup.sql` | `project_id` on messaging tables |
| 11 | `messaging_topics_setup.sql` (+ `messaging_topics_migration.sql` if legacy DB) | Topics |
| 12 | `messaging_formats_setup.sql` | Formats |
| 13 | Other `messaging_*_setup.sql` | Content types you use |
| 14 | `add_project_fk_messaging_tables.sql` | FK + orphan cleanup (messaging) |
| 15 | `add_project_fk_constraints.sql` | FK on campaigns, assets, channels, contacts |
| 16 | `develop_*_setup.sql` | Builder tables in use |
| 17 | `engage_social` via `011_multitenancy_acquire_engage.sql` | Engage social posts |
| 18 | `supabase_training_*.sql` | Training taxonomy/settings/rules |
| 19 | `observe_*_setup.sql` | Observe logs (optional) |
| 20 | `polls_setup.sql` | Polls (optional) |

### Tier 2 — Multitenancy hardening (2026 workstream)

| Order | File | Purpose |
|------:|------|---------|
| 21 | `011_multitenancy_acquire_engage.sql` | `engage_social_posts`, `direct_acquire_runs`, X/Reddit tables |
| 22 | `012_multitenancy_backfill_primary_project.sql` | Backfill `NULL project_id` (edit placeholders first) |
| 23 | Env: `STRICT_PROJECT_SCOPE=true` | Not SQL — StarCaster `.env` + Vercel |
| 24 | `supabase_connection_ops_setup.sql` | `connection_ops_state` |
| 25 | `013_file_stores_supabase.sql` | Acquire mirror, orchestrator runs, develop icons |

### Tier 3 — Backfills (environment-specific)

Run only when migrating legacy data (e.g. from a pre-project DB):

- `messaging_project_scope_backfill_izit_app.sql`
- `assets_project_scope_backfill_izit_app.sql`
- `project_scope_remaining_backfill_izit_app.sql`
- `contacts_backfill_personality_class.sql`

---

## Migration catalog (by domain)

All paths relative to `docs/`.

### Contacts & personas

- `contacts` — implied in `app_tables_setup.sql` or dedicated setup; alters: `contacts_add_middle_name.sql`, `contacts_add_entity_type.sql`, `contacts_add_contact_class.sql`, `contacts_backfill_personality_class.sql`, `contacts_project_unique_email_migration.sql`, `contacts_options_management_setup.sql`
- `contact_personas_setup.sql`, `contact_personas_fields.sql`, `contact_personas_type_migration.sql`

### Messaging

- Setup: `messaging_*_setup.sql` (topics, formats, tags, prompts, keywords, headlines, articles, etc.)
- Scope: `messaging_project_scope_setup.sql`, `messaging_project_scope_backfill_izit_app.sql`, `messaging_content_topic_migration.sql`, `messaging_formats_project_unique_migration.sql`, `messaging_feedback_columns.sql`, `messaging_prompt_id_columns.sql`, `messaging_headlines_quality_score.sql`, `messaging_hashtags_campaign_id.sql`
- FK pack: `add_project_fk_messaging_tables.sql`

### Builder (`develop_*`)

- `develop_modules_setup.sql`, `develop_module_classes_setup.sql`, `develop_forms_setup.sql`, `develop_themes_*`, `develop_landing_page_*`, `develop_page_templates_*`, `develop_email_templates_*`, `develop_extensions_setup.sql`

### Acquire & Engage

- `011_multitenancy_acquire_engage.sql` — **primary** engage + direct acquire + harvest tables
- `supabase_acquire_migrations.sql`, `supabase_acquire_youtube_*.sql`, `supabase_engage_youtube_comment_agents.sql`

### Settings & training

- `app_profiles_setup.sql`, `app_profiles_youtube_context_migration.sql`
- `supabase_training_settings.sql`, `supabase_training_taxonomy.sql`, `supabase_training_rules_guides.sql`
- `supabase_connection_ops_setup.sql`

### Dev agent / Roger (optional)

- `dev_chat_setup.sql`, `dev_sessions_setup.sql`, `dev_tasks_setup.sql`, `dev_projects_setup.sql`, `alter_dev_tasks_*.sql`, `dev_*` — only if using in-app dev agent tables

### Observe & polls

- `observe_usage_logs_setup.sql`, `observe_page_views_setup.sql`
- `polls_setup.sql`

---

## Adding migration `013+`

1. Pick the next number: `013_my_change.sql` (after `012_multitenancy_backfill_primary_project.sql`).
2. Put the file in `docs/` with a header comment: purpose, dependencies, idempotent yes/no.
3. Add a row to [Applied log](#applied-log) and a line in the appropriate [catalog](#migration-catalog) section.
4. Mention in `docs/AI_AGENT_HANDOFF.md` §12 if it blocks a Top Ten item.

Optional future: copy finalized scripts into `supabase/migrations/` for Supabase CLI — see `supabase/migrations/README.md`.

---

## Verify schema (quick checks)

```sql
-- Projects use text ids (not uuid)
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'app_projects' and column_name = 'id';

-- Multitenancy tables exist
select to_regclass('public.engage_social_posts'),
       to_regclass('public.connection_ops_state');

-- Orphan project_ids (should be 0 after backfill + strict scope)
select count(*) from public.contacts where project_id is null;
```

---

## Related docs

- `docs/AI_AGENT_HANDOFF.md` — §6 Persistence, §12 Top Ten
- `docs/FILE_PERSISTENCE_INVENTORY.md` — which features need which tables
- `docs/VERCEL_CUTOVER.md` — production env + Blob cutover
