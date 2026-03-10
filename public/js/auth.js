window.App = window.App || {};

App.auth = {
  manifest: {
    id: 'auth',
    label: 'Authentication',
    pageId: '',
  },
  user: null,
  _started: false,
  _bootMainApp: null,
};

App.auth._els = {
  appShell: null,
  authLanding: null,
  authMessage: null,
  authModeLabel: null,
  authLoginForm: null,
  authRegisterForm: null,
  authShowLogin: null,
  authShowRegister: null,
  authWelcomeName: null,
  authLogoutButton: null,
};

App.auth._cacheEls = function _cacheEls() {
  const ids = [
    'appShell',
    'authLanding',
    'authMessage',
    'authModeLabel',
    'authLoginForm',
    'authRegisterForm',
    'authShowLogin',
    'authShowRegister',
    'authWelcomeName',
    'authLogoutButton',
  ];
  ids.forEach((id) => {
    App.auth._els[id] = document.getElementById(id);
  });
};

App.auth._setMessage = function _setMessage(text, isError = false) {
  const box = App.auth._els.authMessage;
  if (!box) return;
  box.textContent = String(text || '');
  box.classList.toggle('error', Boolean(isError));
};

App.auth._setMode = function _setMode(modeInput) {
  const mode = modeInput === 'register' ? 'register' : 'login';
  const {
    authModeLabel,
    authLoginForm,
    authRegisterForm,
    authShowLogin,
    authShowRegister,
  } = App.auth._els;

  if (authModeLabel) {
    authModeLabel.textContent = mode === 'register' ? 'Create your account' : 'Sign in';
  }
  if (authLoginForm) authLoginForm.classList.toggle('hidden', mode !== 'login');
  if (authRegisterForm) authRegisterForm.classList.toggle('hidden', mode !== 'register');
  if (authShowLogin) authShowLogin.classList.toggle('active', mode === 'login');
  if (authShowRegister) authShowRegister.classList.toggle('active', mode === 'register');
  App.auth._setMessage('');
};

App.auth._showLanding = function _showLanding(mode = 'login') {
  const { appShell, authLanding, authLogoutButton, authWelcomeName } = App.auth._els;
  if (appShell) appShell.classList.add('hidden');
  if (authLanding) authLanding.classList.remove('hidden');
  if (authLogoutButton) authLogoutButton.classList.add('hidden');
  if (authWelcomeName) authWelcomeName.textContent = '';
  App.auth._setMode(mode);
};

App.auth._showApp = function _showApp() {
  const { appShell, authLanding, authLogoutButton, authWelcomeName } = App.auth._els;
  if (authLanding) authLanding.classList.add('hidden');
  if (appShell) appShell.classList.remove('hidden');
  if (authLogoutButton) authLogoutButton.classList.remove('hidden');
  if (authWelcomeName) {
    const accountLabel = String(App.auth.user?.name || App.auth.user?.email || '').trim();
    authWelcomeName.textContent = accountLabel || 'Account';
  }
};

App.auth._startMainApp = function _startMainApp() {
  if (App.auth._started) return;
  if (typeof App.auth._bootMainApp === 'function') {
    App.auth._bootMainApp();
    App.auth._started = true;
  }
};

App.auth._syncProjectContext = async function _syncProjectContext() {
  try {
    const res = await App.api('/api/projects/current', { method: 'GET' });
    const project = res.project || res.currentProject || null;
    const projectId = String(project?.id || '').trim();
    if (projectId) {
      App.state.currentProjectId = projectId;
      window.localStorage.setItem(App.CURRENT_PROJECT_ID_STORAGE_KEY || 'alphire.currentProjectId', projectId);
    }
  } catch (_) {
    // Non-fatal during auth boot; project context can still be selected later.
  }
};

App.auth.handleUnauthorized = function handleUnauthorized() {
  App.auth.user = null;
  App.auth._showLanding('login');
};

App.auth._login = async function _login(payload) {
  const body = {
    email: String(payload?.email || '').trim(),
    password: String(payload?.password || ''),
  };
  const res = await App.api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.user || res.data?.user || null;
};

App.auth._register = async function _register(payload) {
  const body = {
    name: String(payload?.name || '').trim(),
    email: String(payload?.email || '').trim(),
    password: String(payload?.password || ''),
  };
  const res = await App.api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.user || res.data?.user || null;
};

App.auth._me = async function _me() {
  const res = await App.api('/api/auth/me', { method: 'GET' });
  return res.user || res.data?.user || null;
};

App.auth._logout = async function _logout() {
  await App.api('/api/auth/logout', { method: 'POST' });
};

App.auth.init = function init(bootMainApp) {
  App.auth._bootMainApp = bootMainApp;
  App.auth._cacheEls();

  const {
    authShowLogin,
    authShowRegister,
    authLoginForm,
    authRegisterForm,
    authWelcomeName,
    authLogoutButton,
  } = App.auth._els;

  if (authShowLogin) {
    authShowLogin.addEventListener('click', () => App.auth._setMode('login'));
  }
  if (authShowRegister) {
    authShowRegister.addEventListener('click', () => App.auth._setMode('register'));
  }

  if (authLoginForm) {
    authLoginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(authLoginForm);
      App.auth._setMessage('Signing in...');
      try {
        const user = await App.auth._login({
          email: form.get('email'),
          password: form.get('password'),
        });
        App.auth.user = user;
        await App.auth._syncProjectContext();
        App.auth._showApp();
        App.auth._startMainApp();
        App.auth._setMessage('');
      } catch (err) {
        App.auth._setMessage(err.message || 'Login failed', true);
      }
    });
  }

  if (authRegisterForm) {
    authRegisterForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(authRegisterForm);
      const password = String(form.get('password') || '');
      const confirmPassword = String(form.get('confirm_password') || '');
      if (password !== confirmPassword) {
        App.auth._setMessage('Passwords do not match', true);
        return;
      }
      App.auth._setMessage('Creating account...');
      try {
        const user = await App.auth._register({
          name: form.get('name'),
          email: form.get('email'),
          password,
        });
        App.auth.user = user;
        await App.auth._syncProjectContext();
        App.auth._showApp();
        App.auth._startMainApp();
        App.auth._setMessage('');
      } catch (err) {
        App.auth._setMessage(err.message || 'Registration failed', true);
      }
    });
  }

  if (authLogoutButton) {
    authLogoutButton.addEventListener('click', async () => {
      try {
        await App.auth._logout();
      } catch (_) {
        // noop
      }
      App.auth.user = null;
      App.auth._showLanding('login');
    });
  }

  if (authWelcomeName) {
    authWelcomeName.addEventListener('click', (event) => {
      event.preventDefault();
      if (typeof App.setActivePage === 'function') {
        App.setActivePage('settingsProfilePage');
      }
    });
  }

  App.auth._showLanding('login');
  App.auth._setMessage('Checking session...');
  App.auth._me()
    .then((user) => {
      App.auth.user = user;
      return App.auth._syncProjectContext().then(() => {
        App.auth._showApp();
        App.auth._startMainApp();
        App.auth._setMessage('');
      });
    })
    .catch(() => {
      App.auth.user = null;
      App.auth._showLanding('login');
      App.auth._setMessage('');
    });
};
