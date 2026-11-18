## 2026-11-18 — Long pages have no way to jump to a heading: no table of contents, no heading links (#1041)

Long pages — blog posts, Delray's program pages, Dane of Earth's long posts — have headings a reader would like to jump to. The original sites let you link straight to one; StarCaster pages didn't, because a heading had no name a link could aim at.

**What changed.** Every heading inside a Text module or a blog post now gets a name made from its own words when the page is shown. A heading "Junior Programs" can be linked to as `/programs#junior-programs`. Opening that address lands on the heading, and a link to a heading on the page you are already on glides there without reloading (the same behaviour section anchors got yesterday).

**The rules it follows.**
- A heading that already has a name keeps it, untouched.
- Two headings with the same words on one page get `junior-programs` and `junior-programs-2`, even when they sit in different Text modules, and a heading never takes the name of a section's anchor.
- A heading that is empty, or only an emoji, gets no name.
- Nothing is saved. The names are worked out each time the page is drawn, so renaming a heading renames its link and the stored page is never rewritten.

**What it sets up.** The Table of contents module (SC-863) will list these headings as jump links. Old links to the original sites' heading names only work where the automatic name happens to match.
