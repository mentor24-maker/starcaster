'use strict';

/**
 * lib/associationTypes.js
 * The registry of object types that can take part in an association.
 *
 * Every type here can be linked to every other type — the registry exists to
 * reject typos (a misspelled type would silently create links nothing can
 * find), not to restrict which pairs are meaningful. Which pairs the UI
 * actually offers is a client-side decision.
 *
 * The first block mirrors the target types the asset-side modal has always
 * written (public/js/assetAssociations.js), so nothing existing breaks.
 * `messaging_tags` is new: Messaging > Tags rows, which had no way to be
 * linked to anything before.
 */

const ASSOCIATION_TYPES = Object.freeze({
  asset:                  'Asset',
  asset_category:         'Asset Category',
  campaign:               'Campaign',
  landing_page:           'Builder Page',
  poll:                   'Poll',
  messaging_topic:        'Topic',
  messaging_tags:         'Tags',
  messaging_hashtags:     'Hashtags',
  messaging_headlines:    'Headlines',
  messaging_subheadings:  'Sub-headings',
  messaging_taglines:     'Taglines',
  messaging_pitches:      'Pitches',
  messaging_articles:     'Articles',
  messaging_reports:      'Reports',
  messaging_white_papers: 'White Papers',
  messaging_ebooks:       'eBooks',
  messaging_emails:       'Emails',
  messaging_tweets:       'Tweets',
  messaging_posts:        'Posts',
  messaging_descriptions: 'Descriptions',
  messaging_transcripts:  'Transcripts',
  messaging_comments:     'Comments',
  messaging_keywords:     'Keywords',
  messaging_ctas:         'Calls to Action',
});

function isKnownAssociationType(type) {
  return Object.prototype.hasOwnProperty.call(ASSOCIATION_TYPES, String(type || '').trim());
}

function associationTypeLabel(type) {
  const key = String(type || '').trim();
  return ASSOCIATION_TYPES[key] || key;
}

module.exports = {
  ASSOCIATION_TYPES,
  isKnownAssociationType,
  associationTypeLabel,
};
