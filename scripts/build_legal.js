const fs = require('fs');
const path = require('path');

const legalDir = path.join(__dirname, '../src/legal');
const publicDir = path.join(__dirname, '../public');

const PAGES = [
  {
    outFile: 'privacy-policy.html',
    title: 'Privacy Policy — StarCaster',
    bodyFile: '_privacy-body.html',
    sibling: { href: '/terms-of-service', label: 'Terms of Service' },
  },
  {
    outFile: 'terms-of-service.html',
    title: 'Terms of Service — StarCaster',
    bodyFile: '_terms-body.html',
    sibling: { href: '/privacy-policy', label: 'Privacy Policy' },
  },
];

function shell({ title, body, sibling }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link rel="icon" type="image/png" sizes="512x512" href="/images/favicon_alphire_512x512.png" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body class="legal-standalone">
  <header class="legal-standalone-header">
    <a href="/">
      <img src="/images/logo_starcaster_1920x300.png" alt="StarCaster by Alphire" />
    </a>
  </header>
  <main class="legal-standalone-main legal-document">
${body}
  </main>
  <footer class="legal-standalone-footer">
    <a href="/">Home</a>
    <span aria-hidden="true"> · </span>
    <a href="${sibling.href}">${sibling.label}</a>
  </footer>
</body>
</html>
`;
}

function buildLegalPages() {
  if (!fs.existsSync(legalDir)) {
    console.warn('No src/legal directory; skipping legal page build.');
    return;
  }

  PAGES.forEach((page) => {
    const bodyPath = path.join(legalDir, page.bodyFile);
    if (!fs.existsSync(bodyPath)) {
      console.warn(`⚠️ Legal body not found: ${bodyPath}`);
      return;
    }
    const body = fs.readFileSync(bodyPath, 'utf8').trim();
    const html = shell({
      title: page.title,
      body,
      sibling: page.sibling,
    });
    const outPath = path.join(publicDir, page.outFile);
    fs.writeFileSync(outPath, html, 'utf8');
    console.log(`Built ${outPath}`);
  });
}

if (require.main === module) {
  buildLegalPages();
}

module.exports = { buildLegalPages };
