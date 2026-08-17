/**
 * The "Explore" link's ignition on the login screen.
 *
 * Clicking runs a short sequence before navigating: the resting halo snaps
 * shut, then a white circle blooms out of the centre of the word and expands
 * until the screen is solid white, and only then does /explore load.
 *
 * Navigation is deliberately held back by JS, because a browser tears down the
 * page the instant it starts loading — a CSS-only :active animation gets cut
 * off mid-frame every time.
 *
 * Everything here degrades to an ordinary link: the anchor keeps a real href,
 * so if this file fails to parse or the effect throws, the click still works.
 * Lives in public/shared/ (not public/js/, which is frozen) so `npm run
 * check:syntax` parses it — a syntax error here would silently kill the file.
 */
(function exploreFlash() {
  'use strict';

  var SELECTOR = '.auth-intro-explore';
  var COLLAPSE_MS = 150;  // halo snaps shut
  var BLOOM_MS = 520;     // white circle expands to fill
  var SAFETY_MS = 1400;   // navigate anyway if a transition never reports

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

    // 2. Then the circle blooms. The rAF pair guarantees the browser has
    //    painted scale(0) before scale(3.8) is set, or there is no transition
    //    to run and the flash simply appears.
    window.setTimeout(function bloom() {
      window.requestAnimationFrame(function first() {
        window.requestAnimationFrame(function second() {
          flash.style.transform = 'translateZ(0) scale(3.8)';
        });
      });
      flash.addEventListener('transitionend', go);
    }, COLLAPSE_MS);

    // 3. Navigate regardless — a dropped transitionend must not strand anyone
    //    on a white screen.
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

  function start() {
    if (!document.body) return;
    document.body.addEventListener('click', onClick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
