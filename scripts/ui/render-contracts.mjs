/**
 * WHAT A RENDERED MODULE MUST DO — the registry `check_render.mjs` drives.
 *
 * Each entry renders ONE module on an otherwise empty page and asserts facts
 * read out of a real browser. One module per page is deliberate: the rendered
 * DOM carries no module-type attribute, so a page with four modules on it has
 * four indistinguishable `.builder-preview-module` wrappers and a failure
 * cannot say which one broke.
 *
 * ADDING A CONTRACT
 *   1. Add an entry here.
 *   2. Run `npm run check:render` and watch it pass.
 *   3. BREAK THE THING ON PURPOSE and watch it fail. A contract that has
 *      never failed has not been tested, only written — every check in this
 *      repo that skipped this step went on to report clean over something
 *      broken (see check:panels, three times).
 *
 * The `why` line is not decoration. Every contract here exists because
 * something shipped broken and nobody could see it; when one of these fails
 * in two years, that line is what explains why anyone cared.
 */

const BANNER = '/images/Gemini_Generated_starcaster_banner.png';

/** Settings shared by the image contracts, so a change of picture is one edit. */
const PICTURE = { url: BANNER, alt: 'Contract fixture picture', size: '40' };

/**
 * The video-background fixture. Six seconds, 128KB, generated with ffmpeg and
 * committed so this needs no database, no upload and no network — the same
 * bargain the rest of `builder-preview.html` makes.
 *
 * The poster is the SAME frame in greyscale, on purpose: when the fallback is
 * showing, the row is visibly grey and still, so "the poster is up" is a thing
 * a person can see across the room rather than something to squint at.
 */
/**
 * The parallax fixture — the same banner every image contract uses, on a
 * section tall enough to be worth drifting, with spacer sections above and
 * below so the page can actually scroll. `spacers` is what makes that page
 * tall; without them there is nothing to scroll and the whole effect is
 * unobservable.
 */
const PARALLAX_IMAGE_SECTION = {
  layout: 'single',
  spacers: 2,
  background: {
    mode: 'image',
    imageUrl: BANNER,
    parallax: true,
    parallaxSpeed: 0.3,
  },
  modules: [{ type: 'heading', text: 'Text over a drifting picture', settings: {} }],
};

/**
 * THE SAME SECTION, ON A THEMED PAGE.
 *
 * A theme's "Photo overlay tint" is composited onto the section element itself
 * as `linear-gradient(tint, tint), url(photo)`, together with the inverse
 * (white) text colour — the tint is the only thing making that text readable.
 * Every parallax contract above uses an UNTINTED section, which is exactly why
 * they all reported green while switching parallax on wiped the tint off a
 * themed row and left white text on a bare photo (review round 3 of #481,
 * measured at mean RGB [166, 11, 17] -> [44, 53, 63]).
 *
 * Red at three-quarter strength is not a design choice — it is the loudest
 * value available, so a failure here is unmistakable in a screenshot.
 */
const PARALLAX_THEMED_SECTION = {
  ...PARALLAX_IMAGE_SECTION,
  themeTreatments: { heroOverlay: '#ff0000', heroOverlayOpacity: 0.75 },
};

/** A row with its own Tablet (30) and Phone (60) top padding over a desktop 18. */
const DEVICE_STYLED_SECTION = {
  layout: 'single',
  paddingTop: '18',
  // A background of its own, so the theme's band spacing (which replaces a
  // backgroundless row's padding) stays out of the measurement.
  background: { mode: 'color', color: '#eeeeee' },
  deviceOverrides: { tablet: { paddingTop: '30' }, phone: { paddingTop: '60' } },
  modules: [{ type: 'heading', text: 'A row styled per device', settings: {} }],
};

/**
 * THE SAME ROW WITHOUT A BACKGROUND OF ITS OWN — which is the ordinary case.
 *
 * `DEVICE_STYLED_SECTION` above gives itself a grey fill on purpose, and the
 * comment says why: the theme band's spacing "replaces a backgroundless row's
 * padding". That was true, and it was the bug (86bc14qwy) — the band wrote an
 * inline `padding-top`, which outranks the stylesheet rule reading the
 * operator's own number, so Top and Bottom Padding did nothing at all on any
 * row he had not given a background. A contract that works around a defect
 * keeps the defect invisible, so this one takes the fill away.
 */
const PLAIN_DEVICE_SECTION = { ...DEVICE_STYLED_SECTION, background: undefined };

/**
 * A row whose ONE column has its own Tablet (20) and Phone (40) top padding
 * over a desktop 10 (device styles 2 of 4, task 86bc14pey).
 *
 * Padding rather than anything prettier because it is measurable to the pixel
 * from a computed style, and because it is the setting the operator's own
 * test steps use.
 */
const CELL_DEVICE_STYLED_SECTION = {
  layout: 'single',
  background: { mode: 'color', color: '#eeeeee' },
  cellPaddingTop: { main: '10' },
  cellDeviceOverrides: {
    tablet: { main: { cellPaddingTop: '20' } },
    phone: { main: { cellPaddingTop: '40' } },
  },
  modules: [{ type: 'heading', text: 'A column styled per device', settings: {} }],
};

/** How the parallax contracts watch: scroll a fixed step, read, repeat. */
const PARALLAX_SERIES = {
  count: 14,
  everyMs: 60,
  scrollBy: 90,
  read: ['transform'],
  selectors: {
    layer: '.builder-preview-image-background',
    section: '.builder-preview-section-layered',
  },
};

const VIDEO_SECTION = {
  layout: 'single',
  background: {
    mode: 'video',
    videoUrl: '/images/render-fixture-background.mp4',
    posterUrl: '/images/render-fixture-background-poster.jpg',
    videoSpeed: 1,
    videoLoop: true,
  },
  modules: [{ type: 'heading', text: 'Text over video', settings: {} }],
};

/*
 * A video in the LEFT cell of a two-column row, and nothing in the right one.
 *
 * The asymmetry is the whole scene. A per-cell background that leaked would
 * leak sideways, so a row with footage in both cells could not tell a working
 * layer from one bleeding across the gap — both would look like video
 * everywhere. The right cell is the control, and it carries a module of its
 * own so there is something visible for stray footage to land on.
 */
const CELL_VIDEO_SECTION = {
  layout: 'two-column',
  cellBackgrounds: {
    left: {
      mode: 'video',
      videoUrl: '/images/render-fixture-background.mp4',
      posterUrl: '/images/render-fixture-background-poster.jpg',
      videoSpeed: 1,
      videoLoop: true,
    },
  },
  modules: [
    { type: 'heading', text: 'Text over cell video', settings: {}, column: 'left' },
    { type: 'heading', text: 'Plain neighbour', settings: {}, column: 'right' },
  ],
};

/**
 * THE PAGE-LEVEL video background — the same clip, set on the PAGE rather than
 * on a row, with two spacer sections so the page is tall enough to scroll past
 * it. The subject row carries no background of its own, which is what lets the
 * clip show through it; the contracts below check both halves of that.
 */
const VIDEO_PAGE = {
  layout: 'single',
  spacers: 2,
  pageBackground: {
    mode: 'video',
    videoUrl: '/images/render-fixture-background.mp4',
    posterUrl: '/images/render-fixture-background-poster.jpg',
    videoSpeed: 1,
    videoLoop: true,
  },
  modules: [{ type: 'heading', text: 'Text over a page video', settings: {} }],
};

/**
 * ─────────────────────────────────────────────────────────────────────────
 * THE SETTINGS SWEEP — coverage nobody has to remember to write.
 *
 * Everything above is a hand-written contract: it exists because a specific
 * thing broke and someone encoded it. That only ever covers the bugs we have
 * already had. The two sweeps below are driven from the option lists and the
 * stylesheet instead, so a setting added tomorrow is covered tomorrow.
 *
 * They answer two different questions, and the difference matters:
 *
 *   EFFECT SWEEP  — does every effect the panels OFFER actually animate?
 *     This is the one that would have caught the dead Tumbleweed on the day
 *     it shipped, with no foresight required.
 *
 *   DIFFERENTIAL  — does changing a setting change what renders at all?
 *     A control that moves nothing fails by construction.
 *
 * WHAT THE DIFFERENTIAL CANNOT DO, stated plainly so nobody reads more into a
 * green run than it earns: it proves something changed, not that it changed
 * CORRECTLY. It cannot tell a bounce from a wobble. It is a dead-control
 * detector, not a design reviewer — the operator's eye is still the judge of
 * whether a thing looks right (docs/DOCTRINE.md §5.14).
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * The effect values the panels offer, read from the source of truth rather
 * than copied. A hand-listed roster is the same failure one step later: add an
 * effect, forget the list, and the sweep passes without ever seeing it.
 */
export function imageEffectOptionsFromSource(text) {
  const block = text.match(/IMAGE_EFFECT_OPTIONS[^=]*=\s*\[([\s\S]*?)\];/);
  if (!block) return [];
  return [...block[1].matchAll(/value:\s*["']([^"']+)["']/g)]
    .map((m) => m[1])
    .filter((value) => value !== 'none');
}

/**
 * The Builder's Phone/Tablet preview pop-up sizes, read out of
 * `components/builder/builder-device-preview.tsx` rather than copied here, so
 * the check and the pop-up can never measure two different phones
 * (86bc3yyn0). Returns {} when the block cannot be found — the harness then
 * FAILS the embed contracts rather than measuring at a guessed width.
 */
export function previewDeviceFramesFromSource(text) {
  const block = text.match(/PREVIEW_DEVICE_FRAMES[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!block) return {};
  const frames = {};
  for (const m of block[1].matchAll(/(\w+):\s*\{\s*width:\s*(\d+),\s*height:\s*(\d+)\s*\}/g)) {
    frames[m[1]] = { width: Number(m[2]), height: Number(m[3]) };
  }
  return frames;
}

/** Structural wrappers, not effects — they carry no `starcaster-effect-<name>` meaning. */
const EFFECT_STRUCTURE_CLASSES = new Set(['motion-clip', 'motion-stage', 'hop-stage']);

/**
 * Effect classes the stylesheet defines. Compared against the offered list to
 * surface the OPPOSITE gap from the dead Tumbleweed: keyframes that exist and
 * appear in no panel, reachable only by hand-editing a setting.
 */
export function effectClassesInCss(text) {
  const found = new Set();
  for (const match of text.matchAll(/\.starcaster-effect-([a-z0-9-]+)/g)) {
    if (!EFFECT_STRUCTURE_CLASSES.has(match[1])) found.add(match[1]);
  }
  return found;
}

/**
 * classSuffix → effect value, read from getImageEffectClassName in the source.
 *
 * Most effects emit `starcaster-effect-<value>`, but Slide deliberately does
 * not: its class is `starcaster-effect-slide-motion`, to dodge the buried
 * effect's dead `:has(.starcaster-effect-slide)` layout rules. So the orphan
 * sweep must compare the stylesheet against the CLASSES effects emit, not their
 * raw values — otherwise a renamed-but-offered effect reads as an unstyled
 * orphan. Parsed from the same source file as the option list so the two can
 * never drift.
 */
export function imageEffectClassMapFromSource(text) {
  const fn = text.match(/getImageEffectClassName[\s\S]*?\n\}/);
  const body = fn ? fn[0] : text;
  const map = new Map();
  for (const m of body.matchAll(/effect === ["']([^"']+)["']\s*\)\s*return\s*["']\s*starcaster-effect-([a-z0-9-]+)["']/g)) {
    map.set(m[2], m[1]); // classSuffix -> effect value
  }
  return map;
}

/** One image module carrying the effect under test. */
export function effectSweepModule(effect) {
  return { type: 'image', settings: { ...PICTURE, effect, effectSpeed: '8', effectRotationRate: '30' } };
}

/**
 * A FLOATING image carrying an effect — the one place the buried effects' dead
 * `!important` overlay-layout rules can bite. A `floating-image` renders as
 * section-scoped overlay decor: normalizeModuleTrigger defaults its trigger to
 * `button`, which isSectionScopedOverlayDecor looks for, so the
 * `.builder-preview-image-shell-overlay` shell appears with no trigger set.
 * Used by the Slide-shell comparison in check_render.mjs.
 */
export function floatingImageModule(effect) {
  return { type: 'floating-image', settings: { ...PICTURE, effect } };
}

/**
 * Settings whose only consumer is a stylesheet, and the two values that must
 * render differently. `from` is the default; `to` is far enough away that the
 * difference cannot be a rounding artefact.
 *
 * GROWS BY BOY-SCOUT CONVERGENCE, the way the module standards did: when you
 * touch a module's panel, add its CSS-only settings here. A setting absent
 * from this list is a setting nothing proves is alive.
 */
export const RENDER_DIFFERENTIALS = [
  {
    id: 'image-speed',
    module: { type: 'image', settings: { ...PICTURE, effect: 'tumbleweed' } },
    setting: 'effectSpeed', from: '8', to: '30',
    why: 'Speed is the crossing duration; if it stops reaching the stylesheet every crossing takes 8s forever.',
  },
  {
    id: 'image-rotation-rate',
    module: { type: 'image', settings: { ...PICTURE, effect: 'spin' } },
    setting: 'effectRotationRate', from: '25', to: '120',
    why: 'Rotation Rate was the first control added to this feature; it is the shape every later one copied.',
  },
  {
    id: 'image-bounce-height',
    module: { type: 'image', settings: { ...PICTURE, effect: 'tumbleweed' } },
    setting: 'effectBounceHeight', from: '50', to: '400',
    why: 'The hop height rides a CSS variable on a wrapper element — a hop of the wrong size looks deliberate.',
  },
  {
    id: 'image-frequency',
    module: { type: 'image', settings: { ...PICTURE, effect: 'tumbleweed' } },
    setting: 'effectFrequency', from: '4', to: '14',
    why: 'Frequency is per CROSSING rather than per second, so it is computed rather than passed straight through.',
  },
  {
    id: 'image-direction',
    module: { type: 'image', settings: { ...PICTURE, effect: 'slide' } },
    setting: 'effectDirection', from: 'ltr', to: 'rtl',
    why: 'Left-to-right is the ABSENCE of a variable rather than a second keyword, which is easy to break silently.',
  },
  {
    id: 'image-delay',
    module: { type: 'image', settings: { ...PICTURE, effect: 'slide' } },
    setting: 'effectDelay', from: '0', to: '9',
    why: 'Start Delay is only written when non-zero — a conditional emit is exactly where a control goes dead.',
  },
  /*
   * THE SAME FOUR CONTROLS, ON THE THREE EFFECTS ADDED 2026-08-22.
   *
   * Every differential above is pinned to slide, spin or tumbleweed, and that
   * is exactly how Slide, Axis Rotate and Flips shipped a review round with
   * SEVEN DEAD CONTROLS. `normalizeImageEffectSettings` matched effects by
   * name, the three new names were not in its lists, and it deleted every
   * value on the way to the page. The picture animated the whole time — at the
   * built-in default, forever — so the "does it animate" sweep, the named
   * animation contracts and the tumbleweed differentials were all green
   * together while nothing the operator touched did anything.
   *
   * The task's own non-goal said a new effect needs no differential because
   * the sweep already requires it to animate. That reasoning is what let this
   * through: animating and obeying are different claims, and only the second
   * one is what a control is for. A NEW EFFECT NEEDS A DIFFERENTIAL ON EVERY
   * CONTROL ITS PANEL OFFERS — one per motion is enough, since the three
   * motions are what the keep-rule is grouped by.
   */
  {
    id: 'image-slide-speed',
    module: { type: 'image', settings: { ...PICTURE, effect: 'slide' } },
    setting: 'effectSpeed', from: '8', to: '30',
    why: 'Slide travels, so it offers Speed. It was deleted before it reached the page for a whole review round.',
  },
  {
    id: 'image-axis-rotate-rotation-rate',
    module: { type: 'image', settings: { ...PICTURE, effect: 'axis-rotate' } },
    setting: 'effectRotationRate', from: '25', to: '120',
    why: 'Rotation Rate is the ONLY control Axis Rotate offers — dead, it has no working control at all.',
  },
  {
    id: 'image-flips-frequency',
    module: { type: 'image', settings: { ...PICTURE, effect: 'flips' } },
    setting: 'effectFrequency', from: '4', to: '14',
    why: 'Flips hops in place, so Frequency rides the figure rather than a stage wrapper — a different path to tumbleweed.',
  },
  {
    id: 'image-flips-bounce-height',
    module: { type: 'image', settings: { ...PICTURE, effect: 'flips' } },
    setting: 'effectBounceHeight', from: '50', to: '400',
    why: 'The other half of the hop, on the same in-place path; height and frequency reach the element separately.',
  },
  {
    id: 'image-border-radius',
    module: { type: 'image', settings: { ...PICTURE } },
    setting: 'borderRadius', from: '0', to: '40',
    why: 'A frame setting with no effect involved, so the sweep is not only ever measuring animations.',
  },
  {
    id: 'image-drop-shadow',
    module: { type: 'image', settings: { ...PICTURE } },
    setting: 'imageShadow', from: 'false', to: 'true',
    why: 'The whole feature behind one checkbox (operator, 2026-08-25). A conditional emit is exactly where a control goes dead, and this one is emitted by a helper written for a different module — if the image renderer ever stops calling it, the box still ticks and saves and nothing appears.',
  },
  {
    id: 'image-drop-shadow-blur',
    module: { type: 'image', settings: { ...PICTURE, imageShadow: 'true' } },
    setting: 'imageShadowBlur', from: '0', to: '60',
    why: 'Proves the five detail controls reach the shadow and are not decoration around a hardcoded one — the checkbox differential above passes even if every number is ignored.',
  },
  /*
   * THE ANGLE CONTROL'S OUTPUT (2026-08-25, "add the angle of dropshadow").
   *
   * Shadow Angle and Shadow Distance store NOTHING of their own — they are a
   * second view of `imageShadowX` and `imageShadowY`, so a differential named
   * after the angle would be varying a key no renderer reads and would fail
   * for the wrong reason. What the angle actually does is move the offsets,
   * and these are the offsets. If either goes dead, the whole dial is dead
   * with it while both panels keep swinging convincingly.
   */
  {
    id: 'image-drop-shadow-x',
    module: { type: 'image', settings: { ...PICTURE, imageShadow: 'true' } },
    setting: 'imageShadowX', from: '0', to: '40',
    why: 'Half of where the shadow falls, and the half the angle moves first. 0 is the default, so a dead X reads as a shadow that simply never swings sideways.',
  },
  {
    id: 'image-drop-shadow-y',
    module: { type: 'image', settings: { ...PICTURE, imageShadow: 'true' } },
    setting: 'imageShadowY', from: '6', to: '-40',
    why: 'The other half, and the one that carries the sign convention: 0 degrees is right and 90 is UP, which a CSS shadow reaches on a NEGATIVE y. Crossing the default rather than starting at it, so a renderer that ignored the setting could not pass by accident.',
  },
  {
    id: 'text-line-height',
    module: { type: 'text', text: '<p>Two lines of body copy for the differential to measure against.</p>', settings: {} },
    setting: 'lineHeight', from: '1.2', to: '2.4',
    why: 'A non-image module, so a regression in the shared spacing pipeline is visible here too.',
  },
  {
    id: 'bug-report-icon-size',
    module: { type: 'bug-report', settings: { iconSize: '40', labelText: 'Report a problem' } },
    setting: 'iconSize', from: '40', to: '70',
    why: 'The icon size is the one number the operator will tune first; it rides a CSS variable on the trigger and a dead variable renders a fixed 40px forever.',
  },
  {
    id: 'bug-report-block-color',
    module: { type: 'bug-report', settings: { iconBlock: 'true', blockColor: '#0f4f8f' } },
    setting: 'blockColor', from: '#0f4f8f', to: '#c0392b',
    why: 'The background block colour is only emitted while the block toggle is on — a conditional emit is exactly where a control goes dead.',
  },
];

export const RENDER_CONTRACTS = [

  /*
   * A PADDED COLUMN IN A STACKED ROW FITS THE SCREEN (task 86bc3y0ue).
   *
   * Stacked columns get `width: 100%` below 1024px. As content-box, the
   * column's own padding went on top of that, so every padded column was
   * twice its side padding wider than the phone — the Delray home hero's
   * paragraph ran off the right edge at 390px. The wide table beside it was
   * the obvious suspect and was innocent: it already scrolls in its own
   * wrapper. It rides along here so that stays true.
   */
  ...[390, 900].map((width) => ({
    id: `stacked-padded-column-fits-the-screen-at-${width}`,
    why:
      'A two-column row stacks below 1024px and each column fills the width. With 24px of column ' +
      'padding the column must still be no wider than the screen, or its text runs off the edge.',
    section: {
      layout: 'two-column',
      mobileLayout: 'stack',
      cellPadding: { left: '24', right: '24' },
      modules: [
        {
          type: 'text',
          column: 'left',
          text: '<p>Public courts, expert coaching, junior development, leagues and pickleball — all in the heart of Delray Beach.</p>',
          settings: {},
        },
        { type: 'table', column: 'right', settings: { columns: '6', columnsCount: '6' } },
      ],
    },
    selector: '.builder-preview-section-layout-two-column > .builder-preview-column',
    read: ['boxSizing'],
    emulate: { viewport: { width, height: 900 } },
    expect(sample) {
      const { clientWidth, scrollWidth } = sample.page;
      if (sample.box.width > clientWidth) {
        return `a stacked column with 24px padding measured ${sample.box.width}px on a ${clientWidth}px screen ` +
          `(box-sizing ${sample.styles.boxSizing}) — its padding is being added on top of the full width.`;
      }
      return scrollWidth > clientWidth
        ? `the page is ${scrollWidth}px wide on a ${clientWidth}px screen — something in the stacked row is wider than the phone.`
        : null;
    },
  })),

  /*
   * THE SAME, INSIDE THE BUILDER'S PHONE FRAME (round 2 of 86bc3y0ue).
   *
   * The Phone frame is a 390px box in a WIDE window, so the media query the
   * contracts above exercise is false inside it and the frame has its own
   * class-keyed column rule. Round 1 fixed the media-query path only; the
   * frame still measured a 394px column in a 390px box, and the frame is
   * exactly where the ticket told Dane to look. The window is left at its
   * default desktop width on purpose — that is the case being tested.
   */
  {
    id: 'stacked-padded-column-fits-the-phone-frame',
    why:
      'The Builder\'s Phone preview is a class-keyed frame in a desktop-width window. A padded ' +
      'stacked column inside it must fit the frame, or the preview shows text running off the edge ' +
      'that the live phone site no longer has.',
    section: {
      layout: 'two-column',
      mobileLayout: 'stack',
      cellPadding: { left: '24', right: '24' },
      modules: [
        {
          type: 'text',
          column: 'left',
          text: '<p>Public courts, expert coaching, junior development, leagues and pickleball — all in the heart of Delray Beach.</p>',
          settings: {},
        },
        { type: 'table', column: 'right', settings: { columns: '6', columnsCount: '6' } },
      ],
    },
    selector: '.builder-preview-device-mobile .builder-preview-section-layout-two-column > .builder-preview-column',
    read: ['boxSizing'],
    emulate: { previewDevice: 'mobile' },
    probes: {
      fit: {
        subject: '.builder-preview-device-mobile .builder-preview-section-layout-two-column > .builder-preview-column',
        against: '.builder-preview-device-mobile .builder-preview-section-layout-two-column',
      },
    },
    expect(sample) {
      const probe = sample.probes?.fit;
      if (!probe) return 'no probe was taken — the contract measured nothing, which cannot verify anything.';
      if (probe.missing) {
        return `the probe could not find \`${probe.missing}\` — the Phone frame did not render the stacked row, ` +
          'so this contract can no longer fail for the right reason.';
      }
      if (!(probe.overlap > 0)) {
        return 'the column and its row do not overlap at all, so the comparison below would mean nothing.';
      }
      const over = probe.subjectBox.right - probe.againstBox.right;
      return over > 0
        ? `a stacked column with 24px padding reaches ${over}px past the right edge of its row in the Phone ` +
          `frame (column ${probe.subjectBox.left}-${probe.subjectBox.right}, row ${probe.againstBox.left}-` +
          `${probe.againstBox.right}, box-sizing ${sample.styles.boxSizing}) — the frame's column rule is adding ` +
          'its padding on top of the full width.'
        : null;
    },
  },

  /*
   * TABLET AND PHONE ROW STYLES (device styles 1 of 6, task 86bc13a6v).
   *
   * A row's styles are inline, and an inline style cannot say "on phones
   * only" — so a row with device settings carries its own <style> of media
   * rules marked !important. Every one of these asks a real browser at a real
   * width, because the failure modes are all invisible in the markup: a rule
   * that loses to the inline style, a query at the wrong width, or a style
   * element that renumbers the row's columns.
   */
  {
    id: 'device-styles-phone-padding-applies-on-a-phone',
    why:
      'The feature itself. A row set to 60px of top padding on Phone must get it at phone width. ' +
      'Without !important the inline desktop 18px wins and the Phone panel silently does nothing.',
    section: { ...DEVICE_STYLED_SECTION },
    selector: '.builder-preview-section[data-builder-device-scope]',
    read: ['paddingTop'],
    emulate: { viewport: { width: 420, height: 900 } },
    expect(sample) {
      return sample.styles.paddingTop === '60px'
        ? null
        : `a row with Phone padding-top 60 rendered padding-top ${sample.styles.paddingTop} at 420px — the phone rule is not reaching the row.`;
    },
  },
  {
    id: 'device-styles-tablet-padding-applies-on-a-tablet-and-not-phone-value',
    why:
      'Tablet has its own value (30) and Phone its own (60). At 900px only the tablet rule may match; ' +
      'getting 60 means the phone query is too wide, getting 18 means the tablet rule is missing.',
    section: { ...DEVICE_STYLED_SECTION },
    selector: '.builder-preview-section[data-builder-device-scope]',
    read: ['paddingTop'],
    emulate: { viewport: { width: 900, height: 900 } },
    expect(sample) {
      return sample.styles.paddingTop === '30px'
        ? null
        : `a row with Tablet padding-top 30 rendered padding-top ${sample.styles.paddingTop} at 900px.`;
    },
  },
  {
    id: 'device-styles-leave-desktop-alone',
    why:
      'The other direction, so the two contracts above cannot pass by breaking every width: on a ' +
      'desktop screen the same row keeps its own 18px.',
    section: { ...DEVICE_STYLED_SECTION },
    selector: '.builder-preview-section[data-builder-device-scope]',
    read: ['paddingTop'],
    expect(sample) {
      return sample.styles.paddingTop === '18px'
        ? null
        : `a row whose desktop padding-top is 18 rendered ${sample.styles.paddingTop} on a desktop screen — a device rule is leaking to desktop.`;
    },
  },
  {
    id: 'device-styles-hide-on-phone-hides-the-row',
    why: '"Hide on Phone" must take the row out at phone width — and only there (the desktop contract above reads the same row visible).',
    section: { ...DEVICE_STYLED_SECTION, deviceOverrides: { phone: { hidden: 'true' } } },
    selector: '.builder-preview-section[data-builder-device-scope]',
    read: ['display'],
    emulate: { viewport: { width: 420, height: 900 } },
    hidden: true,
  },
  {
    id: 'row-padding-applies-on-a-row-with-no-background',
    why:
      'Task 86bc14qwy: a row with no background of its own took the theme band\'s spacing as an ' +
      'INLINE padding, and an inline padding beats the stylesheet rule that reads the operator\'s ' +
      'Top/Bottom Padding — so his setting did nothing on those rows, on every site. Measured ' +
      '2026-09-15 at 1440px: --builder-section-padding-top 18px, computed padding-top 0px.',
    section: { ...PLAIN_DEVICE_SECTION, paddingTop: '40', deviceOverrides: undefined },
    selector: '.builder-preview-section:not([data-builder-device-scope])',
    read: ['paddingTop'],
    expect(sample) {
      return sample.styles.paddingTop === '40px'
        ? null
        : `a row with no background and Top Padding 40 rendered padding-top ${sample.styles.paddingTop} — the band's spacing is still overriding it.`;
    },
  },
  {
    id: 'device-styles-phone-padding-applies-on-a-row-with-no-background',
    why:
      'The same row at phone width. The device rules write the row\'s padding CUSTOM PROPERTY, so ' +
      'while the band held an inline padding they could not reach a backgroundless row either — ' +
      'the Phone panel was dead on exactly the rows most pages are made of.',
    section: { ...PLAIN_DEVICE_SECTION },
    selector: '.builder-preview-section[data-builder-device-scope]',
    read: ['paddingTop'],
    emulate: { viewport: { width: 420, height: 900 } },
    expect(sample) {
      return sample.styles.paddingTop === '60px'
        ? null
        : `a backgroundless row with Phone padding-top 60 rendered padding-top ${sample.styles.paddingTop} at 420px.`;
    },
  },
  {
    id: 'device-styles-keep-reverse-stack-column-order',
    why:
      'The rules element lives INSIDE the row, and the phone Reverse stack rules count the row\'s ' +
      'children with :nth-child(1..6). Placed first it would renumber every column and show the ' +
      'sixth one fourth. It is placed last; this holds that.',
    section: {
      layout: 'six-column',
      mobileLayout: 'reverse-stack',
      deviceOverrides: { phone: { columnGap: '4' } },
      modules: [
        { type: 'heading', text: 'One', settings: {}, column: 'left' },
        { type: 'heading', text: 'Two', settings: {}, column: 'center' },
        { type: 'heading', text: 'Three', settings: {}, column: 'right' },
        { type: 'heading', text: 'Four', settings: {}, column: 'col4' },
        { type: 'heading', text: 'Five', settings: {}, column: 'col5' },
        { type: 'heading', text: 'Six', settings: {}, column: 'col6' },
      ],
    },
    selector: '.builder-preview-section[data-builder-device-scope] > .builder-preview-column:nth-of-type(6)',
    read: ['order'],
    emulate: { viewport: { width: 420, height: 900 } },
    expect(sample) {
      return Number(sample.styles.order) === -2
        ? null
        : `the sixth column of a Reverse stack row with phone settings resolved order ${sample.styles.order}, not -2 — the rules element is renumbering the columns.`;
    },
  },
  /*
   * PER-DEVICE MODULE STYLES (86bc14pfq), the module half of the row
   * contracts above. Same reason for reading a browser rather than the
   * markup: every failure mode here is invisible in the DOM — a rule that
   * loses to the inline style, a rule that loses to the pre-device mobile
   * stylesheet, or a query at the wrong width.
   */
  {
    id: 'module-device-styles-phone-margin-applies-on-a-phone',
    why:
      'The feature itself. A heading set to 40px of top margin on Phone must get it at phone width. ' +
      'Without !important the inline desktop 0 wins and the Phone panel silently does nothing.',
    section: {
      layout: 'single',
      modules: [{ type: 'heading', text: 'A module styled per device', settings: { marginTop: '0', 'phone.marginTop': '40' } }],
    },
    selector: '.builder-preview-module[data-builder-module-device-scope]',
    read: ['marginTop'],
    emulate: { viewport: { width: 420, height: 900 } },
    expect(sample) {
      return sample.styles.marginTop === '40px'
        ? null
        : `a module with Phone margin-top 40 rendered margin-top ${sample.styles.marginTop} at 420px — the phone rule is not reaching the module.`;
    },
  },
  {
    id: 'module-device-styles-phone-alignment-can-un-centre-a-module',
    why:
      'REVIEW ROUND 1, and it needs a browser because the generated CSS looked perfectly right. ' +
      'Desktop declares center/right on the CHILD (`.is-align-center .builder-preview-heading ' +
      '{ justify-self: center }`), and a child\'s own justify-self beats the parent\'s ' +
      'justify-items — so a device rule written only on the wrapper moved a module OUT of left ' +
      'and could never move it back IN. Measured at 420px: center + phone.alignment left rendered ' +
      'justify-self: center, unmoved.',
    section: {
      layout: 'single',
      modules: [
        { type: 'heading', text: 'Left on a phone', settings: { alignment: 'center', 'phone.alignment': 'left' } },
      ],
    },
    selector: '.builder-preview-module[data-builder-module-device-scope] > *',
    read: ['justifySelf', 'textAlign'],
    emulate: { viewport: { width: 420, height: 900 } },
    expect(sample) {
      if (sample.styles.justifySelf === 'center') {
        return 'a centred heading set to Phone alignment "left" still rendered justify-self: center at 420px — the device rule is on the wrapper only, and the child\'s own justify-self beats it.';
      }
      return sample.styles.textAlign === 'left'
        ? null
        : `a centred heading set to Phone alignment "left" rendered text-align ${sample.styles.textAlign} at 420px, not left.`;
    },
  },
  {
    id: 'module-device-styles-phone-alignment-can-centre-a-module',
    why:
      'The OTHER direction of the contract above, and the direction that already worked — so a ' +
      'fix cannot buy one by breaking the other. A left heading set to Phone alignment "center" ' +
      'centres at 420px.',
    section: {
      layout: 'single',
      modules: [
        { type: 'heading', text: 'Centred on a phone', settings: { alignment: 'left', 'phone.alignment': 'center' } },
      ],
    },
    selector: '.builder-preview-module[data-builder-module-device-scope] > *',
    read: ['justifySelf', 'textAlign'],
    emulate: { viewport: { width: 420, height: 900 } },
    expect(sample) {
      return sample.styles.textAlign === 'center' && sample.styles.justifySelf !== 'auto'
        ? null
        : `a left-aligned heading set to Phone alignment "center" rendered justify-self ${sample.styles.justifySelf} / text-align ${sample.styles.textAlign} at 420px. A device alignment must write the SAME declarations desktop writes, on the same element — the wrapper alone happens to centre this one, and that is exactly why the opposite direction silently did nothing.`;
    },
  },
  {
    id: 'module-device-styles-a-tablet-edit-does-not-move-a-legacy-phone-font-size',
    why:
      'REVIEW ROUND 1, finding 4, and the one that would have moved a live client page. The ' +
      'emit guard was per MODULE, so an unrelated tablet margin let the phone chain re-emit the ' +
      'pre-device `mobileFontSize` at 767px with !important and a three-repeat selector on it — ' +
      'at a width it has never applied at. A heading rendering `clamp(1.35rem, 9vw, 2.35rem)` ' +
      'today would have dropped to 18px because somebody set a tablet margin.',
    section: {
      layout: 'single',
      modules: [
        {
          type: 'heading',
          text: 'Untouched by a tablet margin',
          settings: { fontSize: '48', mobileFontSize: '18', 'tablet.marginTop': '12' },
        },
      ],
    },
    selector: '.builder-preview-module[data-builder-module-device-scope] > *',
    read: ['fontSize'],
    emulate: { viewport: { width: 420, height: 900 } },
    // Until 2026-09-20 this asserted NOT 18px, which only worked because the
    // legacy field never reached a real phone (the 560px cap beat it). Since
    // 86bc3xrhz the field wins on its own, so 18px is now right from BOTH
    // paths and a browser cannot tell them apart. The emit guard itself is
    // pinned where it can be seen, in builder-module-device-css.test.ts ("keeps
    // a legacy field out of the rules when ANOTHER key is set"); what is left
    // for a browser is that a tablet edit leaves the old field working.
    expect(sample) {
      return sample.styles.fontSize === '18px'
        ? null
        : `a heading carrying the legacy mobileFontSize 18 and an unrelated tablet margin rendered ${sample.styles.fontSize} at 420px — the tablet edit broke the old phone size.`;
    },
  },
  {
    id: 'module-device-styles-leave-desktop-alone',
    why:
      'The other direction, so the contract above cannot pass by breaking every width: the same ' +
      'heading keeps its own 0 on a desktop screen.',
    section: {
      layout: 'single',
      modules: [{ type: 'heading', text: 'A module styled per device', settings: { marginTop: '0', 'phone.marginTop': '40' } }],
    },
    selector: '.builder-preview-module[data-builder-module-device-scope]',
    read: ['marginTop'],
    expect(sample) {
      return sample.styles.marginTop === '0px'
        ? null
        : `a module whose desktop margin-top is 0 rendered ${sample.styles.marginTop} on a desktop screen — a device rule is leaking to desktop.`;
    },
  },
  {
    id: 'module-device-styles-phone-font-size-beats-the-desktop-inline-size',
    why:
      'A heading paints its font size INLINE on the heading element, not on the wrapper, so the ' +
      'phone rule has to reach past the wrapper and outrank an inline value. This is the one the ' +
      'operator asked for by name ("set the font size to something much smaller").',
    section: {
      layout: 'single',
      modules: [{ type: 'heading', text: 'Smaller on a phone', settings: { fontSize: '48', 'phone.fontSize': '16' } }],
    },
    selector: '.builder-preview-module[data-builder-module-device-scope] .builder-preview-heading',
    read: ['fontSize'],
    emulate: { viewport: { width: 420, height: 900 } },
    expect(sample) {
      return sample.styles.fontSize === '16px'
        ? null
        : `a heading with Phone font size 16 rendered ${sample.styles.fontSize} at 420px.`;
    },
  },
  {
    id: 'module-device-styles-leave-the-old-mobile-fields-alone',
    why:
      'Acceptance criterion: a page using the pre-device `mobileHidden`/`mobileAlignment`/' +
      '`mobileFontSize` must go on rendering through the stylesheet classes, not the device ' +
      'rules. The selector is half the contract: this module must carry no device scope at all, ' +
      'and if one ever appears nothing matches and the harness says so.\n' +
      'The other half changed on 2026-09-20 (86bc3xrhz). Until then Mobile Font Size had never ' +
      'reached a real phone: the phone cap `clamp(1.35rem, 9vw, 2.35rem) !important` sat at equal ' +
      'specificity later in the file and won. The field now beats the cap, so 18 means 18.',
    section: {
      layout: 'single',
      modules: [
        {
          type: 'heading',
          text: 'Still the old way',
          settings: { fontSize: '48', mobileFontSize: '18', mobileAlignment: 'center', mobileHidden: 'false' },
        },
      ],
    },
    selector: '.builder-preview-module:not([data-builder-module-device-scope]) .builder-preview-heading',
    read: ['fontSize'],
    emulate: { viewport: { width: 420, height: 900 } },
    expect(sample) {
      return sample.styles.fontSize === '18px'
        ? null
        : `a heading with the old Mobile Font Size 18 rendered ${sample.styles.fontSize} at 420px — the phone cap is beating the field again, which is how it never reached a real phone.`;
    },
  },
  {
    id: 'module-device-styles-phone-font-size-reaches-words-the-toolbar-sized',
    why:
      '86bc3xrhz, Delray\'s home page. The hero headline was styled in the rich text toolbar, so ' +
      'every word sat in `<span style="font-size: 88px">`. Phone Font Size landed on the heading ' +
      'and lost to those inline sizes: the control did nothing, and "Champions" split mid-word on ' +
      'a phone. The contract above cannot see this — its heading has no inline sizes.',
    section: {
      layout: 'single',
      modules: [
        {
          type: 'heading',
          text: '<span style="font-size: 88px;">Play Where </span><span style="font-size: 88px; color: rgb(146, 210, 80);">Champions</span>',
          settings: { fontSize: '60', level: 'h1', variant: 'hero', 'phone.fontSize': '30' },
        },
      ],
    },
    selector: '.builder-preview-module[data-builder-module-device-scope] .builder-preview-heading span',
    read: ['fontSize'],
    emulate: { viewport: { width: 420, height: 900 } },
    expect(sample) {
      return sample.styles.fontSize === '30px'
        ? null
        : `a word the toolbar sized at 88px, in a heading with Phone font size 30, rendered ${sample.styles.fontSize} at 420px — the phone size is not reaching it.`;
    },
  },
  {
    id: 'phone-cap-reaches-words-the-toolbar-sized-and-never-splits-them',
    why:
      '86bc3xrhz, the same headline with NO phone size set — the state Delray was actually in. ' +
      'The built-in phone cap landed on the heading only, so the words stayed 88px, and ' +
      '`overflow-wrap: anywhere` broke "Champions" at any letter instead. On a phone the word ' +
      'follows the heading\'s capped size and wraps only between words.',
    section: {
      layout: 'single',
      modules: [
        {
          type: 'heading',
          text: '<span style="font-size: 88px;">Play Where </span><span style="font-size: 88px;">Champions</span>',
          settings: { fontSize: '60', level: 'h1', variant: 'hero' },
        },
      ],
    },
    selector: '.builder-preview-heading span',
    read: ['fontSize', 'overflowWrap'],
    emulate: { viewport: { width: 420, height: 900 } },
    expect(sample) {
      const size = Number.parseFloat(sample.styles.fontSize);
      if (!(size <= 2.35 * 16 + 0.5)) {
        return `a word the toolbar sized at 88px rendered ${sample.styles.fontSize} at 420px — the phone cap (2.35rem) is not reaching it.`;
      }
      return sample.styles.overflowWrap === 'anywhere'
        ? 'a heading word at 420px carries overflow-wrap: anywhere, which splits a word at any letter ("Champ-ions").'
        : null;
    },
  },
  {
    id: 'words-the-toolbar-sized-keep-their-size-on-desktop',
    why:
      'The other direction, so the two contracts above cannot pass by shrinking every width: on a ' +
      'desktop screen the toolbar\'s 88px is what the operator drew, and it stays.',
    section: {
      layout: 'single',
      modules: [
        {
          type: 'heading',
          text: '<span style="font-size: 88px;">Champions</span>',
          settings: { fontSize: '60', level: 'h1', variant: 'hero', 'phone.fontSize': '30' },
        },
      ],
    },
    selector: '.builder-preview-heading span',
    read: ['fontSize'],
    expect(sample) {
      return sample.styles.fontSize === '88px'
        ? null
        : `a word the toolbar sized at 88px rendered ${sample.styles.fontSize} on a desktop screen — a phone rule is leaking to desktop.`;
    },
  },
  {
    id: 'module-device-styles-phone-line-height-and-letter-spacing',
    why:
      '86bc3xrhz: the Phone panel offers a heading\'s Line Height and Letter Spacing, because both ' +
      'decide whether a big headline fits a narrow screen. The heading writes both INLINE, so the ' +
      'phone rule has to outrank an inline value, exactly as font size does.',
    section: {
      layout: 'single',
      modules: [
        {
          type: 'heading',
          text: 'Tighter on a phone',
          settings: { lineHeight: '1.6', letterSpacing: '4', 'phone.lineHeight': '1', 'phone.letterSpacing': '0' },
        },
      ],
    },
    selector: '.builder-preview-module[data-builder-module-device-scope] .builder-preview-heading',
    read: ['lineHeight', 'letterSpacing', 'fontSize'],
    emulate: { viewport: { width: 420, height: 900 } },
    expect(sample) {
      const lineHeight = Number.parseFloat(sample.styles.lineHeight);
      const fontSize = Number.parseFloat(sample.styles.fontSize);
      if (Math.abs(lineHeight - fontSize) > 0.5) {
        return `a heading with Phone line height 1 rendered line-height ${sample.styles.lineHeight} over font-size ${sample.styles.fontSize} at 420px.`;
      }
      return sample.styles.letterSpacing === '0px' || sample.styles.letterSpacing === 'normal'
        ? null
        : `a heading with Phone letter spacing 0 rendered letter-spacing ${sample.styles.letterSpacing} at 420px.`;
    },
  },
  {
    id: 'module-device-styles-hide-on-tablet-hides-at-tablet-width',
    why: '"Hide on Tablet" must take the module out at 900px, where a phone rule must not reach.',
    section: {
      layout: 'single',
      modules: [{ type: 'heading', text: 'Gone on a tablet', settings: { 'tablet.hidden': 'true' } }],
    },
    selector: '.builder-preview-module[data-builder-module-device-scope]',
    read: ['display'],
    emulate: { viewport: { width: 900, height: 900 } },
    hidden: true,
  },
  {
    id: 'module-device-styles-hide-on-tablet-also-hides-on-a-phone',
    why: 'A phone FOLLOWS its tablet. Hiding on Tablet and seeing it on a phone would be the rule broken.',
    section: {
      layout: 'single',
      modules: [{ type: 'heading', text: 'Gone on a tablet', settings: { 'tablet.hidden': 'true' } }],
    },
    selector: '.builder-preview-module[data-builder-module-device-scope]',
    read: ['display'],
    emulate: { viewport: { width: 420, height: 900 } },
    hidden: true,
  },
  {
    id: 'module-device-styles-a-phone-can-show-a-tablet-hidden-module-again',
    why:
      'The half that is easy to get wrong: the tablet hide is confined to the tablet BAND rather ' +
      'than undone by a second display declaration, because there is no one value to undo it to ' +
      '(a module in an equal-height row is display:flex, everywhere else block).',
    section: {
      layout: 'single',
      modules: [
        { type: 'heading', text: 'Back on a phone', settings: { 'tablet.hidden': 'true', 'phone.hidden': 'false' } },
      ],
    },
    selector: '.builder-preview-module[data-builder-module-device-scope]',
    read: ['display'],
    emulate: { viewport: { width: 420, height: 900 } },
    expect(sample) {
      return sample.styles.display !== 'none'
        ? null
        : 'a module hidden on Tablet and shown again on Phone is still display:none at 420px — the tablet hide is not confined to the tablet band.';
    },
  },

  {
    id: 'device-styles-tablet-padding-applies-at-800px',
    why:
      'The Tablet band is 768-1024px and 800px sits near its bottom edge, where the phone query used ' +
      'to be. Reading 60 here would mean the phone rule reaches above 767px; reading 18 would mean the ' +
      'tablet rule stops short of 800. The 900px contract above cannot catch either — it is comfortably ' +
      'inside the band from both sides (device styles 4 of 4, task 86bc14pgq).',
    section: { ...DEVICE_STYLED_SECTION },
    selector: '.builder-preview-section[data-builder-device-scope]',
    read: ['paddingTop'],
    emulate: { viewport: { width: 800, height: 900 } },
    expect(sample) {
      return sample.styles.paddingTop === '30px'
        ? null
        : `a row with Tablet padding-top 30 rendered padding-top ${sample.styles.paddingTop} at 800px — the tablet band does not cover 800px, or the phone rule is reaching above 767px.`;
    },
  },

  /*
   * THE LEGACY NARROW-SCREEN RULES, ON THE DEVICE WIDTHS (device styles 4 of
   * 4, task 86bc14pgq).
   *
   * The Builder used to carry two unrelated sets of breakpoints: the device
   * system at 1024/767, and the older "mobile" rules at 900/560. These three
   * hold the move of the rule that decides the most — whether a row's columns
   * sit side by side — onto the tablet width, in both directions, plus the
   * operator's opt-out. The move shows up nowhere in the markup: the class
   * list of a stacked row and a side-by-side row are identical, so only a real
   * browser at a real width can tell them apart.
   */
  {
    id: 'legacy-narrow-rules-stack-a-row-at-the-tablet-width',
    why:
      'A two-column row must be ONE column at 1000px. It stacked only below 900px before this task, ' +
      'so 901-1024px showed two columns on a screen the Builder calls a tablet.',
    section: {
      layout: 'two-column',
      modules: [
        { type: 'heading', text: 'Left', settings: {}, column: 'left' },
        { type: 'heading', text: 'Right', settings: {}, column: 'right' },
      ],
    },
    selector: '.builder-preview-section-layout-two-column',
    read: ['gridTemplateColumns'],
    emulate: { viewport: { width: 1000, height: 900 } },
    expect(sample) {
      const tracks = String(sample.styles.gridTemplateColumns || '').trim().split(/\s+/).filter(Boolean);
      return tracks.length === 1
        ? null
        : `a two-column row rendered ${tracks.length} track(s) (${sample.styles.gridTemplateColumns || 'none'}) at 1000px, not 1 — the stacking rule is still at the old 900px.`;
    },
  },
  {
    id: 'legacy-narrow-rules-leave-desktop-alone',
    why:
      'The other direction, so the contract above cannot pass by stacking every width: the same row ' +
      'keeps its two columns on a desktop screen. Widening a breakpoint is only safe while it stops.',
    section: {
      layout: 'two-column',
      modules: [
        { type: 'heading', text: 'Left', settings: {}, column: 'left' },
        { type: 'heading', text: 'Right', settings: {}, column: 'right' },
      ],
    },
    selector: '.builder-preview-section-layout-two-column',
    read: ['gridTemplateColumns'],
    expect(sample) {
      const tracks = String(sample.styles.gridTemplateColumns || '').trim().split(/\s+/).filter(Boolean);
      return tracks.length === 2
        ? null
        : `a two-column row rendered ${tracks.length} track(s) (${sample.styles.gridTemplateColumns || 'none'}) on a desktop screen, not 2 — the tablet stacking rule is leaking upward.`;
    },
  },
  {
    id: 'legacy-narrow-rules-keep-columns-still-opts-out-at-the-tablet-width',
    why:
      'Mobile Layout "Keep columns" is the escape hatch that makes the wider stacking width safe — it ' +
      'is the only way an operator can say "not this row". If it stopped working at 1000px, the move ' +
      'would be a one-way change to every client page that relies on it.',
    section: {
      layout: 'two-column',
      mobileLayout: 'keep',
      modules: [
        { type: 'heading', text: 'Left', settings: {}, column: 'left' },
        { type: 'heading', text: 'Right', settings: {}, column: 'right' },
      ],
    },
    selector: '.builder-preview-section-mobile-keep',
    read: ['gridTemplateColumns'],
    emulate: { viewport: { width: 1000, height: 900 } },
    expect(sample) {
      const tracks = String(sample.styles.gridTemplateColumns || '').trim().split(/\s+/).filter(Boolean);
      return tracks.length === 2
        ? null
        : `a "Keep columns" row rendered ${tracks.length} track(s) (${sample.styles.gridTemplateColumns || 'none'}) at 1000px, not 2 — the opt-out does not reach the tablet width.`;
    },
  },

  {
    id: 'preview-tablet-frame-shows-the-rows-tablet-styles',
    why:
      'The Tablet frame is an 820px box inside a 1440px window, so `@media (max-width: 1024px)` is ' +
      'FALSE inside it. Without a class-keyed copy of every tablet rule the frame shows desktop, and ' +
      'the operator reads that as the Tablet panel not working (device styles 4 of 4, task 86bc14pgq).',
    section: { ...DEVICE_STYLED_SECTION },
    selector: '.builder-preview-device-tablet .builder-preview-section[data-builder-device-scope]',
    read: ['paddingTop'],
    emulate: { previewDevice: 'tablet' },
    expect(sample) {
      return sample.styles.paddingTop === '30px'
        ? null
        : `the Tablet frame rendered padding-top ${sample.styles.paddingTop} for a row whose Tablet padding-top is 30 — the frame is not getting the tablet rules.`;
    },
  },
  {
    id: 'preview-tablet-frame-does-not-show-phone-styles',
    why:
      'The other half, and the easy mistake: the phone rule is the one that already had a frame copy, ' +
      'so emitting it for both frames is one careless line. A tablet sits ABOVE the phone breakpoint — ' +
      'reading 60 here means the Tablet frame is showing a phone.',
    section: { ...DEVICE_STYLED_SECTION },
    selector: '.builder-preview-device-tablet .builder-preview-section[data-builder-device-scope]',
    read: ['paddingTop'],
    emulate: { previewDevice: 'tablet' },
    expect(sample) {
      return sample.styles.paddingTop === '60px'
        ? 'the Tablet frame rendered the PHONE padding-top (60) — a phone-only rule is reaching the tablet frame.'
        : null;
    },
  },
  {
    id: 'preview-phone-frame-agrees-with-a-real-phone',
    why:
      'Measured 2026-09-15: a row with 90px of Tablet top padding rendered 10px in the phone frame and ' +
      '90px in a real 420px browser, because the frame took its padding from a flat `padding: 10px` ' +
      'instead of the row\'s own variables. A preview that disagrees with the device it imitates is ' +
      'worse than no preview — the phone contract at 420px above reads 60, so this must too.',
    section: { ...DEVICE_STYLED_SECTION },
    selector: '.builder-preview-device-mobile .builder-preview-section[data-builder-device-scope]',
    read: ['paddingTop'],
    emulate: { previewDevice: 'mobile' },
    expect(sample) {
      return sample.styles.paddingTop === '60px'
        ? null
        : `the phone frame rendered padding-top ${sample.styles.paddingTop} for a row whose Phone padding-top is 60 — the frame is not reading the row's own device values.`;
    },
  },

  /*
   * THE BUILDER'S PHONE / TABLET POP-UP (86bc3yyn0).
   *
   * The pop-up is an iframe of `builder-preview.html?embed=1` whose width IS
   * the device, instead of the preview page's phone frame. That is the whole
   * point of it: a frame is a narrow box in a wide window and only gets the
   * mirror CSS, while an iframe 390px wide gets the real phone media rules —
   * the ones a visitor's phone gets. The Delray headline that split mid-word
   * (86bc3xrhz) only showed at real phone width.
   *
   * `emulate.embedFrame` names a device; the harness reads its size out of
   * builder-device-preview.tsx, hosts the embed page in an iframe that size,
   * and measures INSIDE it. Selectors deliberately carry no frame class:
   * inside the embed there must be no frame, so these pass only on the real
   * media rules.
   */
  {
    id: 'preview-embed-phone-width-gets-phone-rules',
    why:
      'The Phone pop-up must show what a phone shows. A row with Phone top padding 60 has to read 60 ' +
      'inside a 390px embed with NO phone frame around it — i.e. from the real `max-width` media rule. ' +
      'If the embed page ever drew its own frame again, or the pop-up width drifted above the phone ' +
      'breakpoint, this reads 18 or 30 (86bc3yyn0).',
    section: { ...DEVICE_STYLED_SECTION },
    selector: '.builder-preview-section[data-builder-device-scope]',
    read: ['paddingTop'],
    emulate: { embedFrame: 'phone' },
    expect(sample) {
      return sample.styles.paddingTop === '60px'
        ? null
        : `inside the Phone pop-up's iframe the row rendered padding-top ${sample.styles.paddingTop}, not its Phone value 60 — the pop-up is not getting the real phone rules.`;
    },
  },
  {
    id: 'preview-embed-tablet-width-gets-tablet-rules',
    why:
      'Same for Tablet: inside the 820px embed the row must read its Tablet padding 30 — not the ' +
      'desktop 18, and not the phone 60 (86bc3yyn0).',
    section: { ...DEVICE_STYLED_SECTION },
    selector: '.builder-preview-section[data-builder-device-scope]',
    read: ['paddingTop'],
    emulate: { embedFrame: 'tablet' },
    expect(sample) {
      return sample.styles.paddingTop === '30px'
        ? null
        : `inside the Tablet pop-up's iframe the row rendered padding-top ${sample.styles.paddingTop}, not its Tablet value 30.`;
    },
  },
  {
    id: 'preview-embed-has-no-frame',
    why:
      'The embed must not wrap the page in the preview\'s own phone frame — a frame inside the pop-up ' +
      'is a phone inside a phone, and swaps the real media rules for the mirror CSS. Paired with the ' +
      'two presence contracts above, which prove the embed rendered at all (86bc3yyn0).',
    section: { ...DEVICE_STYLED_SECTION },
    selector: '.builder-preview-device-frame',
    absent: true,
    emulate: { embedFrame: 'phone', storedDevice: 'mobile' },
  },
  {
    id: 'preview-embed-has-no-strip',
    why:
      'The embed hides the preview page\'s own yellow strip (Desktop/Tablet/Mobile buttons and Close); ' +
      'the pop-up has its own header, and a second set of device buttons inside it would contradict ' +
      'the one the operator just chose (86bc3yyn0).',
    section: { ...DEVICE_STYLED_SECTION },
    selector: '.builder-preview-strip',
    absent: true,
    emulate: { embedFrame: 'phone' },
  },

  /*
   * TABLET AND PHONE CELL STYLES (device styles 2 of 4, task 86bc14pey).
   *
   * Same three-width shape as the row contracts above, for the same reason:
   * the failures are all invisible in the markup. What is NEW here is the
   * scope — the rules are hung off the COLUMN, so a contract reading the row
   * would pass on a rule that reached the wrong element.
   */
  {
    id: 'device-styles-cell-phone-padding-applies-on-a-phone',
    why:
      'The feature itself. A column set to 40px of top padding on Phone must get it at phone width. ' +
      'Without !important the inline desktop 10px wins and the Phone panel silently does nothing.',
    section: { ...CELL_DEVICE_STYLED_SECTION },
    selector: '.builder-preview-column[data-builder-device-scope]',
    read: ['paddingTop'],
    emulate: { viewport: { width: 420, height: 900 } },
    expect(sample) {
      return sample.styles.paddingTop === '40px'
        ? null
        : `a column with Phone padding-top 40 rendered padding-top ${sample.styles.paddingTop} at 420px — the phone rule is not reaching the column.`;
    },
  },
  {
    id: 'device-styles-cell-tablet-padding-applies-on-a-tablet-and-not-phone-value',
    why:
      'Tablet has its own value (20) and Phone its own (40). At 900px only the tablet rule may match; ' +
      'getting 40 means the phone query is too wide, getting 10 means the tablet rule is missing.',
    section: { ...CELL_DEVICE_STYLED_SECTION },
    selector: '.builder-preview-column[data-builder-device-scope]',
    read: ['paddingTop'],
    emulate: { viewport: { width: 900, height: 900 } },
    expect(sample) {
      return sample.styles.paddingTop === '20px'
        ? null
        : `a column with Tablet padding-top 20 rendered padding-top ${sample.styles.paddingTop} at 900px.`;
    },
  },
  {
    id: 'device-styles-cell-leaves-desktop-alone',
    why:
      'The other direction, so the two contracts above cannot pass by breaking every width: on a ' +
      'desktop screen the same column keeps its own 10px.',
    section: { ...CELL_DEVICE_STYLED_SECTION },
    selector: '.builder-preview-column[data-builder-device-scope]',
    read: ['paddingTop'],
    expect(sample) {
      return sample.styles.paddingTop === '10px'
        ? null
        : `a column whose desktop padding-top is 10 rendered ${sample.styles.paddingTop} on a desktop screen — a cell device rule is leaking to desktop.`;
    },
  },
  {
    id: 'device-styles-cell-rules-reach-only-their-own-column',
    why:
      'The rules are scoped per COLUMN, not per row. TWO columns are given DIFFERENT phone padding ' +
      'here on purpose: with one scope id shared by the row, both columns would match both rules and ' +
      'the later one would win everywhere, so the first column would read the second\'s 60. A fixture ' +
      'where only one column is styled cannot see that at all — the unstyled column carries no scope ' +
      'attribute, so it passes whatever the ids are.',
    section: {
      layout: 'two-column',
      background: { mode: 'color', color: '#eeeeee' },
      cellPaddingTop: { left: '10', right: '10' },
      cellDeviceOverrides: {
        phone: { left: { cellPaddingTop: '40' }, right: { cellPaddingTop: '60' } },
      },
      modules: [
        { type: 'heading', text: 'Left', settings: {}, column: 'left' },
        { type: 'heading', text: 'Right', settings: {}, column: 'right' },
      ],
    },
    selector: '.builder-preview-section-layout-two-column > .builder-preview-column:nth-of-type(1)',
    read: ['paddingTop'],
    emulate: { viewport: { width: 420, height: 900 } },
    expect(sample) {
      return sample.styles.paddingTop === '40px'
        ? null
        : `the first column rendered padding-top ${sample.styles.paddingTop} at 420px, not its own 40 — the second column's phone rules are reaching it.`;
    },
  },
  {
    id: 'device-styles-cell-hide-on-phone-hides-the-column',
    why: '"Hide on Phone" must take the column out at phone width — and only there (the desktop contract above reads the same column visible).',
    section: {
      ...CELL_DEVICE_STYLED_SECTION,
      cellDeviceOverrides: { phone: { main: { hidden: 'true' } } },
    },
    selector: '.builder-preview-column[data-builder-device-scope]',
    read: ['display'],
    emulate: { viewport: { width: 420, height: 900 } },
    hidden: true,
  },
  {
    id: 'device-styles-cell-legacy-hide-on-mobile-still-hides',
    why:
      'Every page saved before this feature hides its columns with the old per-cell "Hide on Mobile" ' +
      'field. Nothing in this slice may stop that working — a column that reappears on a phone is a ' +
      'live site changing under a client who asked for nothing.',
    section: {
      layout: 'single',
      background: { mode: 'color', color: '#eeeeee' },
      cellMobileHidden: { main: 'true' },
      modules: [{ type: 'heading', text: 'Hidden the old way', settings: {} }],
    },
    selector: '.builder-preview-column-mobile-hidden',
    read: ['display'],
    emulate: { viewport: { width: 420, height: 900 } },
    hidden: true,
  },
  {
    id: 'device-styles-cell-keep-reverse-stack-column-order',
    why:
      'The rules element lives INSIDE the row and the phone Reverse stack rules count the row\'s ' +
      'children with :nth-child(1..6). Every column\'s rules go into that ONE element, placed last; ' +
      'a per-column element between the columns would renumber them and show the sixth one fourth.',
    section: {
      layout: 'six-column',
      mobileLayout: 'reverse-stack',
      cellDeviceOverrides: {
        phone: { left: { cellPaddingTop: '4' }, col6: { cellPaddingTop: '8' } },
      },
      modules: [
        { type: 'heading', text: 'One', settings: {}, column: 'left' },
        { type: 'heading', text: 'Two', settings: {}, column: 'center' },
        { type: 'heading', text: 'Three', settings: {}, column: 'right' },
        { type: 'heading', text: 'Four', settings: {}, column: 'col4' },
        { type: 'heading', text: 'Five', settings: {}, column: 'col5' },
        { type: 'heading', text: 'Six', settings: {}, column: 'col6' },
      ],
    },
    selector: '.builder-preview-section-mobile-reverse-stack > .builder-preview-column:nth-of-type(6)',
    read: ['order'],
    emulate: { viewport: { width: 420, height: 900 } },
    expect(sample) {
      return Number(sample.styles.order) === -2
        ? null
        : `the sixth column of a Reverse stack row with per-cell phone settings resolved order ${sample.styles.order}, not -2 — the rules element is renumbering the columns.`;
    },
  },
  {
    id: 'tag-cloud-sizes-its-tags-by-count',
    why:
      'A tag cloud that does not size by count is a pill row. "Cloud (sized by count)" is the ' +
      'default layout and the module\'s reason to exist, and the arithmetic reaching the PAGE is the ' +
      'half a unit test cannot see: lib/builder-client/blog-tag-cloud.ts is tested directly, but it ' +
      'returns a number, and a number that never becomes a font-size renders as four identical pills. ' +
      'That was the live state until 2026-09-03 — the Builder canvas sized them and the tenant site ' +
      'did not, so the operator saw a cloud and the visitor got a row.',
    module: {
      type: 'blog-tag-cloud',
      settings: {
        layout: 'cloud',
        minFontSize: '10',
        maxFontSize: '30',
        tags: JSON.stringify([
          { id: 'big', label: 'news', slug: 'news', count: 40 },
          { id: 'small', label: 'rarely', slug: 'rarely', count: 1 },
        ]),
      },
    },
    selector: '.builder-blog-tag-cloud',
    read: ['display'],
    series: {
      count: 1,
      everyMs: 0,
      read: ['fontSize'],
      selectors: {
        big: '.builder-blog-tag-cloud a:first-of-type',
        small: '.builder-blog-tag-cloud a:last-of-type',
      },
    },
    expect(sample) {
      const frame = sample.series?.[0];
      if (!frame || !frame.big || !frame.small) {
        return 'the tag cloud rendered no tag links — the module draws nothing a visitor can click.';
      }
      const big = parseFloat(frame.big.fontSize);
      const small = parseFloat(frame.small.fontSize);
      if (!(big > small)) {
        return `a 40-post tag renders at ${frame.big.fontSize} and a 1-post tag at ${frame.small.fontSize} — ` +
          'the cloud is not sized by count, so every tag looks equally important.';
      }
      // The BUSIEST tag lands exactly on Max Font; the quietest lands NEAR Min
      // Font rather than on it, because the scale is proportional: a 1-post tag
      // among 40 is 10 + (1/40 x 20) = 10.5px, not 10px. Asserting an exact 10
      // here failed on correct arithmetic the first time this contract ran,
      // which is the check doing its job on the assertion rather than the code.
      if (Math.round(big) !== 30) {
        return `the busiest tag renders at ${frame.big.fontSize} with Max Font set to 30 — ` +
          'the size controls are not reaching the page.';
      }
      if (small > 13) {
        return `the quietest tag renders at ${frame.small.fontSize} with Min Font set to 10 — ` +
          'the bottom of the scale is not reaching the page.';
      }
      return null;
    },
  },

  {
    id: 'tag-cloud-list-layout-is-a-list',
    why:
      'The Layout select offers Cloud, Pills and List, and the live renderer used to ignore it ' +
      'entirely — all three drew the same pill row while the Builder canvas honoured the choice. An ' +
      'operator therefore set a layout, watched it apply, published, and got something else. Reading ' +
      'the list layout from the page is the cheapest proof the setting survives the trip.',
    module: {
      type: 'blog-tag-cloud',
      settings: {
        layout: 'list',
        tags: JSON.stringify([
          { id: 'a', label: 'news', slug: 'news', count: 4 },
          { id: 'b', label: 'guides', slug: 'guides', count: 2 },
        ]),
      },
    },
    selector: '.builder-blog-tag-cloud ul',
    read: ['display', 'flexDirection'],
    expect(sample) {
      if (sample.styles.flexDirection !== 'column') {
        return `the list layout stacks ${sample.styles.flexDirection}, not in a column — ` +
          'it is rendering as the pill row again.';
      }
      if (!/news/.test(sample.text)) {
        return `the list rendered "${sample.text.slice(0, 60)}" — the tags are not reaching it.`;
      }
      return null;
    },
  },

  {
    id: 'event-detail-without-a-slug-explains-itself',
    why:
      'The event page renders whichever event the ADDRESS names. On this page there is no ?event= ' +
      'in the URL and no database, which is exactly the state an operator meets the moment they drop ' +
      'the module on a page — and the state a visitor meets if a link is built wrong. A blank panel ' +
      'here reads as a broken module; R4 says that state is designed. It is also the only one of this ' +
      "module's states a fixture-free check can reach, the other two needing a real event.",
    module: { type: 'event-detail', settings: { backLinkUrl: '/whats-on', backLinkLabel: 'All events' } },
    selector: '.builder-event-detail-note',
    read: ['height'],
    expect(sample) {
      if (sample.box.height < 20) {
        return `the no-slug state is ${sample.box.height}px tall — the event page is rendering as a blank box.`;
      }
      if (!/single event/.test(sample.text)) {
        return `the no-slug state reads "${sample.text.slice(0, 70)}" — it no longer explains what the page is for.`;
      }
      return null;
    },
  },

  {
    id: 'event-calendar-month-grid-is-a-month',
    why:
      'The month grid is arithmetic wearing a layout: seven columns of whole weeks, with the ' +
      'neighbouring months drawn but muted. An off-by-one in the lead makes every date sit under the ' +
      'wrong weekday — a calendar that is confidently, silently wrong, which is worse than one that ' +
      'fails to draw. The geometry is unit-tested in lib/builder-client/event-format.ts; this is the ' +
      'half a test cannot see, that the numbers reach the page in seven columns.',
    module: { type: 'event-calendar', settings: { layout: 'month', calendarTitle: 'What is on' } },
    selector: '.builder-event-calendar-grid',
    read: ['gridTemplateColumns', 'display'],
    expect(sample) {
      if (sample.styles.display !== 'grid') {
        return `the month grid renders as ${sample.styles.display}, not a grid — its layout CSS is not reaching the page.`;
      }
      const columns = String(sample.styles.gridTemplateColumns || '').trim().split(/\s+/).filter(Boolean);
      if (columns.length !== 7) {
        return `the month grid has ${columns.length} columns, not 7 — a week is seven days and the dates will sit under the wrong weekdays.`;
      }
      return null;
    },
  },

  {
    id: 'event-calendar-weekly-schedule-draws-a-whole-week',
    why:
      "The weekly schedule is Delray's printed Weekly Program Guide as a page (task 86bbzt25j): every " +
      'day of the week down the side, whether or not anything is on it. The date arithmetic is ' +
      'unit-tested in lib/builder-client/event-schedule.ts; what a test cannot see is that seven day ' +
      'rows reach the page stacked in a column. With no database here the week is empty, which is the ' +
      'state a club meets before its programs are entered — a missing day, or days laid out side by ' +
      'side, would be a schedule that reads wrong to every visitor.',
    module: { type: 'event-calendar', settings: { layout: 'week', weekStartsOn: '1', calendarTitle: 'Weekly program guide' } },
    selector: '.builder-event-calendar-week',
    read: ['display', 'flexDirection', 'height'],
    expect(sample) {
      if (sample.styles.display !== 'flex' || sample.styles.flexDirection !== 'column') {
        return `the week renders as ${sample.styles.display} ${sample.styles.flexDirection}, not a column of days — its layout CSS is not reaching the page.`;
      }
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      const missing = days.filter((d) => !sample.text.includes(d));
      if (missing.length) {
        return `the week is missing ${missing.join(', ')} — a program guide must draw every day, even an empty one.`;
      }
      if (!/^\s*Monday/.test(sample.text)) {
        return `the week begins "${sample.text.slice(0, 20)}", not Monday — the Week Starts setting is not reaching the weekly layout.`;
      }
      if (sample.box.height < 7 * 40) {
        return `the week is ${sample.box.height}px tall — seven day rows are collapsing on top of each other.`;
      }
      return null;
    },
  },

  {
    id: 'event-calendar-empty-state-is-designed',
    why:
      'On this page there is no session and no database, so the calendar renders the state a tenant ' +
      'meets before they have added anything. R4: that is a designed state. Every failure mode of a ' +
      'fetch-backed module lands here as a zero-height box indistinguishable from a module that is ' +
      'switched off — and the operator-written empty message is the one piece of copy proving the ' +
      'setting reaches the renderer at all.',
    module: {
      type: 'event-calendar',
      settings: { layout: 'list', emptyMessage: 'Nothing on the calendar yet — do come back.' },
    },
    selector: '.builder-event-calendar-empty',
    read: ['height'],
    expect(sample) {
      if (sample.box.height < 20) {
        return `the empty state is ${sample.box.height}px tall — an empty calendar is rendering as a blank box.`;
      }
      if (!/Nothing on the calendar yet/.test(sample.text)) {
        return `the empty state reads "${sample.text.slice(0, 60)}" — the Empty Message setting is not reaching the renderer.`;
      }
      return null;
    },
  },

  {
    id: 'bug-report-trigger-renders-to-its-settings',
    why:
      'The Bug Report module is a floating button on tenant pages (task 4/5). It is the first module ' +
      'whose visible element is a control rather than content, so nothing else on this page proves ' +
      'that its size, label and block colour reach the stylesheet — a dead setting here renders a ' +
      'default chip and no error, the image-effect failure with a button instead of a picture.',
    module: {
      type: 'bug-report',
      settings: { iconSize: '60', labelText: 'Report a problem', iconBlock: 'true', blockColor: '#c0392b', iconColor: '#ffffff' },
    },
    selector: '.builder-bug-report-trigger',
    read: ['backgroundColor', 'height'],
    expect(sample) {
      if (sample.box.height < 56 || sample.box.height > 72) {
        return `trigger height is ${sample.box.height}px for Icon Size 60 — the size setting is not reaching the button.`;
      }
      if (!/Report a problem/.test(sample.text)) {
        return `trigger text is "${sample.text}" — the label setting is not rendering.`;
      }
      if (sample.styles.backgroundColor !== 'rgb(192, 57, 43)') {
        return `trigger background is ${sample.styles.backgroundColor}, not the block colour #c0392b — the block colour is not reaching the button.`;
      }
      return null;
    },
  },

  {
    id: 'section-four-column-grid',
    why:
      'The 4/5/6 equal-column row layouts are section-level (an inline grid-template-columns from ' +
      'LAYOUT_SPECS), which the module-only sweep never rendered. Assert the four-column row actually ' +
      'lays out four EQUAL tracks — break the spec and the tracks change, so this catches a regression ' +
      'the "does a module animate" sweep structurally could not.',
    section: { layout: 'four-column', modules: [{ type: 'text', text: '<p>col</p>', settings: {} }] },
    selector: '.builder-preview-section-layout-four-column',
    read: ['gridTemplateColumns'],
    expect(sample) {
      const tracks = String(sample.styles.gridTemplateColumns || '').trim().split(/\s+/).filter(Boolean);
      if (tracks.length !== 4) {
        return `four-column row rendered ${tracks.length} track(s) (${sample.styles.gridTemplateColumns || 'none'}), not 4 — the layout grid is wrong.`;
      }
      const widths = tracks.map((t) => parseFloat(t));
      if (widths.some((w) => !Number.isFinite(w))) {
        return `four-column tracks are not resolved pixel widths (${sample.styles.gridTemplateColumns}) — cannot confirm equal columns.`;
      }
      const spread = Math.max(...widths) - Math.min(...widths);
      if (spread > 2) {
        return `four-column tracks are not equal (widths ${widths.join(', ')}px, spread ${spread.toFixed(1)}px > 2px).`;
      }
      return null;
    },
  },

  {
    id: 'image-effect-actually-animates',
    why:
      'Cruise and Tumbleweed were offered in two image panels from the Normie port onward and ' +
      'NO stylesheet ever defined them. Choosing one set a class nobody styled, so the operator ' +
      'saw a still picture and no error, for months. An E7 audit walked straight past it because ' +
      'the setting DID reach a renderer — the renderer just had nothing to say about it.',
    module: {
      type: 'image',
      settings: {
        ...PICTURE,
        effect: 'tumbleweed',
        effectSpeed: '8',
        effectRotationRate: '30',
        effectFrequency: '4',
        effectBounceHeight: '150',
      },
    },
    selector: 'figure.builder-preview-image',
    expect(sample) {
      const names = sample.animations.map((a) => a.name);
      for (const required of ['sc-effect-travel', 'sc-effect-turn']) {
        if (!names.includes(required)) {
          return `no live \`${required}\` animation on the figure (found: ${names.join(', ') || 'none'}). ` +
            'The class is on the element but the engine is running nothing — a rule is missing.';
        }
      }
      // A running animation is not the same as a moving one: a name can be
      // present and parked. currentTime advancing is the only proof.
      if (!sample.advanced) {
        return `the animations exist but their currentTime did not advance over ${sample.settleMs}ms ` +
          `(${sample.animations.map((a) => `${a.name}@${a.playState}`).join(', ')}) — the picture is standing still.`;
      }
      return null;
    },
  },

  {
    id: 'still-image-runs-nothing',
    why:
      'The control case, and the reason the contract above means anything. If the harness reported ' +
      '"animating" for every image, a dead effect would still pass. Effect: None must produce NO ' +
      'animation and NO travel corridor.',
    module: { type: 'image', settings: { ...PICTURE, effect: 'none' } },
    selector: 'figure.builder-preview-image',
    expect(sample) {
      if (sample.animations.length) {
        return `a still image is running ${sample.animations.length} animation(s) ` +
          `(${sample.animations.map((a) => a.name).join(', ')}) — Effect: None is not off.`;
      }
      if (sample.page.corridors !== 0) {
        return `a still image built ${sample.page.corridors} travel corridor(s); a module that does not ` +
          'travel must not break out of its column at all.';
      }
      return null;
    },
  },

  // ── The three effects added in this task, asserted BY ANIMATION NAME ──────
  // Not just "something animates": the regenerated base file (_builder-react.css)
  // still carries the OLD normie-* keyframes on these same class names, so if a
  // settings-driven override rule breaks, the effect silently degrades to a
  // fixed-duration normie-* animation that ignores every setting — and the
  // generic effect sweep (any animation running) stays green. Asserting the
  // OVERRIDE's animation name is what catches that degrade. (Break-proof: remove
  // the override's `animation:` line, rebuild CSS, and the matching contract
  // below fails because a normie-* name runs instead.)
  {
    id: 'image-effect-slide-named',
    why: 'Slide must run the OVERRIDE animation (sc-effect-travel), not the base file\'s normie-slide fallback.',
    module: { type: 'image', settings: { ...PICTURE, effect: 'slide', effectSpeed: '8' } },
    selector: 'figure.builder-preview-image',
    expect(sample) {
      const names = sample.animations.map((a) => a.name);
      if (!names.includes('sc-effect-travel')) {
        return `slide is not running \`sc-effect-travel\` (found: ${names.join(', ') || 'none'}). ` +
          'If a normie-* name is here instead, the override broke and slide fell back to a settings-ignoring animation.';
      }
      if (!sample.advanced) return `slide's animation did not advance over ${sample.settleMs}ms — it is parked.`;
      return null;
    },
  },
  {
    id: 'image-effect-axis-rotate-named',
    why: 'Axis-rotate must run sc-effect-turn-y (the override), not normie-axis-rotate (the base fallback).',
    module: { type: 'image', settings: { ...PICTURE, effect: 'axis-rotate', effectRotationRate: '30' } },
    selector: 'figure.builder-preview-image',
    expect(sample) {
      const names = sample.animations.map((a) => a.name);
      if (!names.includes('sc-effect-turn-y')) {
        return `axis-rotate is not running \`sc-effect-turn-y\` (found: ${names.join(', ') || 'none'}). ` +
          'A normie-axis-rotate here means the override broke and Rotation Rate is being ignored.';
      }
      if (!sample.advanced) return `axis-rotate's animation did not advance over ${sample.settleMs}ms — it is parked.`;
      return null;
    },
  },
  {
    id: 'image-effect-flips-named',
    why: 'Flips must run BOTH override animations (sc-effect-turn + sc-effect-hop), not the base fallbacks.',
    module: { type: 'image', settings: { ...PICTURE, effect: 'flips', effectRotationRate: '30', effectBounceHeight: '150' } },
    selector: 'figure.builder-preview-image',
    expect(sample) {
      const names = sample.animations.map((a) => a.name);
      for (const required of ['sc-effect-turn', 'sc-effect-hop']) {
        if (!names.includes(required)) {
          return `flips is not running \`${required}\` (found: ${names.join(', ') || 'none'}). ` +
            'A missing override name means flips degraded to a settings-ignoring fallback.';
        }
      }
      if (!sample.advanced) return `flips' animations did not advance over ${sample.settleMs}ms — parked.`;
      return null;
    },
  },
  {
    id: 'image-effect-parkour-named',
    why:
      'Parkour must run BOTH override animations (sc-effect-travel for the crossing + sc-effect-tumble ' +
      'for the two-axis rotation). The base file still carries `normie-parkour`, a single fixed-duration ' +
      '8s keyframe that ignores Speed, Rotation Rate, Frequency and Bounce Height alike — and it is bound ' +
      'to `.starcaster-effect-parkour`, which is exactly why the emitted class is `-parkour-motion`. If ' +
      'that dodge is ever undone, a normie-parkour name shows up here and this contract fails.',
    module: {
      type: 'image',
      settings: {
        ...PICTURE,
        effect: 'parkour',
        effectSpeed: '8',
        effectRotationRate: '30',
        effectFrequency: '4',
        effectBounceHeight: '150',
      },
    },
    selector: 'figure.builder-preview-image',
    expect(sample) {
      const names = sample.animations.map((a) => a.name);
      for (const required of ['sc-effect-travel', 'sc-effect-tumble']) {
        if (!names.includes(required)) {
          return `parkour is not running \`${required}\` (found: ${names.join(', ') || 'none'}). ` +
            'A normie-parkour name here means the class dodge or the override rule broke, and every ' +
            'setting on the panel is being ignored.';
        }
      }
      if (!sample.advanced) return `parkour's animations did not advance over ${sample.settleMs}ms — parked.`;
      return null;
    },
  },

  {
    id: 'image-never-renders-larger-than-its-file',
    why:
      'The never-upscale cap first shipped as `max-width: min(100%, max-content)`. Intrinsic keywords ' +
      'are not allowed inside min(), so the browser threw the whole declaration away and the computed ' +
      'value was `none` — a cap that looked right in the diff, in review and in the source, and did ' +
      'nothing. Caught only by reading getComputedStyle in a real browser.',
    module: { type: 'image', settings: { ...PICTURE } },
    selector: 'figure.builder-preview-image',
    read: ['maxWidth'],
    expect(sample) {
      if (sample.styles.maxWidth === 'none') {
        return 'the picture frame computes `max-width: none`, so a small file will be blown up and go ' +
          'soft. The cap is being dropped by the browser — read the declaration back rather than ' +
          'trusting how it reads in the source.';
      }
      return null;
    },
  },

  {
    id: 'repeat-once-does-not-stop-the-spin',
    why:
      'Repeat = Once could not be `animation-iteration-count: 1`: the figure runs TWO animations, so a ' +
      'single keyword would stop the spin after one turn and the ball would slide the remaining seven ' +
      'seconds of an eight-second crossing without turning. Each animation is counted separately.',
    module: {
      type: 'image',
      settings: { ...PICTURE, effect: 'tumbleweed', effectSpeed: '8', effectRotationRate: '30', effectRepeat: 'once' },
    },
    selector: 'figure.builder-preview-image',
    read: ['animationIterationCount'],
    expect(sample) {
      const counts = sample.styles.animationIterationCount.split(',').map((s) => s.trim());
      if (counts.length < 2) {
        return `animation-iteration-count is "${counts.join(', ')}" — one value for two animations. ` +
          'Whatever it says applies to the spin as well as the travel, which is the bug.';
      }
      const [travel, turn] = counts;
      if (travel !== '1') return `the crossing should happen once, but its iteration count is "${travel}".`;
      // 30 turns/min is a 2s turn; an 8s crossing fits four of them. If this
      // ever reads 1, the spin has been stopped along with the travel.
      if (Number(turn) < 2) {
        return `the spin is counted "${turn}" — it stops with the crossing instead of turning ` +
          'all the way across. Expected roughly 4 turns for an 8s crossing at 30 turns/min.';
      }
      return null;
    },
  },

  {
    id: 'heading-renders-its-text',
    why:
      'The floor of the whole harness: if a plain module stops rendering, every assertion above passes ' +
      'on nothing. Cheap, and it fails loudly if the preview surface itself breaks.',
    module: { type: 'heading', text: 'Contract Heading', settings: {} },
    selector: '.builder-preview-heading',
    expect(sample) {
      if (!sample.text.includes('Contract Heading')) {
        return `the heading rendered but its text is "${sample.text.slice(0, 40)}" — the content did not arrive.`;
      }
      return null;
    },
  },

  {
    id: 'gradient-background-still-runs-at-135-degrees-by-default',
    why:
      'THE SAFETY HALF OF THE ANGLE SETTING, and the one worth measuring. Every gradient in the ' +
      'Builder ran at a hardcoded 135deg — sections, pages, buttons, modules and the overlay screen, ' +
      'all off one line. Making that a setting means every stored background in production is now ' +
      'reading a field it has never carried, and getting the fallback wrong repaints live tenant ' +
      'sites at a different angle with nothing failing and nobody told.',
    section: {
      layout: 'single',
      background: { mode: 'gradient', color: '#ff0000', color2: '#0000ff' },
      modules: [{ type: 'heading', text: 'Gradient at the default angle', settings: {} }],
    },
    selector: '.builder-preview-section-layout-single',
    read: ['backgroundImage'],
    expect(sample) {
      if (!/\b135deg\b/.test(sample.styles.backgroundImage || '')) {
        return `a gradient with no saved angle painted \`${sample.styles.backgroundImage || 'nothing'}\` — ` +
          'it is not 135deg, so every existing page with a gradient has just changed direction.';
      }
      return null;
    },
  },

  {
    id: 'gradient-background-honours-a-saved-angle',
    why:
      'The feature half. A setting that reaches the type, the normalizer and the panel and then does ' +
      'not reach the CSS is the failure this repo keeps meeting — a class name is not a rendering ' +
      '(docs/IMAGE_EFFECTS.md), and two image effects shipped for months that way. This is the only ' +
      'assertion here that reads what the browser actually painted.',
    section: {
      layout: 'single',
      background: { mode: 'gradient', color: '#ff0000', color2: '#0000ff', gradientAngle: 90 },
      modules: [{ type: 'heading', text: 'Gradient at 90 degrees', settings: {} }],
    },
    selector: '.builder-preview-section-layout-single',
    read: ['backgroundImage'],
    expect(sample) {
      const painted = sample.styles.backgroundImage || '';
      if (/\b135deg\b/.test(painted)) {
        return 'a gradient saved at 90deg still painted 135deg — the angle reaches the panel and the ' +
          'stored settings but never the CSS, which is a control that looks like it works.';
      }
      if (!/\b90deg\b/.test(painted)) {
        return `a gradient saved at 90deg painted \`${painted || 'nothing'}\` — neither the saved angle ` +
          'nor the default, so the value is being mangled on the way through.';
      }
      return null;
    },
  },

  {
    id: 'video-background-renders-a-real-video',
    why:
      'Video is the one background mode that is not CSS. Every other mode is a property on the ' +
      'section; this one is an ELEMENT behind the section, and `getBuilderBackgroundStyle` returns ' +
      'the poster for it deliberately. So a video background that quietly renders nothing looks ' +
      'exactly like one working correctly with a slow clip — a still picture and no error at all.',
    section: { ...VIDEO_SECTION },
    selector: 'video[data-builder-video-background="section"]',
    read: ['objectFit', 'position', 'zIndex'],
    expect(sample) {
      if (sample.styles.objectFit !== 'cover') {
        return `the video background is \`object-fit: ${sample.styles.objectFit || 'none'}\`, not cover — ` +
          'it would letterbox or stretch instead of filling the row.';
      }
      if (sample.styles.position !== 'absolute') {
        return `the video background is \`position: ${sample.styles.position}\` — it is in the row's flow ` +
          'rather than behind it, so it would push the content down the page.';
      }
      return null;
    },
  },

  {
    id: 'video-background-is-clipped-without-clipping-the-row',
    why:
      'A blurred video is scaled up so its soft rim falls outside the row, and a parallaxing image ' +
      'layer is taller than the row by the whole travel distance, so both have to be contained or ' +
      'they spill onto the rows above and below. The row carried that containment itself until ' +
      '2026-09-14 — and clipped everything else inside it in the same stroke, which is the row half ' +
      'of 86bbwmp2y: a navigation dropdown in a video row was cut off at the row\'s edge. Two ' +
      'readings in one contract on purpose, because each alone passes on the other\'s bug: a row ' +
      'left `overflow: visible` with no clip box leaks the footage, and a row clipped by itself ' +
      'holds the footage while cutting the menu.',
    section: { ...VIDEO_SECTION },
    selector: '[data-builder-background-clip="section"]',
    read: ['overflow', 'position'],
    expect(sample) {
      if (sample.styles.overflow !== 'hidden') {
        return `the row's clip box is \`overflow: ${sample.styles.overflow || 'visible'}\` — a blurred ` +
          'or drifting layer inside it is free to spill over the rows above and below.';
      }
      if (sample.styles.position !== 'absolute') {
        return `the clip box is \`position: ${sample.styles.position}\`, not absolute — it is in the ` +
          "row's flow rather than laid over it, so it no longer matches the row's bounds.";
      }
      return null;
    },
  },

  {
    id: 'video-background-leaves-the-row-itself-uncontained',
    why:
      'The other half of the pair above, and the row half of 86bbwmp2y. `overflow: hidden` on the ' +
      'ROW cannot tell footage escaping from a dropdown menu that is supposed to escape, so it cut ' +
      'both. This is the reading that fails if the containment ever moves back onto the row — which ' +
      'would look completely correct in every other video contract here.',
    section: { ...VIDEO_SECTION },
    selector: '.builder-preview-section-layered',
    read: ['overflow', 'position'],
    expect(sample) {
      if (sample.styles.overflow === 'hidden') {
        return 'the row carrying the video is `overflow: hidden` — anything inside it that is meant ' +
          'to reach out of the row, a navigation dropdown above all, is cut off at its edge.';
      }
      if (sample.styles.position === 'static') {
        return 'the row is `position: static`, so the clip box and the layer inside it size ' +
          'themselves against the page rather than against the row.';
      }
      return null;
    },
  },

  {
    id: 'video-background-sits-behind-the-content',
    why:
      'The columns are grid children and the video is absolutely positioned, so without a stacking ' +
      'context of their own the columns paint UNDERNEATH the footage. The row then reads as having ' +
      'gone blank, which looks like the text being lost rather than a z-index being wrong.',
    section: { ...VIDEO_SECTION },
    selector: '.builder-preview-section-layered > .builder-preview-column',
    read: ['position', 'zIndex'],
    expect(sample) {
      if (sample.styles.position === 'static') {
        return 'the column is `position: static`, so its z-index does nothing and the video paints over the text.';
      }
      const zIndex = Number(sample.styles.zIndex);
      if (!Number.isFinite(zIndex) || zIndex < 2) {
        return `the column sits at z-index ${sample.styles.zIndex || 'auto'}, which is not above the video (0) ` +
          'and the tint screen (1) — the row\'s own content would be hidden behind its background.';
      }
      return null;
    },
  },

  /*
   * ── THE CELL'S OWN VIDEO ──────────────────────────────────────────────
   *
   * The same shared layer as the row's, mounted on a smaller surface, so
   * these deliberately mirror the row contracts above rather than inventing
   * new questions. What is genuinely new is the CLIPPING one: a row's layer
   * has nothing beside it to spill onto, and a cell's has the next column.
   */
  {
    id: 'cell-video-background-renders-a-real-video',
    why:
      'Video is the one background mode that is not an element-free CSS property, and the cell ' +
      'paints the POSTER as its own background either way. So a cell whose layer never mounts looks ' +
      'exactly like one working correctly with a slow clip — a still picture, no error, nothing to ' +
      'see. This is the contract that tells those two apart.',
    section: { ...CELL_VIDEO_SECTION },
    selector: 'video[data-builder-video-background="cell"]',
    read: ['objectFit', 'position'],
    expect(sample) {
      if (sample.styles.objectFit !== 'cover') {
        return `the cell video is \`object-fit: ${sample.styles.objectFit || 'none'}\`, not cover — ` +
          'it would letterbox or stretch instead of filling the cell.';
      }
      if (sample.styles.position !== 'absolute') {
        return `the cell video is \`position: ${sample.styles.position}\` — it is in the cell's flow ` +
          'rather than behind it, so it would push the column\'s content down.';
      }
      return null;
    },
  },

  {
    id: 'cell-video-background-is-clipped-to-its-own-cell',
    why:
      'THE reason this is a per-cell feature and not a per-row one. The layer is scaled to cover, so ' +
      'left uncontained the footage spills sideways over the column beside it — one cell\'s ' +
      'background silently painting over its neighbour\'s words. It is invisible to every other ' +
      'check here: the video renders, the poster is right, the z-index is right, and the row still ' +
      'looks like a row. ' +
      'The containment moved on 2026-09-14 (86bbwmp2y): it used to be `overflow: hidden` on the ' +
      'COLUMN, which clipped everything else in the column too — a navigation dropdown was cut off ' +
      'at the column edge and read as a menu that would not open. So it is now a clip box around ' +
      'the layer alone, and this contract follows it there rather than being deleted with it.',
    section: { ...CELL_VIDEO_SECTION },
    selector: '[data-builder-background-clip="cell"]',
    read: ['overflow', 'position'],
    expect(sample) {
      if (sample.styles.overflow !== 'hidden') {
        return `the cell's clip box is \`overflow: ${sample.styles.overflow || 'visible'}\` — the ` +
          'footage inside it is free to bleed across the gap into the next column.';
      }
      if (sample.styles.position !== 'absolute') {
        return `the clip box is \`position: ${sample.styles.position}\`, not absolute — it is in the ` +
          "column's flow rather than laid over it, so it pushes the operator's content down and no " +
          'longer matches the cell\'s bounds.';
      }
      return null;
    },
  },

  {
    id: 'cell-video-background-leaves-the-cell-itself-uncontained',
    why:
      'THE BUG THIS PAIR WAS SPLIT FOR (86bbwmp2y). Containing the footage by clipping the CELL ' +
      'contains everything else in the cell as well, and `overflow: hidden` cannot tell footage ' +
      'escaping from a navigation dropdown that is SUPPOSED to escape. To a visitor the menu reads ' +
      'as one that will not open: they tap it and nothing appears. The contract above proves the ' +
      'footage is still held; this one proves it is held by the box and not by the column.',
    section: { ...CELL_VIDEO_SECTION },
    selector: '.builder-preview-column-layered',
    read: ['overflow', 'position'],
    expect(sample) {
      if (sample.styles.overflow === 'hidden') {
        return 'the cell carrying the video is `overflow: hidden` — the containment is back on the ' +
          'column, so a dropdown menu, a floating image or any other thing meant to reach out of ' +
          'that column is cut off at its edge.';
      }
      if (sample.styles.position === 'static') {
        return 'the cell is `position: static`, so the clip box and the video inside it escape the ' +
          'column entirely and size themselves against the row (or the page) instead.';
      }
      return null;
    },
  },

  {
    id: 'cell-video-background-lets-overhanging-decor-out-of-the-cell',
    why:
      'THE CONTRACT NO STYLE READING COULD HAVE REPLACED, and the one that actually reproduces ' +
      '86bbwmp2y. `overflow: hidden` on an ancestor does not change a descendant\'s rect at all — ' +
      'the clipped element still measures exactly where it always was — so every box reading in ' +
      'this scene is identical whether the dropdown is visible or cut in half. What changes is ' +
      'whether the browser can HIT it out there. So this hangs a floating image out of a ' +
      'video-backed cell and asks what is on top where it crosses into the next column: the image ' +
      'when the containment sits on the layer, the next column when it sits on the cell. ' +
      'A floating image rather than a navigation dropdown because it overhangs on load with no ' +
      'interaction — the clipping is identical, and a scene that needs a hover is a scene that can ' +
      'quietly stop opening.',
    section: {
      layout: 'two-column',
      cellBackgrounds: {
        left: {
          mode: 'video',
          videoUrl: '/images/render-fixture-background.mp4',
          posterUrl: '/images/render-fixture-background-poster.jpg',
          videoSpeed: 1,
          videoLoop: true,
        },
        // Something solid for the probe to hit when the decor loses, so the
        // failure is visible to a person in a screenshot and not only here.
        right: { mode: 'color', color: '#cc0000' },
      },
      modules: [
        // `horizontalOffset: 200` is what carries the image across the gutter
        // at this harness's viewport; `trigger: on-load` keeps it out of the
        // inline-z-index path. Both match the overlay contract this is modelled
        // on, so the two scenes stay comparable.
        {
          type: 'floating-image',
          column: 'left',
          settings: { ...PICTURE, size: '60', trigger: 'on-load', horizontalOffset: '200' },
        },
        { type: 'text', column: 'left', text: '<p>Readable</p>', settings: {} },
        { type: 'text', column: 'right', text: '<p>Untouched</p>', settings: {} },
      ],
    },
    selector: '.builder-preview-column-layered',
    read: ['overflow'],
    probes: {
      overhang: {
        subject: '.builder-preview-module-overlay-flow .builder-preview-image-shell',
        against: '.builder-preview-column:not(.builder-preview-column-layered)',
      },
    },
    expect(sample) {
      const probe = sample.probes?.overhang;
      if (!probe) {
        return 'no probe was taken — the contract measured nothing, which cannot verify anything.';
      }
      if (probe.missing) {
        return `the probe could not find \`${probe.missing}\` on the page, so the elements this ` +
          'contract compares were never both rendered, and it can no longer fail for the right reason.';
      }
      /*
       * THE UNFALSIFIABILITY GUARD, first rather than last. Clipping does not
       * move the image's rect, so the overlap is positive in BOTH the working
       * and the broken scene — but if the image ever stops crossing the gutter
       * at all, the probe point lands where neither element is and a green run
       * here would mean nothing.
       */
      if (!(probe.overlap > 0)) {
        return 'the floating image does not overhang into the next column at all in this scene ' +
          `(image ${probe.subjectBox.left}-${probe.subjectBox.right}, next column starts at ` +
          `${probe.againstBox.left}), so there is no overlap to probe. Push \`horizontalOffset\` ` +
          'until it crosses the gutter again — a scene that does not overlap passes forever while ' +
          'testing nothing.';
      }
      if (!probe.onSubject) {
        return `where the floating image hangs out of the video cell, the browser reports \`` +
          `${probe.hit}\` on top at ${probe.point.x},${probe.point.y} rather than the image — the ` +
          'part of it outside the column is not there to be hit. That is the cell clipping its own ' +
          'contents to contain the footage, which is 86bbwmp2y: on a real page the same clip takes ' +
          "the bottom off a navigation module's dropdown and a visitor reads the menu as broken.";
      }
      return null;
    },
  },

  {
    id: 'cell-video-background-stays-behind-the-words',
    why:
      'The video is absolutely positioned inside the cell and the modules are ordinary in-flow ' +
      'siblings, so without the content rung the footage paints OVER the operator\'s text. That is ' +
      'the one outcome a background must never produce, and it is the same failure the cell tint ' +
      'screen already guards — this one arrives through a different element.',
    section: { ...CELL_VIDEO_SECTION },
    selector: '.builder-preview-column-layered > .builder-preview-module',
    read: ['position', 'zIndex'],
    expect(sample) {
      if (sample.styles.position === 'static') {
        return 'the module is `position: static`, so its z-index does nothing and the video paints over it.';
      }
      const zIndex = Number(sample.styles.zIndex);
      if (!Number.isFinite(zIndex) || zIndex < 1) {
        return `the module sits at z-index ${sample.styles.zIndex || 'auto'}, which is not above the cell ` +
          'video layer (0) — the words in that column would be behind the footage.';
      }
      return null;
    },
  },

  {
    id: 'cell-video-background-leaves-the-next-column-without-a-video',
    why:
      'The control for every contract above, and they need one badly: a cell background that mounted ' +
      'its layer for EVERY column would satisfy all of them and still be flatly wrong — the operator ' +
      'asked ONE column for footage, not the row. The neighbour was given no background at all, so a ' +
      'video inside it can only have come from the mount condition being blind to which cell it is on.',
    section: { ...CELL_VIDEO_SECTION },
    selector:
      '.builder-preview-column + .builder-preview-column video[data-builder-video-background="cell"]',
    absent: true,
  },

  {
    id: 'cell-video-background-clip-box-takes-no-clicks-and-stays-at-rung-zero',
    why:
      'THE TWO PROPERTIES THE CLIP BOX TOOK OVER FROM THE LAYER, and nothing else here holds them. ' +
      'Until 86bbwmp2y the video was a direct child of the cell and `.builder-preview-video-background` ' +
      'gave it `pointer-events: none` and `z-index: 0`. The box is now the element the cell\'s siblings ' +
      'actually see, and it gets both from `builderBackgroundClipStyle()` inline instead — so a rung ' +
      'or a hit-test that used to be the stylesheet\'s business is now a function\'s. ' +
      'Both fail silently and expensively. Lose `pointer-events: none` and this full-size element ' +
      'laid over the column swallows every click in it — the operator\'s links and buttons stop ' +
      'working in any column with a video behind it, while the page still looks perfect. Move the ' +
      'rung off 0 and the box paints OVER the modules: `cell-video-background-stays-behind-the-words` ' +
      'only checks that a module is at 1 or more, so a box at 2 passes that contract with the footage ' +
      'covering the text. ' +
      'This contract replaces `cell-video-background-does-not-clip-a-cell-that-has-no-video`, which ' +
      'read `overflow` on the neighbouring column: that PR deleted the only code that could ever set ' +
      'it, so nothing in its scene could make it fail, and its own reason described a conditional ' +
      'mount that no longer exists. The half worth keeping — the cell is not clipped — is asserted ' +
      'directly by `cell-video-background-leaves-the-cell-itself-uncontained`, on the cell that ' +
      'actually carries the video rather than on its neighbour. ' +
      'It reads computed style rather than probing, and that is forced rather than lazy: ' +
      '`elementFromPoint` skips anything with `pointer-events: none`, so a probe can never see this ' +
      'box at all while the property is correct. One contract covers the row\'s box too — both ' +
      'surfaces spread the SAME function, so there is one set of values to be wrong.',
    section: { ...CELL_VIDEO_SECTION },
    selector: '[data-builder-background-clip="cell"]',
    read: ['pointerEvents', 'zIndex'],
    expect(sample) {
      if (sample.styles.pointerEvents !== 'none') {
        return `the clip box is \`pointer-events: ${sample.styles.pointerEvents}\`, not \`none\` — it is a ` +
          'full-size element laid over the whole column, so it takes every click meant for the links, ' +
          'buttons and modules inside that column and the page reads as dead while looking correct.';
      }
      const zIndex = Number(sample.styles.zIndex);
      if (!Number.isFinite(zIndex)) {
        return `the clip box sits at z-index \`${sample.styles.zIndex || 'auto'}\` rather than an explicit ` +
          '0 — with no rung of its own it stacks in document order against the cell\'s tint screen and ' +
          "the cell's modules, both of which were measured against the box being at 0.";
      }
      if (zIndex !== 0) {
        return `the clip box sits at z-index ${zIndex}, not 0 — the modules in that cell are only lifted to ` +
          '1, so the footage inside this box now paints over the operator\'s words. ' +
          '`cell-video-background-stays-behind-the-words` cannot catch this: it checks the module is at ' +
          '1 or more and never reads the box.';
      }
      return null;
    },
  },

  /*
   * ── A LAYER THAT RENDERS NOTHING MUST ADD NOTHING ─────────────────────
   *
   * The clip box was mounted by the row and the cell at first, from the
   * SETTINGS. The layer itself renders nothing at phone width and nothing
   * under reduce motion, so a phone visitor got an EMPTY box as the row's
   * first child — and the row is a grid whose mobile reverse-stack rules count
   * children: `:nth-child(1..6)`, stopping at six. One extra child pushed the
   * sixth column out of the last rule, it fell back to `order: 0`, and the
   * columns came out 5,4,3,6,2,1 on a live page with nothing to see wrong
   * (86bbwmp2y, review round 2).
   *
   * Every contract above this sweeps at 1440px, where the video always mounts,
   * so not one of them could see the state where the box was empty. These
   * three ask at the two widths and settings where the layer bows out.
   */
  {
    id: 'video-background-puts-the-columns-in-order-on-a-phone',
    why:
      'THE VISIBLE HALF OF THE REGRESSION, measured as a visitor would meet it rather than as an ' +
      'element count. A six-column row set to Reverse stack must come out 6,5,4,3,2,1 on a phone, ' +
      'and the rules that do that are `:nth-child(1..6)` — they stop at six, so ANY extra child in ' +
      'the row silently drops the last column to `order: 0` and shows it fourth. The empty clip box ' +
      'did exactly that. This reads the order the browser actually resolved on the last column, so ' +
      'it fails for any cause — a second layer, a stray marker, a wrapper somebody adds next year — ' +
      'rather than only for the one that happened.',
    section: {
      layout: 'six-column',
      mobileLayout: 'reverse-stack',
      background: { ...VIDEO_SECTION.background },
      modules: [
        { type: 'heading', text: 'One', settings: {}, column: 'left' },
        { type: 'heading', text: 'Two', settings: {}, column: 'center' },
        { type: 'heading', text: 'Three', settings: {}, column: 'right' },
        { type: 'heading', text: 'Four', settings: {}, column: 'col4' },
        { type: 'heading', text: 'Five', settings: {}, column: 'col5' },
        { type: 'heading', text: 'Six', settings: {}, column: 'col6' },
      ],
    },
    selector: '.builder-preview-section-layered > .builder-preview-column:last-child',
    read: ['order'],
    emulate: { viewport: { width: 420, height: 900 } },
    expect(sample) {
      const order = Number(sample.styles.order);
      if (order === 0) {
        return 'the last column of a six-column Reverse stack row resolved `order: 0`, which is the ' +
          'initial value and not any of the six rules — so the row has an extra child and every ' +
          'column is one rule out of step. The sixth column is shown FOURTH. This is what an empty ' +
          'clip box did on a phone; whatever added a child here, it reaches visitors.';
      }
      if (order !== -2) {
        return `the last column of a six-column Reverse stack row resolved \`order: ${sample.styles.order}\`, ` +
          'not -2 — the reverse-stack rules are not landing on the columns they were written for.';
      }
      return null;
    },
  },

  {
    id: 'video-background-mounts-no-clip-box-on-a-phone',
    why:
      'The mechanism behind the contract above, asked directly so a failure says WHICH extra child. ' +
      'A row video does not play on a phone (the megabytes are somebody else\'s cell data) and the ' +
      'layer returns null — so the clip box must not go up either. A box around nothing is still a ' +
      'child, and the row counts its children.',
    section: { ...VIDEO_SECTION },
    selector: '[data-builder-background-clip="section"]',
    emulate: { viewport: { width: 420, height: 900 } },
    absent: true,
  },

  {
    id: 'video-background-mounts-no-clip-box-under-reduce-motion',
    why:
      'The same rule at the other place the layer bows out. A visitor who asked for reduced motion ' +
      'gets the poster and no <video> at all, so an empty clip box would be an extra child in their ' +
      'row and nobody else\'s — a layout that differs by an accessibility setting, which is the ' +
      'hardest kind of bug to be told about.',
    section: { ...VIDEO_SECTION },
    selector: '[data-builder-background-clip="section"]',
    emulate: { reducedMotion: 'reduce' },
    absent: true,
  },

  {
    id: 'cell-video-background-mounts-no-clip-box-on-a-phone',
    why:
      'The cell half. A column\'s children are read too — `_builder-react.css` keys a rule off ' +
      '`> .builder-preview-module:nth-child(2)` to mean "this column has a second module" — so an ' +
      'empty box in front of a single module satisfies a rule written about two. That one is scoped ' +
      'to an embed and harms nothing today, which makes it evidence rather than a bug: the shift ' +
      'has more than one reader, and the way to be safe is to add no element at all.',
    section: { ...CELL_VIDEO_SECTION },
    selector: '[data-builder-background-clip="cell"]',
    emulate: { viewport: { width: 420, height: 900 } },
    absent: true,
  },

  {
    id: 'row-overlay-screen-only-leaves-the-row-uncontained',
    why:
      'A row carrying ONLY a tint screen — no video, no parallax — used to be clipped by the same ' +
      '`overflow: hidden` the video rows had, and 86bbwmp2y removed it from both. Nothing took over ' +
      'for the tint row and nothing needs to: `.builder-preview-row-overlay-screen` is `inset: 0` ' +
      'with `border-radius: inherit`, so it is already exactly the row\'s shape and has nothing to ' +
      'overflow with. Letting the row\'s CONTENT out is the fix rather than a side effect — a ' +
      'dropdown in a tinted row was cut off for the same reason it was in a video one. This is the ' +
      'contract that was missing when that behaviour changed, so it changed silently (review round 2).',
    section: {
      layout: 'two-column',
      overlayScreen: { background: { mode: 'color', color: '#101820' }, opacity: 50 },
      modules: [
        { type: 'heading', text: 'Text under a tint', settings: {}, column: 'left' },
        { type: 'heading', text: 'Plain neighbour', settings: {}, column: 'right' },
      ],
    },
    selector: '.builder-preview-section-layered',
    read: ['overflow', 'position'],
    expect(sample) {
      if (sample.styles.overflow === 'hidden') {
        return 'a row carrying only a tint screen is `overflow: hidden` — a navigation dropdown in ' +
          'it is cut off at the row\'s edge, which is 86bbwmp2y arriving through the overlay ' +
          'setting instead of through a video.';
      }
      if (sample.styles.position === 'static') {
        return 'the row is `position: static`, so its tint screen sizes itself against the page ' +
          'rather than against the row and the tint lands over the whole document.';
      }
      return null;
    },
  },

  {
    id: 'cell-video-background-lets-a-dropdown-menu-out-of-the-cell',
    why:
      'THE SCENE 86bbwmp2y WAS REPORTED AS, measured rather than reasoned about. A navigation ' +
      "module's dropdown is supposed to hang below its column; with a video behind that column it " +
      'was cut off at the column edge, and what a visitor saw was a menu that would not open — they ' +
      'tap it and a few pixels of white appear. Measured by hand in a browser before the fix: the ' +
      'menu ran from y=89 to y=255 and the cell ended at y=98, so all three items were inside the ' +
      'clip. THE RECT NEVER MOVED — clipping does not change a clipped element\'s geometry — which ' +
      'is why this asks what the browser reports on top over the section below rather than reading ' +
      'a box or a style. The sibling contract on floating decor covers the same mechanism without a ' +
      'hover; this one covers the module the operator actually reported.',
    section: {
      layout: 'two-column',
      // A section below for the menu to hang over, and the thing the probe
      // compares against. Without it the overhang has nothing underneath it and
      // there is no intersection to ask about.
      spacers: 1,
      cellBackgrounds: {
        left: {
          mode: 'video',
          videoUrl: '/images/render-fixture-background.mp4',
          posterUrl: '/images/render-fixture-background-poster.jpg',
          videoSpeed: 1,
          videoLoop: true,
        },
      },
      modules: [
        {
          type: 'navigation',
          column: 'left',
          settings: {
            navItems: JSON.stringify([
              { id: 'play', label: 'Programs', href: '/programs' },
              { id: 'p1', label: 'Junior tennis', href: '/junior', parentId: 'play' },
              { id: 'p2', label: 'Adult clinics', href: '/adult', parentId: 'play' },
              { id: 'p3', label: 'Private lessons', href: '/private', parentId: 'play' },
            ]),
          },
        },
        { type: 'text', column: 'right', text: '<p>Next column</p>', settings: {} },
      ],
    },
    hover: '.site-nav-dropdown > .site-nav-dropdown-trigger',
    selector: '.site-nav-dropdown-menu',
    read: ['overflow'],
    probes: {
      overhang: {
        subject: '.site-nav-dropdown-menu',
        against: '.builder-preview-section:has(.builder-preview-column-layered) ~ .builder-preview-section',
      },
    },
    expect(sample) {
      const probe = sample.probes?.overhang;
      if (!probe) {
        return 'no probe was taken — the contract measured nothing, which cannot verify anything.';
      }
      if (probe.missing) {
        return `the probe could not find \`${probe.missing}\` on the page. Either the dropdown never ` +
          'opened on hover, or there is no section below the row for it to hang over — and with ' +
          'neither of those on the page this contract can no longer fail for the right reason.';
      }
      /*
       * THE UNFALSIFIABILITY GUARD, first rather than last. The menu's rect is
       * identical whether it is clipped or not, so this is the only thing that
       * distinguishes "the menu hangs past the row and we are asking about the
       * overhang" from "the menu now fits inside the row and the probe point
       * landed nowhere in particular".
       */
      if (!(probe.overlap > 0)) {
        return 'the open dropdown does not hang past the bottom of its row at all in this scene, so ' +
          'there is no overhang to probe and this contract cannot say anything. Give the menu more ' +
          'items, or a shorter row — a scene with no overhang passes forever while testing nothing.';
      }
      if (!probe.onSubject) {
        return `where the open dropdown hangs below the video cell, the browser reports \`` +
          `${probe.hit}\` on top at ${probe.point.x},${probe.point.y} rather than the menu — the ` +
          'part of the menu outside its column is not there to be hit. That is the cell clipping ' +
          'its own contents in order to contain the footage (86bbwmp2y). To a visitor the menu ' +
          'opens as a sliver of white and then nothing: it reads as broken.';
      }
      return null;
    },
  },

  {
    id: 'cell-video-background-honours-reduce-motion',
    why:
      'Reduce Motion is turned on for migraines and motion sickness, and it has to hold per CELL as ' +
      'well as per row — a setting honoured on one surface and quietly dropped on the next is worse ' +
      'than one that was never offered. The poster underneath is already painted, so this costs the ' +
      'look nothing.',
    section: { ...CELL_VIDEO_SECTION },
    selector: 'video[data-builder-video-background="cell"]',
    emulate: { reducedMotion: 'reduce' },
    absent: true,
  },

  {
    id: 'cell-video-background-falls-back-to-the-poster-on-phones',
    why:
      'A background video is megabytes of someone else\'s cell data spent on decoration, and a row of ' +
      'video cells multiplies that by the column count. The phone fallback has to hold per cell for ' +
      'the same reason it holds per row, and it fails silently: nobody testing on a desktop can see ' +
      'that phones are being charged for the clips.',
    section: { ...CELL_VIDEO_SECTION },
    selector: 'video[data-builder-video-background="cell"]',
    emulate: { viewport: { width: 420, height: 900 } },
    absent: true,
  },

  {
    id: 'page-video-background-is-fixed-to-the-window',
    why:
      'A PAGE video is the same element as a row video and differs by exactly one CSS declaration: ' +
      '`position: fixed`, which is what makes the clip fill the window while the sections scroll ' +
      'over it. Lose that declaration and it becomes an absolutely-positioned layer inside a shell ' +
      'as tall as the whole page — the clip stretches to the full document height and scrolls away ' +
      'with the content, which reads as a badly-cropped picture rather than as a broken setting. ' +
      'Nothing else can see it: the element is present, playing, and in the right place at the top ' +
      'of the page, so every static check and every screenshot of the first fold agrees it is fine.',
    section: { ...VIDEO_PAGE },
    selector: 'video[data-builder-video-background="page"]',
    read: ['objectFit', 'position', 'zIndex'],
    expect(sample) {
      if (sample.styles.position !== 'fixed') {
        return `the page video background is \`position: ${sample.styles.position}\`, not fixed — it would ` +
          'scroll away with the page instead of staying in the window behind it.';
      }
      if (sample.styles.objectFit !== 'cover') {
        return `the page video background is \`object-fit: ${sample.styles.objectFit || 'none'}\`, not cover — ` +
          'it would letterbox or stretch instead of filling the window.';
      }
      return null;
    },
  },

  {
    id: 'page-video-background-sits-behind-the-page',
    why:
      'The whole page has to paint IN FRONT of a full-window element, and the only thing making that ' +
      'true is `.builder-viewport-shell-content` carrying its own stacking context. Without it the ' +
      'clip covers every section on the site — text, navigation, forms — and the page reads as having ' +
      'gone blank rather than as a background being in the wrong layer. It is also the exact failure ' +
      'a fixed layer invites, which is why it is asserted rather than assumed.',
    section: { ...VIDEO_PAGE },
    selector: '.builder-viewport-shell-content',
    read: ['position', 'zIndex'],
    expect(sample) {
      if (sample.styles.position === 'static') {
        return 'the page content is `position: static`, so its z-index does nothing and the video paints over it.';
      }
      const zIndex = Number(sample.styles.zIndex);
      if (!Number.isFinite(zIndex) || zIndex < 1) {
        return `the page content sits at z-index ${sample.styles.zIndex || 'auto'}, which is not above the ` +
          'page video layer (0) — every section on the site would be hidden behind the clip.';
      }
      return null;
    },
  },

  {
    id: 'page-video-background-honours-reduce-motion',
    why:
      'A full-WINDOW looping clip is louder than a full-bleed row, and it is on every screen of the ' +
      'site rather than one band of one page. The fallback is the poster the shell already paints, ' +
      'so honouring this costs nothing — and it is invisible to everyone not affected by it, which ' +
      'is precisely why it needs a check rather than a reviewer.',
    section: { ...VIDEO_PAGE },
    selector: 'video[data-builder-video-background="page"]',
    emulate: { reducedMotion: 'reduce' },
    absent: true,
  },

  {
    id: 'page-video-background-falls-back-to-the-poster-on-phones',
    why:
      'Megabytes of a visitor\'s cell data, spent on decoration, on every page of the site rather ' +
      'than on one row of one page. Same default as a row background and the same silent failure ' +
      'mode: nobody testing on a desktop can see that phones are being charged for the clip.',
    section: { ...VIDEO_PAGE },
    selector: 'video[data-builder-video-background="page"]',
    emulate: { viewport: { width: 420, height: 900 } },
    absent: true,
  },

  {
    id: 'video-background-honours-reduce-motion',
    why:
      'Reduce Motion is a setting people turn on for migraines and motion sickness, and a full-bleed ' +
      'looping video is the loudest thing a page can do. The poster is already painted by the CSS ' +
      'underneath, so honouring this costs nothing but has to actually happen — and it is invisible ' +
      'to every other check, because the page still looks perfectly fine to whoever is not affected.',
    section: { ...VIDEO_SECTION },
    selector: 'video[data-builder-video-background="section"]',
    emulate: { reducedMotion: 'reduce' },
    absent: true,
  },

  {
    id: 'video-background-falls-back-to-the-poster-on-phones',
    why:
      'A background video is megabytes of someone else\'s cell data, spent on decoration. The default ' +
      'is the poster on phone-width screens, and the failure mode is silent everywhere it matters: ' +
      'nobody testing on a desktop can see that phones are being charged for the clip.',
    section: { ...VIDEO_SECTION },
    selector: 'video[data-builder-video-background="section"]',
    emulate: { viewport: { width: 420, height: 900 } },
    absent: true,
  },

  {
    id: 'video-background-plays-on-phones-when-asked',
    why:
      'The phone fallback needs an escape hatch, and an escape hatch nobody verifies is the same as ' +
      'not having one. Pairs with the contract above: together they prove the toggle is what decides, ' +
      'rather than the video simply never rendering at phone width for some other reason.',
    section: {
      ...VIDEO_SECTION,
      background: { ...VIDEO_SECTION.background, videoPlayOnMobile: true },
    },
    selector: 'video[data-builder-video-background="section"]',
    emulate: { viewport: { width: 420, height: 900 } },
    read: ['objectFit'],
    expect(sample) {
      if (sample.styles.objectFit !== 'cover') {
        return `with "play on phones" on, the video rendered but as \`object-fit: ${sample.styles.objectFit}\`.`;
      }
      return null;
    },
  },

  {
    id: 'video-background-crossfade-renders-two-copies',
    why:
      'One video cannot dissolve into itself — seeking back to the start is a single ' +
      'discontinuous jump with nothing to fade into — so the crossfade is TWO elements taking ' +
      'turns. If the second one stops rendering, the setting is still on, the panel still shows ' +
      'a fade length, and the loop quietly goes back to the hard cut the operator asked us to ' +
      'remove. Nothing else would notice.',
    section: {
      ...VIDEO_SECTION,
      background: { ...VIDEO_SECTION.background, videoLoopFade: 0.6 },
    },
    selector: 'video[data-builder-video-role="follow"]',
    read: ['objectFit', 'transitionDuration'],
    expect(sample) {
      if (sample.styles.objectFit !== 'cover') {
        return `the trailing copy is \`object-fit: ${sample.styles.objectFit || 'none'}\`, not cover — ` +
          'it would crop differently from the leading copy and the dissolve would visibly shift.';
      }
      const duration = parseFloat(String(sample.styles.transitionDuration || '0'));
      if (!(duration > 0)) {
        return 'the trailing copy has no opacity transition (transition-duration ' +
          `${sample.styles.transitionDuration || 'none'}) — it would pop in rather than dissolve.`;
      }
      return null;
    },
  },

  {
    id: 'video-background-crossfade-actually-dissolves',
    why:
      'THE CONTRACT ABOVE PASSES ON A DEAD CROSSFADE. Measured, not feared: with the handoff ' +
      'disabled so the opaque copy never swaps, both elements still render, both still carry an ' +
      'opacity transition, and check:render reported 19/19. A transition property is not a ' +
      'transition — the same shape as the image effects that set a class no stylesheet defined ' +
      'and stood still for months. What proves a dissolve is two copies BOTH partly visible at ' +
      'the same instant, which exists only over time, so this watches instead of reading a frame.',
    section: {
      ...VIDEO_SECTION,
      background: {
        ...VIDEO_SECTION.background,
        videoLoopFade: 0.6,
        // A two-second window, so a seam lands inside the sampling run.
        videoTrimStart: 0,
        videoTrimEnd: 2,
      },
    },
    selector: 'video[data-builder-video-role="lead"]',
    series: {
      count: 45,
      everyMs: 100,
      read: ['opacity'],
      selectors: {
        lead: 'video[data-builder-video-role="lead"]',
        follow: 'video[data-builder-video-role="follow"]',
      },
    },
    expect(sample) {
      const frames = sample.series || [];
      if (frames.length < 10) {
        return `only ${frames.length} frame(s) sampled — nothing was watched, so nothing is proven.`;
      }
      const partly = (value) => {
        const o = Number(value);
        return Number.isFinite(o) && o > 0.05 && o < 0.95;
      };
      const dissolving = frames.filter(
        (f) => f.lead && f.follow && partly(f.lead.opacity) && partly(f.follow.opacity)
      );
      if (!dissolving.length) {
        const seen = [...new Set(frames.map((f) => `${f.lead?.opacity ?? '-'}/${f.follow?.opacity ?? '-'}`))];
        return 'the two copies were never both partly visible across ' +
          `${frames.length} frames — the loop is still a hard cut with a transition property on it. ` +
          `Opacity pairs seen: ${seen.slice(0, 8).join(', ')}.`;
      }
      return null;
    },
  },

  {
    id: 'video-background-hard-cut-renders-one-copy',
    why:
      'A fade of 0 is the hard cut, and it has to actually cost one element. Rendering the pair ' +
      'anyway would double the decoding on every background that does not use the dissolve — ' +
      'invisible on a desktop, and exactly the kind of cost that only shows up on somebody ' +
      'else\'s phone.',
    section: {
      ...VIDEO_SECTION,
      background: { ...VIDEO_SECTION.background, videoLoopFade: 0 },
    },
    selector: 'video[data-builder-video-role="follow"]',
    absent: true,
  },

  {
    // Named for what it actually measures. It was
    // `image-parallax-mounts-a-layer-and-overscans-it` until review pointed out
    // that it asserted nothing whatsoever about the overscan and read a zIndex
    // it never looked at — a title claiming coverage that lives one contract
    // down is worse than no title, because it is the reason nobody checks
    // whether the coverage is really there.
    id: 'image-parallax-mounts-a-layer-behind-the-row',
    why:
      'An image background is a CSS background on the section itself, which cannot translate — so ' +
      'parallax needs a real ELEMENT, and this is what proves one is mounted and mounted BEHIND ' +
      'the content rather than in the flow above it. The other half of the job — that the layer is ' +
      'taller than its section by the whole travel distance, which is acceptance criterion 7 — is ' +
      'measured at every scroll position by `image-parallax-never-uncovers-the-band` below.',
    section: { ...PARALLAX_IMAGE_SECTION },
    selector: '.builder-preview-image-background',
    read: ['position', 'backgroundSize'],
    expect(sample) {
      if (sample.styles.position !== 'absolute') {
        return `the parallax layer is \`position: ${sample.styles.position}\` — it is in the row's flow ` +
          'rather than behind it, so it would push the content down the page.';
      }
      /*
       * EVERY layer, not the whole string. The layer paints TWO backgrounds now
       * — the tint it has to carry, in front of the picture — and a browser
       * reports one `background-size` per layer, so the honest reading of
       * "cover" here is `cover, cover`. Splitting is what the assertion always
       * meant, and it is strictly stricter than the old string equality was:
       * `contain`, `auto` or a length still fails, and so does a single layer
       * that stops covering.
       */
      const sizes = String(sample.styles.backgroundSize || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (!sizes.length || !sizes.every((value) => value === 'cover')) {
        return `the parallax layer is \`background-size: ${sample.styles.backgroundSize}\`, and every ` +
          'layer of it has to be cover — otherwise it tiles or letterboxes instead of filling the row.';
      }
      return null;
    },
  },

  {
    id: 'image-parallax-is-absent-until-it-is-asked-for',
    why:
      'OFF BY DEFAULT is the load-bearing half of this feature: every page in production was saved ' +
      'before parallax existed and must render byte-identically. A layer that paints the picture a ' +
      'second time over the section\'s own background would be nearly invisible when it is wrong, ' +
      'which is how it would survive review.',
    section: {
      ...PARALLAX_IMAGE_SECTION,
      background: { ...PARALLAX_IMAGE_SECTION.background, parallax: false },
    },
    selector: '.builder-preview-image-background',
    absent: true,
  },

  {
    id: 'image-parallax-does-not-contain-a-row-it-is-off-for',
    why:
      'THE CONTRACT ABOVE PASSES ON THIS BUG, measured rather than feared: make the section mount a ' +
      'layer for EVERY image background and it still reports clean, because the layer component ' +
      'itself renders null when parallax is off. What actually changes is the ROW — deciding to ' +
      'mount a layer is also deciding to make the row `position: relative` and to lay a full-size ' +
      'clip box over it, and that box takes hit-testing decisions and stacking rungs with it, on ' +
      'pages nobody touched. The absence that matters is the containment, not the element.',
    section: {
      ...PARALLAX_IMAGE_SECTION,
      background: { ...PARALLAX_IMAGE_SECTION.background, parallax: false },
    },
    selector: '.builder-preview-section-layered',
    absent: true,
  },

  {
    id: 'image-parallax-honours-reduce-motion',
    why:
      'Reduce Motion is a setting people turn on for migraines and motion sickness, and a background ' +
      'sliding against the text is exactly the kind of thing it exists for. The picture is already ' +
      'painted by the CSS underneath, so honouring this costs nothing — and it is invisible to every ' +
      'other check, because the page looks perfectly fine to whoever is not affected.',
    section: { ...PARALLAX_IMAGE_SECTION },
    selector: '.builder-preview-image-background',
    emulate: { reducedMotion: 'reduce' },
    absent: true,
  },

  {
    id: 'image-parallax-actually-drifts-slower-than-the-page',
    why:
      'THE ONLY ASSERTION THAT CANNOT PASS ON A DEAD PARALLAX. A transform property is not movement ' +
      '— the crossfade above learned that the hard way, where two elements, both carrying an opacity ' +
      'transition, reported 19/19 with the handoff completely disabled. Parallax does not exist in a ' +
      'frame at all: it IS the difference between two scroll positions. So this scrolls the page and ' +
      'compares how far the background moved against how far the page did. Drifting slower is the ' +
      'whole feature; moving at all is not.',
    section: { ...PARALLAX_IMAGE_SECTION },
    selector: '.builder-preview-image-background',
    series: PARALLAX_SERIES,
    expect(sample) {
      const frames = (sample.series || []).filter((f) => f.layer && f.section);
      if (frames.length < 6) {
        return `only ${frames.length} usable frame(s) — nothing was watched, so nothing is proven.`;
      }

      const first = frames[0];
      const last = frames[frames.length - 1];
      const pageMoved = last.scrollY - first.scrollY;
      if (!(pageMoved > 0)) {
        return 'the page never scrolled, so no parallax could have been observed. The fixture needs ' +
          'spacer sections tall enough to scroll — a green run here would mean nothing.';
      }

      // Both are viewport-relative, so the section's own top falls by exactly
      // what the page scrolled. The layer's must fall by LESS.
      const sectionMoved = first.section.top - last.section.top;
      const layerMoved = first.layer.top - last.layer.top;

      if (!(layerMoved < sectionMoved - 1)) {
        return `over ${pageMoved}px of scrolling the row moved ${Math.round(sectionMoved)}px and its ` +
          `background moved ${Math.round(layerMoved)}px — the background is keeping pace with the page, ` +
          'which is a background, not a parallax.';
      }
      if (!(layerMoved > 0)) {
        return `the background moved ${Math.round(layerMoved)}px against ${Math.round(sectionMoved)}px ` +
          'of row movement — it is pinned to the screen rather than drifting. At the shipped default ' +
          'speed of 0.3 it should move about a third as far as the row.';
      }
      return null;
    },
  },

  {
    id: 'image-parallax-never-uncovers-the-band',
    why:
      'The gap at the top or bottom edge of a parallaxing row is the single most common way this ' +
      'effect ships broken, and it only appears at SOME scroll positions — which is why nobody sees ' +
      'it in the editor and everybody sees it on the live page. The driver guarantees it by ' +
      'construction (the offset is clamped to the overscan) and the unit tests prove the arithmetic; ' +
      'this proves the arithmetic reached the browser.',
    section: { ...PARALLAX_IMAGE_SECTION },
    selector: '.builder-preview-image-background',
    series: PARALLAX_SERIES,
    expect(sample) {
      const frames = (sample.series || []).filter((f) => f.layer && f.section);
      if (frames.length < 6) {
        return `only ${frames.length} usable frame(s) — nothing was watched, so nothing is proven.`;
      }
      for (const frame of frames) {
        // One pixel of slack for sub-pixel rounding, and no more: the bug this
        // catches is tens of pixels of bare band, never one.
        if (frame.layer.top > frame.section.top + 1) {
          return `at scroll ${Math.round(frame.scrollY)} the background's top edge sits ` +
            `${Math.round(frame.layer.top - frame.section.top)}px BELOW the row's — a bare strip across ` +
            'the top of the band. The layer is not tall enough for the distance it travels.';
        }
        const layerBottom = frame.layer.top + frame.layer.height;
        const sectionBottom = frame.section.top + frame.section.height;
        if (layerBottom < sectionBottom - 1) {
          return `at scroll ${Math.round(frame.scrollY)} the background's bottom edge sits ` +
            `${Math.round(sectionBottom - layerBottom)}px ABOVE the row's — a bare strip across the ` +
            'bottom of the band.';
        }
      }
      return null;
    },
  },

  {
    id: 'image-parallax-carries-the-tint-it-covers',
    why:
      'TURNING ON A MOTION SETTING MUST NOT DELETE A THEME\'S PHOTO TINT. The tint is composited onto ' +
      'the section element itself, and an element\'s own background paints BENEATH its positioned ' +
      'descendants — so the parallax layer, which repaints the same photo as a positioned child, ' +
      'covered it with the raw picture while `--lp-inverse-text` kept the text white. Measured in a ' +
      'real browser in review round 3 of #481: mean RGB [166, 11, 17] with parallax off, [44, 53, 63] ' +
      'with it on. On a light photo that is unreadable white text on a live tenant page, and it is not ' +
      'an exotic setup — `heroOverlay` is REQUIRED in the Theme Wizard\'s generator schema, so every ' +
      'wizard-built theme sets one. Every other parallax contract here uses an untinted section, which ' +
      'is precisely why 27/27 was green over this.',
    section: { ...PARALLAX_THEMED_SECTION },
    selector: '.builder-preview-image-background',
    series: {
      // Two frames, no scrolling: what is being read is what the layer PAINTS,
      // which does not depend on scroll position. The drift itself is proven
      // by the two contracts above.
      count: 2,
      everyMs: 30,
      read: ['backgroundImage'],
      selectors: {
        layer: '.builder-preview-image-background',
        section: '.builder-preview-section-layered',
      },
    },
    expect(sample) {
      // One level of nesting by hand: `rgba(...)` carries its own brackets, so
      // a lazy `linear-gradient\([^)]*\)` stops at the first colour's close.
      const tintOf = (value) => {
        const match = /linear-gradient\(\s*(rgba?\([^)]*\))\s*,\s*(rgba?\([^)]*\))\s*\)/.exec(value || '');
        return match ? `${match[1]}, ${match[2]}` : null;
      };

      const frames = (sample.series || []).filter((f) => f.layer && f.section);
      if (!frames.length) {
        return 'neither the layer nor the row could be read, so nothing is proven.';
      }
      const frame = frames[0];

      const sectionTint = tintOf(frame.section.backgroundImage);
      if (!sectionTint) {
        return 'the ROW itself is not wearing a theme tint, so this contract is measuring an untinted ' +
          `page and could not fail. Its background-image is \`${(frame.section.backgroundImage || '').slice(0, 120)}\`. ` +
          'The themed fixture stopped reaching the preview — fix the fixture, never the assertion.';
      }

      const layerTint = tintOf(frame.layer.backgroundImage);
      if (!layerTint) {
        return `the row is tinted \`${sectionTint}\` and the drifting background carries no tint at all ` +
          `(\`${(frame.layer.backgroundImage || '').slice(0, 120)}\`). It paints the bare photo over the ` +
          'tint the row composited, so switching parallax on silently removes the darkening the white ' +
          'text depends on.';
      }
      if (layerTint !== sectionTint) {
        return `the row is tinted \`${sectionTint}\` and the drifting background is tinted ` +
          `\`${layerTint}\`. The moving copy has to be indistinguishable from the still one it covers, ` +
          'or the band changes colour the moment the effect starts.';
      }
      return null;
    },
  },

  {
    id: 'video-parallax-drifts-the-video-layer-too',
    why:
      'One layer, used by image and video alike — that was the instruction on the ticket, because ' +
      'two implementations of "pause when off screen" or "honour reduce motion" drift apart silently ' +
      'and only one of them ever gets fixed. This is what proves there is not a second, dead code ' +
      'path behind the video half of the control: the panel offers parallax on a video background, ' +
      'so a video background has to actually parallax.',
    section: {
      ...VIDEO_SECTION,
      spacers: 2,
      background: { ...VIDEO_SECTION.background, parallax: true, parallaxSpeed: 0.3 },
    },
    selector: 'video[data-builder-video-background="section"]',
    series: {
      ...PARALLAX_SERIES,
      selectors: {
        layer: 'video[data-builder-video-background="section"]',
        section: '.builder-preview-section-layered',
      },
    },
    expect(sample) {
      const frames = (sample.series || []).filter((f) => f.layer && f.section);
      if (frames.length < 6) {
        return `only ${frames.length} usable frame(s) — nothing was watched, so nothing is proven.`;
      }
      const first = frames[0];
      const last = frames[frames.length - 1];
      if (!(last.scrollY > first.scrollY)) {
        return 'the page never scrolled, so no parallax could have been observed.';
      }
      const sectionMoved = first.section.top - last.section.top;
      const layerMoved = first.layer.top - last.layer.top;
      if (!(layerMoved < sectionMoved - 1)) {
        return `over ${Math.round(last.scrollY - first.scrollY)}px of scrolling the row moved ` +
          `${Math.round(sectionMoved)}px and the video moved ${Math.round(layerMoved)}px — the video ` +
          'is keeping pace with the page. The image half of this feature works and the video half ' +
          'does not, which is the exact split the shared layer exists to prevent.';
      }
      /*
       * THE OTHER END OF THE RANGE, and it was missing until review round 3 of
       * #481. `layerMoved < sectionMoved - 1` is satisfied by zero — so a
       * regression that PINNED the video to the viewport, which is a worse bug
       * than no parallax at all, passed the one contract written to prove the
       * video half is not dead. The image twin above has always had this
       * branch; the two must agree, because the whole point of the shared
       * layer is that image and video cannot drift apart.
       */
      if (!(layerMoved > 0)) {
        return `the video moved ${Math.round(layerMoved)}px against ${Math.round(sectionMoved)}px ` +
          'of row movement — it is pinned to the screen rather than drifting. At the shipped default ' +
          'speed of 0.3 it should move about a third as far as the row.';
      }
      return null;
    },
  },

  {
    id: 'row-overlay-tint-actually-paints',
    why:
      'The tint screen was normalized on both sides for months and PAINTED only by the frozen vanilla ' +
      'builder — a React-rendered row silently had none. Text over moving footage is unreadable without ' +
      'it, so this is the contract that stops the port being quietly lost again.',
    section: {
      ...VIDEO_SECTION,
      overlayScreen: { background: { mode: 'color', color: '#101820' }, opacity: 50 },
    },
    selector: '.builder-preview-row-overlay-screen',
    read: ['position', 'opacity', 'backgroundColor'],
    expect(sample) {
      if (sample.styles.position !== 'absolute') {
        return `the tint screen is \`position: ${sample.styles.position}\` — it is not covering the row.`;
      }
      const opacity = Number(sample.styles.opacity);
      if (!Number.isFinite(opacity) || opacity >= 1) {
        return `the tint screen rendered at opacity ${sample.styles.opacity} — a fully opaque screen hides ` +
          'the very footage it exists to make text readable over.';
      }
      return null;
    },
  },

  /*
   * THE CELL'S OWN TINT SCREEN — two contracts, because it has two ways to be
   * wrong and only one of them is visible in the markup.
   *
   * The React tests beside this prove the layer MOUNTS. They cannot prove it
   * paints, and they cannot prove it paints in the right ORDER, because a
   * vitest render has no stylesheet at all: every rule the arrangement rests
   * on lives in `_builder-react-overrides.css` and is invisible to them. That
   * is the Tumbleweed shape exactly — a class name is not a rendering — so the
   * order is asserted here, in a real browser, against the built stylesheet.
   */
  {
    id: 'cell-overlay-tint-actually-paints',
    why:
      'A row could be tinted; ONE COLUMN of it could not, so a two-column band with a photo in each ' +
      'column had no way to darken only one of them. This is the contract that the new per-cell screen ' +
      'reaches the page as a real painted layer rather than a class nothing styles.',
    section: {
      layout: 'two-column',
      cellBackgrounds: {
        left: { mode: 'color', color: '#8899aa' },
        right: { mode: 'color', color: '#8899aa' },
      },
      cellOverlayScreens: {
        left: { background: { mode: 'color', color: '#101820' }, opacity: 50 },
      },
      modules: [
        { type: 'text', column: 'left', text: '<p>Readable</p>', settings: {} },
        { type: 'text', column: 'right', text: '<p>Untouched</p>', settings: {} },
      ],
    },
    selector: '.builder-preview-cell-overlay-screen',
    read: ['position', 'opacity', 'backgroundColor'],
    expect(sample) {
      if (sample.styles.position !== 'absolute') {
        return `the cell tint is \`position: ${sample.styles.position}\` — it is sitting in the flow ` +
          'as a coloured block above the content instead of covering the cell.';
      }
      const opacity = Number(sample.styles.opacity);
      if (!Number.isFinite(opacity) || opacity >= 1) {
        return `the cell tint rendered at opacity ${sample.styles.opacity} — a fully opaque screen hides ` +
          'the very photograph it exists to make text readable over.';
      }
      if (opacity <= 0) {
        return 'the cell tint rendered at opacity 0 — it is in the DOM and paints nothing, which is ' +
          'indistinguishable from the setting not working at all.';
      }
      return null;
    },
  },

  {
    id: 'cell-overlay-stays-behind-the-words',
    why:
      'The one outcome this setting must never produce is a tint OVER the text. The reason to dim a ' +
      'photograph is to make the words on it readable, so a screen that covers them inverts the whole ' +
      'feature — and it would look completely fine in the markup, because the ordering lives entirely ' +
      'in three CSS rules. Read from the browser, against the built stylesheet, for that reason.',
    section: {
      layout: 'two-column',
      cellBackgrounds: {
        left: { mode: 'color', color: '#8899aa' },
        right: { mode: 'color', color: '#8899aa' },
      },
      cellOverlayScreens: {
        left: { background: { mode: 'color', color: '#101820' }, opacity: 50 },
      },
      modules: [
        { type: 'text', column: 'left', text: '<p>Readable</p>', settings: {} },
        { type: 'text', column: 'right', text: '<p>Untouched</p>', settings: {} },
      ],
    },
    selector: '.builder-preview-column-layered',
    read: ['position'],
    /*
     * `series` is the harness's only multi-selector reader, and the question
     * here IS a comparison between several elements in one frame — so one
     * frame is taken and judged. Nothing about this behaviour changes over
     * time.
     */
    series: {
      selectors: {
        screen: '.builder-preview-column-layered > .builder-preview-cell-overlay-screen',
        words: '.builder-preview-column-layered > .builder-preview-module',
        plainScreen: '.builder-preview-column:not(.builder-preview-column-layered) > .builder-preview-cell-overlay-screen',
        plainWords: '.builder-preview-column:not(.builder-preview-column-layered) > .builder-preview-module',
      },
      read: ['zIndex'],
      count: 1,
      everyMs: 0,
    },
    expect(sample) {
      /*
       * THIS CONTRACT DELIBERATELY DOES NOT ASSERT `isolation: isolate`, AND
       * THAT IS A CORRECTION RATHER THAN A GAP.
       *
       * It used to, on the argument that a cell with no stacking context of
       * its own would have its rungs "numbered against some ancestor instead
       * of against each other". Half of that is true and none of it is
       * load-bearing: the screen and the modules land in the SAME ancestor
       * whichever one it is, so 0-below-1 holds unconditionally. Meanwhile
       * isolating cost a real regression — a floating image is supposed to
       * hang out of its column, and a stacking context on the cell clamped it
       * so the next column painted over the overhang (round 2 of 86bbqb0ac,
       * measured with `elementFromPoint`; every z-index in the scene was
       * unchanged, which is exactly why no contract here could see it).
       *
       * The lesson is the assertion shape, not the property: assert the
       * OUTCOME the operator can see, and let the implementation pick its own
       * mechanism. The outcomes are below, and the decor half of them belongs
       * to `cell-overlay-leaves-overhanging-decor-over-the-next-column`.
       */
      const frame = sample.series?.[0];
      if (!frame) {
        return 'no frame was sampled — the contract measured nothing, which cannot verify anything.';
      }
      if (!frame.screen) {
        return 'the tint layer is not a direct child of the tinted cell — the stylesheet rungs are ' +
          'written as direct-child selectors, so they no longer reach it.';
      }
      if (!frame.words) {
        return 'no module rendered inside the tinted cell, so the thing this contract exists to ' +
          'protect — the operator\'s text — was never on the page to be measured.';
      }

      const screenZ = Number(frame.screen.zIndex);
      const wordsZ = Number(frame.words.zIndex);
      /*
       * Both read as NUMBERS before they are compared. `auto` is what an
       * unnumbered element reports, and `Number('auto')` is NaN — every
       * comparison against NaN is false, so a missing rule would have slipped
       * through whichever direction the assertion was written in.
       */
      if (!Number.isFinite(screenZ) || !Number.isFinite(wordsZ)) {
        return `the stacking rungs are not both set — the screen reads z-index ` +
          `\`${frame.screen.zIndex}\` and the text reads \`${frame.words.zIndex}\`. An unnumbered ` +
          'in-flow sibling paints UNDER a positioned z-index: 1, which puts the tint over the words.';
      }
      if (!(screenZ < wordsZ)) {
        return `the tint is at z-index ${screenZ} and the text at ${wordsZ} — the screen is painting ` +
          'ON TOP of the operator\'s words. The reason to dim a photograph is to make the text on it ' +
          'readable; this does the opposite.';
      }

      /*
       * And the cell BESIDE it is untouched. This is the ticket in one line —
       * before it, tinting one column of a row was impossible — and it is
       * asserted as TWO absences, so a rule that leaked onto every cell is
       * caught rather than read as success.
       *
       * Both halves are needed. A screen mounted on the untinted cell would be
       * a visible tint the operator never asked for; a content rung applied
       * there would be invisible today and would re-stack that cell's decor
       * tomorrow, which is precisely the defect this feature already shipped
       * twice.
       */
      if (frame.plainScreen) {
        return 'the cell with NO overlay has a tint screen mounted in it too — the layer is being ' +
          'painted on every cell instead of only the one the operator tinted, which is the opposite ' +
          'of what this whole ticket is for.';
      }
      if (frame.plainWords && frame.plainWords.zIndex !== 'auto') {
        return `a module in the UNTINTED cell reads z-index \`${frame.plainWords.zIndex}\` — the ` +
          'content rung is leaking past its `.builder-preview-column-layered` scope onto every cell. ' +
          'Nothing looks wrong today; it re-stacks floating decor on pages that have no overlay at ' +
          'all, which is the same defect this feature shipped with twice.';
      }
      return null;
    },
  },

  {
    id: 'cell-overlay-leaves-floating-decor-on-its-own-rung',
    why:
      'The rung that keeps the tint behind the words is written as `every direct module child of a ' +
      'tinted cell`, and a floating image IS a direct module child. It is not content, though — it is ' +
      'decor that rides at z-index 40, ABOVE the words, and it takes that number from the stylesheet ' +
      'rather than an inline style whenever its trigger is not `button`. So a selector written for ' +
      'text quietly re-numbers somebody\'s floating image down to the same rung as the paragraph ' +
      'beside it, where paint order falls back to DOM order. Nothing errors and the image does not ' +
      'move; it just stops being reliably in front. The column here is MIXED on purpose — the ' +
      'renderer skips its cell-tint work entirely for a column that is ALL decor, so an all-decor ' +
      'scene would pass this while the real case failed.',
    section: {
      layout: 'two-column',
      cellBackgrounds: {
        left: { mode: 'color', color: '#8899aa' },
      },
      cellOverlayScreens: {
        left: { background: { mode: 'color', color: '#101820' }, opacity: 50 },
      },
      modules: [
        {
          type: 'floating-image',
          column: 'left',
          settings: { ...PICTURE, trigger: 'on-load' },
        },
        { type: 'text', column: 'left', text: '<p>Readable</p>', settings: {} },
      ],
    },
    selector: '.builder-preview-column-layered',
    // `position`, not `isolation`: the cell deliberately forms no stacking
    // context (see the sibling contract's note), and reading a property no
    // assertion here uses would imply it still mattered.
    read: ['position'],
    series: {
      selectors: {
        screen: '.builder-preview-column-layered > .builder-preview-cell-overlay-screen',
        words: '.builder-preview-column-layered > .builder-preview-module:not(.builder-preview-module-overlay-flow):not(.builder-preview-module-overlay-slot)',
        decor: '.builder-preview-column-layered > .builder-preview-module-overlay-flow',
      },
      read: ['zIndex'],
      count: 1,
      everyMs: 0,
    },
    expect(sample) {
      const frame = sample.series?.[0];
      if (!frame) {
        return 'no frame was sampled — the contract measured nothing, which cannot verify anything.';
      }
      if (!frame.decor) {
        return 'no floating-image module rendered inside the tinted cell, so the element this contract ' +
          'exists to protect was never on the page. A `floating-image` whose trigger is not `button` ' +
          'carries the `builder-preview-module-overlay-flow` class; if that stopped being true, this ' +
          'contract is measuring the wrong element and cannot fail for the right reason.';
      }
      if (!frame.words) {
        return 'no ordinary module rendered beside the decor, so the column is not MIXED — and the ' +
          'renderer skips the cell tint entirely on an all-decor column, which is why this contract ' +
          'would then pass without testing anything.';
      }
      if (!frame.screen) {
        return 'the tint layer is not a direct child of the tinted cell, so the cell overlay is not ' +
          'actually on this scene and nothing here is being exercised.';
      }

      const decorZ = Number(frame.decor.zIndex);
      const wordsZ = Number(frame.words.zIndex);
      const screenZ = Number(frame.screen.zIndex);

      /*
       * Read as NUMBERS before comparing, for the same reason the contract
       * above says so at length: `auto` is what an unnumbered element reports,
       * `Number('auto')` is NaN, and every comparison against NaN is false —
       * so a missing rule slips through whichever way the assertion is written.
       */
      if (!Number.isFinite(decorZ)) {
        return `the floating image reads z-index \`${frame.decor.zIndex}\` — it is unnumbered, so it ` +
          'paints in DOM order against the words instead of above them.';
      }
      if (!Number.isFinite(wordsZ) || !Number.isFinite(screenZ)) {
        return `the cell's own rungs are not both set — the tint reads \`${frame.screen.zIndex}\` and ` +
          `the text reads \`${frame.words.zIndex}\`, so this scene cannot say where the decor sits ` +
          'relative to them.';
      }

      if (!(decorZ > wordsZ)) {
        return `the floating image is at z-index ${decorZ} and the ordinary text beside it at ` +
          `${wordsZ} — setting a tint on this cell pulled the decor DOWN onto the content rung. It ` +
          'still paints (its position is an inline style), but it is no longer reliably in front: at ' +
          'equal rungs the browser falls back to DOM order, so whether the operator\'s floating image ' +
          'is visible now depends on where it happens to sit in the module list.';
      }
      if (!(decorZ > screenZ)) {
        return `the floating image is at z-index ${decorZ} and the cell tint at ${screenZ} — the tint ` +
          'is painting over decor that is supposed to float above the whole cell.';
      }
      return null;
    },
  },

  {
    id: 'row-overlay-blend-mode-reaches-the-browser',
    why:
      'Blend is the difference between a sheet over the photo and a photo that has been TINTED, and it ' +
      'is one CSS property that has to survive the normalizer, the server template bundle and the ' +
      'renderer to do anything at all. A dropped field here looks exactly like a working setting: the ' +
      'picker remembers the choice, the page saves, and the overlay just carries on fogging.',
    section: {
      layout: 'single',
      background: { mode: 'image', imageUrl: BANNER },
      overlayScreen: {
        background: { mode: 'color', color: '#ff6a00' },
        opacity: 100,
        blendMode: 'multiply',
      },
      modules: [{ type: 'heading', text: 'Tinted, not fogged', settings: {} }],
    },
    selector: '.builder-preview-row-overlay-screen',
    read: ['mixBlendMode', 'backgroundColor'],
    expect(sample) {
      if (sample.styles.mixBlendMode !== 'multiply') {
        return `the tint screen computed \`mix-blend-mode: ${sample.styles.mixBlendMode}\` — Multiply was ` +
          'chosen, so the photo underneath is being fogged flat instead of tinted.';
      }
      return null;
    },
  },

  {
    id: 'row-overlay-blend-mode-normal-stays-out-of-the-way',
    why:
      'Every overlay configured before this setting existed has no blendMode at all, and this proves ' +
      'nothing writes a REAL blend mode onto those rows — a normalizer that fell back to "multiply", ' +
      'or a picker default that leaked into storage, would recolour every live tenant section that ' +
      'has an overlay, and would look deliberate. ' +
      'WHAT IT CANNOT CHECK, and do not read it as though it can: this reads the COMPUTED ' +
      '`mix-blend-mode`, which is "normal" whether the property is omitted or written out longhand, ' +
      'so it can never tell you the style object stayed byte-identical. That guard is the unit test ' +
      'at lib/builder-client/builder-row-overlay-screen.test.ts — `expect("mixBlendMode" in style)' +
      '.toBe(false)` — and it is the only thing standing behind the ticket\'s "Normal emits no ' +
      'property at all" criterion.',
    section: {
      layout: 'single',
      background: { mode: 'image', imageUrl: BANNER },
      overlayScreen: {
        background: { mode: 'color', color: '#ff6a00' },
        opacity: 100,
      },
      modules: [{ type: 'heading', text: 'Fogged, as it always was', settings: {} }],
    },
    selector: '.builder-preview-row-overlay-screen',
    read: ['mixBlendMode'],
    expect(sample) {
      if (sample.styles.mixBlendMode !== 'normal') {
        return `an overlay with no blend mode saved computed \`mix-blend-mode: ${sample.styles.mixBlendMode}\` ` +
          '— something is writing a blend mode onto sections that never asked for one.';
      }
      return null;
    },
  },

  {
    id: 'cell-overlay-leaves-overhanging-decor-over-the-next-column',
    why:
      'A floating image is MEANT to hang out of its column — `horizontalOffset` is the control that ' +
      'pushes it there — and until the cell overlay existed its `z-index: 40` was resolved in the ' +
      'SECTION\'s stacking context, where it beat the column next door. Giving the cell a stacking ' +
      'context of its own resolved that 40 INSIDE the cell instead, and the cell is `z-index: auto`, ' +
      'so the neighbouring column painted straight over the overhang: switching on a tint quietly put ' +
      'somebody\'s decor behind the next column. ' +
      'THIS IS THE CONTRACT NO Z-INDEX READING COULD HAVE REPLACED, and that is the point of it. In ' +
      'the run that found this, every z-index in the scene was identical before and after, and the ' +
      'image\'s rect was identical too — only the answer to "what is on top" moved. The sibling ' +
      'contract `cell-overlay-leaves-floating-decor-on-its-own-rung` is honest and it cannot see this, ' +
      'because both its selectors are scoped INSIDE the tinted cell. This one probes across the ' +
      'boundary.',
    section: {
      layout: 'two-column',
      /*
       * A fill on the RIGHT cell, and none on the left. The right fill is what
       * gives the probe something solid to hit when the decor loses; a bare
       * column would still answer, but a coloured one makes the same failure
       * visible to a person in a screenshot rather than only to this script.
       */
      cellBackgrounds: {
        right: { mode: 'color', color: '#cc0000' },
      },
      cellOverlayScreens: {
        left: { background: { mode: 'color', color: '#101820' }, opacity: 50 },
      },
      modules: [
        /*
         * `horizontalOffset: 200` is not a round number for looks — it is what
         * pushes the image far enough right to CROSS the gutter at this
         * harness's 1440px viewport. At the default 0 it sits wholly inside
         * its own column, the two boxes never overlap, and the assertion below
         * has nothing to measure. `expect` rejects a non-positive overlap for
         * exactly that reason: a scene that stopped overlapping would
         * otherwise pass forever while testing nothing.
         *
         * The trigger is `on-load` on purpose, matching the sibling contract:
         * a `button`-trigger floating image carries `zIndex: 40` as an INLINE
         * style and is immune to every stylesheet rung, so a scene built on it
         * could not fail.
         */
        {
          type: 'floating-image',
          column: 'left',
          settings: { ...PICTURE, size: '60', trigger: 'on-load', horizontalOffset: '200' },
        },
        { type: 'text', column: 'left', text: '<p>Readable</p>', settings: {} },
        { type: 'text', column: 'right', text: '<p>Untouched</p>', settings: {} },
      ],
    },
    selector: '.builder-preview-column-layered',
    read: ['position'],
    probes: {
      overhang: {
        subject: '.builder-preview-module-overlay-flow .builder-preview-image-shell',
        against: '.builder-preview-column:not(.builder-preview-column-layered)',
      },
    },
    expect(sample) {
      const probe = sample.probes?.overhang;
      if (!probe) {
        return 'no probe was taken — the contract measured nothing, which cannot verify anything.';
      }
      if (probe.missing) {
        return `the probe could not find \`${probe.missing}\` on the page, so the elements this ` +
          'contract compares were never both rendered. A `floating-image` whose trigger is not ' +
          '`button` mounts inside `.builder-preview-module-overlay-flow`; if that stopped being true, ' +
          'this contract is aiming at the wrong element and can no longer fail for the right reason.';
      }
      /*
       * THE UNFALSIFIABILITY GUARD, and it is the first thing checked rather
       * than the last. If the image no longer crosses into the next column —
       * a changed viewport, a changed default size, a changed gutter — then
       * the probe point lands where neither element is, whatever it hits is
       * meaningless, and a green run here would mean nothing at all. Three of
       * the assertions on this ticket turned out to be unfalsifiable; this is
       * the shape they all had.
       */
      if (!(probe.overlap > 0)) {
        return 'the floating image does not overhang into the next column at all in this scene ' +
          `(image ${probe.subjectBox.left}-${probe.subjectBox.right}, next column starts at ` +
          `${probe.againstBox.left}), so there is no overlap to probe and this contract cannot say ` +
          'anything. Push `horizontalOffset` until it crosses the gutter again — a scene that does ' +
          'not overlap passes forever while testing nothing.';
      }
      if (probe.onAgainst && !probe.onSubject) {
        return `where the floating image hangs into the next column, the browser reports \`` +
          `${probe.hit}\` on top at ${probe.point.x},${probe.point.y} — the NEXT COLUMN is painting ` +
          'over the decor. The image has not moved and its z-index has not changed; setting a tint on ' +
          'this cell shut the decor inside the cell\'s stacking context, where its 40 no longer ' +
          'outranks the column beside it. A floating image is supposed to hang out of its column — ' +
          'that is what `horizontalOffset` is for — so this makes the overlay setting silently ' +
          're-stack decor the operator arranged before it existed.';
      }
      if (!probe.onSubject) {
        return `neither the floating image nor the next column is on top at ` +
          `${probe.point.x},${probe.point.y} — the browser reports \`${probe.hit}\`. Something ` +
          'else is covering the overlap, so this scene is not measuring the thing it was built for.';
      }
      return null;
    },
  },
  /*
   * SQUARE BOTTOM WHEN OPEN (navLinkRadiusTopOnly) — measured BOTH ways.
   *
   * Operator, 2026-09-03: *"I want a radius control for the main menu item
   * containers e.g. Pickleball. The radius should only appear on the top side
   * of the container, which means the connection to the dropdown container
   * needs to account for that."*
   *
   * These are the first contracts here to use `hover`. The whole feature lives
   * in a state no static frame contains — the item changes shape only while
   * its own dropdown is open — so without it the honest options were a unit
   * test on a variable, or an assertion pointed at a `display: none` panel
   * that the harness rightly refuses to measure.
   *
   * The OFF contract is the more valuable of the two. This control ships off
   * and its blast radius is the main menu of every published tenant page, so
   * "an untouched menu is unmoved" is the claim that actually matters — and it
   * rests on getNavModuleStyle emitting no new variable while three CSS rules
   * fall back to today's value. That is two files agreeing about a fallback
   * chain, which holds right up until somebody edits one of them.
   */
  {
    id: 'nav-open-item-keeps-all-four-corners-by-default',
    why:
      'The "Square bottom when open" control ships OFF, and the argument that it is safe to add at ' +
      'all is that a menu which has never seen it renders exactly as before. That argument spans a ' +
      'TypeScript emitter and two stylesheets — nothing else in the repo fails when one of them ' +
      'drifts. This reads the open menu item out of a real browser and fails the moment the default ' +
      'stops being the old rendering.',
    module: {
      type: 'navigation',
      settings: {
        navItems: JSON.stringify([
          { id: 'home', label: 'Home', href: '/' },
          { id: 'play', label: 'Pickleball', href: '/pickleball' },
          { id: 'p1', label: 'Leagues', href: '/leagues', parentId: 'play' },
          { id: 'p2', label: 'Clinics', href: '/clinics', parentId: 'play' },
        ]),
        navBorderRadius: '18',
        navDropdownRadius: '20',
      },
    },
    hover: '.site-nav-dropdown > .site-nav-dropdown-trigger',
    selector: '.site-nav-dropdown > .site-nav-dropdown-trigger',
    read: ['borderTopLeftRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'],
    expect(sample) {
      const top = sample.styles.borderTopLeftRadius;
      const bottomLeft = sample.styles.borderBottomLeftRadius;
      const bottomRight = sample.styles.borderBottomRightRadius;
      if (top !== '18px') {
        return `the open menu item renders a ${top} top corner with Link Radius set to 18 — the ` +
          'control has reached the top of the pill, which it must never touch.';
      }
      if (bottomLeft !== '18px' || bottomRight !== '18px') {
        return `with "Square bottom when open" OFF the open menu item renders bottom corners of ` +
          `${bottomLeft} / ${bottomRight}, and Link Radius is 18. Both must be 18px: the control is ` +
          'off, so this menu has to look exactly as it did before the control existed. Every live ' +
          'tenant menu just changed shape.';
      }
      return null;
    },
  },

  {
    id: 'nav-open-item-squares-its-bottom-corners-when-asked',
    why:
      'An open item and the panel hanging under it read as two rounded pills stacked on top of each ' +
      'other. Squaring the item\'s bottom two corners is the half of the fix a visitor actually ' +
      'looks at, and it exists only while the dropdown is open — so it is invisible to every other ' +
      'check in this repo. The top corners are asserted alongside it, because a control that squared ' +
      'the whole pill would satisfy a bottom-only assertion and be plainly wrong.',
    module: {
      type: 'navigation',
      settings: {
        navItems: JSON.stringify([
          { id: 'home', label: 'Home', href: '/' },
          { id: 'play', label: 'Pickleball', href: '/pickleball' },
          { id: 'p1', label: 'Leagues', href: '/leagues', parentId: 'play' },
          { id: 'p2', label: 'Clinics', href: '/clinics', parentId: 'play' },
        ]),
        navBorderRadius: '18',
        navDropdownRadius: '20',
        navLinkRadiusTopOnly: 'true',
      },
    },
    hover: '.site-nav-dropdown > .site-nav-dropdown-trigger',
    selector: '.site-nav-dropdown > .site-nav-dropdown-trigger',
    read: ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'],
    expect(sample) {
      const { borderTopLeftRadius: tl, borderTopRightRadius: tr } = sample.styles;
      const { borderBottomLeftRadius: bl, borderBottomRightRadius: br } = sample.styles;
      if (bl !== '0px' || br !== '0px') {
        return `with "Square bottom when open" ON the open menu item still rounds its bottom corners ` +
          `(${bl} / ${br}). The item and the panel under it still read as two stacked pills, which ` +
          'is the exact thing the control was added to fix — so it appears to do nothing.';
      }
      if (tl !== '18px' || tr !== '18px') {
        return `the item squared its TOP corners too (${tl} / ${tr}), with Link Radius set to 18. ` +
          'The operator asked for the radius to remain "only on the top side"; squaring all four ' +
          'turns his menu into rectangles.';
      }
      return null;
    },
  },

  {
    id: 'nav-open-dropdown-panel-squares-its-top-edge-to-meet-the-item',
    why:
      'The other half of the same join. Squaring the item alone leaves the panel with a rounded lip ' +
      'under a square edge, which reads as a rendering fault rather than as one shape — and the ' +
      'panel is styled in a different stylesheet from the item, so the two halves can drift apart ' +
      'independently. That is the bug this module has already had twice: the builder and the live ' +
      'site disagreeing about what one control does.',
    module: {
      type: 'navigation',
      settings: {
        navItems: JSON.stringify([
          { id: 'home', label: 'Home', href: '/' },
          { id: 'play', label: 'Pickleball', href: '/pickleball' },
          { id: 'p1', label: 'Leagues', href: '/leagues', parentId: 'play' },
          { id: 'p2', label: 'Clinics', href: '/clinics', parentId: 'play' },
        ]),
        navBorderRadius: '18',
        navDropdownRadius: '20',
        navLinkRadiusTopOnly: 'true',
      },
    },
    hover: '.site-nav-dropdown > .site-nav-dropdown-trigger',
    selector: '.site-nav-dropdown-menu',
    read: ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'display'],
    expect(sample) {
      if (sample.styles.display === 'none') {
        return 'the dropdown panel is still closed while its trigger is hovered, so nothing about the ' +
          'join was measured. Fix the scene, never the assertion.';
      }
      const { borderTopLeftRadius: tl, borderTopRightRadius: tr } = sample.styles;
      if (tl !== '0px' || tr !== '0px') {
        return `the panel keeps rounded top corners (${tl} / ${tr}) while the item above it is ` +
          'squared, so the join has a lip and the two shapes still do not read as one.';
      }
      if (sample.styles.borderBottomLeftRadius !== '20px') {
        return `the panel squared its BOTTOM corners too ` +
          `(${sample.styles.borderBottomLeftRadius}), with Panel Radius set to 20. Only the top edge ` +
          "meets the item — squaring the bottom throws away the operator's Panel Radius where it is " +
          'still visible.';
      }
      return null;
    },
  },

  /*
   * A COLUMN'S BORDER STYLE — 86bc16vve.
   *
   * `buildBuilderColumnStyle` wrote the border as `${width}px solid ${color}`
   * with `solid` as a literal and never read `cellBorderStyle` at all. The
   * Builder's own column card DID read it, so the editor showed a dashed
   * border while the page rendered a solid one — the operator was styling
   * against a picture that was not what a visitor would get.
   *
   * Three contracts because the dropdown makes three distinct promises and the
   * old code broke all three in different ways: Dashed and Dotted were painted
   * as Solid, and None was ignored entirely because the WIDTH alone decided
   * whether to draw anything.
   */
  {
    id: 'column-border-style-dashed-renders-dashed',
    why:
      'The Border Style dropdown offers Dashed and the page rendered solid, because the renderer had ' +
      'the word "solid" hard-coded. The editor honoured the setting, so this disagreed with the one ' +
      'picture the operator was actually looking at while building.',
    section: {
      layout: 'single',
      modules: [{ type: 'heading', text: 'A column with a dashed border', settings: {} }],
      cellBorderWidth: { main: '4' },
      cellBorderColor: { main: '#ff0000' },
      cellBorderStyle: { main: 'dashed' },
    },
    selector: '.builder-preview-column',
    read: ['borderTopStyle', 'borderTopWidth'],
    expect(sample) {
      const { borderTopStyle: style, borderTopWidth: width } = sample.styles;
      if (style !== 'dashed') {
        return `a column set to Border Style = Dashed rendered a ${style} border. The Builder's own ` +
          'column card shows it dashed, so the editor and the page disagree about what the operator built.';
      }
      if (width !== '4px') {
        return `the dashed border rendered ${width} wide with Border Width set to 4 — reading the style ` +
          'must not disturb the width beside it.';
      }
      return null;
    },
  },
  {
    id: 'column-border-style-dotted-renders-dotted',
    why:
      'Dotted is the other half of the same literal. Asserting only Dashed would pass on a fix that ' +
      'hard-coded "dashed" in place of "solid", which is the same defect wearing a different word.',
    section: {
      layout: 'single',
      modules: [{ type: 'heading', text: 'A column with a dotted border', settings: {} }],
      cellBorderWidth: { main: '4' },
      cellBorderColor: { main: '#ff0000' },
      cellBorderStyle: { main: 'dotted' },
    },
    selector: '.builder-preview-column',
    read: ['borderTopStyle'],
    expect(sample) {
      return sample.styles.borderTopStyle === 'dotted'
        ? null
        : `a column set to Border Style = Dotted rendered a ${sample.styles.borderTopStyle} border.`;
    },
  },
  {
    id: 'column-border-style-none-draws-no-border-even-with-a-width',
    why:
      'The nastiest of the three: the renderer decided whether to draw a border from the WIDTH alone, ' +
      'so None with a width still drew a solid line. The settings panel greys Width and Colour out ' +
      'when None is chosen, so the panel was already promising a border that the page then drew anyway.',
    section: {
      layout: 'single',
      modules: [{ type: 'heading', text: 'A column with no border', settings: {} }],
      cellBorderWidth: { main: '5' },
      cellBorderColor: { main: '#ff0000' },
      cellBorderStyle: { main: 'none' },
    },
    selector: '.builder-preview-column',
    read: ['borderTopStyle', 'borderTopWidth'],
    expect(sample) {
      const { borderTopStyle: style, borderTopWidth: width } = sample.styles;
      // A browser reports width 0px whenever the style is none, so the style is
      // the fact worth reading; the width is asserted too because "none" must
      // mean nothing is painted, not merely that it is painted invisibly.
      if (style !== 'none') {
        return `a column set to Border Style = None with a Border Width of 5 rendered a ${style} ` +
          `border ${width} wide. None must mean no border at all, whatever the width says.`;
      }
      if (width !== '0px') {
        return `Border Style = None rendered no line but still reserved ${width} of border box, which ` +
          'moves the column\'s contents exactly as a visible border would.';
      }
      return null;
    },
  },
];
