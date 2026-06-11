'use strict';

const template = require('./template');
const emailTemplate = require('./email-template');
const document = require('./document');
const migrateFromLegacy = require('./migrate-from-legacy');
const assetUrl = require('./asset-url-stub');

module.exports = {
  ...template,
  ...emailTemplate,
  ...document,
  ...migrateFromLegacy,
  normalizeBuilderAssetUrl: assetUrl.normalizeBuilderAssetUrl,
  resolvePublicBuilderAssetUrl: assetUrl.resolvePublicBuilderAssetUrl,
};
