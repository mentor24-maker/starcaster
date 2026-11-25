## 2026-11-25 — Stop the MacBook's Google Drive sign-in expiring every few weeks, if rclone's Google app is the cause (#1104)

The MacBook's Google Drive sign-in, which carries Zoom recordings up to
Studio, was refused twice in a month. The suspicion was that the Google "app"
it signs in through was still in Google's Testing mode, where every sign-in
dies after seven days. Dane looked it up in Google Cloud Console: the app is
**In production**, so that is not it.

Nothing about the setup changed. The Studio guide (`docs/STUDIO.md`) now
records which Google app the sign-in uses, that it is In production, that a
rebuilt MacBook should keep the same one, and what to look at next if the
refusals return. The warning Dane gets when the sign-in breaks (SC-879) is
still in place.
