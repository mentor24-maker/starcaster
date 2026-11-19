## 2026-11-19 — Show Reddit subreddits as a sortable table with filters (#1076)

On Engage › Outreach › Reddit, the list of subreddits the Mini watches was a pile of cards with text buttons. It is now a table that matches YouTube's Find creators table, so the two tabs look and work the same way. The columns are the subreddit, its status (Suggested, Watching or Rejected), who suggested it, why, the subreddit's own rule on self-promotion, and when the Mini last read it.

Click a column heading to sort by it. Filter by name, or by status. The status filter opens on Suggested + Watching and replaces the old "Show rejected" button. Each row's actions are small square icons (Approve, Reject or Stop Watching, Open on Reddit), and hovering one names the action and the subreddit, so you are never guessing. Approving turns the row to Watching on the spot. If something goes wrong, the message appears right under that row instead of at the top of the page.

The automatic screen-width check now measures this table at three screen sizes, against sample subreddits put in the test project for that purpose. Making the table too wide on purpose made that check fail, which shows it is really looking.
