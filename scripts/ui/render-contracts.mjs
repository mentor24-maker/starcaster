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
      'mount a layer is also deciding to make the row `position: relative; overflow: hidden`, and ' +
      'that would start clipping any overlay module deliberately spilling out of it, on pages ' +
      'nobody touched. The absence that matters is the containment, not the element.',
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
];
