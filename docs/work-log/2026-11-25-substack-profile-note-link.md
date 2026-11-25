## 2026-11-25 — Substack replies that really posted are marked failed, and Try again would post them twice (#1103)

On Nov 18 the Mini posted a reply on Dane's Substack account, and it worked —
the screenshot shows it live — but the Outreach screen called it failed. Worse,
a failed row has a Try again button, and pressing it would have posted the
same reply a second time, in public, under Dane's name.

It went wrong in two places. Substack handed back the reply's address in a
form the Mini had never seen (`/profile/<number>-<name>/note/...` instead of
`/@name/note/...`), so the Mini decided it was not a link to a Note at all.
And when the Mini could not check a link, it treated that as proof nothing had
gone out, rather than proof the link was odd.

Now the Mini reads both address forms. And once the browser says it posted a
Note or a reply, anything short of proof marks the row "check this by hand —
it will not be tried again", never "failed". Reddit got the same rule last
week. A one-off script, run after this merges, moves the Nov 18 reply to
posted with its link; its dry run found that one row and no others.
