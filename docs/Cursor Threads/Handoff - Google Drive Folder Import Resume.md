# Handoff — StarCaster Google Drive Folder Import (Paused)

**Repo:** `~/WebApps/starcaster`  
**Product:** StarCaster (Alphire)  
**Thread dates:** 2026-05-22 through 2026-05-24  
**Human:** Mentor (`mentorofaio@gmail.com`)  
**Status:** **Tabled** — feature code is in repo; **OAuth token exchange still fails** on the running dev server despite repeated Playground setup. Human believes Client ID / secret / refresh token are aligned; server diagnostics disagree until `TOKEN_OK`.  
**Google Cloud project (OAuth):** `normie-496218` (console shows project name “Normia”)  
**Prior handoff (partial):** [`Handoff - StarCaster Assets Import and Drive Folder (Paused).md`](Handoff%20-%20StarCaster%20Assets%20Import%20and%20Drive%20Folder%20(Paused).md)  
**Cursor transcripts:** `924a31b7-3ad8-4c52-a91d-801fa57d4131` (May 2026 resume thread); earlier `ca2cd320-9d79-4d1f-ac81-b79f4b9933c6`  
**Canonical architecture:** [`docs/AI_AGENT_HANDOFF.md`](../AI_AGENT_HANDOFF.md)

---

## 1. Goal

**Assets → Import From Google Drive Folder:** paste a shared **folder URL** → server lists **direct-child images only** (no subfolders) → creates `assets` rows with Drive file URL as `location`, generates thumbnails + `wide` / `square` / `tall` aspect, skips duplicates by Drive file id.

**Out of scope (MVP):** recursive subfolders, progress %, non-image types, public Production OAuth verification (YouTube demo) unless shipping app broadly.

---

## 2. What is already built (do not re-implement)

| Path | Role |
|------|------|
| `lib/assetDriveFolderImport.js` | Import loop (max 100 files, 20MB/file) |
| `lib/googleDrive.js` | OAuth refresh, `listImageFilesInFolder`, `fetchDriveFileMedia`, `makeFilePublic` |
| `lib/assetStorage.js` | Thumbnail upload (Vercel Blob and/or Drive) |
| `routes/assets.js` | `handleImportDriveFolder`, `POST /api/assets/import-drive-folder` |
| `routes/index.js` | Early GET health + authenticated POST dispatch |
| `api/assets/import-drive-folder.js` | Vercel serverless entry |
| `public/js/assets.js` | Form submit → `POST` import |
| `src/pages/assets.html` | UI panel (run `npm run build:html` after edits) |
| `scripts/verify_import_drive_folder_route.js` | `npm run verify:import-drive-folder` |

**Related shipped (separate feature):** bulk **local** image import via `POST /api/assets/import-image`, `sharp` thumbnails, `aspect` column.

---

## 3. API & prerequisites

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /api/ping` | No | Sanity: `{ "app": "starcaster" }` |
| `GET /api/assets/import-drive-folder` | No | Health: `{ "registered": true, "available": true }` |
| `POST /api/assets/import-drive-folder` | Yes + project | Body: `{ folderUrl, category?, tags?, limit? }` |

**Env vars (preferred locally and on Vercel):**

```env
GOOGLE_DRIVE_CLIENT_ID=
GOOGLE_DRIVE_CLIENT_SECRET=
GOOGLE_DRIVE_REFRESH_TOKEN=
```

Optional: `GOOGLE_DRIVE_ROOT_FOLDER_NAME`, `GOOGLE_DRIVE_ASSETS_FOLDER_NAME`  
Also need thumbnail storage: `BLOB_READ_WRITE_TOKEN` (or Drive storage configured via `lib/assetStorage.js`).

**Auth:** Session cookie and/or `Authorization: Bearer` from `localStorage` key `app_session` (`public/js/core.js`). Localhost cookies use `SameSite=Lax` (`routes/auth.js`).

---

## 4. Google Cloud setup completed by human (May 24)

- **Google Auth Platform** (replaces classic “OAuth consent screen” menu in places).
- **Audience:** External app, **Testing** mode, **test user** added (`mentorofaio@gmail.com`) — restricted-scope **verification / YouTube demo** requirements went away after that.
- **Data Access:** scope `https://www.googleapis.com/auth/drive` (restricted; lock icon — OK for Testing + test users).
- **OAuth Playground:** authorize URL looked correct — `client_id=128996620975-...` (StarCaster client, **not** Playground default `407408718192`), `access_type=offline`, `prompt=consent`, scope `.../auth/drive`.
- Playground **Step 2 exchange** returned `200 OK` with `refresh_token` in response JSON (tokens sometimes disappear from Step 2 UI when opening Step 3 — copy from **Response** panel immediately).

**Settings UI note:** Google Drive does **not** appear in the **Channel Connections** table on Settings → APIs. That table is social channels only. Drive is under **Add API → Provider → Google Drive**, or env-only (env wins over file).

---

## 5. Current blocker (objective, as of last agent check)

**StarCaster dev server still cannot refresh an access token** from values in `.env`:

```text
POST https://oauth2.googleapis.com/token
HTTP 401
error: unauthorized_client
error_description: Unauthorized
```

Loaded from env: `client_id` prefix `128996620975`, refresh token length ~103, client secret length ~35.

**UI symptom:** user sees **“Bad Request”** on import — often the generic wrapper; root cause is failed OAuth in `lib/googleDrive.js` → `getAccessToken()` before any Drive API call.

**Human report:** “All secret keys and tokens and clients line up. The data is correct.”  
**Agent observation:** Playground can succeed while **`.env` still holds an old refresh token** or a **secret rotated in Console** — only the **live token POST** matters. Until the check below prints `TOKEN_OK`, folder import will not work.

---

## 6. Verification checklist (run in order)

```bash
cd ~/WebApps/starcaster
npm install
npm run verify:import-drive-folder
npm run dev   # confirm log: localhost:3001, StarCaster not Normie/Next on that port
```

| # | Check | Expected |
|---|--------|----------|
| 1 | `curl -s http://localhost:3001/api/ping` | `"app":"starcaster"` |
| 2 | `curl -s http://localhost:3001/api/assets/import-drive-folder` | `"registered":true` |
| 3 | Token script (below) | **`TOKEN_OK`** |
| 4 | Browser logged in | `GET /api/auth/me` → user JSON |
| 5 | Assets UI | `POST .../import-drive-folder` → imported rows |

**Token script (no secrets printed):**

```bash
cd ~/WebApps/starcaster
node -e "
require('dotenv').config();
const c = require('./lib/googleDrive').config();
(async () => {
  const b = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    refresh_token: c.refreshToken,
    grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: b,
  });
  const j = await r.json();
  console.log(r.ok ? 'TOKEN_OK' : ['TOKEN_FAIL', r.status, j.error, j.error_description].join(' '));
})();
"
```

---

## 7. OAuth minting procedure (reference — human has run this many times)

1. **Clients:** one OAuth 2.0 client in project `normie-496218` — note type (**Desktop** vs **Web**). For Web, redirect URI must include `https://developers.google.com/oauthplayground`.
2. **Playground gear:** “Use your own OAuth credentials” → same Client ID + secret as `.env`.
3. **Step 1:** scope `https://www.googleapis.com/auth/drive` → Authorize as **test user** account.
4. Confirm redirect `client_id=` matches `GOOGLE_DRIVE_CLIENT_ID` (not `407408718192`).
5. **Step 2:** Exchange → copy **`refresh_token`** from JSON response immediately (ignore `access_token` for `.env`).
6. Update **all three** `.env` vars + Vercel env if deploying → **restart** `npm run dev`.
7. Run token script → must be **`TOKEN_OK`** before UI import.

**If refresh token field empty:** gear Force prompt, or revoke Playground at [Google Account permissions](https://myaccount.google.com/permissions), re-authorize.

**Do not use Step 3** in Playground for StarCaster — that’s optional API playground only.

---

## 8. When “everything lines up” but token still fails — investigate these

| Hypothesis | What to check |
|------------|----------------|
| **Stale `.env`** | New Playground `refresh_token` never saved; server not restarted after edit |
| **Wrong client triple** | Refresh token minted for client A, ID/secret in `.env` for client B |
| **Rotated secret** | New secret in Cloud Console, old `GOCSPX-...` still in `.env` |
| **Env vs Settings file** | `getProviderValues` merges env over `data/api_settings.json` — conflicting old file values rarely win, but verify only one source of truth while debugging |
| **Vercel vs local** | Testing production URL while only local `.env` was updated |
| **OAuth client type** | `unauthorized_client` sometimes fixed by creating a **Desktop** OAuth client and re-minting token with that client |
| **Copy/paste** | Truncated refresh token, newline inside value, smart quotes in `.env` |
| **Multiple GCP projects** | Console on `normie-496218` but credentials from another project’s client |

**Suggested multi-day deep dive (for next agent):**

1. Add `npm run diagnose:google-drive` script wrapping token POST + masked diagnostics (`getProviderCredentialDiagnostics('google_drive')`) — surface `error` / `error_description` in UI toast, not only “Bad Request”.
2. Try a **fresh Desktop OAuth client** used only for StarCaster; mint token once; document client id in handoff (prefix only).
3. Consider **service account** + folder shared to service account email (different architecture; bypasses user refresh token).
4. Narrow scope experiment: `drive.readonly` only if willing to disable `makeFilePublic` in `assetDriveFolderImport.js` temporarily.

---

## 9. StarCaster vs Normie

| | StarCaster | Normie |
|---|------------|--------|
| Path | `~/WebApps/starcaster` | `~/WebApps/normie` |
| Port (typical) | **3001** | 3000 |
| This feature | ✅ | ❌ |
| OAuth project used | `normie-496218` (naming is confusing but intentional) | separate app |

Always confirm `curl .../api/ping` returns `"starcaster"` before debugging Drive.

---

## 10. Success criteria (resume definition of done)

- [ ] Token script prints **`TOKEN_OK`**
- [ ] `POST /api/assets/import-drive-folder` with test folder returns `imported > 0`
- [ ] Assets table shows new rows with Drive `location` URLs
- [ ] Thumbnails present when Blob/Drive storage configured
- [ ] Optional: commit/deploy all files in §2; Vercel env vars match local

---

## 11. Paste-ready prompt for a new Cursor thread

```text
Resume StarCaster Google Drive folder import (tabled May 2026).

Read: docs/Cursor Threads/Handoff - Google Drive Folder Import Resume.md

Workspace: ~/WebApps/starcaster, npm run dev on port 3001.

Goal: get TOKEN_OK from GOOGLE_DRIVE_* env vars, then smoke-test Assets → Import From Google Drive Folder.

Start by running the token script in the handoff. If unauthorized_client persists, try Desktop OAuth client + new refresh token, improve error surfacing (not generic Bad Request), then end-to-end folder import.

Do not work in Normie repo. Human: mentorofaio@gmail.com is OAuth test user; GCP project normie-496218.
```

---

## 12. Git / deploy reminder

Ensure these exist on branch before Vercel deploy:

- `lib/assetDriveFolderImport.js`
- `api/assets/import-drive-folder.js`
- `routes/assets.js`, `routes/index.js`
- `public/js/assets.js`, `src/pages/assets.html` (+ `npm run build:html`)

Set `GOOGLE_DRIVE_*` in Vercel project env; redeploy after changes.

---

*End of handoff. Feature is **code-complete**; **OAuth refresh to Google** is the remaining gate. Bulk local image import works independently.*
