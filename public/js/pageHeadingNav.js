window.App = window.App || {};

App.pageHeadingNav = (function pageHeadingNavModule() {
  const CLICK_HANDLERS = {
    'messaging.openContentLanding': () => App.messaging?.openContentLanding?.(),
    'messaging.openManageContentLanding': () => App.messaging?.openManageContentLanding?.(),
    'messaging.openTopicsPage': () => App.messaging?.openTopicsPage?.(),
    'messaging.openTopicsLanding': () => App.messaging?.openTopicsLanding?.(),
    'messaging.openTagsPage': () => App.messaging?.openTagsPage?.(),
    'messaging.openTagsLanding': () => App.messaging?.openTagsLanding?.(),
    'messaging.closeTweetEdit': () => {
      App.messaging?.closeTweetEditForm?.();
      const listAnchor = document.getElementById('messaging-tweets-list');
      if (listAnchor) listAnchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    'messaging.closeHeadlineEdit': () => {
      App.messaging?.closeHeadlineEditForm?.();
      const listAnchor = document.getElementById('messaging-headlines-list');
      if (listAnchor) listAnchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    'assets.openAssetsLanding': () => App.assets?.openAssetsLanding?.(),
    'assetCategories.openCategoriesPage': () => App.assetCategories?.openCategoriesPage?.(),
    'channels.openChannelsPage': () => App.channels?.openChannelsPage?.(),
    'contactPersonas.openPersonasPage': () => App.contactPersonas?.openPersonasPage?.(),
    'contacts.openContactsPage': () => App.contacts?.openContactsPage?.(),
    'develop.openThemesPage': () => App.develop?.openThemesPage?.(),
    'develop.openAgentsPage': () => App.develop?.openAgentsPage?.(),
    'develop.openManageLandingPages': () => App.setActivePage('developManageLandingPagesPage'),
    'settings.openProjectsPage': () => App.settings?.openProjectsPage?.(),
    'youtube.openYoutubePage': () => App.youtube?.openYoutubePage?.(),
    'youtube.openTopicsPage': () => App.youtube?.openTopicsPage?.(),
  };

  function runBackAction(link) {
    const clickKey = String(link?.dataset?.backClick || '').trim();
    const pageId = String(link?.dataset?.backPage || '').trim();
    const anchor = String(link?.dataset?.backAnchor || '').trim();
    const hideSelector = String(link?.dataset?.backHide || '').trim();
    const showSelector = String(link?.dataset?.backShow || '').trim();

    if (clickKey && CLICK_HANDLERS[clickKey]) {
      CLICK_HANDLERS[clickKey]();
    } else if (pageId) {
      App.setActivePage(pageId);
    }

    if (hideSelector) {
      document.querySelectorAll(hideSelector).forEach((el) => {
        el.classList.add('is-parent-heading-hidden', 'hidden');
      });
    }
    if (showSelector) {
      document.querySelectorAll(showSelector).forEach((el) => {
        el.classList.remove('is-parent-heading-hidden', 'hidden');
      });
    }

    if (anchor) {
      const el = document.getElementById(anchor);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    return Boolean(clickKey || pageId);
  }

  function bindBackLinks(root = document) {
    root.querySelectorAll('a.page-heading-back-link').forEach((link) => {
      if (link.dataset.backBound === '1') return;
      link.dataset.backBound = '1';
      link.addEventListener('click', (event) => {
        event.preventDefault();
        runBackAction(link);
      });
    });
  }

  function setParentHeadingVisible(parentEl, visible) {
    if (!parentEl) return;
    parentEl.classList.toggle('is-parent-heading-hidden', !visible);
    parentEl.classList.toggle('hidden', !visible);
  }

  function init() {
    bindBackLinks();
  }

  return {
    init,
    bindBackLinks,
    runBackAction,
    setParentHeadingVisible,
  };
})();
