# The tailnet access rule — what Dane's Tailscale devices may open on the Mini

Ticket 86bctcm39. Status: **written, not yet applied** (2026-10-28). This file
is the record of the rule; the copy that counts is the one in the Tailscale
admin console (Access controls), and only Dane can edit that, because it is a
browser login.

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
* **Into the Mini:** only port **22** (ssh, a fallback; the machines normally
  use the home network) and port **8080** (the YouTube helper, which is already
  public through Funnel, and which the outside check uses as its "is this
  address reachable at all?" control). Nothing else — so 18789, 18800 and 8091
  are closed to the tailnet.
* **Funnel and Tailscale SSH settings are not touched.** The `nodeAttrs` block
  (which carries the `funnel` permission) and the `ssh` block stay exactly as
  they are.

A device added to the tailnet later reaches nothing until it gets a line here.
That is the safe direction to be wrong in.

## The edit

In the policy file, find the one block that lets everything reach everything.
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
  // The Mini: ssh, and the YouTube helper that is already public via Funnel.
  // Nothing else — OpenClaw (18789, 18800) and the door keeper (8091) stay closed.
  {"src": ["autogroup:member"], "dst": ["mac-mini"], "ip": ["tcp:22", "tcp:8080"]},
],

// The console runs these before it saves. If the rule above does not do what
// this file says, the save is refused and nothing changes.
"tests": [
  {
    "src":    "mentor24@gmail.com",
    "accept": ["mac-mini:22", "mac-mini:8080", "macbook-pro:22"],
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
