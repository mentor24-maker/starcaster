## 2026-11-19 — Fix Reddit comments that post but get marked failed (#1066)

When the Mini posts a Reddit comment for Dane, the browser helper (OpenClaw)
says "I posted it" and hands back a link. The Mini checks that link before it
calls the comment posted. Until now, if the link did not check out, the Mini
marked the comment **failed**, and a failed comment offers **Try again**,
which would post the same words on Dane's account a second time.

That nearly happened on 2026-11-18: a comment on r/polymath really went up,
but the link OpenClaw gave back had an id nobody could read, so the screen
said failed.

Now a bad or missing link is treated as "can't tell" rather than "didn't
happen". The comment shows as **Check this one by hand**, is never retried on
its own, still counts toward the 3-a-day pace, and the note says where to look:
open the post on Reddit and find the comment under Dane's account. OpenClaw
saying it did *not* post is still marked failed. YouTube and Substack posting
are unchanged.

The next slice (SC-893) adds the buttons for Dane to settle a hand check and
corrects the r/polymath comment.
