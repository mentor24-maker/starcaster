## 2026-11-24 — Add an open-in-new-tab choice to the other Builder modules that have links (#1096)

Last week the Button got an **Open in New Tab** checkbox (#1094). This does
the same for the other modules whose links a visitor clicks and which had no
such choice:

- **Feature Cards** and **Carousel**: a box on each card or slide, beside its
  Link. It only appears once that card or slide has a link, because a box
  that controls nothing is just clutter.
- **Headline Rotator**: one **Open Links in New Tab** box for all of its
  headlines. The headlines are saved as one block of text, so a separate box
  per headline would have meant changing how they are stored. The setting is
  kept apart from that text on purpose.

Ticked, the link opens in a new tab with the usual safety attribute that stops
the new page reaching back into the client's site. Every box starts unticked,
and everything saved before today reads as unticked, so no live page changes.

**One hidden trap, caught before it shipped.** Every time a page loads, the
Carousel rebuilds each slide from a fixed list of field names (that is how it
absorbed the old Slideshow and Slider modules). A new field missing from that
list is silently thrown away the next time the page is saved, so the choice
would have looked saved and then quietly vanished. It is on the list now, and
a test fails if it ever drops off again.

**Blog Post Card is left out, deliberately.** It has no live version yet: on a
published page it draws nothing at all, and its link can only point at a page
on the same site. A new-tab box there would do nothing. It belongs with
whichever ticket gives Blog Post Card a real renderer.

Three browser checks (`check:render`) now read the finished links on a real
page and fail if a ticked item does not open a new tab or an unticked one does.
Each was broken on purpose once and seen to fail.
