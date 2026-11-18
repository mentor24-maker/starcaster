## 2026-11-18 — StarCaster sites have no hidden "Skip to content" link for keyboard and screen-reader visitors (#1043)

**What was missing.** Delray's and Press Play's original sites both started
every page with a hidden "Skip to content" link. Nobody sees it unless they
press Tab. It lets someone using a keyboard or a screen reader jump straight
past the menu instead of stepping through every menu item on every page, and
accessibility checkers look for it. StarCaster pages had none.

**What changed.**

- **Every published page now has one, automatically.** Press Tab on any live
  page and a "Skip to content" box appears in the top-left corner. Press Enter
  and the keyboard moves past the header and menu into the page's own content.
  There is no setting and nothing for whoever builds the site to do.
- **Where it jumps** is one small rule with tests beside it: the first section
  after the shared header sections and the menu. If a page is nothing but those,
  it jumps to the first section without a menu, or failing that the first
  section. A page with no sections gets no link.
- **Nothing visible changes until Tab is pressed.** The before-and-after
  screenshots came out pixel-identical to the live code.

**How we know it works.** Three new browser checks prove the link is hidden
before Tab, shows up in the corner on Tab, and really moves the keyboard (not
just the scroll) on Enter. Each one was broken on purpose and seen to fail
before it was trusted.

**Sent back once, and fixed.** Review found the "skip past the shared header"
part never worked on a real page. When a published page loads, the code that
tidies its sections throws away the note saying "this section is a shared
one", so the link could not tell a shared logo or contact strip from page
content. On a page that opens with such a strip and then the menu, the link
pointed at the strip, above the menu, which is no help at all. The page now
puts that note back on its sections right after tidying them (nothing on the
page looks different; only the link reads it). New tests run the real page
loader rather than hand-made sections, and a fourth browser check builds a
page with a shared strip above the menu. Both were broken on purpose and seen
to fail before they were trusted.
