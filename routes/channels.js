'use strict';

const { sendOk, sendErr, parseJsonBody } = require('./http');
const {
  rowToChannel,
  listChannels,
  createChannel,
  getChannelById,
  updateChannel,
  deleteChannel,
} = require('../lib/channelsStore');

async function handle(req, res, pathname, method) {
  const requestMethod = String(method || '').toUpperCase();

  if (pathname === '/api/channels' && requestMethod === 'GET') {
    const result = await listChannels();
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const channels = (Array.isArray(result.data) ? result.data : []).map(rowToChannel);
    return sendOk(res, 200, channels, { channels }, { total: channels.length }), true;
  }

  if (pathname === '/api/channels' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const channel = String(body.channel || '').trim();
    const userName = String(body.userName || body.user_name || '').trim();
    const email = String(body.email || '').trim();
    const password = String(body.password || '').trim();

    if (!channel) return sendErr(res, 400, 'channel is required', { code: 'VALIDATION_ERROR' }), true;
    if (!userName) return sendErr(res, 400, 'userName is required', { code: 'VALIDATION_ERROR' }), true;
    if (!email) return sendErr(res, 400, 'email is required', { code: 'VALIDATION_ERROR' }), true;
    if (!password) return sendErr(res, 400, 'password is required', { code: 'VALIDATION_ERROR' }), true;

    const result = await createChannel({ channel, userName, email, password });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const created = Array.isArray(result.data) ? result.data[0] : result.data;
    return sendOk(res, 201, rowToChannel(created), { channel: rowToChannel(created) }), true;
  }

  const channelIdMatch = String(pathname || '').match(/^\/api\/channels\/(\d+)\/?$/);
  if (channelIdMatch && requestMethod === 'GET') {
    const channelId = Number(channelIdMatch[1]);
    const result = await getChannelById(channelId);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, rowToChannel(result.data), { channel: rowToChannel(result.data) }), true;
  }

  if (channelIdMatch && requestMethod === 'PATCH') {
    const channelId = Number(channelIdMatch[1]);
    const body = await parseJsonBody(req);
    const patch = {};

    if ('channel' in body) {
      patch.channel = String(body.channel || '').trim();
      if (!patch.channel) return sendErr(res, 400, 'channel is required', { code: 'VALIDATION_ERROR' }), true;
    }
    if ('userName' in body || 'user_name' in body) {
      patch.userName = String(body.userName || body.user_name || '').trim();
      if (!patch.userName) return sendErr(res, 400, 'userName is required', { code: 'VALIDATION_ERROR' }), true;
    }
    if ('email' in body) {
      patch.email = String(body.email || '').trim();
      if (!patch.email) return sendErr(res, 400, 'email is required', { code: 'VALIDATION_ERROR' }), true;
    }
    if ('password' in body) {
      patch.password = String(body.password || '').trim();
      if (!patch.password) return sendErr(res, 400, 'password is required', { code: 'VALIDATION_ERROR' }), true;
    }

    const result = await updateChannel(channelId, patch);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const updated = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!updated) return sendErr(res, 404, 'Channel not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, rowToChannel(updated), { channel: rowToChannel(updated) }), true;
  }

  if (channelIdMatch && requestMethod === 'DELETE') {
    const channelId = Number(channelIdMatch[1]);
    const result = await deleteChannel(channelId);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const deleted = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!deleted) return sendErr(res, 404, 'Channel not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, rowToChannel(deleted), { channel: rowToChannel(deleted) }), true;
  }

  return false;
}

const manifest = {
  id: 'channels',
  label: 'Channels',
  prefixes: ['/api/channels'],
};

module.exports = { handle, manifest };
