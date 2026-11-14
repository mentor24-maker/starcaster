## 2026-11-14 — Add a Context page under Assets for agent reference material (#1015)

Each project now has a page, **Assets › Context**, where Dane can write notes
that agent sessions should know before they work on that project: brand voice,
pricing, who the client is, and so on. He writes them in the same text editor
the Builder uses, so headings, bullet lists and bold all stay put, and the page
lists every note with buttons to edit or delete it. A delete asks once first.

The notes live in a new database table, one set per project, so one client's
notes never show up in another's. That table has to be created on the live
database before the page works there. Until it is, the page says the table is
missing and names the file that creates it, instead of looking empty.

This is the first of three steps. Next comes uploading files to the same page
(SC-809), then a command agent sessions use to read it all (SC-810).

One thing changed from the plan along the way: the editor is big, and loading
the page the planned way would have added a second copy of it to the admin
app, making every admin screen about 70% heavier to download. The page now
borrows the copy the Builder already loads, which costs almost nothing.

**After review (same day).** Four fixes before it ships. A client's own site
login (the admin sign-in on their custom domain) could reach these notes, and
since agent sessions will read them, a client could have written into what our
agents are told; that door is now shut. A momentary database hiccup no longer
claims the table is missing and sends Dane to re-run SQL he already ran. An
edit that sends an empty "text" field no longer wipes the note. And saving or
deleting just as you switch projects no longer shows "Saved" under the other
project.
