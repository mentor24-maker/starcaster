## 2026-11-19 — Add an optional Back to top link for long pages (#1067)

A reader at the bottom of a long page — a blog post, one of Delray's program
pages — had no quick way back up. Now a page can turn on a small round
**Back to top** button.

**Where to find it:** Builder › Pages › open a page › Page Details › **Back to
top** — choose "Show after scrolling" and save. It is **Off** on every page
until somebody turns it on, so no existing site changes.

**What a visitor sees:** nothing at first. Once they have scrolled down more
than one screen, a round button fades in at the bottom-right corner, in the
site theme's accent colour. Pressing it (or tabbing to it and pressing Enter)
glides back to the top. A screen reader announces it as "Back to top".

**How it is stored:** the setting lives inside the page's layout, next to its
background and theme, so it needed no database change. The save paths that
rewrite a page's layout without naming it (module saves, shared-section
pushes) keep whatever the page already had, and with the setting off the
stored page is byte-for-byte what it was before. Copying a page copies the
setting too. Restoring an older version from Page History leaves it as it is
now: a restore undoes a layout change, not the page's settings.

**Sharing the corner with Bug Report:** both buttons live in the bottom-right
corner by default. When a site also shows the floating Bug Report button
there, Back to top moves up to sit just above it, so neither covers the other.
The arrow is dark on a pale accent colour and white on a dark one, so it can
always be seen.

**How it is checked:** three new browser checks (`npm run check:render`): one
proves the button is hidden at the top, appears after scrolling, and returns
the page to the top when pressed; one proves a page with it off has no
button in its markup at all; and one turns on Bug Report in the same corner
and measures that the two buttons do not overlap. Unit tests cover every save step the setting has
to survive.
