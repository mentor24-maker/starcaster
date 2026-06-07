'use strict';

const { listCampaigns, rowToCampaign } = require('./store');
const { getContact } = require('./ContactsStore');
const { listMessagingPosts, rowToPost } = require('./messagingPostsStore');

function safeText(value) {
  return String(value || '').trim();
}

function parseJsonObject(raw) {
  if (!raw) return {};
  if (raw && typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function contactField(contact, key) {
  if (!contact || typeof contact !== 'object') return '';
  return safeText(contact[key] ?? contact[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())]);
}

function contactDisplayName(contact) {
  const first = contactField(contact, 'first_name');
  const middle = contactField(contact, 'middle_name');
  const last = contactField(contact, 'last_name');
  const name = [first, middle, last].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (name) return name;
  return contactField(contact, 'email') || contactField(contact, 'company') || contactField(contact, 'id');
}

function normalizeFacebookHandle(value) {
  const raw = safeText(value);
  if (!raw) return '';
  let text = raw;
  try {
    if (/^https?:\/\//i.test(text)) {
      const parsed = new URL(text);
      text = safeText(parsed.pathname).replace(/^\/+|\/+$/g, '');
      if (text.startsWith('profile.php')) {
        return safeText(parsed.searchParams.get('id'));
      }
    }
  } catch {
    // Keep raw handle below.
  }
  text = text.replace(/^@+/, '');
  text = text.replace(/^facebook\.com\//i, '');
  text = text.replace(/^www\.facebook\.com\//i, '');
  text = text.split(/[/?#]/)[0] || '';
  return safeText(text);
}

function facebookProfileUrl(handle) {
  const normalized = normalizeFacebookHandle(handle);
  if (!normalized) return '';
  if (/^\d+$/.test(normalized)) {
    return `https://www.facebook.com/profile.php?id=${encodeURIComponent(normalized)}`;
  }
  return `https://www.facebook.com/${encodeURIComponent(normalized)}`;
}

async function taggedPersonFromContactId(contactId, scope) {
  const id = safeText(contactId);
  if (!id) return null;
  const res = await getContact(id, scope);
  if (!res.ok || !res.data) return null;
  const contact = res.data;
  const facebookHandle = normalizeFacebookHandle(contactField(contact, 'facebook'));
  return {
    contactId: id,
    displayName: contactDisplayName(contact),
    facebookHandle,
    facebookUrl: facebookProfileUrl(facebookHandle),
  };
}

async function taggedPeopleFromMessagingPostId(messagingPostId, scope) {
  const postId = Number(messagingPostId || 0) || 0;
  if (!postId) return [];
  const postsRes = await listMessagingPosts(5000, scope);
  if (!postsRes.ok) return [];
  const post = (Array.isArray(postsRes.data) ? postsRes.data : [])
    .map(rowToPost)
    .find((row) => Number(row?.id || 0) === postId);
  if (!post) return [];
  const tagged = await taggedPersonFromContactId(post.tagged_contact_id, scope);
  return tagged ? [tagged] : [];
}

async function resolveTaggedPeopleForCampaign(campaignIdInput, scope) {
  const campaignId = safeText(campaignIdInput);
  if (!campaignId) return [];
  const res = await listCampaigns(scope);
  if (!res.ok) return [];
  const campaigns = (Array.isArray(res.data) ? res.data : []).map(rowToCampaign);
  const campaign = campaigns.find((item) => safeText(item?.id) === campaignId);
  if (!campaign) return [];
  const content = parseJsonObject(campaign.content);
  return taggedPeopleFromMessagingPostId(content?.postId, scope);
}

module.exports = {
  contactDisplayName,
  normalizeFacebookHandle,
  facebookProfileUrl,
  taggedPersonFromContactId,
  taggedPeopleFromMessagingPostId,
  resolveTaggedPeopleForCampaign,
};
