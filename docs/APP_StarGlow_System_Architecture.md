# Alphire Promo / StarGlow System Architecture

This document provides a comprehensive overview of the application infrastructure and codebase for Alphire Promo. It serves as the primary source of truth for AI agents and developers to understand the core design patterns, state management, module interactions, and security requirements.

## 1. High-Level Architecture

The system is a hybrid web application featuring a lightweight frontend interacting with a Node.js/Express backend and a Supabase-managed database.

*   **Frontend:** Pure Vanilla JavaScript Single Page Application (SPA). Avoids heavy reactive frameworks for core pages to maximize performance and direct DOM control.
*   **Backend:** Node.js Express server (`server.js`) for API routes, background tasks, and agent integrations (Vertex AI, Playwright).
*   **Database & Auth:** Powered by **Supabase**. Direct database interactions use `window.supabaseClient`, secured by backend Row Level Security (RLS).
*   **Storage:** Vercel Blob (`@vercel/blob`) handles file and media storage.
*   **Rich Text Subsystem:** A focused React + Tiptap bundle (`react-entry.js`) is used exclusively for rich text editors, compiled separately via `esbuild`.

---

## 2. Frontend HTML & Build Process

To ensure maintainability, the application's HTML is modularized rather than living in a monolithic file.

*   **Source Files:** The main structure lives in `src/layout.html`, with individual views located in `src/pages/*.html` (e.g., `messaging.html`, `develop.html`).
*   **Build Script:** Do **NOT** edit `public/index.html` directly. Run `npm run build:html` to compile the source templates into the final `public/index.html` file.
*   **Automation:** The HTML build script automatically runs when invoking `npm run dev` or `npm start`.

---

## 3. Global Application State & DOM

The application relies on explicit, centralized state management rather than implicit reactive binding.

*   **Namespace (`window.App`):** The root namespace for all logic, state, and modules.
*   **State (`App.state`):** Located in `core.js`, this acts as the single source of truth for dynamic data, entities (contacts, projects, leads), UI filters, and routing context.
*   **DOM Caching (`App.els`):** Critical DOM elements are cached at initialization to prevent redundant `document.getElementById` queries. Access them via `App.els.elementId`.

---

## 4. Routing & Navigation

Routing is purely client-side, driven by URL hashes (e.g., `#page=contactsPage`).

*   **Page Toggling:** Every view is a `div` marked with `.app-page`. `App.setActivePage(pageId)` manages visibility by toggling the `.hidden` utility class, ensuring only the active page renders.
*   **Lifecycle Hooks:** Modules register `onPageActivated` callbacks in their manifests. The router calls these hooks upon navigation to fetch necessary data and prepare the UI layout dynamically.

---

## 5. Network & API Interfacing

All internal backend communications are routed through a standardized wrapper to enforce consistent envelope handling.

*   **`App.api(path, options)`:** Automatically unwraps standard `{ ok, data, error, meta }` responses.
*   **Error Handling:** Unsuccessful responses (`ok: false`) throw structured JavaScript `Error` objects, which modules catch to trigger UI alerts via `App.notify()`.
*   **Project Context:** Multi-tenant operations are supported seamlessly; the wrapper automatically injects the `X-Project-ID` header from `App.state.currentProjectId`.

---

## 6. Security Mandate: Zero \`innerHTML\`

The project strictly enforces a **"Zero \`innerHTML\`"** policy to eliminate DOM-based Cross-Site Scripting (XSS) vulnerabilities. 

**Rules:**
1.  **Never** use `element.innerHTML = '...'` to inject strings or dynamic markup.
2.  **Clearing Nodes:** To clear an element, use `element.textContent = ''` instead of `element.innerHTML = ''`.
3.  **Building Safe DOM:** Use standard API methods (`document.createElement`, `textContent`) for simple dynamic rendering.
4.  **Complex Templates:** When rendering large template strings, use the shared "Secure DOM Builder" utilities provided in `core.js`:
    *   `App.ui.parseHTML(htmlString)`: Safely parses an HTML string and returns a `DocumentFragment`.
    *   `App.ui.setSecureHTML(element, htmlString)`: Safely replaces the content of an element with parsed nodes.

---

## 7. UI / UX Design Patterns

*   **CSS System:** Built on standardized CSS variables and utility classes. 
    *   `.standard-form-grid`: A two-column responsive CSS Grid for all application forms. Use `.full-width` and `.half-width` inside it.
    *   `.data-table`: Enforces consistent styling, hover states, and alignments for tabular data.
*   **Inline SVG Icons:** Instead of external icon fonts, standard SVG paths are cached in `App.ACTION_ICONS` (`core.js`). Render them safely using `App.makeInlineIcon()` and `App.makeIconButton()`.
*   **Contextual UI (Reparenting):** Advanced UI modules (e.g., Development Task tracking in `devAgent.js`) utilize DOM reparenting (`appendChild`) to seamlessly move shared interfaces (like the global chat) into targeted contextual views without losing event listeners or state.

---

## 8. Development Workflow Rules

When extending the system, follow these core principles:
1.  **Respect the HTML Build:** Always edit `src/pages/*.html` and rebuild, never the compiled `index.html`.
2.  **Vanilla JS First:** Stick strictly to vanilla JavaScript for UI features. Do not introduce Vue/React components into the main app (except for the isolated Tiptap editor).
3.  **Idempotent Rendering:** Data-driven rendering functions (e.g., `loadTable`) should entirely wipe and rebuild the UI segment from `App.state`.
4.  **Security First:** Adhere strictly to the Secure DOM Builders and avoid `innerHTML` string interpolation completely.
