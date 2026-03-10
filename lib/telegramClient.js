'use strict';

const { getProviderValues } = require('./apiSettings');

function safeText(value) {
  return String(value || '').trim();
}

function getTelegramCredentials() {
  const cfg = getProviderValues('telegram');
  return {
    botToken: safeText(cfg.bot_token),
    chatId: safeText(cfg.chat_id),
    webhookUrl: safeText(cfg.webhook_url),
    baseUrl: safeText(cfg.base_url) || 'https://api.telegram.org',
  };
}

function isConfigured(credsInput) {
  const creds = credsInput || getTelegramCredentials();
  return Boolean(creds.botToken);
}

async function sendMessage(text, options = {}) {
  const creds = getTelegramCredentials();
  if (!creds.botToken) {
    return {
      ok: false,
      status: 400,
      error: 'Telegram bot token is missing. Save bot_token in Settings > APIs > Telegram.',
    };
  }
  const chatId = safeText(options.chatId) || creds.chatId;
  if (!chatId) {
    return {
      ok: false,
      status: 400,
      error: 'Telegram chat_id is missing. Save chat_id in Settings > APIs > Telegram.',
    };
  }
  const messageText = safeText(text);
  if (!messageText) {
    return { ok: false, status: 400, error: 'Post text is required' };
  }
  if (messageText.length > 4096) {
    return { ok: false, status: 400, error: 'Telegram messages must be 4096 characters or fewer' };
  }

  const baseUrl = creds.baseUrl.replace(/\/+$/, '');
  const endpoint = `${baseUrl}/bot${encodeURIComponent(creds.botToken)}/sendMessage`;

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: messageText,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: `Telegram request failed: ${err.message || err}`,
      endpoint,
    };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.ok === false) {
    const detail = safeText(payload?.description) || safeText(response.statusText) || 'Unknown Telegram API error';
    return {
      ok: false,
      status: Number(payload?.error_code || response.status || 502) || 502,
      error: `Telegram API error: ${detail}`,
      data: payload,
      endpoint,
    };
  }

  return {
    ok: true,
    status: response.status,
    data: {
      endpoint,
      raw: payload,
      messageId: safeText(payload?.result?.message_id),
      chatId: safeText(payload?.result?.chat?.id || chatId),
      text: safeText(payload?.result?.text || messageText),
    },
  };
}

module.exports = {
  getTelegramCredentials,
  isConfigured,
  sendMessage,
};
