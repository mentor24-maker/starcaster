## 2026-11-17 — Imported sites keep their jump links (#1039)

Lots of client sites have a menu that scrolls down the page instead of going
to another page: About, Services, Contact on a one-page site. After an
import, those menu items did nothing. Bayside went live that way. The import
never wrote down which part of the original page each name like
`#contact-us` belonged to, so it had no way to rebuild the link. A sweep of
the nine sites imported so far found 683 links like this.

Now the import writes those names down when it captures a site. It gives the
matching section of the new page the same name, and points every menu item,
button and text link at that section. Once the pages exist, it stores each
link by the section's permanent id, so renaming the section later won't
break the link. "Skip to content" shortcuts are left out on purpose. Any jump
link the import can't place is listed, with the reason, in the build log and
on the Imports screen under a new **Jump Links** heading, so nothing
disappears without a word.

Checked against Bayside's real capture and a fresh real-browser capture of
its original: all three menu links land on their own sections.

**After review (2026-11-18).** Review caught three things, now fixed. When
the name sat *inside* a heading or a line of text (the way WordPress
table-of-contents plugins write it), the link landed one section too low; it
now lands on the heading or line that holds the name. Imports made before
this change were reporting every jump link as "missing", which was untrue:
nobody had looked yet. They now say the import is older and how to refresh it
from the capture already saved, with no new capture needed. And links to a
file at a page number (`menu.pdf#page=3`) are no longer mistaken for jump links.
