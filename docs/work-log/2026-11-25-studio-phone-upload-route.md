## 2026-11-25 — Send chosen iPhone videos to Studio without the MacBook having to download them from iCloud (#1102)

Getting an iPhone take to the Studio used to go phone → iCloud → MacBook →
Google Drive, and the MacBook step kept failing: its Photos app keeps most
originals in iCloud, and macOS will not let a background job download them.
Nine of thirteen videos were stuck that way.

The Studio guide now describes the route that works, proved on a real take
this morning: open the Google Drive app on the iPhone, go to the Studio
Inbox, tap + › Upload, and pick the video. It arrives as the untouched
original, charged to the 2 TB account, and still says it came from an
iPhone, which is what the Mac Mini needs to file it and line it up with the
Zoom recording of the same session.

The guide also lists the routes that were tried and failed, so nobody spends
another evening on them, and fixes the Drive folder's name (it is
"Studio-probe", not "Studio").

Dane then chose to switch off the MacBook's album step, and that is in this
change too. The album videos failed on every 15-minute pass, which made the
whole job report failure, posted to the bus, and stopped it recording that
it was alive — even when the Zoom half had sent its recordings fine. The job
now sends Zoom recordings only, says in its log that the album step is off,
and goes back to reporting healthy when Zoom works. The album code is kept,
behind a switch that is off unless someone turns it on by hand.
