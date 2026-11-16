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
