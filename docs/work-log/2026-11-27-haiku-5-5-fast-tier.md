## 2026-11-27 — Switch Anthropic's fast tier and key probe to Claude Haiku 5.5 (#1113)

StarCaster sorts its AI calls into two kinds: "fast" for small, cheap jobs and
"strong" for the ones that need more thought. When a fast job went to
Anthropic it used Claude Haiku 4.5, and the daily check that the Anthropic key
still works used the same model. Both now use Claude Haiku 5.5, which costs a
tenth as much ($0.10 per million words-in-pieces read and $0.50 written,
against $1 and $5). The price for Haiku 5.5 was already on file, so the spend
panel reports the new cost correctly from the first call, and Haiku 4.5's price
stays on file so older spending still adds up.

A project that picked its own fast model on Settings › APIs keeps its choice;
only the default changed. The tests that check the default were updated, and a
new check makes sure the key probe really sends Haiku 5.5 — nothing tested that
before. Putting the old model back makes both tests fail, which shows they can
catch the change being undone.
