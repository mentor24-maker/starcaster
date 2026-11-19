## 2026-11-19 — Show Reddit Find conversations as a sortable table with filters (#PR)

Reddit's **Find conversations** stage on Engage › Outreach used to be a long
stack of boxes, one per post, each with its comments and a row of text
buttons underneath. With a few dozen posts that meant a lot of scrolling and
no way to say "show me the most upvoted" or "only r/polymath".

It is now a table, built from the same pieces as YouTube's Find creators:

- **One row per post**: the title (linked, never cut short), subreddit,
  author, when it was posted, Reddit's score, the comment count, the keyword
  that found it, its rank (hover for why it ranked there) and whether a reply
  is waiting.
- **Click a heading to sort** by Posted, Score, Comments, Rank or Subreddit.
  It opens on best rank first, the same order as before.
- **A light-blue filter row**: search the title and text, pick a subreddit,
  a keyword, or Not replied / Waiting.
- **Small square icons** instead of text buttons: Write replies, Skip, Save
  as contact, Open on Reddit, and an arrow that drops the post's
  self-promotion rule, its text and its top comments beneath it. Each comment
  has its own Write a reply and Save as contact icons; once replied, the
  reply icon is greyed out and says "Replied".
- If a filter leaves nothing, the table says which filters and how many
  posts they hid, so an empty table never looks broken. A failed action shows
  its message on a line right under the row it belongs to.

One thing turned up while building: the list the screen reads did not carry
Reddit's own points for a post — the ranker had overwritten that number with
its own 0-100 score. The server now passes Reddit's points along separately,
so the Score column shows the real thing. How posts are found and ranked is
unchanged.
