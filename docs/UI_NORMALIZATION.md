# UI normalization — where every editor stands

*Surveyed 2026-11-06 against `main` at `49f904e`, task 86bcypx0u. Read from
the source code; nothing was rendered, so a size marked "undetermined" means
the code alone could not settle it.*

The UI normalization epic began with the CRM form editor (Dane, 2026-11-04:
*"These are just some of the normalizations we need to make on this page, and
we need to get all the other editors in Starcaster normalized with each
other"*). It was then built as cross-screen tickets rather than one per
editor. As of this survey all ten are merged (1–10: #976, #977, #978, #979,
#981, #983, #984, #986, #988, #989). One more, 11 (form boxes, buttons and
table heading rows 2px shorter, #992), is still an open pull request and is
not counted here; it changes padding only, so it should not move any row.
This page answers the question that comes next: **editor by editor, what
still does not match the merged rules?**

## The rules (as merged in `docs/UI_RULES.md`)

| # | Rule | Where it is written | What "conforms" looks like |
|---|---|---|---|
| 1 | **Three heading levels, one size each** | R10, R12 | Column/card title `.editor-title` (`--editor-title-size`, 20px, 800). A section inside it `.editor-item` (`--editor-item-size`, ~17.6px, 700). Every setting's label `.editor-subitem` (`--editor-subitem-size`, ~14.4px, 700). No spaced capitals, no pill badges, no hand-picked sizes. |
| 2 | **Every column has a column title** | R10 (the Form Actions title, #967) | A multi-column editor names each column. |
| 3 | **Colour pickers on their label's line** | #963 | The swatch sits beside its label, not on a line of its own. |
| 4 | **Save is green, in one place** | C9 buttons, #950/#963 | `btn btn-save` (Builder: `submit-button admin-save-button`). On the CRM form editor it is centred under the Preview column. |
| 5 | **One title row** | R11 | `.page-heading-row` with one `h2` and its buttons, at most one `.page-heading-desc` line. Nothing below the title is bigger than it. |
| 6 | **Four button kinds, one main action per screen** | C9 (buttons) | Secondary `btn`, main `btn btn-primary`, save `btn btn-save`, delete `btn btn-danger`. The one blue button is the "Create …/Add …" in the title row. |
| 7 | **Switching views is a tab** | C9 (tabs) | `.tab-bar` / `.tab-btn`, never a button. |
| 8 | **Boxes sized by what goes in them** | W7 | `field-w-number` / `field-w-short` / `field-w-long` outside settings panels. |
| 9 | **Say each thing once** | S7 | No list shown on two screens, and no button that leads back to the screen it is on. |
| 10 | **A short setting keeps its label beside the control** | L9 (#984) | A colour, toggle, number or dropdown is one row, label left; a text box takes its label above. Plain admin markup: `.standard-form-grid.form-grid-beside` (and `.form-field-above` for a text box); CRM form editor: `.crm-form-editor-setting-beside`; Builder: `BuilderSettingRow`. No label wraps past two lines at 1440 wide, and no second caption beside a checkbox repeating its label. |
| 11 | **One table look, headings that stay put** | T11 (#986) | The `_tables.css` look — black heading bar with bold white text, light-blue filter row, data rows 0.5rem top and bottom — inside `.table-wrap`, which caps the table at the screen's height and pins the heading row. No inline `style=""` on a `<table>`, `<thead>`, `<th>` or `<td>`. |
| 12 | **Messages once, in one strip** | S9 (#988) | Every admin message goes through `App.notify` / `App.components.Toast` into `#appMessageStrip`, under the header. No second message surface; the one exception is `App.components.SavedNotice`. |

**Sizes in the tables:** *none* — already conforms · *small* — a class or two ·
*medium* — several elements in one file · *large* — restructuring, or React
component work.

## Five causes behind most of what follows

Fix these once at the source and most of the rows below shrink to *small*
or *none*:

1. **A bare `<h3>` is 24px — the same as the page title.** `src/css/_typography.css:12`
   sets `h3 { font-size: 1.5em }`. Every card heading written as a plain `<h3>`
   (dozens, on nearly every screen) breaks rules 1 and 5 at once.
2. **Form labels are 15.2px at weight 600, not the sub-item size.**
   `.standard-form-grid > label` is 0.95rem/600 (`src/css/legacy.css:548`).
   L9 (#984) moved labels to the left on the four forms that now carry
   `.form-grid-beside` (Settings › Database ×2, Settings › APIs attempt log,
   Training › Context filters) but left their size alone, so this cause is
   still open everywhere.
   Other label rules vary too: `.form-group label` 1.25rem (`_forms.css:53`),
   Training labels 1.15rem/800 (`legacy.css:246`), the Builder's `.field > span`
   0.94rem in muted grey (`_builder-react.css:2029`).
3. **Every box is full width.** `legacy.css:560` gives every form input
   `width: 100%`. The W7 classes are used on one screen only (Training ›
   Rules/Guides) plus the Themes name box. **Partly fixed by L9:** on a
   `.form-grid-beside` form, dropdowns and number boxes now size to their
   content (`_forms.css`), but text boxes still stretch, and only the four
   forms named under cause 2 use it.
4. **"Update …" buttons are blue.** Roughly twenty edit screens submit with
   `btn-primary` "Update X". Under rule 6 a button that saves is green, so
   each of those screens shows a second blue button.
5. **The Builder's "add" buttons are green.** `admin-blog-add-button` makes
   Archive, Bulk Create and New Page in the Builder workspace's Pages list all
   green (`components/builder/builder-page-list.tsx:590–606`), so green there does
   not mean "save".

## Admin screens

### CRM — `src/pages/crm.html`, `src/css/_crm.css`

| Editor | What differs | Size |
|---|---|---|
| Form editor `#crmFormEditorPage` | The reference screen; conforms, including L9 since #984 (dropdowns and the width slider are on their label's row). (The Form Fields row labels are weight 600, but they are list rows rather than settings.) | none |
| Contacts / Forms tab panels | "+ Add Contact" and "+ New Form" sit inside each panel with inline margins, not in the title row. | small |
| Field Config `#crmFieldsPanel` | No section title. Its header bar already matches T11's black heading look, but it is a grid of `<div>`s rather than a `<table>`, so its own 0.9rem text size and the sticky heading do not come from `_tables.css`. Save Field Config is green but at the bottom-left with an inline style. | small |
| Set Up CRM `#crmSetupPage` | CRM Name width is an inline `max-width:320px` rather than `field-w-short`; "Generate CRM" is blue at the bottom-left. | small |
| Add/Edit Contact `#crmAddEditContactPage` | Inline `max-width:480px`; labels have no sub-item class; Save is at the bottom-left. | small |

### Contacts — `src/pages/contacts.html`

| Editor | What differs | Size |
|---|---|---|
| Contacts list: CSV mapper and Save as Segment | "CSV Upload + Field Mapper" and "Column Mapping" are bare 24px `<h3>`; "Save as Segment" is an `<h4>` with an inline 1.4rem/800; Analyze CSV and Import CSV are blue next to the title row's Add Contact, so the screen has three main actions. | medium |
| Settings `#contactsSettingsPage` | The three columns are an inline grid; each card title is a bare 24px `<h3>`; "Add New Option" is a bare `<h4>`; "Add Option" is blue inside the body. | medium |
| Peer Sites form and Candidates | No form title; full-width URL and title boxes; Save is at the bottom-left; Candidates heading is a bare `<h3>`. | medium |
| Peer Site Details | Mostly read-only; six card headings are bare `<h3>`. | small |
| Personas: inline create | "Create Contact Persona" sits in a second title row with its own Back button, so it reads as two titles. | small |
| Edit Persona | "Update Persona" is blue (it saves), and Create Persona is also blue in the title row. | small |
| Add Contact `#addContactPage` | Both column titles use `.add-contact-split-heading`, a hand-picked 1.25rem/700; "Add to This Project" is blue; every box is full width. | medium |
| Edit Contact `#editContactPage` | Left column has no title; right-panel headings are uppercase with letter spacing, grey, 0.9rem; Update Contact and Invite Contact to Project are both blue, and there is no green Save. | medium |
| Clone Contact | No form title; full-width boxes; Save at the bottom-left. | small |
| Explore: Save as Segment | The same form as the list page, but here it submits with a blue "Create Segment" while the list page uses a green "Save Segment". | small |
| Segments list / Segment editor | "Segment Editor", "Segment Details", "Contact Filter Rules", "YouTube Target Parameters" are bare `<h3>`; the active segment name is an inline 1.2rem heading; Minimum Score is a full-width number box; Save sits in the title row here and at the bottom on every other Contacts form. | medium |

### Campaigns — `src/pages/campaigns.html`

| Editor | What differs | Size |
|---|---|---|
| Channel Field Rules | Card styling is all inline; a bare `<h3>` plus inline `<h4>`s across two columns; Save at the bottom-left. | medium |
| Create/Edit Campaign `#campaignForm` | "Mechanics", "Content" and "Preview" are bare `<h3>`s with no column title over the left column; every label is `<strong>X:</strong>` with a colon on its own 140px grid; "Create Campaign" is blue and centred under the left column; the columns are an inline grid with a 100px gap. **Also a defect:** the Lead Magnet row appears twice, both selects carrying `id="campaignLeadMagnetSelect"` (lines 384 and 403). | large |

### Messaging — `src/pages/messaging.html`

| Editor | What differs | Size |
|---|---|---|
| Create Content | The form column has no title; "Generated Options" is a bare `<h3>` in a nested title row; labels are `<strong>X:</strong>`; three or four green Saves on one screen (Save Prompt, Save Content, Save Selected, Save Generated Draft); two Back buttons in the title row that do the same thing. | large |
| The same creator on Tweets, Posts, Pitches, Headlines, Sub-headings, Taglines | The Create Content pattern repeated six times: an untitled form column, a bare "Generated Options" `<h3>`, two or three green Saves, and the title row holding two blue buttons ("Import from Web Pages" plus "Add/Create …"). | large (one pattern, six copies) |
| Tweet / Post edit (three columns) | Form column untitled; "X Preview" / "Post Preview" / "Associations" titles at a hand-picked 1.05rem; "Update Tweet" / "Update Post" are blue at the bottom-left; the panel prints its own `<h2>` title row (undetermined whether the page title hides while it is open). | medium |
| Associations panel (React, `components/associations/associations-panel.tsx`) | Group headings are uppercase with letter spacing, grey, 0.82rem — written in two stylesheets. | small |
| Headline edit | Same as Tweet edit in two columns; "Update Headline" and "Associate Checked" are both blue. | medium |
| Articles, Reports, White Papers, eBooks (add + edit) | Boxes have no labels at all, only placeholder text; add forms have no title; "Edit X" and "Saved X" are bare `<h3>`; Update is blue. | large |
| Pitch / Sub-heading / Tagline inline edit | Bare `<h3>` in a nested title row; unlabelled controls; Update is blue. | medium |
| Content Formats | Placeholders, no labels; stray `<div>`s break the markup (lines 284–286). | small |
| Hashtags | No labels, no title. | small |
| Topic / Tag create panels | Bare `<h3>` in a second title row with its own Back button; the Tag screen has three blue buttons. | small |
| Edit Topic / Edit Tag | "Update …" is blue beside the title row's blue "Create …". | small |
| Bulk edit (Pitches, Headlines, Topics, Tags, Taglines) | The `<h2>` is only a back link with no screen name; Apply is blue; Pitches uses a different form layout (`.stack-form`) from the other four. | small |

### Engage / Promote — `src/pages/engage.html`, `polls.html`, `promote.html`

| Editor | What differs | Size |
|---|---|---|
| Promote: Email `#engageEmailPage` | Form column untitled; "Email Preview" is a tiny uppercase eyebrow (0.76rem, spaced); no main action at all — Send Now is a plain button here and blue on the Social screen; Subject is full width. | medium |
| Promote: Social `#promoteSocialPage` | `<strong>Campaign:</strong>` labels; inline `max-width:600px`; "Queue & History" and the failure dialog title are bare `<h3>`. | small |
| Outreach wizard (React) | Pace labels have no size token; number boxes use their own `5em` / `18em` instead of the W7 tokens; stage headings are a `<strong>` inside a `<p>`. | small |
| Reddit comments (React) | Labels 600 weight with no token; three blue buttons (undetermined whether they show at the same time). | small |
| YouTube outreach (React): Edit target, Account settings | Card titles are bare 24px `<h3>`; labels 600 with no token; Save green but right-aligned; number boxes stretch to 560px. | medium |
| Substack Notes (React): Settings | The settings card has no title; other cards are bare 24px `<h3>`; Save green, right-aligned; boxes stretch. | medium |
| Polls list | Title row uses `.page-actions` instead of `.page-heading-actions`; "Import CSV" has its own inline size and padding. | small |
| Create/Edit Poll dialog | Dialog title is an `<h2>` at the browser's 2.5em; the close × is an unstyled button with inline styles; "Options" is an inline 1.1rem `<h3>`; "+ Add Option" has its own font size. | medium |
| Poll Import dialog | Same inline `<h2>` and raw ×. | small |
| Promote landing | Title row only — no editor. | none |

### Settings — `src/pages/settings.html`

| Editor | What differs | Size |
|---|---|---|
| Environment Configuration | Card heading is item size (R11 asks for that) but R12 calls a card heading a column title — the rules disagree; see question 3. | none (needs a ruling) |
| Profile | Two columns, neither titled; labels carry inline explanations "(defaults to account)" that belong on a `.meta` line; Phone and Website are full width. | small–medium |
| Projects: create panel | Title uses `.editor-title` with an inline margin; Name and URL full width. | small |
| Project detail | Left column untitled while Admin Team and Modules are; "Clusters" uses the column-title class although it sits inside Modules (should be an item); three blue buttons (Add Admin User, cluster Add, WordPress Download); two green Saves (form, Share panel); Share-panel legends are 14px/600. | medium |
| Database | Three bare 24px `<h3>`; no description line; "Create Field" is blue inside the form. Since #984 both forms are `.form-grid-beside`: labels left-aligned, the dropdowns and the Display Order number box sized to their content, and Required / Active are bare checkboxes with no repeated caption — all L9-conforming. The text boxes (Supabase Project URL, Custom Field Name, Field Label, Options) are still full width with no W7 class. | medium |
| APIs | Bare `<h3>`s ("Connection", "Credentials", the dialog title) in nested title rows; Log Attempt and Connect Page are blue alongside Add API. The attempt-log form is `.form-grid-beside` since #984 and conforms to L9; the Credentials form is not. | medium |
| Invitations (React) | "Invite someone" and "Invitations" are bare `<h3>`; boxes full width. | small–medium |
| Connections (React) | "Your accounts" is a bare `<h3>`; card names are `h4` at weight 600; every card has its own blue button. | medium |

### Training — `src/pages/training.html`

| Editor | What differs | Size |
|---|---|---|
| Context | `<h3>` with an inline 1.1rem and an inline pill badge; Refresh buttons use a legacy `secondary-btn` with inline size; no Save on the prompt box (undetermined how it saves). Fixed since survey base: the prompt box's label sits above it with its explanation in a `.meta` span (L9, #984); the filter dropdowns sit beside their labels at their own width, though the two date boxes still stretch (L9); and the table is a `.table-wrap` with no inline styles (T11, #986). The filter panel still carries an inline background and padding. | small–medium |
| Categories / Attributes / Approaches | The section heading is a `<label>` "Training Configuration: X" at 1.15rem/800 that repeats the page title; "Add X" is a plain button in the body instead of the blue one in the title row. | small (all three together) |
| Rules/Guides | The percentage boxes already follow W7; headings are `<label>`s as above; no Save (undetermined how it saves). | small |
| Knowledgebase (the Training landing table) | Not an editor. Conforms to T11 since #986: `.table-wrap`, no inline styles, headings readable (they were black on the black bar). The "Loading…" row still carries an inline style. | none–small |

### Assets — `src/pages/assets.html`

| Editor | What differs | Size |
|---|---|---|
| Assets title row | Two blue buttons, Create Video and Add Assets. | small |
| Upload panel | Bare 24px `<h3>`s; three more blue buttons (Upload, Import Files, Import From Folder); full-width boxes. | medium |
| Bulk Resize | Bare `<h3>`; width/height boxes lack `field-w-number`. | small |
| Add/Edit Asset | Form column untitled, "Preview" and "Image Editor" bare `<h3>`; "Mirror" label is a smaller grey; output width/height full width; two green Saves for two different jobs. | medium |
| Categories | The create panel's title reads "Create Topic" although the screen is Categories; a "Back To Categories" button on the Categories screen itself (rule 9). | small |
| Edit Category | "Update Category" is blue. | small |
| Video Production Factory | Title lacks the "Assets:" prefix; "Return to Assets" is blue; seven or more blue buttons; collapsible headings 1.25rem with letter spacing; many inline-styled `h4`s and labels; non-standard `white-btn` buttons; full-width number boxes. | large |
| Fonts (React) | "Add Font" is a bare 24px `<h3>`; Family name and Source link are full width (should be short/long). | small–medium |
| Footage (React) | The Clean / With cuts switch is drawn as blue/outlined buttons instead of tabs (rule 7). | small |

### Acquire — `src/pages/acquire.html`

| Editor | What differs | Size |
|---|---|---|
| Web | Bare `<h3>`/`<h4>` with inline margins in nested title rows; six separate green Saves; three blue buttons. | medium–large |
| Settings | Bare `<h3>`s; "Add Reason" is centred after an empty spacer; Snippet Length and count selects full width. | medium |
| YouTube | Several blue buttons; labels use per-form size overrides; the React video panel not checked in detail. | medium |
| Edit run / Bulk edit / Comments / YouTube Topics create + edit | Back button sits outside `.page-heading-actions`; the create/edit titles say "Category" while the list says "YouTube Topics"; "Update Category" and "Apply" are blue; an inline-styled info box. | small–medium |
| X, Reddit, Bluesky | Bare `<h3>`/`<h4>` with inline margins; Max Posts / Max Replies / Language full width; several blue buttons each. | medium |
| Substack (React) | Tabs conform; card titles mix a 24px `<h3>` and a 16px `<label>` for the same level; five blue buttons. | medium |

### Channels, Admin, Project Admin, Docs, Observe, Legal

| Editor | What differs | Size |
|---|---|---|
| Channels | "Create Channel" / "Existing Channels" are bare 24px `<h3>`; description is `<p class="meta">` rather than `.page-heading-desc`. | small–medium |
| Edit Channel | Empty `.page-heading-actions`; "Update Channel" is blue. | small |
| Admin: Add / Edit Admin User | Titles not "Section: Screen"; disabled email box fades with an inline `opacity`. | small |
| Project Admin (login card) | Heading is 1.25rem/700 with no title row; it is a login screen, so possibly exempt (question 8). | none / small |
| Docs: platform credentials | Bare `<h3>`; on every Docs subpage the Back button sits outside `.page-heading-actions`. | small |
| Observe | No editor. API Quotas headings are bare `<h3>`; Ping buttons carry their own inline colours; Activity Log refresh is an unstyled button. | small |
| Legal | No editor. | none |

## Builder — `src/pages/builder.html` and its React editors (`components/builder/`)

| Editor | What differs | Size |
|---|---|---|
| Module / section / page settings panel (one shared system) | Group titles are the right size but weight 700, not 800; **sub-section headings are uppercase with letter spacing** (`.builder-schema-group-subtitle`, `_builder-react-overrides.css:657`); the popup title is an inline 1rem; labels are the right size but written as `--text-base` rather than the sub-item token. Colour pickers appear to be on the label's line. | medium |
| Workspace shell and tabs | Tabs conform; one title only. The title row is the Builder's own `.admin-toolbar` rather than `.page-heading-row`, at the right size. **S9:** the editor reports saves and errors in its own `.notice.admin-notice` boxes (`components/admin-builder-editor.tsx:3065–3066`) and never calls `App.notify`, so Builder messages appear in a second place from every other screen's strip. | small–medium |
| Builder › Pages (`#builderManagePagesPage`, `src/pages/builder.html`) | Conforms to T11 since #986: `.table-wrap`, headings pinned, Published and Actions columns fit their headings. The title row conforms to C9: one blue Create Page, with Bulk Create, Populate from Web and Archives as plain buttons. | none |
| Pages list inside the Builder workspace (React, `components/builder/builder-page-list.tsx`) | Archive, Bulk Create and New Page are all green (cause 5, lines 590–606); Restore All is green too; the archive sub-heading has no CSS. **T11:** its tables sit in the Builder's own `.table-shell` (28px-radius card, `overflow-x` only), not `.table-wrap`, so #986's sticky headings and height cap do not reach them. | medium |
| Page Details | Two green buttons (Save as Template, Save Page); field labels are 0.94rem in muted grey, against R9 and the sub-item size. | medium |
| Templates / Template Details | Same muted 0.94rem labels as Page Details. | small |
| Publish panel | Conforms. | none |
| Page History | Day headings are tiny uppercase muted text (R12, R9); buttons use the admin `btn btn-ghost` inside React. | small |
| Saved Sections / Created Modules | Inline editors use the muted labels; source label a bare `<strong>`; whether the shared-sections Import should be the screen's one blue button is undetermined. | small |
| Saved Section editor dialog | Its `<h2>` title has no CSS, so its size is undetermined. | small |
| Themes | Conforms on headings, buttons and the name box. Save sits in the Themes toolbar, not the title row. Two unused uppercase heading classes remain in the stylesheet. | small |
| Theme Wizard | Prints a second `<h2>` title under "Builder: Themes" at a hand-picked 20px; its own button kinds (`tw-primary`, `tw-secondary`, `tw-link`) fade when disabled; 13px field labels. | medium |
| Forms page | Column titles and section headings have **no CSS at all**, so the browser's defaults decide; Save is the admin `btn btn-save`. | medium |
| Bulk Create | Title has no CSS. | small |
| Module Classes panel | Admin `btn` classes inside React; colours probably right. | small |
| Blog post editor (`components/builder-template-preview.tsx`) | Everything is inline styles: the title, labels, a 0.7rem uppercase toggle; Save Draft / Publish are hand-styled in the theme's accent colour. It is a module on a published page, so it may fall under the published-page rules instead (question 6). | large |
| Create/Edit Page form (vanilla) | Three columns with no column titles; image labels inline weight 600; Save Page appears top and bottom; no W7. Undetermined whether this form still shows next to the React Builder. | medium |
| Bulk Edit Pages | The `<h2>` is a back link with no "› Bulk Edit"; Apply is blue though it saves. | small |
| Visual Page Editor | Save All Changes green in the title row; toolbar labels unstyled. | none–small |
| Modular page template editor | Name box has placeholder text and no label; "Row Layouts" a hand-picked 1rem white heading; "Workspace" 1.45rem with letter spacing; Save top and bottom. | medium |
| Email modular editor / Email Text form | Placeholder-only boxes with inline margins; Save top and bottom. | small |
| Module Studio dialog | Dialog `<h3>` inline-styled; plain labels. | small |
| Poll Editor dialog / Polls list | Inline-styled ×, "Options" at an inline 1.1rem, "+ Add Option" at an inline size, inline-styled Import dialog. | medium |
| Modules page | "Create Poll" has an inline margin and sits beside the blue Create Module. | small |
| Populate from Web, Agents, Extensions | Not editors in the strict sense; inline or bare `<h3>`/`<h4>`; grey inline text on Populate from Web. | small |

## What already conforms

Tabs on every screen surveyed except Footage. The CRM form editor. The Builder
panel headers after R12. The Publish panel. Themes. Training's percentage
boxes. Every title row except those named above. Every admin `<table>` inside
`.table-wrap` (T11), including Builder › Pages and both Training tables. The
four `.form-grid-beside` forms (L9). Every `App.notify` message on the
vanilla screens, which #988 routed into the one strip (S9).

## Questions for Dane

The rules do not settle these. Each one changes how many screens the next
tickets touch.

1. **Where does Save go on a one-column editor?** The CRM rule puts it under
   the Preview column, and most editors have no preview. Today it sits
   bottom-left, centred, right-aligned, in the title row, or top *and* bottom,
   depending on the screen. Pick one: (a) bottom-left under the form,
   (b) centred under the form, or (c) in the title row.
2. **One Save per screen, or one per card?** Messaging's creators have three or
   four green Saves on one screen, Acquire › Web has six, and Asset edit has two
   for two different jobs. Is several green buttons fine when each saves a
   different card?
3. **What size is a card heading on a one-column screen?** R11 says "an item
   or smaller" (Environment Configuration was made item size), but R12 says a
   card's heading is a column title. One of the two needs a line saying which
   wins.
4. **Two pairs of rules share a number.** C9 is both buttons
   (`UI_RULES.md` ~line 1450) and tabs (~1501); W7 is both box widths
   (~1205) and four-sided spacing (~1337). May the second of each be
   renumbered (tabs → C10, spacing → the next free W number)? The number is
   how tickets cite a rule, and "W7" in this page means box widths.
5. **The Builder's green "add" buttons.** The Pages list inside the Builder
   workspace shows Archive, Bulk Create and New Page all in green (the
   `Builder: Pages` screen itself already uses plain and blue buttons). Under the button rule they would become
   outlined, outlined and blue. Was the green deliberate?
6. **The blog post editor is a module on the published page.** Should it follow
   the admin editor rules here, or the published-page rules (`docs/MODULE_UI_DOCTRINE.md`)?
7. **Fix the five shared causes first?** Changing the bare `<h3>`, the label
   size and the box width once would change every admin screen in one go —
   fast, but one big visual change to review. The alternative is one screen
   per ticket. Suggested: causes 1 and 2 first as one ticket with
   before/after pictures of six screens, then the screens.
8. **Is the Project Admin login card exempt from the title row?** It is a
   sign-in screen, not an admin screen.
9. **The Campaign form shows the Lead Magnet row twice** (two selects with the
   same id, `campaigns.html:384` and `:403`). That is a bug, not a style
   question. This ticket says not to file tickets, so it is noted here.
   Should it be filed?
10. **Should the Builder's messages move into the one strip (S9)?** The
   Builder's React editor shows its own green and red notice boxes inside the
   workspace. S9 names only `SavedNotice` as an exception. Either the Builder
   joins the strip, or S9 gains a second exception for it.
