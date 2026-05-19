# Handoff — Cursor Codebase Audit

**Thread focus:** Poll **Deep Dive** overlay, **View** (`startPoll`) flow, **Previous Results** pod styling, and **Deep Dive button** poll settings.

**Repo:** `normie` (`~/WebApps/normie`)  
**Stack:** Next.js 15 App Router, Supabase, custom CSS in `app/globals.css` (no Tailwind).

---

## Summary

This thread fixed how Deep Dive relates to the poll the user **just finished** (not the unanswered “current” poll), corrected post-vote navigation when opening polls via **Poll Manager View**, and iterated on Deep Dive / Related Polls UI and admin-configurable Deep Dive button styling.

---

## 1. Deep Dive timing and content (`startPoll` / viewer)

### Problem
- With `?startPoll=<uuid>`, Deep Dive showed **related polls** (or other content) for the **wrong** poll — often the list item **before** the previewed poll in `order_index`.
- Deep Dive appeared **before** the user voted on the previewed poll; it should only reflect the **previous** poll after that poll becomes “previous.”
- After voting, the **current** poll could appear inside “Related polls.”

### Solution
**`app/api/polls/next/route.ts`**
- **`isStartPollPendingPreview`:** When `startPoll` matches `currentPoll.id` and that poll is **not** in the session’s answered set, do **not** load `previousPollResults` (no Previous Results block, no Deep Dive until the user votes).
- **`loadPollDeepDiveContent`** for the previous poll passes `{ excludePollIds: [currentPoll.id] }` so the session’s current question is excluded from related lists.

**`lib/polls-next-session.ts`**
- **`resolveCurrentPollIndexFromSession`:** Current index = first unanswered poll **after** the highest answered index in the ordered list (fixes View → vote → snap back to poll #0 / `initial_page`).

**`lib/poll-deep-dive.ts` / `lib/load-poll-deep-dive-content.ts`**
- **`DEEP_DIVE_RELATED_LIMIT`** = **6**.
- **`mergeDeepDiveRelatedPolls`** accepts `additionalExcludePollIds`.
- Deep dive content priority: **blog → YouTube → related polls** (unchanged).

**Client after vote**
- `stripStartPollFromBrowserUrl()` + reload without `startPoll` (`components/builder-poll-runtime.tsx`, `use-poll-experience.ts`, `poll-experience.tsx`).

### Tests
- `lib/poll-deep-dive.test.ts`
- `lib/polls-next-session.test.ts`

---

## 2. Deep Dive overlay UI

### Header
- **Eyebrow:** “Deep Dive” (`.poll-deep-dive-eyebrow`).
- **Pill:** Section title in blue pod header style — “Related Polls”, “From the Blog”, “Video”, etc. via **`getPollDeepDiveOverlayPillLabel()`** in `lib/poll-deep-dive.ts`.
- Section titles removed from body in `components/poll-deep-dive-content.tsx` to avoid duplication.

### Related polls list
- Category line removed.
- Each question is a **`Link`** to `buildPublicPollViewPath(poll)` (`lib/poll-categories.ts`).
- Up to **6** items; related body uses **`poll-deep-dive-body--related`** with `overflow: hidden` (no scrollbar).
- Row bullets: `li::before` accent dot (no per-row green background).

### Overlay background
- Must be **fully opaque** so Previous Results content does not show through.
- **`:root`:** `--poll-deep-dive-overlay-fill: #fefac7` (user-specified; matches previous-results card appearance).
- Applied on **`.poll-deep-dive-overlay`** directly (not transparent + extracted pod surface).
- Removed inset border on overlay so it blends with the wider panel.

### Files
- `src/site/home/partials/previous-results-panel.tsx`
- `components/poll-deep-dive-content.tsx`
- `app/globals.css` (`.poll-deep-dive-*` block)

---

## 3. Deep Dive button — poll settings

### Model (`lib/poll-pod-config.ts`)
**`PollDeepDiveTriggerSettings`** on **`previous_results`** pod only:

| Field | Default | Notes |
|--------|---------|--------|
| `backgroundColor` | `#006699` | |
| `fontColor` | `#ffffff` | |
| `marginTopPx` | `20` | 0–120 |
| `hoverBackgroundColor` | `#0088bb` | |
| `hoverFontColor` | `#ffffff` | |
| `fontSizeRem` | `1` | 0.75–2.5 rem |

Stored in existing **`pod_configs`** JSON (no new DB migration required).

**`getPollPodStyle`** exposes CSS variables on the Previous Results panel:
- `--poll-deep-dive-trigger-bg`
- `--poll-deep-dive-trigger-color`
- `--poll-deep-dive-trigger-hover-bg`
- `--poll-deep-dive-trigger-hover-color`
- `--poll-deep-dive-trigger-font-size`
- `--poll-deep-dive-trigger-margin-top`

### Admin UI
**Poll settings → Previous Results → “Deep Dive button”**  
`components/admin-poll-settings-form.tsx` + **`PollDeepDiveTriggerFields`** in `components/admin-poll-pod-editor.tsx`.

Save via **Save Settings** → `PATCH /api/admin/polls/settings`.

### CSS bug fixed (white button / black text)
Generic **`.secondary-button`** rule (later in `globals.css`) set `background: var(--surface-strong)` and `color: var(--ink)`, overriding `.poll-deep-dive-trigger`.

**Fix:** Use higher specificity:
```css
.poll-previous-results-panel .secondary-button.poll-deep-dive-trigger { ... }
.poll-previous-results-panel .secondary-button.poll-deep-dive-trigger:hover { ... }
```

Exclude Deep Dive from generic hover:
```css
.secondary-button:hover:not(.poll-deep-dive-trigger) { ... }
```

---

## 4. Poll answer button hover (separate from Deep Dive)

**`app/globals.css`**
- Poll answer buttons: hover uses `color-mix` on configured `--poll-answer-a-bg` / `--poll-answer-b-bg`, not white.
- `.option-button:hover:not(.poll-answer-button-a):not(.poll-answer-button-b)` so generic white hover does not apply to poll choices.

---

## Key files (quick reference)

| Area | Path |
|------|------|
| Next poll API | `app/api/polls/next/route.ts` |
| Session index helper | `lib/polls-next-session.ts` |
| Deep dive merge / labels | `lib/poll-deep-dive.ts` |
| Deep dive load | `lib/load-poll-deep-dive-content.ts` |
| Pod config + trigger settings | `lib/poll-pod-config.ts` |
| Previous Results UI | `src/site/home/partials/previous-results-panel.tsx` |
| Deep dive content | `components/poll-deep-dive-content.tsx` |
| Builder/runtime poll | `components/builder-poll-runtime.tsx` |
| Poll settings admin | `components/admin-poll-settings-form.tsx` |
| Styles | `app/globals.css` |

---

## Manual test checklist

1. **View** a mid-list poll (`?startPoll=…&category=…`) → no Previous Results / Deep Dive until vote.
2. Vote → URL drops `startPoll` → **next** poll in order (not first in category) → Previous Results shows **just-answered** poll.
3. Open **Deep Dive** → opaque `#fefac7` overlay; no bleed-through; Related Polls in pill; links open correct poll.
4. **Poll settings → Previous Results → Deep Dive button** → set e.g. `#007799` background, white text, hover colors, font size → **Save Settings** → hard refresh → button matches (not white/black).
5. Poll **answer** buttons: hover stays green-tinted, not white.

---

## Not in scope / follow-ups

- **Deep dive overlay fill** (`--poll-deep-dive-overlay-fill`) is still a **global CSS constant** (`#fefac7`), not an admin setting. Only the **trigger button** is configurable in pod settings.
- **Configured pod background** (color/gradient/image) on Previous Results does not automatically drive overlay fill; overlay uses `#fefac7` by design from this thread.
- **Interstitial** pod type is configured in settings but not fully wired on the public site (per existing project notes).
- No git commits were made in this thread unless the user requested them separately.

---

## Migrations referenced (context)

- `009_poll_deep_dive.sql` — `deep_dive` text on polls
- `010_poll_deep_dive_extras.sql` — `deep_dive_youtube_url`, `deep_dive_blog_post_id`, `deep_dive_related_poll_ids`
- Pod JSON: `007_poll_pod_configs.sql` — `pod_configs` on `poll_settings`

Ensure admin **YouTube** / deep-dive fields on polls map to **`deep_dive_youtube_url`** for public Deep Dive video (not only a display column in Poll Manager).

---

*Generated from Cursor thread — Deep Dive, View flow, and poll pod styling.*
