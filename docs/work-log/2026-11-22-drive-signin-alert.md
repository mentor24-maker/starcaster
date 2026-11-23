## 2026-11-22 — Tell Dane when the MacBook loses its Google Drive sign-in, so Zoom recordings stop reaching Studio silently (#1093)

The MacBook sends Zoom recordings and Photos "Studio" videos to Google Drive
through a sign-in that expires now and then. It broke twice (Oct 19–26 and
Nov 18), and both times the only warning went to the team chat, which Dane does
not read. He found out because a recording never arrived.

Now the first upload Google refuses puts a ticket in front of him, "Google
Drive sign-in needed on the MacBook". It says when the sign-in broke, how many
recordings are waiting, and the one-minute fix. Once an upload works again, it
says "Nothing needed" and takes him off it.

It only fires on a real refusal from Google, never on a Wi-Fi drop, which
rclone's error wording makes look the same. It doesn't rewrite the ticket every
15 minutes. If the ticket can't be written, the log says so plainly and the
job tries again on the next pass.
