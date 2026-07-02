# components/ — React builder UI conventions

After any change here: `npm run build:builder` (regenerates
`public/builder-bundle.js`). If styles changed too: `npm run build:css`.
Tests: `npm run test:builder-ui`.

## Module settings editors (`components/builder/*-module-settings.tsx`)

- **Field strips:** horizontal groups use `BuilderModuleFieldStrip` +
  `BuilderModuleField` — a wrapping flex row. Each field is
  `flex: 0 0 auto` with a declared width token; fields stay on one line
  until they don't fit, then hard-wrap. Never stretch a control to fill
  leftover row space.
- **Width tokens:** `label` (230px), `select-sm` / `select-md` (ch-based),
  `num` (digit-sized via `BuilderNumberSelectControl`), `align`, `color`,
  `check`, `text-md`, `full` (own line).
- **H / V Margin:** always offer both (`horizontalMargin` /
  `verticalMargin`), adjacent in the same strip — never a lone "Margin".
- **Labels never wrap** (`white-space: nowrap`); shorten text instead.
- **Advanced blocks** (border, shadow, rarely-edited groups) go in
  `<details class="hanging-details">`.
- Legacy `.builder-module-form-row` grids may remain on old modules;
  use field strips for all new work.
- Styles live in `src/css/_builder-react-overrides.css` and
  `src/css/_builder-react.css` — see `src/css/CLAUDE.md`.

## Adding a builder module type

1. Register the type in `lib/builder-client/builder-template.ts`
2. `npm run build:builder-template` — **mandatory**; without it the server
   bundle coerces the new type to `"text"` on every load (silent data loss)
3. `npm run build:builder`

## Rendering user content

All rich-text/embed HTML must pass through the DOMPurify helpers in
`lib/builder-client/sanitize-html.ts`. Never `dangerouslySetInnerHTML`
raw user content.

## CRM public forms (`crm-form` module)

- Layout/style settings persist on the form record's `styles` JSON
  (`lib/crmFormStyles.js`)
- Public rendering styles live in `src/css/_builder-react.css` — not
  `_crm.css` (that's the admin preview)
- Module center/right alignment must not override the form's internal
  alignment
