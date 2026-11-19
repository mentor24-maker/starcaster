## 2026-11-18 — Render rough cuts on the Mac Mini for Dane to review (Reel Spinner 4b) (#1061)

Reel Spinner could already decide what to cut out of a recording and which of
its moments were strong enough to become short clips. Nothing turned those
decisions into a video anyone could watch. Now it does.

When a recording's moments are scored, the Mac Mini makes a quick, small
**rough cut** of each edit: one of the whole recording with the "um"s and long
pauses taken out, and one short clip for each moment that scored 60 or more.
It makes them from the working copy already on the Mini, puts them in a new
**Rough cuts** folder inside the Studio folder on Google Drive, records each
one's Drive file on its edit, and deletes the Mini's copy only once Drive has
confirmed it.

It was tried on two real recordings. A 14-minute Zoom call became a 12½-minute
full edit plus three shorts, rendered and uploaded in just over a minute. A
rough cut takes about 2 to 4 MB per minute of video on Drive.

When something goes wrong it says why. A full disk waits and tries again. A
video that will not render is marked failed with the reason. A Drive upload
that fails keeps the finished video on the Mini so it is not made twice.

**After review (round 2).** Review found that a retry would put a second copy
of a rough cut on Drive. The check "is it already uploaded?" compared file
sizes, but the lookup never asked Drive for the size, so the answer was always
"no". It asks now, and a real lookup on the Mini returned the size it was
missing. A retry also now waits, rather than guessing, when the catalog cannot
read a lined-up Zoom partner, because the edit rows it makes are permanent.
