# The tailnet access rule — what Dane's Tailscale devices may open on the Mini

Ticket 86bctcm39. Status: **applied by Dane on 2026-10-28**, with Screen
Sharing (`tcp:5900`) added to the Mini's ports when he saved it; Tailscale's
built-in tests passed on save. **`tcp:443` was added by Dane on 2026-10-29**
(he replied "Done" on the ticket at 9:30am MDT) — it was found missing after the
rule went live, and the sign-in window needs it from the MacBook (below).

This file is the record of the rule; the copy that counts is the one in the
Tailscale admin console (Access controls), and only Dane can edit that, because
it is a browser login. When the two disagree, the console is right and this
file is out of date — fix the file.

Outside check after the rule was saved, 2026-10-28 1:01pm MDT, measured from
the MacBook (`./scripts/check_browser_door_route.sh --from macbook-pro`):

```
PASS  tailnet 100.108.7.116:18789 -> no answer (filtered)
PASS  tailnet 100.108.7.116:18800 -> no answer (filtered)
PASS  tailnet 100.108.7.116:8091 -> no answer (filtered)
```

All three ports this ticket was filed to close are closed, and Funnel still
works (Funnel traffic does not pass through tailnet access rules). The one line
of that check still failing — the `wss://…/live/live` viewer socket answering
`400 Bad Request` — is the door-keeper route on the public address, not this
rule.

Re-run after 443 was added, 2026-10-29 10:34am MDT, same command: the internet
and home-network lines and all three public `/live` lines PASS (the viewer
socket now answers "refused" as it should). The tailnet lines read CANNOT TELL,
not PASS — Tailscale was switched off on the MacBook at the time (`tailscale
status` there: "Tailscale is stopped"), so nothing could be measured over the
tailnet. Re-run with Tailscale on to confirm 443 from a tailnet device.

## Why it exists

Tailscale on the Mini runs without root ("userspace networking"). In that mode a
connection from another tailnet device to the Mini is handed to the same port on
`127.0.0.1`, so a program that listens "on loopback only" is still reachable from
every device on the tailnet (`docs/LIVE_BROWSER_VIEW.md` §3). Measured from the
MacBook, 2026-10-28 6:39am (`./scripts/check_browser_door_route.sh --from macbook-pro`):

```
FAIL         tailnet      100.108.7.116:18789 -> CONNECTED (curl exit 0) — this port must not be reachable
```

18789 is OpenClaw's control page; 18800 (OpenClaw's Chrome control, no password)
and 8091 (the browser door keeper) are exposed the same way whenever they run.
"Shields up" would close it but also turns Funnel off, so Dane chose an access
rule instead (2026-10-27, option B on 86bcrmbdw).

## The devices, as Tailscale reported them on 2026-10-28

| Name in the rule | Tailnet address | What it is |
|---|---|---|
| `mac-mini` | `100.108.7.116` | the always-on Mini |
| `macbook-pro` | `100.127.85.12` | Dane's MacBook Pro |

Both are signed in as the same Tailscale user, so the rule has to name the
machines by address — "your own devices" cannot tell them apart.

## What the rule allows

* **Into the MacBook:** everything, from any of Dane's devices — unchanged.
* **Into the Mini:** only these ports, and nothing else — so 18789, 18800 and
  8091 are closed to the tailnet:
  * **22** — ssh, a fallback; the machines normally use the home network.
  * **443** — the Mini's public address, as seen from a tailnet device. On a
    tailnet device the Funnel name resolves to the Mini's tailnet address, and
    Tailscale itself answers 443 there with the same `/` and `/live` routes
    Funnel publishes — so it reaches only what is already public. Without it the
    sign-in window will not open from the MacBook: its picture feed is refused
    (Mini log, 2026-10-28 1:11pm, 26 drops of
    `TCP{100.127.85.12 > 100.108.7.116:443} no rules matched`; found on
    86bcu7d6h / PR #895). **Not in the console yet.**
  * **5900** — Screen Sharing, added by Dane when he saved the rule.
  * **8080** — the YouTube helper, which is already public through Funnel, and
    which the outside check uses as its "is this address reachable at all?"
    control.
* **Funnel and Tailscale SSH settings are not touched.** The `nodeAttrs` block
  (which carries the `funnel` permission) and the `ssh` block stay exactly as
  they are.

A device added to the tailnet later reaches nothing until it gets a line here.
That is the safe direction to be wrong in.

## The edit

**Adding 443 to the rule already saved** (done by Dane, 2026-10-29) was two
small changes in the console: `"tcp:443"` in the Mini's `ip` list, and
`"mac-mini:443"` in the test's `accept` list. The full block below is what the
file now contains.

**The first time** (already done, 2026-10-28): in the policy file, find the one block that lets everything reach everything.
It is one of these two shapes:

```
"acls": [
  {"action": "accept", "src": ["*"], "dst": ["*:*"]},
],
```

```
"grants": [
  {"src": ["*"], "dst": ["*"], "ip": ["*"]},
],
```

Replace that whole block with the following, and leave everything else in the
file alone:

```
"hosts": {
  "mac-mini":    "100.108.7.116",
  "macbook-pro": "100.127.85.12",
},

"grants": [
  // The MacBook: open to Dane's devices, as before.
  {"src": ["autogroup:member"], "dst": ["macbook-pro"], "ip": ["*"]},
  // The Mini: ssh, its public address (443, which serves only what Funnel
  // already publishes), Screen Sharing, and the YouTube helper.
  // Nothing else — OpenClaw (18789, 18800) and the door keeper (8091) stay closed.
  {"src": ["autogroup:member"], "dst": ["mac-mini"], "ip": ["tcp:22", "tcp:443", "tcp:5900", "tcp:8080"]},
],

// The console runs these before it saves. If the rule above does not do what
// this file says, the save is refused and nothing changes.
"tests": [
  {
    "src":    "mentor24@gmail.com",
    "accept": ["mac-mini:22", "mac-mini:443", "mac-mini:5900", "mac-mini:8080", "macbook-pro:22"],
    "deny":   ["mac-mini:18789", "mac-mini:18800", "mac-mini:8091"],
  },
],
```

If the file already has a `hosts` or `tests` section, merge these lines into it
rather than adding a second one (the console refuses a duplicate).

## Undo

Before saving, copy the whole policy file into a note. To undo, paste it back
and save. Nothing else changes when the rule changes — no restarts, no
re-sign-ins.

## How to tell it worked

An agent session runs, from the Mini:

```
./scripts/check_browser_door_route.sh --from macbook-pro
```

Every `tailnet` line must read PASS (or CANNOT TELL for a port nothing is
listening on at that moment), and the public Funnel address must still answer.
From the MacBook, pinned to Funnel's public address (on a tailnet device the
name otherwise resolves to the Mini's tailnet address, which would test the
wrong route):

```
curl -sS -o /dev/null -w '%{http_code}\n' \
  --resolve mac-mini.tail7fc5c6.ts.net:443:208.111.34.11 https://mac-mini.tail7fc5c6.ts.net/
```

That printed `401` (the YouTube helper refusing a request without its key) on
2026-10-28 before the rule; it must still print `401`, not a connection error.

The main risk is Funnel. Tailscale's documentation says Funnel needs the
`funnel` node attribute; it does not say whether access rules also filter the
traffic Funnel carries in from the internet. The second check above is what
settles it, and Undo is the answer if it fails.
