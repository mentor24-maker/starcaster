'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Ticket 86bbue8ux. Two operator corrections on the live Delray page, and
 * neither one could be caught by any gate this repo has:
 *
 *   1. the module truncated every taxonomy name with an ellipsis, so a real
 *      page read "Tennis Cha…", "Delray Te…", "advanced…", "clay court…";
 *   2. it shipped its own category list beside the `blog-category-manager`
 *      module that already existed, on the same page.
 *
 * `check:panels` measures the EDITOR, not the rendered module. `check:render`
 * drives builder-preview with no database, so this module renders its empty
 * state there and a clipped name has nothing to clip. There is no DOM testing
 * library in this repo, so a component test cannot populate the table either.
 *
 * That leaves the source. These assertions strip comments first and anchor on
 * STRUCTURE rather than on phrases, so a reworded comment cannot make them
 * pass and a rewritten comment cannot make them fail.
 */

const ROOT = path.join(__dirname, '..', '..');

const stripJs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
const stripCss = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ');

/** Just the AdminBlogLinksPreview component, which closes out the file. */
function moduleSource() {
  const full = fs.readFileSync(path.join(ROOT, 'components', 'builder-template-preview.tsx'), 'utf8');
  const marker = 'function AdminBlogLinksPreview(';
  const at = full.indexOf(marker);
  assert.ok(at > 0, 'AdminBlogLinksPreview should still exist in builder-template-preview.tsx');
  return stripJs(full.slice(at));
}

/** Every CSS rule whose selector mentions this module. */
function moduleCssBlocks() {
  const css = stripCss(fs.readFileSync(path.join(ROOT, 'src', 'css', '_builder-react-overrides.css'), 'utf8'));
  const blocks = [];
  const re = /([^{}]*admin-blog-links[^{}]*)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) blocks.push({ selector: m[1].trim(), body: m[2] });
  return blocks;
}

// ── 1. Nothing clips a name ───────────────────────────────────────────────

test('no stylesheet rule for this module clips text', () => {
  const blocks = moduleCssBlocks();
  assert.ok(blocks.length > 0, 'the module should still have stylesheet rules; the selector may have been renamed');
  for (const { selector, body } of blocks) {
    assert.ok(
      !/text-overflow\s*:\s*ellipsis/.test(body),
      `${selector} clips its text with an ellipsis — that is the 86bbue8ux defect`
    );
    assert.ok(
      !/white-space\s*:\s*nowrap/.test(body),
      `${selector} forbids wrapping, which forces a long tag to overflow or clip`
    );
  }
});

test('the module does not cap the width of the pane holding taxonomy names', () => {
  for (const { selector, body } of moduleCssBlocks()) {
    if (!/max-width/.test(body)) continue;
    // The checkbox is deliberately pinned to a fixed size (a tenant theme's
    // `input { width: 100% }` blew it out to 1056px). Nothing else may.
    assert.match(
      selector,
      /checkbox/,
      `${selector} caps its width; only the checkbox is allowed to, and a cap on a name column is what truncated the live page`
    );
  }
});

test('the tag name cell wraps rather than clipping', () => {
  const src = moduleSource();
  assert.match(
    src,
    /overflowWrap:\s*["']anywhere["']/,
    'the tag name should wrap with overflowWrap so a long tag drops to a second line instead of being cut'
  );
  assert.ok(
    !/textOverflow:\s*["']ellipsis["']/.test(src),
    'an inline ellipsis is back in the module — that is exactly what the operator reported'
  );
});

// ── 2. It does not duplicate the Category manager ─────────────────────────

test('the module never CREATES, RENAMES or DELETES a category', () => {
  const src = moduleSource();

  // A create is a POST to the collection; an edit or delete addresses one
  // category by id. Reading the list (a plain GET) is allowed and needed —
  // categories are offered as a way to choose which articles to relate.
  assert.ok(
    !/\/api\/blog\/categories\/\$\{/.test(src),
    'this module addresses a single category by id, which only an edit or delete does. ' +
    'blog-category-manager owns that; shipping a second one beside it is the 86bbue8ux report'
  );

  const categoryCalls = src.match(/api\(\s*`\/api\/blog\/categories[^`]*`[^)]*\)/g) || [];
  for (const call of categoryCalls) {
    assert.ok(
      !/method:\s*["'](POST|PUT|PATCH|DELETE)["']/.test(call),
      `this module writes to /api/blog/categories: ${call.slice(0, 90)}`
    );
  }
});

test('there is no create control for tags either, because a tag cannot exist without a post', () => {
  const src = moduleSource();
  // The tag write endpoints it MAY use are the rename and the removal.
  assert.match(src, /\/api\/blog\/tags\/rename/, 'the rename endpoint should still be wired up');
  // Matched as bare text, not as a quoted string. The first version of this
  // assertion looked for `"New Tag"` and so could not see
  // `<button>New Tag</button>` -- it passed against a deliberately
  // reintroduced control, which is an assertion that cannot fail.
  assert.ok(
    !/New Tag/.test(src),
    'a "New Tag" control would be a button that cannot do anything: a tag exists only by being on a post'
  );
});
