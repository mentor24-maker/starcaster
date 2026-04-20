# Application Official Style Guide & Core UI Conventions
*Last Updated: 2026-04*

## 1. Global Component Paradigm: Buttons
Never override native bare-metal `button { ... }` or `input { ... }` tags globally via CSS. Instead, map all native interactive elements hierarchically through explicit utility classes.
*   **Primary Actions**: Use `<button class="btn btn-primary">`.
*   **Secondary/Ghost**: Use `<button class="btn btn-ghost">`.
*   **Destructive/Alert**: Use `<button class="btn btn-danger">`.
*   **Micro Integrations**: For deeply embedded grid/table interactions, Javascript constructs should dynamically append `.btn .tiny-btn .icon-btn`. 

## 2. Global Typography Matrix
To prevent fragmented rendering across browser distributions (MacOS/Windows overrides), the typography is locked to a strict internal baseline kerning model via `styles.css`:
*   `h1` through `h6` and `p` intrinsically bind line-heights and native padding.
*   **Header Color Constraint**: All top-level textual arrays default to `color: var(--ink);` to uphold contrast against the `#ffffff` paper backdrop, explicitly protecting legibility over aggressive theme resets.

## 3. Form Administration Standards
Legacy inline grids are officially deprecated. Stacking and padding inconsistencies disrupt cognitive acquisition inside heavy modal administration tasks. Use these specific grid containers instead of bare `<div>` structures:
*   **Input Stacking**: Any modal section requiring sequential vertical stacks (Label → Input) uses `<div class="form-group">` rather than explicit flex instructions or row-mapping blocks to perfectly inherit margin margins.
*   **Admin Panels**: Standard input grids dynamically routing fields mapping sideways use `.standard-form-grid`. For ultra-dense modals (e.g. video curation filters), utilize `.standard-form-grid-4col`. 

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
Core root-level applications are aggressively structured against instructional "bloat".
*   In-line manual summaries under root structural anchors (`<div class="page-heading-row">...</div> <p>...`) are prohibited system-wide.
*   End users draw operational instructions either implicitly from structural constraints or explicitly from deeply embedded tooltips/micro-copy later, maintaining perfectly crisp platform layouts visually.
