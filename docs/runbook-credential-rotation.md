# Runbook: Credential Rotation (Starcaster / Normie stack)

**Trigger:** Any time a secret may have been exposed (screenshot, photo, screen share,
pasted into a chat, committed to git) — or on a routine 90-day schedule.
**Owner:** Dane (human-only task — agents never handle live secrets).
**Last run:** 2026-07-13 (photo exposure — living-room TV displaying .env.local)

---

## Phase 0 — Inventory (5 min)

Open `.env.local` (privately!) and list every key visible in the exposed material.
From the July 13 photos, the visible-and-legible set included at least:

| # | Env var | Provider console to visit | Rotated? | Updated in Vercel? |
|---|---------|---------------------------|----------|--------------------|
| 1 | ANTHROPIC_API_KEY | console.anthropic.com → API Keys | ☐ | ☐ |
| 2 | OPENAI_API_KEY | platform.openai.com → API Keys | ☐ | ☐ |
| 3 | GEMINI_API_KEY | aistudio.google.com → API Keys | ☐ | ☐ |
| 4 | BLOB_READ_WRITE_TOKEN (Vercel Blob) | vercel.com → Storage → Blob → tokens | ☐ | ☐ |
| 5 | BLUESKY_APP_PASSWORD | bsky.app → Settings → App Passwords (revoke + new) | ☐ | ☐ |
| 6 | BUFFER_API_KEY | Buffer developer/app settings | ☐ | ☐ |
| 7 | RESEND_API_KEY | resend.com → API Keys | ☐ | ☐ |
| 8 | BRAVE_API_KEY | api.search.brave.com dashboard | ☐ | ☐ |
| 9 | FAL_KEY | fal.ai dashboard → Keys | ☐ | ☐ |
| 10 | GOOGLE_CUSTOM_SEARCH_API_KEY | console.cloud.google.com → Credentials | ☐ | ☐ |
| 11 | GOOGLE_DRIVE_CLIENT_SECRET (+ refresh token) | console.cloud.google.com → OAuth client → reset secret | ☐ | ☐ |
| 12 | META_APP_SECRET | developers.facebook.com → App → Settings → Basic → reset | ☐ | ☐ |
| 13 | OPENCLAW keys / gateway secrets | wherever OpenClaw gateway is configured | ☐ | ☐ |
| 14 | CRON_SECRET | self-generated — mint a new random string | ☐ | ☐ |
| 15 | CHANNELS_ENCRYPTION_KEY | ⚠️ SPECIAL CASE — see Phase 3 | ☐ | ☐ |

> Add any others present in the file that photographed legibly. When in doubt, rotate —
> a key that *might* be burned is burned.

## Phase 1 — Rotate (one provider at a time)

For each row: log into the console → revoke/delete the old key → generate new →
paste the new value into a **local scratch file that never leaves this machine**
(or better, straight into the password manager — see Phase 4).

Order matters only for #15; everything else is independent. Do the cheap, fast
ones first (Anthropic, OpenAI, Resend take ~2 min each).

## Phase 2 — Deploy the new values

1. Vercel → each project (Starcaster, Normie) → Settings → Environment Variables →
   update each changed value in the right environments (Production / Preview / Dev).
2. Update local `.env.local` on the MacBook.
3. **Redeploy** both projects so serverless functions pick up the new env.
4. Smoke-test: one AI call, one transactional email (Resend), one blob upload,
   one social publish (Buffer/Bluesky), one scheduled-job run (CRON_SECRET path).

## Phase 3 — The encryption key (careful)

CHANNELS_ENCRYPTION_KEY encrypts tenant social credentials at rest. Rotating it
blindly makes existing ciphertexts unreadable. Procedure:
1. Decrypt existing channel credentials with the OLD key (script/console task).
2. Generate new key; re-encrypt; update env; redeploy; verify a tenant channel connects.
3. Only then destroy the old key.
If no tenant credentials are stored yet for a project, skip ceremony — just replace.

**Tooling:** `scripts/rotate_channels_encryption_key.js` does steps 1-2 for
all tenants in one pass — dry-run verifies every row decrypts with
`OLD_CHANNELS_ENCRYPTION_KEY` before anything is written, `--apply` backs up
the pre-rotation rows to `~/starcaster-channels-key-rotation-backup-*.json`
and re-encrypts under `NEW_CHANNELS_ENCRYPTION_KEY`. Set both key env vars in
your own shell, never in a file that leaves this machine. See the comment at
the top of the script for the full command sequence.

## Phase 4 — Prevent the next one (15 min, highest ROI)

- Move the source of truth for all secrets into a password manager
  (1Password / Apple Passwords). `.env.local` becomes a *copy*, not the record.
- Never open `.env*` files when any screen is visible in a photo, call, or stream.
  Close the editor tab when done — don't leave it pinned.
- Add a pre-photo habit: ⌘H every app, desktop clean, THEN shoot.
- Photos already taken: empty Recently Deleted on iPhone (Photos → search
  "Recently Deleted" → Delete All) so iCloud copies die too.

## Phase 5 — Log it

Append date, cause, and keys rotated to the bottom of this file. The log turns
this runbook into institutional memory — and eventually into an agent skill
(everything except Phase 1, which stays human forever).

---
### Rotation log
- 2026-07-13 — cause: cover-photo exposure of .env.local on TV. Keys: (fill in)
