## 2026-11-17 — Menu links that jump to a part of the page do nothing on Bayside's live site — sections can't be given an anchor name (#1034)

Bayside's top menu has About Us, Services and Contact Us. They're "jump" links: each should scroll the home page down to that part. Clicking them did nothing, because no section on a StarCaster page could carry a name for a link to aim at. Four of our imported sites have menus like this.

**What changed.** Every section now has an **Anchor Name** box in its settings (for example `contact-us`). The published page uses that name as the section's address marker. If another section on the same page already has the name, the box says so. In a menu, once you pick a page for an item, a second list offers **Top of the page** or one of that page's named sections. The page you're editing is marked "(this page)", and a name you typed a moment ago shows up even before you save.

**Why it won't break later.** The menu doesn't save a copy of the name. It saves *which section* (its permanent id), and the name is looked up each time the page is shown. Rename the anchor or the page and every link to it follows. That's the same "link by reference" rule buttons have used since November 3, extended with a section.

**On the live site,** a link to a section of the page you're already on now glides there without reloading. Opening an address that names a section (`/about#team`) lands on it, which also fixes the case where the page drew after the browser had already looked for it. Old typed links like `/#about-us` keep working whenever a section has that name.

**Still to do for Bayside:** a session that can write to production runs `scripts/set_section_anchors.mjs` once this is live. It names Bayside's three sections and republishes only that page; the exact command is in the pull request.
