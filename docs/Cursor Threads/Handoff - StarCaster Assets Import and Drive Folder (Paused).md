# Handoff — StarCaster Assets Import and Google Drive Folder (Paused)

**Repo:** `~/WebApps/starcaster`  
**Product:** StarCaster (Alphire)  
**Thread date:** 2026-05-22 / 2026-05-23  
**Human:** Mentor  
**Status at thread end:** **Google Drive folder import tabled (not priority).** Human switching back to **Normie** in a new thread.  
**Cursor transcript:** `ca2cd320-9d79-4d1f-ac81-b79f4b9933c6` (parent workspace may show Normie path — work below is **StarCaster**)

**Canonical technical doc:** [`docs/AI_AGENT_HANDOFF.md`](../AI_AGENT_HANDOFF.md)

---

## 1. What this thread was about

| Area | Outcome |
|------|---------|
| **Repo mix-ups** | Human runs **StarCaster on port 3001** and **Normie** separately; easy to run commands or open migrations in the wrong repo. Always confirm path before `npm`, SQL, or API tests. |
| **Bulk image import (browser)** | **Shipped in repo** — multi-file upload on Assets → generates thumbnails + assigns `wide` / `square` / `tall` aspect via `POST /api/assets/import-image` (sequential per file in UI). |
| **Asset `aspect` column** | Migration `supabase/migrations/20260523120000_assets_aspect.sql` (duplicate in `docs/SQL/assets_aspect.sql`). **Apply in StarCaster Supabase**, not Normie. |
| **Google Drive folder import (MVP)** | **Code written, not validated end-to-end** by human. UI + API + lib; debugging hit **404** (stale server / undeployed files) and **401 Not authenticated** (localhost cookie + session issues). **Parked** at human request. |
| **Normie poll `collection`** | Mentioned in conversation summary from earlier context — lives in **Normie** (`normie/supabase/migrations/016_poll_collection.sql`), not this thread’s main focus. |

---

## 2. Do not confuse: StarCaster vs Normie

| | **StarCaster** | **Normie** |
|---|----------------|------------|
| **Path** | `~/WebApps/starcaster` | `~/WebApps/normie` |
| **Stack** | Vanilla JS SPA + `routes/index.js` | Next.js 15 App Router |
| **Local port (human)** | **3001** (`PORT` in `.env`) | Often 3000 |
| **This thread’s assets/Drive work** | ✅ Here | ❌ Not here |
| **Aspect migration path** | `starcaster/supabase/migrations/20260523120000_assets_aspect.sql` | Does not exist in Normie |

---

## 3. Completed / in repo (StarCaster assets)

### Bulk image import (local upload)

- **UI:** `src/pages/assets.html` — panel **“Bulk Import Images”** (rebuild: `npm run build:html`).
- **Client:** `public/js/assets.js` — `importImageFile()`, progress bar; single Image upload also uses import pipeline when file is an image.
- **Server:** `lib/assetImageImport.js`, `lib/assetThumbnail.js` (sharp + macOS `sips` fallback), `lib/assetImageDimensions.js`.
- **API:** `POST /api/assets/import-image`, `POST /api/assets/bulk-import-images` (up to 40 files) in `routes/assets.js`.
- **Dependency:** `sharp` added to `package.json` — run `npm install` in StarCaster after pull.

### Asset aspect (gallery / picker)

- **Lib:** `lib/assetAspect.js`, `public/js/assetAspect.js`, `public/js/assetPicker.js`.
- **Store:** `lib/assetsStore.js` sets/recomputes aspect on create/update.
- **UI:** Develop/messaging pickers group by aspect (wide / square / tall) with column grids.

### Channels (earlier in same arc)

- Platform field, two-column Channels page, clone channel action — see `channels.html`, `public/js/channels.js` if continuing Engage work.

---

## 4. Google Drive folder import — parked (incomplete ops)

**Intent:** Paste a Drive **folder URL** → server lists images in that folder (non-recursive) → register existing Drive files in `assets`, thumbnails + aspect, skip duplicates by Drive file id.

### Files added/changed (verify all are committed before deploy)

| Path | Role |
|------|------|
| `lib/assetDriveFolderImport.js` | Core import loop |
| `lib/googleDrive.js` | `extractDriveFolderIdFromUrl`, `listImageFilesInFolder`, `getFolderMetadataById` |
| `routes/assets.js` | `handleImportDriveFolderPost`, early path match |
| `routes/index.js` | Early dispatch + public GET health (later revisions) |
| `api/assets/import-drive-folder.js` | Dedicated Vercel entry (not a Finder “folder” — see §6) |
| `public/js/assets.js` | Form **Import From Google Drive Folder** |
| `src/pages/assets.html` | Same (run `npm run build:html`) |
| `scripts/verify_import_drive_folder_route.js` | `npm run verify:import-drive-folder` |

### API

- `POST /api/assets/import-drive-folder` — body: `{ folderUrl, category?, tags?, limit? }` (requires auth).
- `GET /api/assets/import-drive-folder` — health JSON when latest `routes/index.js` is running (intended public in late thread edits).
- `GET /api/ping` — added as no-auth sanity check in late thread edits.

### Limits (MVP)

- Direct children only (no subfolders).
- Max **100** images per request; max **20MB** per file.
- Google account behind **Settings → APIs → Google Drive** must read the folder.

### What went wrong in testing (unresolved)

1. **`API route not found: POST /api/assets/import-drive-folder`** — Running server or Vercel deployment did not include new `routes/assets.js` / `api/assets/import-drive-folder.js`. Fix: restart `npm run dev` in **starcaster**; commit all files; redeploy.
2. **`Not authenticated` on GET health / `/api/auth/me`** — Session cookies were set with `Secure` + `SameSite=None`, which browsers **drop on `http://localhost:3001`**. Thread attempted fixes:
   - `routes/auth.js` — localhost cookies use `SameSite=Lax` without `Secure`.
   - Login/register return `sessionToken` in JSON; `public/js/core.js` stores `app_session` in **localStorage** and sends `Authorization: Bearer` on `App.api`.
   - Human may still need **logout → hard refresh (Cmd+Shift+R) → login** after pulling latest JS.
3. **Finder confusion** — `api/assets/import-drive-folder.js` is **source code**, not something you `curl` as a path. The URL is `http://localhost:3001/api/assets/import-drive-folder` while **`npm run dev` is running**.

### Human decision

> Table Drive import; not a priority. Continue on **Normie** in a new thread.

**Next agent resuming Drive work:** Start with §6 verification checklist, then folder import UX — do not assume auth or routing works until `/api/ping` and POST import succeed on **port 3001**.

---

## 5. Where to start (next agent)

### If resuming **StarCaster** Drive import

1. Workspace: **`~/WebApps/starcaster`**
2. `npm install` (sharp), `npm run verify:import-drive-folder`, `npm run dev`
3. Confirm log: `Listening on http://localhost:3001` and `/api/assets/import-drive-folder registered`
4. Browser (no login): `http://localhost:3001/api/ping` → `{ "ok": true, ... }`
5. Log in on app → `http://localhost:3001/api/auth/me` → user JSON
6. Assets → **Import From Google Drive Folder**

### If human said **Normie** (current priority)

1. Workspace: **`~/WebApps/normie`** — **ignore** StarCaster Assets/Drive unless asked.
2. Read Normie `.cursorrules` and any `normie/docs/Cursor Threads/*.md` handoffs.
3. Do **not** run StarCaster SQL migrations in Normie Supabase.

---

## 6. Verification checklist (Drive import resume)

```bash
cd ~/WebApps/starcaster
npm run verify:import-drive-folder   # module + exports
npm run dev                          # PORT from .env, often 3001
```

| Check | URL / action | Expected |
|-------|----------------|----------|
| Server up | Terminal log | `localhost:3001` |
| Public ping | `http://localhost:3001/api/ping` | `"ok": true` |
| Route health | `http://localhost:3001/api/assets/import-drive-folder` | `"registered": true` |
| Session | Login → `http://localhost:3001/api/auth/me` | User object, not `AUTH_REQUIRED` |
| LocalStorage | DevTools → Application | Key `app_session` after login |
| Import | Assets UI | POST succeeds, rows in table |

**Terminal:** use `curl -s http://localhost:3001/api/ping` — not a shell command named `GET`.

---

## 7. Key implementation notes

- **Module settings:** `Record<string, string>` in Normie builder; StarCaster assets use Supabase rows + `assetsStore`.
- **Thumbnail pipeline:** Full image stays on Drive (folder import) or storage provider (upload import); thumbnail via `uploadAssetFile` → often Vercel Blob or Drive **Asset Thumbnail** category.
- **Duplicate skip:** `assetDriveFolderImport.js` builds Set of Drive ids from existing `location` / `thumbnail_location`.
- **Route registration:** `routes/index.js` loops `ROUTE_MODULES`; assets manifest prefixes `/api/assets`. Explicit `api/assets/import-drive-folder.js` + early handler in `index.js` added to survive catch-all / stale-module issues.

---

## 8. Git / deploy reminder

At thread end, some files may still be **uncommitted** (e.g. `lib/assetDriveFolderImport.js` was untracked in one check). Before Vercel deploy, ensure:

- `lib/assetDriveFolderImport.js`
- `api/assets/import-drive-folder.js`
- `routes/assets.js`, `routes/index.js`, `routes/auth.js`
- `public/js/assets.js`, `public/js/core.js`, `public/js/auth.js`
- `src/pages/assets.html` + rebuilt `public/index.html`

---

## 9. Related docs

| Doc | Use |
|-----|-----|
| [`docs/AI_AGENT_HANDOFF.md`](../AI_AGENT_HANDOFF.md) | Architecture, routes, Top Ten |
| [`Handoff - Alphire Starcaster orientation.md`](Handoff%20-%20Alphire%20Starcaster%20orientation.md) | Platform orientation, multitenancy |
| Normie: `~/WebApps/normie/docs/Cursor Threads/` | Separate product handoffs |

---

## 10. Suggested next threads

| Thread | Repo | Focus |
|--------|------|--------|
| **Normie (human priority)** | normie | Whatever Mentor opens next — **not** Drive import |
| **Drive import finish** | starcaster | §6 checklist → auth → one folder smoke test → commit/deploy |
| **Assets without Drive** | starcaster | Bulk upload only; run `assets:thumbnails:apply` backfill if needed |

---

*End of thread handoff. Google Drive folder import is **paused**; bulk browser image import and aspect column are the stable shipped pieces in this arc.*
