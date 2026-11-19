## 2026-11-18 — Make Outreach page stages open and close (#1060)

The Outreach page shows five stages for each channel, and every one of them
was always fully open, so a busy channel tab was a long scroll. Each stage's
header is now a button: click it, or press Enter or Space, to open or close
that stage.

On a first visit only the next stage that still needs doing is open. A closed
stage still shows its name, its state ("Done", "Needs you") and its one-line
summary, so you can see where things stand without opening anything. A closed
stage also loads nothing, so a closed Find conversations no longer asks the
server for anything.

Your choices are remembered per channel in this browser, so after a reload the
page looks the way you left it. If the browser blocks storage, the page just
uses the default and keeps working.
