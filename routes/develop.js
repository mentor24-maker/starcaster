'use strict';

const { sendOk, sendErr, parseJsonBody } = require('./http');
const { exec } = require('child_process');
const { requestProjectScope } = require('../lib/requestProjectScope');
const { listForms, createForm, updateForm, deleteForm } = require('../lib/developFormsStore');
const {
  listLandingPages,
  getLandingPage,
  createLandingPage,
  updateLandingPage,
  deleteLandingPage,
} = require('../lib/developLandingPagesStore');
const {
  listPageTemplates,
  createPageTemplate,
  updatePageTemplate,
  deletePageTemplate,
} = require('../lib/developPageTemplatesStore');
const {
  listEmailTemplates,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
} = require('../lib/developEmailTemplatesStore');
const {
  listThemes,
  createTheme,
  updateTheme,
  deleteTheme,
} = require('../lib/developThemesStore');
const {
  listModules,
  createModule,
  updateModule,
  deleteModule,
} = require('../lib/developModulesStore');
const {
  listDevelopModuleClasses,
  createDevelopModuleClass,
  updateDevelopModuleClass,
  deleteDevelopModuleClass,
} = require('../lib/developModuleClassesStore');
const { createIcon } = require('../lib/developIconStore');
const { createAsset, rowToAsset } = require('../lib/assetsStore');
const { isConfigured: isAssetStorageConfigured, uploadAssetFile } = require('../lib/assetStorage');
const {
  listAssetCategories,
  createAssetCategory,
  rowToAssetCategory,
} = require('../lib/assetCategoriesStore');
const {
  listExtensions,
  createExtension,
  updateExtension,
  deleteExtension,
  trackExtensionUse,
} = require('../lib/developExtensionsStore');
const {
  getManagerConfig,
  saveManagerConfig,
} = require('../lib/developExtensionsManagerStore');
const { listContacts, createContact, updateContact, rowToContact } = require('../lib/ContactsStore');
const { savePollSubmission, getPollResults } = require('../lib/pollSubmissionsStore');

let playwrightChromium = null;
function getChromium() {
  if (playwrightChromium) return playwrightChromium;
  // Lazy-load Playwright so missing optional dependency does not crash unrelated APIs.
  playwrightChromium = require('playwright').chromium;
  return playwrightChromium;
}

function nextId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

async function handle(req, res, pathname, method) {
  const requestMethod = String(method || '').toUpperCase();
  const scope = requestProjectScope(req);

  if (pathname === '/api/develop/forms' && requestMethod === 'GET') {
    const forms = await listForms(scope);
    return sendOk(res, 200, forms, { forms }, { total: forms.length }), true;
  }

  if (pathname === '/api/develop/forms' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const name = String(body.name || '').trim();
    const formType = String(body.formType || '').trim();
    const contactType = String(body.contactType || body.contact_type || '').trim();
    const leadMagnetType = String(body.leadMagnetType || body.lead_magnet_type || '').trim();
    const leadMagnetId = String(body.leadMagnetId || body.lead_magnet_id || '').trim();
    const ctaId = String(body.ctaId || body.cta_id || '').trim();
    const heading = String(body.heading || '').trim();
    const submitLabel = String(body.submitLabel || '').trim();
    const successMessage = String(body.successMessage || body.success_message || '').trim();
    const errorMessage = String(body.errorMessage || body.error_message || '').trim();
    const fields = Array.isArray(body.fields) ? body.fields : [];

    if (!name) return sendErr(res, 400, 'name is required', { code: 'VALIDATION_ERROR' }), true;
    if (!formType) return sendErr(res, 400, 'formType is required', { code: 'VALIDATION_ERROR' }), true;
    if (!contactType) return sendErr(res, 400, 'contactType is required', { code: 'VALIDATION_ERROR' }), true;
    if (!heading) return sendErr(res, 400, 'heading is required', { code: 'VALIDATION_ERROR' }), true;
    if (!submitLabel) return sendErr(res, 400, 'submitLabel is required', { code: 'VALIDATION_ERROR' }), true;
    if (!fields.length) return sendErr(res, 400, 'fields are required', { code: 'VALIDATION_ERROR' }), true;

    const form = await createForm({
      name,
      formType,
      contactType,
      leadMagnetType,
      leadMagnetId,
      ctaId,
      heading,
      submitLabel,
      successMessage,
      errorMessage,
      accentColor: String(body.accentColor || '').trim(),
      matchLandingColor: Boolean(body.matchLandingColor),
      landingColorMode: String(body.landingColorMode || '').trim(),
      useLandingBackground: Boolean(body.useLandingBackground),
      fields,
    }, scope);

    if (!form) return sendErr(res, 500, 'Could not create form'), true;
    return sendOk(res, 201, form, { form }), true;
  }

  if (pathname === '/api/develop/extensions' && requestMethod === 'GET') {
    const result = await listExtensions(undefined, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not load extensions'), true;
    const extensions = Array.isArray(result.data) ? result.data : [];
    return sendOk(res, 200, extensions, { extensions }, { total: extensions.length }), true;
  }

  if (pathname === '/api/develop/extensions' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const name = String(body.name || '').trim();
    const extensionType = String(body.extensionType || body.extension_type || '').trim();
    const status = String(body.status || '').trim();

    if (!name) return sendErr(res, 400, 'name is required', { code: 'VALIDATION_ERROR' }), true;
    if (!extensionType) return sendErr(res, 400, 'extensionType is required', { code: 'VALIDATION_ERROR' }), true;
    if (!status) return sendErr(res, 400, 'status is required', { code: 'VALIDATION_ERROR' }), true;

    const extensionRes = await createExtension({
      name,
      extensionType,
      slug: String(body.slug || '').trim(),
      parentId: String(body.parentId || body.parent_id || '').trim(),
      status,
      tags: String(body.tags || '').trim(),
      summary: String(body.summary || '').trim(),
      definition: String(body.definition || '').trim(),
      launchPageId: String(body.launchPageId || body.launch_page_id || '').trim(),
      isFeatured: body.isFeatured === true || body.is_featured === true,
    }, scope);
    if (!extensionRes.ok) return sendErr(res, extensionRes.status || 500, extensionRes.error || 'Could not create extension'), true;
    return sendOk(res, 201, extensionRes.data, { extension: extensionRes.data }), true;
  }

  if (pathname === '/api/develop/extensions-manager' && requestMethod === 'GET') {
    const result = await getManagerConfig(scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not load extension manager config'), true;
    return sendOk(res, 200, result.data, { manager: result.data }), true;
  }

  if (pathname === '/api/develop/extensions-manager' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const result = await saveManagerConfig({
      defaultFilters: body && typeof body.defaultFilters === 'object' ? body.defaultFilters : {},
      defaultSortKey: String(body.defaultSortKey || '').trim(),
      defaultSortDir: String(body.defaultSortDir || '').trim(),
    }, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not save extension manager config'), true;
    return sendOk(res, 200, result.data, { manager: result.data }), true;
  }

  if (pathname === '/api/develop/landing-pages' && requestMethod === 'GET') {
    const result = await listLandingPages(undefined, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not load landing pages'), true;
    const landingPages = Array.isArray(result.data) ? result.data : [];
    return sendOk(res, 200, landingPages, { landingPages }, { total: landingPages.length }), true;
  }

  if (pathname === '/api/develop/landing-pages' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const name = String(body.name || '').trim();
    const templateId = String(body.templateId || '').trim();

    if (!name) return sendErr(res, 400, 'name is required', { code: 'VALIDATION_ERROR' }), true;
    if (!templateId) return sendErr(res, 400, 'templateId is required', { code: 'VALIDATION_ERROR' }), true;

    const result = await createLandingPage({
      name,
      templateKind: body.templateKind || body.template_kind,
      templateId,
      primaryColor: String(body.primaryColor || '').trim(),
      backgroundColor: String(body.backgroundColor || '').trim(),
      accentColor: String(body.accentColor || '').trim(),
      formId: String(body.formId || '').trim(),
      leadMagnetId: String(body.leadMagnetId || '').trim(),
      headlineId: String(body.headlineId || '').trim(),
      pitchId: String(body.pitchId || '').trim(),
      ctaId: String(body.ctaId || '').trim(),
      websiteBannerImageId: String(body.websiteBannerImageId || '').trim(),
      backgroundImageId: String(body.backgroundImageId || '').trim(),
      featureImageId: String(body.featureImageId || '').trim(),
      highlightImageId: String(body.highlightImageId || '').trim(),
      featureHeadlineId: String(body.featureHeadlineId || '').trim(),
      featureSubheadingId: String(body.featureSubheadingId || '').trim(),
      featureTitle: String(body.featureTitle || '').trim(),
      featureCopy: String(body.featureCopy || '').trim(),
      highlightHeadlineId: String(body.highlightHeadlineId || '').trim(),
      highlightPitchId: String(body.highlightPitchId || '').trim(),
      highlightTitle: String(body.highlightTitle || '').trim(),
      highlightCopy: String(body.highlightCopy || '').trim(),
      bodyHeadlineId: String(body.bodyHeadlineId || '').trim(),
      bodySubheadingId: String(body.bodySubheadingId || '').trim(),
      bodyPitchId: String(body.bodyPitchId || '').trim(),
      logoWideId: String(body.logoWideId || '').trim(),
      logoSquareId: String(body.logoSquareId || '').trim(),
      layoutSections: Array.isArray(body.layoutSections || body.layout_sections)
        ? (body.layoutSections || body.layout_sections)
        : [],
      contentOverrides: body && typeof body.contentOverrides === 'object' ? body.contentOverrides : {},
    }, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not create landing page'), true;
    return sendOk(res, 201, result.data, { landingPage: result.data }), true;
  }

  if (pathname === '/api/develop/page-templates' && requestMethod === 'GET') {
    const result = await listPageTemplates(undefined, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not load page templates'), true;
    const pageTemplates = Array.isArray(result.data) ? result.data : [];
    return sendOk(res, 200, pageTemplates, { pageTemplates }, { total: pageTemplates.length }), true;
  }

  if (pathname === '/api/develop/page-templates' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const name = String(body.name || '').trim();
    const templateId = String(body.templateId || '').trim();

    if (!name) return sendErr(res, 400, 'name is required', { code: 'VALIDATION_ERROR' }), true;
    if (!templateId) return sendErr(res, 400, 'templateId is required', { code: 'VALIDATION_ERROR' }), true;

    const result = await createPageTemplate({
      name,
      templateKind: body.templateKind || body.template_kind,
      templateId,
      primaryColor: String(body.primaryColor || '').trim(),
      backgroundColor: String(body.backgroundColor || '').trim(),
      accentColor: String(body.accentColor || '').trim(),
      formId: String(body.formId || '').trim(),
      leadMagnetId: String(body.leadMagnetId || '').trim(),
      headlineId: String(body.headlineId || '').trim(),
      pitchId: String(body.pitchId || '').trim(),
      ctaId: String(body.ctaId || '').trim(),
      websiteBannerImageId: String(body.websiteBannerImageId || '').trim(),
      backgroundImageId: String(body.backgroundImageId || '').trim(),
      featureImageId: String(body.featureImageId || '').trim(),
      highlightImageId: String(body.highlightImageId || '').trim(),
      featureHeadlineId: String(body.featureHeadlineId || '').trim(),
      featureSubheadingId: String(body.featureSubheadingId || '').trim(),
      featureTitle: String(body.featureTitle || '').trim(),
      featureCopy: String(body.featureCopy || '').trim(),
      highlightHeadlineId: String(body.highlightHeadlineId || '').trim(),
      highlightPitchId: String(body.highlightPitchId || '').trim(),
      highlightTitle: String(body.highlightTitle || '').trim(),
      highlightCopy: String(body.highlightCopy || '').trim(),
      bodyHeadlineId: String(body.bodyHeadlineId || '').trim(),
      bodySubheadingId: String(body.bodySubheadingId || '').trim(),
      bodyPitchId: String(body.bodyPitchId || '').trim(),
      logoWideId: String(body.logoWideId || '').trim(),
      logoSquareId: String(body.logoSquareId || '').trim(),
      layoutSections: Array.isArray(body.layoutSections || body.layout_sections)
        ? (body.layoutSections || body.layout_sections)
        : [],
      contentOverrides: body && typeof body.contentOverrides === 'object' ? body.contentOverrides : {},
    }, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not create page template'), true;
    return sendOk(res, 201, result.data, { pageTemplate: result.data }), true;
  }

  if (pathname === '/api/develop/email-templates' && requestMethod === 'GET') {
    const result = await listEmailTemplates(undefined, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not load email templates'), true;
    const emailTemplates = Array.isArray(result.data) ? result.data : [];
    return sendOk(res, 200, emailTemplates, { emailTemplates }, { total: emailTemplates.length }), true;
  }

  if (pathname === '/api/develop/themes' && requestMethod === 'GET') {
    const result = await listThemes(undefined, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not load themes'), true;
    const themes = Array.isArray(result.data) ? result.data : [];
    return sendOk(res, 200, themes, { themes }, { total: themes.length }), true;
  }

  if (pathname === '/api/develop/themes' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const name = String(body.name || '').trim();
    if (!name) return sendErr(res, 400, 'name is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await createTheme({
      name,
      primaryColor: String(body.primaryColor || '').trim(),
      backgroundColor: String(body.backgroundColor || '').trim(),
      accentColor: String(body.accentColor || '').trim(),
      borderThickness: body.borderThickness,
      borderRadius: body.borderRadius,
      containerBlur: body.containerBlur,
      contrastLevel: body.contrastLevel,
      logoWideId: String(body.logoWideId || '').trim(),
      logoSquareId: String(body.logoSquareId || '').trim(),
      featureImageId: String(body.featureImageId || '').trim(),
      backgroundImageId: String(body.backgroundImageId || '').trim(),
    }, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not create theme'), true;
    return sendOk(res, 201, result.data, { theme: result.data }), true;
  }

  if (pathname === '/api/develop/modules' && requestMethod === 'GET') {
    const modules = await listModules(scope);
    return sendOk(res, 200, modules, { modules }, { total: modules.length }), true;
  }

  if (pathname === '/api/develop/modules' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const name = String(body.name || '').trim();
    const moduleType = String(body.moduleType || body.module_type || '').trim();
    if (!name) return sendErr(res, 400, 'name is required', { code: 'VALIDATION_ERROR' }), true;
    if (!moduleType) return sendErr(res, 400, 'moduleType is required', { code: 'VALIDATION_ERROR' }), true;
    const module = await createModule({
      name,
      moduleType,
      classId: body.classId || body.class_id,
      settings: body && typeof body.settings === 'object' ? body.settings : {},
    }, scope);
    return sendOk(res, 201, module, { module }), true;
  }

  if (pathname === '/api/develop/module-classes' && requestMethod === 'GET') {
    const result = await listDevelopModuleClasses(5000, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not load module classes'), true;
    const classes = Array.isArray(result.data) ? result.data : [];
    return sendOk(res, 200, classes, { classes }, { total: classes.length }), true;
  }

  if (pathname === '/api/develop/module-classes' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const name = String(body.name || '').trim();
    if (!name) return sendErr(res, 400, 'name is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await createDevelopModuleClass({ name }, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not create module class'), true;
    return sendOk(res, 201, result.data, { class: result.data }), true;
  }

  if (pathname === '/api/develop/email-templates' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const name = String(body.name || '').trim();
    if (!name) return sendErr(res, 400, 'name is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await createEmailTemplate({
      templateKind: body.templateKind || body.template_kind,
      slug: body.slug,
      name,
      summary: body.summary,
      subject: body.subject,
      heading: body.heading,
      body: body.body,
      cta: body.cta,
      blocks: Array.isArray(body.blocks) ? body.blocks : [],
    }, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not create email template'), true;
    return sendOk(res, 201, result.data, { emailTemplate: result.data }), true;
  }

  const themeMatch = pathname.match(/^\/api\/develop\/themes\/([^/]+)$/);
  if (themeMatch && requestMethod === 'PATCH') {
    const body = await parseJsonBody(req);
    const result = await updateTheme(themeMatch[1], {
      name: String(body.name || '').trim(),
      primaryColor: String(body.primaryColor || '').trim(),
      backgroundColor: String(body.backgroundColor || '').trim(),
      accentColor: String(body.accentColor || '').trim(),
      borderThickness: body.borderThickness,
      borderRadius: body.borderRadius,
      containerBlur: body.containerBlur,
      contrastLevel: body.contrastLevel,
      logoWideId: String(body.logoWideId || '').trim(),
      logoSquareId: String(body.logoSquareId || '').trim(),
      featureImageId: String(body.featureImageId || '').trim(),
      backgroundImageId: String(body.backgroundImageId || '').trim(),
    }, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not update theme'), true;
    return sendOk(res, 200, result.data, { theme: result.data }), true;
  }

  if (themeMatch && requestMethod === 'DELETE') {
    const result = await deleteTheme(themeMatch[1], scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not delete theme'), true;
    return sendOk(res, 200, result.data, { theme: result.data }), true;
  }

  const moduleMatch = pathname.match(/^\/api\/develop\/modules\/([^/]+)$/);
  if (moduleMatch && requestMethod === 'PATCH') {
    const body = await parseJsonBody(req);
    const module = await updateModule(moduleMatch[1], {
      name: String(body.name || '').trim(),
      moduleType: String(body.moduleType || body.module_type || '').trim(),
      classId: body.classId !== undefined ? body.classId : body.class_id,
      settings: body && typeof body.settings === 'object' ? body.settings : {},
    }, scope);
    if (!module) return sendErr(res, 500, 'Could not update module'), true;
    return sendOk(res, 200, module, { module }), true;
  }

  if (moduleMatch && requestMethod === 'DELETE') {
    const ok = await deleteModule(moduleMatch[1], scope);
    if (!ok) return sendErr(res, 500, 'Could not delete module'), true;
    return sendOk(res, 200, { id: moduleMatch[1] }, { module: { id: moduleMatch[1] } }), true;
  }

  const classMatch = pathname.match(/^\/api\/develop\/module-classes\/([^/]+)$/);
  if (classMatch && requestMethod === 'PATCH') {
    const body = await parseJsonBody(req);
    const result = await updateDevelopModuleClass(classMatch[1], { name: String(body.name || '').trim() }, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not update module class'), true;
    return sendOk(res, 200, result.data, { class: result.data }), true;
  }

  if (classMatch && requestMethod === 'DELETE') {
    const result = await deleteDevelopModuleClass(classMatch[1], scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not delete module class'), true;
    return sendOk(res, 200, result.data, { class: result.data }), true;
  }

  if (pathname === '/api/develop/icon-builder' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const objectType = String(body.object_type || body.objectType || '').trim();
    const objectName = String(body.object_name || body.objectName || '').trim();
    const manualConfirmed = body.manual_confirmed === true || body.manualConfirmed === true;
    const iconSpec = body && typeof body.icon_spec === 'object' ? body.icon_spec : (body.iconSpec || {});

    if (!manualConfirmed) {
      return sendErr(res, 400, 'manual_confirmed=true is required', { code: 'VALIDATION_ERROR' }), true;
    }
    if (!objectName) {
      return sendErr(res, 400, 'object_name is required', { code: 'VALIDATION_ERROR' }), true;
    }

    const icon = createIcon({
      workspaceId: String(body.workspace_id || body.workspaceId || '').trim(),
      objectType,
      objectName,
      category: String(body.category || '').trim(),
      summary: String(body.summary || body.object_summary || '').trim(),
      visualStyle: String(iconSpec.visual_style || iconSpec.visualStyle || '').trim(),
      palette: String(iconSpec.palette || '').trim(),
      size: String(iconSpec.size || '').trim(),
    });

    return sendOk(res, 201, icon, { icon }), true;
  }

  if (pathname === '/api/develop/extensions/screenshot-capture' && requestMethod === 'POST') {
    if (!isAssetStorageConfigured()) {
      return sendErr(
        res,
        400,
        'No asset storage backend is configured. Configure Vercel Blob token or Google Drive credentials.',
        { code: 'ASSET_STORAGE_NOT_CONFIGURED' }
      ), true;
    }

    const body = await parseJsonBody(req);
    const targetUrl = String(body.url || '').trim();
    const assetName = String(body.assetName || body.asset_name || '').trim();
    const tags = Array.isArray(body.tags)
      ? body.tags
      : String(body.tags || '')
          .split(',')
          .map((item) => String(item || '').trim())
          .filter(Boolean);

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (_) {
      return sendErr(res, 400, 'A valid URL is required', { code: 'VALIDATION_ERROR' }), true;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return sendErr(res, 400, 'URL must use http or https', { code: 'VALIDATION_ERROR' }), true;
    }

    let screenshotBuffer;
    try {
      const chromium = getChromium();
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({
          viewport: { width: 1920, height: 1080 },
          deviceScaleFactor: 1 / 3,
        });
        const page = await context.newPage();
        await page.goto(parsed.toString(), { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(1200);
        screenshotBuffer = await page.screenshot({
          type: 'jpeg',
          quality: 82,
          fullPage: false,
        });
        await context.close();
      } finally {
        await browser.close();
      }
    } catch (err) {
      return sendErr(res, 502, `Could not capture screenshot: ${err.message}`), true;
    }
    const upload = await uploadAssetFile({
      assetType: 'Image',
      category: 'Screenshot',
      fileName: `${(assetName || `Screenshot ${parsed.hostname}`).replace(/[^a-zA-Z0-9._-]+/g, '_')}.jpg`,
      mimeType: 'image/jpeg',
      fileBase64: Buffer.from(screenshotBuffer).toString('base64'),
      makePublic: true,
    });
    if (!upload.ok) return sendErr(res, upload.status || 500, upload.error || 'Could not upload screenshot to Google Drive'), true;

    const categoriesRes = await listAssetCategories(scope);
    if (categoriesRes.ok) {
      const categories = (Array.isArray(categoriesRes.data) ? categoriesRes.data : []).map(rowToAssetCategory);
      const hasCategory = categories.some((item) =>
        String(item?.assetType || '').trim() === 'Image'
        && String(item?.category || '').trim() === 'Screenshot'
      );
      if (!hasCategory) {
        await createAssetCategory({ assetType: 'Image', category: 'Screenshot' }, scope);
      }
    }

    const save = await createAsset({
      assetName: assetName || `Screenshot: ${parsed.hostname}`,
      assetType: 'Image',
      category: 'Screenshot',
      location: upload.data.location,
      tags: Array.from(new Set(['screenshot', parsed.hostname, ...tags].filter(Boolean))),
      size: Math.max(0, Number(upload.data.sizeBytes || Buffer.byteLength(screenshotBuffer) || 0) || 0),
      imageWidth: Math.max(0, Number(upload.data.imageWidth || 640) || 640),
      imageHeight: Math.max(0, Number(upload.data.imageHeight || 360) || 360),
    }, scope);
    if (!save.ok) return sendErr(res, save.status || 500, save.error || 'Could not save screenshot asset'), true;
    const created = Array.isArray(save.data) ? save.data[0] : save.data;
    return sendOk(res, 201, rowToAsset(created), { asset: rowToAsset(created) }), true;
  }

  if (pathname === '/api/develop/extensions/thumbnail-capture' && requestMethod === 'POST') {
    if (!isAssetStorageConfigured()) {
      return sendErr(
        res,
        400,
        'No asset storage backend is configured. Configure Vercel Blob token or Google Drive credentials.',
        { code: 'ASSET_STORAGE_NOT_CONFIGURED' }
      ), true;
    }

    const body = await parseJsonBody(req);
    const fileLocation = String(body.fileLocation || body.file_location || '').trim();
    const sourceAssetId = String(body.sourceAssetId || body.source_asset_id || '').trim();
    const assetName = String(body.assetName || body.asset_name || '').trim();
    const tags = Array.isArray(body.tags)
      ? body.tags
      : String(body.tags || '')
          .split(',')
          .map((item) => String(item || '').trim())
          .filter(Boolean);

    let parsed;
    try {
      parsed = new URL(fileLocation);
    } catch (_) {
      return sendErr(res, 400, 'A valid PDF file location URL is required', { code: 'VALIDATION_ERROR' }), true;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return sendErr(res, 400, 'URL must use http or https', { code: 'VALIDATION_ERROR' }), true;
    }

    let thumbnailBuffer;
    try {
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 720 },
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();
        await page.goto(`${parsed.toString()}#page=1&view=FitH`, { waitUntil: 'load', timeout: 25000 });
        await page.waitForTimeout(1200);
        thumbnailBuffer = await page.screenshot({
          type: 'jpeg',
          quality: 86,
          fullPage: false,
        });
        await context.close();
      } finally {
        await browser.close();
      }
    } catch (err) {
      return sendErr(res, 502, `Could not generate PDF thumbnail: ${err.message}`), true;
    }

    const categoriesRes = await listAssetCategories(scope);
    if (categoriesRes.ok) {
      const categories = (Array.isArray(categoriesRes.data) ? categoriesRes.data : []).map(rowToAssetCategory);
      const hasCategory = categories.some((item) =>
        String(item?.assetType || '').trim() === 'Image'
        && String(item?.category || '').trim() === 'Thumbnail'
      );
      if (!hasCategory) {
        await createAssetCategory({ assetType: 'Image', category: 'Thumbnail' }, scope);
      }
    }

    const cleanFile = (assetName || `Thumbnail ${parsed.hostname}`)
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .slice(0, 120);
    const upload = await uploadAssetFile({
      assetType: 'Image',
      category: 'Thumbnail',
      fileName: `${cleanFile}.jpg`,
      mimeType: 'image/jpeg',
      fileBase64: Buffer.from(thumbnailBuffer).toString('base64'),
      makePublic: true,
    });
    if (!upload.ok) return sendErr(res, upload.status || 500, upload.error || 'Could not upload thumbnail to Google Drive'), true;

    const normalizedSourceLocation = parsed.toString();
    const save = await createAsset({
      assetName: assetName || `Thumbnail: ${parsed.hostname}`,
      assetType: 'Image',
      category: 'Thumbnail',
      location: upload.data.location,
      tags: Array.from(new Set([
        'thumbnail',
        'pdf-thumbnail',
        parsed.hostname,
        sourceAssetId ? `source_asset_id:${sourceAssetId}` : '',
        normalizedSourceLocation ? `source_location:${normalizedSourceLocation}` : '',
        ...tags,
      ].filter(Boolean))),
      size: Math.max(0, Number(upload.data.sizeBytes || Buffer.byteLength(thumbnailBuffer) || 0) || 0),
      imageWidth: Math.max(0, Number(upload.data.imageWidth || 1280) || 1280),
      imageHeight: Math.max(0, Number(upload.data.imageHeight || 720) || 720),
    }, scope);
    if (!save.ok) return sendErr(res, save.status || 500, save.error || 'Could not save thumbnail asset'), true;
    const created = Array.isArray(save.data) ? save.data[0] : save.data;
    return sendOk(res, 201, rowToAsset(created), { asset: rowToAsset(created) }), true;
  }

  const formIdMatch = String(pathname || '').match(/^\/api\/develop\/forms\/([^/]+)\/?$/);
  const emailTemplateIdMatch = String(pathname || '').match(/^\/api\/develop\/email-templates\/([^/]+)\/?$/);
  const extensionIdMatch = String(pathname || '').match(/^\/api\/develop\/extensions\/([^/]+)\/?$/);
  const extensionUseMatch = String(pathname || '').match(/^\/api\/develop\/extensions\/([^/]+)\/use\/?$/);
  if (formIdMatch && requestMethod === 'PATCH') {
    const formId = decodeURIComponent(formIdMatch[1] || '').trim();
    if (!formId) return sendErr(res, 400, 'form id is required', { code: 'VALIDATION_ERROR' }), true;

    const body = await parseJsonBody(req);
    const name = String(body.name || '').trim();
    const formType = String(body.formType || '').trim();
    const contactType = String(body.contactType || body.contact_type || '').trim();
    const leadMagnetType = String(body.leadMagnetType || body.lead_magnet_type || '').trim();
    const leadMagnetId = String(body.leadMagnetId || body.lead_magnet_id || '').trim();
    const ctaId = String(body.ctaId || body.cta_id || '').trim();
    const heading = String(body.heading || '').trim();
    const submitLabel = String(body.submitLabel || '').trim();
    const successMessage = String(body.successMessage || body.success_message || '').trim();
    const errorMessage = String(body.errorMessage || body.error_message || '').trim();
    const fields = Array.isArray(body.fields) ? body.fields : [];

    if (!name) return sendErr(res, 400, 'name is required', { code: 'VALIDATION_ERROR' }), true;
    if (!formType) return sendErr(res, 400, 'formType is required', { code: 'VALIDATION_ERROR' }), true;
    if (!contactType) return sendErr(res, 400, 'contactType is required', { code: 'VALIDATION_ERROR' }), true;
    if (!heading) return sendErr(res, 400, 'heading is required', { code: 'VALIDATION_ERROR' }), true;
    if (!submitLabel) return sendErr(res, 400, 'submitLabel is required', { code: 'VALIDATION_ERROR' }), true;
    if (!fields.length) return sendErr(res, 400, 'fields are required', { code: 'VALIDATION_ERROR' }), true;

    const updated = await updateForm(formId, {
      name,
      formType,
      contactType,
      leadMagnetType,
      leadMagnetId,
      ctaId,
      heading,
      submitLabel,
      successMessage,
      errorMessage,
      accentColor: String(body.accentColor || '').trim(),
      matchLandingColor: Boolean(body.matchLandingColor),
      landingColorMode: String(body.landingColorMode || '').trim(),
      useLandingBackground: Boolean(body.useLandingBackground),
      fields,
    }, scope);

    if (!updated) return sendErr(res, 404, 'Form not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, updated, { form: updated }), true;
  }

  if (formIdMatch && requestMethod === 'DELETE') {
    const formId = decodeURIComponent(formIdMatch[1] || '').trim();
    if (!formId) return sendErr(res, 400, 'form id is required', { code: 'VALIDATION_ERROR' }), true;

    const removed = await deleteForm(formId, scope);
    if (!removed) return sendErr(res, 404, 'Form not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, removed, { form: removed }), true;
  }

  if (emailTemplateIdMatch && requestMethod === 'PATCH') {
    const templateId = decodeURIComponent(emailTemplateIdMatch[1] || '').trim();
    if (!templateId) return sendErr(res, 400, 'email template id is required', { code: 'VALIDATION_ERROR' }), true;
    const body = await parseJsonBody(req);
    const name = String(body.name || '').trim();
    if (!name) return sendErr(res, 400, 'name is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await updateEmailTemplate(templateId, {
      templateKind: body.templateKind || body.template_kind,
      slug: body.slug,
      name,
      summary: body.summary,
      subject: body.subject,
      heading: body.heading,
      body: body.body,
      cta: body.cta,
      blocks: Array.isArray(body.blocks) ? body.blocks : [],
    }, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not update email template'), true;
    return sendOk(res, 200, result.data, { emailTemplate: result.data }), true;
  }

  if (emailTemplateIdMatch && requestMethod === 'DELETE') {
    const templateId = decodeURIComponent(emailTemplateIdMatch[1] || '').trim();
    if (!templateId) return sendErr(res, 400, 'email template id is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await deleteEmailTemplate(templateId, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not delete email template'), true;
    return sendOk(res, 200, result.data, { emailTemplate: result.data }), true;
  }

  if (extensionUseMatch && requestMethod === 'POST') {
    const extensionId = decodeURIComponent(extensionUseMatch[1] || '').trim();
    if (!extensionId) return sendErr(res, 400, 'extension id is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await trackExtensionUse(extensionId, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not track extension use'), true;
    return sendOk(res, 200, result.data, { extension: result.data }), true;
  }

  if (extensionIdMatch && requestMethod === 'PATCH') {
    const extensionId = decodeURIComponent(extensionIdMatch[1] || '').trim();
    if (!extensionId) return sendErr(res, 400, 'extension id is required', { code: 'VALIDATION_ERROR' }), true;

    const body = await parseJsonBody(req);
    const name = String(body.name || '').trim();
    const extensionType = String(body.extensionType || body.extension_type || '').trim();
    const status = String(body.status || '').trim();

    if (!name) return sendErr(res, 400, 'name is required', { code: 'VALIDATION_ERROR' }), true;
    if (!extensionType) return sendErr(res, 400, 'extensionType is required', { code: 'VALIDATION_ERROR' }), true;
    if (!status) return sendErr(res, 400, 'status is required', { code: 'VALIDATION_ERROR' }), true;

    const updated = await updateExtension(extensionId, {
      name,
      extensionType,
      slug: String(body.slug || '').trim(),
      parentId: String(body.parentId || body.parent_id || '').trim(),
      status,
      tags: String(body.tags || '').trim(),
      summary: String(body.summary || '').trim(),
      definition: String(body.definition || '').trim(),
      launchPageId: String(body.launchPageId || body.launch_page_id || '').trim(),
      isFeatured: body.isFeatured === true || body.is_featured === true,
      usageCount: Number(body.usageCount || body.usage_count || 0) || 0,
      lastUsedAt: body.lastUsedAt || body.last_used_at || null,
    }, scope);
    if (!updated) return sendErr(res, 404, 'Extension not found', { code: 'NOT_FOUND' }), true;
    if (!updated.ok) return sendErr(res, updated.status || 500, updated.error || 'Could not update extension'), true;
    return sendOk(res, 200, updated.data, { extension: updated.data }), true;
  }

  if (extensionIdMatch && requestMethod === 'DELETE') {
    const extensionId = decodeURIComponent(extensionIdMatch[1] || '').trim();
    if (!extensionId) return sendErr(res, 400, 'extension id is required', { code: 'VALIDATION_ERROR' }), true;

    const removed = await deleteExtension(extensionId, scope);
    if (!removed.ok) return sendErr(res, removed.status || 500, removed.error || 'Could not delete extension'), true;
    return sendOk(res, 200, removed.data, { extension: removed.data }), true;
  }

  const landingPageIdMatch = String(pathname || '').match(/^\/api\/develop\/landing-pages\/([^/]+)\/?$/);
  const landingPageSubmitMatch = String(pathname || '').match(/^\/api\/develop\/landing-pages\/([^/]+)\/submit\/?$/);
  const pageTemplateIdMatch = String(pathname || '').match(/^\/api\/develop\/page-templates\/([^/]+)\/?$/);

  if (landingPageSubmitMatch && requestMethod === 'POST') {
    const landingPageId = decodeURIComponent(landingPageSubmitMatch[1] || '').trim();
    if (!landingPageId) return sendErr(res, 400, 'landing page id is required', { code: 'VALIDATION_ERROR' }), true;

    const landingPageRes = await getLandingPage(landingPageId, scope);
    if (!landingPageRes.ok) return sendErr(res, landingPageRes.status || 404, landingPageRes.error || 'Landing page not found'), true;
    const landingPage = landingPageRes.data;

    const forms = await listForms(scope);
    const form = forms.find((item) => String(item?.id || '').trim() === String(landingPage?.formId || '').trim());
    if (!form) return sendErr(res, 400, 'Landing page form is not configured', { code: 'VALIDATION_ERROR' }), true;
    const contactType = String(form.contactType || '').trim();
    if (!contactType) return sendErr(res, 400, 'Saved form contactType is required', { code: 'VALIDATION_ERROR' }), true;

    const body = await parseJsonBody(req);
    const rawFields = body && typeof body.fields === 'object' && body.fields ? body.fields : {};
    const fieldMap = {};
    Object.keys(rawFields).forEach((key) => {
      fieldMap[String(key || '').trim()] = String(rawFields[key] || '').trim();
    });

    const contactPayload = {
      contactType,
      firstName: fieldMap.first_name || '',
      lastName: fieldMap.last_name || '',
      email: fieldMap.email || '',
      phone: fieldMap.phone || '',
      city: fieldMap.city || '',
      company: fieldMap.company || '',
      country: fieldMap.country || '',
      source: `landing_page:${landingPageId}`,
      customFields: {},
    };

    Object.entries(fieldMap).forEach(([key, value]) => {
      if (!value) return;
      if (['first_name', 'last_name', 'email', 'phone', 'city', 'company', 'country'].includes(key)) return;
      contactPayload.customFields[key] = value;
    });

    let result;
    if (contactPayload.email) {
      const existingRes = await listContacts({ contactType, limit: 5000 }, scope);
      if (!existingRes.ok) return sendErr(res, existingRes.status || 500, existingRes.error || 'Could not load contacts'), true;
      const existing = (Array.isArray(existingRes.data) ? existingRes.data : [])
        .find((row) => String(row?.email || '').trim().toLowerCase() === contactPayload.email.toLowerCase());
      if (existing) {
        result = await updateContact(existing.id, contactPayload, scope);
      } else {
        result = await createContact({
          id: nextId('contact'),
          ...contactPayload,
        }, scope);
      }
    } else {
      result = await createContact({
        id: nextId('contact'),
        ...contactPayload,
      }, scope);
    }

    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not save contact'), true;
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    return sendOk(res, 200, rowToContact(row), { contact: rowToContact(row) }), true;
  }

  if (landingPageIdMatch && requestMethod === 'PATCH') {
    const landingPageId = decodeURIComponent(landingPageIdMatch[1] || '').trim();
    if (!landingPageId) return sendErr(res, 400, 'landing page id is required', { code: 'VALIDATION_ERROR' }), true;

    const body = await parseJsonBody(req);
    const name = String(body.name || '').trim();
    const templateId = String(body.templateId || '').trim();

    if (!name) return sendErr(res, 400, 'name is required', { code: 'VALIDATION_ERROR' }), true;
    if (!templateId) return sendErr(res, 400, 'templateId is required', { code: 'VALIDATION_ERROR' }), true;

    const result = await updateLandingPage(landingPageId, {
      name,
      templateKind: body.templateKind || body.template_kind,
      templateId,
      primaryColor: String(body.primaryColor || '').trim(),
      backgroundColor: String(body.backgroundColor || '').trim(),
      accentColor: String(body.accentColor || '').trim(),
      formId: String(body.formId || '').trim(),
      leadMagnetId: String(body.leadMagnetId || '').trim(),
      headlineId: String(body.headlineId || '').trim(),
      pitchId: String(body.pitchId || '').trim(),
      ctaId: String(body.ctaId || '').trim(),
      websiteBannerImageId: String(body.websiteBannerImageId || '').trim(),
      backgroundImageId: String(body.backgroundImageId || '').trim(),
      featureImageId: String(body.featureImageId || '').trim(),
      highlightImageId: String(body.highlightImageId || '').trim(),
      featureHeadlineId: String(body.featureHeadlineId || '').trim(),
      featureSubheadingId: String(body.featureSubheadingId || '').trim(),
      featureTitle: String(body.featureTitle || '').trim(),
      featureCopy: String(body.featureCopy || '').trim(),
      highlightHeadlineId: String(body.highlightHeadlineId || '').trim(),
      highlightPitchId: String(body.highlightPitchId || '').trim(),
      highlightTitle: String(body.highlightTitle || '').trim(),
      highlightCopy: String(body.highlightCopy || '').trim(),
      bodyHeadlineId: String(body.bodyHeadlineId || '').trim(),
      bodySubheadingId: String(body.bodySubheadingId || '').trim(),
      bodyPitchId: String(body.bodyPitchId || '').trim(),
      logoWideId: String(body.logoWideId || '').trim(),
      logoSquareId: String(body.logoSquareId || '').trim(),
      layoutSections: Array.isArray(body.layoutSections || body.layout_sections)
        ? (body.layoutSections || body.layout_sections)
        : [],
      contentOverrides: body && typeof body.contentOverrides === 'object' ? body.contentOverrides : {},
    }, scope);
    if (!result.ok) {
      return sendErr(
        res,
        result.status || 500,
        result.error || 'Could not update landing page',
        { code: result.status === 404 ? 'NOT_FOUND' : null }
      ), true;
    }
    return sendOk(res, 200, result.data, { landingPage: result.data }), true;
  }

  if (landingPageIdMatch && requestMethod === 'DELETE') {
    const landingPageId = decodeURIComponent(landingPageIdMatch[1] || '').trim();
    if (!landingPageId) return sendErr(res, 400, 'landing page id is required', { code: 'VALIDATION_ERROR' }), true;

    const result = await deleteLandingPage(landingPageId, scope);
    if (!result.ok) {
      return sendErr(
        res,
        result.status || 500,
        result.error || 'Could not delete landing page',
        { code: result.status === 404 ? 'NOT_FOUND' : null }
      ), true;
    }
    return sendOk(res, 200, result.data, { landingPage: result.data }), true;
  }

  if (pageTemplateIdMatch && requestMethod === 'PATCH') {
    const pageTemplateId = decodeURIComponent(pageTemplateIdMatch[1] || '').trim();
    if (!pageTemplateId) return sendErr(res, 400, 'page template id is required', { code: 'VALIDATION_ERROR' }), true;

    const body = await parseJsonBody(req);
    const name = String(body.name || '').trim();
    const templateId = String(body.templateId || '').trim();

    if (!name) return sendErr(res, 400, 'name is required', { code: 'VALIDATION_ERROR' }), true;
    if (!templateId) return sendErr(res, 400, 'templateId is required', { code: 'VALIDATION_ERROR' }), true;

    const result = await updatePageTemplate(pageTemplateId, {
      name,
      templateKind: body.templateKind || body.template_kind,
      templateId,
      primaryColor: String(body.primaryColor || '').trim(),
      backgroundColor: String(body.backgroundColor || '').trim(),
      accentColor: String(body.accentColor || '').trim(),
      formId: String(body.formId || '').trim(),
      leadMagnetId: String(body.leadMagnetId || '').trim(),
      headlineId: String(body.headlineId || '').trim(),
      pitchId: String(body.pitchId || '').trim(),
      ctaId: String(body.ctaId || '').trim(),
      websiteBannerImageId: String(body.websiteBannerImageId || '').trim(),
      backgroundImageId: String(body.backgroundImageId || '').trim(),
      featureImageId: String(body.featureImageId || '').trim(),
      highlightImageId: String(body.highlightImageId || '').trim(),
      featureHeadlineId: String(body.featureHeadlineId || '').trim(),
      featureSubheadingId: String(body.featureSubheadingId || '').trim(),
      featureTitle: String(body.featureTitle || '').trim(),
      featureCopy: String(body.featureCopy || '').trim(),
      highlightHeadlineId: String(body.highlightHeadlineId || '').trim(),
      highlightPitchId: String(body.highlightPitchId || '').trim(),
      highlightTitle: String(body.highlightTitle || '').trim(),
      highlightCopy: String(body.highlightCopy || '').trim(),
      bodyHeadlineId: String(body.bodyHeadlineId || '').trim(),
      bodySubheadingId: String(body.bodySubheadingId || '').trim(),
      bodyPitchId: String(body.bodyPitchId || '').trim(),
      logoWideId: String(body.logoWideId || '').trim(),
      logoSquareId: String(body.logoSquareId || '').trim(),
      layoutSections: Array.isArray(body.layoutSections || body.layout_sections)
        ? (body.layoutSections || body.layout_sections)
        : [],
      contentOverrides: body && typeof body.contentOverrides === 'object' ? body.contentOverrides : {},
    }, scope);
    if (!result.ok) {
      return sendErr(
        res,
        result.status || 500,
        result.error || 'Could not update page template',
        { code: result.status === 404 ? 'NOT_FOUND' : null }
      ), true;
    }
    return sendOk(res, 200, result.data, { pageTemplate: result.data }), true;
  }

  if (pageTemplateIdMatch && requestMethod === 'DELETE') {
    const pageTemplateId = decodeURIComponent(pageTemplateIdMatch[1] || '').trim();
    if (!pageTemplateId) return sendErr(res, 400, 'page template id is required', { code: 'VALIDATION_ERROR' }), true;

    const result = await deletePageTemplate(pageTemplateId, scope);
    if (!result.ok) {
      return sendErr(
        res,
        result.status || 500,
        result.error || 'Could not delete page template',
        { code: result.status === 404 ? 'NOT_FOUND' : null }
      ), true;
    }
    return sendOk(res, 200, result.data, { pageTemplate: result.data }), true;
  }

  if (pathname === '/api/develop/training/harvest' && requestMethod === 'POST') {
    // Run the extraction and harvesting scripts in the background
    exec('npm run sync:dev-logs && npm run import:training-context:apply', (error, stdout, stderr) => {
      if (error) {
        console.error(`[Training Harvest] Error: ${error.message}`);
        return;
      }
      if (stderr) {
        console.error(`[Training Harvest] Stderr: ${stderr}`);
      }
      console.log(`[Training Harvest] Completed:\n${stdout}`);
    });
    
    // Return 202 Accepted immediately so the UI doesn't hang
    return sendOk(res, 202, { message: 'Training harvest initiated in background.' }), true;
  }

  const pollSubmitMatch = String(pathname || '').match(/^\/api\/develop\/modules\/([^/]+)\/poll-submit\/?$/);
  if (pollSubmitMatch && requestMethod === 'POST') {
    const pollId = decodeURIComponent(pollSubmitMatch[1] || '').trim();
    if (!pollId) return sendErr(res, 400, 'poll id is required', { code: 'VALIDATION_ERROR' }), true;

    const body = await parseJsonBody(req);
    const vote = String(body.vote || '').trim();
    if (!vote) return sendErr(res, 400, 'vote is required', { code: 'VALIDATION_ERROR' }), true;

    try {
      const submission = await savePollSubmission(pollId, vote);
      return sendOk(res, 201, submission, { submission }), true;
    } catch (err) {
      return sendErr(res, 500, err.message || 'Could not save poll submission'), true;
    }
  }

  const pollResultsMatch = String(pathname || '').match(/^\/api\/develop\/modules\/([^/]+)\/poll-results\/?$/);
  if (pollResultsMatch && requestMethod === 'GET') {
    const pollId = decodeURIComponent(pollResultsMatch[1] || '').trim();
    if (!pollId) return sendErr(res, 400, 'poll id is required', { code: 'VALIDATION_ERROR' }), true;

    try {
      const results = await getPollResults(pollId);
      
      // Calculate aggregate results
      const aggregates = {};
      let totalVotes = 0;
      for (const row of results) {
        const vote = row.vote;
        aggregates[vote] = (aggregates[vote] || 0) + 1;
        totalVotes++;
      }
      
      const summary = Object.keys(aggregates).map(option => ({
        option,
        count: aggregates[option],
        percentage: totalVotes > 0 ? Math.round((aggregates[option] / totalVotes) * 100) : 0
      })).sort((a, b) => b.count - a.count);

      return sendOk(res, 200, summary, { total: totalVotes, results: summary }), true;
    } catch (err) {
      return sendErr(res, 500, err.message || 'Could not fetch poll results'), true;
    }
  }

  return false;
}

const manifest = {
  id: 'develop',
  label: 'Develop',
  prefixes: ['/api/develop'],
};

module.exports = { handle, manifest };
