## 2026-11-19 — Show YouTube Find conversations as a sortable table with filters (#1074)

YouTube's **Find conversations** stage on Engage › Outreach used to be a stack
of boxes, one per video, with each comment as a card inside. With two dozen
comments that meant a lot of scrolling and no way to say "show me the
most-liked ones" or "only this video".

It is now a table, built the same way as Find creators was the day before:
one row per comment, best first, with columns for the comment, who wrote it,
the video, when it was posted, likes, its rank and whether a reply is already
under way. Clicking Posted, Likes, Rank or Video sorts by it. A filter row
above searches the comment text and author names and narrows by channel,
video or reply state.

The action buttons in each row are now small square icons (write replies,
skip, save as contact, open on YouTube), and each one's tooltip says what it
does and to whom. A long comment is cut between words, never through one,
with the whole comment on hover; the reason a comment ranked where it did is
the Rank number's hover.

What did not change: how comments are read and ranked, the Read now button,
the reason picker for Skip, and the reply chooser that Write replies opens.

The screen check that runs at 1280, 1440 and 1920 pixels wide now covers this
table too, and was proved to fail when the table's column layout is broken.
