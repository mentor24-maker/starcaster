## 2026-11-18 — Add a Table of contents module that lists a page's headings as jump links (#1051)

Long pages, such as blog posts and Delray's program pages, have headings a reader wants to jump between. Yesterday's change gave every heading a name a link can aim at. This one adds the thing that uses those names.

**What changed.** There is a new **Table of Contents** module. Drop it on a page and, on the live site, it lists that page's headings as links. Clicking one glides to that heading and puts its name in the address bar (for example `/programs#adult-clinics`), so the address can be copied and sent to someone.

**How it stays right.** The module stores nothing about the headings. It reads them from the page each time the page is shown, so renaming, adding or deleting a heading changes the list with no extra step. It also picks up a blog post's text, which arrives a moment after the rest of the page.

**The settings.** A title (default "On this page", and it can be cleared), which heading levels to list (H2 only, H2 and H3, or all), whether sub-headings are indented, plus size and link colour. Alignment uses the Alignment control every module already has.

**When there is nothing to list.** A live page with no headings shows nothing where the module sits: no lonely title. In the Builder, the same page shows a note explaining why the list is empty.

**One name tidied.** The Blog group already had a "Table of Contents" whose headings are typed in by hand and which never appears on a published page. It is now listed as "Table of Contents (hand-typed)", so the module list never offers two modules with the same name. Pages that use it are unchanged.
