# UI Standards & Conventions

This document outlines structural UI mandates that must be strictly observed when expanding the application or introducing new features. 

---

## 1. Data Tables

- **Always Make Columns Sortable:** Every CRUD or data-display HTML table implemented must allow column sorting by clicking on standard string/date table headers (`<th>`). State tracking for the active `sortColumn` and `sortDirection` must be implemented alongside an indicator logic natively.
- **Binary Metadata Toggles:** Do not render long, blank text inputs as inline filters for boolean logic. Example: Use a single `"Has [Network]"` checkbox to filter boolean conditions, rather than forcing the user to type `https...`.

---

## 2. Form Layout Standard

All standard data-entry forms MUST follow the `standard-form-grid` layout convention. This is a two-column CSS grid where the first column contains the field labels (right-aligned) and the second column contains the form elements (inputs, dropdowns, etc.).

### CSS Blueprint
Forms should utilize the `.standard-form-grid` class. Its underlying layout logic is:
```css
.standard-form-grid {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 0.75rem;
  align-items: center;
}
```

### HTML Structure
A valid typical form looks like a two-column table with an empty first column on the final row to properly offset the submit button.

```html
<form class="standard-form-grid">
  <!-- Title / Heading spans both columns -->
  <h4 class="standard-form-grid-full">Add New Option</h4>

  <!-- Row 1 -->
  <label>Key</label>
  <input type="text" name="key" required>

  <!-- Row 2 -->
  <label>Label</label>
  <input type="text" name="label" required>

  <!-- Row 3 -->
  <label>Order</label>
  <input type="number" name="sort_order" required>

  <!-- Final Row: Offset for Submit Button -->
  <div></div>
  <button type="submit">Add</button>
</form>
```

**Key Requirements:**
1. The `<form>` itself acts as the Grid container.
2. Direct children implicitly fall into the Grid cells. Do NOT wrap rows in separate `<div>`s `<div class="form-row">` structure if inside a `standard-form-grid`. 
3. `<label>` tags should solely contain text, not wrap the `<input>`.
4. Buttons should be placed in the second column by explicitly putting an empty `<div></div>` in the first column of that row, unless you want the button to span full width using `.standard-form-grid-full`.

### Checkbox & Radio Element Variants
Because standard inputs heavily expand to 100% width, checkboxes placed in the second column of the grid will look warped unless handled specifically.
Apply `.standard-form-checkbox` directly to the `<input type="checkbox">` elements.

If placing a cluster of checkboxes related to one left-hand label (e.g. "Acquire Elements"), wrap the checkboxes in a secondary grid or flex box within the second column `<div>`.

### Feedback Validation Glow
All populated input fields rendered from persisted records must emit a green glow outlining completeness, switching flexibly to red when left unpopulated.

---

## 3. Field Labelling Convention

We apply a strict canonical rule to how form fields and inputs are identified: **Do not use placeholder text to instruct the user.**

**Core Rules:**
1. **No Placeholders:** Fields should be completely blank by default. 
2. **Left-Aligned Labels:** Always place the descriptive text (the field `<label>`) visually to the left of the field itself.
3. **Consistency:** This applies to both the `.standard-form-grid` (where labels inherently live in the left column) and focal Hero Action Inputs, which should use flexbox or grid layouts to ensure the label precedes the massive input box.

*Why?* Placeholder text vanishes as soon as the user starts typing, deleting context. Keeping labels cleanly on the left provides permanent context and maintains highly professional, un-cluttered visual whitespace inside the input boundaries.

---

## 4. Hero Action Inputs

Large, central Call-to-Action styled input fields (such as the main URL bar on the Acquire: Web page) should be styled consistently to draw immediate focus and provide highly vibrant feedback during user interaction.

### CSS Blueprint
Apply the `.hero-action-input` utility globally to standard `<input>` elements meant for massive user focus events.

```css
.hero-action-input {
  border: 1px solid var(--border);
  background-color: var(--field-bg);
  transition: all 180ms ease;
}

.hero-action-input:hover,
.hero-action-input:focus {
  border-color: #2aa7fa;
  /* Simulates a 3px border without triggering layout shifts, plus an outer glow */
  box-shadow: 0 0 0 2px #2aa7fa inset, 0 0 16px rgba(42, 167, 250, 0.45);
  background-color: #f6fbff;
  outline: none;
}
```

**Key Requirements:**
1. Allows primary inputs to swell to a vibrant 3px electric blue border visually without altering the physical box-model padding, preventing layout jitter.
2. The background color shifts to a very light blue to visually pop.
3. This is independent of its width/layout constraints, meaning it can safely handle `width: 100%` block styling in a grid row.

---

## 5. Hanging Details Summary

When using the native `<details>` and `<summary>` HTML tags for collapsable panels (like the "Advanced" options), the native browser-rendered disclosure triangle (`▶`) disrupts vertical text alignment by pushing the `<summary>` string to the right. 

To create a perfectly left-flush block where the text perfectly aligns vertically with the hidden content below it, use the `hanging-details` class.

### CSS Blueprint
Apply the `.hanging-details` class to the parent `<details>` element.

```css
/* Removes native markers and suspends a synthetic triangle into the left-margin space */
.hanging-details > summary {
  list-style: none; /* removes standard arrow in Firefox/Edge/Chrome */
  position: relative;
  cursor: pointer;
  font-weight: 700;
  display: flex;
  align-items: center;
}

.hanging-details > summary::-webkit-details-marker {
  display: none; /* removes standard arrow in older Webkit */
}

.hanging-details > summary::before {
  content: "";
  position: absolute;
  left: -1rem; /* Adjust so the arrow hangs entirely leftwards */
  top: 50%;
  margin-top: -4px;
  width: 0;
  height: 0;
  border-left: 5px solid var(--ink);
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  transition: transform 150ms ease;
}

.hanging-details[open] > summary::before {
  transform: rotate(90deg);
}
```

**Key Requirements:**
1. The text inside the `<summary>` block will sit at X:0 inside the wrapper.
2. The disclosure triangle effectively renders at X:-1rem, meaning it physically hangs offline in the margin whitespace to the left.
3. Your parent container must have sufficient padding or padding-left on the row so that the leftward-hanging triangle isn't clipped by the viewport edge.
