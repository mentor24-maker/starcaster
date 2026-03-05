'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { encryptSecret, decryptSecret } = require('./channelsCipher');

function t() { return tableConfig(); }

function rowToChannel(row) {
  if (!row) return null;
  const hasEncrypted =
    Boolean(row.password_enc) &&
    Boolean(row.password_iv) &&
    Boolean(row.password_tag);
  const hasPassword = hasEncrypted || Boolean(String(row.password || ''));
  return {
    id: Number(row.id || 0) || 0,
    channel: String(row.channel || ''),
    userName: String(row.user_name || ''),
    email: String(row.email || ''),
    passwordMasked: hasPassword ? '********' : '',
    hasPassword,
    createdAt: String(row.created_at || ''),
  };
}

async function listChannels() {
  return sbQuery({
    table: t().channels,
    query: 'select=id,channel,user_name,email,password,password_enc,password_iv,password_tag,key_version,created_at&order=channel.asc,user_name.asc&limit=5000',
  });
}

async function createChannel(input) {
  const enc = encryptSecret(input.password);
  if (!enc.ok) return { ok: false, status: 500, error: enc.error };

  const row = {
    channel: String(input.channel || '').trim(),
    user_name: String(input.userName || input.user_name || '').trim(),
    email: String(input.email || '').trim(),
    password: '',
    ...enc.data,
  };
  return sbQuery({
    method: 'POST',
    table: t().channels,
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
}

async function getChannelById(channelId) {
  const id = Number(channelId || 0) || 0;
  if (id <= 0) return { ok: false, status: 400, error: 'channel id is required' };
  const res = await sbQuery({
    table: t().channels,
    query: `select=id,channel,user_name,email,password,password_enc,password_iv,password_tag,key_version,created_at&id=eq.${id}&limit=1`,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : null;
  if (!row) return { ok: false, status: 404, error: 'Channel not found' };
  return { ok: true, status: 200, data: row };
}

async function updateChannel(channelId, patch) {
  const id = Number(channelId || 0) || 0;
  if (id <= 0) return { ok: false, status: 400, error: 'channel id is required' };

  const row = {};
  if (patch.channel != null) {
    row.channel = String(patch.channel || '').trim();
  }
  if (patch.userName != null || patch.user_name != null) {
    row.user_name = String(patch.userName || patch.user_name || '').trim();
  }
  if (patch.email != null) {
    row.email = String(patch.email || '').trim();
  }
  if (patch.password != null) {
    const enc = encryptSecret(patch.password);
    if (!enc.ok) return { ok: false, status: 500, error: enc.error };
    row.password = '';
    row.password_enc = enc.data.password_enc;
    row.password_iv = enc.data.password_iv;
    row.password_tag = enc.data.password_tag;
    row.key_version = enc.data.key_version;
  }

  if (!Object.keys(row).length) {
    return { ok: false, status: 400, error: 'No fields to update' };
  }

  return sbQuery({
    method: 'PATCH',
    table: t().channels,
    query: `id=eq.${id}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
}

async function deleteChannel(channelId) {
  const id = Number(channelId || 0) || 0;
  if (id <= 0) return { ok: false, status: 400, error: 'channel id is required' };

  return sbQuery({
    method: 'DELETE',
    table: t().channels,
    query: `id=eq.${id}&select=*`,
    headers: { Prefer: 'return=representation' },
  });
}

async function getChannelCredentialsById(channelId) {
  const rowRes = await getChannelById(channelId);
  if (!rowRes.ok) return rowRes;

  const dec = decryptSecret(rowRes.data);
  if (!dec.ok) return { ok: false, status: 500, error: dec.error };

  return {
    ok: true,
    status: 200,
    data: {
      id: Number(rowRes.data.id || 0) || 0,
      channel: String(rowRes.data.channel || ''),
      userName: String(rowRes.data.user_name || ''),
      email: String(rowRes.data.email || ''),
      password: dec.data.plaintext,
    },
  };
}

async function getChannelCredentialsByChannel(channelName) {
  const name = String(channelName || '').trim();
  if (!name) return { ok: false, status: 400, error: 'channel name is required' };

  const res = await sbQuery({
    table: t().channels,
    query:
      'select=id,channel,user_name,email,password,password_enc,password_iv,password_tag,key_version,created_at' +
      `&channel=eq.${encodeURIComponent(name)}&order=id.desc&limit=1`,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : null;
  if (!row) return { ok: false, status: 404, error: 'Channel not found' };

  const dec = decryptSecret(row);
  if (!dec.ok) return { ok: false, status: 500, error: dec.error };

  return {
    ok: true,
    status: 200,
    data: {
      id: Number(row.id || 0) || 0,
      channel: String(row.channel || ''),
      userName: String(row.user_name || ''),
      email: String(row.email || ''),
      password: dec.data.plaintext,
    },
  };
}

module.exports = {
  rowToChannel,
  listChannels,
  createChannel,
  getChannelById,
  updateChannel,
  deleteChannel,
  getChannelCredentialsById,
  getChannelCredentialsByChannel,
};
