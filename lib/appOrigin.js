'use strict';

function safeText(value) {
  return String(value || '').trim();
}

/**
 * Public origin for links in outbound email (invites, etc.).
 */
function getAppPublicOrigin(req) {
  const configured = safeText(
    process.env.PUBLIC_APP_ORIGIN
    || process.env.APP_PUBLIC_ORIGIN
    || process.env.PUBLIC_BASE_URL
  );
  if (configured) return configured.replace(/\/+$/, '');

  const vercel = safeText(process.env.VERCEL_URL);
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`;

  const host = safeText(req?.headers?.['x-forwarded-host'] || req?.headers?.host);
  const proto = safeText(req?.headers?.['x-forwarded-proto']) || 'http';
  if (host && !/^localhost/i.test(host) && !/^127\./.test(host)) {
    return `${proto}://${host.replace(/\/+$/, '')}`;
  }

  return 'http://localhost:3001';
}

module.exports = {
  getAppPublicOrigin,
};
