## 2026-11-19 — The AI provider switch is one setting for everything: let Outreach (and other groups of features) use a different AI provider from the rest (#1069)

Dane asked whether Outreach could use one AI account while everything else used another. Until now the AI provider switch on Settings › APIs was one setting for the whole platform: every feature tried the same providers in the same order.

This change sorts every AI feature into five fixed groups (Outreach, Studio / Reel Spinner, Writing, Acquire, Everything else). Each group either follows the main order, which is the default so nothing changes by itself, or has its own order. When an AI feature asks for an answer, the system now looks up its group and uses that group's order, and the answer says which group and which order it used.

Two safety rails. If a group's setting can't be read, that group quietly goes back to the main order and says so, rather than stopping. And a test now checks every place in the code that asks for AI: if someone adds a new feature without putting it in a group, the test fails and names the file, so no feature can end up billing an account nobody chose for it.

The screen for setting a group's order is the next ticket (SC-876). Production needs one small database change first (`docs/SQL/ai_provider_groups_setup.sql`, one new empty field); until it runs, everything behaves exactly as before.

**After review (round 2).** Review caught two real problems. First, the main branch had moved eight more AI features onto the shared AI door while this was waiting, and none of them had a group, so the safety test failed exactly as designed. They are now sorted: Messaging drafts, topic ideas, format changes and the web-page keyword and tag imports go in Writing; sorting the websites Acquire finds goes in Acquire; the CRM persona summary goes in Everything else. Second, a hidden trap: if the very first thing anyone saved was a group's own order, the database would record the main order as an empty list, and every other group would then have had no AI provider at all. The door now reads an empty main order as "not saved yet" and uses the default order, saying so. Saving a group can now also be checked afterwards, by reading it back and comparing.

**Round 3 (2026-11-25).** The pull request had gone red because `main` moved
under it twice. Two new Reel Spinner features (re-cutting a reel from a note,
and writing its YouTube title and description) started asking the AI door with
no group, so they now belong to Studio / Reel Spinner. And main added five more
AI providers, which made the tests' sample settings incomplete, so every test
that saved an order was refused. The tests now read the provider list from the
door itself, so the next provider added cannot break them the same way.
