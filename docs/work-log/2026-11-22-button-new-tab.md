## 2026-11-22 — Button module needs open link in new tab option (#1094)

A Button on a client's page could only open its link in the same tab. When a
button points at another website — a shop, a booking page — that takes the
visitor off the client's site.

The Button's settings now have an **Open in New Tab** checkbox right beside
its Link, the same setting the Image module already has. Tick it and the
button opens its link in a new tab, with the usual safety attribute that stops
the new page from reaching back into the client's site. It starts unticked,
and buttons saved before today read as unticked, so no live button changes
what it does. Email templates do not show the box: a button in an email
already opens the reader's browser.

A browser check (`check:render`) now reads the finished button on a real page
and fails if a ticked button does not open a new tab, or an unticked one does.

The other modules with links (Feature Cards, Carousel, Headline Rotator, Blog
Post Card) get the same choice in SC-908.
