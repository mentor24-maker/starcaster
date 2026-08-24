'use strict';

const crypto = require('node:crypto');
const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');
const { normalizePageSearchPriority } = require('./builder-client/page-search-priority');
const { recordPageRevision, findSaveAuthor } = require('./builderPageRevisionsStore');
const {
  normalizeStarCasterTemplateKind,
  readLayoutSectionsFromRow,
  writeLayoutSectionsToRow,
} = require('./builder');

function table() {
  return tableConfig().builderPages;
}

function safeText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function normalizeContentOverrides(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return normalizeContentOverrides(JSON.parse(value));
    } catch (_) {
      return {};
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) return {};
  const next = {};
  Object.entries(value).forEach(([key, raw]) => {
    const cleanKey = safeText(key, 120);
    if (!cleanKey) return;
    next[cleanKey] = safeText(raw, 10000);
  });
  return next;
}

function normalizeTemplateKind(value) {
  return normalizeStarCasterTemplateKind(value);
}

function rowToPage(row) {
  if (!row) return null;
  const document = readLayoutSectionsFromRow(row);
  return {
    id: String(row.id ?? ''),
    name: safeText(row.name, 255),
    templateKind: normalizeTemplateKind(row.template_kind || row.templateKind),
    // Two different things that used to share one column: templateId is a
    // legacy layout NAME, pageTemplateId is which builder_page_templates row
    // this page came from. Absent column reads as empty, which means "no page
    // template" — a valid state, and what 93 of 156 pages are in.
    templateId: safeText(row.template_id, 120),
    pageTemplateId: safeText(row.page_template_id, 120),
    slug: safeText(row.slug, 160),
    isPublished: row.is_published == null ? true : row.is_published === true,
    isPrivate: row.is_private == null ? null : row.is_private === true,
    primaryColor: safeText(row.primary_color, 20),
    backgroundColor: safeText(row.background_color, 20),
    accentColor: safeText(row.accent_color, 20),
    formId: safeText(row.form_id, 120),
    leadMagnetId: safeText(row.lead_magnet_id, 120),
    headlineId: safeText(row.headline_id, 120),
    pitchId: safeText(row.pitch_id, 120),
    ctaId: safeText(row.cta_id, 120),
    websiteBannerImageId: safeText(row.website_banner_image_id, 120),
    backgroundImageId: safeText(row.background_image_id, 120),
    featureImageId: safeText(row.feature_image_id, 120),
    highlightImageId: safeText(row.highlight_image_id, 120),
    featureHeadlineId: safeText(row.feature_headline_id, 120),
    featureSubheadingId: safeText(row.feature_subheading_id, 120),
    featureTitle: safeText(row.feature_title, 500),
    featureCopy: safeText(row.feature_copy, 5000),
    highlightHeadlineId: safeText(row.highlight_headline_id, 120),
    highlightPitchId: safeText(row.highlight_pitch_id, 120),
    highlightTitle: safeText(row.highlight_title, 500),
    highlightCopy: safeText(row.highlight_copy, 5000),
    bodyHeadlineId: safeText(row.body_headline_id, 120),
    bodySubheadingId: safeText(row.body_subheading_id, 120),
    bodyPitchId: safeText(row.body_pitch_id, 120),
    logoWideId: safeText(row.logo_wide_id, 120),
    logoSquareId: safeText(row.logo_square_id, 120),
    themeId: safeText(row.theme_id, 120),
    // Absent column, NULL, '' and anything unrecognised all read as "normal",
    // which is what lets this ship without a backfill.
    searchPriority: normalizePageSearchPriority(row.search_priority),
    pageBackground: document.pageBackground,
    theme: document.theme,
    layoutSections: document.layoutSections,
    contentOverrides: normalizeContentOverrides(row.content_overrides),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function hasInputField(input, ...keys) {
  if (!input || typeof input !== 'object') return false;
  return keys.some((key) => Object.prototype.hasOwnProperty.call(input, key));
}

function inputToRow(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object') return {};
  const row = {};

  const set = (condition, key, value) => {
    if (!partial || condition) row[key] = value;
  };

  const hasTemplateKind = hasInputField(input, 'templateKind', 'template_kind');
  const hasTemplateId = hasInputField(input, 'templateId', 'template_id');
  const hasPageTemplateId = hasInputField(input, 'pageTemplateId', 'page_template_id');
  const hasThemeId = hasInputField(input, 'themeId', 'theme_id');
  const hasSearchPriority = hasInputField(input, 'searchPriority', 'search_priority');
  const hasLayout = hasInputField(
    input,
    'layoutSections',
    'layout_sections',
    'pageBackground',
    'page_background',
    'theme',
  );
  const hasContentOverrides = hasInputField(input, 'contentOverrides', 'content_overrides');

  set(hasTemplateKind, 'template_kind', normalizeTemplateKind(input?.templateKind || input?.template_kind));
  set(hasTemplateId, 'template_id', safeText(input?.templateId, 120));
  // Empty is a real value here — "this page has no page template" — so it is
  // written as NULL rather than being skipped, which is how a template gets
  // unset deliberately.
  set(
    hasPageTemplateId,
    'page_template_id',
    safeText(input?.pageTemplateId ?? input?.page_template_id, 120) || null,
  );
  set(hasInputField(input, 'primaryColor', 'primary_color'), 'primary_color', safeText(input?.primaryColor, 20));
  set(hasInputField(input, 'backgroundColor', 'background_color'), 'background_color', safeText(input?.backgroundColor, 20));
  set(hasInputField(input, 'accentColor', 'accent_color'), 'accent_color', safeText(input?.accentColor, 20));
  set(hasInputField(input, 'formId', 'form_id'), 'form_id', safeText(input?.formId, 120));
  set(hasInputField(input, 'leadMagnetId', 'lead_magnet_id'), 'lead_magnet_id', safeText(input?.leadMagnetId, 120));
  set(hasInputField(input, 'headlineId', 'headline_id'), 'headline_id', safeText(input?.headlineId, 120));
  set(hasInputField(input, 'pitchId', 'pitch_id'), 'pitch_id', safeText(input?.pitchId, 120));
  set(hasInputField(input, 'ctaId', 'cta_id'), 'cta_id', safeText(input?.ctaId, 120));
  set(
    hasInputField(input, 'websiteBannerImageId', 'website_banner_image_id'),
    'website_banner_image_id',
    safeText(input?.websiteBannerImageId, 120),
  );
  set(
    hasInputField(input, 'backgroundImageId', 'background_image_id'),
    'background_image_id',
    safeText(input?.backgroundImageId, 120),
  );
  set(
    hasInputField(input, 'featureImageId', 'feature_image_id'),
    'feature_image_id',
    safeText(input?.featureImageId, 120),
  );
  set(
    hasInputField(input, 'highlightImageId', 'highlight_image_id'),
    'highlight_image_id',
    safeText(input?.highlightImageId, 120),
  );
  set(
    hasInputField(input, 'featureHeadlineId', 'feature_headline_id'),
    'feature_headline_id',
    safeText(input?.featureHeadlineId, 120),
  );
  set(
    hasInputField(input, 'featureSubheadingId', 'feature_subheading_id'),
    'feature_subheading_id',
    safeText(input?.featureSubheadingId, 120),
  );
  set(hasInputField(input, 'featureTitle', 'feature_title'), 'feature_title', safeText(input?.featureTitle, 500));
  set(hasInputField(input, 'featureCopy', 'feature_copy'), 'feature_copy', safeText(input?.featureCopy, 5000));
  set(
    hasInputField(input, 'highlightHeadlineId', 'highlight_headline_id'),
    'highlight_headline_id',
    safeText(input?.highlightHeadlineId, 120),
  );
  set(
    hasInputField(input, 'highlightPitchId', 'highlight_pitch_id'),
    'highlight_pitch_id',
    safeText(input?.highlightPitchId, 120),
  );
  set(hasInputField(input, 'highlightTitle', 'highlight_title'), 'highlight_title', safeText(input?.highlightTitle, 500));
  set(hasInputField(input, 'highlightCopy', 'highlight_copy'), 'highlight_copy', safeText(input?.highlightCopy, 5000));
  set(
    hasInputField(input, 'bodyHeadlineId', 'body_headline_id'),
    'body_headline_id',
    safeText(input?.bodyHeadlineId, 120),
  );
  set(
    hasInputField(input, 'bodySubheadingId', 'body_subheading_id'),
    'body_subheading_id',
    safeText(input?.bodySubheadingId, 120),
  );
  set(hasInputField(input, 'bodyPitchId', 'body_pitch_id'), 'body_pitch_id', safeText(input?.bodyPitchId, 120));
  set(hasInputField(input, 'logoWideId', 'logo_wide_id'), 'logo_wide_id', safeText(input?.logoWideId, 120));
  set(hasInputField(input, 'logoSquareId', 'logo_square_id'), 'logo_square_id', safeText(input?.logoSquareId, 120));
  set(hasThemeId, 'theme_id', safeText(input?.themeId, 120) || null);
  set(
    hasSearchPriority,
    'search_priority',
    normalizePageSearchPriority(input?.searchPriority ?? input?.search_priority)
  );

  if (!partial || hasLayout) {
    row.layout_sections = writeLayoutSectionsToRow({
      pageBackground: input?.pageBackground || input?.page_background,
      theme: input?.theme,
      layoutSections: input?.layoutSections || input?.layout_sections,
    });
  }

  if (!partial || hasContentOverrides) {
    row.content_overrides = normalizeContentOverrides(input?.contentOverrides);
  }

  if (input?.name !== undefined) row.name = safeText(input.name, 255);
  if (input?.slug !== undefined) row.slug = safeText(input.slug, 160);
  if (input?.isPublished !== undefined || input?.is_published !== undefined) {
    row.is_published = (input?.isPublished ?? input?.is_published) === true;
  }
  if (input?.isPrivate !== undefined || input?.is_private !== undefined) {
    row.is_private = (input?.isPrivate ?? input?.is_private) === true;
  }

  return row;
}

// A duplicate slug names the slug column too, so it used to satisfy the
// missing-column test below and get "retried" without the slug — writing a NULL
// slug instead of failing. A NULL slug reads as the empty slug, which outranks
// `home` when the public site picks the root page, so on 2026-08-15 a bulk run
// whose "Home" item collided with the real home page silently took over
// delraytennis.starcaster.pro. A constraint violation is never a schema gap.
function isConstraintViolation(message) {
  return message.includes('duplicate key')
    || message.includes('unique constraint')
    || message.includes('already exists')
    || message.includes('23505');
}

function shouldRetryWithoutPublishColumns(result) {
  const message = safeText(result?.error || result?.message || '', 1000).toLowerCase();
  if (isConstraintViolation(message)) return false;
  return message.includes('slug') || message.includes('is_published');
}

function stripPublishColumns(row) {
  if (!row || typeof row !== 'object') return row;
  const next = { ...row };
  delete next.slug;
  delete next.is_published;
  return next;
}

// Page addresses are unique per project. Say which one clashed, so a bulk run
// reports "court-fees is already taken" rather than a raw Postgres string.
function describeSlugConflict(result, row) {
  const message = safeText(result?.error || result?.message || '', 1000).toLowerCase();
  if (!isConstraintViolation(message) || !message.includes('slug')) return result;
  const slug = safeText(row?.slug, 160);
  return {
    ok: false,
    status: 409,
    error: slug
      ? `A page with the address "${slug}" already exists in this project.`
      : 'A page with that address already exists in this project.',
    code: 'slug_taken',
  };
}

function shouldRetryWithoutPrivateColumn(result) {
  const message = safeText(result?.error || result?.message || '', 1000).toLowerCase();
  return message.includes('is_private');
}

function stripPrivateColumn(row) {
  if (!row || typeof row !== 'object') return row;
  const next = { ...row };
  delete next.is_private;
  return next;
}

function shouldRetryWithoutModularColumns(result) {
  const message = safeText(result?.error || result?.message || '', 1000).toLowerCase();
  return message.includes('layout_sections') || message.includes('template_kind');
}

function stripModularColumns(row) {
  if (!row || typeof row !== 'object') return row;
  const next = { ...row };
  delete next.template_kind;
  delete next.layout_sections;
  return next;
}

function shouldRetryWithoutThemeIdColumn(result) {
  const message = safeText(result?.error || result?.message || '', 1000).toLowerCase();
  return message.includes('theme_id');
}

function stripThemeIdColumn(row) {
  if (!row || typeof row !== 'object') return row;
  const next = { ...row };
  delete next.theme_id;
  return next;
}

// docs/SQL/builder_landing_page_page_template_id.sql not applied yet: drop the
// column and save everything else rather than failing the whole page save over
// which template it was built from. Same shape as theme_id above.
function shouldRetryWithoutPageTemplateIdColumn(result) {
  const message = safeText(result?.error || result?.message || '', 1000).toLowerCase();
  return message.includes('page_template_id');
}

function stripPageTemplateIdColumn(row) {
  if (!row || typeof row !== 'object') return row;
  const next = { ...row };
  delete next.page_template_id;
  return next;
}

function shouldRetryWithoutSearchPriorityColumn(result) {
  const message = safeText(result?.error || result?.message || '', 1000).toLowerCase();
  return message.includes('search_priority');
}

function stripSearchPriorityColumn(row) {
  if (!row || typeof row !== 'object') return row;
  const next = { ...row };
  delete next.search_priority;
  return next;
}

function requiresModularColumns(input) {
  const kind = normalizeTemplateKind(input?.templateKind || input?.template_kind);
  const hasSections = input?.layoutSections !== undefined
    || input?.layout_sections !== undefined
    || input?.pageBackground !== undefined;
  return kind === 'modular' || hasSections;
}

async function listPages(limit = 1000, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 5000));
  const query = await scopedListQuery(
    table(),
    `select=*&order=updated_at.desc,created_at.desc&limit=${safeLimit}`,
    scope
  );
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToPage) : [],
  };
}

async function getPage(id, scope = null) {
  const pageId = Number(id || 0) || 0;
  if (!pageId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `select=*&id=eq.${pageId}&limit=1`, scope);

  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 404, error: 'Page not found' };
  return {
    ok: true,
    status: 200,
    data: rowToPage(row),
  };
}

async function createPage(input, scope = null) {
  const row = await scopedInsertRow(table(), inputToRow(input), scope);
  let res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok && shouldRetryWithoutPublishColumns(res)) {
    res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [stripPublishColumns(row)],
    });
  }
  if (!res.ok && shouldRetryWithoutModularColumns(res)) {
    if (requiresModularColumns(input)) {
      return {
        ok: false,
        status: 500,
        error: 'Modular pages require the template_kind and layout_sections columns. Run docs/builder_landing_page_modular_migration.sql in Supabase.',
      };
    }
    res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [stripModularColumns(stripPublishColumns(row))],
    });
  }
  if (!res.ok && shouldRetryWithoutThemeIdColumn(res)) {
    res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [stripThemeIdColumn(row)],
    });
  }
  if (!res.ok && shouldRetryWithoutPageTemplateIdColumn(res)) {
    res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [stripPageTemplateIdColumn(row)],
    });
  }
  // See updatePage: the ranking hint never blocks creating a page.
  if (!res.ok && shouldRetryWithoutSearchPriorityColumn(res)) {
    res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [stripSearchPriorityColumn(row)],
    });
  }
  if (!res.ok && shouldRetryWithoutPrivateColumn(res)) {
    res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [stripPrivateColumn(row)],
    });
  }
  if (!res.ok) return describeSlugConflict(res, row);
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  const page = rowToPage(created);
  await syncContentItemForPage(page, scope);
  return {
    ok: true,
    status: 201,
    data: page,
  };
}

/**
 * Does this save touch the layout? Metadata-only saves (rename, visibility,
 * search priority) are not worth a revision and must not pay for the extra
 * read below.
 */
function touchesLayout(input) {
  return hasInputField(input, 'layoutSections', 'layout_sections');
}

/**
 * Has the live page moved on since the editor last saw it?
 *
 * `expected` is the updated_at the caller believes it is editing; `live` is
 * what the row actually holds now. Newer live value means somebody else saved
 * in between, and writing would destroy their work unseen -- which is exactly
 * what happened to the Delray home page on 2026-08-15 (an entire section lost,
 * no warning shown, recoverable only through the revision history).
 *
 * This FAILS OPEN on purpose. A missing, blank, or unparseable timestamp on
 * either side means "cannot tell", and the save proceeds. The guard exists to
 * catch a specific, provable collision; it must never become a way for the
 * Builder to stop accepting saves. Every caller that does not send an expected
 * value -- propagation, scripts, older clients -- is unaffected.
 */
function isStaleEdit(expected, live) {
  const claimed = String(expected || '').trim();
  const current = String(live || '').trim();
  if (!claimed || !current) return false;
  // Postgres keeps microseconds and Date.parse truncates to milliseconds, so
  // compare the raw strings first: an untouched page round-trips byte for byte.
  if (claimed === current) return false;
  const claimedAt = Date.parse(claimed);
  const currentAt = Date.parse(current);
  if (!Number.isFinite(claimedAt) || !Number.isFinite(currentAt)) return false;
  return currentAt > claimedAt;
}

/**
 * @param {object} [options]
 * @param {object} [options.previous]  The page as it stood before this save.
 *   Callers that already hold it -- canonical propagation maps over pages it
 *   just listed -- pass it so we skip the read.
 * @param {string} [options.reason]    'save' | 'propagate' | 'revert'
 * @param {boolean} [options.skipRevision]  Set when the caller is itself
 *   writing history and would otherwise record its own restore twice.
 * @param {string} [options.propagationRunId]  Set only by a canonical-section
 *   fan-out: the shared id stamped on every revision that one push mints, so
 *   the whole run can be undone as a single action.
 * @param {object} [options.actor]     The signed-in user making this save
 *   ({ id, name, email }), credited on the revision it banks. Absent means the
 *   revision records no author -- a script, a cron, or a caller that has not
 *   been threaded through yet.
 * @param {string} [options.expectedUpdatedAt]  The page's updated_at as the
 *   caller last saw it. Present, and older than the live row, means the caller
 *   is working from a stale copy: refuse with 409 rather than overwrite.
 *   Absent means no opinion, and the save proceeds -- see isStaleEdit.
 */
async function updatePage(id, input, scope = null, options = {}) {
  const pageId = Number(id || 0) || 0;
  if (!pageId) return { ok: false, status: 400, error: 'id is required' };

  // Capture the CURRENT state before overwriting it. Reading first is what
  // protects a page whose history is empty because it predates the feature --
  // its first save banks the good layout rather than the damaged one.
  let previous = options.previous || null;
  const wantsRevision = !options.skipRevision && touchesLayout(input);
  const expectedUpdatedAt = String(options.expectedUpdatedAt || '').trim();
  // The staleness check needs the same row the revision does, so one read
  // serves both. A metadata-only save that carries an expected value pays for
  // the read it would otherwise have skipped -- worth it, since a rename can
  // collide too.
  if ((wantsRevision || expectedUpdatedAt) && !previous) {
    const existing = await getPage(pageId, scope);
    if (existing.ok) previous = existing.data;
  }

  if (expectedUpdatedAt && previous && isStaleEdit(expectedUpdatedAt, previous.updatedAt)) {
    // Best-effort name for the warning; '' whenever it cannot be established
    // beyond doubt, and the UI says "Somebody else" instead.
    const savedByName = await findSaveAuthor(pageId, previous.updatedAt, scope);
    return {
      ok: false,
      status: 409,
      code: 'STALE_EDITOR',
      error: savedByName
        ? `${savedByName} saved this page after you opened it. Reload to see their version, or overwrite it.`
        : 'This page was saved by someone else after you opened it. Reload to see their version, or overwrite it.',
      conflict: { updatedAt: String(previous.updatedAt || ''), savedByName },
    };
  }

  const row = await scopedPatchRow(table(), inputToRow(input, { partial: true }), scope);
  const query = await scopedIdQuery(table(), `id=eq.${pageId}&select=*`, scope);
  let res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok && shouldRetryWithoutPublishColumns(res)) {
    res = await sbQuery({
      method: 'PATCH',
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
      body: stripPublishColumns(row),
    });
  }
  if (!res.ok && shouldRetryWithoutModularColumns(res)) {
    if (requiresModularColumns(input)) {
      return {
        ok: false,
        status: 500,
        error: 'Modular pages require the template_kind and layout_sections columns. Run docs/builder_landing_page_modular_migration.sql in Supabase.',
      };
    }
    res = await sbQuery({
      method: 'PATCH',
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
      body: stripModularColumns(stripPublishColumns(row)),
    });
  }
  if (!res.ok && shouldRetryWithoutThemeIdColumn(res)) {
    res = await sbQuery({
      method: 'PATCH',
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
      body: stripThemeIdColumn(row),
    });
  }
  if (!res.ok && shouldRetryWithoutPageTemplateIdColumn(res)) {
    res = await sbQuery({
      method: 'PATCH',
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
      body: stripPageTemplateIdColumn(row),
    });
  }
  if (!res.ok && shouldRetryWithoutPrivateColumn(res)) {
    res = await sbQuery({
      method: 'PATCH',
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
      body: stripPrivateColumn(row),
    });
  }
  // docs/SQL/page_search_priority.sql not applied yet: drop the column and
  // save everything else rather than failing the whole page save over a
  // ranking hint. Same shape as theme_id above.
  if (!res.ok && shouldRetryWithoutSearchPriorityColumn(res)) {
    res = await sbQuery({
      method: 'PATCH',
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
      body: stripSearchPriorityColumn(row),
    });
  }
  if (!res.ok) return describeSlugConflict(res, row);
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Page not found' };
  const page = rowToPage(updated);

  // Only after the save has actually landed, and never in a way that can fail
  // it: recordPageRevision swallows everything, including the table being
  // absent on a deployment that has not run the migration yet.
  if (wantsRevision && previous) {
    await recordPageRevision(pageId, previous, page.layoutSections, {
      scope,
      reason: options.reason || 'save',
      actor: options.actor || null,
      propagationRunId: options.propagationRunId || '',
    });
  }

  await syncContentItemForPage(page, scope);
  return {
    ok: true,
    status: 200,
    data: page,
  };
}

async function deletePage(id, scope = null) {
  const pageId = Number(id || 0) || 0;
  if (!pageId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `id=eq.${pageId}&select=*`, scope);

  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const removed = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!removed) return { ok: false, status: 404, error: 'Page not found' };
  await removeContentItemForPage(String(pageId), scope);
  return {
    ok: true,
    status: 200,
    data: rowToPage(removed),
  };
}

async function syncContentItemForPage(page, scope) {
  try {
    const { syncWebPageContentItem } = require('./webPageContentSync');
    await syncWebPageContentItem(page, scope);
  } catch (_) {
    // Optional mirror into content_items
  }
}

async function removeContentItemForPage(pageId, scope) {
  try {
    const { BUILDER_PAGE_SOURCE, deleteContentItemBySource } = require('./contentItemsStore');
    await deleteContentItemBySource(BUILDER_PAGE_SOURCE, String(pageId || ''), scope);
  } catch (_) {
    // content_items sync is best-effort
  }
}

/**
 * After a saved section is updated, push the new content to every page that
 * follows it.
 *
 * THE ENGINE MOVED. Sections and modules used to have one of these each, and
 * they disagreed about awaiting, templates, opt-outs, undo and polarity -- so
 * there is now exactly one, `lib/canonicalPropagation.js`, and both levels are
 * thin wrappers on it. This name is kept because callers and tests reach for
 * it here.
 *
 * MUST be awaited before the response is sent. Serverless freezes the function
 * once the response goes out, so calling this fire-and-forget kills it partway
 * down the page list -- leaving some pages on the new content and the rest
 * silently stale, with a different split every save.
 */
function propagateCanonicalSection(savedSectionId, updatedSection, scope, options = {}) {
  // Required lazily: the engine requires this store back for its page writes.
  return require('./canonicalPropagation')
    .propagateCanonicalSection(savedSectionId, updatedSection, scope, options);
}

async function enrichPagesWithThemeShell(pages, projectId) {
  if (!Array.isArray(pages) || !pages.length) return pages;

  const { listThemes } = require('./builderThemesStore');
  const scope = projectId ? { projectId, userId: '' } : null;
  const themesResult = await listThemes(500, scope);
  if (!themesResult.ok || !Array.isArray(themesResult.data) || !themesResult.data.length) {
    return pages;
  }

  const themeById = new Map(
    themesResult.data.map((theme) => [String(theme.id || '').trim(), theme])
  );

  const defaultTheme = themesResult.data[0] || null;

  return pages.map((page) => {
    const themeId = String(page.themeId || '').trim();
    const theme = themeId
      ? (themeById.get(themeId) || defaultTheme)
      : defaultTheme;
    if (!theme) return page;
    return {
      ...page,
      themeShell: {
        stylesPageBackground: theme.stylesPageBackground ?? theme.pageBackground ?? null,
        pageBackground: theme.stylesPageBackground ?? theme.pageBackground ?? null,
        backgroundColor: theme.backgroundColor,
        primaryColor: theme.primaryColor,
        secondaryColor: theme.secondaryColor,
        accentColor: theme.accentColor,
        borderThickness: theme.borderThickness,
        borderRadius: theme.borderRadius,
        containerBlur: theme.containerBlur,
        contrastLevel: theme.contrastLevel,
        topMargin: theme.topMargin,
        bottomMargin: theme.bottomMargin,
        sideMargins: theme.sideMargins,
        typography: theme.typography ?? null,
        palette: theme.palette ?? null,
        treatments: theme.treatments ?? null,
        heroBanner: theme.heroBanner ?? null,
      },
    };
  });
}

async function listPublishedPagesForProject(projectIdInput) {
  const projectId = String(projectIdInput || '').trim();
  if (!projectId) return { ok: false, status: 400, error: 'projectId is required' };

  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `select=*&project_id=eq.${encodeURIComponent(projectId)}&or=(is_published.eq.true,is_published.is.null)&is_private=eq.false&order=updated_at.desc,created_at.desc&limit=200`,
  });
  if (!res.ok) return res;
  const rows = Array.isArray(res.data) ? res.data.map(rowToPage) : [];
  rows.sort((a, b) => {
    const rank = (slug) => {
      const s = String(slug ?? '').trim();
      if (s === '') return 0;
      if (s === 'home') return 1;
      return 2;
    };
    const diff = rank(a.slug) - rank(b.slug);
    if (diff !== 0) return diff;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
  const { filterPublicSitePages } = require('./publicSitePageFilter');
  const filtered = filterPublicSitePages(rows);
  // Serve the frame from the LIVE saved section, not from each page's stored
  // copy. A visitor then sees what the master says right now, whether or not
  // propagateCanonicalSection ever finished — which on 2026-07-22 it did not,
  // leaving 30 pages updated and 20 stale.
  const { resolvePagesFrameSectionsForProject } = require('./publicPageFrameResolve');
  const resolved = await resolvePagesFrameSectionsForProject(filtered, projectId);
  const data = await enrichPagesWithThemeShell(resolved, projectId);
  return {
    ok: true,
    status: 200,
    data,
  };
}

/**
 * One published page, by slug — instead of the whole site.
 *
 * WHY THIS EXISTS
 * The public site fetched EVERY published page in one request and picked the
 * one it needed in the browser. Measured on Marinoff (51 pages): 1.36 MB
 * downloaded to display roughly 30 KB of page, including 51 copies of the
 * header. That was the single largest cost on the public site, and it grew
 * with every page the operator added.
 *
 * Deliberately built on the same path as the list version — same filters, same
 * frame resolution, same theme shell — so the two cannot answer differently
 * for the same page. The list endpoint stays: the site-search RESULTS module
 * genuinely needs every page to build its index, and that is the only thing
 * that still does.
 *
 * Slug matching mirrors the browser's findPageForPath: an empty slug and
 * "home" both answer the site root, and matching is case-insensitive.
 */
async function getPublishedPageForProject(projectIdInput, slugInput) {
  const projectId = String(projectIdInput || '').trim();
  if (!projectId) return { ok: false, status: 400, error: 'projectId is required' };

  const wanted = String(slugInput ?? '').trim().toLowerCase().replace(/^\/+|\/+$/g, '');

  // Read the project's published pages through the SAME function the list
  // endpoint uses, then pick. Selecting one row in SQL would duplicate the
  // publish/private filters and the frame resolution, and the two copies would
  // drift — the payload win is in what crosses the WIRE, not in the query.
  const listResult = await listPublishedPagesForProject(projectId);
  if (!listResult.ok) return listResult;

  const pages = Array.isArray(listResult.data) ? listResult.data : [];
  const slugOf = (page) => String(page?.slug ?? '').trim().toLowerCase();

  const isRoot = wanted === '' || wanted === 'home';
  const page = isRoot
    ? (pages.find((p) => slugOf(p) === '') ?? pages.find((p) => slugOf(p) === 'home') ?? null)
    : (pages.find((p) => slugOf(p) === wanted) ?? null);

  if (!page) return { ok: false, status: 404, error: 'Page not found', code: 'PAGE_NOT_FOUND' };
  return { ok: true, status: 200, data: page };
}

async function listRestrictedAdminSitePagesForProject(projectIdInput) {
  const projectId = String(projectIdInput || '').trim();
  if (!projectId) return { ok: false, status: 400, error: 'projectId is required' };

  // Include private pages — admin slugs (dashboard, etc.) are often marked Private
  // so they stay out of GET /api/public/pages while still reachable after login.
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `select=*&project_id=eq.${encodeURIComponent(projectId)}&or=(is_published.eq.true,is_published.is.null)&order=updated_at.desc,created_at.desc&limit=200`,
  });
  if (!res.ok) return res;
  const rows = Array.isArray(res.data) ? res.data.map(rowToPage) : [];
  rows.sort((a, b) => {
    const rank = (slug) => {
      const s = String(slug ?? '').trim();
      if (s === '') return 0;
      if (s === 'home') return 1;
      return 2;
    };
    const diff = rank(a.slug) - rank(b.slug);
    if (diff !== 0) return diff;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
  const { filterRestrictedAdminSitePages } = require('./publicSitePageFilter');
  const filtered = filterRestrictedAdminSitePages(rows);
  // Same as the public list: the tenant's logged-in admin pages share the
  // canonical header, so they get the live master too.
  const { resolvePagesFrameSectionsForProject } = require('./publicPageFrameResolve');
  const resolved = await resolvePagesFrameSectionsForProject(filtered, projectId);
  const data = await enrichPagesWithThemeShell(resolved, projectId);
  return {
    ok: true,
    status: 200,
    data,
  };
}

async function bulkSetPublished(pageIds, isPublished, scope = null) {
  const ids = (Array.isArray(pageIds) ? pageIds : [])
    .map((id) => Number(id || 0) || 0)
    .filter((id) => id > 0);
  if (!ids.length) return { ok: false, status: 400, error: 'pageIds is required' };

  const published = isPublished === true;
  const results = await Promise.all(
    ids.map(async (pageId) => {
      const res = await updatePage(pageId, { isPublished: published }, scope);
      return {
        id: String(pageId),
        ok: res.ok,
        error: res.ok ? '' : safeText(res.error || 'Update failed', 500),
      };
    })
  );
  const failed = results.filter((row) => !row.ok);
  if (failed.length === results.length) {
    return { ok: false, status: 500, error: failed[0]?.error || 'Could not update pages' };
  }
  return {
    ok: true,
    status: 200,
    data: results,
  };
}

module.exports = {
  listPages,
  getPage,
  createPage,
  updatePage,
  deletePage,
  rowToPage,
  // Exported for scripts/builder/pageSearchPriority.test.js: the trip from an
  // editor payload to a database row is where a new field silently vanishes.
  inputToRow,
  // Exported for scripts/builder/slugConflict.test.js: a duplicate slug must
  // fail loudly, never be "retried" into a NULL slug that hijacks the site root.
  shouldRetryWithoutPublishColumns,
  describeSlugConflict,
  // Exported for scripts/builder/staleEditorGuard.test.js: this predicate
  // decides whether a save is refused, so its fail-open behaviour is tested
  // directly rather than inferred from the endpoint.
  isStaleEdit,
  propagateCanonicalSection,
  listPublishedPagesForProject,
  getPublishedPageForProject,
  listRestrictedAdminSitePagesForProject,
  bulkSetPublished,
};
