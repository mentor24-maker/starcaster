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
