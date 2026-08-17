# Scaffolding a tenant's admin back-end

**Shipped:** 2026-08-16, building Delray Beach Tennis Center's admin area.

A tenant "admin back-end" is not a separate application. It is a handful of
ordinary Builder pages whose slug starts with `admin-`, built out of the
`admin-*` modules, wearing the tenant's own header and footer. The slug is the
gate: `lib/builder-client/public-site-page-slugs.js` treats `admin` and
`admin-*` as private, so those pages are served only through
`GET /api/public/admin-pages`, which requires a project-admin session.

`admin-login` is the one deliberate exception. It is listed in
`PUBLIC_SITE_SLUG_OVERRIDES` and stays publicly reachable, because it is the
front door — a signed-out visitor is the only person who ever sees it.

## What "Coming soon" actually means

Nothing is broken when a tenant's `/admin-login` shows "Coming soon". That text
is the public site's no-such-page fallback
([`components/BuilderPublicSitePage.tsx`](../components/BuilderPublicSitePage.tsx)).
It means the project has no page with that slug.

Delray hit this on 2026-08-16 with 131 pages, a live domain, two working admin
accounts created 8/12 — and zero `admin-*` pages. Every piece of plumbing was
in place; nobody had built the pages. Marinoff's six had been hand-built in
July and never generalised.

## The model

Mapped from Marinoff production, 2026-08-16:

| Page | Private | Chrome | Body |
|---|---|---|---|
| `admin-login` | no | public header | `admin-login` |
| `admin-dashboard` | yes | Admin Header | `admin-team-users` |
| `admin-blog-manager` | yes | Admin Header | `blog-post-create`, `blog-post-manager`, `blog-category-manager` |
| `admin-contact-manager` | yes | Admin Header | `crm-contacts-table` |
| `admin-settings` | yes | Admin Header | `admin-site-settings` |
| `admin-support` | yes | Admin Header | `admin-support-form` |

**The Admin Header** is a saved section created once per project, from the
project's own menu-bearing header section. It keeps the tenant's design — the
background, layout, spacing, logo — and changes three things: the navigation
module lists the admin pages, the visitor-facing calls to action are dropped
(Delray's "Book a Court" and "Register"; Marinoff's language switcher and
social row), and a Logout link is added.

It is found by content, not by name — "the frame section containing a
`navigation` module". Marinoff calls its header "Header"; Delray splits chrome
into "1 - Contact Strip" and "2 - Menu Banner". Matching on names would have
worked for one tenant, failed for the other, and failed *silently* for the
third.

## Running it

```
# see what it would do — this is the default, it writes nothing
node scripts/scaffold_project_admin_area.mjs --project proj_xxx

# do it
node scripts/scaffold_project_admin_area.mjs --project proj_xxx --apply

# just one or two pages
node scripts/scaffold_project_admin_area.mjs --project proj_xxx --only admin-login,admin-dashboard
```

Against production, run it through Doppler so it uses the production keys:

```
doppler run --project starcaster --config prd -- node scripts/scaffold_project_admin_area.mjs --project proj_xxx
```

## Why the logic lives in a library

All of it is in [`lib/projectAdminScaffold.js`](../lib/projectAdminScaffold.js);
the script is a thin handle on it. That split is deliberate: the intended end
state is that **creating the first admin user for a project scaffolds the area
automatically**, so a tenant can never again end up with working credentials
and no door to use them on. When that lands, `routes/projectAdmin.js` calls
`scaffoldProjectAdminArea()` and nothing else changes.

That is also why the safety properties are in the library rather than the CLI:

- **It never edits an existing page.** A slug that already exists is skipped
  and reported. A re-run creates nothing. This is what makes it safe to hang
  off an event that may fire more than once.
- **It never saves a saved-section master.** It creates canonical section
  *instances* pointing at existing masters. Saving a master rewrites every page
  linked to it — that is what lost the Marinoff menu on 2026-07-21.
- **The menu lists only pages that will exist.** A project without the blog
  module gets no blog manager, and the menu drops that item with it. A menu
  item pointing at a page nobody created lands the tenant on "Coming soon"
  inside their own admin area, which is the failure this whole thing exists to
  remove.
- **Dry run is the default.** `--apply` is required to write.

## What it does not do

- **It does not create admin users.** Those live in
  `app_project_admin_users` and are managed from the platform, or from the
  tenant's own `admin-dashboard` once it exists.
- **It does not style anything.** The pages come out functional and wearing the
  site's chrome. Layout beyond that is Builder work.
- **It does not publish.** Nothing needs it to: no project in production uses
  `builder_published_pages` yet, and every site renders from its draft. The
  pages are live the moment they are written.

## Verifying a run

The insert reporting success proves neither that the tenant was stamped nor
that the sections landed (CLAUDE.md landmines 12 and 13). After `--apply`,
read the rows back and check `project_id`, `owner_user_id`, a non-empty
sections array, and that no module came back as `text` — a module type the
server does not know is coerced to `"text"` on every page load, silently.

`scripts/builder/projectAdminScaffold.test.js` guards the last of those at
build time: it walks every module type the scaffold can emit and asserts
`normalizeModuleType` returns it unchanged.

Then open the page. Nothing in this repo tests rendering.
