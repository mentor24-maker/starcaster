const http = require('http');
const crypto = require('crypto');

(async () => {
  console.log("Starting test...");
  const authStore = require('../lib/authStore');

  const testEmail = 'test_' + Date.now() + '@example.com';
  console.log("Creating user: " + testEmail);
  const created = await authStore.createUser({ name: 'Test User', email: testEmail, password: 'password123' });
  console.log("Created user:", created);

  if (!created.ok && created.status !== 409) {
     console.error("Failed to create user");
     return;
  }

  const authenticated = await authStore.authenticateUser({ email: testEmail, password: 'password123' });
  console.log("Authenticated user:", authenticated);

  if (!authenticated.ok) {
     console.error("Failed to authenticate");
     return;
  }

  const session = await authStore.createSession(authenticated.data.id);
  console.log("Created session:", session);

  if (!session.ok) {
     console.error("Failed to create session");
     return;
  }

  const token = session.data.token;
  console.log("Token is:", token);

  // Now let's try to resolve it!
  const user = await authStore.getUserFromSessionToken(token);
  console.log("Resolved user from token:", user);

})();
