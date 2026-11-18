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
