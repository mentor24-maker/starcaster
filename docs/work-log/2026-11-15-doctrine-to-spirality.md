## 2026-11-15 — Point StarCaster's doctrine at Spirality for the loop's rules and remove the retired parts (SC-811)

The development loop was built here before it had a name, so the rules it
learned were written into this repository's `docs/DOCTRINE.md`. The loop is
Spirality now, and its rules have moved there (Spirality SP-318), under the
same section numbers.

So sixteen sections about the loop's own machinery (the merge step, the
relay, the watchdogs, asks, claims and the pipeline's tickets) are now a
one-line pointer to the same number in Spirality's doctrine. Every rule an
agent session working in this repository must follow, and every general
rule, stays here in full, as does §6.17, which records decisions about this
repository's own `ship` command.

Retired: §6.21 (ClickUp's audit trail, which the tracker replaced), two §5.4
bullets about pins in committed files (none since 2026-08-24), and the
style guide's sections on buttons, forms and the line under a title, which
UI_RULES C9, L9 and R11 replaced. And `docs/UI_RULES.md` gains L10, the one
capital-letters rule both projects now share; bringing this repository's
field labels into line with it is SC-812.
