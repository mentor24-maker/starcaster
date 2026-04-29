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
  authRegisterForm: null,
  authForgotPasswordForm: null,
  authResetPasswordForm: null,
  authShowLogin: null,
  authShowRegister: null,
  authShowForgotPassword: null,
  authCancelForgotPassword: null,
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
    'authForgotPasswordForm',
    'authResetPasswordForm',
    'authShowLogin',
    'authShowRegister',
    'authShowForgotPassword',
    'authCancelForgotPassword',
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
  let mode = 'login';
  if (['register', 'forgot_password', 'reset_password'].includes(modeInput)) {
    mode = modeInput;
  }
  
  const {
    authModeLabel,
    authLoginForm,
    authRegisterForm,
    authForgotPasswordForm,
    authResetPasswordForm,
    authShowLogin,
    authShowRegister,
    authShowForgotPassword,
  } = App.auth._els;

  if (authModeLabel) {
    if (mode === 'register') authModeLabel.textContent = 'Create your account';
    else if (mode === 'forgot_password') authModeLabel.textContent = 'Password Reset';
    else if (mode === 'reset_password') authModeLabel.textContent = 'Verify Secure Code';
    else authModeLabel.textContent = 'Sign in';
  }
  
  if (authLoginForm) authLoginForm.classList.toggle('hidden', mode !== 'login');
  if (authRegisterForm) authRegisterForm.classList.toggle('hidden', mode !== 'register');
  if (authForgotPasswordForm) authForgotPasswordForm.classList.toggle('hidden', mode !== 'forgot_password');
  if (authResetPasswordForm) authResetPasswordForm.classList.toggle('hidden', mode !== 'reset_password');
  
  if (authShowLogin) authShowLogin.classList.toggle('active', mode === 'login' || mode === 'forgot_password' || mode === 'reset_password');
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
  try {
    window.localStorage.removeItem('alphire.authUser');
  } catch (_) {}
  App.auth._showLanding('login');
  App.auth._setMessage('');
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

App.auth._forgotPassword = async function _forgotPassword(email) {
  return App.api('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email: String(email || '').trim() }),
  });
};

App.auth._confirmReset = async function _confirmReset(email, code, new_password) {
  return App.api('/api/auth/confirm-reset', {
    method: 'POST',
    body: JSON.stringify({ email: String(email || '').trim(), code: String(code || '').trim(), new_password: String(new_password || '') }),
  });
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
    authShowForgotPassword,
    authCancelForgotPassword,
    authLoginForm,
    authRegisterForm,
    authForgotPasswordForm,
    authResetPasswordForm,
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

  if (authShowForgotPassword) {
    authShowForgotPassword.addEventListener('click', (event) => {
      event.preventDefault();
      App.auth._setMode('forgot_password');
    });
  }

  if (authCancelForgotPassword) {
    authCancelForgotPassword.addEventListener('click', (event) => {
      event.preventDefault();
      App.auth._setMode('login');
    });
  }

  let resetContextEmail = '';

  if (authForgotPasswordForm) {
    authForgotPasswordForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(authForgotPasswordForm);
      const email = form.get('email');
      App.auth._setMessage('Dispatching reset code locally...');
      try {
        await App.auth._forgotPassword(email);
        resetContextEmail = email;
        App.auth._setMode('reset_password');
        App.auth._setMessage('Code sent perfectly. Check your inbox.', false);
      } catch (err) {
        App.auth._setMessage(err.message || 'Error sending code', true);
      }
    });
  }

  if (authResetPasswordForm) {
    authResetPasswordForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(authResetPasswordForm);
      const code = form.get('code');
      const newPwd = form.get('new_password');
      App.auth._setMessage('Verifying cryptographic token...');
      try {
        await App.auth._confirmReset(resetContextEmail, code, newPwd);
        App.auth._setMode('login');
        App.auth._setMessage('Password physically updated. You may now securely login.', false);
        authResetPasswordForm.reset();
        authForgotPasswordForm.reset();
        resetContextEmail = '';
      } catch (err) {
        App.auth._setMessage(err.message || 'Invalid code or password structure', true);
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

  // Delay showing the login screen until we definitively know auth failed.
  // This prevents the login screen from brutally flashing on every page reload.
  // App.auth._showLanding('login');
  // App.auth._setMessage('Checking session...');
  App.auth._me()
    .then((user) => {
      App.auth.user = user;
      return App.auth._syncProjectContext().then(() => {
        App.auth._showApp();
        App.auth._startMainApp();
        App.auth._setMessage('');
      });
    })
    .catch((e) => {
      console.error('Core Boot Error:', e);
      if (e?.message !== 'Not authenticated') App.notify('Boot Error: ' + (e?.message || e), true);
      App.auth.user = null;
      try {
        window.localStorage.removeItem('alphire.authUser');
      } catch (_) {}
      App.auth._showLanding('login');
      App.auth._setMessage('');
    });
};
