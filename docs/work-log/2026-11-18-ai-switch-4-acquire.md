## 2026-11-18 — Move the outreach and Acquire features that call Anthropic directly onto the AI door (AI switch 4) (#1054)

Five features spoke to Anthropic (the company behind Claude) with their own
private code: YouTube comment suggestions, Bluesky and Reddit reply
suggestions, the keyword ranking in Direct Acquire, and "generate with AI" for
Acquire's content handlers. Because they bypassed the shared AI door, the
provider switch on Settings › APIs could not reach them, and they stopped
whenever Anthropic's credit ran out.

Each now goes through the door, which uses the first provider on the switch
that can pay. What they ask the AI, and how long an answer they allow, did not
change. A new test runs every one of them against a recorded Anthropic reply
and a recorded OpenAI reply and checks both give a usable result.
