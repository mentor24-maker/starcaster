/**
 * Shared social post composer + character counter.
 *
 * Single source of truth for two questions that used to be answered
 * separately (and disagreed): "what text actually gets posted?" and
 * "how long is it?". The campaign compose preview and the Promote Social
 * send/schedule validator both call composePost() so they can never drift.
 *
 * Loaded as a plain <script> in the admin shell (window.App.composeXPost)
 * and require()-able from Node for unit tests.
 *
 * Why not the twitter-text npm package: public/js/ is served as raw script
 * tags with no bundler, so an npm module cannot reach the browser from here.
 * weightedLength() below mirrors twitter-text's default v3 configuration.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.App = root.App || {};
    root.App.composeXPost = api;
  }
})(typeof self !== 'undefined' ? self : null, function () {
  const DEFAULT_LIMIT = 280;
  // X replaces every link with a t.co wrapper of this fixed length, so the
  // real URL length never matters — a 200-char URL still costs 23.
  const TCO_URL_LENGTH = 23;
  const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s]+/gi;

  // twitter-text default weighted-character config: these code point ranges
  // cost 1 character, everything else (CJK, most emoji, etc.) costs 2.
  const LIGHT_RANGES = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]];
  const LIGHT_WEIGHT = 100;
  const HEAVY_WEIGHT = 200;
  const WEIGHT_SCALE = 100;

  // Select labels sometimes carry the field's own placeholder text ("Tweet",
  // "CTA", ...) instead of real copy. Those must not be counted or posted.
  const PLACEHOLDER_PATTERNS = [
    /^tweet(?:\s*\(.+\))?$/i,
    /^post(?:\s*\(.+\))?$/i,
    /^caption(?:\s*\(.+\))?$/i,
    /^tagline(?:\s*\(.+\))?$/i,
    /^cta(?:\s*\(.+\))?$/i,
    /^hashtags?(?:\s*\(.+\))?$/i,
    /^wyr\s+question(?:\s*\(.+\))?$/i,
    /^would\s+you\s+rather\s+question(?:\s*\(.+\))?$/i,
    /^primary\s+(?:image|video)(?:\s*\(.+\))?$/i,
    /^(?:image|video)(?:\s*\(.+\))?$/i,
  ];

  const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

  function trimmed(value) {
    return String(value == null ? '' : value).trim();
  }

  /** Drop placeholder labels; returns real copy or ''. */
  function cleanComponent(value) {
    const text = trimmed(value);
    if (!text) return '';
    return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text)) ? '' : text;
  }

  function isLightCodePoint(codePoint) {
    for (let i = 0; i < LIGHT_RANGES.length; i += 1) {
      if (codePoint >= LIGHT_RANGES[i][0] && codePoint <= LIGHT_RANGES[i][1]) return true;
    }
    return false;
  }

  /** Grapheme clusters, so a multi-code-point emoji counts once, not once per part. */
  function graphemes(text) {
    if (segmenter) return Array.from(segmenter.segment(text), (item) => item.segment);
    return Array.from(text);
  }

  /**
   * X's weighted character count: most Latin text is 1 per character, CJK and
   * emoji are 2. A plain .length would under-count emoji-heavy posts.
   */
  function weightedLength(value) {
    const text = String(value == null ? '' : value);
    let total = 0;
    graphemes(text).forEach((cluster) => {
      const points = Array.from(cluster);
      const light = points.length === 1 && isLightCodePoint(points[0].codePointAt(0));
      total += light ? LIGHT_WEIGHT : HEAVY_WEIGHT;
    });
    return Math.floor(total / WEIGHT_SCALE);
  }

  /**
   * Length as the platform counts it. With shortenUrls (X), every link is
   * measured as a 23-character t.co wrapper regardless of its real length.
   */
  function countText(value, shortenUrls) {
    const text = String(value == null ? '' : value);
    const measured = shortenUrls === false
      ? text
      : text.replace(URL_PATTERN, '_'.repeat(TCO_URL_LENGTH));
    return weightedLength(measured);
  }

  function hashtagList(value) {
    const source = Array.isArray(value) ? value.join(' ') : cleanComponent(value);
    return trimmed(source).split(/\s+/).filter(Boolean);
  }

  function appendUrl(text, url) {
    const body = trimmed(text);
    if (!body) return '';
    const link = trimmed(url);
    if (!link || body.includes(link)) return body;
    return body + ' ' + link;
  }

  /**
   * Assemble the final post from its parts and measure it.
   *
   * Over the limit, components are dropped in the same order the preview has
   * always used: trailing hashtags, then the CTA, then the share URL.
   *
   * @param {object} input
   * @param {string} input.primaryCopy   Tweet or Post copy.
   * @param {string} input.tagline
   * @param {string} input.cta
   * @param {string|string[]} input.hashtags
   * @param {string} input.shareUrl      Link appended to the body.
   * @param {string} input.projectUrl    Website URL appended to the CTA.
   * @param {number} input.limit         Defaults to 280.
   * @param {boolean} input.shortenUrls  True for X (t.co counting).
   */
  function composePost(input) {
    const options = input || {};
    const limit = Number(options.limit) > 0 ? Number(options.limit) : DEFAULT_LIMIT;
    const shortenUrls = options.shortenUrls !== false;
    const primaryCopy = cleanComponent(options.primaryCopy);
    const tagline = cleanComponent(options.tagline);
    const shareUrl = trimmed(options.shareUrl);
    const ctaText = appendUrl(cleanComponent(options.cta), options.projectUrl);
    const originalHashtags = hashtagList(options.hashtags);

    const baseParts = [primaryCopy, tagline].filter(Boolean);
    let hashtags = originalHashtags.slice();
    let includeCta = !!ctaText;
    let includeLink = !!shareUrl;

    const compose = function () {
      const bodyParts = baseParts.slice();
      if (includeCta && ctaText) bodyParts.push(ctaText);
      const bodyJoined = bodyParts.join('\n\n');
      if (includeLink && shareUrl && !bodyJoined.includes(shareUrl)) bodyParts.push(shareUrl);
      if (hashtags.length) bodyParts.push(hashtags.join(' '));
      return bodyParts.filter(Boolean).join('\n\n');
    };

    let text = compose();
    while (hashtags.length && countText(text, shortenUrls) > limit) {
      hashtags = hashtags.slice(0, -1);
      text = compose();
    }
    if (includeCta && countText(text, shortenUrls) > limit) {
      includeCta = false;
      text = compose();
    }
    if (includeLink && countText(text, shortenUrls) > limit) {
      includeLink = false;
      text = compose();
    }

    const count = countText(text, shortenUrls);
    return {
      text: text,
      count: count,
      limit: limit,
      delta: limit - count,
      over: count > limit,
      shareUrl: shareUrl,
      urlIncluded: !shareUrl || text.includes(shareUrl),
      removedHashtagCount: originalHashtags.length - hashtags.length,
      ctaDropped: !!ctaText && !includeCta,
    };
  }

  return {
    DEFAULT_LIMIT: DEFAULT_LIMIT,
    TCO_URL_LENGTH: TCO_URL_LENGTH,
    cleanComponent: cleanComponent,
    weightedLength: weightedLength,
    countText: countText,
    composePost: composePost,
  };
});
