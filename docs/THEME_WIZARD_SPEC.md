# AI Theme Wizard — Specification

Status: **spec / not yet built**
Branch: `theme-wizard`
Owner: Dane (direction) + CC-starcaster (implementation)
Date: 2026-08-07

---

## 1. What this is, in plain language

Today, Builder → Themes is a form. You set a font, a colour, a border radius, one
field at a time, and you have to already know what you want.

The Theme Wizard replaces the blank page with a conversation. It looks at a site,
proposes **three complete looks**, and lets the user rank them and say what they
liked and disliked. It then generates three new options built from the winner.
Repeat until they're happy. Nothing on the live site changes until they
explicitly apply a theme.

The key insight that makes this tractable: **a theme is already a self-contained
bundle of values in this codebase.** The AI doesn't write CSS. It fills in a JSON
shape the Builder already knows how to render.

---

## 2. Decisions already made

| Question | Decision |
|---|---|
| What the AI looks at | All four: the project's current pages, an external URL (via Site Import capture), an uploaded logo/brand kit, or a typed brief |
| What it generates | Colours + typography only. Not radii, margins, logos, or background images. |
| Where candidates live | A new draft/session table, separate from `builder_themes` |
| Preview | One real page of the user's site, rendered under each candidate |
| Audience | Agency-only for v1; tenant clients later (so build the guardrails now, gate the UI) |
| Iteration | Round 2 generates variations on the #1 pick, guided by written feedback |
| Manual editing mid-wizard | No. Rank and describe only. Plus **lock-a-value** (see §6) |
| Undo | Snapshot before apply, one-click revert. Non-negotiable. |
| Round counting | Recorded from day one; no enforced limit yet |
| Reusable library | Agency-owned shelf, applying a theme **copies** it into the client project |
| Draft scoping | Wizard sessions are scoped to the project being themed |

---

## 3. What already exists (do not rebuild)

**The theme itself** — `builder_themes` table via `lib/builderThemesStore.js`.
Simple values are columns (primary/secondary/background/accent colour, border
thickness, border radius, blur, contrast, page margins, logo + background image
ids). The rich part is a `typography` JSON blob defined as `BuilderThemeTypography`
in `lib/builder-client/builder-template.ts`:

- `fonts` — heading / body / mono slots
- `scale` — base size, ratio, and per-heading overrides for size, line height,
  weight, and margins
- `colors` — semantic roles: text, heading, muted, link, linkHover, selection
- `elements` — sparse per-element overrides (h1–h6, p, a, button, nav, …)
- `forms`, `pageLayout`

Every field uses an "inherit" sentinel (`""` for text, `0` for numbers), so an
absent or default theme renders identically to the pre-theme baseline. **The
generator's output target is this shape.**

**Site capture** — `lib/site-import/capture-playwright.ts` drives a real browser,
reads `getComputedStyle` off every element, and takes full-page plus per-section
screenshots. Built for Site Import, reusable verbatim as the external-URL seed.

**Preview rendering** — `components/builder-template-preview.tsx` already accepts
resolved theme styles as a prop. Feeding it a candidate instead of a saved theme
is a prop change, not a new renderer.

**LLM plumbing** — `lib/altTextProviders.js` is the house pattern: try Anthropic,
fall back to OpenAI, then Gemini, with keys read from per-project API settings.
Follow that shape.

---

## 4. Known hazards

**4.1 — Applying a theme is a bulk rewrite.** `routes/builder.js:182` walks every
landing page and template in the project and merges the theme's typography into
each one. This is the same shape as the canonical-section incident that wiped the
Marinoff menu: a save that silently rewrites dozens of pages with no undo. The
wizard must write nothing until an explicit Apply, and Apply must snapshot first.

**4.2 — Generation will outrun the serverless timeout.** Three model calls plus a
site capture cannot finish inside one request. Same failure as the 7/22
propagation bug, which froze mid-loop and left 30 of 50 pages updated. Generation
runs as a background job with a status the UI polls.

**4.3 — There is no `temperature` knob any more.** Current Claude models reject
`temperature`, `top_p`, and `top_k`. The old way of getting three different
answers from one prompt — roll the dice three times — is gone. **Variety must be
engineered into the prompt.** See §6.

**4.4 — The models have a persistent default aesthetic.** Left to itself, the
model reaches for warm cream backgrounds, serif display type, and a terracotta
accent. It's tasteful and it's also *the same every time*. Asking one prompt for
"three options" yields three shades of that one look. Generic pushback ("not
cream", "more modern") just relocates it to a different fixed default. §6 is the
fix.

**4.5 — Fable 5 requires 30-day data retention.** It is unavailable under
zero-retention account settings, and the failure is a generic `400` that looks
like a malformed request. Verify the account setting once before blaming the
payload.

**4.6 — Theme `pageBackground` is dropped on some routes.** Pre-existing bug in
the neighbourhood. Fix it as part of this work rather than debugging it through a
new feature.

---

## 5. Data model

Three new tables. All project-scoped except the agency library.

### `theme_wizard_sessions`
One row per wizard run.

| Column | Notes |
|---|---|
| `id` | `twiz_…` |
| `project_id` | scoped like everything else |
| `seed_type` | `current_pages` \| `external_url` \| `brand_kit` \| `brief` |
| `seed_payload` | JSON — the URL, asset id, or brief text |
| `style_brief` | JSON — the normalised palette/type/mood the adapters produce |
| `preview_page_id` | which page candidates render against |
| `locked_values` | JSON — see §6.4 |
| `round_count` | incremented per generation |
| `tokens_spent` | running tally, for the throttle we haven't built yet |
| `status` | `active` \| `applied` \| `abandoned` |
| `created_at` / `updated_at` | |

### `theme_wizard_candidates`
Three rows per round.

| Column | Notes |
|---|---|
| `id` | `twcd_…` |
| `session_id` | |
| `round` | 1-indexed |
| `slot` | 1–3 |
| `direction` | the distinct brief this candidate was told to commit to (§6.2) |
| `rationale` | the model's one-paragraph explanation, shown to the user |
| `theme_patch` | JSON — colours + typography only, in `BuilderTheme` shape |
| `parent_candidate_id` | the winner this was derived from; null in round 1 |
| `rank` | 1/2/3, set when the user ranks |
| `feedback` | free text the user wrote about this candidate |

### `theme_library_entries`
Agency-owned shelf. **Not project-scoped** — this is the deliberate exception.

| Column | Notes |
|---|---|
| `id` | `tlib_…` |
| `name` | operator-supplied |
| `theme_patch` | JSON, same shape as a candidate |
| `source_session_id` | provenance, nullable |
| `origin_project_id` | which client it was born from, for reference only |
| `created_by` | platform user |

Applying a library entry to a project **copies** its values into a new
`builder_themes` row for that project. The library row is never referenced live.
Client separation is preserved: no tenant query ever reaches this table.

### Snapshot (hazard 4.1)
Before Apply writes anything, capture the prior state of every page the apply
will touch. Store it as a single JSON blob keyed to the session so revert is one
operation. Reuse the existing revert tooling pattern if one fits; otherwise a new
`theme_apply_snapshots` table with `{session_id, project_id, pages: [...],
created_at}`.

---

## 6. The generator

This is the part that needs real thought. Everything else is plumbing.

### 6.1 Model choice
- **Generating candidates: `claude-fable-5`.** Design taste is the entire product.
- **Everything else: `claude-opus-5`.** Parsing the capture, normalising the four
  seed types into a `style_brief`, summarising feedback. Cheaper, plenty capable.

Estimated cost is roughly $1–3 per round of three, dominated by screenshot image
tokens. A five-round client session lands in single digits.

### 6.2 Forcing genuine variety
Do **not** ask one prompt for three themes. Instead, decide three *distinct
directions* first, then generate each candidate against its own committed brief.

The directions should differ on axes the user can feel, not adjectives:

- **Type character** — e.g. geometric sans / humanist serif / editorial contrast
- **Colour temperature and saturation** — e.g. cool restrained / warm saturated /
  near-monochrome with one accent
- **Contrast philosophy** — e.g. soft and low-contrast / crisp and high-contrast

Derive the three directions from the `style_brief` (a law firm and a surf school
should not get the same three axes), then generate each candidate separately with
its direction stated explicitly and concretely — named typefaces, actual hex
values, a stated rationale. Each candidate returns its `direction` and
`rationale` alongside the patch so the user can see *why* it looks like that.

This is the documented approach for getting varied design output from these
models, and it is also exactly the product Dane described: propose distinct
directions, let the human pick.

### 6.3 Round 2 and beyond
Input to the next round is: the winning candidate's patch, the user's written
feedback on all three, and the full history of prior rounds' directions (so it
stops re-proposing something already rejected). Output is three new candidates,
all children of the winner, each still committing to a stated direction — the
directions just narrow as rounds progress.

### 6.4 Lock-a-value
The user can pin specific values — "keep this exact blue", "keep this heading
font" — and every future candidate must preserve them. Stored on the session as
`locked_values`, injected into every generation prompt as hard constraints, and
enforced in code after the model returns (overwrite any locked field the model
changed anyway). Belt and braces: prompt it *and* enforce it.

### 6.5 Output validation
The model returns JSON. Validate it against the `BuilderTheme` shape before it
ever reaches a candidate row: unknown keys dropped, colours normalised to hex,
font keys checked against `BUILDER_HEADING_FONTS`, numbers range-clamped. A
malformed patch must fail the candidate, not corrupt a preview.

### 6.6 Refusals
Fable 5's safety classifiers can decline a request, returning HTTP 200 with
`stop_reason: "refusal"` rather than an error. Vanishingly unlikely for theme
design, but the client must check `stop_reason` before reading content, and
should opt into server-side fallback so a declined request re-runs on Opus 5
automatically instead of failing the round.

---

## 7. API surface

Follows the house envelope: `{ ok: true, data }` / `{ ok: false, error }`,
session cookie `app_session`, active project via `x-project-id`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/builder/theme-wizard/sessions` | Start a session with a seed |
| `GET` | `/api/builder/theme-wizard/sessions/:id` | Session + all rounds + candidates |
| `POST` | `/api/builder/theme-wizard/sessions/:id/generate` | Queue a round; returns a job id |
| `GET` | `/api/builder/theme-wizard/jobs/:id` | Poll generation status |
| `POST` | `/api/builder/theme-wizard/sessions/:id/rank` | Submit ranking + per-candidate feedback |
| `POST` | `/api/builder/theme-wizard/sessions/:id/locks` | Set/clear locked values |
| `POST` | `/api/builder/theme-wizard/candidates/:id/apply` | Snapshot, then apply to the project |
| `POST` | `/api/builder/theme-wizard/sessions/:id/revert` | Restore the snapshot |
| `POST` | `/api/builder/theme-library` | Save a candidate to the agency shelf |
| `GET` | `/api/builder/theme-library` | List shelf entries |
| `POST` | `/api/builder/theme-library/:id/copy` | Copy a shelf entry into the active project |

---

## 8. Wizard screens

1. **Start** — pick a seed: current site / paste a URL / upload a logo / describe
   it. Pick which page to preview against (defaults to the homepage).
2. **Generating** — progress state while the background job runs. Honest about
   what it's doing (capturing, analysing, generating 1 of 3).
3. **Compare** — three live previews of the chosen page, side by side, each with
   its direction and rationale underneath. Click one to view full-screen.
4. **Rank & react** — drag to rank 1–3, free-text box per candidate ("what did
   you like, what didn't work"). Optional: lock any value from the winner.
5. **Loop** — generate the next round, or stop.
6. **Apply** — plain-language confirmation naming how many pages will change and
   stating that it can be undone, then apply. Offer "also save to the agency
   library" at this point.

---

## 9. Build phases

Reviewable slices, each shippable on its own.

| Phase | Contents |
|---|---|
| **1 — Foundation** | Tables + migrations, API skeleton, background job runner, snapshot + revert. No AI yet; candidates seeded by hand to prove the preview path. |
| **2 — Generator** | Fable 5 integration, the three-direction prompt architecture, output validation, one seed adapter (current pages — no capture needed). |
| **3 — Wizard UI** | All six screens, live previews, ranking, feedback, apply flow with confirmation. |
| **4 — Iteration** | Round 2+ (feedback → new candidates from the winner), lock-a-value, round/token accounting. |
| **5 — Seeds** | The other three adapters: external URL via Site Import capture, brand-kit upload, typed brief. |
| **6 — Library** | Agency shelf, save-from-wizard, copy-into-project. |

Deferred: throttling/limits, tenant-facing exposure, per-project cost metering,
generated background images.

---

## 10. Definition of done (per phase)

Per repo policy, every phase reports:

1. `npm run typecheck`
2. `npm run test:builder-ui` and/or `npm run test:builder`
3. Rebuild commands for any generated artifact touched
4. `node scripts/check_conventions.cjs`
5. `npm run check:syntax` if `public/js/` or `public/shared/` was touched
