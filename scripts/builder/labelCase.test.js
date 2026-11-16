'use strict';

/**
 * SC-812 — every form field label on StarCaster's admin screens and in the
 * Builder's settings panels is in Title Case (docs/UI_RULES.md L10, Spirality's
 * docs/UI_DOCTRINE.md §1). This reads the source and names every label that
 * is not, so a new "Theme name" fails `npm run verify` instead of reaching
 * the screen.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  titleCaseProblem, toTitleCase, labelsOf, findLabelProblems, blankComments, scannedFiles, FILL,
} = require('../../lib/labelCase.js');

test('every field label on the admin screens and Builder panels is in Title Case (UI_RULES L10)', () => {
  const { seen, problems } = findLabelProblems();
  // A pattern that stopped matching would pass silently; the tree has about a thousand.
  assert.ok(seen > 800, `only ${seen} labels found: a pattern in lib/labelCase.js no longer matches the source`);
  assert.deepEqual(
    problems.map((p) => `${p.file}:${p.line}: ${p.kind} "${p.text}": ${p.why}`),
    [],
    'see docs/UI_RULES.md L10 — capitalise every word except the small ones (a, an, the, of, to, …)',
  );
});

test('the Title Case rule: big words capitalised, small words free inside, first word and the word after a colon or bracket always capitalised', () => {
  for (const ok of [
    'Theme Name', 'Background Color', 'Set Up a Project', 'Notes for the Agent', 'Active from (Hour)',
    'Base Size (px)', 'Button Corners px', 'Overlay Strength %', 'YouTube Channel', 'CRM Form', 'iPhone Width',
    'Download .mp4 and .mp3 Files', 'Tags (Comma-separated)', 'Author When the Source Has None:',
    `Rows for ${FILL} of Them`, '6-digit Code', 'Use Page Primary/Accent Color',
    'I manually confirm this API action.',
  ]) {
    assert.equal(titleCaseProblem(ok), null, ok);
  }
  for (const [bad, word] of [
    ['Theme name', 'name'], ['link underline', 'link'], ['When a visitor submits', 'visitor'],
    ['Until (optional)', '(optional)'], ['Note: the end', 'the'], ['Use Page primary/accent Color', 'primary/accent'],
  ]) {
    assert.match(titleCaseProblem(bad) ?? '', new RegExp(`"${word.replace(/[()/]/g, '\\$&')}"`), bad);
  }
});

test('the rewrite only ever capitalises: acronyms, brands and small words are kept as written', () => {
  assert.equal(toTitleCase('Theme name'), 'Theme Name');
  assert.equal(toTitleCase('Notes for the agent'), 'Notes for the Agent');
  assert.equal(toTitleCase('Until (optional)'), 'Until (Optional)');
  assert.equal(toTitleCase('Base size (px)'), 'Base Size (px)');
  assert.equal(toTitleCase('CTA / submit label'), 'CTA / Submit Label');
  assert.equal(toTitleCase('Set Up a YouTube channel'), 'Set Up a YouTube Channel');
});

test('the label finder reads label props and <label> text, and skips aria-label, nested hints, fill-ins and comments', () => {
  const jsx = `
    <BuilderSettingRow label="Theme name" />
    <button aria-label="Close dialog" />
    <label htmlFor="x">Post title <span className="meta">a sentence hint</span></label>
    <label><input type="checkbox" onChange={() => toggle(option)} /> Show captions</label>
    <label>{count} rows</label>
    {/* <label>Not a label</label> */}
    // <label>Nor this</label>
    <input accept="video/*" /><label>After a file filter</label>`;
  const labels = labelsOf(blankComments(jsx), { jsx: true }).map((l) => `${l.kind}: ${l.text}`);
  assert.deepEqual(labels, [
    'label prop: Theme name',
    '<label>: Post title',
    '<label>: Show captions',
    `<label>: ${FILL} rows`,
    '<label>: After a file filter',
  ]);
});

test('a Builder settings field declared as data is read, and its dropdown options are not', () => {
  const tsx = `
    const groups = [[
      {
        key: "iconSize",
        label: "Icon size",
        width: "num",
        control: "number",
      },
      {
        key: "showOn",
        label: "Who sees it",
        control: "select",
        options: [{ value: "all", label: "everyone on the site" }, { value: "admins", label: "admins only" }],
      },
    ]];
    const choices = [{ value: "left", label: "Align left" }];
    const tab = { key: "style", label: "style tab" };`;
  assert.deepEqual(
    labelsOf(tsx, { jsx: true }).map((l) => `${l.kind}: ${l.text}`),
    ['field config: Icon size', 'field config: Who sees it'],
  );
});

test('labels in the admin app HTML and vanilla JS are read, with ${…} fill-ins left alone', () => {
  const html = `<label for="a">Keyword filter</label> '<label>Handler name<input name="n" /></label>' \`<label>\${name} settings</label>\``;
  assert.deepEqual(labelsOf(html, { jsx: false }).map((l) => l.text), ['Keyword filter', 'Handler name', `${FILL} settings`]);
});

test('a <span> caption is read when the label has no text of its own, and a hint span is not (SC-812 send-back)', () => {
  const tsx = `
    <label><span>Font size (px)</span><input type="number" /></label>
    <label className="tw-field"><span>Describe the banner area <span className="tw-muted">(optional)</span></span><textarea /></label>
    <label><input type="checkbox" /><span className="meta">a hint, not a caption</span></label>
    <label>Keyword Exclusions <span style="color:grey">(comma-separated)</span></label>
    <label><span>to</span><select /></label>`;
  assert.deepEqual(
    labelsOf(tsx, { jsx: true }).map((l) => l.text),
    ['Font size (px)', 'Describe the banner area', 'Keyword Exclusions'],
  );
});

test('the frozen Builder\'s field lists in plain JS are read (SC-812 send-back)', () => {
  const js = `const BLOG_FIELDS = [{ key: 'postsPerPage', label: 'Posts per page', control: 'number' }];`;
  assert.deepEqual(labelsOf(js, { jsx: false, fields: true }).map((l) => `${l.kind}: ${l.text}`), ['field config: Posts per page']);
  assert.deepEqual(labelsOf(js, { jsx: false }), []);
  const builder = scannedFiles().find((f) => f.file === 'public/js/builder.js');
  assert.equal(builder?.fields, true, 'public/js/ must be read for field lists');
});

test('a label chosen by an expression has each possible result read, not the strings it compares against (SC-812 send-back)', () => {
  const tsx = `
    <TextEditor label={editingField === 'targetText' ? 'Their Note, pasted' : 'What I Want to Say'} />
    <TotalTile label={\`Last \${WINDOW_DAYS} days\`} />
    <BuilderSettingRow label={name} />
    <DriveLink label={\`Watch \${name} in Google Drive (opens a new tab)\`} />`;
  const labels = labelsOf(tsx, { jsx: true }).map((l) => `${l.kind}: ${l.text}`);
  assert.deepEqual(labels, [
    'label expression: Their Note, pasted',
    'label expression: What I Want to Say',
    `label expression: Last ${FILL} days`,
  ]);
  assert.ok(titleCaseProblem(`Last ${FILL} days`));
});
