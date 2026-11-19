## 2026-11-15 — Let the Assets Context page accept file uploads (#1016)

Assets › Context, the page where each project keeps reference material for
agent sessions, now takes files as well as written notes. There is an Upload
file button, and files can be dropped anywhere on the page: PDFs, text,
Markdown, CSV, JSON, Word, Excel and images, up to 50 MB each. Each file is
listed with its type and size, and its title opens it.

Why it matters: a price list, a brand guide or a screenshot can now sit next
to the written notes, so an agent working on the project has it to hand.

How it stays safe and honest:

- A wrong type or an oversize file is refused before anything is uploaded,
  and the message names the type or the size.
- Files go straight from the browser into file storage, so big files are not
  cut off by the server's small request limit.
- Each project's files live in their own folder, and the server refuses to
  record a file from anywhere else, so one project can never delete another
  project's file.
- Deleting a file's row also deletes the stored file. If that part fails, the
  page says the file was left behind and where it is, instead of going quiet.
- When the storage service refuses an upload, its own message is always the
  same vague sentence; the page now asks our server why and shows that.
