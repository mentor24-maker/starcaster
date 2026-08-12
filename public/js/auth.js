window.App = window.App || {};

// Detect a contact project-invite token in the URL hash before anything else runs.
// Stored here so the login/register handlers can consume it after authentication.
// Detect the project-invite token in the URL hash and clean it from the address bar
// before the SPA hash-router has a chance to act on it. The token is saved in a local
// variable and written back onto App.auth AFTER the object is initialised below.
App.auth = App.auth || {};
let _detectedProjectInviteToken = null;
let _detectedSignupInviteToken = null;
(function detectProjectInviteHash() {
  try {
    const hash = String(window.location.hash || '');
    const m = hash.match(/[#&]project-invite=([^&]+)/);
    if (m) _detectedProjectInviteToken = decodeURIComponent(m[1]);
    // A sign-up invitation: the only way to reach the "create account" form
    // once invitations are switched on. Different token, different table, and
    // consumed at registration rather than after it.
    const s = hash.match(/[#&]signup-invite=([^&]+)/);
    if (s) _detectedSignupInviteToken = decodeURIComponent(s[1]);
    if (m || s) {
      // Clean the token from the address bar so it isn't bookmarked or shared
      const clean = window.location.pathname + window.location.search;
      window.history.replaceState(null, '', clean);
    }
  } catch (_) {}
}());

App.auth = {
  manifest: {
    id: 'auth',
    label: 'Authentication',
    pageId: '',
  },
  user: null,
  _started: false,
  _bootMainApp: null,
  // Preserved from detectProjectInviteHash above (the App.auth = {} below would have
  // wiped it if we stored directly on App.auth before the reassignment).
  _pendingProjectInviteToken: _detectedProjectInviteToken,
  _signupInviteToken: _detectedSignupInviteToken,
  // Null until /api/auth/registration-mode answers. Treated as "open" until
  // then so a failed check can never hide the form from a legitimate invitee.
  _registrationInviteOnly: null,
};

// An invitation link pasted into a tab that ALREADY has StarCaster open
// changes only the fragment. That is a same-document navigation: no reload,
// so the detection above never runs again and the invitation quietly does
// nothing — the same silent failure this whole flow exists to prevent.
// Opening the link from an email gives a fresh load and takes the path above.
window.addEventListener('hashchange', (event) => {
  try {
    // Read the token out of the EVENT, not out of window.location. The SPA's
    // hash router rewrites any hash it does not recognise back to
    // "#page=<current>", and it wins the race — by the time this handler looks
    // at the address bar the token is already gone.
    const match = String(event?.newURL || window.location.href || '').match(/[#&]signup-invite=([^&]+)/);
    if (!match) return;
    App.auth._signupInviteToken = decodeURIComponent(match[1]);
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    if (App.auth.user) App.auth._consumeSignupInvite();
    else App.auth._applyRegistrationMode().catch(() => {});
  } catch (_) {}
});

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

/**
 * Decide whether the "Register" tab is offered at all, and set up the form
 * when the visitor arrived on an invitation link.
 *
 * Fails open on purpose: if the mode check or the token check errors, the
 * form stays as it was rather than vanishing. A gate that hides itself when
 * the network hiccups turns a bad connection into "I can't sign up".
 */
App.auth._applyRegistrationMode = async function _applyRegistrationMode() {
  const { authShowRegister } = App.auth._els;
  const token = String(App.auth._signupInviteToken || '').trim();

  try {
    const res = await App.api('/api/auth/registration-mode', { method: 'GET' });
    const data = res.data || res;
    App.auth._registrationInviteOnly = Boolean(data.inviteOnly);
  } catch (_) {
    App.auth._registrationInviteOnly = null;
  }

  const inviteOnly = App.auth._registrationInviteOnly === true;
  if (authShowRegister) authShowRegister.classList.toggle('hidden', inviteOnly && !token);

  if (!token) return;

  // Confirm the link before showing the form, so a dead or expired link says
  // so immediately instead of after they have typed everything in.
  try {
    const res = await App.api(`/api/invitations/verify?token=${encodeURIComponent(token)}`, { method: 'GET' });
    const invite = res.data || res;

    // Someone who already has a login must be sent to the SIGN-IN form, not
    // the sign-up one: registering would be refused as a duplicate address,
    // which reads as "your invitation is broken". The token is redeemed after
    // they sign in, by _consumeSignupInvite.
    if (invite.hasAccount) {
      const loginEmail = App.auth._els.authLoginForm
        ? App.auth._els.authLoginForm.querySelector('input[name="email"]')
        : null;
      if (loginEmail && invite.email) loginEmail.value = invite.email;
      if (authShowRegister) authShowRegister.classList.toggle('hidden', inviteOnly);
      App.auth._setMode('login');
      App.auth._setMessage(
        invite.projectName
          ? `You already have a StarCaster account. Sign in and ${invite.projectName} will be added to it.`
          : 'You already have a StarCaster account. Sign in to accept this invitation.',
        false
      );
      return;
    }

    const form = App.auth._els.authRegisterForm;
    const emailInput = form ? form.querySelector('input[name="email"]') : null;
    if (emailInput && invite.email) {
      // The invitation is bound to this address server-side; letting them
      // change it here would only produce a confusing rejection.
      emailInput.value = invite.email;
      emailInput.readOnly = true;
    }
    App.auth._setMode('register');
    App.auth._setMessage(
      invite.projectName
        ? `You've been invited to ${invite.projectName}. Choose a password to finish.`
        : 'Choose a password to finish setting up your account.',
      false
    );
  } catch (err) {
    App.auth._signupInviteToken = null;
    if (authShowRegister) authShowRegister.classList.toggle('hidden', inviteOnly);
    App.auth._setMode('login');
    App.auth._setMessage(err.message || 'This invitation link is not valid.', true);
  }
};

App.auth._showLanding = function _showLanding(mode = 'login') {
  const { appShell, authLanding, authLogoutButton, authWelcomeName } = App.auth._els;
  if (appShell) appShell.classList.add('hidden');
  if (authLanding) authLanding.classList.remove('hidden');
  if (authLogoutButton) authLogoutButton.classList.add('hidden');
  if (authWelcomeName) authWelcomeName.textContent = '';
  App.auth._setMode(mode);
  // Once per visit: the answer cannot change while the page is open, and
  // re-running it would stamp over a message the visitor is reading.
  if (!App.auth._registrationModeApplied) {
    App.auth._registrationModeApplied = true;
    App.auth._applyRegistrationMode().catch(() => {});
  }
};

App.auth._showApp = function _showApp() {
  const { appShell, authLanding, authLogoutButton, authWelcomeName } = App.auth._els;
  if (authLanding) authLanding.classList.add('hidden');
  if (appShell) appShell.classList.remove('hidden');
  document.body.classList.remove('public-legal-view');
  if (authLogoutButton) authLogoutButton.classList.remove('hidden');
  if (authWelcomeName) {
    const accountLabel = String(App.auth.user?.name || App.auth.user?.email || '').trim();
    authWelcomeName.textContent = accountLabel || 'Account';
  }
};

App.auth._showPublicLegal = function _showPublicLegal(pageId) {
  const { appShell, authLanding, authLogoutButton } = App.auth._els;
  if (authLanding) authLanding.classList.add('hidden');
  if (appShell) appShell.classList.remove('hidden');
  document.body.classList.add('public-legal-view');
  if (authLogoutButton) authLogoutButton.classList.add('hidden');
  if (typeof App.setActivePage === 'function') {
    App.setActivePage(pageId, { persist: true });
  }
};

App.auth._showPublicAdmin = function _showPublicAdmin(pageId) {
  const { appShell, authLanding, authLogoutButton } = App.auth._els;
  if (authLanding) authLanding.classList.add('hidden');
  if (appShell) appShell.classList.remove('hidden');
  // Hide the standard platform chrome — admin page renders its own header.
  document.body.classList.add('project-admin-view');
  if (authLogoutButton) authLogoutButton.classList.add('hidden');
  if (typeof App.setActivePage === 'function') {
    App.setActivePage(pageId, { persist: true, skipTracking: true });
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
    if (App.projectContext?.refreshFromServer) {
      await App.projectContext.refreshFromServer();
      return;
    }
    const res = await App.api('/api/projects/current', { method: 'GET' });
    const project = res.project || res.currentProject || null;
    const projects = Array.isArray(res.projects)
      ? res.projects
      : (Array.isArray(res.data?.projects) ? res.data.projects : []);
    const projectId = String(project?.id || '').trim();
    if (projects.length) App.state.projects = projects;
    if (projectId) {
      App.state.currentProject = project;
      App.state.currentProjectId = projectId;
      window.localStorage.setItem(App.CURRENT_PROJECT_ID_STORAGE_KEY || 'alphire.currentProjectId', projectId);
    }
  } catch (_) {
    // Non-fatal during auth boot; project context can still be selected later.
  }
};

App.auth._sessionCheckPending = false;
App.auth._onAuthenticated = [];

App.whenAuthenticated = function whenAuthenticated(fn) {
  if (typeof fn !== 'function') return Promise.resolve();
  if (App.auth.user) return Promise.resolve().then(fn);
  App.auth._onAuthenticated.push(fn);
  return Promise.resolve();
};

App.auth._runAuthenticatedCallbacks = function _runAuthenticatedCallbacks() {
  const queue = Array.isArray(App.auth._onAuthenticated) ? App.auth._onAuthenticated.splice(0) : [];
  queue.forEach((fn) => {
    try {
      Promise.resolve().then(fn);
    } catch (_) {}
  });
};

App.auth.handleUnauthorized = function handleUnauthorized() {
  if (!App.auth.user) return;
  App.auth.user = null;
  try {
    window.localStorage.removeItem('alphire.authUser');
  } catch (_) {}
  if (typeof App.setSessionToken === 'function') App.setSessionToken('');
  App.auth._showLanding('login');
  App.auth._setMessage('');
};

/**
 * Redeem a sign-up invitation for someone who ALREADY has an account.
 *
 * Registration redeems the token itself, so this only has work to do when the
 * invited address was already registered. Before it existed, such an
 * invitation could never be accepted: signed in, the link did nothing at all
 * (the sign-in screen never appears, so nothing looked at the token); signed
 * out, it led to a sign-up form that refused the duplicate address.
 */
App.auth._consumeSignupInvite = async function _consumeSignupInvite() {
  const token = String(App.auth._signupInviteToken || '').trim();
  if (!token || !App.auth.user) return;
  App.auth._signupInviteToken = null;

  try {
    const res = await App.api('/api/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    const data = res?.data || res || {};
    const projectId = String(data.projectId || '').trim();
    const projectName = String(data.projectName || '').trim();

    if (!projectId) {
      App.notify('Invitation accepted.');
      return;
    }
    App.notify(projectName ? `You've been added to ${projectName}.` : 'You have been added to the project.');
    if (App.projectContext?.switchSessionProject) {
      App.projectContext.switchSessionProject(projectId, { keepView: false, refresh: true }).catch(() => {
        window.location.reload();
      });
    } else {
      window.location.reload();
    }
  } catch (err) {
    // Say why. A silently dropped invitation is what this whole change exists
    // to stop happening.
    App.notify(err.message || 'That invitation could not be accepted.', true);
  }
};

App.auth._consumePendingProjectInvite = async function _consumePendingProjectInvite() {
  const token = App.auth._pendingProjectInviteToken;
  if (!token) return;
  App.auth._pendingProjectInviteToken = null;
  try {
    const res = await App.api('/api/contacts/accept-project-invite', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    const projectId = String(res?.projectId || res?.data?.projectId || '').trim();
    if (!projectId) return;
    // Set the project server-side so it survives a reload
    await App.api('/api/projects/active', {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }).catch(() => {});
    // Use switchSessionProject if the module is already up; otherwise reload
    if (App.projectContext?.switchSessionProject) {
      App.projectContext.switchSessionProject(projectId, { keepView: false, refresh: true }).catch(() => {
        window.location.reload();
      });
    } else {
      window.location.reload();
    }
  } catch (_) {}
};

App.auth._persistSessionToken = function _persistSessionToken(res) {
  const token = String(res?.sessionToken || res?.data?.sessionToken || '').trim();
  if (token && typeof App.setSessionToken === 'function') {
    App.setSessionToken(token);
  }
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
  App.auth._persistSessionToken(res);
  return res.user || res.data?.user || null;
};

App.auth._register = async function _register(payload) {
  const body = {
    name: String(payload?.name || '').trim(),
    email: String(payload?.email || '').trim(),
    password: String(payload?.password || ''),
  };
  const inviteToken = String(App.auth._signupInviteToken || '').trim();
  if (inviteToken) body.inviteToken = inviteToken;
  const res = await App.api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  // Registration redeems the token server-side. Clearing it here stops
  // _consumeSignupInvite from trying to spend it a second time and reporting
  // "already used" on a sign-up that just worked.
  App.auth._signupInviteToken = null;
  App.auth._persistSessionToken(res);
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
  try {
    await App.api('/api/auth/logout', { method: 'POST' });
  } finally {
    if (typeof App.setSessionToken === 'function') App.setSessionToken('');
  }
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
        App.auth._runAuthenticatedCallbacks();
        App.auth._consumePendingProjectInvite();
        App.auth._consumeSignupInvite();
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
        App.auth._runAuthenticatedCallbacks();
        App.auth._consumePendingProjectInvite();
        App.auth._consumeSignupInvite();
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

  if (App.auth._pendingProjectInviteToken) {
    App.auth._setMessage('Log in or register to accept your project invitation.', false);
  }

  App.auth._sessionCheckPending = true;

  App.auth._me()
    .then((user) => {
      App.auth.user = user;
      return App.auth._syncProjectContext().then(() => {
        App.auth._showApp();
        App.auth._startMainApp();
        App.auth._runAuthenticatedCallbacks();
        App.auth._consumePendingProjectInvite();
        App.auth._consumeSignupInvite();
        App.auth._setMessage('');
      });
    })
    .catch((e) => {
      if (e?.message !== 'Not authenticated') {
        console.error('Core Boot Error:', e);
        App.notify('Boot Error: ' + (e?.message || e), true);
      }
      App.auth.user = null;
      try {
        window.localStorage.removeItem('alphire.authUser');
      } catch (_) {}
      const initialPage = typeof App.getInitialPage === 'function' ? App.getInitialPage() : '';
      const publicLegal = Array.isArray(App.PUBLIC_LEGAL_PAGE_IDS) && App.PUBLIC_LEGAL_PAGE_IDS.includes(initialPage);
      const publicAdmin = Array.isArray(App.PUBLIC_ADMIN_PAGE_IDS) && App.PUBLIC_ADMIN_PAGE_IDS.includes(initialPage);
      if (publicLegal) {
        App.auth._showPublicLegal(initialPage);
        App.auth._startMainApp();
      } else if (publicAdmin) {
        App.auth._showPublicAdmin(initialPage);
        App.auth._startMainApp();
      } else {
        App.auth._showLanding('login');
      }
      App.auth._setMessage('');
    })
    .finally(() => {
      App.auth._sessionCheckPending = false;
    });
};
