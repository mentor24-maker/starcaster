## 2026-11-19 — Run StarCaster's loop lanes from Spirality instead of StarCaster's own copy (#1083)

StarCaster keeps a copy of Spirality's ticket tool, and that copy had fallen seven files behind. Fixes Dane asks for in Spirality only reach StarCaster when someone copies them over, which is how a bare SQL path reached his SC-832 card.

This is the first of two steps toward ending the copy. It brings the copy fully up to date, and it turns on four settings that let Spirality's own lane runner keep StarCaster's safety habits: obey the pause switch, give way to Dane's own sessions, sleep through a Claude usage limit instead of retrying into it, and keep reporting a heartbeat. The old copy refused settings it did not know, so they could not be turned on until it caught up.

Nothing on the Mini changes yet. The second step, actually moving the lanes over, has to be done by an agent session started by hand on the Mini, because it stops the very job a build pass runs inside. The steps and a one-command rollback are written in `loop/README.md`.
