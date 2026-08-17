# The Explore page — `/explore`

The public product tour on starcaster.pro. Reached from the big **Explore →**
link under "Less broadcasting. More real connection." on the login screen.

| Piece | File |
|---|---|
| Page markup | `public/explore.html` (hand-authored; `pin:assets` stamps its `?v=`) |
| Styles | `src/css/_explore.css` (imported by `src/css/main.css`) |
| The Explore link | `src/layout.html` + `.auth-intro-explore` in `src/css/_auth.css` |
| Screenshots | `public/images/explore/01..10-*.webp` |

`/about` was the first version of this page. It is now a redirect stub to
`/explore`; the original copy is in git history at `3d0a4cd`. It referenced
eleven screenshots under `/images/screenshots/` that were never created, so it
had been serving eleven broken images for as long as it was live.

## Regenerating the screenshots

The shots are taken from the real app driven by Playwright, against the **local**
Supabase stack — never production, and never a real person's contact record.

Two sources, deliberately:

- **Real client project (Marinoff & Associates)** for the Builder screens —
  canvas, module library, saved-section dialog, publish queue. Those show a
  client's own public website content, which is already public.
- **Seeded demo projects** for anything involving people or messaging —
  Riverside Dental Group, Cascade Trail Outfitters, Halden & Roe Architects,
  Brightwater Community Trust. Every name, address, and domain in them is
  invented and uses `example.com` / `.example`.

| Shot | Screen | Project |
|---|---|---|
| 01 | Builder → page editor → Workspace, one section expanded | Marinoff |
| 02 | Builder → cell → `+` → Module Library | Marinoff |
| 03 | Builder → Themes | Marinoff |
| 04 | Builder → Workspace → section 💾 "Save section" | Marinoff |
| 05 | Builder → page editor → Publish panel | Marinoff |
| 06 | Settings → Projects (reached by clicking the menu, see note) | Marinoff |
| 07 | Builder → Site Import, with a job selected | Halden & Roe |
| 08 | Contacts | Riverside Dental |
| 09 | Messaging → Content | Riverside Dental |
| 10 | Promote → Social | Riverside Dental |

Notes that cost time the first run:

- **`App.setActivePage(id)` is not enough for every screen.** Settings → Projects
  and Messaging → Content only populate when their menu item is actually
  clicked; navigating by id renders the page frame with an empty table.
- **Builder → Pages is `builderManagePagesPage`**, reached by clicking the
  "Pages" pod on the Builder hub — `builderPagesPage` never becomes visible.
- **Switching project mid-session is not reliable for a screenshot.**
  `switchSessionProject` updates the header but leaves the previous project's
  rows on screen. Switch, then reload the page, then assert the project name
  before taking the shot.
- **Messaging content does not live in `content_items`.** The library is
  assembled client-side from the per-format tables (`messaging_headlines`,
  `messaging_taglines`, `messaging_posts`, `messaging_tweets`, `messaging_ctas`,
  `messaging_subheadings`), each with its own text column.
- **Site Import needs `docs/SQL/site_import_setup.sql` applied locally**, or the
  screen shows a red "table not in schema cache" error.

Capture at 1600×1050, then downscale to 1440 wide and convert to WebP at
quality 82 (`sharp`) — that keeps all ten images to roughly 535KB total.

Finally: **look at every image before shipping it.** The first Contacts capture
came out showing two real people with real Gmail addresses because the project
switch had silently not taken effect.
