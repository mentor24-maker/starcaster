# UI Rules Audit — every module vs the Master UI Rules

**What this is.** The full audit the operator ordered on 2026-08-09 after
ratifying `docs/UI_RULES.md`: every module settings surface — the 38
extracted editors, the editors still inline in `builder-module-card.tsx`,
and the shared chrome that tops every panel — scored against the master
list. This is the ongoing cross-reference: for each rule, who applies it
correctly (the teaching examples) and who violates it (the fix queue).

**How to read it.** §1 is the rule-by-rule cross-reference. §2 is the fix
plan — violations grouped by shared root cause, because most of them
collapse together. §3 is the per-module record. Verdicts carry file:line
evidence; UNCLEAR means the code couldn't prove it either way (it is never
silently upgraded to PASS). Re-audit a module by re-running its section's
rules after any fix, and move it between the lists here.

**Update discipline:** incorrect examples "shouldn't last very long"
(operator, 8/9) — when a violation is fixed, move the module to the
conforming list and note the PR. Never delete the history.

---

## 1. Rule-by-rule cross-reference

Rules with no violations found anywhere are omitted; absence means the rule
held everywhere it applied.

### L3 — no redundant label words
- **Correct:** nearly everywhere post-sweep.
- **Violations:** admin-team-users ("Show table title" vs siblings' "Show
  title"), tag-cloud ("Count / weight"), slideshow ("Height (px, 0 = auto)"
  — unit + sentinel belongs in the control).

### L4 — never crop a word
- **Correct:** blog-card-manager, blog-search, current-poll, image.
- **Violations (systemic):** the fixed-width select tokens crop real
  option text — admin-modules "Hide (read-only)" (16ch in 9.5ch),
  admin-support-form "Two columns", author-bio "Horizontal (photo left)"
  (23ch), post-card "Horizontal", post-create "Hide (use logged-in user)"
  (24ch), heading "Section Heading" / "Capitalize", floating-image
  "Bottom Center" / "Until Page Change".
- **Root cause:** `select-sm`=7.5ch, `select-md`=9.5ch are fixed; W5
  explicitly allows expanding to avoid crops. Fix F5.

### L6 — item-grid columns get titles
- **Correct (exemplars):** navigation Links grid (Parent Page / Page Name /
  Slug / Width / Action — the operator's own 7/1 spec), headline-rotator
  item table (all 7 columns titled).
- **Open question for the operator:** card-style item managers (breadcrumb,
  feature-cards) repeat per-field labels on every card instead of column
  titles — does L6 require conversion to titled grids?

### L7 — wording an operator shouldn't have to ask about
- **Violations:** category-filter/breadcrumb reorder buttons titled "Move
  left/right" but drawn as ↑/↓; confetti Origin X/Y in raw 0.0–1.0
  developer units; social-share "X via"; floating-image's two offset
  controls with word-for-word identical hint text; post-list's dead "Post
  Title"/"Post Slug"; assorted "URL Param" jargon.

### D1/D2/D3 — density: share rows, no wasted right side, no orphans
- **Correct (exemplars):** admin-nav-link (minimal compliant panel),
  admin-site-settings (toggle + dependent field pairing), admin-team-users
  actions strip, post-card Author+Date row, current-poll's packed
  Width/Alignment/H/V strip, button editor's two-column
  `builder-button-setting-columns` layout (the only true D4 exemplar).
- **Violations (systemic):** stacked short strips with the right side
  empty in admin-support-form (worst: 8 strips, 3 orphans), author-bio,
  newsletter-subscribe, blog-search, search-results, post-manager,
  confetti, crm-contacts-table, breadcrumb, image (1 orphan), plus every
  inline editor (poll-category-list: 8 single-control rows;
  headline-rotator: 12).
- **Root cause:** the schema generator renders groups strictly stacked,
  single-column (`builder-settings-schema.tsx` renderStrips) — it cannot
  express the operator's 1–3 column rows (D4). Fix F1.

### D5/D6 — titled groups, Advanced for the rare stuff
- **Correct (exemplars):** blog-post's five titled tabs; post-tags'
  collapsed "Linking" details; admin-login's use of Advanced.
- **Violations:** admin-support-form (9 rows, 3 concerns, no titles),
  crm-contacts-table (fakes a group header with another module's CSS
  class + inline styles), headline-rotator (shadow fields always visible
  even with shadow Off). The generator has **no group-title primitive** —
  authors improvise. Fix F1.

### W1/W3 — never stretch; width follows content
- **Correct (exemplars):** image module (every control content-sized),
  the shared chrome's Alignment/H/V strip, text module width select.
- **Violations (systemic):** every surface still using legacy
  `BuilderSettingRow` or `label.field` markup — the **shared chrome's own
  Label row** (full-panel input on every module), the whole Background
  block (renders single-column; its "horizontal" CSS only exists in a
  social-module-only scope), floating-image's five offset rows, button
  label, table Max Width, poll-category-list (headline, sort, layout,
  numbers), video name, code label, slider/slideshow/social-share text
  fields, headline-rotator's 12-row stack, plus
  `BuilderInlineNumberSelect` stretching digit selects to half-row
  (table, slider, slideshow, social-share). Fixes F2, F3, F8.

### W4 — sliders get bounded width
- **Violations (confirmed ×3):** tractor-nav Inner Opacity, Transition,
  and Curve sliders all span the panel. Mechanism: `text-md` CSS sizes
  only `input[type="text"]`; range inputs have no width rule anywhere.
  One CSS rule bounding `input[type="range"]` in strips fixes all three.

### C1/C2 — presets over free-form; derived values computed
- **Correct (exemplars):** heading's Style preset (one pick writes
  variant+level+fontSize), text width preset select, confetti presets.
- **Violations (systemic — 10+ modules):** hand-typed page/post URLs and
  IDs the system knows: admin-nav-link linkHref, admin-login
  successRedirect, newsletter CRM Form ID, post-card link URL + comma
  categories, post-create redirect, post-manager edit/view URLs,
  related-posts item URL/date, blog-search + search-results page URLs and
  manually-synced params, tag-cloud/post-tags target pages, blog-post
  slug/date/categories, category-filter hand-typed label+slug pairs,
  blog-toc hand-typed heading anchors. **One shared "pick from project
  data" control (pages/posts/forms/categories) fixes the family.** Fix F6.

### C3 — booleans read as on/off
- **Correct (exemplar):** feature-cards (five real checkboxes),
  tractor-nav New Tab.
- **Violations (universal):** ~55 boolean settings rendered as
  Show/Hide / Yes/No / On-Off selects across admin (12), blog A (23),
  blog B (~20), heading, breadcrumb, crm-contacts-table,
  headline-rotator (which mixes both styles in one panel), button
  (Bold/Italic/Underline). Fix F4.

### C6 — no dead controls
- **Confirmed dead (renderer verified, rendersVia strings proven
  unreliable):**
  - blog-tag-cloud: layout, alignment, min/max font size, colors,
    entire Linking group — published renderer ignores them all
    (renders uniform non-linking pills). 7 controls of theater.
  - blog-post-tags: `linkToFilter` (zero consumers), filterParam,
    targetPageUrl, gap — another dead Linking group.
  - blog-post-list: postTitle, postSlug, popularityFilter — **note:
    these came from the operator's 6/28 request, so they are
    half-built features; wire-or-remove is his call.**
  - floating-image: two offset systems both moving the image through
    one composed transform, with identical hint text.
  - code module: two "Label" fields in one panel (chrome module.name +
    settings.label, same placeholder).
- Fixes F7, F9.

### C7 — every honored setting reachable
- **Violations:** blog-toc titleFontSize/titleColor (canvas preview
  honors, no control), related-posts cardBorderRadius (honored + seeded,
  no control), quote variant (previews vary by it; nothing sets it).
  Fix F11.

### C8 — same concept, same control
- **Violations:** two competing number controls
  (`BuilderNumberSelectControl` digit-sized vs `BuilderInlineNumberSelect`
  stretched); raw `<input type=number>` in confetti zIndex, heading
  Size/LineHeight/Spacing, tag-cloud item Count; table's bespoke
  background picker vs the standard background controls. Fixes F8, F2.

### T3/T5 — full action set, standard icons
- **Violations:** table rows have clone but no per-row delete; tag-cloud
  manager icons lack the title/aria labels sibling managers carry.

### S1/S2 — one shared system; universal chrome universal
- **Violations:** six editors still inline in the 4,300-line card file
  (table, slider, slideshow, headline-rotator, poll-category-list,
  social-share) — S1; table and poll-category-list skip the shared
  Alignment/H-Margin/V-Margin strip entirely (no margins at all), button
  suppresses it and re-rolls four bespoke margin rows — S2; heading
  offers Top/Bottom but no horizontal margin (the renderer doesn't
  support one — needs a wire-or-waive decision).

### S5 — operator-specified layouts are sacred
- **Violation (confirmed in code):** blog-post-list's 6/28 three-column
  layout flattened to stacked strips; the generator cannot currently
  express it. Fix F1 then restore.

---

## 2. The fix plan — violations grouped by root cause

| # | Fix | Kills | Scope |
|---|---|---|---|
| **F1** | Teach the schema generator **multi-column group layout + titled groups** (rows of 1–3 equal columns, per D4), then re-lay-out the stacked panels; restore blog-post-list's three columns (S5) | D1/D2/D3/D5 across ~15 schema panels | generator + per-module schemas |
| **F2** | **Rebuild the shared chrome**: Label row → content-sized strip field; fix `.builder-background-controls-horizontal` to actually be horizontal everywhere (CSS exists only in social's scope today); background mode select → small token | W1/D1/D2/D3/W3 on **every** module | builder-module-card + background-controls + CSS |
| **F3** | **Create the vapor CSS** (or convert those editors to strips): `builder-slider-design-grid` / `item-grid` / etc. have zero CSS anywhere — slider, slideshow, social-share, headline-rotator render as accidental stacks | W1/D1/D2/D4 on 4 inline editors | CSS (overrides layer) or editor conversion |
| **F4** | **Boolean migration**: ~55 Show/Hide-style selects → checkboxes (schema `checkbox` control already exists) | C3 everywhere, plus the C8 boolean split | mechanical, per-module |
| **F5** | **Content-aware select widths**: keep tokens as minimums, let selects grow to longest option (W5 outranks) | L4 systemic crops | one CSS change + token audit |
| **F6** | **Shared project-data picker** (pages / posts / CRM forms / categories) that fills URLs/params automatically | C1/C2 in 10+ modules | one new control + adoption |
| **F7** | **Dead-control decisions**: tag-cloud theater (7), post-tags Linking, post-list postTitle/postSlug/popularityFilter — each is *wire it or remove it*, and post-list's came from the operator's own 6/28 request | C6 | operator ruling, then small PRs |
| **F8** | Retire `BuilderInlineNumberSelect` stretch + raw number inputs → `BuilderNumberSelectControl` everywhere | W3/C8 | mechanical |
| **F9** | **floating-image offsets**: merge the two systems (or clearly split anchor-vs-nudge with distinct wording) | C6/L7/W1 on the worst panel | one module |
| **F10** | **Conformance test for `rendersVia`** — the audit proved some strings are fiction; a test that fails when a schema key has no real consumer would have caught every C6 above | future C6 | test harness |
| **F11** | Add missing controls: toc titleFontSize/titleColor, related-posts cardBorderRadius, quote variant | C7 | small per-module |
| **F12** | Housekeeping: stale current-poll E4 note in check_ui_doctrine.cjs; table per-row delete; tag-cloud icon labels; L3 label rewords; L7 rewords ("X via", Origin units, ↑/↓ titles, internal placeholder URLs); code module double Label; social global-vs-per-item background conflict | assorted | small sweep |
| **F13** | **Chrome-gap repair**: restore universal Background/Alignment/H+V-Margin to ternary-branch modules whose renderers honor them (messaging tag-list, topic-list, …); dedupe navigation's doubled chrome and remove dead `navMarginH`; wire reminder `stripPlacement`; bring topic-list up to its sibling's standard | C7/S2/C6 cluster from misc B | per-module, mostly mechanical |

Suggested order: **F2 → F1 → F3** (layout machinery, biggest visible wins),
then **F4 + F5 + F8** (mechanical sweeps), then **F6 + F7 + F11** (needs
operator input on F7), with **F10** built alongside and **F9/F12** slotted
anywhere.

---

## 3. Per-module record

Verdict lines are FAIL-only plus exemplars; rules not listed passed or were
n/a. Full evidence in the audit transcripts (2026-08-09).

### Batch: admin modules
- **admin-login** — FAIL D1, D3 (lone Forgot-password row), C1
  (successRedirect free-text), C3. EXEMPLAR: only admin panel using
  Advanced correctly.
- **admin-modules** — FAIL L4 ("Hide (read-only)" crops), D1, D3, C3.
- **admin-nav-link** — FAIL C1 (linkHref free-text — literally C2's
  source scenario). EXEMPLAR: minimal compliant panel (D1/W2).
- **admin-site-settings** — FAIL C3. EXEMPLAR: toggle+dependent-field
  row pairing (D1).
- **admin-support-form** — FAIL D1, D2 (worst stack: 8 strips), D3 (3
  orphans), D5 (no group titles across 3 concerns), L4 ("Two columns"),
  C3 ×4. UNCLEAR W1 (full-width heading/intro inputs).
- **admin-team-users** — FAIL L3 ("Show table title"), D3, C3 ×4.
  UNCLEAR D5 (hand-rolled group header). EXEMPLAR: 3-select shared strip.

### Batch: blog modules A
- **blog-author-bio** — FAIL L4 (23ch option in 9.5ch select), D1, D2,
  D3, W3. EXEMPLAR: shared image picker (C8).
- **blog-card-manager** — clean (pointer panel). UNCLEAR C7 (canvas
  designer owns the settings).
- **blog-category-filter** — FAIL L7 (↑/↓ vs "Move left/right"), C1/C2
  (hand-typed label+slug for enumerable categories), C3, D3. EXEMPLARS:
  visibleWhen row pairing; uniform 4-color strip (W2).
- **blog-category-manager** — FAIL C3 ×4, D3.
- **blog-newsletter-subscribe** — FAIL C1/C2 (paste-a-Form-ID), C3, D1,
  D2, D3.
- **blog-post-card** — FAIL L4, C1 (comma categories), C2 (hand URL),
  C3 ×6, C5 (no + Add). EXEMPLAR: Author+Date pairing (D1).
- **blog-post-create** — FAIL L4 ×2 (24ch options), C2, C3 ×8. UNCLEAR
  D5 (hand-rolled subheaders). EXEMPLAR: conditional pairing (D1).
- **blog-post-list** — FAIL **S5 (3-column layout flattened)**, D2, D3,
  C3 ×5, C6 ×3 (postTitle/postSlug/popularityFilter dead — from the 6/28
  request; wire-or-remove is the operator's call), L7.

### Batch: blog modules B
- **blog-post-manager** — FAIL D1, D2, D3, C1/C2 (hand-typed
  edit/view URLs), C3 ×3.
- **blog-post** — FAIL D1, C1 (free-text date; categories), C2 (slug not
  derived from title), C3 ×6, C5. EXEMPLARS: five titled tabs (D5);
  triply-marked active tab (R3).
- **blog-post-tags** — FAIL C3, C5, **C6 (dead Linking group:
  linkToFilter has zero consumers; renderer ignores
  filterParam/targetPageUrl/gap)**, C2. EXEMPLAR: "Linking" as a clearer
  Advanced label (D6).
- **blog-related-posts** — FAIL D3, C1 (free-text date), C2 (hand URL),
  C3 ×6, **C7 (cardBorderRadius honored+seeded, no control)**. EXEMPLAR:
  five-toggle dense row (D1).
- **blog-search** — FAIL D1, D2, D3, C2 (hand-synced param pair).
- **blog-search-results** — FAIL D1, D2, D3, C2.
- **blog-tag-cloud** — FAIL L3, D3, C2, C3, **C6 (7 controls of theater:
  renderer ignores layout/alignment/fonts/colors/Linking — always
  uniform non-linking pills)**, C8 (raw number input), T5 (unlabeled
  icons).
- **blog-toc** — FAIL **C7 (titleFontSize/titleColor honored by preview,
  no control)**, C3, C2 (anchors hand-typed, not derived from post
  headings). EXEMPLAR: "+H2 / +H3" add affordances (C5).

### Batch: misc modules A
- **breadcrumb** — FAIL D1, D3 (lone Align select), C3, L7 (↑/↓ vs
  left/right titles). UNCLEAR L6 (card manager vs column titles).
- **confetti** — FAIL L7 (0.0–1.0 developer units), C8 (raw zIndex
  input), D2. EXEMPLAR: normalizer-wrapped reads/writes (C6).
- **crm-contacts-table** — FAIL C3 ×6, D2, D3, D5 (faked group header).
  EXEMPLAR: exact 1:1 editor↔renderer settings (C6/C7).
- **floating-image** — FAIL **C6 (two offset systems move the image
  through one composed transform)**, L7 (identical hint text on both),
  W1 (five stretched offset rows), D1/D2, L4 ×2, C8. Worst panel in
  misc A.
- **heading** — FAIL C3 ×3, L4 ("Section Heading" crops), S2 (Top/Bottom
  only, no horizontal margin — renderer lacks support; wire-or-waive),
  C8 (raw number inputs beside number selects), W1 (offset rows), D3.
  EXEMPLAR: preset writes three settings atomically (C2).
- **image** — FAIL D1, D3 (lone Width strip). Honest verdict: exemplar
  for widths/controls (W1/W3), not for density.
- **feature-cards** — FAIL W3 (Icon input token sizes only selects), D2.
  UNCLEAR C1 (icon glyph → picker?), L6, T1. EXEMPLARS: real checkboxes
  (C3); theme-resolved color control (C8).
- **current-poll** — no failures found. EXEMPLAR: packed
  Width/Alignment/H/V margin strip (S2/D1). (Stale E4 note about it in
  check_ui_doctrine.cjs — F12.)

### Batch: inline editors + shared chrome (builder-module-card.tsx)
- **Shared chrome (every module)** — FAIL **W1 (Label input stretches
  full panel)**, **D2 (Background block renders single-column — its
  horizontal CSS exists only in a social-only scope)**, D1, D3 ("Clear
  background" orphan), W3 (mode select stretched). EXEMPLAR: the
  Alignment/H-Margin/V-Margin strip is exactly right — the rest of the
  chrome should look like it.
- **table** — FAIL C8 (bespoke background picker), W3 (stretched Max
  Width), T3 (no per-row delete), **S2 (excluded from chrome: no
  alignment or margins at all)**, S1.
- **slider** — FAIL **D4 (vapor CSS: its grid classes exist nowhere)**,
  D2, W1, W3, S1.
- **slideshow** — FAIL D3, D4 (vapor CSS), W1, W3, L3, S1.
- **headline-rotator** — FAIL D1 (12-row single-column stack), W1, C3
  (checkbox and Off/On select in one panel), D6 (shadow fields visible
  with shadow off), S1. EXEMPLAR: the titled item table (L6).
- **poll-category-list** — FAIL D1 (8 stacked rows), D2, W1, W3, D3,
  **S2 (no chrome: bespoke alignment, no margins)**, S1.
- **social-share** — FAIL D1, D4 (vapor CSS), W1, W3, L7 ("X via"), S1.
- **text** — FAIL S1 (inline). EXEMPLAR: preset width select (C1).
- **button** — FAIL C3 ×3, W1 (label row), **S2 (chrome suppressed,
  four bespoke margin rows re-implement it)**. EXEMPLAR: the only true
  two-column layout (D4) — proof the pattern works.
- **video/quote/code** — FAIL D1 (single-column grid by design), W1,
  D3, **C6 (code: two "Label" fields, same placeholder, one panel)**,
  S1. UNCLEAR C7 (quote variant unreachable).

### Batch: misc modules B
- **messaging-tag-list** — FAIL L4 ("Blog Search Results" crops), D2, D3,
  **C7/S2 (renderer honors margins+background; editor offers neither and
  the type bypasses the universal chrome)**. EXEMPLAR: Destination
  dropdown auto-fills targetPageUrl — C2 done right.
- **messaging-topic-list** — **the un-upgraded sibling: 11 failing
  rules** — L4, L7 (internal `/builder-preview.html` placeholder), D1,
  D2, D5 (scrambled group order), W1, W3, C1/C8 (free-text URL where its
  twin has the dropdown), C3, C6 (Active color hardcoded over by the
  preview), C7/S2 (chrome gap).
- **reminder** — FAIL L4 ("Speech Bubble" crops), D3 ×2, C7
  (stripPlacement honored by renderer, never writable from the Builder —
  reminders locked to "top"). EXEMPLAR: hand strips that keep doctrine
  group order with comments.
- **speech-bubble** — FAIL D2, C7 (renderer honors borderRadius; no
  control). EXEMPLAR: bounded signed-offset inputs (W3).
- **tractor-nav** — FAIL **W4 confirmed ×3** (Inner Opacity, Transition,
  plus the unbooked Curve slider — mechanism: `text-md` CSS sizes only
  `input[type=text]`, so range inputs have no width rule at all), L4
  ("Power Curve"), D2, D3.
- **navigation** — FAIL **C6/S2 (doubled controls: falls through to the
  universal chrome AND renders its own second Background, second
  Alignment, and second margin pair; `navMarginH` is written and read by
  nothing)**, L4 ×2, D1 (three stacked color rows), D5 (Style panel
  before Links content), W1 (color rows stretch). UNCLEAR: C2 for the
  Links grid (operator ratified hand-typed Page Name/Slug on 7/1 — his
  call), T1 (no search on a list that reaches dozens of rows), L3/L7
  ("Pad V"/"Pad H"). EXEMPLAR: the 7/1 column-titles directive is intact
  and verified (L6).
- **crm-form** — FAIL W1 (legacy field + fullWidth color rows), D1.
  UNCLEAR C7 (renderer honors many styles the panel doesn't expose —
  presumably owned by Builder › CRM › Forms). EXEMPLAR: picking a form
  auto-writes its style snapshot — C2 at its best.
- **social** — FAIL W3 (inline number selects stretch flex:1), W1
  (setting-row grids + platform cards stretch), **C6 (global "Icon BG"
  silently overrides every per-item Background — once set, per-item
  pickers change nothing, no indication)**, D5 (advanced details sits
  above the Platforms content).

---

## 4. Headline numbers and late findings folded into the plan

- **~55 surfaces audited** across 6 batches; only **current-poll** came
  through with zero failures. **Every panel with short fields inherits
  D2** until F1 lands; **every module inherits the chrome's W1/D2** until
  F2 lands.
- **The legacy trio is the W1/W3 engine** (misc-B finding): nearly every
  stretch failure traces to the CSS of `BuilderSettingRow`,
  `BuilderThemeColorSettingRow`, and `BuilderInlineNumberSelect` — three
  components, four+ modules each. Folded into **F2/F8**.
- **The ternary-branch chrome gap** (new fix **F13**): modules whose
  settings component takes over the module-card ternary (messaging
  tag-list, topic-list, and siblings) silently lose the universal
  Background/Alignment/H+V-Margin chrome while the renderer keeps
  honoring those settings — controls the operator can no longer reach.
  Restore the chrome (or add the pair) per module; and **navigation has
  the inverse bug — it gets the chrome AND its own duplicates** (dead
  `navMarginH` included): dedupe as part of the same fix.
- **L4 is mechanically checkable** (misc-B insight): a checker comparing
  each select option's label length against its declared width token
  catches every crop found in this audit. Added to **F5**.
- **W4's mechanism**: `text-md` sizes only text inputs, so range sliders
  have no width rule anywhere — bound `input[type="range"]` in the strip
  CSS and all three tractor-nav sliders are fixed at once.

---

## Progress log

- **2026-08-09 (operator rulings, same day as audit):**
  - **L6→card managers (ruled: yes):** breadcrumb + feature-cards
    converted to `.builder-item-grid` titled-column grids (real CSS grid,
    exact header alignment; spanning sub-row for image/alt/description).
    Breadcrumb's ↑/↓ buttons retitled Move up/down (L7 fix). New generic
    classes are the successor to the nav grid — future managers adopt
    them, not a third system.
  - **Heading H margin (ruled: add capability):** wired end to end —
    `getModuleMarginStyle` now applies horizontal margin, heading
    normalization clamps it, paired "H Margin" control added. E4 now
    gates repo-wide (`--all`), with the Top/Bottom split accepted as the
    vertical side and settings-key-aware detection (bare `marginTop:`
    inline styles don't count).
  - **blog-post-list dead fields (ruled: wire up):** `postTitle` renders
    as the list heading; `postSlug` names the post-view page (links
    become `/<slug>?post=<post-slug>`, legacy `postPageUrl` still wins
    when set — no saved page moves). `popularityFilter` removed: posts
    have no view/like data anywhere, so wiring requires the tracking
    feature first — ClickUp 86bbb075p (Dev Backlog). Labels clarified
    (List Title / Post Page) resolving the L7 flag.

- **2026-08-09/10 (the layout wave — F1/F2/F3/F5/F8 partial/W4):**
  - **F1 done:** generator supports titled groups, 1–3 column group
    splits, and `panelColumns` (groups side by side, doctrine order
    left→right). 11 generator tests.
  - **F2 done:** shared chrome rebuilt — Label row content-sized;
    Background renders as a genuinely horizontal field strip everywhere
    (was single-column: its horizontal CSS existed only in a social-only
    scope); Clear rides the strip; mode select token-sized.
  - **F3 done:** the vapor grid classes now exist (auto-fit column grids
    in the overrides layer) — slider/slideshow/social-share/
    headline-rotator render their intended layouts for the first time.
  - **F5 done:** select tokens became minimums; selects auto-size to
    their longest option — every audited L4 crop clears at once.
  - **W4 done:** range inputs bounded (200px) in strips — all three
    tractor-nav sliders fixed by one rule.
  - **F8 partial:** `BuilderInlineNumberSelect` no longer stretches
    flex:1 (CSS override); replacing raw number inputs continues later.
  - **Panel re-layouts applied** (D1/D2/D3/D5) to: blog-post-list (**S5
    three-column layout RESTORED**: General | Page Design | Card
    Appearance), admin-support-form (three titled groups, two columns),
    admin-login/modules/team-users, author-bio, newsletter-subscribe,
    category-manager, category-filter, search, search-results,
    post-manager, post-tags, tag-cloud, confetti, crm-contacts-table
    (real "Row actions" titled group), image (schema-converted),
    breadcrumb, messaging-tag-list, speech-bubble, tractor-nav.
  - Verified by driving the app headless and screenshotting tractor-nav,
    blog-post-list, and admin-support-form — panels fill their width in
    columns; no orphans; no cropped options. Screenshots on the
    operator's Desktop ("AFTER - …").

- **2026-08-10 (F4 — boolean migration, complete):** all ~55 Show/Hide,
  Yes/No, On/Off, and None/Show selects converted to checkboxes across 22
  files — every schema panel, the strips-based blog-post Display tab, the
  button design editor, breadcrumb, heading (Italic/Underline/Outline),
  headline-rotator's Drop shadow, and the hand-written messaging
  topic-list. Stored values byte-identical everywhere ("true"/"false",
  same fallbacks); option-label nuances preserved as checkbox tooltips
  per L7 ("Hide (read-only)", "Hide (use logged-in user)", "No (uses
  default)"). Two-option MODE selects (grid/list, stacked/inline,
  two-column/stacked, draft/published, left/center) correctly stayed
  selects — they are choices, not booleans. C3 status: clear.

- **2026-08-09/10 (F6 — the shared project-data picker, complete):**
  `builder-project-data-picker.tsx` + schema `picker` control (sources:
  pages / posts / crm-forms; valueKind path / slug / id; session-cached
  fetch; degrades to a text input on fetch failure; unknown saved values
  render in Custom mode untouched). Adopted at 12 fields across 11
  modules: admin-nav-link linkHref, admin-login successRedirect,
  blog-search + search-results + post-manager (×2) + post-tags +
  tag-cloud + category-filter page targets, messaging-topic-list feed
  URL, blog-post-list postSlug (slug kind), newsletter CRM Form (id
  kind). Stored formats unchanged everywhere. Also removed a duplicate
  Headline control the layout wave left in newsletter-subscribe (C6).
  C1/C2 status: page/form targets clear; remaining C2 items (post-card /
  related-posts per-item post fills, blog-post slug-from-title, toc
  anchors-from-headings) are richer derivations — future work, noted.

- **2026-08-10 (F13 — chrome-gap repair, nav dedupe, reminder placement):**
  - **The mechanism, found and fixed:** the universal chrome (Background /
    Alignment / H+V Margin) was the ELSE branch of the ~30-way
    settings-editor ternary in `builder-module-card.tsx`. The day a module
    gained its own settings component it silently stopped offering that
    chrome — while the renderer kept honouring the settings
    (`getModuleOuterSpacingStyle` + `getBuilderBackgroundStyle`). Extracted
    the chrome to `sharedModuleChrome` and rendered it for the 26 affected
    modules (breadcrumb, 16 blog, 2 messaging, crm-contacts-table, 6
    admin). C7/S2 for those: clear.
  - **Deliberate non-members** (documented in code): current-poll / social /
    crm-form (own background+margins), heading / floating-image (own chrome
    blocks), button / table / poll-category-list / reminder (bespoke or
    opted out), tractor-nav / confetti (fixed-position overlays).
  - **Navigation dedupe:** `navMarginH` removed (written, read by nothing —
    C6); its second Background `<details>` removed (edited the SAME keys as
    the chrome's control — E6; `NavigationModulePreview` reads them
    directly, which is why the wrapper skips them). `navAlignment` and
    `navMarginV` KEPT — verified live at builder-template-preview.tsx:5103
    -5104 and scoped to the menu inside the nav, not the module box —
    relabelled "Menu Alignment" / "Menu V Margin" so the two live scopes
    read differently (L7). Its three full-width colour rows became one
    strip (D1/W1).
  - **Reminder placement wired (C7):** `resolveReminderStripPlacement` has
    always honoured `stripPlacement`, but `buildReminderModuleMetadata`
    never wrote it — Builder strips were locked to the top of the screen.
    Threaded through the record type, parser, factories, serializer and
    metadata, with a strip-only "Placement" control and 3 round-trip tests.

- **2026-08-10 (sweep A — columns by DEFAULT):** the operator looked at
  Navigation after F13 and said it still looked terrible. He was right,
  and the measurement was damning: the layout wave built the column
  capability and applied it to **8 of 38** editors. 30 still stacked; 7
  hand-written editors (Navigation among them) could not use
  `panelColumns` at all.
  - **The fix is a default, not a sweep:** `derivePanelBlocks` in the
    generator arranges groups side by side automatically. Consecutive
    *narrow* groups pair up; a *wide* group (any `full` field or bare
    block — item managers, textareas) keeps the full width **in its own
    place**, so doctrine order (E3) is never reordered to make columns
    happen. Explicit `panelColumns` still wins; `[]` opts out. An
    opt-in layout rule gets forgotten — a default cannot be.
  - **The universal chrome now flows** instead of stacking: Background +
    Alignment + H/V Margin share one wrapping row on every module.
  - **Navigation** (hand-written) gets the same two-column treatment by
    reusing the generator's column classes rather than inventing a third
    layout system.
  - Measured after: post-list 3 columns, tag-cloud / team-users /
    support-form / confetti / tractor-nav / navigation 2 columns each;
    Navigation's panel is ~25% shorter, support-form went from 8 stacked
    strips to two titled columns.
  - Still hand-written and un-columned (dominated by wide item managers,
    so columns buy little): blog-post (already tabbed), crm-form,
    feature-cards, messaging-topic-list, reminder, social.

- **2026-08-10 (D8 axes — every module reorganized by logical axis):**
  the operator ratified B2 alignment and gave the axis concept using
  Navigation's own grouping. Applied everywhere:
  - **Generator**: `axes: [{ title, strips }]` — each axis is a titled
    column, declaration order left→right. **More than four throws**, so a
    fifth axis cannot pass silently. An axis whose fields are all hidden
    by `visibleWhen` drops out (heading in compact mode renders three).
  - **B2 alignment**: inside a panel column each field is a two-track
    grid (fixed label column + control), auto-filling — a narrow axis
    column holds one pair, a wider one holds two. Alignment without
    surrendering D2.
  - **~38 modules converted.** None needed five axes. Two reached four
    only by bending one control off its canonical column, flagged for
    the operator: heading (Level on Text, not Structure) and
    speech-bubble (Text Color on Frame, not Text).
  - **Toggle pairing, made consistent**: a toggle that gates ONE sibling
    field stays beside it (usually Content); a toggle that gates a whole
    region stays on Structure. Three batches had split them; a
    correction pass unified six admin/CRM panels.
  - **Legacy `BuilderSettingRow` blocks inside axis columns** (drop
    shadow, offsets, heading's chrome alignment) rendered oversized dark
    labels that overlapped their inputs — caught by screenshotting the
    converted heading panel, fixed with a compact treatment scoped to
    panel columns. Heading and floating-image chrome now flow like the
    universal chrome.
  - `messaging-topic-list` was fully converted from hand-written strips
    to the schema generator in the process; `card-manager` was left
    alone (it has no controls, only a pointer note).
  - **Open, recorded in D8**: the operator's own question — border
    settings arguably belong to **Themes**, not per module. If that
    lands, most Frame axes empty and those modules drop to three.

- **2026-08-10 (A-rules — Advanced as the home for theme overrides):**
  the operator's call: *"anything that is a theme override would be
  included in the Advanced settings"*. Infrastructure first, module
  division to follow.
  - **New rules A1–A4** in UI_RULES.md: overrides live in Advanced (A1);
    a theme override is empty by default and shows the theme's value with
    one-click reset, never a pre-filled hex nobody chose (A2); the
    Advanced summary reports how many settings currently override the
    theme, so a collapsed override cannot silently look like a theme bug
    (A3); Advanced is not a junk drawer for controls that did not fit a
    column (A4).
  - **Generator**: new `control: "theme-color"` with `themeDefault`
    (wraps the existing `BuilderThemeColorControlWithDefault`, which
    already had the swatch + reset + hint), plus `countThemeOverrides`
    driving the summary badge.
  - **Demonstrated on Navigation**: its three colours moved out of the
    Text axis into Advanced, each reading "theme" until overridden. The
    renderer already did `navColor || undefined`, so empty genuinely
    means the theme decides — this made the existing semantics visible
    rather than changing them.
  - Next: decide which settings across the 38 modules are theme-backed
    and move them, per the operator's sequencing.

- **2026-08-10 (operator feedback on the Advanced screenshot — 5 items,
  all applied):**
  1. **Headings bold, a step larger, dark blue** — plus new rule **R9**:
     high contrast between text and background, every heading inside an
     editor the same dark blue. Tokens `--builder-editor-heading` /
     `--builder-editor-label` so the pair moves together.
  2. **Field labels** take that same dark colour and weight at normal
     size. (Two stale muted rules of my own were overriding the new one —
     removed, so a single rule governs.)
  3. **Advanced is now PER AXIS**: each axis may declare its own
     `advanced` strips, and the Advanced region uses the SAME column
     tracks as the basic row, so an advanced control sits under its own
     heading. Axes with nothing advanced hold their position but render
     no heading. Below 1100px the tracks collapse and wrap.
  4. **Rule W7 — the four spacing controls have exactly four names**:
     Vertical Margin, Horizontal Margin, Vertical Padding, Horizontal
     Padding. `spacingFields()` emits them so labels cannot drift;
     `marginFields` relabelled. Navigation's "Pad V/Pad H/Menu V Margin"
     updated.
  5. **Rule A5 — offsets live under Placement → Advanced.** Applied to
     heading as the worked example.
  - Two defects caught by screenshotting the result: the longer canonical
    labels **cropped** at the fixed 116px label track (L4 violation I had
    just introduced) — the track now sizes to its longest label, exactly
    as W5 says L4 outranks uniformity; and three labels stayed muted
    because of my own earlier CSS.
  - Still to sweep: canonical spacing names and offsets-to-Advanced
    across the remaining modules, and deciding which settings are
    theme-backed (A1) module by module.
