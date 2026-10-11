'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Which hosts get the admin app and which get a tenant site.
 *
 * Task 86bcgjq5k (2026-10-11): the admin app moved from starcaster.pro to
 * app.starcaster.pro so the company's own Builder-built site could appear at
 * starcaster.pro. Three copies of the host list exist — lib, the edge
 * middleware, and the layout fallback script — and a copy that drifts serves
 * the login screen on a client's domain or a client's site on the admin host.
 */

const root = path.join(__dirname, '../..');
const hosts = require('../../lib/publicSiteHosts');

function regexSourceIn(file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const match = /const SYSTEM_HOST_RE = (\/.*\/);/.exec(text);
  assert.ok(match, `${file} declares SYSTEM_HOST_RE`);
  return match[1];
}

test('the three host lists agree: lib, middleware, layout fallback', () => {
  assert.equal(regexSourceIn('middleware.mjs'), regexSourceIn('lib/publicSiteHosts.js'));
  assert.equal(`/${hosts.SYSTEM_HOST_RE.source}/`, regexSourceIn('lib/publicSiteHosts.js'));

  const layout = fs.readFileSync(path.join(root, 'src/layout.html'), 'utf8');
  assert.match(layout, /h === 'app\.starcaster\.pro'/);
  assert.doesNotMatch(layout, /h === 'starcaster\.pro'/);
  assert.doesNotMatch(layout, /endsWith\('\.starcaster\.pro'\)/);
});

test('app.starcaster.pro, localhost and Vercel previews are system hosts', () => {
  for (const host of ['app.starcaster.pro', 'APP.starcaster.pro:443', 'localhost:3001', '127.0.0.1', 'starcaster-git-x.vercel.app']) {
    assert.equal(hosts.isSystemHost(host), true, host);
  }
});

test('starcaster.pro (apex and www), its subdomains and client domains are tenant hosts', () => {
  for (const host of ['starcaster.pro', 'www.starcaster.pro', 'delraytennis.starcaster.pro', 'delraytennis.com', 'www.brandonmarinoff.com']) {
    assert.equal(hosts.isSystemHost(host), false, host);
  }
});

test('the legal pages stay platform pages on the company apex only', () => {
  const { isPlatformPagePath } = hosts;
  assert.equal(isPlatformPagePath('starcaster.pro', '/privacy-policy'), true);
  assert.equal(isPlatformPagePath('www.starcaster.pro', '/privacy-policy.html'), true);
  assert.equal(isPlatformPagePath('starcaster.pro', '/Terms-Of-Service/'), true);
  assert.equal(isPlatformPagePath('starcaster.pro', '/data-deletion'), true);
  // The company site's own pages are not pinned — About, Explore, Home belong to the Builder.
  assert.equal(isPlatformPagePath('starcaster.pro', '/about'), false);
  assert.equal(isPlatformPagePath('starcaster.pro', '/'), false);
  // A client's privacy page is the client's.
  assert.equal(isPlatformPagePath('delraytennis.com', '/privacy-policy'), false);
  // The admin host serves them as ordinary static pages; no pin needed.
  assert.equal(isPlatformPagePath('app.starcaster.pro', '/privacy-policy'), false);
});

// ── The page handler, with the project store faked ───────────────────────────

const projectsStorePath = require.resolve('../../lib/projectsStore.js');
const pagesPath = require.resolve('../../routes/publicSitePages.js');

function withFakeProjects(byDomain) {
  const saved = new Map([[projectsStorePath, require.cache[projectsStorePath]], [pagesPath, require.cache[pagesPath]]]);
  require.cache[projectsStorePath] = {
    id: projectsStorePath, filename: projectsStorePath, loaded: true,
    exports: {
      findProjectByDomain: async (domain) => {
        const project = byDomain[String(domain).replace(/^www\./, '')];
        return project ? { ok: true, status: 200, data: project } : { ok: false, status: 404, error: 'No project found for this domain' };
      },
    },
  };
  delete require.cache[pagesPath];
  const handlers = require(pagesPath).createPublicSitePageHandlers({ isRegisteredApiPath: () => false });
  return {
    handlers,
    restore() {
      for (const [file, previous] of saved) {
        if (previous) require.cache[file] = previous; else delete require.cache[file];
      }
    },
  };
}

function fakeRes() {
  const res = { statusCode: 0, body: '', headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.end = (chunk) => { res.body = String(chunk || ''); };
  return res;
}

async function page(handlers, host, pathname) {
  const res = fakeRes();
  await handlers.handlePageRequest({ method: 'GET', url: pathname, headers: { host } }, res, pathname);
  return res;
}

test('on starcaster.pro the legal pages are served as platform pages; everything else is the Starcaster site', async () => {
  const { handlers, restore } = withFakeProjects({
    'starcaster.pro': { id: 'proj_sc', name: 'Starcaster', domain: 'starcaster.pro' },
    'delraytennis.com': { id: 'proj_d', name: 'Delray', domain: 'delraytennis.com' },
  });
  try {
    const legal = await page(handlers, 'www.starcaster.pro', '/privacy-policy');
    assert.equal(legal.headers['X-Site-Handler'], 'platform-page');
    assert.equal(legal.statusCode, 200);
    assert.doesNotMatch(legal.body, /id="siteRoot"/, 'the legal page is not the tenant site shell');

    const slashed = await page(handlers, 'starcaster.pro', '/terms-of-service/');
    assert.equal(slashed.headers['X-Site-Handler'], 'platform-page');
    assert.doesNotMatch(slashed.body, /id="siteRoot"/);
    assert.match(slashed.body, /<title>[^<]*Terms[^<]*<\/title>/, 'a trailing slash must serve the legal page, not fall back to the admin shell');

    const home = await page(handlers, 'www.starcaster.pro', '/');
    assert.equal(home.headers['X-Site-Handler'], 'resolved');

    const about = await page(handlers, 'starcaster.pro', '/about');
    assert.equal(about.headers['X-Site-Handler'], 'resolved', 'About is the Builder site\'s page, not the old platform page');

    const clientLegal = await page(handlers, 'delraytennis.com', '/privacy-policy');
    assert.equal(clientLegal.headers['X-Site-Handler'], 'resolved', 'a client\'s privacy page is the client\'s own');

    const admin = await page(handlers, 'app.starcaster.pro', '/');
    assert.equal(admin.headers['X-Site-Handler'], 'app-shell');
  } finally {
    restore();
  }
});
