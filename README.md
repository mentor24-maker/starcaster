# StarCaster

**StarCaster** by [Alphire](https://alphi.re) — a multi-tenant platform for influencers, content creators, and communities building organic followings through social engagement (comments, replies, likes, shares) and integrated promotion workflows.

**Repository:** `~/WebApps/starcaster`

## Quick start

```bash
npm install
cp .env.example .env   # set SUPABASE_URL, SUPABASE_SERVICE_KEY, CHANNELS_ENCRYPTION_KEY
npm run dev            # http://localhost:3000
```

## Documentation (agents & developers)

| Document | Purpose |
|----------|---------|
| [`docs/AI_AGENT_HANDOFF.md`](docs/AI_AGENT_HANDOFF.md) | **Canonical** architecture, domains, conventions |
| [`.cursorrules`](.cursorrules) | Cursor agent rules + compiled UI standards |
| [`docs/UI_STANDARDS.md`](docs/UI_STANDARDS.md) | Full UI blueprints (tables, forms, modals) |
| [`docs/STYLE_GUIDE.md`](docs/STYLE_GUIDE.md) | Workflow philosophy + component patterns |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Git + Vercel production deploy SOP |
| [`docs/VERCEL_CUTOVER.md`](docs/VERCEL_CUTOVER.md) | Blob migration checklist |
| [`docs/MIGRATIONS_APPLIED.md`](docs/MIGRATIONS_APPLIED.md) | SQL apply order + per-environment log |

## Build

```bash
npm run build:html    # src/pages → public/index.html
npm run build         # HTML + JS bundle + CSS
```

## Reference implementation

**Normie** (`~/WebApps/normie`) is the primary project used to validate StarCaster features end-to-end during active development.
