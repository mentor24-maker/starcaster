# File persistence inventory (Top Ten #3)

**Last updated:** 2026-05-18  
Vercel serverless cannot write under `data/*.json` (`EROFS`). Production must use **Supabase** or **env vars**.

Shared helper: `lib/localDataFs.js` — skips local JSON writes when `VERCEL` / `VERCEL_ENV` is set.

## Legend

| Status | Meaning |
|--------|---------|
| **Supabase-primary** | Uses Supabase when configured; file is local dev fallback only |
| **Env-primary** | Production values from environment variables |
| **File-only** | Still JSON-only — needs migration or marked local-only |
| **Local-only** | Intentionally not persisted in production |

## Stores (`lib/`)

| Module | File | Status | Notes |
|--------|------|--------|-------|
| `ContactsStore.js` | — | Supabase-primary | No file writes |
| `promoteSocialStore.js` | `engage_social_posts.json` | Supabase-primary | File fallback when table missing |
| `directAcquireRunsStore.js` | `direct_acquire_runs.json` | Supabase-primary | File fallback |
| `acquire/XAcquireStore.js` | `x_harvest_runs.json` | Supabase-primary | Scoped file; SB table optional (011) |
| `acquire/RedditAcquireStore.js` | `reddit_harvest_runs.json` | Supabase-primary | Same as X |
| `profileStore.js` | `profile.json` | Supabase-primary | Memory + file fallback; `app_profiles` table |
| `trainingStore.js` | `training.json` | Supabase-primary | File fallback when SB unset |
| `developModulesStore.js` | `develop_modules.json` | Supabase-primary | File fallback |
| `developFormsStore.js` | `develop_forms.json` | Supabase-primary | File fallback |
| `developIconStore.js` | `develop_icons.json` | Supabase-primary | `develop_icons` — `013_file_stores_supabase.sql` |
| `orchestratorRunsStore.js` | `orchestrator_runs.json` | Supabase-primary | `orchestrator_runs` — same |
| `connectionOpsStore.js` | `connection_ops.json` | **Supabase-primary** | `connection_ops_state` — see `supabase_connection_ops_setup.sql` |
| `acquireMirror.js` | `acquire_jobs.json` | Supabase-primary | `acquire_job_mirror` — project-scoped |
| `apiSettings.js` | `api_settings.json` | Env-primary | EROFS → 409; prod uses Vercel env |
| `projectsStore.js` | `projects.json` | Supabase-primary | Fallback when SB auth unset |
| `authStore.js` | auth JSON | Supabase-primary | Fallback when SB auth unset |

## Operator checklist (Connection Ops on Vercel)

1. Run `docs/supabase_connection_ops_setup.sql` in StarCaster Supabase.
2. Deploy with Supabase env vars set (gates/attempts persist per `project_id` + platform).

## Operator checklist (`013` stores)

1. Run `docs/013_file_stores_supabase.sql` in StarCaster Supabase.
2. Restart dev server; use an active **project** in the switcher for Acquire jobs, orchestrator, and icon builder.

## Still open (after #3)

- Wire X/Reddit harvest stores to Supabase tables from `011` (file fallback remains).
- Audit remaining routes for `requestProjectScope(req)` on scoped stores.
