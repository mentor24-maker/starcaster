# Recommendations 1–3 — Thread Handoff

**Repo:** `~/WebApps/starcaster` (StarCaster by Alphire)  
**Production:** `https://app.isitas.org`  
**Local dev:** `npm run build && PORT=3001 node server.js` (or `npm start`)  
**Suggested Cursor thread title:** `Recommendations 1-3` (thread hygiene, Cursor UI, auth landing partial)

---

## 1. What this thread covered

| Topic | Outcome |
|--------|---------|
| **Thread hygiene** | Agreed protocol; documented in `.cursorrules` (see §2) |
| **Cursor UI** | Past threads found via **Agents Window**; notes on returning to dark editor |
| **Legal pages** | `/privacy-policy`, `/terms-of-service`, footer on auth landing — **done** |
| **Boot toasts** | Six× “Not authenticated” on reload — **fixed** |
| **Auth landing** | Copy/fonts largely set; **layout not signed off** vs user mockup |

**Next thread (recommended):** Auth landing layout only — attach mockup, use §6 paste prompt.

---

## 2. Ongoing protocol (operator + agent)

When work **veers to a new tangent**:

1. **Agent** suggests a new Cursor thread (brief: what’s done vs what’s next).
2. **Operator** starts the new thread and sets a **clear title**.
3. **Agent (current thread)** writes `docs/Cursor Threads/<Title>.md` handoff (goal, done, open, files, success criteria, paste-ready prompt).
4. **Operator** continues in the new thread with that file attached.

**Stay in one thread** for direct follow-ups on the same deliverable only.

**Canonical rule:** `.cursorrules` → **Conversation scope (thread hygiene)** → **Handoff protocol**.

**Example handoff:** `docs/Cursor Threads/Cursor Recommendations 1-3.md` (earlier draft; this file supersedes for close-out).

---

## 3. Cursor UI cheat sheet (macOS)

| Goal | Action |
|------|--------|
| See past threads | **Agents Window** (top-right of editor) → left sidebar by project |
| Back to dark editor | Toggle/close Agents Window; **View → Editor Layout → Single** if split panes piled up |
| Chat in main window | `Cmd+L` |
| Search commands | `Cmd+Shift+P` → `history`, `chat`, `agent` |
| History shortcut | `Cmd+Option+L` (verify in Keyboard Shortcuts) |

Transcripts (optional): `~/.cursor/projects/Users-mentor-WebApps-starcaster/agent-transcripts/`

---

## 4. Auth landing — approved copy

**Tagline** (break after “fans”):

```text
Engage with your followers and fans
wherever they are.
```

**Body:**

```text
StarCaster helps influencers, creators, and community builders grow and engage with organic followings by meeting people where conversations already happen—comments, posts, articles, and all the other grassroots gathering places where real people are having real conversations.

Discover prospects, organize contacts, shape your message, run campaigns, and engage with your tribe across the social web from one convenient console.

Less broadcasting. More real connection.
```

**Typography:** headline `clamp(1.55rem, 2.5vw, 2.45rem)` · body `1.2rem` · closer `clamp(1.35rem, 2.1vw, 1.75rem)` semibold

---

## 5. Auth landing — layout spec (mockup = source of truth)

```
[ Logo banner — full width ]

[ LEFT ]                         [ RIGHT: Sign-in card ]
  Tagline                        ← tops aligned
  ═ equal flexible gap ═
  Body (2 paragraphs)
  ═ equal flexible gap ═
  Closing                        ← bottoms aligned
```

**Do not:** tagline on a row above full card height with body below the card.  
**Do not:** flex spacer pushing closing to page footer.

**Last code attempt** (`src/layout.html` + `src/css/_auth.css`):

- `.auth-main` — 2-column grid, stretch
- `.auth-copy-column` — `grid-template-rows: auto 1fr auto 1fr auto`
- `.auth-copy-gap` — two empty rows for equal flexible gaps

**Verify after edits:** `npm run build` → hard refresh `http://localhost:3001` logged out.

---

## 6. Legal pages (complete)

| URL | Files |
|-----|--------|
| `/privacy-policy` | `src/legal/_privacy-body.html` → `public/privacy-policy.html` |
| `/terms-of-service` | `src/legal/_terms-body.html` → `public/terms-of-service.html` |

Build: `scripts/build_legal.js` (via `npm run build:html`). Styles: `src/css/_legal.css`. Footer: `src/layout.html` → `.auth-legal-footer`.

Production URLs for OAuth forms:

- `https://app.isitas.org/privacy-policy`
- `https://app.isitas.org/terms-of-service`

---

## 7. Boot “Not authenticated” toasts (fixed)

- `public/js/core.js` — no toast on expected `401` during boot; session-expired toast only when user was logged in
- `public/js/auth.js` — `App.whenAuthenticated()`, `_sessionCheckPending`
- `public/js/devAgent.js`, `assetsVideo.js`, `training.js`, `personas.js` — defer `DOMContentLoaded` API work until authenticated
- `public/app.js` — skip shared refresh on public legal page IDs

---

## 8. Key files

| Area | Path |
|------|------|
| Auth landing HTML | `src/layout.html` (`#authLanding`) |
| Auth landing CSS | `src/css/_auth.css` |
| Legal bodies | `src/legal/_privacy-body.html`, `src/legal/_terms-body.html` |
| Thread hygiene rules | `.cursorrules` |
| Product handoff | `docs/AI_AGENT_HANDOFF.md` |

---

## 9. Paste prompt — new “Auth landing layout” thread

```markdown
Fix StarCaster auth landing (#authLanding) to match the attached mockup.

Layout (non-negotiable):
- Logo banner full width on top.
- Two columns: left = tagline + body (2 paragraphs) + closing; right = sign-in card.
- Tagline top = card top. Closing bottom = card bottom.
- Two vertical gaps only (tagline→body, body→closing); equal; grow together when card is taller.
- No tagline row above full card height. No spacer to viewport footer.

Copy/fonts: see docs/Cursor Threads/Recommendations 1-3.md §4.

Edit src/layout.html, src/css/_auth.css. Run npm run build. Verify logged out at localhost:3001.
```

---

## 10. Open items

- [ ] Auth landing layout **user sign-off** vs mockup
- [ ] Operator preference: dark editor vs Agents Window workflow
- [ ] Unrelated backlog: X OAuth credentials, Top Ten #3 Supabase acquire stores (see `docs/MIGRATIONS_APPLIED.md`)

---

*End of thread handoff — Recommendations 1–3.*
