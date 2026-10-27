# The browser door keeper

A small program on the Mac Mini that opens **one project's own Chrome**, sends a
live picture of it, and passes clicks and keys back — so Dane (or another
project admin) can sign in to YouTube, Substack or Reddit in a window inside
Starcaster, and the Mini keeps the sign-in for posting.

This is slice 1 of the sign-in window (Outreach wizard 3/19, ticket
`86bcrmbb4`). The whole plan, with the Google measurements and the security
design, is **`docs/LIVE_BROWSER_VIEW.md`**.

**It is reachable from nowhere yet.** It listens on `127.0.0.1` only, and that
address is written into the code, not read from a setting. The internet route
is a separate Tailscale Funnel path (slice 3); the Starcaster screen is slice 4.

## What it answers

| Request | What happens |
|---|---|
| `POST /open` | Signed by Starcaster's server (`x-door-timestamp`, `x-door-signature` = HMAC-SHA256 of `<timestamp>.<body>` with the shared secret, within 60 s). Body `{ pass, project_id, site }`. Registers a one-time pass. Opens nothing. |
| `GET /live` (WebSocket) | The viewer's first message must be `{ "type": "hello", "pass": "…" }` within 5 s. A good pass opens that project's Chrome; frames and a final `closed` message come back; mouse, key and paste messages go in. Message shapes are at the top of `server.js`. |
| anything else | 404 |

## The rules it keeps

* **The pass decides the profile.** A viewer never names a project; the pass
  does, and it was fixed when Starcaster issued it. A pass works once, within
  60 seconds, and is stored only as its hash.
* **One profile per project**, in `~/.starcaster/browsers/<project-id>/`, named
  by id so renaming a project cannot point at someone else's sign-ins. One
  Chrome per open window; a second window on the same project is refused.
* **Dane's project attaches** to the Chrome OpenClaw already runs (set
  `BROWSER_DOOR_ATTACH=<project-id>=18800`), opening its own tab and closing
  only that tab.
* **Keys are counted, never kept.** The log (`~/.starcaster/logs/browser-door.log`)
  records how many mouse, key and paste inputs arrived — never what they were.
  Each profile it creates has "offer to save passwords" switched off.
* **The window closes itself** after 3 minutes with no input and after 15
  minutes in all, and the viewer is told which.
* **About 15 pictures a second** at most.
* **It does not disguise Chrome.** On current Chrome the window reports
  `navigator.webdriver = true` because its remote-control port is on. Dane
  chose to leave that honest rather than hide it (ticket `86bcrmbb4`, option
  B); its test is a known-failing TODO, and slice 5 tests whether Google minds.
* **Never Playwright's launch.** It starts the real Chrome binary itself.

## Running it

```
cd workers/browser-door && npm ci
BROWSER_DOOR_SECRET=<32 random bytes, shared with Starcaster only> node server.js
```

| Variable | Meaning |
|---|---|
| `BROWSER_DOOR_SECRET` | Required. Refuses to start without it. |
| `BROWSER_DOOR_PORT` | Default `8091`. |
| `BROWSER_DOOR_ATTACH` | `<project-id>=<port>,…` — projects whose Chrome is already running. |
| `BROWSER_DOOR_PROFILES` | Default `~/.starcaster/browsers`. |
| `BROWSER_DOOR_LOG` | Default `~/.starcaster/logs/browser-door.log`. |
| `BROWSER_DOOR_CHROME` | Path to Chrome if it is not in `/Applications`. |

Nothing installs it as a schedule yet; that is slice 3.

## Tests

`scripts/builder/browserDoor.test.js` (part of `npm run test:builder`). The
real-Chrome tests run on a Mac with Chrome — the Mini — and skip by name on
Linux CI, which cannot show a visible Chrome.
