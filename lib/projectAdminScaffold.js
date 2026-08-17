'use strict';

/**
 * Scaffold a tenant's admin back-end — the admin-* Builder pages a project
 * admin signs in to.
 *
 * A tenant "admin back-end" is not a separate app. It is a handful of ordinary
 * Builder pages whose slug starts with `admin-`, built out of the admin-*
 * modules, wearing the tenant's own header and footer. Marinoff has had six of
 * them hand-built since July; Delray had a working login table, a live domain
 * and zero pages, so /admin-login rendered the public site's "Coming soon".
 *
 * This module builds that page set for ANY project from the project's own
 * chrome. It is deliberately split into pure planning/shaping functions and one
 * thin IO wrapper, because the intended end state is that creating the FIRST
 * admin user for a project scaffolds the area automatically. When that lands,
 * routes/projectAdmin.js calls scaffoldProjectAdminArea() and nothing else here
 * changes.
 *
 * WHAT IT REPLICATES (the Marinoff model, mapped from production 2026-08-16):
 *
 *   admin-login          public   the front door — an admin-login module
 *   admin-dashboard      private  team users + contacts at a glance
 *   admin-blog-manager   private  create posts, manage posts and categories
 *   admin-contact-manager private CRM contacts table
 *   admin-settings       private  admin-site-settings (contact alert email)
 *   admin-support        private  admin-support-form back to the platform
 *
 * Private pages wear an "Admin Header" — a copy of the project's own
 * menu-bearing header section with the public menu swapped for the admin menu.
 * admin-login wears the ordinary public header, because a signed-out visitor is
 * the only person who ever sees it.
 *
 * Signing out is NOT in the header. BuilderPublicSitePage renders the corner
 * button as "Logout" on every admin page, so a header link as well would be two
 * controls doing one job.
 *
 * TWO THINGS THIS DOES NOT DO, ON PURPOSE:
 *
 * 1. It never edits an existing page. Every blueprint whose slug already exists
 *    is skipped and reported, so a re-run cannot overwrite hand-styling. That
 *    is also what makes it safe to call from an event that may fire twice.
 * 2. It never triggers canonical propagation. It creates canonical section
 *    INSTANCES pointing at existing masters; it does not save a master, so no
 *    other page is rewritten. (Saving a master rewrites every page linked to
 *    it — that is what lost the Marinoff menu on 2026-07-21.)
 */

const { randomUUID } = require('crypto');

const { listPages, createPage } = require('./builderPagesStore');
const { listSavedSections, createSavedSection } = require('./builderSavedSectionsStore');
const { listPageTemplates } = require('./builderPageTemplatesStore');
const { applyTemplateFrame } = require('./builder/template-frame');

/** The admin menu, in the order Marinoff runs it. */
const ADMIN_MENU_ITEMS = Object.freeze([
  Object.freeze({ label: 'Dashboard', href: 'admin-dashboard' }),
  Object.freeze({ label: 'Blog Manager', href: 'admin-blog-manager' }),
  Object.freeze({ label: 'Contact Manager', href: 'admin-contact-manager' }),
  Object.freeze({ label: 'Settings', href: 'admin-settings' }),
  Object.freeze({ label: 'Support', href: 'admin-support' }),
]);

const ADMIN_HEADER_SECTION_NAME = 'Admin Header';

/**
 * The admin menu, limited to pages that will actually exist.
 *
 * A project without the blog module gets no blog manager. A menu item pointing
 * at a page nobody created lands the tenant on "Coming soon" inside their own
 * admin area — the exact failure this whole scaffold exists to remove.
 */
function adminMenuFor(availableSlugs) {
  const available = availableSlugs instanceof Set
    ? availableSlugs
    : new Set((availableSlugs || []).map((slug) => String(slug || '').trim().toLowerCase()));
  return ADMIN_MENU_ITEMS.filter((item) => available.has(item.href));
}


function defaultMakeId() {
  return randomUUID();
}

function safeText(value) {
  return String(value ?? '').trim();
}

/**
 * Unwrap a store envelope.
 *
 * Every store here returns { ok, status, data } and never the row itself, so
 * reading `.status` off the result gives 200 rather than anything meaningful.
 * Failing loudly at the boundary is the whole point (CLAUDE.md landmine 12).
 */
function must(result, what) {
  if (!result || result.ok !== true) {
    const message = safeText(result?.error) || 'unknown error';
    throw new Error(`${what} failed: ${message}`);
  }
  return result.data;
}

/* ------------------------------------------------------------------ shaping */

/** A section is frame when it is a live link to a saved section. */
function isFrameSection(section) {
  return Boolean(section && section.canonical === true && section.savedSectionId);
}

/** Does this saved-section master carry the site menu? */
function hasNavigationModule(savedSection) {
  const modules = savedSection?.section?.modules;
  if (!Array.isArray(modules)) return false;
  return modules.some((module) => module?.type === 'navigation');
}

/**
 * The frame section that carries the project's menu.
 *
 * Marinoff keeps one header section; Delray splits its chrome into a contact
 * strip and a menu banner. Picking by "contains a navigation module" works for
 * both without either project having to be special-cased.
 */
function findMenuFrameSection(frameSections, savedSections) {
  const byId = new Map((savedSections || []).map((s) => [String(s.id), s]));
  return (frameSections || []).find(
    (section) => isFrameSection(section) && hasNavigationModule(byId.get(String(section.savedSectionId)))
  ) || null;
}

/**
 * Module types the admin header keeps from the public header.
 *
 * Everything else is a call to action aimed at a visitor — "Book a Court",
 * "Register", a social row, a language switcher. Carrying those into the admin
 * area is clutter at best and a dead end at worst (a Sign In button shown to
 * someone already signed in). Marinoff's hand-built Admin Header kept exactly
 * the logo and the menu, which is the rule generalised here.
 *
 * Nothing is lost by dropping them: the Admin Header is a new saved section of
 * the tenant's own, editable in the Builder like any other.
 */
const ADMIN_HEADER_KEEP_TYPES = Object.freeze(['image', 'navigation']);

/**
 * Build the "Admin Header" master from the project's own menu-bearing header.
 *
 * Pure. Keeps the source section's design — background, layout, spacing, logo —
 * and changes two things: the navigation module lists the admin pages, and the
 * visitor-facing calls to action are dropped.
 *
 * Returns null when the project has no menu-bearing header, which is a real
 * situation, not an error — the caller reports it and the admin pages wear the
 * ordinary public chrome instead.
 *
 * Use adminHeaderDroppedTypes() to tell the operator what was left out, rather
 * than letting them discover it on the page.
 */
function buildAdminHeaderSection(sourceSection, options = {}) {
  if (!sourceSection || typeof sourceSection !== 'object') return null;
  const makeId = options.makeId || defaultMakeId;
  const menuItems = options.menuItems || ADMIN_MENU_ITEMS;

  const modules = Array.isArray(sourceSection.modules) ? sourceSection.modules : [];
  let sawNavigation = false;

  const nextModules = [];
  for (const module of modules) {
    if (module?.type === 'navigation') {
      sawNavigation = true;
      nextModules.push({
        ...module,
        id: `module-${makeId()}`,
        name: 'Admin Menu',
        settings: {
          ...(module.settings || {}),
          menuName: 'Admin Menu',
          navItems: JSON.stringify(
            menuItems.map((item, index) => ({
              id: `nav-admin-${index + 1}-${item.href}`,
              label: item.label,
              href: item.href,
            }))
          ),
        },
      });
      continue;
    }

    if (!ADMIN_HEADER_KEEP_TYPES.includes(module?.type)) continue;

    nextModules.push({ ...module, id: `module-${makeId()}` });
  }

  if (!sawNavigation) return null;

  // No Logout link in the header. Signing out is the corner button, which
  // BuilderPublicSitePage renders as "Logout" on every admin page — a text link
  // here as well was two ways to do one thing, and the operator asked for the
  // duplicate to go (2026-08-17).
  return {
    ...sourceSection,
    id: `section-${makeId()}`,
    title: ADMIN_HEADER_SECTION_NAME,
    modules: nextModules,
  };
}

/**
 * Which of the public header's modules the Admin Header leaves behind.
 *
 * Reported before anything is written. A header that quietly lost the tenant's
 * phone number would be found by the tenant, not by us.
 */
function adminHeaderDroppedTypes(sourceSection) {
  const modules = Array.isArray(sourceSection?.modules) ? sourceSection.modules : [];
  return modules
    .filter((module) => module?.type !== 'navigation' && !ADMIN_HEADER_KEEP_TYPES.includes(module?.type))
    .map((module) => safeText(module?.type) || 'unknown');
}

/* --------------------------------------------------------------- blueprints */

function textModule(makeId, html, column = 'main') {
  return {
    id: `module-${makeId()}`,
    name: '',
    type: 'text',
    text: html,
    column,
    settings: {
      variant: 'paragraph',
      alignment: 'left',
      mobileHidden: 'false',
      desktopHidden: 'false',
      verticalMargin: '0',
    },
  };
}

function bodySection(makeId, title, modules, layout = 'single') {
  return {
    id: `section-${makeId()}`,
    title,
    layout,
    locked: false,
    alignment: 'left',
    isPrivate: false,
    marginTop: '0',
    marginBottom: '20',
    widthMode: 'contained',
    widthPercent: '100',
    mobileHidden: 'false',
    desktopHidden: 'false',
    modules,
  };
}

/**
 * The page set.
 *
 * `requires` names an entry in the project's enabled_modules. A project without
 * the blog module gets no blog manager rather than a page of dead controls.
 */
const ADMIN_PAGE_BLUEPRINTS = Object.freeze([
  Object.freeze({
    slug: 'admin-login',
    name: 'Admin Login',
    // Deliberately NOT private: public-site-page-slugs.js lists admin-login as
    // the one admin-* slug that stays publicly reachable. It is the front door.
    isPrivate: false,
    chrome: 'public',
    buildBody: (makeId) => [
      bodySection(makeId, 'Admin Sign In', [
        {
          id: `module-${makeId()}`,
          name: '',
          type: 'admin-login',
          column: 'main',
          settings: {
            formTitle: 'Admin Sign In',
            buttonText: 'Sign In',
            successRedirect: '/admin-dashboard',
            showForgotPassword: 'true',
            mobileHidden: 'false',
            desktopHidden: 'false',
            verticalMargin: '0',
          },
        },
      ]),
    ],
  }),

  Object.freeze({
    slug: 'admin-dashboard',
    name: 'Admin Dashboard',
    isPrivate: true,
    chrome: 'admin',
    buildBody: (makeId) => [
      bodySection(makeId, 'Team', [
        {
          id: `module-${makeId()}`,
          name: '',
          type: 'admin-team-users',
          column: 'main',
          settings: {
            showTitle: 'true',
            tableTitle: 'Team Members',
            showAddButton: 'true',
            showEditButton: 'true',
            showDeleteButton: 'true',
            mobileHidden: 'false',
            desktopHidden: 'false',
            verticalMargin: '0',
          },
        },
      ]),
    ],
  }),

  Object.freeze({
    slug: 'admin-blog-manager',
    name: 'Admin: Blog Manager',
    isPrivate: true,
    chrome: 'admin',
    requires: 'blog',
    buildBody: (makeId) => [
      bodySection(
        makeId,
        'Blog Manager',
        [
          {
            id: `module-${makeId()}`,
            name: '',
            type: 'blog-post-create',
            column: 'left',
            settings: {
              formTitle: 'Create New Post',
              showFormTitle: 'true',
              submitLabel: 'Publish Post',
              draftLabel: 'Save as Draft',
              defaultStatus: 'draft',
              allowStatusChange: 'true',
              showSlug: 'true',
              showTags: 'true',
              showExcerpt: 'true',
              showCategories: 'true',
              showFeaturedImage: 'true',
              showSeoFields: 'false',
              showAuthorField: 'false',
              successMessage: 'Post created successfully.',
              redirectAfterCreate: '',
              mobileHidden: 'false',
              desktopHidden: 'false',
              verticalMargin: '0',
            },
          },
          {
            id: `module-${makeId()}`,
            name: '',
            type: 'blog-post-manager',
            column: 'right',
            settings: {
              showDate: 'true',
              showStatus: 'true',
              showDelete: 'true',
              editPageUrl: '',
              mobileHidden: 'false',
              desktopHidden: 'false',
              verticalMargin: '0',
            },
          },
          {
            id: `module-${makeId()}`,
            name: '',
            type: 'blog-category-manager',
            column: 'right',
            settings: {
              showColor: 'true',
              showDelete: 'true',
              showDescription: 'true',
              showSortOrder: 'false',
              mobileHidden: 'false',
              desktopHidden: 'false',
              verticalMargin: '0',
            },
          },
        ],
        'two-column'
      ),
    ],
  }),

  Object.freeze({
    slug: 'admin-contact-manager',
    name: 'Admin: Contact Manager',
    isPrivate: true,
    chrome: 'admin',
    requires: 'crm',
    buildBody: (makeId) => [
      bodySection(makeId, 'Contacts', [
        {
          id: `module-${makeId()}`,
          name: 'Contacts',
          type: 'crm-contacts-table',
          column: 'main',
          settings: {
            showTitle: 'true',
            tableTitle: 'Contacts',
            showSearch: 'true',
            crmConfigId: '',
            rowsPerPage: '20',
            showAddButton: 'true',
            addButtonLabel: 'Add Contact',
            showEditButton: 'true',
            showViewButton: 'true',
            showDeleteButton: 'true',
            mobileHidden: 'false',
            desktopHidden: 'false',
            verticalMargin: '0',
          },
        },
      ]),
    ],
  }),

  Object.freeze({
    slug: 'admin-settings',
    name: 'Admin: Settings',
    isPrivate: true,
    chrome: 'admin',
    buildBody: (makeId) => [
      bodySection(makeId, 'Site Settings', [
        {
          id: `module-${makeId()}`,
          name: 'Site Settings',
          type: 'admin-site-settings',
          column: 'main',
          settings: {
            showTitle: 'true',
            panelTitle: 'Site Settings',
            mobileHidden: 'false',
            desktopHidden: 'false',
            verticalMargin: '0',
          },
        },
      ]),
    ],
  }),

  Object.freeze({
    slug: 'admin-support',
    name: 'Admin: Support',
    isPrivate: true,
    chrome: 'admin',
    buildBody: (makeId) => [
      bodySection(makeId, 'Support', [
        textModule(
          makeId,
          '<h2>Support</h2><p>Send a question or report a problem. We reply by email.</p>'
        ),
        {
          id: `module-${makeId()}`,
          name: '',
          type: 'admin-support-form',
          column: 'main',
          settings: {
            formTitle: 'Request Support',
            showTitle: 'true',
            buttonText: 'Send Request',
            defaultPriority: 'normal',
            showScreenshot: 'true',
            mobileHidden: 'false',
            desktopHidden: 'false',
            verticalMargin: '0',
          },
        },
      ]),
    ],
  }),
]);

/** Every module type this scaffold can emit — the list the registration test walks. */
function scaffoldModuleTypes() {
  const types = new Set(['text']);
  const makeId = (() => {
    let n = 0;
    return () => `probe-${++n}`;
  })();
  for (const blueprint of ADMIN_PAGE_BLUEPRINTS) {
    for (const section of blueprint.buildBody(makeId)) {
      for (const module of section.modules || []) types.add(module.type);
    }
  }
  return [...types];
}

/* ---------------------------------------------------------------- planning */

function isModuleEnabled(enabledModules, key) {
  if (!key) return true;
  if (!enabledModules || typeof enabledModules !== 'object') return false;
  return enabledModules[key] === true;
}

/**
 * Decide what to create, without touching anything.
 *
 * Pure, so the decisions are testable without a database: which pages are
 * missing, which already exist, and which are skipped because the project does
 * not have that module switched on.
 */
function planAdminPages({ existingPages, enabledModules, only } = {}) {
  const existing = new Set(
    (existingPages || []).map((page) => safeText(page?.slug).toLowerCase()).filter(Boolean)
  );
  const wanted = Array.isArray(only) && only.length
    ? new Set(only.map((slug) => safeText(slug).toLowerCase()))
    : null;

  const create = [];
  const skip = [];
  for (const blueprint of ADMIN_PAGE_BLUEPRINTS) {
    if (wanted && !wanted.has(blueprint.slug)) {
      skip.push({ slug: blueprint.slug, reason: 'not requested' });
      continue;
    }
    if (existing.has(blueprint.slug)) {
      skip.push({ slug: blueprint.slug, reason: 'page already exists' });
      continue;
    }
    if (blueprint.requires && !isModuleEnabled(enabledModules, blueprint.requires)) {
      skip.push({ slug: blueprint.slug, reason: `${blueprint.requires} module not enabled for this project` });
      continue;
    }
    create.push(blueprint);
  }
  return { create, skip };
}

/**
 * Put a blueprint's body inside the project's chrome.
 *
 * For private pages the menu-bearing frame reference is re-pointed at the Admin
 * Header master, so the page wears the admin menu while keeping the contact
 * strip, footer and copyright the rest of the site uses.
 */
function buildAdminPageSections({
  blueprint,
  frameSections,
  savedSections,
  adminHeaderSectionId,
  menuFrameSectionId,
  makeId = defaultMakeId,
} = {}) {
  const body = blueprint.buildBody(makeId);

  let frame = Array.isArray(frameSections) ? frameSections : [];
  if (blueprint.chrome === 'admin' && adminHeaderSectionId && menuFrameSectionId) {
    frame = frame.map((section) =>
      isFrameSection(section) && String(section.savedSectionId) === String(menuFrameSectionId)
        ? { ...section, savedSectionId: adminHeaderSectionId, title: ADMIN_HEADER_SECTION_NAME }
        : section
    );
  }

  const result = applyTemplateFrame(body, frame, {
    savedSections: savedSections || [],
    makeId: () => `section-${makeId()}`,
  });
  return result.sections;
}

/**
 * The project's frame: the page template most of its pages already use.
 *
 * Returns { frameSections, pageTemplateId, templateName } or nulls when the
 * project has no template with a frame — reported, never silently treated as
 * "no header wanted".
 */
function pickProjectFrame({ pageTemplates, existingPages } = {}) {
  const templates = Array.isArray(pageTemplates) ? pageTemplates : [];
  if (!templates.length) return { frameSections: [], pageTemplateId: '', templateName: '' };

  const tally = new Map();
  for (const page of existingPages || []) {
    const id = safeText(page?.pageTemplateId);
    if (id) tally.set(id, (tally.get(id) || 0) + 1);
  }

  const withFrame = templates.filter((template) =>
    (template?.layoutSections || []).some((section) => isFrameSection(section))
  );
  if (!withFrame.length) return { frameSections: [], pageTemplateId: '', templateName: '' };

  withFrame.sort((a, b) => (tally.get(String(b.id)) || 0) - (tally.get(String(a.id)) || 0));
  const chosen = withFrame[0];
  return {
    frameSections: chosen.layoutSections || [],
    pageTemplateId: String(chosen.id || ''),
    templateName: safeText(chosen.name),
  };
}

/** The theme most of the project's pages use, so admin pages match the site. */
function pickProjectThemeId(existingPages) {
  const tally = new Map();
  for (const page of existingPages || []) {
    const id = safeText(page?.themeId);
    if (id) tally.set(id, (tally.get(id) || 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [id, count] of tally) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

/* ---------------------------------------------------------------------- IO */

/**
 * Create a project's admin back-end.
 *
 * `dryRun: true` reports exactly what it would do and writes nothing — that is
 * the default, so a mistaken call cannot create pages.
 *
 * The report names every page created, every page skipped and why, and anything
 * it could not check. A scaffold that quietly did half its job would look
 * identical to one that succeeded (docs/DOCTRINE.md §3.11).
 */
async function scaffoldProjectAdminArea(options = {}, scope = null) {
  const projectId = safeText(options.projectId || scope?.projectId);
  if (!projectId) throw new Error('projectId is required');

  const dryRun = options.dryRun !== false;
  const makeId = options.makeId || defaultMakeId;
  const effectiveScope = scope || { projectId, userId: safeText(options.ownerUserId) };

  const report = {
    projectId,
    dryRun,
    created: [],
    skipped: [],
    notes: [],
    adminHeader: null,
  };

  // limit FIRST, scope SECOND — listPages(scope) reads the scope as a limit and
  // returns every project's pages (CLAUDE.md landmine 12).
  const existingPages = must(await listPages(2000, effectiveScope), 'listPages');
  const savedSections = must(await listSavedSections(500, effectiveScope), 'listSavedSections');
  const pageTemplates = must(await listPageTemplates(200, effectiveScope), 'listPageTemplates');

  const { create, skip } = planAdminPages({
    existingPages,
    enabledModules: options.enabledModules,
    only: options.only,
  });
  report.skipped = skip;

  const { frameSections, pageTemplateId, templateName } = pickProjectFrame({
    pageTemplates,
    existingPages,
  });
  const themeId = safeText(options.themeId) || pickProjectThemeId(existingPages);

  if (!frameSections.length) {
    report.notes.push(
      'This project has no page template carrying a header/footer frame, so the admin pages are being built with no chrome. Apply the site template to them in the Builder afterwards.'
    );
  } else {
    report.notes.push(`Chrome comes from page template "${templateName}" (id ${pageTemplateId}).`);
  }

  // The Admin Header master: created once per project, reused on every re-run.
  let adminHeaderSectionId = '';
  let menuFrameSectionId = '';
  const wantsAdminChrome = create.some((blueprint) => blueprint.chrome === 'admin');

  if (wantsAdminChrome && frameSections.length) {
    const menuFrame = findMenuFrameSection(frameSections, savedSections);
    if (!menuFrame) {
      report.notes.push(
        'COULD NOT CHECK: no frame section carries a navigation module, so the admin pages wear the public header and have no admin menu.'
      );
    } else {
      menuFrameSectionId = String(menuFrame.savedSectionId);
      const menuItems = adminMenuFor([
        ...existingPages.map((page) => safeText(page?.slug).toLowerCase()),
        ...create.map((blueprint) => blueprint.slug),
      ]);

      const existingAdminHeader = savedSections.find(
        (section) => safeText(section?.name).toLowerCase() === ADMIN_HEADER_SECTION_NAME.toLowerCase()
      );

      if (existingAdminHeader) {
        adminHeaderSectionId = String(existingAdminHeader.id);
        report.adminHeader = { id: adminHeaderSectionId, created: false };
      } else {
        const source = savedSections.find((s) => String(s.id) === menuFrameSectionId);
        const adminHeaderSection = buildAdminHeaderSection(source?.section, { makeId, menuItems });
        if (!adminHeaderSection) {
          report.notes.push(
            `COULD NOT CHECK: saved section ${menuFrameSectionId} has no navigation module to build an Admin Header from.`
          );
        } else if (dryRun) {
          // Register the would-be master under a provisional id so the dry run
          // resolves the same frame the real run will, rather than reporting the
          // public header and surprising everyone on --apply.
          adminHeaderSectionId = `saved_section_dry_run_${ADMIN_HEADER_SECTION_NAME.toLowerCase().replace(/\s+/g, '_')}`;
          savedSections.push({
            id: adminHeaderSectionId,
            name: ADMIN_HEADER_SECTION_NAME,
            section: adminHeaderSection,
          });
          report.adminHeader = {
            id: adminHeaderSectionId,
            created: true,
            builtFrom: safeText(source?.name),
            menuItems: menuItems.map((item) => item.label),
            droppedTypes: adminHeaderDroppedTypes(source?.section),
          };
        } else {
          const saved = must(
            await createSavedSection(
              { name: ADMIN_HEADER_SECTION_NAME, section: adminHeaderSection, isPrivate: true },
              effectiveScope
            ),
            'createSavedSection(Admin Header)'
          );
          adminHeaderSectionId = String(saved?.id || '');
          report.adminHeader = {
            id: adminHeaderSectionId,
            created: true,
            builtFrom: safeText(source?.name),
            menuItems: menuItems.map((item) => item.label),
            droppedTypes: adminHeaderDroppedTypes(source?.section),
          };
          savedSections.push(saved);
        }
      }
    }
  }

  for (const blueprint of create) {
    const sections = buildAdminPageSections({
      blueprint,
      frameSections,
      savedSections,
      adminHeaderSectionId,
      menuFrameSectionId,
      makeId,
    });

    const entry = {
      slug: blueprint.slug,
      name: blueprint.name,
      isPrivate: blueprint.isPrivate,
      chrome: blueprint.chrome,
      sectionCount: sections.length,
      moduleTypes: sections.flatMap((s) => (s.modules || []).map((m) => m.type)),
    };

    if (dryRun) {
      report.created.push({ ...entry, id: null });
      continue;
    }

    const page = must(
      await createPage(
        {
          name: blueprint.name,
          slug: blueprint.slug,
          templateKind: 'modular',
          // The ARRAY of sections, not { sections: [...] } — the wrong shape does
          // not throw, it writes an empty page (CLAUDE.md landmine 13).
          layoutSections: sections,
          isPrivate: blueprint.isPrivate,
          isPublished: true,
          themeId,
          pageTemplateId,
        },
        effectiveScope
      ),
      `createPage(${blueprint.slug})`
    );
    report.created.push({ ...entry, id: page?.id ?? null });
  }

  return report;
}

module.exports = {
  ADMIN_MENU_ITEMS,
  ADMIN_HEADER_SECTION_NAME,
  ADMIN_PAGE_BLUEPRINTS,
  ADMIN_HEADER_KEEP_TYPES,
  adminMenuFor,
  scaffoldModuleTypes,
  buildAdminHeaderSection,
  adminHeaderDroppedTypes,
  findMenuFrameSection,
  planAdminPages,
  buildAdminPageSections,
  pickProjectFrame,
  pickProjectThemeId,
  scaffoldProjectAdminArea,
};
