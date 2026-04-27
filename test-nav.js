const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('BROWSER ERROR:', msg.text());
    }
  });

  page.on('pageerror', err => {
    console.log('PAGE ERROR:', err.message);
  });

  await page.goto('http://localhost:3000');
  
  // Wait for login form to be visible
  await page.waitForTimeout(2000);
  const loginFormVisible = await page.isVisible('#authLoginForm');
  if (loginFormVisible) {
    console.log('Logging in...');
    await page.fill('#authLoginEmail', 'admin@example.com'); // Put a dummy or check if bypass works
    // Wait, the app might need a real login, or there is a bypass.
    // Let's just evaluate App.setActivePage directly!
    console.log('Evaluating setActivePage...');
    await page.evaluate(() => {
      window.App.setActivePage('contactsPage');
    });
  }
  
  await page.waitForTimeout(1000);
  
  const isContactsVisible = await page.evaluate(() => {
    const el = document.getElementById('contactsPage');
    return el && !el.classList.contains('hidden');
  });
  
  console.log('Contacts page visible?', isContactsVisible);
  
  await browser.close();
})();
