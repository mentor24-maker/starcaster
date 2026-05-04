const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Navigating to http://localhost:3000');
  await page.goto('http://localhost:3000');

  // Let's execute login request manually using fetch in the page to ensure we know the credentials
  console.log('Logging in...');
  const loginRes = await page.evaluate(async () => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@alphire.com', password: 'password123' }) // Need to know correct credentials or we can register one
    });
    return { status: res.status, ok: res.ok, body: await res.json() };
  });

  console.log('Login result:', loginRes);

  if (!loginRes.ok && loginRes.status === 401) {
      // Let's try to register
      console.log('Registering...');
      const regRes = await page.evaluate(async () => {
          const res = await fetch('/api/auth/register', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: 'Test', email: 'test12345@alphire.com', password: 'password123' })
          });
          return { status: res.status, ok: res.ok, body: await res.json() };
      });
      console.log('Register result:', regRes);
  }

  // Get cookies
  const cookies = await context.cookies();
  console.log('Cookies in browser:', cookies);

  // Now let's try to fetch /api/assets
  console.log('Fetching /api/assets...');
  const assetsRes = await page.evaluate(async () => {
    const res = await fetch('/api/assets', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    });
    return { status: res.status, ok: res.ok, text: await res.text() };
  });

  console.log('Assets result:', assetsRes);

  await browser.close();
})();
