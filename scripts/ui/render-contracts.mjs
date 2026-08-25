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
];
