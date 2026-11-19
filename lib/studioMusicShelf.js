'use strict';

/**
 * The music shelf, readable from BOTH sides (Reel Spinner 5a SC-837, 4c SC-835).
 *
 * The picker runs on the Mac Mini (workers/studio/music.js); the rough-cut
 * card on Assets › Footage runs on the website and has to say which track a
 * cut got. Vercel never uploads workers/ (.vercelignore), and a website
 * require into that tree fails the deploy (PR #898 did exactly that), so the
 * shelf and the one function both sides need live here. The worker requires
 * this file; nothing here requires the worker.
 */

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * A stored track id in words, for a screen: "Title, Artist". An id the shelf
 * does not know says so rather than showing nothing (landmine 17).
 */
function trackLabel(shelf, trackId) {
  const id = text(trackId);
  if (!id) return 'No music picked yet';
  const tracks = Array.isArray(shelf && shelf.tracks) ? shelf.tracks : [];
  const track = tracks.find((t) => t && t.id === id);
  return track ? `${track.title}, ${track.artist}` : `Unknown track "${id}" (not on the music shelf)`;
}

/** The committed shelf. Read on demand so a test can pass its own. */
function loadShelf() {
  return require('./studioMusicShelf.json');
}

module.exports = { trackLabel, loadShelf };
