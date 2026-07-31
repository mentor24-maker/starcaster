import { describe, expect, it } from 'vitest';

import { normalizeYoutubeUrl } from './youtube-video-acquire-panel';

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
