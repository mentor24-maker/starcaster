'use strict';

/**
 * The AI feature groups (AI provider groups 1, SC-872).
 *
 * Dane, 2026-11-18: "I may want to be able to have separate controls for
 * separate functions, like Outreach uses one and all other activities use the
 * other." So every feature that asks the AI door (lib/aiClient.js
 * `generate()`) for an answer belongs to exactly one of these groups, and each
 * group either follows the main provider order on Settings › APIs (the
 * default) or has its own.
 *
 * The list is fixed in code on purpose: a group is a promise about which
 * account a whole area of the product bills, so adding one is a reviewed
 * change, not a setting. `scripts/builder/aiFeatureGroups.test.js` scans every
 * caller of `generate()` and FAILS when a feature name is in no group here, so
 * a new feature cannot quietly land in "Everything else" and bill an account
 * nobody chose for it. Add the new name to the right group below.
 *
 * At run time a feature in no group (including `unknown`, the door's name for
 * a caller that forgot to say) uses the main order, and the door's answer
 * says so; it never borrows "Everything else"'s own order.
 */

const AI_FEATURE_GROUPS = Object.freeze([
  Object.freeze({
    id: 'outreach',
    label: 'Outreach',
    about: 'Reply drafts, comment suggestions and the Substack, Reddit, YouTube and Bluesky passes',
    features: Object.freeze([
      // Drafting what Dane posts
      'reddit-comment-draft',
      'substack-notes-draft',
      'youtube-outreach-draft',
      'youtube_comment_suggestions',
      'outreach-lessons',
      // Finding who and where to talk to
      'bluesky_reply_candidates',
      'reddit_reply_candidates',
      'outreach.reddit.subreddit-suggest',
      'substack-miner-suggest',
      'substack-miner-keywords-grow',
      'outreach-youtube-creators-suggest',
    ]),
  }),
  Object.freeze({
    id: 'studio',
    label: 'Studio / Reel Spinner',
    about: 'Choosing the moments in a recording that become a reel, re-cutting it from a note, and writing its YouTube title and description',
    features: Object.freeze([
      'studio_reel_moments',
      'studio_recut',
      'studio_youtube_copy',
    ]),
  }),
  Object.freeze({
    id: 'writing',
    label: 'Writing',
    about: 'Write with AI, Messaging drafts and topics, image alt text and tagging',
    features: Object.freeze([
      'seo_alt_text',
      'font-autotag',
      // Messaging: drafting the project's own content (not replies to other
      // people, which is Outreach), and changing a draft from one format to another
      'messaging_content_short',
      'messaging_content_long',
      'messaging_format_transform',
      'messaging_topic_suggestions',
      // Keywords and tags read off the project's own web pages
      'webpage_keyword_import',
      'webpage_tag_import',
    ]),
  }),
  Object.freeze({
    id: 'acquire',
    label: 'Acquire',
    about: 'Content handlers, keyword ranking and sorting the websites found on Acquire',
    features: Object.freeze([
      'acquire_content_handler_generate',
      'direct_acquire_keyword_rerank',
      'website_peer_classification',
    ]),
  }),
  Object.freeze({
    id: 'everything-else',
    label: 'Everything else',
    about: 'Anything not in another group: the ai_try connectivity check, the CRM persona summary, reading a schedule flyer into events, reading a Would You Rather post image and the Builder\'s Theme Wizard',
    features: Object.freeze([
      'ai-try',
      'contact_persona_synthesis',
      // Reading files (SC-896): a club's weekly program flyer into proposed
      // events, and the two choices off a Would You Rather post image
      'event_harvest',
      'wyr_image_ocr',
      // The Builder's Theme Wizard (SC-898): reading a site, a logo or a typed
      // brief, choosing three directions and designing a theme for each
      'theme_wizard',
    ]),
  }),
]);

const GROUP_IDS = Object.freeze(AI_FEATURE_GROUPS.map((g) => g.id));

/** The door's default name for a caller that did not say what it is; never a member of any group. */
const UNASSIGNED_FEATURE = 'unknown';

const byFeature = new Map();
for (const group of AI_FEATURE_GROUPS) {
  for (const feature of group.features) {
    if (byFeature.has(feature)) {
      // Loud at load time: a feature in two groups would bill whichever came first.
      throw new Error(`AI feature "${feature}" is in two groups: ${byFeature.get(feature).id} and ${group.id}`);
    }
    byFeature.set(feature, group);
  }
}
if (byFeature.has(UNASSIGNED_FEATURE)) throw new Error(`"${UNASSIGNED_FEATURE}" must never be listed in a group`);

/** The group a feature belongs to, or null when it is in none. */
function groupForFeature(feature) {
  const name = String(feature || '').trim();
  if (!name || name === UNASSIGNED_FEATURE) return null;
  return byFeature.get(name) || null;
}

/** A group by its id, or null. */
function groupById(id) {
  return AI_FEATURE_GROUPS.find((g) => g.id === id) || null;
}

module.exports = {
  AI_FEATURE_GROUPS,
  GROUP_IDS,
  UNASSIGNED_FEATURE,
  groupForFeature,
  groupById,
};
