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

export const RENDER_CONTRACTS = [
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
