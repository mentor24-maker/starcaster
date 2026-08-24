/**
 * THE TWO JUDGEMENTS BEHIND A BEFORE/AFTER SHOT — kept pure so they can be
 * tested without a browser, a server, a git history or a ClickUp token.
 *
 *   1. COULD this change have altered what a page renders?   (visualFilesIn)
 *   2. DID two screenshots of the same scene come out different? (comparePixels)
 *
 * WHY BOTH LIVE HERE
 * `shoot_changes.mjs` is 400 lines of browser, git and API plumbing that can
 * only run against a live checkout with a dev server up. Nothing in CI can
 * execute it, so anything decided inside it is decided untested. These two are
 * where the whole feature can be wrong in a way nobody notices — a surface
 * list that misses `src/css/` reports "no visual change" on a restyle, and a
 * comparison with a sloppy tolerance reports "no visual change" on a moved
 * button. Both failures look exactly like success.
 */

/**
 * The paths a change must touch before it is worth shooting anything.
 *
 * READ THE INVERSE FAILURE FIRST. This list decides when the harness stays
 * silent, so a missing entry does not produce an error — it produces a clean
 * run that shot nothing, on a PR that restyled the site. Every skip therefore
 * PRINTS this list (DOCTRINE §3.11: a sweep reports what it could not settle),
 * and `--force` shoots regardless.
 *
 * The rule for adding one: if a file feeds `public/builder-bundle.js`,
 * `public/styles.css`, or the preview page itself, it belongs here. Those
 * three artifacts are the entire input to what the renderer draws.
 */
export const VISUAL_SOURCES = [
  { path: 'components/', why: 'every module renderer and the preview shell' },
  { path: 'lib/builder-client/', why: 'the page model the renderer reads' },
  { path: 'builder-react-entry.tsx', why: 'what mounts the renderer' },
  { path: 'src/css/', why: 'public/styles.css is built from here' },
  { path: 'public/builder-preview.html', why: 'the surface being shot' },
  { path: 'public/images/', why: 'a replaced picture is a visual change' },
];

/** The subset of `files` that can change what a page renders. */
export function visualFilesIn(files) {
  return files.filter((file) =>
    VISUAL_SOURCES.some((source) =>
      source.path.endsWith('/') ? file.startsWith(source.path) : file === source.path));
}

/**
 * DO TWO RENDERS DIFFER — exactly, with no tolerance, on purpose.
 *
 * A tolerance is the obvious thing to reach for here and it is the wrong
 * thing. "Ignore differences under 0.05% of pixels" hides precisely the change
 * most worth a human's eye: a border that lost 1px, a colour that shifted two
 * shades, a caption that moved. The alternative to a tolerance is proving the
 * instrument instead — shoot one scene twice against the SAME assets and
 * require zero differing pixels before believing any other result. That
 * control is what makes exactness affordable, and `shoot_changes.mjs` fails
 * the whole run rather than filing anything if it does not hold.
 *
 * Inputs are raw pixel buffers as `sharp(...).raw().toBuffer({ resolveWithObject: true })`
 * hands them over: `{ data, width, height, channels }`.
 */
export function comparePixels(before, after) {
  if (before.width !== after.width || before.height !== after.height) {
    return {
      identical: false,
      changedPixels: null,
      totalPixels: null,
      ratio: 1,
      summary: `the rendered box changed size: ${before.width}×${before.height} → ${after.width}×${after.height}`,
    };
  }
  if (before.channels !== after.channels) {
    return {
      identical: false,
      changedPixels: null,
      totalPixels: null,
      ratio: 1,
      summary: `pixel format changed: ${before.channels} channels → ${after.channels}`,
    };
  }

  const channels = before.channels;
  const a = before.data;
  const b = after.data;
  const totalPixels = before.width * before.height;
  let changedPixels = 0;
  let firstAt = null;

  for (let p = 0; p < totalPixels; p += 1) {
    const base = p * channels;
    for (let c = 0; c < channels; c += 1) {
      if (a[base + c] !== b[base + c]) {
        changedPixels += 1;
        if (firstAt === null) {
          firstAt = { x: p % before.width, y: Math.floor(p / before.width) };
        }
        break;
      }
    }
  }

  const ratio = totalPixels ? changedPixels / totalPixels : 0;
  return {
    identical: changedPixels === 0,
    changedPixels,
    totalPixels,
    ratio,
    summary: changedPixels === 0
      ? 'identical'
      : `${changedPixels.toLocaleString()} of ${totalPixels.toLocaleString()} pixels differ ` +
        `(${(ratio * 100).toFixed(2)}%), first at ${firstAt.x},${firstAt.y}`,
  };
}

/**
 * The one-line verdict a person reads in the ClickUp task.
 *
 * Deliberately says how MUCH moved and nothing about whether it is right: a
 * pixel count proves something changed, never that it changed correctly
 * (DOCTRINE §5.14, and the same caveat check:render carries). Judging the look
 * is the entire reason the images are attached.
 */
export function describeChange(sceneId, result) {
  if (result.identical) return `${sceneId}: unchanged`;
  return `${sceneId}: ${result.summary}`;
}
