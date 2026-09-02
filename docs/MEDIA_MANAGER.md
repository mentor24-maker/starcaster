# Media Manager

Built 2026-09-01/02 across nine tickets (86bbrnz1t … 86bbrvk01). This is the
model it rests on and the traps it produced. Read the first section before
touching anything called a "media manager" — three tickets were built against
the wrong surface because that phrase points at two different things.

---

## 1. There are TWO media surfaces, and their names do not distinguish them

| | Platform Assets screen | Media Manager module |
|---|---|---|
| Where | `starcaster.pro` admin app | a tenant's own site, e.g. `delraytennis.starcaster.pro/admin-media-manager` |
| Who uses it | Dane | a **tenant admin** — Rich at Delray |
| Built from | vanilla JS, `public/js/assets.js` + `assetImageEditor.js` (frozen tree) | React, `MediaManagerPreview` in `components/builder-template-preview.tsx` |
| Session | platform `app_session` | **project-admin** session |
| Reached by | the Assets nav entry | a Builder page carrying the `media-manager` module |

**They share the `assets` table and nothing else.** Neither one's code loads on
the other's page. `public/js/` never reaches a tenant site.

**The incident.** Asked for "a Media Manager that lets Admin users upload
photos and video", the first three tickets improved the *platform Assets
screen* — mirror in the image editor, video upload, a source column. The
operator then asked where the module was and pointed at
`delraytennis.starcaster.pro/admin-media-manager`. Two of those three tickets
were work on a surface the tenant will never see. The `source` column survived
because the module uses it.

**Before building anything here, answer: whose screen is this?** If the answer
is a tenant's, it is a Builder module and `public/js/` is irrelevant.

---

## 2. The data

Everything the module shows lives on rows the platform screen also writes.
There is one gallery, not two.

| Thing | Where | Added |
|---|---|---|
| The file | `assets` (`asset_name`, `asset_type`, `location`, `size`, `aspect`, `category`, `tags`) | pre-existing |
| How it arrived | `assets.source` | `docs/SQL/assets_source_column.sql`, 2026-09-01 |
| The project's tag list | `asset_tags` | `docs/SQL/asset_tags_setup.sql`, 2026-09-01 |
| The project's categories | `asset_categories` | pre-existing |
| Aspect | `assets.aspect` — `wide` / `square` / `tall`, per the check constraint | pre-existing |

### `assets.source` is client-declared, not stamped per endpoint

The value (`'admin-media-manager'`) is sent by the client and validated against
an allowlist in `lib/assetSource.js`.

That looks backwards until you see why: the two upload endpoints the Assets
screen uses — `/api/assets/import-image` and `/api/assets/upload-google-drive`
— are **shared with the Builder and the asset picker**. Stamping by endpoint
would label a Builder upload as a Media Manager one. An unrecognised value
normalizes to `''` rather than being stored, because one typo'd variant makes
the filter quietly incomplete.

Existing rows were deliberately **not backfilled**. `''` means "origin not
recorded", which is the truth.

### `asset_tags` is a registry, not the tags themselves

Per-asset tags were always `assets.tags` (a `text[]`). What did not exist was
a way to answer *which tags does this project use?* without scanning every
row — so the tag modal had nothing to offer as a choice.

`POST /api/asset-tags` on an existing tag **returns the existing row (200)**
rather than 409. Two admins typing "Courts" on the same afternoon is normal
use, not a conflict, and a modal that errors on it teaches people to avoid the
feature. Uniqueness is per project and case-insensitive.

Deleting a tag from the registry does **not** strip it from assets carrying
it. Rewriting rows across a project is not what "remove this from the list"
means.

**The Tag filter offers the registry PLUS any tag actually on a file.**
Registry-only was the first version and the browser check caught it: a tag can
reach an asset without the registry (rows predating it, or anything tagged from
the platform screen), and those tags render on the cards. A tag you can *see*
but cannot filter by is worse than no filter. `/api/asset-categories` already
merged registry-and-in-use for categories; the two now behave the same.

---

## 3. Auth: which endpoints a tenant admin gets

`lib/projectAdminApiAuth.js` is a **deny-list**. Everything under `/api/` is
reachable by a project-admin session unless it is named there — so
`/api/assets` was already open to tenant admins before anything was built,
nobody had decided it, and no test said so either way (86bbrqnqu).

**The line is whose resources get spent, not whose data gets touched.** A
tenant admin managing their own media is the feature; a tenant admin spending
Alphire's model budget is not. Denied, each with its reason in the code:

| Denied | Why |
|---|---|
| `/api/assets/generate` (+ status, cancel) | AI generation, billed per call, no tenant cap |
| `/api/assets/video/` | stock search on one shared platform quota |
| `/api/assets/upload-google-drive`, `/import-drive-folder`, `/drive-file/` | Alphire's own Drive, Alphire's credentials |
| `/api/assets/bulk-resize` | platform CPU, per asset, unbounded |
| `/api/assets/import-from-fields` | platform marketing tooling |

**Tenant isolation is not in the deny-list.** It comes from
`requireProjectContext` refusing an asset request carrying no project, because
`scopedListQuery` returns an **unscoped** query when the scope has no
`projectId` — which would be every project's assets. Both halves are pinned in
`scripts/builder/assetTenantAdminAuth.test.js`.

---

## 4. Uploads

| File | Path | Why |
|---|---|---|
| Image under ~6MB | `POST /api/assets/import-image` | generates a thumbnail on the way in |
| Video, or anything larger | Vercel Blob multipart → `POST /api/assets` | no base64 ceiling |

The Blob client is fetched **from a CDN at runtime**, the same way
`public/js/assets.js` does it, so the builder bundle does not carry the SDK and
a tenant page can still upload video.

Every upload declares `source: 'admin-media-manager'`.

---

## 5. What is deliberately not here

**Crop, resize and mirror.** The editor is `public/js/assetImageEditor.js` —
vanilla JS that never loads on a tenant site — so editing in the module means
rebuilding it in React, roughly as much work again. Agreed with the operator
as a follow-up, 2026-09-01. The platform screen has all three (mirror added by
#500).

---

## 6. Traps

1. **Landmine 1 applies.** `media-manager` is registered in
   `builder-template.ts` twice — the type list *and* `normalizeModuleType`.
   Miss the second and the server coerces the module to `"text"` on every page
   load, taking its settings with it. `npm run build:builder-template` after
   either edit. `lib/builder-client/media-manager-module.test.ts` sweeps all
   72 palette modules for this.

2. **A palette group must be declared.** Filing the module under a `group`
   that is not in `modulePaletteGroups` renders no card — the module exists and
   is unreachable, which is how this whole feature started. It is filed under
   **`admin`**, beside Team Users and Site Settings, because the operator went
   looking for the Event Manager under Admin and found it under Events.

3. **`/api/assets/:id` takes PATCH and DELETE. There is no PUT.** A PUT falls
   through unmatched and silently does nothing — see DOCTRINE §5.20, which is
   the incident this produced.

4. **A new endpoint needs BOTH reachability guards.** `routes/assets.js`
   returns false for any path outside its own prefixes, and the dispatcher
   manifest keeps a second list. Miss either and the endpoint is written,
   unit-tested and unreachable over HTTP.

5. **`/api/asset-categories` returns one entry per (assetType, category)
   pair.** An undeduplicated select lists the same category once per type it
   is used on.

6. **The two emptinesses.** "No media yet" and "No files match these filters"
   are different sentences and must stay that way — conflating them tells an
   operator their library is gone. The count carries the same duty: `2 of 40
   files` while filtering, never a bare `2 files`.

7. **Nothing tests CSS here.** The delete-confirmation buttons were white text
   on a transparent background — invisible — from #506 until #510, and were
   found by photographing the tag modal, not by any gate. See DOCTRINE §3.17
   for what `check:panels` does *not* cover on this module's settings panel.

---

## 7. Still open

- **No page exists.** The module is built; a Builder page with slug
  `admin-media-manager` has to be created for the Delray project, the module
  placed on it, and published. Configuration, not code.
- **The settings panel has never been seen rendered** by anyone. See
  DOCTRINE §3.17.
