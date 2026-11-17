## 2026-11-17 — Connect Reel Spinner to the Dane of Earth YouTube channel (Reel Spinner 6b) (#1030)

Reel Spinner's last step uploads finished videos to YouTube, so the Mac Mini
needs permission to post to the Dane of Earth channel. The first check was
whether the Google sign-in we already have (the one Drive uses) would do. It
would not: it only has permission for Drive, and YouTube would not even say
which channel it belongs to.

So this adds three small commands. One checks, without changing anything,
which channel the Mini can reach and whether it can upload. One is the
one-time browser sign-in for Dane. It refuses to save a sign-in for the
wrong channel and stores the result in Doppler without ever showing it. The
third uploads a 5-second test pattern as Private, tries to make it visible,
records what YouTube allowed, and deletes it.

The worry going in was that YouTube locks every upload from a new Google
project to Private until Google audits the project. Google's own page now
says that restriction no longer applies. The test upload will confirm it for
our project once Dane has signed in. Uploads get their own allowance of 100
a day, far more than Reel Spinner will use.
