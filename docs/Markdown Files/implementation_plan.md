# Goal: Ask Roger "Roger Drive" File Management System

> **Historical / archive.** Superseded for onboarding and architecture by [`docs/AI_AGENT_HANDOFF.md`](AI_AGENT_HANDOFF.md) (2026-05-18) and [`.cursorrules`](../.cursorrules). Kept for context only.



The objective is to transcend the current limitations of Base64 JSON-injected image attachments by constructing a dedicated, persistent File Management System natively integrated into the Ask Roger environment. This system will allow agents and human operators to upload, manipulate, and review files of *any type* safely, referencing them universally.

## Proposed Changes

### 1. Database & Storage Architecture
We require a formal registry mapping objects to Supabase Storage, detaching them from raw message payloads.

#### [NEW] docs/roger_file_manager_setup.sql
A new database migration script to be run in your Supabase SQL Editor. It will scaffold:
- A new table `public.roger_files` storing metadata: `id, file_name, mime_type, size, supabase_url, session_id, chat_id, created_at, updated_at`.
- This ensures any file uploaded through the chat mechanism naturally deposits into the system and is formally registered to the `chat_id` that spawned it.

---

### 2. Frontend Interface Design
We will augment the physical Ask Roger page to act as a dual-pane environment.

#### [MODIFY] public/index.html
- **Navigation Toggle:** Introduce a cohesive UI toggle at the header of the main chat panel: `[ Discussion Board ]` vs `[ Roger Drive ]`.
- **Dedicated UI:** Construct a hidden `<div id="rogerFileManager">` element encompassing a comprehensive file grid layout (Name, Type, Originating Chat, Date, Actions).
- **Relieving Chat Restrictions:** Strip the `accept="image/*"` limiter from the chat attachment node `<input id="rogerChatFile" />`.

#### [MODIFY] public/js/roger.js
- Introduce `App.roger.files` logic scope to handle fetching and rendering the file grid.
- Completely overhaul the `App.roger.submitChat` function. Instead of compiling massive files into dangerous Base64 JSON footprints, we will deploy standard `FormData`. The client will push the raw file to a new Node endpoint, grab the finalized universal registry URL, and *then* append it to the chat message logically.

---

### 3. Backend API Extensibility
We must open endpoints capable of swallowing raw streams and saving them locally/to Supabase seamlessly.

#### [MODIFY] routes/roger.js
- Implement `GET /api/develop/roger/files` (Retrieval for the dedicated portal).
- Implement `POST /api/develop/roger/files/upload` (File ingestion system).
- Implement `PATCH` and `DELETE` endpoints to authorize file organization requests natively.

> [!NOTE]
> By detaching files from the local state payloads and mounting them to an explicit `roger_files` relation, your backend agents (like Python processors) can securely query and parse documents without needing to read the entire chat transcript.

## User Approval Needed
Please review the dual-pane UI methodology ([ Discussion ] / [ Files ] toggle) and database architecture outline. Once approved, I will begin explicitly coding the SQL infrastructure and routing logic.
