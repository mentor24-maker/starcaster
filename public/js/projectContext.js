/**
 * public/js/projectContext.js
 * Canonical client-side project session + view context.
 *
 * sessionProjectId — active workspace (API header, banner, module data)
 * viewProjectId      — optional Settings edit target without switching workspace
 */

window.App = window.App || {};

App.projectContext = (function projectContextModule() {
  const PROJECT_LOGO_STORAGE_KEY = 'alphire.projectLogoMap';
  const DEFAULT_FAVICON_URL = '/images/favicon_alphire_512x512.png';
  let viewProjectId = '';
  let syncSeq = 0;
  let switching = false;

  function state() {
    return App.state || {};
  }

  function projectsList() {
    return Array.isArray(state().projects) ? state().projects : [];
  }

  function findProject(projectId) {
    const id = String(projectId || '').trim();
    if (!id) return null;
    return projectsList().find((project) => String(project?.id || '') === id) || null;
  }

  function projectLabel(project) {
    return String(project?.name || project?.slug || project?.id || 'Untitled').trim() || 'Untitled';
  }

  function getSessionProjectId() {
    return String(state().currentProjectId || '').trim();
  }

  function setSessionProjectId(projectId, options = {}) {
    const next = String(projectId || '').trim();
    state().currentProjectId = next;
    try {
      const key = App.CURRENT_PROJECT_ID_STORAGE_KEY || 'alphire.currentProjectId';
      if (next) window.localStorage.setItem(key, next);
      else window.localStorage.removeItem(key);
    } catch (_) {}
    if (options.syncCurrentProject !== false && next) {
      state().currentProject = findProject(next);
    } else if (!next) {
      state().currentProject = null;
    }
    if (options.applyBanner !== false) applyBanner();
  }

  function getSessionProject() {
    return findProject(getSessionProjectId());
  }

  function getViewProjectId() {
    return String(viewProjectId || '').trim();
  }

  function getViewProject() {
    const id = getViewProjectId();
    return id ? findProject(id) : null;
  }

  function hasViewContext() {
    const viewId = getViewProjectId();
    return Boolean(viewId && viewId !== getSessionProjectId());
  }

  function getDetailProjectId() {
    return getSessionProjectId();
  }

  function readProjectLogoMap() {
    try {
      const raw = String(window.localStorage.getItem(PROJECT_LOGO_STORAGE_KEY) || '').trim();
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeProjectLogoMap(map) {
    try {
      window.localStorage.setItem(PROJECT_LOGO_STORAGE_KEY, JSON.stringify(map || {}));
    } catch (_) {}
  }

  function getProjectLogoDataUrl(project, options = {}) {
    const id = String(project?.id || '').trim();
    if (!id) return '';
    const fromProject = String(project?.logoDataUrl || project?.logo_data_url || '').trim();
    if (fromProject) return fromProject;
    const map = readProjectLogoMap();
    const mapped = String(map[id] || '').trim();
    if (mapped) return mapped;
    if (options.allowProfileFallback) {
      return String(state().profile?.logoDataUrl || '').trim();
    }
    return '';
  }

  function getProjectFaviconDataUrl(project) {
    return String(project?.faviconDataUrl || project?.favicon_data_url || '').trim();
  }

  function syncProjectFaviconInState(projectIdInput, dataUrlInput) {
    const projectId = String(projectIdInput || '').trim();
    const dataUrl = String(dataUrlInput || '').trim();
    if (!projectId) return;
    const project = findProject(projectId);
    if (project) {
      project.faviconDataUrl = dataUrl;
      project.favicon_data_url = dataUrl;
    }
    if (String(state().currentProjectId || '') === projectId && state().currentProject) {
      state().currentProject.faviconDataUrl = dataUrl;
      state().currentProject.favicon_data_url = dataUrl;
    }
  }

  function setProjectFaviconDataUrl(projectIdInput, dataUrlInput) {
    const projectId = String(projectIdInput || '').trim();
    const dataUrl = String(dataUrlInput || '').trim();
    if (!projectId) return;
    syncProjectFaviconInState(projectId, dataUrl);
    applyFavicon();
  }

  function applyFavicon() {
    const sessionProject = getSessionProject();
    const faviconUrl = getProjectFaviconDataUrl(sessionProject);
    const href = faviconUrl || DEFAULT_FAVICON_URL;
    const iconLink = document.querySelector('link[rel="icon"]');
    const appleLink = document.querySelector('link[rel="apple-touch-icon"]');
    if (iconLink) iconLink.href = href;
    if (appleLink) appleLink.href = href;
  }

  function syncProjectLogoInState(projectIdInput, dataUrlInput) {
    const projectId = String(projectIdInput || '').trim();
    const dataUrl = String(dataUrlInput || '').trim();
    if (!projectId) return;
    const project = findProject(projectId);
    if (project) {
      project.logoDataUrl = dataUrl;
      project.logo_data_url = dataUrl;
    }
    if (String(state().currentProjectId || '') === projectId && state().currentProject) {
      state().currentProject.logoDataUrl = dataUrl;
      state().currentProject.logo_data_url = dataUrl;
    }
  }

  function clearLegacyProjectLogoFromStorage(projectIdInput) {
    const projectId = String(projectIdInput || '').trim();
    if (!projectId) return;
    const map = readProjectLogoMap();
    if (!map[projectId]) return;
    delete map[projectId];
    writeProjectLogoMap(map);
  }

  function setProjectLogoDataUrl(projectIdInput, dataUrlInput) {
    const projectId = String(projectIdInput || '').trim();
    const dataUrl = String(dataUrlInput || '').trim();
    if (!projectId) return;
    syncProjectLogoInState(projectId, dataUrl);
    clearLegacyProjectLogoFromStorage(projectId);
    applyBanner();
    applyFavicon();
  }

  async function migrateLegacyLocalLogosToServer() {
    const map = readProjectLogoMap();
    const ids = Object.keys(map || {});
    if (!ids.length) return;
    let changed = false;
    for (const project of projectsList()) {
      const id = String(project?.id || '').trim();
      if (!id) continue;
      const localLogo = String(map[id] || '').trim();
      const serverLogo = String(project?.logoDataUrl || project?.logo_data_url || '').trim();
      if (!localLogo || serverLogo) {
        if (serverLogo && localLogo) {
          delete map[id];
          changed = true;
        }
        continue;
      }
      try {
        await App.api(`/api/projects/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ logoDataUrl: localLogo }),
        });
        syncProjectLogoInState(id, localLogo);
        delete map[id];
        changed = true;
      } catch (_) {}
    }
    if (changed) writeProjectLogoMap(map);
  }

  function applyBanner() {
    const els = App.els || {};
    const sessionProject = getSessionProject();
    const projectLogo = getProjectLogoDataUrl(sessionProject);
    const hasSession = Boolean(sessionProject);
    const hasLogo = hasSession && Boolean(projectLogo);

    if (els.brandProfileButton) {
      els.brandProfileButton.classList.toggle('has-logo', hasLogo);
      els.brandProfileButton.title = hasSession ? 'Active project settings' : 'Projects';
    }
    if (els.brandProfileLabel) {
      if (!hasSession) {
        els.brandProfileLabel.textContent = 'Projects';
      } else {
        els.brandProfileLabel.textContent = projectLabel(sessionProject);
      }
      els.brandProfileLabel.classList.toggle('hidden', hasLogo);
    }
    if (els.brandProfileLogo) {
      els.brandProfileLogo.classList.toggle('hidden', !hasLogo);
      if (hasLogo) els.brandProfileLogo.src = projectLogo;
      else els.brandProfileLogo.removeAttribute('src');
    }
    applyFavicon();
  }

  function applyDetailContextNotice() {
    const notice = document.getElementById('settingsProjectContextNotice');
    if (notice) {
      notice.classList.add('hidden');
      notice.textContent = '';
    }
  }

  function emit(eventName, detail) {
    try {
      window.dispatchEvent(new CustomEvent(`projectContext:${eventName}`, { detail: detail || {} }));
    } catch (_) {}
  }

  function clearProjectScopedCaches() {
    const s = state();
    s.contacts = [];
    s.segments = [];
    s.campaigns = [];
    s.assets = [];
    s.assetCategories = s.assetCategories || [];
    s.channels = [];
    s.contactPersonas = [];
    s.directAcquireRuns = [];
    s.directAcquireCurrentRun = null;
    s.directAcquireWebsitePeers = [];
    s.xAcquireRuns = [];
    s.xAcquireCurrentRun = null;
    s.redditAcquireRuns = [];
    s.redditAcquireCurrentRun = null;
    s.acquireJobs = [];
    s.acquireBusyByJob = {};
    s.youtubeAcquireResult = null;
    s.acquireYoutubeDetails = [];
    s.acquireYoutubeTopics = [];
    s.acquireYoutubeComments = [];
    s.promoLeads = [];
    s.promoFields = [];
  }

  async function notifyModulesProjectSwitched(projectId) {
    const manifests = Array.isArray(App.manifests) ? App.manifests : [];
    for (const mod of manifests) {
      if (!mod || typeof mod.onProjectSwitched !== 'function') continue;
      try {
        await mod.onProjectSwitched(projectId);
      } catch (_) {}
    }
  }

  async function persistActiveProjectOnServer(projectId) {
    const id = String(projectId || '').trim();
    if (!id) return false;
    try {
      await App.api('/api/projects/active', {
        method: 'POST',
        body: JSON.stringify({ projectId: id }),
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function switchSessionProject(projectId, options = {}) {
    const id = String(projectId || '').trim();
    if (!id) return false;
    if (!findProject(id)) {
      await refreshFromServer({ preserveView: true });
      if (!findProject(id)) return false;
    }
    if (id === getSessionProjectId() && !options.force) {
      applyBanner();
      applyDetailContextNotice();
      return true;
    }

    switching = true;
    syncSeq += 1;
    try {
      await persistActiveProjectOnServer(id);
      setSessionProjectId(id, { applyBanner: false });
      clearProjectScopedCaches();
      if (!options.keepView) clearViewContext({ silent: true });
      applyBanner();
      applyDetailContextNotice();
      emit('session-changed', { projectId: id });
      await notifyModulesProjectSwitched(id);
      if (options.refresh !== false && typeof App.refresh === 'function') {
        await App.refresh();
      }
      return true;
    } finally {
      switching = false;
    }
  }

  async function clearSessionProject(options = {}) {
    switching = true;
    syncSeq += 1;
    try {
      setSessionProjectId('', { applyBanner: false });
      clearProjectScopedCaches();
      clearViewContext({ silent: true });
      applyBanner();
      applyDetailContextNotice();
      emit('session-changed', { projectId: '' });
      if (options.refresh !== false && typeof App.refresh === 'function') {
        await App.refresh();
      }
      return true;
    } finally {
      switching = false;
    }
  }

  function openProjectView(projectId) {
    viewProjectId = String(projectId || '').trim();
    applyDetailContextNotice();
    emit('view-changed', { projectId: viewProjectId });
  }

  function clearViewContext(options = {}) {
    viewProjectId = '';
    applyDetailContextNotice();
    if (!options.silent) emit('view-changed', { projectId: '' });
  }

  async function refreshFromServer(options = {}) {
    const seq = ++syncSeq;
    const localSessionId = getSessionProjectId();

    try {
      const currentRes = await App.api('/api/projects/current', { method: 'GET' });
      if (seq !== syncSeq) return { stale: true };
      const projectsRes = await App.api('/api/projects', { method: 'GET' });
      if (seq !== syncSeq) return { stale: true };

      state().projects = Array.isArray(projectsRes.projects)
        ? projectsRes.projects
        : (projectsRes.data || []);

      const currentProject = currentRes.project || currentRes.currentProject || null;
      let serverId = String(currentProject?.id || '').trim();

      if (!serverId && localSessionId && findProject(localSessionId)) {
        const persisted = await persistActiveProjectOnServer(localSessionId);
        if (persisted) serverId = localSessionId;
      }

      if (serverId) {
        setSessionProjectId(serverId, { applyBanner: false });
      } else {
        setSessionProjectId('', { applyBanner: false });
      }

      if (options.preserveView !== false && getViewProjectId() && !findProject(getViewProjectId())) {
        clearViewContext({ silent: true });
      }

      await migrateLegacyLocalLogosToServer();
      applyBanner();
      applyFavicon();
      applyDetailContextNotice();
      return { stale: false, projects: state().projects };
    } catch (err) {
      if (seq !== syncSeq) return { stale: true };
      throw err;
    }
  }

  function init() {
    applyBanner();
    applyFavicon();
    applyDetailContextNotice();
  }

  return {
    init,
    getSessionProjectId,
    getSessionProject,
    getViewProjectId,
    getViewProject,
    getDetailProjectId,
    hasViewContext,
    switchSessionProject,
    clearSessionProject,
    openProjectView,
    clearViewContext,
    refreshFromServer,
    applyBanner,
    applyFavicon,
    applyDetailContextNotice,
    getProjectLogoDataUrl,
    getProjectFaviconDataUrl,
    setProjectLogoDataUrl,
    setProjectFaviconDataUrl,
    syncProjectLogoInState,
    syncProjectFaviconInState,
    clearLegacyProjectLogoFromStorage,
    migrateLegacyLocalLogosToServer,
    readProjectLogoMap,
    isSwitching: () => switching,
    getRevision: () => syncSeq,
  };
})();
