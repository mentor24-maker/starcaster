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
  /*
   * Two exemptions, both narrow and both named here rather than left to a
   * reader to infer:
   *
   *   checkbox      pinned to a fixed size on purpose — a tenant theme's
   *                 `input { width: 100% }` blew it out to 1056px.
   *   posts-modal   the popup SHELL, which is a dialog box rather than a
   *                 column of names. Its own row rule is `1fr auto` and its
   *                 title wraps, so capping the shell cannot clip a title —
   *                 that pairing is asserted separately below, and this
   *                 exemption is only safe while it holds.
   *
   * Anything else capping its width is the 86bbue8ux defect coming back.
   */
  const ALLOWED_TO_CAP = /checkbox|posts-modal/;
  for (const { selector, body } of moduleCssBlocks()) {
    if (!/max-width/.test(body)) continue;
    assert.match(
      selector,
      ALLOWED_TO_CAP,
      `${selector} caps its width; only the checkbox and the popup shell may, and a cap on a name column is what truncated the live page`
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

// ── 3. The post count opens the posts behind it (86bbugbxb) ───────────────
//
// Same instrument as above, and for the same reason: there is no DOM testing
// library here, `check:panels` measures the editor, and `check:render` drives
// a database-less preview where this module renders its empty state. So these
// anchor on structure, with comments stripped, and each one names the failure
// it exists to catch.

test('the post count is a control, not a dead number', () => {
  const src = moduleSource();
  assert.match(
    src,
    /openTagPosts\(term\.label\)/,
    'clicking a tag row\'s count should open that tag\'s posts; the count is the affordance the operator asked for'
  );
  assert.match(
    src,
    /term\.postCount\s*>\s*0\s*\?/,
    'a tag with no posts must not render a button — a control that opens an empty box is worse than a number'
  );
});

test('it reads the posts for a tag rather than inventing an endpoint', () => {
  const src = moduleSource();
  assert.match(
    src,
    /\/api\/blog\/tags\/posts\?tag=\$\{encodeURIComponent/,
    'the popup should use the existing tag-posts endpoint, with the tag encoded'
  );
});

test('a failed load is not rendered as "no posts"', () => {
  const src = moduleSource();
  // The error must be its own state, and it must be TESTED BEFORE the empty
  // case — otherwise a dropped request renders as "this tag has no posts",
  // which is a confident lie about the data.
  assert.match(src, /tagPostsError/, 'the popup should keep the load error in its own state');
  const errorAt = src.indexOf('tagPostsError ?');
  const emptyAt = src.indexOf('tagPosts.length === 0');
  assert.ok(errorAt > 0 && emptyAt > 0, 'the popup should render both an error branch and an empty branch');
  assert.ok(
    errorAt < emptyAt,
    'the empty-list branch is reached before the error branch, so a failed load renders as "no posts"'
  );
});

test('the popup is portalled out of the tenant theme', () => {
  const src = moduleSource();
  assert.match(
    src,
    /<BuilderBodyPortal>/,
    'the popup must portal to <body> through BuilderBodyPortal: this module renders inside arbitrary tenant ' +
    'themes, and one already blew a control out to 1056px'
  );
});

test('Escape is bound on the document, not on the dialog element', () => {
  const src = moduleSource();
  // A key handler on the dialog only fires when focus is already inside it,
  // and the popup opens from a click on the count — which leaves focus on the
  // button OUTSIDE the dialog. Escape would then do nothing.
  assert.match(
    src,
    /document\.addEventListener\(\s*["']keydown["']/,
    'Escape should be a document listener; an onKeyDown on the dialog cannot fire when focus is outside it'
  );
  assert.match(
    src,
    /document\.removeEventListener\(\s*["']keydown["']/,
    'the Escape listener must be removed when the popup closes, or every open leaks another one'
  );
});

test('a post in the popup opens by id, and the destination is configurable', () => {
  const src = moduleSource();
  assert.match(
    src,
    /id=\$\{encodeURIComponent\(post\.id\)\}/,
    'the edit link should address the post by id, encoded'
  );
  assert.match(
    src,
    /settings\.managerPageUrl/,
    'the Blog Manager page should come from a setting so a tenant who renamed that page can point at it'
  );
  assert.match(
    src,
    /["']\/admin-blog-manager["']/,
    'the default should be the slug the admin scaffold gives every tenant, not an empty string'
  );
});

test('the popup rows do not clip a post title', () => {
  const rowBlocks = moduleCssBlocks().filter(({ selector }) => /posts-(row|title)/.test(selector));
  assert.ok(rowBlocks.length > 0, 'the popup rows should have stylesheet rules; the class may have been renamed');
  const row = rowBlocks.find(({ selector }) => /posts-row/.test(selector));
  assert.ok(row, 'the popup row rule is missing');
  assert.match(
    row.body,
    /grid-template-columns:\s*1fr\s+auto/,
    'the title should take the leftover width and the actions size to their icons, so a long headline ' +
    'never buys its room from the title'
  );
});
