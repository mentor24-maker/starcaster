/**
 * Builder React island bridge — mounts/unmounts builder-bundle.js workspace.
 */
window.App = window.App || {};

App.builder = (function () {
  const HOST_IDS = {
    hub: 'builderReactRootHub',
    template: 'builderReactRootTemplate',
    page: 'builderReactRootPage',
  };

  let activeMount = null;

  function safeText(value) {
    return String(value || '').trim();
  }

  function useReactIsland() {
    try {
      const flag = window.localStorage.getItem('builder_v2');
      if (flag === '0') return false;
    } catch (_) {
      // ignore storage errors
    }
    return typeof window.BuilderReact?.mount === 'function';
  }

  function resolveHost(surface, editorMode) {
    if (surface === 'hub') return document.getElementById(HOST_IDS.hub);
    if (editorMode === 'page') return document.getElementById(HOST_IDS.page);
    return document.getElementById(HOST_IDS.template);
  }

  function hideVanillaBuilderPanels(editorMode) {
    const modularPanel = document.getElementById('developPageTemplateEditorPanel');
    if (modularPanel) modularPanel.classList.add('hidden');
    const emailPanel = document.getElementById('developTemplateEditorPanel');
    if (emailPanel) emailPanel.classList.add('hidden');
    const landingForm = document.getElementById('developLandingPagesForm');
    if (landingForm) landingForm.classList.add('hidden');
  }

  function showVanillaBuilderPanels(editorMode, templateKind) {
    const kind = safeText(templateKind).toLowerCase();
    const modularPanel = document.getElementById('developPageTemplateEditorPanel');
    const emailPanel = document.getElementById('developTemplateEditorPanel');
    if (kind === 'email') {
      if (emailPanel) emailPanel.classList.remove('hidden');
      if (modularPanel) modularPanel.classList.add('hidden');
    } else {
      if (modularPanel) modularPanel.classList.remove('hidden');
      if (emailPanel) emailPanel.classList.add('hidden');
    }
    const landingForm = document.getElementById('developLandingPagesForm');
    if (landingForm && editorMode !== 'page') landingForm.classList.remove('hidden');
  }

  function unmount() {
    if (typeof window.BuilderReact?.unmount === 'function') {
      window.BuilderReact.unmount();
    }
    activeMount = null;
  }

  function mount(config) {
    if (!useReactIsland()) return false;

    const surface = safeText(config?.surface) || 'editor';
    const editorMode = safeText(config?.editorMode) === 'page' ? 'page' : 'template';
    const host = resolveHost(surface, editorMode);
    if (!host) {
      App.notify('Builder mount point is missing from the page markup', true);
      return false;
    }

    unmount();
    hideVanillaBuilderPanels(editorMode);

    const props = {
      surface,
      editorMode,
      menuMode: config?.menuMode,
      record: config?.record || null,
      sourceTemplateId: safeText(config?.sourceTemplateId),
      options: config?.options || null,
      onClose: () => {
        unmount();
        showVanillaBuilderPanels(editorMode, config?.record?.templateKind);
        if (typeof config?.onClose === 'function') config.onClose();
      },
      onSaved: (record) => {
        if (typeof config?.onSaved === 'function') config.onSaved(record);
      },
    };

    const mounted = window.BuilderReact.mount(host, props);
    if (!mounted) {
      App.notify('Builder UI failed to mount', true);
      showVanillaBuilderPanels(editorMode, config?.record?.templateKind);
      return false;
    }

    activeMount = { surface, editorMode, host, templateKind: safeText(config?.record?.templateKind) };
    return true;
  }

  function openHub() {
    return mount({
      surface: 'hub',
      editorMode: 'template',
      onClose: () => {},
    });
  }

  function isActive() {
    return Boolean(activeMount);
  }

  function init() {
    // Reserved for future global listeners.
  }

  function onPageActivated(pageId) {
    const page = safeText(pageId);
    if (page === 'developBuilderWorkspacePage') {
      if (!activeMount || activeMount.surface !== 'hub') {
        mount({
          surface: 'hub',
          editorMode: 'template',
          onClose: () => {},
        });
      }
      return;
    }
    if (!activeMount) return;
    const allowed = [
      'developBuilderWorkspacePage',
      'developTemplatesPage',
      'developLandingPagesPage',
    ];
    if (!allowed.includes(page)) {
      unmount();
    }
  }

  return {
    manifest: {
      id: 'builder',
      label: 'Builder',
      pageId: 'developBuilderWorkspacePage',
      pagePrefixes: ['developBuilder'],
    },
    init,
    onPageActivated,
    mount,
    unmount,
    openHub,
    isActive,
    useReactIsland,
  };
})();
