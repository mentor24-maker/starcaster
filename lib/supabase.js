
'use strict';

/**
 * lib/supabase.js
 * Shared Supabase client. Single source of truth for all database access.
 *
 * USAGE:
 *   const { sbQuery, tableConfig, isConfigured } = require('./supabase');
 *
 *   const result = await sbQuery({
 *     method : 'POST',              // GET | POST | PATCH | DELETE  (default: GET)
 *     table  : 'promo_leads',       // table name
 *     query  : 'select=*&limit=50', // querystring (no leading ?)
 *     body   : { email: '...' },    // request body (objects/arrays auto-serialised)
 *     headers: { Prefer: '...' },   // extra headers merged on top of auth headers
 *     schema : 'public'             // Supabase schema (default: public)
 *   });
 *
 *   // result shape: { ok, status, data, error?, raw? }
 *
 * TABLE NAMES:
 *   tableConfig() returns all table names resolved from env vars > settings > defaults.
 *   Add new table names here as the platform grows.
 */

const { getProviderValues } = require('./apiSettings');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function env(name, fallback = '') {
  // Route known config keys through lib/config.js (single source of truth).
  // Fall back to process.env directly for anything not in the schema.
  const config = require('./config');
  const ENV_TO_KEY = {
    'SUPABASE_URL':         'supabaseUrl',
    'SUPABASE_SERVICE_KEY': 'supabaseKey',
  };
  const schemaKey = ENV_TO_KEY[name];
  const value = schemaKey ? config.get(schemaKey) : process.env[name];
  return String(value || fallback).trim();
}

function isPlaceholder(value) {
  const text = String(value || '').trim();
  return (
    !text ||
    text.includes('<') ||
    text.includes('>') ||
    text.includes('your_real_project_ref') ||
    text.includes('service_role_key')
  );
}

// ---------------------------------------------------------------------------
// Credential resolution
// Env vars take priority over values saved in Settings > APIs > Supabase.
// This lets Vercel env vars override the UI-stored config in production.
// ---------------------------------------------------------------------------

function credentials() {
  const saved = getProviderValues('supabase');

  const envUrl = env('SUPABASE_URL');
  const envKeyPrimary = env('SUPABASE_SERVICE_KEY');
  const envKeyAlt = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  const url = !isPlaceholder(envUrl)
    ? envUrl
    : String(saved.url || '').trim();

  const candidateKey = envKeyPrimary || envKeyAlt;
  const key = !isPlaceholder(candidateKey)
    ? candidateKey
    : String(saved.service_role_key || '').trim();

  return { url, key };
}

// ---------------------------------------------------------------------------
// Table name resolution
// Each table name checks: env var > Settings UI value > hard-coded default.
// Add new tables here as modules are built.
// ---------------------------------------------------------------------------

function tableConfig() {
  const saved = getProviderValues('supabase');

  function resolve(envVar, settingsKey, defaultName) {
    const fromEnv      = env(envVar);
    const fromSettings = String(saved[settingsKey] || '').trim();
    return (!isPlaceholder(fromEnv) ? fromEnv : '') || fromSettings || defaultName;
  }

  return {
    assets              : resolve('SUPABASE_ASSETS_TABLE',              'assets_table',               'assets'),
    assetCategories     : resolve('SUPABASE_ASSET_CATEGORIES_TABLE',    'asset_categories_table',     'asset_categories'),
    channels            : resolve('SUPABASE_CHANNELS_TABLE',            'channels_table',             'channels'),
    promoLeads          : resolve('SUPABASE_PROMO_LEADS_TABLE',         'promo_leads_table',          'promo_leads'),
    promoLeadFields     : resolve('SUPABASE_PROMO_LEAD_FIELDS_TABLE',   'promo_lead_fields_table',    'promo_lead_field_configs'),
    harvestYoutubeDetails : resolve('SUPABASE_HARVEST_YOUTUBE_DETAILS_TABLE', 'harvest_youtube_details_table', 'harvest_youtube_details'),
    harvestYoutubeCategories: resolve('SUPABASE_HARVEST_YOUTUBE_CATEGORIES_TABLE', 'harvest_youtube_categories_table', 'harvest_youtube_categories'),
    harvestYoutubeComments: resolve('SUPABASE_HARVEST_YOUTUBE_COMMENTS_TABLE', 'harvest_youtube_comments_table', 'harvest_youtube_comments'),
    harvestYoutubeVideos: resolve('SUPABASE_HARVEST_YOUTUBE_VIDEOS_TABLE', 'harvest_youtube_videos_table', 'harvest_youtube_videos'),
    messagingCategories  : resolve('SUPABASE_MESSAGING_CATEGORIES_TABLE', 'messaging_categories_table', 'messaging_categories'),
    messagingHeadlines    : resolve('SUPABASE_MESSAGING_HEADLINES_TABLE', 'messaging_headlines_table', 'messaging_headlines'),
    messagingSubheadings  : resolve('SUPABASE_MESSAGING_SUBHEADINGS_TABLE', 'messaging_subheadings_table', 'messaging_subheadings'),
    messagingTaglines     : resolve('SUPABASE_MESSAGING_TAGLINES_TABLE', 'messaging_taglines_table', 'messaging_taglines'),
    messagingPitches      : resolve('SUPABASE_MESSAGING_PITCHES_TABLE', 'messaging_pitches_table', 'messaging_pitches'),
    messagingArticles     : resolve('SUPABASE_MESSAGING_ARTICLES_TABLE', 'messaging_articles_table', 'messaging_articles'),
    messagingReports      : resolve('SUPABASE_MESSAGING_REPORTS_TABLE', 'messaging_reports_table', 'messaging_reports'),
    messagingWhitePapers  : resolve('SUPABASE_MESSAGING_WHITE_PAPERS_TABLE', 'messaging_white_papers_table', 'messaging_white_papers'),
    messagingEbooks       : resolve('SUPABASE_MESSAGING_EBOOKS_TABLE', 'messaging_ebooks_table', 'messaging_ebooks'),
    messagingTweets       : resolve('SUPABASE_MESSAGING_TWEETS_TABLE', 'messaging_tweets_table', 'messaging_tweets'),
    messagingPosts        : resolve('SUPABASE_MESSAGING_POSTS_TABLE', 'messaging_posts_table', 'messaging_posts'),
    messagingDescriptions : resolve('SUPABASE_MESSAGING_DESCRIPTIONS_TABLE', 'messaging_descriptions_table', 'messaging_descriptions'),
    messagingTranscripts  : resolve('SUPABASE_MESSAGING_TRANSCRIPTS_TABLE', 'messaging_transcripts_table', 'messaging_transcripts'),
    messagingComments     : resolve('SUPABASE_MESSAGING_COMMENTS_TABLE', 'messaging_comments_table', 'messaging_comments'),
    messagingHashtags     : resolve('SUPABASE_MESSAGING_HASHTAGS_TABLE', 'messaging_hashtags_table', 'messaging_hashtags'),
    messagingCtas         : resolve('SUPABASE_MESSAGING_CTAS_TABLE', 'messaging_ctas_table', 'messaging_ctas'),
    developLandingPages   : resolve('SUPABASE_DEVELOP_LANDING_PAGES_TABLE', 'develop_landing_pages_table', 'develop_landing_page'),
    developExtensions     : resolve('SUPABASE_DEVELOP_EXTENSIONS_TABLE', 'develop_extensions_table', 'develop_extensions'),
    developExtensionsManager: resolve('SUPABASE_DEVELOP_EXTENSIONS_MANAGER_TABLE', 'develop_extensions_manager_table', 'develop_extensions_manager'),
    contacts            : resolve('SUPABASE_CONTACTS_TABLE',            'contacts_table',             'contacts'),
    segments            : resolve('SUPABASE_SEGMENTS_TABLE',            'segments_table',             'segments'),
    campaigns           : resolve('SUPABASE_CAMPAIGNS_TABLE',           'campaigns_table',            'campaigns'),
    campaignEvents      : resolve('SUPABASE_CAMPAIGN_EVENTS_TABLE',     'campaign_events_table',      'campaign_events')
  };
}

// ---------------------------------------------------------------------------
// isConfigured — replaces hasSupabaseConfig() scattered across lib files
// ---------------------------------------------------------------------------

function isConfigured() {
  const { url, key } = credentials();
  return Boolean(url && key);
}

// ---------------------------------------------------------------------------
// sbQuery — the one request function
// All lib modules use this instead of their own copy.
// ---------------------------------------------------------------------------

async function sbQuery({
  method  = 'GET',
  table   = '',
  query   = '',
  body    = undefined,
  headers = {},
  schema  = 'public'
} = {}) {
  const { url, key } = credentials();

  if (!url || !key) {
    return {
      ok: false,
      status: 500,
      error: 'Supabase credentials missing. Configure them in Settings > APIs > Supabase.'
    };
  }

  if (isPlaceholder(url)) {
    return {
      ok: false,
      status: 500,
      error: 'SUPABASE_URL is still a placeholder. Set your real project URL.'
    };
  }

  const qs       = query ? `?${query}` : '';
  const endpoint = `${url}/rest/v1/${table}${qs}`;

  let res;
  try {
    res = await fetch(endpoint, {
      method,
      headers: {
        apikey        : key,
        Authorization : `Bearer ${key}`,
        'Content-Type': 'application/json',
        // schema header — Supabase uses this to switch between Postgres schemas
        ...(schema !== 'public' ? { 'Accept-Profile': schema } : {}),
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: `Could not reach Supabase: ${err.code || err.message || 'network error'}`
    };
  }

  const text = await res.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { message: text }; }
  }

  if (!res.ok) {
    return {
      ok   : false,
      status: res.status,
      error :
        payload?.message          ||
        payload?.error_description ||
        payload?.details          ||
        `Supabase error (${res.status})`,
      raw: payload
    };
  }

  return { ok: true, status: res.status, data: payload };
}

module.exports = { sbQuery, tableConfig, isConfigured, credentials };
