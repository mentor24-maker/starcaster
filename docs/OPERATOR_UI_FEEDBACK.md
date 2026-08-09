# Operator UI feedback — recovered from session transcripts 2026-08-09

**Why this document exists.** The UI doctrine (2026-08-08) encoded only the
mechanically checkable layer of the operator's standards. His actual design
input — given across June–August sessions — was never recorded in the repo,
and the 2026-08-09 editor sweep visibly violated several things he had said
repeatedly. This file is the recovery: every Claude session transcript on
the machine was mined (128 keyword matches, 46 genuine directives), and his
words are reproduced **verbatim** below with thread and date. Paraphrase is
interpretation; the quote is the requirement.

**Gaps to assume:** input given in claude.ai chats (not Code sessions) does
not exist on this machine and is absent here. Truncated pastes are marked.
**Status: awaiting operator confirmation** — nothing below becomes a
doctrine rule until he confirms or amends it.

---

## Theme A — General philosophy / doctrine

- **[module-ui, 2026-08-08]** — the founding statement: "The problem, as is
  the case with all the modules currently, is that the UI is absysmal. We
  are going to address the UI of these modules and establish a complete
  coding standards for UI doctrine in the process. So for each of the
  modules, I'm going to give you a laundry list of issues I have with them."
- **[module-ui-overhaul, 2026-08-08]** — "Please proceed with the three
  prerequisite tasks. Meanwhile, I think it makes sense to run all modules,
  including the new ones, through the standard"
- **[module-ui-overhaul, 2026-08-09]** — "I set up a new page in the delray
  tennis website named module-tester where I will place each of the modules
  in turn for the next phase of the process. I started with the two
  navigation modules. Would you say that these look like they've been
  processed through our module UI doctrine? They don't to me. Please check."
- **[module-ui-overhaul, 2026-08-09]** — "this looks absolutely terrible,
  with lots of thinks I specifically talked about. For one thing, look at
  all the wasted screen real estate on the right side. Orphaned fields. I
  don't even want to go on. So many issues."
- **[site-import, 2026-08-07]** — "I want to develop an elegant and robust
  system for being able to easily replicate any type of module, plugin,
  widget, or snippet and turn it into a Starcaster-native module that has
  clear, intuitive UI so the user finds every single widget familiar in
  terms of structure and design."
- **[stale-ui-audit, 2026-07-23]** — "the fact that you just recovered this
  nice CRUD makes me wonder what other outdated UI are we dealing with.
  Please review the site and find any other areas where stale code is being
  shown instead of new code."
- **[main-folder, 2026-07-17]** — "I am a fan of populating the section
  titles so future users can follow the builder much more easily" [more in
  original — proposes an auto-naming agent built via Builder > Agents]
- **[main-folder, 2026-07-23]** — (about Facebook's UI, not StarCaster, but
  a clear statement of his list-navigation values): "An endless list of
  apps that I somehow got connected to... No search. No filters, no
  sorting. The only way to see more is to scroll way down, and click the
  See More link which kindly shows you 5 more links, then I have to repeat
  the whole fucking process."

## Theme B — Panel layout, density, use of horizontal space

- **[main-folder, 2026-06-30]** — "Put all the card elements on the same
  line. There is plenty of room for all three dropdown lists on the same
  row. Use the standard delete icon rather than a button."
- **[main-folder, 2026-06-30]** — (after it was done wrong): "Meaning the
  column settings, up/down arrows, all three columns dropdowns, and the
  delete icon should appear in the same row. Instead, you put each item on
  it's own row. Please re-read my instructions and correct this. The goal
  is to minimize vertical space and the need for scrolling, in case that
  makes it any easier to understand."
- **[main-folder, 2026-06-30]** — "Please clean up the look and feel based
  on the guidelines in .cursorrules, in particular, puttig the card
  elements, checkboxes and position arrows all in a row." ... "Now I'm
  thinking we need more controls to indicate row groupings. And let's let
  each row be from 1-3 equal width columns." [more in original]
- **[main-folder, 2026-06-28]** — "Attached is a layout design for the
  blog-post-list module to organize and compact the form. This arranges the
  fields into three sections (general, Page Design, Card Design) arranged
  in three columns." [more in original — adds popularity filter, tag
  filter, post title, post slug fields; apply to page-level and
  module-level editors]
- **[main-folder, 2026-07-24]** — "you've got the font in white, so I can't
  see the pages. Also, fix the formatting of the 'Overwrite titles I
  already set (off = fill blanks only)' checkbox so it all shows on one
  line. And come up with a clearer description. I'm not quite sure what
  that even means. Also, since there is plenty of room to the right of the
  Pages section, display the selected pages to the right, parallel to the
  Pages section."
- **[main-folder, 2026-07-02]** — "add the Topic filter to the Media
  Gallery. Let that window expand to 80% the width of the screen and add at
  least a couple more columns to the grid."
- **[main-folder, 2026-06-30]** — "as far as the layout of the style
  controls, they just seem to be randomly smeared onto the screen. Not even
  sure where to go with that. The main problem is that the front-end is
  completely nuked. It randomly set the width of all items to some very
  high number that isn't found in the edit screen."
- **[main-folder, 2026-06-24]** — "Move the Logo field to the left column
  to free the right column up for these other settings, including setting
  up Admin Team users as well as enabling specific modules." ... "Just an
  on/off toggle."
- **[main-folder, 2026-06-30]** — (Page Details editor): "If the background
  color setting is there, which I expect it is, it isn't visible on the
  screen. Please list all the fields I should be able set in the Page
  Details editor, and figure out how to make them all show."

## Theme C — Field/control sizing and widths

- **[main-folder, 2026-07-01]** — the definitive width statement: "The
  problem is that Page Title, Slug, and Template fields are so wide that
  they knock the Background field off the end so it is invisible. There's
  no reason for those fields to be that wide. I've begged and pleaded with
  every AI model I've used again and again and agin not to always force
  every field to the widest possible width, but to no avail. There appears
  to be some mysterious master style to rule them all that overrides each
  and every attempt to reign in the width of fields. If, you can find that
  style that causes me so much grief, it would be wonderful."
- **[main-folder, 2026-07-01]** — "In the Builder: Themes > Typography >
  Type Scale settings, add Top Margin and Bottom Margin columns/fields.
  Adjust field width sizes to fit."
- **[main-folder, 2026-06-28]** — "Let's clean it up even more by making
  all the form fields in the 3x3 sections the same width. First, change
  'Admin Manager' to 'Admin' in the Layout dropdown. Then make them all
  100px wide (we'll adjust on the next round). Ensure that none of the
  labels overlap with the forms (e.g. Popularity filter). We have plenty of
  room to avoid overlap." ... "Is the Content field necessary in this form?
  Is there an actual setting being set? If not, let's removeit."
- **[main-folder, 2026-06-28]** — "the labels Date Range filter, Popularity
  filter, and Category filter are all cut off by the fields. Also notice
  that there is more than ample margin to allow plenty of room for the
  labels AND expand the field widths to 200px, which might get us to a
  uniform field width. Remove the 'Post view page' field (redundant to the
  slug field) and place the Label field as the first column in that first
  row."
- **[main-folder, 2026-06-24]** — "OK, I got the two column table. Make the
  two columns the same width."
- **[main-folder, 2026-07-20]** — "Need to fix the font and/or background
  colors so they are readible. Also,make the container a 4:3 ratio filling
  approximately 1/2 the screen."

## Theme D — Labels and column titles

- **[main-folder, 2026-07-01]** — "Make the width columnn wider. Give each
  of those field columns titles: Parent Page, Page Name, Slug, Width,
  Action"

## Theme E — Control types, consistency, dead fields

- **[modules-blazefish, 2026-08-07]** — "In the modules modal that lists
  the categories, double the size of the icons and create icons for each
  one that represents the type of module it is. I anticipate dozens of
  categories/types, with dozens of modules within each type, for a total of
  hundreds and eventually thousands of modules. So a clear navigation
  system is essential. So the other thing we need at the top nexto to the
  sort icons is a text search field."
- **[main-folder, 2026-06-30]** — (tag-link module): "I shouldn't have to
  set that field at all. If I do, it should be a matter of selecting the
  destination from a dropdown list, which will automatically format the
  URL."
- **[main-folder, 2026-07-01]** — "Let's update those dropdowns for height
  and width to the following options: width: 1920, 1440, 960, 720, 480,
  240, height: 1080, 960, 640, 320, 160 (add any other standard ones I
  missed). Also add 'Other' and 'None' options."
- **[main-folder, 2026-07-02]** — "Looks like we need a 'Clear' button, as
  the filter is sticking on a Category and won't let it go without a full
  page refresh."
- **[main-folder, 2026-07-01]** — "In the Languages module in the Header
  section, on mouseover we get a white background. I don't want that, but I
  don't seem to have a control for that. The backgrond selector on this is
  an older style. Upgrade the background selector in this module."
- **[main-folder, 2026-07-01]** — "I notice this field has a 'content'
  field that doesn't do anything. If that field is indeed extraneous,
  please remove it."
- **[main-folder, 2026-07-29]** — "The Test Connection button seems to be
  hard-coded for X, not associated with the selected campaign, is that
  right? If so, let's remove that. We have a connection test in the API
  Settings anyway."
- **[admin-support-page, 2026-07-30]** — "The Contact Alert Email set in
  /admin-settings, we need to allow for multiple email addresses. Include
  an 'Add Recipient' link under the last form field that opens another
  email field."
- **[main-folder, 2026-07-22]** — "the whole Saved Cells CRUD doesn't have
  an edit icon. So at the moment, there doesn't seem to be any way to edit
  that form. Please add edit icons and functionality to the Saved Cells"
- **[main-folder, 2026-07-24]** — (expected controls missing): "I'd like to
  make it narrower, but I don't see a Horizontal Margin or a Section Width
  setting. I've hard refreshed. What are we missing?"
- **[admin-support-page, 2026-07-30]** — (field placement/semantics across
  the two admin UIs): "The Support Alert Email is the email that will
  receive inquiries sent from the public website. That email is set in the
  tentant/client admin site. It is NOT set in the Starcaster Project
  Settings. The Support Email and Support Phone are for the tenant/client
  to contact if they have trouble with the website. Those two fields are
  set in the Starcaster Project Settings."
- **[site-import, 2026-08-07]** — (his verbatim answers to a settings-strip
  proposal): "I defer to you on this." / "Approve the strip order above?
  Yes" / "Width mode — percent and pixels, or percent-only for v1?
  percent-only for v1"

## Theme F — Tables / CRUD lists

- **[site-import, 2026-08-06]** — "The first thing we need to fix is that
  the eye icon in the CRUD links to the
  https://www.starcaster.pro/builder-preview.html, which has caching
  issues. Let's open those in a dedicated tab as a standalone page. Also
  truncate the slug column so we can fit the whole table on the page, and
  link the slug to the same page the eye icon links to."

## Theme G — Colors, contrast, focus indicators

- **[main-folder, 2026-06-28]** — "The Page title field value 'Blog Post
  View' is highlighted. However, there is no 3px green border around the
  Page title field, as request. Please add that."

## Theme H — Rendered (public) site design

- **[main-folder, 2026-07-23]** — "On the Brandon Marinoff site built on
  Starcaster, change the style for bullets to make them single spaced,
  unlike the current double-spaced format. We can make this a global
  Starcaster style for now."
- **[main-folder, 2026-07-17]** — "the client requested the change of
  Mexican flag to Espanol button. For the sake of symmetry, change the
  american flag to a corresponding 'English' button."
- **[main-folder, 2026-07-22]** — (same language switcher, regression):
  "the button version of that cell was working fine. Then all of a sudden
  it switches back to images... Find the button version of Languagees and
  restore it."
- **[main-folder, 2026-07-24]** — "I wonder inf you can figure out what is
  causing the white curve artifact in the corner radius between the image
  border and the images themselves." ... "we need to figure out a way to
  join two sections together with a common, full-width background." ...
  "Maybe we just need a new section setting for constrained or full width.
  Then would it make sense to have 'link sections' ability?" [more in
  original]
- **[main-folder, 2026-08-08]** — "The attached shows what the Feature
  Cards look like currently: generic black and white."
- **[theme-wizard, 2026-08-09]** — "Still monochrome. You may notice I did
  update the header a bit, including making it full width."
- **[main-folder, 2026-07-02]** — "In style.css, please change
  .site-admin-nav-link {bottom: 72px; to .site-admin-nav-link {top: 10px;"
- **[main-folder, 2026-07-01]** — (admin-nav-link module behavior): "All I
  wanted on the home page is a link to that page that will appear if they
  have the cookie and doesn't if they don't. Very simple. So the new module
  should be ust like the existing module, except that it only shows up if
  they have the cookie."

---

## Recurring demands (appeared more than once)

1. **Never force fields to maximum width; modest uniform widths** — 5x
   (main 7/1 "begged and pleaded", 7/1, 6/28 ×2, 6/24)
2. **Minimize vertical space; related controls share a row; use the empty
   right side** — 6x (main 6/30 ×3, 7/24, 7/2; module-ui-overhaul 8/9)
3. **One uniform doctrine for every module's UI** — 5x (module-ui 8/8,
   module-ui-overhaul 8/8 + 8/9, site-import 8/7, stale-ui-audit 7/23)
4. **Labels never cut off / overlapping / unclear; grid columns titled** —
   4x (main 6/28 ×2, 7/1, 7/24)
5. **Remove dead or redundant fields and controls** — 4x (main 6/28, 7/1,
   6/28, 7/29)
6. **Readable contrast — never white-on-white** — 3x (main 7/24, 7/20, 7/1)
7. **Search / filter / sort on any long list** — 3x (blazefish 8/7, main
   7/23, 7/2)
8. **Dropdowns with presets over free-form entry** — 2x (main 6/30, 7/1)
9. **Language switcher as text buttons, not flags** — 2x (main 7/17, 7/22)
10. **Constrained vs full-width section control** — 2-3x (main 7/24 ×2,
    theme-wizard 8/9)
11. **Standard consistent icons for row actions** — 2x (main 6/30, 7/22)
