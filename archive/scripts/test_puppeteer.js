const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('https://app.isitas.org/', { waitUntil: 'networkidle0' });
  
  const outerHTML = await page.evaluate(() => {
    return {
      authLanding: document.getElementById('authLanding') ? document.getElementById('authLanding').outerHTML : 'null',
      appShell: document.getElementById('appShell') ? document.getElementById('appShell').outerHTML.substring(0, 200) : 'null',
      toasts: document.body.innerHTML.match(/c-toast/g) ? document.body.innerHTML.match(/c-toast/g).length : 0
    };
  });
  
  console.log(JSON.stringify(outerHTML, null, 2));
  await browser.close();
})();
