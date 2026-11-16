## 2026-11-15 — Add a command that lets agent sessions read a project's Context entries (#1017)

The last of three pieces for Assets › Context. The page lets Dane keep notes
and files for each project; this gives agent sessions a cheap way to read
them: `npm run context -- dump --project <slug>` prints every note as one
plain-text document, `list` shows what is there, and `get` shows one entry
(for a file, where to download it; `--save` downloads it).

It only reads. It is careful about one thing above all: "this project has no
context" and "I could not read the context" never look alike. Production does
not have the Context table yet (its SQL file has not been run there), and the
command says exactly that, naming the file, instead of pretending the project
is empty. A wrong project name is named back too.

Fixed after review: a long dump read by an agent used to be cut off at 64 KB
with no warning, because the command quit before the text finished leaving;
it now waits for every byte, and a test pushes 120 KB through a pipe to prove
it. A `#` line inside a code sample is no longer turned into a heading in the
dump. A file download that stalls now gives up after a minute and says so,
instead of hanging. `--help` succeeds, the "more than one project" message
reads as a sentence, and a mistyped project no longer leaves an empty folder.

Fixed after the second review: production reads the table through a
read-only login, and with the database's per-row security switched on, a
login with no read rule sees nothing at all and gets no error. So the day the
SQL file was run, every project would have read as "no context", the exact
false answer this command exists to prevent. The SQL file now gives that login
its read rule (safe to run again on a database that already ran it). `get` now
needs `--project` too, so an entry id can never pull in another project's
note. And a code sample or a second paragraph inside a bullet point now keeps
its shape instead of being squashed onto one line.
