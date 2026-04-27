# APP / StarGlow System Architecture

This document provides a comprehensive overview of the Alphire Promo (App/StarGlow) frontend architecture. It is intended for AI agents (like custom GPTs) and developers to quickly understand the core design patterns, state management, routing, and module interactions.

## 1. High-Level Overview

The system is built as a **Single Page Application (SPA)** using purely **Vanilla JavaScript, HTML5, and CSS3**. It avoids heavy reactive frameworks (like React, Vue, or Angular) in favor of direct DOM manipulation and an explicit centralized state model.

- **Global Namespace:** `window.App` is the root namespace for all properties, state, and modules.
- **Backend/API:** Powered by **Supabase** for database interactions (`window.supabaseClient`) and custom backend endpoints.
- **Component Styling:** Relies on standardized CSS variables and utility classes (e.g., `.app-page`, `.standard-form-grid`, `.data-table`).

---

## 2. Global Application State (`App.state`)

All dynamic data rendered in the UI is stored in `App.state` inside `public/js/core.js`. This serves as the single source of truth.

- **Routing:** `App.state.activePage` stores the current page ID.
- **Entities:** Collections like `contacts`, `segments`, `campaigns`, `projects`, and `promoLeads` are stored here as arrays of objects.
- **Filters/Sorts:** Global filter and sort criteria (e.g., `leadSort`, `contactsFilters`) are preserved in state, allowing users to navigate away and return without losing their place.

---

## 3. DOM Caching (`App.els`)

To avoid repeated `document.getElementById` calls, the application caches critical DOM elements in `App.els` at initialization. Modules access elements using `App.els.myElementId`.

---

## 4. Routing & Navigation

Navigation is driven by **URL Hashes** (`#page=contactsPage`).

### How Routing Works (`App.setActivePage`):
1. **Hash Change:** The system listens for `hashchange` and `popstate` events.
2. **Page Toggling:** Every "page" is a `div` with the class `.app-page`. `App.setActivePage(pageId)` iterates through all `.app-page` elements and toggles the `.hidden` utility class, ensuring only the target page is visible.
3. **Menu Highlighting:** Updates `.menu-link` elements to reflect the active navigation state.
4. **Lifecycle Hooks:** Modules can register `onPageActivated` callbacks in their manifests. When a page is activated, the router invokes these hooks, allowing modules to fetch data, reset forms, or update UI layouts dynamically.

---

## 5. Network & API Interfacing

### The `App.api()` Wrapper
All interactions with internal backend routes pass through `App.api(path, options)`. 

**Key Features:**
- **Standardized Envelope:** Automatically unwraps `{ ok, data, error, meta }` envelopes.
- **Error Handling:** On `ok: false`, it throws a structured JavaScript `Error` that the calling module can catch and display via `App.notify()`.
- **Project Context:** Automatically injects the `X-Project-ID` header from `App.state.currentProjectId` for multi-tenant or multi-project operations.

### Supabase Integration
For direct database access, the system uses the standard Supabase JS client (`window.supabaseClient`), primarily utilizing `select`, `insert`, `update`, and `delete` operations based on Row Level Security (RLS) defined in the backend.

---

## 6. Module Structure

The application functionality is logically partitioned into discrete files (e.g., `devAgent.js`, `contacts.js`, `campaigns.js`), each extending the `App` namespace.

### Common Module Patterns:
- **Initialization:** Modules often define a startup routine (e.g., `App.devAgent.init()`) that binds event listeners to elements in `App.els`.
- **Data Loading:** Methods like `loadContacts()` or `loadProjects()`:
  1. Fetch data via `supabaseClient` or `App.api()`.
  2. Update `App.state`.
  3. Re-render the respective table or UI element (e.g., `tbody.innerHTML = ...`).
- **Form Handling:** Submissions prevent default (`e.preventDefault()`), gather data from `document.getElementById()`, execute the API/Supabase call, and then invoke the data loading method to refresh the UI.

### Key Modules:
- `core.js`: Bootstrapping, state, routing, DOM refs, and API wrappers.
- `auth.js`: Supabase authentication lifecycle (Login, Register, Logout).
- `contacts.js`: CRM logic, table rendering, complex filtering.
- `devAgent.js`: Development Task & Project tracking. Implements advanced UI features like dynamic reparenting of the Chat/Discussion interface into specific task context panels.

---

## 7. UI / UX Design Patterns

### Layouts
- **`.standard-form-grid`:** A two-column responsive CSS Grid used for almost all forms. Inputs span full or half widths using `.full-width` or `.half-width` classes.
- **`.data-table`:** Standard styling for tabular data, complete with hover states and aligned action columns.
- **`.badge`:** Used for statuses and tags.

### Dynamic Elements
- **Modals/Panels:** The UI heavily utilizes sliding side panels and modals. These are activated by removing the `.hidden` class from an overlay or panel container.
- **Icons:** Inline SVG icons are preferred over font libraries. Standard SVG paths are cached in `App.ACTION_ICONS` (`core.js`) and rendered using `App.makeInlineIcon()` or `App.makeIconButton()`.

### Reparenting / Contextual UI
Advanced modules like `devAgent.js` use **DOM Reparenting** (via `appendChild`) to move shared interface elements (like global chat) into contextual areas (like a Task Editor's discussion accordion) and back out again without losing state or event listeners.

---

## 8. Development Guidelines

When modifying or extending the APP/StarGlow system, adhere to these rules:
1. **No Frameworks:** Stick to Vanilla JS. Use `document.createElement` and template literals for rendering.
2. **State Syncing:** Do not mutate the DOM manually without updating `App.state` if the data needs to persist or be read by other components.
3. **Idempotent Rendering:** Rendering functions (like `loadTable`) should completely wipe (`innerHTML = ''`) and rebuild the UI segment based on the current state.
4. **Use Established Patterns:** When creating a new form, use `.standard-form-grid`. For tables, use `.data-table` and `<thead>/<tbody>` patterns. Use SVG icons from `App.ACTION_ICONS`.
