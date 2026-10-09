# Live browser view — the plan (for approval)

Task: [Live browser view 1](https://app.clickup.com/t/86bcet8dx). Written
2026-10-08 on the Mac Mini by a build pass. This is a plan: no feature code,
nothing installed, nothing left running.

## What we recommend

When you (or Rich, or one of the few people this is for) click **Connect
YouTube** in Starcaster, a window opens inside Starcaster showing a moving
picture of a Chrome browser on the Mini. That Chrome uses **that project's own
browser profile** and no one else's. You click and type in the picture, and the
clicks and keys are passed to the real Chrome. You sign in, close the window,
and the Mini keeps the sign-in so OpenClaw can post as you.

The picture comes from **Chrome's own built-in screen feed** (the same remote
control channel OpenClaw already uses), served by a **small new program on the
Mini**, the *door keeper*. Starcaster reaches it through a **second, separate
Tailscale Funnel address** that leads only to the door keeper and never to the
OpenClaw gateway.

What keeps a stranger out: the door keeper shows nothing to anyone unless
Starcaster has just handed them a **one-time pass**. Starcaster only issues one
to a signed-in user who administers that project. The pass works once, has to
be used within a minute, and opens one profile. The window closes itself after
three idle minutes and after fifteen minutes at the most. Every window is
logged: who opened it, which site, when, and for how long.

**The trade-off in one sentence:** this is the only route that works for
Substack and YouTube, but it puts a door to a signed-in browser on the
internet, so the pass and the door keeper must be built carefully and kept
small.

## Who it is for, and what that saves

About five trusted people: Dane, Rich and a few close associates, each set up
by hand. So the plan leaves out sign-up screens, billing, quotas, a queue for
when the Mini is busy, and more than one Mini. About five Chrome profiles fit
on the Mini easily: each idle profile costs nothing, and only one or two are
ever open at the same moment. If this ever needs to serve strangers, that is a
different plan.

## 1. Google's refusal: tested first, as asked

Google sometimes refuses to sign in a browser it can tell is remote-controlled
("This browser or app may not be secure"). We tried Google's sign-in page in
two kinds of remote-controlled Chrome on the Mini, each with a fresh,
throwaway profile, using the test account Dane set up (its address is kept in
Doppler as `GOOGLE_TEST_EMAIL`, and is left out here because this repository
is public).

| How Chrome was started | What Google did after the email was entered |
|---|---|
| **Playwright starts Chrome** (the easiest way to build a live view; it marks the browser as automated, `navigator.webdriver = true`) | **Refused.** Page `…/signin/rejected`: *"Couldn't sign you in. This browser or app may not be secure."* |
| **The door keeper starts the real Chrome itself**, with only its remote-control port switched on (`navigator.webdriver = false`). This is how OpenClaw's Chrome already runs. | **Not refused.** Google went on to check the address and answered *"Couldn't find this account"*: it does not recognise the test address. |

What that means:

* **The approach decides Google's answer.** A browser that Playwright starts is
  rejected on sight. A real Chrome that is only being *watched and fed clicks*
  gets through the first check. So the door keeper must start Chrome itself
  (or attach to the Chrome OpenClaw already runs) and must **never** use
  Playwright's launch. Slice 1 has a test for that.
* **The password step has not been tried yet, for two reasons.** First,
  Google says the test address does not exist. The address in Doppler
  (`GOOGLE_TEST_EMAIL`) is exactly the one in your comment; we checked that
  without printing it. So the account was probably never finished, or the
  name is slightly different. Second, the Mini's safety system for agent
  sessions refused, again, the step where an agent session types a Google
  password, even after your "B". No permission rule had been added that this
  session could see.
* **In the finished feature an agent session never types a password.** You
  do, in the picture. So the realest test is the one where you sign in
  yourself through a throwaway view (slice 5 builds that check in).

Command (throwaway script, since deleted; nothing secret in it), and its
output:

```
$ node /tmp/lbv/measure.mjs google-cdp
google/cdp: navigator.webdriver=false
google/cdp: url=https://accounts.google.com/v3/signin/identifier
google/cdp: password field shown=false; "may not be secure" shown=false; "Couldn't sign you in" shown=false
google/cdp: page text: Loading Sign in with your Google Account. ... Email or phone Couldn't find this account Forgot email? ...

$ node /tmp/lbv/measure.mjs google-pw
google/playwright: navigator.webdriver=true
google/playwright: url=https://accounts.google.com/v3/signin/rejected
google/playwright: password field shown=false; "may not be secure" shown=true; "Couldn't sign you in" shown=true
google/playwright: page text: Loading Couldn't sign you in This browser or app may not be secure. Learn more Try using a different browser. ...
```

## 2. How the picture and the clicks travel: three approaches compared

| | (a) Chrome's own screen feed, from a small Mini program | (b) A VNC view of a separate screen | (c) OpenClaw's own live view |
|---|---|---|---|
| What it is | Chrome sends a picture each time the page changes; the program passes clicks and keys back as Chrome input. | A remote-desktop picture of a screen that holds only that browser. | OpenClaw 2026.9.8 has a built-in "screencast" of the browser it drives. |
| Tried on the Mini | **Yes, measured** (below). | **Could not try:** macOS has no way to make a separate screen for one browser without extra software, and none is installed (`Xvfb`, `x11vnc` absent). The only VNC on the Mini is Screen Sharing (port 5900, open on the home network), which shows the **whole desktop**. | **Read, not run.** Its docs say it is **view-only** ("Viewers send no application messages"), clicks go through a separate control route, and both live on the OpenClaw gateway, which must stay unreachable from outside. Running it needs the gateway password, which an agent session does not handle. |
| Speed | 60 pictures per second on a moving page, about 2 per second on a still one. | n/a | Docs: about 20 pictures per second. |
| Delay from a key press to the picture showing it | **22 ms typical, 25 ms slow, 41 ms worst** (25 keys, on the Mini). Over the internet, add your connection's round trip (typically 30 to 100 ms). | n/a | n/a |
| Password and two-step code | **Work.** A test password field received all 23 characters; a code field received all 6 digits. | n/a | Cannot type: view-only. |
| Shows only that person's browser? | Yes: one tab, one profile. | Only with a separate screen, which the Mini cannot make. Screen Sharing shows everything. | Yes, but only the OpenClaw-driven profile. |
| Verdict | **Recommended.** | Ruled out: breaks "a sign-in window, not a remote desktop". | Ruled out as the route: no typing, and it lives on the gateway. It is proof that the design works, and the door keeper copies its safety rules (single-use, 60-second token; one feed per tab; feed stops if the page leaves the allowed site). |

Measurement output (throwaway script, since deleted):

```
$ node /tmp/lbv/measure.mjs screencast
screencast: moving page 60.0 frames/s, avg frame 8 KB (~3.7 Mbit/s); still page 2.2 frames/s
screencast: key-to-frame delay over 25 keys: median 22 ms, p90 25 ms, max 41 ms
screencast: password field received 23 of 23 characters; code field = all 6 digits
```

The 8 KB pictures were of a nearly blank test page. A real sign-in page is
busier. Slice 1 caps the stream at about 15 pictures per second, which is
plenty for signing in and keeps a phone connection comfortable.

## 3. How it reaches Starcaster

Starcaster runs on Vercel and cannot reach the Mini directly. The Mini already
has one public route: **Tailscale Funnel**, giving the Mini a fixed public web
address that leads to one program, the `youtube-media` worker on port 8080.

The plan adds **one more Funnel path** on the same address (for example
`/live/`), leading to the door keeper on its own port. Funnel only forwards the
paths it is told about, so the OpenClaw gateway (port 18789) and OpenClaw's
Chrome control port (18800) stay unreachable, as they are now.

**Proof the gateway is loopback-only today** (run on the Mini, 4:36pm):

```
$ lsof -nP -iTCP:18789 -sTCP:LISTEN
node    ...  IPv4 ...  TCP 127.0.0.1:18789 (LISTEN)
node    ...  IPv6 ...  TCP [::1]:18789 (LISTEN)

$ curl -sS -m 5 http://<Mini-home-network-address>:18789/        # the Mini's home-network address
curl: (7) Failed to connect to <Mini-home-network-address> port 18789 after 1 ms: Couldn't connect to server
$ curl -sS -m 5 http://127.0.0.1:18789/           # from inside the Mini, for contrast
200

$ lsof -nP -iTCP:18800 -sTCP:LISTEN               # OpenClaw's Chrome control port
Google    ...  IPv4 ...  TCP 127.0.0.1:18800 (LISTEN)
```

The gateway listens only on the Mini's inside address. A connection to the
Mini's network address is refused. The ticket asked for this check *from
another machine*, and that could not be done this pass: the MacBook did not
answer over ssh, and Tailscale (the other route) is down (next paragraph). A
refusal on the Mini's own network address is the same test, because the
gateway is not listening there at all. Slice 3 repeats it from outside.

**Found while checking: Tailscale has not been running on the Mini since about
Oct 5, 9:35pm.** Its last log line is from then, `tailscaled` is not running,
and `tailscale funnel status` cannot reach it. So the `youtube-media` worker
has probably been unreachable from production since then, and nothing said
so: `npm run worker-watch` answers CANNOT TELL because its address is not set
where it runs. Tailscale was started by hand (`nohup`, per
`workers/youtube-media/README.md` step 8), so nothing restarts it after a stop
or a reboot. This plan depends on Funnel, so slice 3 puts it under a schedule
that restarts it. Fixing the YouTube worker sooner is its own ticket.

**"Nothing reachable between sign-ins."** One honest limit: something has to be
listening to hear "open a window now", so it cannot be literally nothing. The
plan keeps it to the least possible:

* Between sign-ins the door keeper answers exactly one thing, a signed "open"
  request from Starcaster's server, and refuses everything else. No picture,
  no browser, no list of profiles.
* The browser picture exists only during a window. When the window ends, the
  door keeper closes that Chrome's connection and the pass is dead.
* The "open" request is signed with a secret shared only by the Mini and
  Vercel, the same arrangement `youtube-media` uses.

## 4. Who may open it

* **Only a signed-in Starcaster user who administers that project.** The
  Starcaster server checks this before anything else happens.
* **A one-time pass.** The server makes a random pass (32 random bytes), tells
  the door keeper "pass P may open project X's profile for site S", and gives
  P to the browser. The pass is single-use and must be used within 60 seconds.
  A pass that is reused, late or for another project is refused before any
  picture is sent.
* **It closes itself.** After 3 minutes with no click or key, and after 15
  minutes in total, the window ends and the person sees "Window closed. Click
  Connect to open it again."
* **Every window is logged** in a new Starcaster table: who, which project,
  which site, opened when, closed when, and why it closed (finished, idle,
  time limit). The table carries `project_id` **and** `owner_user_id`
  (landmine 12) and has row-level security switched on, like every table here.

## 5. Keeping clients apart

* **One Chrome profile per project**, in its own folder on the Mini named by
  the project's id, not its name, so renaming a project cannot point at
  someone else's folder: `~/.starcaster/browsers/<project-id>/`. It is created
  by the door keeper the first time that project opens a window.
* **Dane's existing profile is reused, not copied.** OpenClaw already runs
  Chrome on `~/.openclaw/browser/dane-of-earth/`. For Dane's project the door
  keeper attaches to that same Chrome, so a sign-in reaches OpenClaw straight
  away. Each new client gets a matching OpenClaw profile at the same time.
* **One pass, one profile.** The project is fixed inside the pass when
  Starcaster issues it. Nothing the person's browser sends can change which
  profile they see. Slice 1 has a test that a pass for project A cannot reach
  project B.
* **One Chrome per open window**, with its control port on the Mini's inside
  address only, so one client's Chrome is never reachable through another
  client's window.

## 6. Where the passwords go

**Nowhere in Starcaster.** You type into the picture; each key travels to the
Mini as a single key press and goes straight into Chrome. Starcaster's server
never sees the keys, because the window talks to the door keeper directly
once the pass is accepted. The door keeper does not save or log what was
typed: it logs how many inputs arrived, never what they were. And each profile
has Chrome's "offer to save passwords" switched off, so Chrome keeps the
sign-in (a cookie) and not the password.

**How that is checked (slice 1):** a test types a made-up marker password
through a window, then searches the door keeper's logs, the session table and
the profile's saved-password list for the marker, and fails if it appears
anywhere.

## 7. Which route each platform gets

| Platform | Route | Why |
|---|---|---|
| **YouTube** | Live view | Comments post from OpenClaw's browser (YouTube outreach 5/7). The official route needs a registered business identity Alphire does not have, and `lib/connections/contract.js` refuses it for that reason. Depends on the Google test above. |
| **Substack** | Live view | No official way to post Notes, replies, restacks or likes, so the browser it is (Substack Notes 6/7). |
| **Facebook** | Official button for a Page; live view for a personal profile | Pages connect through Meta's sign-in today (`lib/connections/adapters/facebookPage.js`). Personal-profile posts have no official route and already go through the browser (`lib/facebookPersonalPublisher.js`). |
| **Instagram** | Official button | Already connects through Meta (`lib/connections/adapters/instagram.js`). |
| **X** | Official button | Already connects through X's own sign-in (`lib/connections/adapters/x.js`). |
| **LinkedIn** | Live view, only if needed | The official route needs the same business identity as YouTube and is refused in `contract.js`. Nothing posts to LinkedIn today, so no slice below. |
| **TikTok** | Neither yet | Starcaster has no TikTok client, and TikTok's sign-in is strongly bot-resistant. Revisit when there is a reason to post there. |

## 8. Nothing left running

Everything started for these measurements was a throwaway Chrome with a
throwaway profile under `/tmp/lbv`, closed when each measurement finished. No
Funnel path was added, and the OpenClaw gateway setting was not touched.

Before (4:32pm):

```
$ launchctl list | grep -i starcaster
(pid)	0	com.starcaster.youtube-media
(pid)	0	com.starcaster.openclaw
-	0	com.starcaster.pipeline-pulse
(pid)	0	com.starcaster.studio-worker
(pid)	0	com.starcaster.loop-build
(pid)	0	com.starcaster.loop-review
-	7	com.starcaster.bus-relay
-	0	com.starcaster.weekly-report
-	0	com.starcaster.colima
```

After (4:37pm):

```
$ launchctl list | grep -i starcaster
(pid)	0	com.starcaster.youtube-media
(pid)	0	com.starcaster.openclaw
-	0	com.starcaster.pipeline-pulse
(pid)	0	com.starcaster.studio-worker
(pid)	0	com.starcaster.loop-build
(pid)	0	com.starcaster.loop-review
-	0	com.starcaster.bus-relay
-	0	com.starcaster.weekly-report
-	0	com.starcaster.colima
$ pgrep -fl 'lbv|9333' || echo "no test chrome running"
no test chrome running
```

Same nine jobs. (Process ids are shown as `(pid)`, and the Mini's home-network
address as a placeholder, because this repository is public.) The middle number for `bus-relay` is the result of its last
run (7 before, 0 after). It ran on its own schedule in between; nothing here
touched it.

## 9. The build tickets (drafts, none filed)

In order. Each is one pull request. Dane approves the plan first.

### Slice 1: The door keeper on the Mini, reachable from nowhere yet
**Goal:** a small program on the Mini that opens a project's Chrome profile,
sends a live picture of it, and passes clicks and keys back, listening only on
the Mini's inside address.
**Scope:** `workers/browser-door/` (Node): starts the real Chrome itself with
a remote-control port on 127.0.0.1 (never Playwright's launch), or attaches to
OpenClaw's Chrome for Dane's profile; screen feed capped at about 15 pictures
per second; click, key and paste relay; 3-minute idle and 15-minute total
close; logs input counts only; turns off "save passwords" in each profile it
creates.
**Acceptance:** tests prove `navigator.webdriver` is false in the opened
Chrome; a pass for project A cannot reach project B; a marker password typed
through it appears in no log and no saved-password list; idle close fires.
**Non-goals:** no internet route, no Starcaster screen.
**Risk:** medium (it drives signed-in browsers).

### Slice 2: The pass and the log, in Starcaster
**Goal:** Starcaster can issue a one-time pass to a project admin and records
every window.
**Scope:** table `browser_view_sessions` (with `project_id`,
`owner_user_id`, RLS on, setup SQL in `docs/SQL`); route `POST
/api/browser-view/open` (project admins only) that makes the pass and sends a
signed "open" to the door keeper; route to record the close.
**Acceptance:** a non-admin gets 403; a pass is single-use and dies after 60
seconds; rows land with both tenant columns, checked by reading them back.
**Non-goals:** no viewer screen yet.
**Risk:** medium.

### Slice 3: The route, and Tailscale that restarts itself
**Goal:** the door keeper is reachable from Vercel on its own Funnel path, and
the OpenClaw gateway provably is not.
**Scope:** a launchd job for `tailscaled`, so it restarts after a stop or a
reboot (it has been down since about Oct 5, with nothing restarting it); a
launchd job for the door keeper; a Funnel path `/live/` to it; an entry in
`lib/nodeRoles.js` and the heartbeat; a check, run from outside the Mini,
that 18789 and 18800 are refused and that `/live/` without a pass shows
nothing.
**Acceptance:** that outside check passes and is pasted on the ticket;
`npm run doctor:node` knows the new job.
**Risk:** medium (opens a route to the internet).

### Slice 4: The "Connect" window in Starcaster
**Goal:** a **Connect <site>** button in the project's Connections screen
opens the live picture in Starcaster, with a countdown and a Close button.
**Scope:** React panel under `components/`; reads the pass from slice 2;
draws the picture; sends clicks, keys and paste; clear words when the window
closes, and why.
**Acceptance:** `check:panels`, `check:shots`; a sign-in to a non-Google test
site works end to end.
**Risk:** low.

### Slice 5: Google, YouTube and Substack, signed in for real
**Goal:** Dane signs in to the test Google account, then to YouTube and
Substack, through the window, and OpenClaw can use those sign-ins.
**Scope:** Dane types the password himself (an agent session never does);
record what Google showed at the password and two-step steps; connect the
Substack Notes and YouTube outreach screens to "Connect"; if Google refuses,
stop and bring it to Dane before going further.
**Acceptance:** a link to one real comment or Note posted after a sign-in made
through the window.
**Risk:** medium (the Google answer can still change the YouTube plan).
