# lib/builder-client/ — builder TypeScript source (browser + server)

This is the single TypeScript source for builder logic, bundled two ways:
into `public/builder-bundle.js` for the browser (`npm run build:builder`)
and into CJS server bundles under `lib/builder/` (generated — never edit
those directly).

## The landmine

After editing `builder-template.ts` or `builder-email-template.ts`, run
`npm run build:builder-template`. The server uses the generated
`lib/builder/template.js` for page save/load normalization — if it doesn't
know a module type, it **silently coerces it to `"text"` on every load**,
destroying the module. Email rendering similarly:
`npm run build:builder-email-render` regenerates
`lib/builder/email-render.js`.

## Conventions

- Server bundles must stay browser-API-free; browser-only deps are aliased
  to stubs (`lib/builder/asset-url-stub.js`, `current-poll-stub.js`) in the
  build scripts — follow that pattern for new browser-only imports.
- `adapters/` isolates admin-fetch/session/media access so the same code
  runs in admin, public-site, and server contexts; keep environment
  concerns behind adapters.
- Tests are colocated (`*.test.ts`) and run with `npm run test:builder-ui`.
  New logic here ships with a test — this directory is where the repo's
  test discipline lives.
- All user-content HTML passes through `sanitize-html.ts` (DOMPurify
  allowlists). Extending the allowlists is a security decision — flag it.
