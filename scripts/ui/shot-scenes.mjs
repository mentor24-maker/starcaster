/**
 * WHAT GETS PHOTOGRAPHED — the registry `shoot_changes.mjs` drives.
 *
 * Each scene is one page document rendered on `builder-preview.html`, shot
 * once against this checkout's build and once against the merge-base's, and
 * compared pixel for pixel.
 *
 * WHY A FIXED SET RATHER THAN "THE MODULES YOU TOUCHED"
 * The whole point is to catch the change nobody predicted. A CSS edit aimed at
 * buttons routinely moves headings, and a renderer refactor aimed at one
 * module moves the section wrapper every module sits in. Choosing scenes from
 * the diff would photograph exactly the places someone already knew to look.
 *
 * WHAT A SCENE MUST BE
 *   STATIC. Anything that moves is noise: two screenshots of the same running
 *   animation differ by however many milliseconds apart the shutter fell, and
 *   the whole method rests on identical assets producing identical pixels.
 *   Playwright's `animations: 'disabled'` handles CSS animations, but a module
 *   that polls, fetches or randomises has no such switch — keep those out.
 *
 *   SELF-CONTAINED. No database, no login, no seeded fixture. Everything here
 *   renders from the document alone, which is what makes the whole check cost
 *   a minute instead of a setup.
 *
 * ADDING A SCENE
 *   1. Add an entry.
 *   2. Run the harness twice with no changes and confirm it reports nothing.
 *      A scene that differs from itself poisons every result.
 *   3. Change something visible on purpose and watch it get photographed.
 */

const BANNER = '/images/Gemini_Generated_starcaster_banner.png';

const CARDS = JSON.stringify([
  { title: 'First card', body: 'Body copy that wraps onto a second line so line-height shows up.' },
  { title: 'Second card', body: 'A shorter body.' },
  { title: 'Third card', body: 'Enough words here to push this card taller than its neighbours.' },
]);

/**
 * A table cell holds MODULES, not strings — `td.cells['0-0']` is an array the
 * renderer maps over. Written as strings first, the table photographed with
 * headers and six empty cells and every run still passed, which is the exact
 * shape of a fixture that proves nothing (check:panels, three times).
 */
const cell = (row, column, text) => [{
  id: `cell-${row}-${column}`,
  type: 'text',
  column: 'main',
  text: `<p>${text}</p>`,
  settings: {},
}];

const TABLE = JSON.stringify({
  headers: ['Column one', 'Column two', 'Column three'],
  cells: {
    '0-0': cell(0, 0, 'first'), '0-1': cell(0, 1, 'second'), '0-2': cell(0, 2, 'third'),
    '1-0': cell(1, 0, 'fourth'), '1-1': cell(1, 1, 'fifth'), '1-2': cell(1, 2, 'sixth'),
  },
  rowCount: 2,
});

export const SHOT_SCENES = [
  {
    id: 'typography',
    title: 'Headings and body copy',
    why: 'Font size, weight, line-height and spacing — what a theme change moves first.',
    modules: [
      { type: 'heading', text: 'A heading at h1', settings: { level: 'h1', fontSize: '44' } },
      { type: 'heading', text: 'A heading at h3', settings: { level: 'h3', fontSize: '24' } },
      {
        type: 'text',
        text: '<p>A paragraph of body copy long enough to wrap onto a second line, which is where '
          + 'line-height and measure show up.</p><ul><li>A list item</li><li>Another list item</li></ul>'
          + '<p><a href="#">And a link</a>, because link colour is a theme decision.</p>',
      },
    ],
  },
  {
    id: 'picture',
    title: 'A picture with a frame',
    why: 'Sizing, border and radius on the module every page has. No effect: motion is noise here.',
    modules: [
      {
        type: 'image',
        settings: { url: BANNER, alt: 'Scene picture', size: '60', borderRadius: '18', borderThickness: '2', borderColor: '#214c71', effect: 'none' },
      },
    ],
  },
  {
    id: 'call-to-action',
    title: 'A button',
    why: 'Padding, colour and radius on the one module whose whole job is to be clicked.',
    modules: [
      { type: 'button', text: 'Book a court', settings: { href: '#', paddingX: '28', paddingY: '14' } },
    ],
  },
  {
    id: 'cards',
    title: 'A row of feature cards',
    why: 'A multi-column grid: the layout most likely to be moved by a change aimed elsewhere.',
    modules: [
      // Icons off: with no card image the default placement lands the icon on
      // top of the title. That is the module's real behaviour rather than a
      // fault in the scene — but a picture that already looks broken teaches
      // the operator to ignore these pictures, which costs more than the
      // coverage is worth. Filed as its own observation instead.
      { type: 'feature-cards', settings: { cards: CARDS, cardColumns: '3', cardGap: '16', showIcons: 'false' } },
    ],
  },
  {
    id: 'table',
    title: 'A table',
    why: 'Cell padding and borders — the surface docs/UI_RULES.md width rules land on.',
    modules: [
      { type: 'table', settings: { columns: '3', tableData: TABLE, cellPadding: '10' } },
    ],
  },
  {
    id: 'quote',
    title: 'A pull quote',
    why: 'A module whose entire rendering is typography and spacing, so a stylesheet edit shows up bare.',
    modules: [
      { type: 'quote', text: 'The visible failure is the lucky one.', settings: {} },
    ],
  },
];
