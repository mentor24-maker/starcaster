const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Go to local server
  await page.goto('http://localhost:3000');

  // Wait for the app shell or auth landing
  await page.waitForSelector('body');

  // We can inject a script to bypass auth and initialize the app shell
  await page.evaluate(() => {
    // Fake login
    document.getElementById('authLanding').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
    if (window.App && App.setActivePage) {
      App.setActivePage('devForumPage', { forceDevReset: true });
    }
  });

  await page.waitForTimeout(1000);

  // Now inject some test chat nodes to test the threading hierarchy
  await page.evaluate(() => {
    // Ensure devElements.log exists and is empty
    const log = document.getElementById('devChatLog');
    if (!log) return;
    log.innerHTML = '';

    // Create a parent chat
    const parentChat = {
      id: 'msg-parent-1',
      role: 'user',
      content: 'Can we implement the new feature?',
      created_at: new Date().toISOString()
    };
    App.devAgent.appendChatNode(parentChat);

    // Create a child reply (short)
    const child1 = {
      id: 'msg-child-1',
      parent_id: 'msg-parent-1',
      role: 'model',
      content: 'Yes, I will start working on the implementation plan.',
      created_at: new Date().toISOString()
    };
    App.devAgent.appendChatNode(child1);

    // Create a deeply nested reply (long text)
    const child2 = {
      id: 'msg-child-2',
      parent_id: 'msg-child-1',
      role: 'user',
      content: 'Great. Please make sure to include:\n1. Unit tests\n2. Documentation\n3. Edge cases for the threading hierarchy, ensuring that very long messages like this one do not break the CSS visual connector lines. The pseudo-elements should stretch to cover the entire height of the message block, preventing any weird clipping. Let me just add a bit more text here to really stretch the bubble height out. This should be enough to test it.',
      created_at: new Date().toISOString()
    };
    App.devAgent.appendChatNode(child2);
    
    // Create another child reply to parent
    const child3 = {
      id: 'msg-child-3',
      parent_id: 'msg-parent-1',
      role: 'model',
      content: 'Just wanted to provide an update, the first draft is ready.',
      created_at: new Date().toISOString()
    };
    App.devAgent.appendChatNode(child3);
  });

  await page.waitForTimeout(1000); // let animations or DOM settle

  // Take a screenshot of the forum area
  const forumPage = await page.$('#devForumPage');
  if (forumPage) {
    await forumPage.screenshot({ path: 'threading_test.png' });
  } else {
    await page.screenshot({ path: 'threading_test_full.png', fullPage: true });
  }

  await browser.close();
  console.log('Test completed, screenshot saved.');
})();
