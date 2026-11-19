## 2026-11-18 — Fixes made to the shared loop in Spirality do not reach StarCaster until someone copies them by hand, and nothing says when StarCaster is behind (#1057)

StarCaster runs its own copy of Spirality's ticket tool, in the `loop/` folder,
copied by hand. When Spirality gets a fix, StarCaster keeps running the old copy
until a session copies it across — and until now nothing noticed. That is how a
check Spirality added on Nov 17 (refusing to hand Dane SQL without a clickable
link) was missing on StarCaster when its build pass did exactly that on SC-832.

Now `npm run loop:drift` compares every file in `loop/` with Spirality's latest
version and says IN STEP, BEHIND (naming the files) or CANNOT TELL (when GitHub
cannot be read — never mistaken for "all fine"). The relay runs it every wake,
asks GitHub at most once an hour, and posts to StarCaster's bus once a day while
the copy is behind, with one all-clear when it catches up. It is a stopgap: the
next two tickets (SC-869, SC-870) remove the copy altogether.
