## 2026-11-16 — Bring StarCaster's copy of Spirality's loop up to date so its bus can move (#1022)

StarCaster's ticket commands (the `loop/` folder) are a copy of Spirality's,
and that copy was three days old. In those three days Spirality learned two
things the next ticket, SC-818, depends on: letting a project's bus (the
chat-like ticket the loops post to) live in its own queue, and a `move`
command that moves a ticket into another project.

This swaps the folder for an unchanged copy of Spirality as it is today. The
two commands are now available to StarCaster, and nothing else behaves
differently yet. Without this, moving the bus first would have made the relay
treat every comment on every StarCaster ticket as a bus message.

The scripts that start each lane on the Mini were left as they were: neither
change involves them, and every command they use was tried against the new
copy and answered normally.
