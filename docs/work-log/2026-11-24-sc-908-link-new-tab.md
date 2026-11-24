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

### Rework after review (same day)

Review found the new "New Tab" box knocked the Carousel settings panel out of
line: with captions off, each slide's picture started a row late and left an
empty gap, and in both formats the picture stopped one row short because the
panel still counted the old number of fields. In Feature Cards the box sat on
its own line instead of next to the Link it controls.

Fixed: the Carousel picture is back on the first row and now counts the New
Tab box; in Feature Cards the box sits directly under its Link. Clearing a link
now also clears its new-tab choice, so a link added later starts unticked.

The panel-layout check (`check:panels`) never looked at those pictures at all,
which is how this got through. It now does: it checks each slide's picture
starts on the first row and spans every field beside it, and the test page now
has a slide with a ticked box and a carousel with captions off. Both mistakes
were put back on purpose and the check caught each one.
