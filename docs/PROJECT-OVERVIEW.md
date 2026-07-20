# StarCaster — Project Overview

*A web-presence and audience-growth platform for creators and small
organizations.* StarCaster (by **Alphire**) is the control room from which an
operator builds and hosts a client's public website, runs their content and
messaging, grows their audience across the social web, and manages the
relationships that result — all from one place, with each client kept in its
own isolated workspace.

Unlike a single-site product, StarCaster is **multi-tenant**: one operator
runs many clients ("projects"), each with its own published site on its own
custom domain, its own contacts and content, and its own social-channel
connections. The first live tenant site is **benvin.org** (Marinoff &
Associates); the platform itself runs on Node + Supabase, deployed on Vercel.

StarCaster works on three levels, from the operator's control room down to
what a client's visitors actually see:

```
┌────────────────────────────────────────────────────────┐
│  OPERATOR PLATFORM     (Alphire runs everything)        │
│  builder · messaging · acquire · promote · contacts/CRM │
├────────────────────────────────────────────────────────┤
│  TENANT WORKSPACES     (one per client / project)       │
│  scoped content · contacts · site · social credentials  │
├────────────────────────────────────────────────────────┤
│  PUBLIC TENANT SITES   (each client's own visitors)     │
│  custom-domain sites · blog · forms · polls · sharing   │
└────────────────────────────────────────────────────────┘
```

---

## Level 1 — Public Tenant Sites

What a client's visitors see, no account required — each on its own custom
domain, indistinguishable from a bespoke website.

- **Custom-domain hosting** — a published project serves its pages at its own
  domain (e.g. benvin.org). The platform resolves the incoming domain to the
  right tenant and renders that tenant's site; system domains and tenant
  domains are cleanly separated.
- **Builder-composed pages** — nothing is hard-coded. Every page — homepage,
  navigation, headers, footers — is composed in the visual Builder and
  rendered live, with per-tenant themes (fonts, colors, backgrounds,
  spacing).
- **Blog** — a full publishing system per tenant: posts, categories, tags,
  related posts, table of contents, search, newsletter signup, and per-post
  SEO/OpenGraph metadata.
- **Lead capture** — embeddable CRM forms and contact forms drop onto any
  page; submissions flow straight into that tenant's contact records.
- **Interactive modules** — polls, galleries, social-share buttons, code
  embeds, and playful touches (floating images, confetti, speech bubbles)
  can be placed on any page.
- **Tenant admin entry** — a project can expose its own lightweight
  admin/login modules, so a client can be given scoped access to their own
  site's content without touching the operator platform.

---

## Level 2 — Tenant Workspaces

The isolation layer that makes one platform safely serve many clients. Every
piece of tenant data carries a project id and is scoped to it — one client can
never see another's contacts, content, site, or credentials.

- **Projects** — the operator creates and switches between client workspaces;
  the active project scopes everything on screen.
- **Project membership & admins** — projects can have their own admin users
  and an invitation flow, distinct from the platform operators.
- **Per-tenant everything** — contacts, messaging content, builder pages,
  blog, CRM field configuration, and social-channel credentials all live
  inside the project boundary. Uniqueness (emails, slugs) is per-project, not
  global.
- **Encrypted channel credentials** — each project's connected social
  accounts are stored with their secrets encrypted at rest.

---

## Level 3 — The Operator Platform

The admin control room where Alphire runs the whole operation. Organized into
a handful of working areas:

### Build & publish
- **Builder** (`develop` in code) — the largest surface: a visual page and
  email builder made of rows, columns, and dozens of module types (headings,
  rich text, buttons, images, galleries, navigation, headline rotators,
  tables, forms, blog blocks, poll blocks, social icons, code embeds, and
  more). Full design control per section/cell/module — backgrounds, borders,
  padding, margins, shadows, alignment — all responsive, with browser/mobile/
  email preview.
- **Themes** — per-tenant typography and color systems resolved through CSS
  variables, so a whole site restyles from one place.
- **Reusable library** — save any module or section and reinsert it anywhere;
  clone anything in place.
- **Blog workspace** — authoring with the rich-text editor, taxonomy, SEO,
  and publish workflow, per tenant.

### Content operations
- **Messaging** — the content factory: topics, headlines, subheadings,
  taglines, posts, tweets, hashtags, CTAs, pitches, articles, e-books, white
  papers, reports, and more — each a managed, reusable content type with AI
  assistance.
- **Campaigns** — assemble messaging and assets into coordinated pushes.

### Audience growth
- **Acquire** — harvest signal from the social web: YouTube, X, Reddit, and
  general web sources — pulling comments, videos, and content to mine for
  audience and ideas (rate-limited, since these hit external services).
- **Promote / Engage** — publish and schedule social posts, run
  comment-engagement agents, and push content out through connected channels;
  scheduled publishing runs on a timed job.
- **Channels** — the connected social accounts (organic and credentialed)
  each tenant posts through.

### Relationships
- **Contacts, Segments & Campaigns** — the people directory: personnel
  records, segmentation, and personas.
- **CRM** — per-project custom field configuration plus the contact records
  captured by embeddable forms.

### Intelligence & assets
- **Ask Roger** — an in-platform development/assistant agent.
- **Digital Clone Engine** (personas) — persona modeling used to shape
  content voice.
- **Assets** — the media library, with import from Google Drive and storage
  in Vercel Blob.
- **Community Assets** — shared, reusable media across projects.

### Operations
- **Observe** — usage logs and page-view analytics per project.
- **Project Admin / Settings** — configuration, API providers, and the
  OpenClaw gateway.
- **Polls, Training, Activity Log, Platform Screenshots** — supporting tools
  for QA, tuning, and record-keeping.

---

## Under the hood (one paragraph for the curious)

Node.js on Vercel, with a single shared request dispatcher (`routes/index.js`)
behind both the local dev server and the serverless entry; Supabase (Postgres)
for all data. The admin is mid-migration from a frozen vanilla-JS app
(`public/js/`) to a React/TypeScript Builder (`components/` +
`lib/builder-client/`); published tenant sites are rendered from Builder
documents. The codebase is undergoing a phased, ground-up engineering overhaul
(2026): production database migrated to a dedicated account, all credentials
rotated, build artifacts removed from source control, CI-gated merges
(typecheck, tests, full build, convention checks) with branch protection now
enforced on `main`, and a Docker-based local Supabase stack isolated from
production. The roadmap and engineering record live in
`docs/FABLE_OVERHAUL_PLAN.md` and the `CLAUDE.md` files.

## Tenant data isolation

StarCaster serves many clients from one platform, so **isolation is a
first-class rule, not an afterthought**. Every tenant-scoped record carries a
`project_id` and is filtered to it on every read and write; secrets are
encrypted at rest; and database-level row protection is being added as
defense-in-depth so that one tenant's data can never surface in another's
workspace or site.
