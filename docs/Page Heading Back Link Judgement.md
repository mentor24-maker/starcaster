# Page heading back links — judgement calls

Quiet parent navigation uses `public/js/pageHeadingNav.js` and `a.page-heading-back-link` in `h2` headings (no underline, hover, or color change).

Applied automatically where the parent target was unambiguous. **Review and decide** for the pages below.

## Two equally valid parents (pick one link target)

| Page / section | Current back buttons | Suggested link text | Options |
|----------------|---------------------|---------------------|---------|
| `messagingCreateContentPage` | Back To Content, Back To Messaging | ? | `Messaging: Content` via `openContentLanding`, or `Messaging` hub (`messagingPage`) |
| `messagingManageContentPage` | Back To Content, Back To Messaging | ? | Formats landing vs content library |
| `messagingContentTypesPage` | Back To Formats, Back To Messaging | ? | `Messaging: Formats` vs `Messaging` hub |
| `contactPersonasLandingPage` (personas hub) | Back To Personas, Back To Contacts | ? | Personas list vs main Contacts |
| `editContactPersonaPage` | (was Personas + Contacts) | Done → Personas only | Confirm Contacts should not be second escape |
| `assetsCategoryHubPage` | Back To Categories, Back To Assets | ? | Categories list vs Assets hub |
| `developThemesBuilderPage` | Back To Themes, Back To Builder | ? | Themes list vs Builder hub |
| `developAgentPresetPage` | Back To Agents, Back To Builder | ? | Agents list vs Builder hub |
| `developLandingPagePreviewPage` | Back To Pages, Back To Builder | ? | Pages list vs Builder hub |
| `developLandingPageVisualPage` | Back To Pages, Back To Builder | ? | Same |
| `settingsProjectDetailPage` | Back To Projects, Back To Settings | ? | Projects list vs Settings hub |

## Dynamic or contextual title (heading text varies)

| Page | Notes |
|------|--------|
| `addAssetPage` | `assetFormTitle` toggles Add / Edit Asset — link label should stay **Assets**; confirm edit mode still reads well |
| `viewContactPage` / `editContactPage` | Linked as **Contacts: View/Edit** — confirm vs showing contact name in `h2` |
| `campaignsPage` create flow | **Campaigns: Create** — OK? |
| `channelsEditPage` | **Channels: Edit** — OK? |

## Not yet converted (still use Back To buttons)

| Area | Examples |
|------|-----------|
| **Acquire / YouTube** | Edit run, bulk edit runs, topic edit, categories — multi-level tree |
| **Docs** | Each doc article → Back To Docs (many pages in `docs.html`) |
| **Training** | Sub-pages with Back To Training |
| **Engage** | Sub-pages |
| **Misc** | Hub sub-pages |
| **Settings** | Partial — project flows need judgement above |
| **Develop** | Landing page editor, thank-you, forms, templates, extension tools (Icon Builder, Screenshot, Thumbnail) |
| **Messaging** | Inline `h3` panels (Create Topic/Tag inside list pages), `messagingCreateContentPage`, formats/content-types hubs |
| **Dev Agent** | `devAgent.html` session UI |
| **Legal** | Privacy / Terms (may not need parent link) |

## Implemented patterns (reference)

1. **Module list pages** — `Messaging: Tweets` → `<a …>Messaging</a>: Tweets` (parent = content library).
2. **Child app-pages** — `Bulk Edit Headlines` → linked **Messaging: Headlines** only.
3. **Inline edit panel (tweets)** — hide `#messagingTweetsPageHeading` while edit open; panel `h2` links back via `messaging.closeTweetEdit`.

## Adding a new back link

```html
<h2><a href="#" class="page-heading-back-link" data-back-page="parentPageId">Parent: Title</a></h2>
<!-- or -->
<h2><a href="#" class="page-heading-back-link" data-back-click="messaging.openContentLanding">Messaging</a>: Subpage</h2>
```

Register new click handlers in `public/js/pageHeadingNav.js` → `CLICK_HANDLERS`.

After HTML changes: `npm run build:html` and hard-refresh.
