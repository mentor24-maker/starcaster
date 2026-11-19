## 2026-11-18 — Show YouTube Find creators as a sortable table with filters (#1065)

YouTube's **Find creators** stage on the Outreach page used to show every
channel as a card, one under another. With thirty-odd channels that was a
long scroll, with no way to put the biggest channels first or to see only
the ones already approved.

It is now a table in the same style as every other admin table. A
light-blue bar on top filters it: search by name, pick a keyword, pick a
status (it starts on "Undecided", the ones waiting for a decision), or pick
what the suggestion was. Clicking a column heading sorts by it. Approve,
Reject, Agree and Open are small square icons at the end of each row, and
hovering one says what it does and to which channel. Approving or rejecting
still asks "why?" and saves exactly as it did before. If the filters leave
nothing, the table says which filters did it, so an empty table never looks
broken.

The sortable heading, the filter logic and the icon buttons are built as
shared parts, so the Find conversations tables and the Substack and Reddit
tabs can use the same ones when their tickets are built.

The screen-width check now covers this table too. It fails if the action
icons would slide off the right edge on a 1280-wide laptop, which is what
the first version did before it was fixed.

**After review (2026-11-19).** Review sent it back for one rule and two
small things. Column headings no longer hide a button inside them: the
heading itself is what you click (or Tab to and press Enter), which is how
every other admin table is built and what the shared heading has to be
before the other Outreach tables copy it. The Keyword list now shows
"Tennis" and "tennis" once, since they pick the same channels, and if a
keyword he was filtering by disappears (because he saved new keywords), the
filter resets instead of quietly hiding rows behind a list that reads "Any".
And the note he wrote when approving or rejecting a channel is visible text
in the Status column again, not only a tooltip.
