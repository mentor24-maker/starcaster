# Application Official Style Guide & Core UI Conventions

> **Supporting doc.** Agent quick-reference UI rules live in [`.cursorrules`](../.cursorrules). Full CSS blueprints remain below. Project canon: [`AI_AGENT_HANDOFF.md`](AI_AGENT_HANDOFF.md).


*Last Updated: 2026-04*

## 0. Development Philosophy & Workflow

### The Craftsman Mindset
We are not a company trying to rush a product to market ASAP. We have the time, and the mandate, to act as skilled craftsmen. Our goal is to build a next-gen application in the most efficient and elegant way possible. Every cycle should be approached as if we are constructing a magnum opus. We must continuously look for opportunities to clean up, straighten up, streamline, and improve the application—from the deepest infrastructure up to the polished UX.

### Workflow Protocols
To preserve the integrity of our monolithic architecture and reduce frustrating revision cycles, all development must adhere to these strict disciplines:
1. **Zero "Hacky" Edits**: We do not use brute-force or overly broad string-replacement scripts. All code modifications must use precise, line-targeted tools to prevent collateral damage.
2. **Mandatory Discovery Phase**: Before writing any code, we must conduct thorough searches (`grep`, etc.) to trace execution paths and verify existing DOM structures. Assumptions are prohibited.
3. **Planning Over Execution**: For anything non-trivial, we will pause and draft a structural Implementation Plan for review *before* altering code. This ensures alignment and prevents convoluted logic.
4. **Surgical Precision**: Large files (like `devAgent.js` or `index.html`) are highly sensitive. Edits to these files must be treated as surgical procedures, deeply respecting the existing state, asynchronous flows, and monolithic nature of the code.


## 1. Global Component Paradigm: Buttons
*Retired on 2026-11-15 (SC-811).* Superseded by [`UI_RULES.md`](../UI_RULES.md) C9 (2026-11-05): four kinds, `btn` (outlined secondary), `btn btn-primary`, `btn btn-save`, `btn btn-danger`, at two heights. `btn-ghost` is only an alias of `btn` now.

## 2. Global Typography Matrix
To prevent fragmented rendering across browser distributions (MacOS/Windows overrides), the typography is locked to a strict internal baseline kerning model via `styles.css`:
*   `h1` through `h6` and `p` intrinsically bind line-heights and native padding.
*   **Header Color Constraint**: All top-level textual arrays default to `color: var(--ink);` to uphold contrast against the `#ffffff` paper backdrop, explicitly protecting legibility over aggressive theme resets.

## 3. Form Administration Standards
*Retired on 2026-11-15 (SC-811).* Superseded by [`UI_RULES.md`](../UI_RULES.md) L9 (a short setting keeps its label beside it; a text box takes its label above; `.form-grid-beside`, `.form-field-above`) and W7 (boxes sized to what goes in them).

## 4. "Pod" Data Layouts & Navigation Anchors
Landing pages no longer utilize flowchart schematics or legacy primitive layout wrappers. Interactive navigational hubs dynamically draw to explicit Grid classes wrapping Pod interfaces:
*   **Grid Assembly**: Root pages mount via `.section-settings-shell` providing unified gap scaling.
*   **Pod Construction**: Individual interaction interfaces instantiate `<div class="pod">`.
*   **Icon Layout constraints**:
    *   Pods strictly decouple into logical planes using `.pod-icon-col` (left) and `.pod-content` (right). 
    *   **NEVER embed massive inline style payloads mapping flex alignments**. 
    *   Icons uniformly inherit native system SVG constraints, mapped explicitly via explicit Lucide configurations using `width: 84px; height: 84px; stroke-width: 1px;`.
    *   Icons perfectly inherit color accents via `color: var(--accent);`.

## 5. Instructional Text Purge
*Retired on 2026-11-15 (SC-811).* Superseded by [`UI_RULES.md`](../UI_RULES.md) R11 (2026-11-05): a screen may carry one `.page-heading-desc` line under its title, one sentence of 150 characters or fewer.
