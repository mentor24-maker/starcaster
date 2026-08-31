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
| 16 | CLICKUP_API_TOKEN | app.clickup.com → Settings → Apps → API Token | ☐ | n/a — Doppler |

> Add any others present in the file that photographed legibly. When in doubt, rotate —
> a key that *might* be burned is burned.

**`.env.local` is not the inventory.** It is one place secrets live, and reading
only it is how row 16 came to be missing for months. Two other places hold
credentials that this runbook must cover:

* **Doppler** is the source of truth for anything the scripts use
  (`npm run clickup`, the bus relay, the loops). `doppler secrets --project
  starcaster --config dev --only-names` lists them without revealing a value, so
  an agent may run it — use it to build the inventory rather than reading a file.
* **Other repos keep their own copies.** See the next section; this is the one
  that bites.

## Phase 0b — Credentials with copies elsewhere (do not skip)

Rotating a credential in Doppler does **not** reach a copy of it that another
repo keeps on disk. Nothing errors, nothing warns, and the two look identical
until whatever uses the copy stops working — quietly, because it is usually a
background job with nobody watching.

That is not hypothetical. The ClickUp token was rotated at some point before
2026-08-22; Doppler and everything reading Doppler carried on fine, while Pulse
kept presenting its stale copy and failed **820 consecutive runs over twelve
days** before anyone noticed (task 86bbq83j0).

Known second homes, to refill by hand after any rotation of that credential:

| Credential | Second home | Refill with |
|---|---|---|
| `CLICKUP_API_TOKEN` | `~/pulse/config/clickup-mcp.json` (gitignored) → `mcpServers.clickup.env.CLICKUP_API_KEY` | `cd ~/pulse && doppler run --project starcaster --config dev -- python3 bin/restore-clickup-token.py` |

That script reads the value from the environment and rewrites only that one key,
so the value never appears on a command line or in a transcript — an agent may
run it (it never handles the value, Doppler does).

**Adding to this table is part of creating a copy.** If you put a credential
anywhere outside Doppler, it belongs here in the same commit, or the next
rotation kills it silently.

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
3. Update Doppler for anything the scripts read (`npm run clickup`, the relay,
   the loops).
4. **Who else holds a copy?** Work the Phase 0b table for every credential you
   just rotated and refill each second home. This step is the one that was
   missing when Pulse went dark for twelve days — everything above it passed.
5. **Redeploy** both projects so serverless functions pick up the new env.
   (Vercel bakes env vars in at build time; editing one in the dashboard does not
   reach the deployment already serving traffic.)
6. Smoke-test: one AI call, one transactional email (Resend), one blob upload,
   one social publish (Buffer/Bluesky), one scheduled-job run (CRON_SECRET path).
   For a refilled copy, test the **job**, not the credential: a token that reads
   back correctly proves only that the file was written. Watch a Pulse run reach
   `status: completed` in `~/.pulse/runs/`, not just `bus-fetch.py` exit 0.

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
- 2026-08-30 — **not a rotation; the aftermath of one.** `CLICKUP_API_TOKEN` had
  been rotated at some earlier date and Doppler was correct throughout, but
  Pulse's own copy in `~/pulse/config/clickup-mcp.json` was never refilled.
  `channel-steward` failed 820 consecutive runs (every 15 min, 2026-08-18 →
  08-30) on `HTTP 401`, reporting each failure into vault `inbox/bus.md`, which
  nothing reads. Found by accident during unrelated vault housekeeping; repaired
  in four minutes once looked at. Produced Phase 0b and Phase 2 step 4 above.
  Tickets: 86bbq83j0 (Pulse should read Doppler at run time, and repeated
  failures should escalate once), 86bbq88m2 (this runbook change).
