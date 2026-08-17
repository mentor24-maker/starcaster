# Roger Thorson — archived agent-team experiment

**Status: archived, not deleted. Nothing here runs, and nothing in the live app
imports it.** Retired 2026-08-16.

This was the first attempt at a multi-agent team on this project, built before
any agent harness existed. Roger Thorson was a "Technical Consultant / software
architect" persona; Angie and Archie (originally "Antigravity") were meant to be
a planner and a coding agent. They coordinated by writing JSON messages into a
Supabase table and polling it — a hand-rolled message bus, with a strict
envelope called `TriAgentState` that every agent was told to reply inside of.

The work has been superseded by real agent harnesses (Claude Code, and the
ClickUp party-line channel for cross-session coordination).

## What is in here

| File | What it did |
|---|---|
| `bin/ag.js` | CLI to read the shared chat and post a message as `antigravity` |
| `bin/ask_roger.js` | CLI to send a one-off prompt to the Roger persona |
| `scripts/ag_push.js` | Pushed a message to a session and "woke" the target roles |
| `scripts/ag_pull.js` | Polled the table for commands addressed to this agent |

## Why it was archived rather than deleted

The code is a readable record of a design that was tried and outgrown, and
`git mv` was used so the full history follows the files. If you ever want to see
how the bus worked, it is all still here.

## Two things worth knowing before reviving any of it

1. **It was already dead in production.** Angie's system prompt was loaded at
   startup with `fs.readFileSync` from a hardcoded absolute path inside one
   developer's home directory. On every other machine — including every
   production deploy — that read threw `ENOENT`, was swallowed by a `try/catch`,
   and left the prompt as an empty string. Because `consultRoger()` routed
   **both** `agentRole: 'angie'` and `agentRole: 'roger'` to that constant, the
   live "Ask Roger" feature was calling the model with **no system prompt at
   all**. It had been that way since it shipped, and the only visible symptom
   was a stack trace on every cold start.

   The lesson generalises past this experiment: a `try/catch` that logs and
   continues turns a hard failure into a permanent silent one. A missing prompt
   file should have refused to start, not shrugged.

2. **The persona/protocol constants still live in `lib/rogerClient.js`.** That
   file was left in place deliberately — despite its name it is the app's
   **shared AI client**, exporting `queryGemini`, `queryAnthropic` and
   `queryOpenAI`, which Contacts and the tweet OCR path both depend on. Deleting
   it to "finish removing Roger" would break live features that have nothing to
   do with this experiment.

## What was deliberately left alone

The "Ask Roger" Dev Agent admin page (`routes/devAgent.js`,
`public/js/devAgent.js`, `src/pages/devAgent.html`) is still wired into the app
and still serves its endpoints. Retiring that UI is a separate, larger job — it
also carries the project Tasks, Git Status, Team and Friction Log panels, and
`lib/rogerChatsStore.js` is called by `routes/tasks.js` and
`lib/taskTimerDaemon.js`, which `server.js` boots at startup.

## Restoring

```
git mv archive/roger-thorson/bin/ag.js bin/ag.js      # etc.
```

They were standalone CLIs with no npm scripts pointing at them, so moving them
back is all it takes.
