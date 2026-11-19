## 2026-11-17 — The import difference report and the broken-links scan can't see dead links, so Bayside's dead menu passed both (#1040)

Bayside's imported site went live with a top menu whose three links (About Us,
Services, Contact Us) were meant to jump down the page, but nothing on the page
carried those names, so clicking them did nothing. The two checks we rely on
both said everything was fine: the import difference report had no idea links
existed, and the weekly broken-links check only asked whether the page a link
goes to exists, never whether the *part* of the page does.

Both checks now ask that question, and they share one answer, so they can never
disagree. The import report has a new **Links** category: links the original
site had that the import lost, and links that jump to nothing. The weekly check
now lists a jump link that lands nowhere as broken, and anything it could not
check is listed as "could not check" instead of being quietly counted as fine.

Run on Bayside's real import (read-only), both checks named exactly the three
dead menu links.
