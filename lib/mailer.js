'use strict';

const { getProviderValues } = require('./apiSettings');
const config = require('./config');

/**
 * `attachments`: [{ filename, content, contentType? }], where `content` is the
 * file as base64. The booking emails attach an "add to calendar" .ics this way
 * (SC-912); Resend calls the type field `content_type`.
 */
async function sendEmail({ to, subject, html, text, fromName, fromEmail, replyTo, attachments }) {
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
    // Lets a site owner hit Reply on a contact-form alert and reach the person
    // who submitted it, without the alert appearing to come from them.
    if (replyTo) payload.reply_to = Array.isArray(replyTo) ? replyTo : [String(replyTo)];
    if (Array.isArray(attachments) && attachments.length) {
      payload.attachments = attachments.map((file) => ({
        filename: String(file.filename || 'attachment'),
        content: String(file.content || ''),
        ...(file.contentType ? { content_type: String(file.contentType) } : {}),
      }));
    }

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
