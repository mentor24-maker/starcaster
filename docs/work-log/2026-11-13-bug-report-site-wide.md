## 2026-11-13 — Bug Report: one switch puts the bug icon on every page (#1012)

Until now the Bug Report module only showed on the page it was placed on, so
getting the bug icon onto a whole site meant adding it page by page or
through a template. Dane asked for a site-wide option.

The module's **Placement** settings now have **Show on**, beside Corner:
**This page only** (the default, and how every existing module keeps
behaving) or **Every page of the site**. Once a page holding a module set to
every page is published, the live site shows that icon on every page,
including pages that never had the module. A page that has its own Bug
Report module shows only the site-wide one, so there are never two icons in
a corner.

Three things make it safe:

- **Only published pages count.** A draft changes nothing until it is
  published, and unpublishing the page that holds the module takes the icon
  down.
- **One winner.** If more than one module is set to every page, the most
  recently published page wins, and the settings panel names the other page
  so it is not a mystery.
- **It stays fast.** The live site does not reread every page on every
  visit. It checks two short lists and only opens a page's saved copy when
  that page has been republished.

If the lookup ever fails, each page simply shows its own module, as before.
