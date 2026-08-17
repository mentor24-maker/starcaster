/**
 * The "Explore" link on the login screen — two behaviours.
 *
 * 1. PROXIMITY HALO. The nearer the cursor gets, the more volume the halo
 *    has. Same idea as the tractor-nav module, which measures the pointer's
 *    distance from a centre and lights what it is inside of; this is the
 *    continuous version of that — one 0-to-1 number rather than discrete
 *    rings. The number is written to the `--halo` custom property and
 *    _auth.css scales every glow layer's blur and alpha off it.
 *
 * 2. IGNITION. Clicking runs a short sequence before navigating: the halo
 *    snaps shut, then a white circle bursts out of the centre of the word and
 *    eases open until the screen is solid white, and only then does /explore
 *    load. Navigation is deliberately held back, because a browser tears down
 *    the page the instant it starts loading — a CSS-only :active animation
 *    gets cut off mid-frame every time.
 *
 * Everything here degrades to an ordinary link: the anchor keeps a real href,
 * and _auth.css sets a resting --halo plus a :hover rule, so with this file
 * absent or broken the link still glows, still lights up on hover, and still
 * navigates. Lives in public/shared/ (not public/js/, which is frozen) so
 * `npm run check:syntax` parses it — a syntax error here would kill the file
 * silently, and every behaviour in it with no error anywhere.
 */
(function exploreLink() {
  'use strict';

  var SELECTOR = '.auth-intro-explore';
  var COLLAPSE_MS = 150;  // halo snaps shut
  var BLOOM_MS = 520;     // white circle expands to fill
  var HOLD_MS = 90;       // beat on full white before the page changes
  var SAFETY_MS = 1400;   // navigate anyway if the watcher never reports
  /* Fraction of the circle's radius that is fully opaque. MUST match the
     second colour stop of .explore-flash's gradient in _auth.css — it is how
     we know the screen is genuinely white and not merely mostly covered. */
  var SOLID_STOP = 0.6;

  var REACH_PX = 460;     // beyond this the halo sits at its resting volume
  var REST_HALO = 0.42;   // must match the resting --halo in _auth.css
  var FALLOFF = 2;        // >1 keeps the swell close to the word

  function prefersReducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (err) {
      return false;
    }
  }

  /** A modified click (new tab, new window, download) is not ours to animate. */
  function isPlainLeftClick(event) {
    return event.button === 0
      && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  }

  function runFlash(link, href) {
    var rect = link.getBoundingClientRect();
    var originX = rect.left + rect.width / 2;
    var originY = rect.top + rect.height / 2;

    // The circle must still be solid white at the far corner when it stops.
    // Its gradient is opaque out to 60% of its radius, so the element is sized
    // to the viewport diagonal and scaled well past it: 0.3 * diagonal * 3.8
    // clears the corner with room to spare on any aspect ratio.
    var diagonal = Math.hypot(window.innerWidth, window.innerHeight);

    var flash = document.createElement('div');
    flash.className = 'explore-flash';
    flash.style.width = diagonal + 'px';
    flash.style.height = diagonal + 'px';
    flash.style.left = (originX - diagonal / 2) + 'px';
    flash.style.top = (originY - diagonal / 2) + 'px';
    flash.style.transitionDuration = BLOOM_MS + 'ms';
    document.body.appendChild(flash);

    var done = false;
    function go() {
      if (done) return;
      done = true;
      window.location.href = href;
    }

    // 1. Halo collapses.
    link.classList.add('is-igniting');

    // Has the opaque core reached every corner? Measured rather than timed,
    // because the easing below is deliberately front-loaded: the circle is
    // visually finished at roughly a third of its transition, and the rest of
    // the scaling happens off-screen where nobody can see it.
    function coversViewport() {
      var r = flash.getBoundingClientRect();
      var solidR = (r.width / 2) * SOLID_STOP;
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var w = window.innerWidth;
      var h = window.innerHeight;
      var furthest = Math.max(
        Math.hypot(cx, cy), Math.hypot(cx - w, cy),
        Math.hypot(cx, cy - h), Math.hypot(cx - w, cy - h)
      );
      return solidR >= furthest;
    }

    // 2. Then the circle blooms. The rAF pair guarantees the browser has
    //    painted scale(0) before scale(3.8) is set, or there is no transition
    //    to run and the flash simply appears.
    window.setTimeout(function bloom() {
      window.requestAnimationFrame(function first() {
        window.requestAnimationFrame(function second() {
          flash.style.transform = 'translateZ(0) scale(3.8)';
          watch();
        });
      });
    }, COLLAPSE_MS);

    // 3. Navigate the moment the screen is actually white, plus a short beat.
    //    Waiting for transitionend instead would leave the viewer staring at a
    //    finished white screen for a third of a second with nothing happening.
    function watch() {
      if (done) return;
      if (coversViewport()) {
        window.setTimeout(go, HOLD_MS);
        return;
      }
      window.requestAnimationFrame(watch);
    }

    // 4. Navigate regardless — a stalled animation must not strand anyone on
    //    a half-painted screen.
    window.setTimeout(go, SAFETY_MS);
  }

  function onClick(event) {
    var link = event.target && event.target.closest
      ? event.target.closest(SELECTOR)
      : null;
    if (!link) return;
    if (!isPlainLeftClick(event)) return;

    var href = link.getAttribute('href');
    if (!href) return;
    if (prefersReducedMotion()) return; // let the browser navigate normally

    event.preventDefault();
    try {
      runFlash(link, href);
    } catch (err) {
      window.location.href = href; // never trap the click
    }
  }

  /**
   * How lit the halo should be for a cursor at (x, y).
   *
   * Distance is measured to the nearest point of the word's box, not to its
   * centre — "EXPLORE" is far wider than it is tall, and measuring from the
   * centre would make the halo respond differently depending on whether you
   * approached the E or the middle. Nearest-edge makes the swell even all the
   * way round.
   */
  function haloFor(rect, x, y) {
    var dx = Math.max(rect.left - x, 0, x - rect.right);
    var dy = Math.max(rect.top - y, 0, y - rect.bottom);
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= REACH_PX) return REST_HALO;
    var closeness = 1 - dist / REACH_PX;
    var eased = Math.pow(closeness, FALLOFF);
    return REST_HALO + (1 - REST_HALO) * eased;
  }

  function trackProximity(link) {
    var pending = false;
    var lastX = 0;
    var lastY = 0;

    function apply() {
      pending = false;
      link.style.setProperty('--halo', haloFor(link.getBoundingClientRect(), lastX, lastY).toFixed(3));
    }

    // Coalesce to one write per frame: mousemove fires far faster than the
    // screen repaints, and each write invalidates the shadow's layout.
    function schedule() {
      if (pending) return;
      pending = true;
      window.requestAnimationFrame(apply);
    }

    function onMove(event) {
      lastX = event.clientX;
      lastY = event.clientY;
      schedule();
    }

    function reset() {
      link.style.setProperty('--halo', String(REST_HALO));
    }

    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseleave', reset);
    // Scrolling moves the word under a stationary cursor, so the distance
    // changes with no mousemove to report it. Re-measure with the coordinates
    // already held rather than rebinding stale ones.
    window.addEventListener('scroll', schedule, { passive: true });
  }

  function start() {
    if (!document.body) return;
    document.body.addEventListener('click', onClick);

    var link = document.querySelector(SELECTOR);
    // Touch devices never fire mousemove, so the resting halo simply stands;
    // reduced motion opts out of the swell for the same reason it opts out of
    // the flash.
    if (link && !prefersReducedMotion()) trackProximity(link);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
