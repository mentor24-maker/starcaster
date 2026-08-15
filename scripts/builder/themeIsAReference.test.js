'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * A THEME IS A REFERENCE. Two things had to be true for that to hold, and
 * neither was, until 2026-08-15.
 *
 * 1. The reference has to survive an edit. `inputToRow` mints an id when the
 *    input has none — correct on create, catastrophic on update: the PATCH
 *    body carried a FRESH id, so saving a theme silently renamed its primary
 *    key and orphaned every page pointing at it.
 *
 * 2. Saving a theme must not write to pages. `propagateTypographyToAllPages`
 *    rewrote every page in the project on every theme save, ignoring which
 *    theme each page actually used — so saving theme A restyled the pages
 *    following theme B, and 101 page writes rode inside one request. The same
 *    shape as the canonical propagation a serverless freeze truncated on
 *    2026-07-22, and swallowed by the same bare `.catch(() => {})`.
 *
 * Both are asserted on the source, because reproducing them needs a database.
 */

const themesStore = fs.readFileSync(
  path.join(__dirname, '../../lib/builderThemesStore.js'),
  'utf8'
);
const builderRoutes = fs.readFileSync(
  path.join(__dirname, '../../routes/builder.js'),
  'utf8'
);

test('updateTheme pins the id it was given, so a save cannot rotate it', () => {
  const body = themesStore.slice(
    themesStore.indexOf('async function updateTheme('),
    themesStore.indexOf('async function deleteTheme(')
  );
  assert.ok(body.length > 0, 'updateTheme not found');

  // The row it PATCHes must carry the target id explicitly. `inputToRow(input)`
  // on its own is the bug: no id in `input` means a brand new one.
  assert.match(
    body,
    /inputToRow\(\{\s*\.\.\.input,\s*id:\s*themeId\s*\}\)/,
    'updateTheme must pass the target id into inputToRow, or every save mints a new theme id'
  );
});

test('createTheme still generates an id — the fix must not break creation', () => {
  const body = themesStore.slice(
    themesStore.indexOf('function inputToRow('),
    themesStore.indexOf('function inputToRow(') + 400
  );
  assert.match(body, /id:\s*safeText\(input\?\.id,\s*120\)\s*\|\|\s*nextThemeId\(\)/);
});

test('saving a theme writes to no page', () => {
  assert.ok(
    !/propagateTypographyToAllPages\s*\(/.test(
      builderRoutes.replace(/^\s*\/\/.*$/gm, '')
    ),
    'a theme save must not push typography into pages — pages read the theme at render ' +
    '(resolveRenderTheme). Re-adding this reintroduces cross-theme contamination and a ' +
    'bulk page write inside one request.'
  );
});

test('the theme create and update handlers return without touching pages', () => {
  for (const marker of [
    "if (pathname === '/api/builder/themes' && requestMethod === 'POST')",
    "if (themeMatch && requestMethod === 'PATCH')",
  ]) {
    const start = builderRoutes.indexOf(marker);
    assert.ok(start > -1, `handler not found: ${marker}`);
    const body = builderRoutes.slice(start, builderRoutes.indexOf('return sendOk', start));
    assert.ok(
      !/updatePage\s*\(/.test(body),
      `${marker} must not write pages`
    );
  }
});
