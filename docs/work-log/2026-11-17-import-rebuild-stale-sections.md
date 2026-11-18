## 2026-11-17 — Rebuilding an imported site leaves old sections on every page when an import fix stops producing them (#1033)

Rebuilding an imported site's draft pages only ever replaced or added
sections. It never took away a section the import had stopped making. So when
we fixed the importer (SC-849 stopped it pouring a doubled logo and a stray
"Select Page" line onto Bayside Partners' pages), a rebuild still left the old
header on all seven pages, and the fix looked like it had not worked.

Now a rebuild removes those leftovers, but only the ones nobody has touched.
The import keeps a fingerprint of every section it writes. If an old section
still matches its fingerprint, it comes off the page, and the page is read
back to confirm it is gone. If someone edited it, it stays, and the build
report names it so nothing hand-made is ever lost.

The same rebuild also stopped bringing back pages that had been deleted on
purpose. Bayside's author page came back on every rebuild and had to be
deleted by hand each time. A page the import made that is gone now is left
out and named in the report as "deleted since the last build, left out".
`--recreate-deleted` brings such pages back if anyone wants them.
