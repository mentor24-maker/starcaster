'use strict';

const { getProviderValues } = require('./apiSettings');
const config = require('./config');

async function sendEmail({ to, subject, html, text, fromName, fromEmail }) {
  const resend = getProviderValues('resend');
  const apiKey = String(resend?.api_key || '').trim();

  if (!apiKey) {
    return { ok: false, status: 500, error: 'Resend API key is completely missing from API Connections Settings.' };
  }

  const fallbackFromName = String(resend?.email_from_name || config.get('emailFromName') || 'ISITAS Platform');
  const fallbackFromEmail = String(resend?.email_from_address || config.get('emailFromAddress') || 'noreply@isitas.org');

  const finalFromName = String(fromName || fallbackFromName).trim();
  const finalFromEmail = String(fromEmail || fallbackFromEmail).trim();
  const fromStr = finalFromName ? `${finalFromName} <${finalFromEmail}>` : finalFromEmail;

  try {
    const payload = {
      from: fromStr,
      to: Array.isArray(to) ? to : [to],
      subject: String(subject || ''),
    };

    if (html) payload.html = String(html);
    if (text) payload.text = String(text);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      return { 
        ok: false, 
        status: res.status, 
        error: data?.message || data?.error?.message || `Resend Email API failed with status ${res.status}` 
      };
    }

    return { ok: true, status: 200, data };

  } catch (e) {
    return { ok: false, status: 500, error: e.message || 'System Network Error sending email' };
  }
}

module.exports = {
  sendEmail,
};
