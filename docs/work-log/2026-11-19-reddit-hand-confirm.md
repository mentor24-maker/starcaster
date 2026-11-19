## 2026-11-19 — Add buttons to confirm by hand whether a Reddit comment posted (#1072)

Sometimes the Mac Mini posts a Reddit comment and then can't prove it went out. The Comments screen marked those rows "Check this one by hand", but gave Dane nothing to click, so the rows just sat there.

Each of those rows now has two buttons. **It is live** asks for the link to the comment and saves the row as Posted, with that link. **It did not post** saves it as Failed. Before anything is saved, the link is checked: it has to point at one comment on the right post. A link to the post itself, to a different post, or to the comment being replied to is turned down with a plain sentence saying why. That way a wrong paste can't mark an unposted comment as live.

A comment that was marked failed even though OpenClaw said it posted can be marked live the same way. One r/polymath comment is in exactly that state: live on Reddit, recorded as failed. Retrying it would have posted it twice. It can now be put right once its real link is pasted in.
