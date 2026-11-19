# Context library — reading a project's reference material

Each project keeps written reference material for agent sessions on
**Assets › Context**: notes (a title and rich text) and uploaded files (PDF,
text, Markdown, CSV, JSON, Word, Excel, images). Tickets SC-808 (the page),
SC-809 (files) and SC-810 (this command).

## When to use it

Before working on anything for a client project — copy, a page, a campaign,
a reply — read that project's context. It is where the operator puts what an
agent session would otherwise have to guess: brand voice, pricing rules,
who the client is, what not to say.

```
npm run context -- list --project <slug|id|name>     one line per entry: id, title, kind, last updated
npm run context -- dump --project <slug|id|name>     every note in full, one Markdown document
npm run context -- get  --id <entry id> --project <slug|id|name>   one entry in full (a file: name, type, size, address)
```

`dump` is the usual one: a single read gives you everything. Files are listed
at the end of a dump by name and address; to read one, add
`--save <folder>` (to `get` or `dump`) and open what it downloads.
**The folder must be outside the repository** — the repository is public and
these are a client's own files; the command refuses a folder inside it.

`--local` reads this machine's database instead of production.

## What the answers mean

| Exit | Means | Example |
|---|---|---|
| 0 | Printed. | `No context entries in AGORA` is a real answer: the project has none. |
| 1 | The question had no answer. | `Could not find project nosuchproject in production.` |
| 2 | **Could not tell.** Nothing was read. | The table is not in the database yet (it names `docs/SQL/context_entries_setup.sql`), the local Supabase container is not running, a file did not download. |

A 2 is never "no context". Do not carry on as if the project had none — say
that the context could not be read.

## How it reads

Read-only, and scoped to the one project named — every command needs
`--project`, `get` included, so an entry id can never reach into another
project. Production is read through
`PROD_DB_READONLY_URL` with `psql` inside the local Supabase container (the
same route `npm run broken-links` uses), so the local container must be
running (`supabase start`). The Doppler `dev` config points the app's own
database settings at this machine, which is why the command does not go
through `lib/contextStore.js`'s queries; it uses that store's row shape, and
the logic lives in `lib/contextReadout.js` (tests:
`scripts/builder/context.test.js`).

**Production needs the read rule.** The command reads production as the
read-only login `starcaster_readonly`, and the table has row-level security
on. A login with no read rule sees zero rows and gets no error, so without it
every project would print "No context entries" — a false empty. The rule is
the last block of `docs/SQL/context_entries_setup.sql`; the file is safe to
run again, so a database that ran an earlier copy gets it by running the
file once more. Nobody has to remember that: before reading production the
command checks that the rule is there, and if it is missing it stops with
exit 2 and says to run the file again, rather than printing a false empty.
(`npm run sql:unapplied` cannot see read rules, so this check is the only
thing that would notice.)

**`--save` refuses any folder inside a git working tree**, not only this one,
because from a worktree the main checkout is the same public repository in
another folder. Symlinks are resolved first. And it only downloads addresses
that are this project's own stored context files, the same check the store
makes when the address is saved.

Adding and editing stay on the Context page: the command never writes.

## Which tools read an entry (SC-826)

Each entry on Assets › Context carries one switch per tool that may read it —
today one, **Reel Spinner reads this**. A tool reads only the entries switched
on for it; nothing is switched on until somebody switches it on.

- The list of tools is one place, `lib/contextUses.js`. The store refuses any
  value not in it, so a switch can never be free text.
- The column is `context_entries.used_by` (`docs/SQL/context_entries_used_by.sql`,
  run after the setup file). Until a database has it, notes still list and save;
  a switch refuses and names that file, and the reader below answers
  "could not tell", never "nothing switched on".
- Switching a tool on or off does **not** change an entry's *Last updated*:
  that date is about the wording, and the fingerprint below reads it.
- `list`, `get` and `dump` print which tools read each entry
  (`reel-spinner`, or `read by no tool`).

### How a tool reads its notes

```js
const { readContextFor } = require('./lib/contextFor');
const res = await readContextFor({ projectId, use: 'reel-spinner' });
// res.data: { text, fingerprint, entries, unreadable, reason }
```

- `text` — every switched-on note (and `.txt`/`.md` file, downloaded) as plain
  text, oldest first, each under `## <title>`.
- `fingerprint` — changes when a switched-on entry is added, removed, switched
  off or edited, and not otherwise. Store it with anything made from `text`, so
  a later edit shows on everything made under the old wording.
- `unreadable` — each switched-on file whose words could not be read (a PDF,
  an image, a failed download), with the reason. Never dropped silently; the
  page says the same thing beside the switch.
- Nothing switched on is `ok: true` with `text: ''` and a `reason`. A database
  that could not be read is `ok: false`. Only this project's entries are read.
