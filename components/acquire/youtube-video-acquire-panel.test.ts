import { describe, expect, it } from 'vitest';

import { mediaOutcomeFor, normalizeYoutubeUrl } from './youtube-video-acquire-panel';

const CANONICAL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

describe('normalizeYoutubeUrl', () => {
  it('accepts the URL shapes people actually paste', () => {
    const accepted = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'http://youtube.com/watch?v=dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ',
      'www.youtube.com/watch?v=dQw4w9WgXcQ',
      '  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ',
      'dQw4w9WgXcQ',
    ];
    accepted.forEach((input) => {
      expect(normalizeYoutubeUrl(input), input).toBe(CANONICAL);
    });
  });

  it('keeps the video id when extra query parameters ride along', () => {
    // Share links carry ?t=, &list=, and tracking params; the id is the part
    // that matters and the rest must not defeat the match.
    expect(normalizeYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s')).toBe(CANONICAL);
    expect(normalizeYoutubeUrl('https://youtu.be/dQw4w9WgXcQ?si=abc123')).toBe(CANONICAL);
    expect(
      normalizeYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxxxxxx&index=2')
    ).toBe(CANONICAL);
  });

  it('rejects anything that is not a single YouTube video', () => {
    const rejected = [
      '',
      '   ',
      'not a url',
      'https://example.com/watch?v=dQw4w9WgXcQ',
      'https://vimeo.com/123456789',
      // A channel or playlist has no video to acquire.
      'https://www.youtube.com/@someChannel',
      'https://www.youtube.com/playlist?list=PLxxxxxx',
      'https://www.youtube.com/watch?v=tooshort',
      'https://www.youtube.com/watch',
      // Look-alike host: youtube.com.evil.example must not pass.
      'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    ];
    rejected.forEach((input) => {
      expect(normalizeYoutubeUrl(input), input).toBe('');
    });
  });
});

describe('mediaOutcomeFor — a dead worker must not cost the acquire', () => {
  /**
   * Slice 1 ships the server half INERT: with no worker configured,
   * POST /api/acquire/youtube-media answers 503 naming Settings > APIs rather
   * than 500 or a hang. This is the panel's half of that promise — the details
   * and transcript still land, and only the .mp4/.mp3 part says it is
   * unavailable.
   */
  it('starts polling when the server queued a job', () => {
    const out = mediaOutcomeFor({ job_id: 'job_1', status: 'running' });
    expect(out.status).toBe('running');
    expect(out.error).toBe('');
  });

  it('defaults a job with no status to queued rather than to failed', () => {
    expect(mediaOutcomeFor({ job_id: 'job_1' }).status).toBe('queued');
  });

  it('with no worker, reports unavailable and names where to fix it', () => {
    const out = mediaOutcomeFor(null);
    expect(out.status).toBe('failed');
    expect(out.error).toMatch(/Settings > APIs/);
    // Not an exception, not a blank panel, not a silent nothing.
    expect(out.mp4).toBeNull();
    expect(out.mp3).toBeNull();
  });

  it("passes the server's own reason through when it gave one", () => {
    const out = mediaOutcomeFor({ error: 'The media worker is unreachable.' });
    expect(out.error).toBe('The media worker is unreachable.');
    expect(out.status).toBe('failed');
  });

  it('a job_id of empty string is treated as no job, not as a job', () => {
    // '' is falsy, so this must take the unavailable branch rather than
    // starting a poll against an empty id.
    expect(mediaOutcomeFor({ job_id: '' }).status).toBe('failed');
  });
});

describe('the details half is handed over before media is considered', () => {
  it('dispatches the acquired event before touching the media outcome', async () => {
    // An ordering property, and the kind that regresses silently: moving the
    // media block above the dispatch would still typecheck, still pass every
    // other test here, and quietly make a missing worker swallow a good
    // acquire. There are no React render tests in this repo to catch it at
    // runtime, so the order is pinned in the source itself.
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, 'youtube-video-acquire-panel.tsx'), 'utf8');

    const dispatch = src.indexOf('YOUTUBE_ACQUIRED_EVENT, { detail:');
    const mediaUse = src.indexOf('setMedia(mediaOutcomeFor(');
    expect(dispatch).toBeGreaterThan(-1);
    expect(mediaUse).toBeGreaterThan(-1);
    expect(dispatch).toBeLessThan(mediaUse);
  });
});
