## 2026-11-19 — Stop the Mini leaving the word undefined in Reddit's comment box (#1086)

After the Mini posted a Reddit comment on 18 November, Reddit's comment box at
the top of the thread was left showing the word "undefined". That word usually
means a program filled in a blank it never had a value for, so we checked every
blank in the instructions the Mini gives its browser. None can be empty when a
comment is posted: the Mini refuses to post a comment that is missing its
words, its link, its browser or its account before it ever gets that far.

So the stray word came from the browser tool itself, not from our instructions.
The instructions now tell it plainly to type only into the one box it opened,
to leave the post's top box alone when replying to someone, and to type nothing
more once the comment is up. Two new tests fail if "undefined" or "null" ever
creeps into what the Mini tells the browser, for both kinds of comment.
