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

**Reading the audit log is not a metadata read.** `doppler activity` and
`doppler secrets --only-names` answer *who changed what, when* without values,
and an agent may run both. `doppler configs logs get <id>` looks like the next
step in that same sequence — it is how you find out *which key* a "1 updated"
entry refers to — and it prints the **old and new values in plain text**. That
is a live credential handed to whoever ran the command, agent sessions included
(§4.1 / vault `OPERATIONS.md` SOP 6), and it happened on 2026-08-30 while
diagnosing the entry logged below.

If you need the key name and you are not the operator, stop at `doppler
activity` and say what you could not determine. The correlation is usually
enough: a config changed at a known minute, and a specific job started failing
at that minute, identifies the credential without anyone reading it.

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

**There are TWO ClickUp credentials, and they are not interchangeable.** The
ClickUp API embeds the account id in the token, so the identity is readable at a
glance: `pk_48012725_…` is **Dane**, `pk_54254347_…` is **Pulse**. Which account
a write came from is load-bearing — `mergeDecision` reads it to decide whether a
"merge" comment is the operator's authorization, and the bus relay and the
loop-review collision guard both tell operator comments from machine comments by
author. A Pulse write arriving as Dane reads as the operator having spoken.

| Credential | Identity | Second home | Refill with |
|---|---|---|---|
| `CLICKUP_API_TOKEN` | **Dane**, `48012725` | GitHub Actions secret `CLICKUP_API_TOKEN` on `mentor24-maker/starcaster` (the review gate reads it) | `doppler secrets get CLICKUP_API_TOKEN --plain --project starcaster --config dev --silent \| gh secret set CLICKUP_API_TOKEN --repo mentor24-maker/starcaster` |
| `PULSE_CLICKUP_API_TOKEN` | **Pulse**, `54254347` | `~/pulse/config/clickup-mcp.json` (gitignored) → `mcpServers.clickup.env.CLICKUP_API_KEY` | `cd ~/pulse && doppler run --project starcaster --config dev -- python3 bin/restore-clickup-token.py` |

`restore-clickup-token.py` reads **`PULSE_CLICKUP_API_TOKEN`**, never the bare
`CLICKUP_API_TOKEN`. That is the whole point of the second name: the two cannot
be typed for one another. It refuses outright (exit 2) if the token it is about
to write belongs to a different account than the one already in the file, naming
both ids, and only `--force` overrides — because the failure is silent and
unreadable after the fact.

Both refill commands move a value between two stores without rendering it, so an
agent may run them (DOCTRINE §4.1). **`doppler secrets set` and `doppler secrets
delete` PRINT what they wrote or what remains** — they are the wrong side of that
line, and `--silent` does not suppress the secrets table. Put Doppler on the
`get` side of a pipe, never the `set` side; a value that has to be *entered* goes
in through the dashboard, by Dane.

### What went wrong here once (2026-08-31 → 09-01)

This table said `CLICKUP_API_TOKEN`'s second home was Pulse's config file. They
were never the same credential, so the documented refill **overwrote Pulse's
token with Dane's**, and it happened before anyone disarmed it: on 2026-09-01
Pulse's config was measured holding `pk_48012725_` — Dane's — so Pulse had been
acting as him. The mirror image was on the Mac Mini, whose
`~/WebApps/starcaster/.env.local` set **`CLICKUP_API_TOKEN`** to **Pulse's**
token, where every other reader of that name means Dane. Both are fixed; the
Mini's line was removed so it falls back to Doppler like everything else there.

The lesson is the row shape above: **a copies table row names the identity, not
just the variable.** Two credentials that share a service, a token format and
half a name are one careless refill apart from becoming each other.

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
- 2026-08-30, 20:39 — **a real rotation of `CLICKUP_API_TOKEN`**, by Dane, in
  Doppler `dev` and `prd`. Everything that talks to ClickUp stopped at once on
  both machines with `401 Invalid API key` — the bus relay (every ten minutes),
  the loops, and every ticket write.

  Two things this confirmed, one good and one not.

  **Phase 0b works.** `~/pulse/config/clickup-mcp.json` was stale again — the
  identical gap that cost 820 consecutive failed runs over twelve days — but
  this time the table named the copy, `bin/restore-clickup-token.py` refilled it
  without anyone handling the value, and `channel-steward` was verified running
  to `completed` inside the hour. The table earned its place; the refill still
  is not automatic, which is what 86bbq83j0 is for.

  **The alert cannot report its own dependency failing.** `bus-relay` failed
  every ten minutes throughout and could not say so, because
  `scripts/report_job_failure.mjs` posts through the same token. That residual
  is named in the script's header and was documented as known on 86bbhbadj the
  same afternoon; this is its first live occurrence. It degraded correctly — the
  log recorded every failure and the reporter deliberately did not stamp them as
  sent — but the operator learned of the outage from an agent session, not from
  the system. The heartbeat (`npm run heartbeat`) closes the machine-is-off half
  of this; it does not close the token-is-dead half, because it shares the
  token too. A genuinely independent channel is the open question.

  Keys rotated: `CLICKUP_API_TOKEN`. Copies refilled: Pulse (above). Tickets:
  86bbq8v0w (this entry).
