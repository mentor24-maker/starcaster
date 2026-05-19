# Cursor Recommendations 1–3 — Thread Handoff

**Repo:** `~/WebApps/starcaster` (StarCaster by Alphire)  
**Production:** `https://app.isitas.org`  
**Local dev:** `npm run build && PORT=3001 node server.js` (or `npm start`)  
**Thread focus:** Cursor workflow, thread hygiene, auth landing (partial), legal pages, boot toasts

---

## 1. What this thread was about

Three overlapping topics accumulated in one conversation:

| # | Topic | Outcome |
|---|--------|---------|
| **1** | **Thread / conversation hygiene** | Added rules to `.cursorrules`; discussed one-thread-per-task vs long meandering threads |
| **2** | **Cursor UI navigation** | Located past threads via **Agents Window**; user wants chat + history back in the usual dark editor layout |
| **3** | **Public auth landing page** | Legal pages + footer done; layout/copy mostly done; **vertical alignment still not verified against user mockup** |

**Recommendation for future work:** Start a **new Agent thread** only for “Auth landing layout matches mockup” with the reference image attached. Do not continue layout iteration in a thread that already has many failed grid approaches.

---

## 2. Rule added: conversation scope

**File:** `.cursorrules` → section **“Conversation scope (thread hygiene)”** (after Core Philosophy)

Agents should **proactively suggest a new chat** when:

- The user switches deliverables (landing → OAuth → migrations, etc.)
- The current task is done and the next item is unrelated
- Many failed iterations on one problem suggest a clean slate
- “While we’re here…” introduces a different module or system

Stay in the **same** thread for direct follow-ups on the same deliverable.

---

## 3. Cursor UI — finding threads and getting back to the dark editor

### Past threads (what the user found)

- **Agents Window** (blue control, top-right of editor) opens a dedicated agents UI with a **left sidebar of past conversations** grouped by project/repo.
- This thread may appear as something like **“Agent setup with strict scope”** under the `isit-app` / starcaster project group (exact title varies).

### Return to the usual dark editor workspace

1. **Close or toggle Agents Window** — click **Agents Window** again, or close that window/tab so focus returns to the main Cursor window.
2. **Reset editor splits** if the main window shows many columns (e.g. four copies of `MIGRATIONS_APPLIED.md`):
   - **View → Editor Layout → Single** (or close extra editor groups with the `×` on each tab group).
3. **Open chat in the main window:**
   - `Cmd+L` — Chat / Agent input in the side or bottom panel (depends on layout).
   - `Cmd+Shift+P` → search **history**, **chat**, or **agent**.
4. **History shortcut (macOS, when available):** `Cmd+Option+L` — confirm in **Cursor → Settings → Keyboard Shortcuts**.

### This conversation

- You do **not** lose the thread by switching UI modes; it is the same conversation ID in Agents Window.
- To continue **here** in the editor: open Agents Window → select this thread, or use history from the chat panel after `Cmd+L`.

### Local transcript backup (optional)

Project agent transcripts (if enabled):

`~/.cursor/projects/Users-mentor-WebApps-starcaster/agent-transcripts/`

---

## 4. Auth landing page — copy (approved)

**Tagline** (line break after “fans”):

```text
Engage with your followers and fans
wherever they are.
```

**Body** (two paragraphs + closer):

```text
StarCaster helps influencers, creators, and community builders grow and engage with organic followings by meeting people where conversations already happen—comments, posts, articles, and all the other grassroots gathering places where real people are having real conversations.

Discover prospects, organize contacts, shape your message, run campaigns, and engage with your tribe across the social web from one convenient console.

Less broadcasting. More real connection.
```

**Typography (last requested):**

- Headline: `clamp(1.55rem, 2.5vw, 2.45rem)`
- Body: `1.2rem`
- Closer: `clamp(1.35rem, 2.1vw, 1.75rem)`, semibold, lighter white

---

## 5. Auth landing layout — mockup spec (source of truth)

User provided a graphics mockup (`Right-*.png` in chat assets). **Do not improvise** a different grid story.

### Required layout

```
[ Logo banner — full width ]

[ LEFT COLUMN ]                    [ RIGHT: Sign-in card ]
  Tagline                          (top aligned with tagline top)
  ── equal flexible gap ──
  Body (2 paragraphs)
  ── equal flexible gap ──
  Closing                          (bottom aligned with card bottom)
```

**Rules:**

1. **Top:** tagline top edge = sign-in card top edge (same row start).
2. **Bottom:** closing bottom edge = sign-in card bottom edge.
3. **Gaps:** only two vertical gaps — tagline→body and body→closing — **equal**; extra height splits between those gaps, not a spacer to the page footer.
4. **Do not:** put tagline on a row above the form while body is on a row below the full card height (that was the main bug).
5. **Do not:** use a flex “spacer” that pushes the closing to the viewport footer.

### Last attempted implementation (verify / fix in new thread)

**HTML:** `src/layout.html` → `#authLanding`

```html
<div class="auth-main">
  <motion class="auth-copy-column">
    <h1 class="auth-headline">…</h1>
    <motion class="auth-copy-gap" />   <!-- flexible row -->
    <div class="auth-intro-body">…2× <p>…</div>
    <div class="auth-copy-gap" />   <!-- flexible row -->
    <p class="auth-intro-closer">…</p>
  </div>
  <div class="auth-card">…</motion>
</div>
```

**CSS:** `src/css/_auth.css`

- `.auth-main` — 2-column grid, `align-items: stretch`
- `.auth-copy-column` — `grid-template-rows: auto 1fr auto 1fr auto`
- `.auth-copy-gap` — empty rows that absorb equal extra height

**Build after any edit:**

```bash
npm run build
```

---

## 6. Legal pages (done)

| URL | Source / output |
|-----|------------------|
| `/privacy-policy` | `src/legal/_privacy-body.html` → `public/privacy-policy.html` via `scripts/build_legal.js` |
| `/terms-of-service` | `src/legal/_terms-body.html` → `public/terms-of-service.html` |

- Footer on auth landing: `src/layout.html` → `.auth-legal-footer` → links to both URLs.
- Styles: `src/css/_legal.css` (imported in `src/css/main.css`).
- Vercel rewrites in `vercel.json` for extensionless paths.
- Local `server.js` serves `*.html` for extensionless paths.

**OAuth / X developer portal URLs:**

- `https://app.isitas.org/privacy-policy`
- `https://app.isitas.org/terms-of-service`

---

## 7. “Not authenticated” toasts on reload (fixed)

**Cause:** `App.api()` in `public/js/core.js` showed a toast on every `401` + `AUTH_REQUIRED`. Modules (`devAgent`, `assetsVideo`, etc.) called APIs on `DOMContentLoaded` before auth completed.

**Fixes:**

- `core.js` — suppress expected unauthenticated `401` during boot; only toast session expiry when user was logged in.
- `auth.js` — `App.whenAuthenticated()` queue; `App.auth._sessionCheckPending`.
- `devAgent.js`, `assetsVideo.js`, `training.js`, `personas.js` — defer init until authenticated.
- `app.js` — skip `App.refresh()` on public legal pages.

---

## 8. Key files reference

| Area | Paths |
|------|--------|
| Auth landing markup | `src/layout.html` (`#authLanding`) |
| Auth landing CSS | `src/css/_auth.css` |
| Legal content | `src/legal/_privacy-body.html`, `src/legal/_terms-body.html` |
| Legal build | `scripts/build_legal.js` (runs from `scripts/build_html.js`) |
| Auth boot | `public/js/auth.js`, `public/js/core.js`, `public/app.js` |
| Generated shell | `public/index.html` (do not edit by hand) |
| Thread hygiene rule | `.cursorrules` → Conversation scope |
| Agent handoff (product) | `docs/AI_AGENT_HANDOFF.md` |

---

## 9. Suggested next threads (split work)

| Thread | Goal | Attach |
|--------|------|--------|
| **Auth landing layout** | Match mockup exactly; one CSS approach; user verifies in browser | `Right-*.png` mockup + section 5 above |
| **X OAuth credentials** | User creates X app; OAuth 1.0a keys in Settings; green auth test | (separate from layout) |
| **Top Ten #3 file stores** | Wire X/Reddit harvest to Supabase per `docs/011_*.sql` | `docs/MIGRATIONS_APPLIED.md` |

---

## 10. Paste-ready prompt for “Auth landing layout” thread

```markdown
Fix StarCaster auth landing (#authLanding) to match the attached mockup exactly.

Layout (non-negotiable):
- Logo banner full width on top.
- Below: two columns. Left = tagline, body (2 paragraphs), closing. Right = sign-in card.
- Top of tagline aligns with top of card.
- Bottom of closing aligns with bottom of card.
- Only two vertical gaps (tagline→body, body→closing); they must stay equal when the card is taller than the text block.
- Do NOT put tagline on a separate grid row above the full height of the card.
- Do NOT use a spacer that pushes the closing to the page footer.

Copy and fonts are already approved — see docs/Cursor Threads/Cursor Recommendations 1-3.md section 4.

Edit src/layout.html and src/css/_auth.css only (plus build). Run npm run build. User verifies at http://localhost:3001 logged out.
```

---

## 11. Open / not done in this thread

- [ ] Auth landing layout **signed off** by user against mockup
- [ ] User comfortable switching between **dark editor** and **Agents Window** without losing threads
- [ ] Optional: register form line “By registering you agree to Terms and Privacy”
- [ ] Top Ten migration / acquire Supabase work (mentioned in earlier summary, not implemented here)

---

*Handoff generated from Cursor thread covering recommendations 1–3 (thread hygiene, Cursor UI, auth landing + legal pages).*
