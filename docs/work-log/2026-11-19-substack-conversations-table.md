## 2026-11-19 — Show Substack Find conversations as a sortable table with filters (#1075)

On the Outreach page, Substack's "Find conversations" used to be a long list of
cards, each with four text buttons. It is now a table like YouTube's Find
creators: one row per Note, best match first, with columns you can click to sort
(Posted, Rank, Writer, Keyword) and a light-blue row of filters above the
headings (search, keyword, writer, approved writers only, and whether a reply is
already waiting).

The buttons became small square icons at the end of each row. Hovering one says
what it does and to whose Note, so nothing is a guess. If something goes wrong on
one row (say the replies could not be written), the message appears on its own
line right under that row instead of somewhere else on the page. And if your
filters hide every Note, the table says which filters did it and how to get the
rest back, so an empty table never looks like a broken one.

The automatic screen-width check now opens this table at three screen sizes and
fails if the action icons slide off the edge. We proved that by breaking the
layout on purpose and watching it fail.
