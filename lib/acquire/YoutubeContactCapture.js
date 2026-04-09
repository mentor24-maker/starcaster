
'use strict';

const { listContacts, createContact, updateContact, rowToContact } = require('../ContactsStore');

function nextId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeUrl(value) {
  const text = normalizeText(value);
  if (!text) return '';
  return text.replace(/\/+$/, '').toLowerCase();
}

function classifySocial(url) {
  const v = String(url || '').toLowerCase();
  if (!v) return '';
  if (v.includes('youtube.com') || v.includes('youtu.be')) return 'youtube';
  if (v.includes('x.com') || v.includes('twitter.com')) return 'x';
  if (v.includes('instagram.com')) return 'instagram';
  if (v.includes('facebook.com')) return 'facebook';
  if (v.includes('bsky.app') || v.includes('bluesky')) return 'bluesky';
  if (v.includes('tiktok.com')) return 'tiktok';
  if (v.includes('patreon.com')) return 'patreon';
  if (v.includes('linkedin.com')) return 'linkedin';
  if (v.includes('substack.com')) return 'substack';
  if (v.includes('medium.com')) return 'medium';
  return '';
}

function firstUrlByType(urls, type) {
  return urls.find((u) => classifySocial(u) === type) || '';
}

function collectEmails(video, owner) {
  const all = [];
  const ownerEmail = normalizeText(owner?.email || '');
  if (ownerEmail.includes('@')) all.push(ownerEmail.toLowerCase());

  const videoEmailRaw = normalizeText(video?.email || '');
  if (videoEmailRaw) {
    videoEmailRaw
      .split('|')
      .map((v) => normalizeText(v).toLowerCase())
      .filter((v) => v.includes('@'))
      .forEach((v) => all.push(v));
  }

  return [...new Set(all)];
}

function buildCandidateFromYoutubeResult(result, fallbackVideoUrl = '') {
  const video = result?.video || {};
  const owner = result?.channel_owner || {};

  const profile = normalizeText(owner.profile_url || '');
  const socialProfiles = Array.isArray(owner.all_social_profiles)
    ? owner.all_social_profiles.map(normalizeText).filter(Boolean)
    : [];
  const allSocial = profile ? [profile, ...socialProfiles] : socialProfiles;
  const emails = collectEmails(video, owner);

  const youtube = profile || firstUrlByType(allSocial, 'youtube');
  const instagram = firstUrlByType(allSocial, 'instagram');
  const tiktok = firstUrlByType(allSocial, 'tiktok');
  const facebook = firstUrlByType(allSocial, 'facebook');
  const x = firstUrlByType(allSocial, 'x');
  const bluesky = firstUrlByType(allSocial, 'bluesky');
  const patreon = firstUrlByType(allSocial, 'patreon');
  const linkedin = firstUrlByType(allSocial, 'linkedin');
  const substack = firstUrlByType(allSocial, 'substack');
  const medium = firstUrlByType(allSocial, 'medium');

  const videoUrl = normalizeText(video.url || fallbackVideoUrl);
  const noteLines = [
    'Captured from YouTube harvest.',
    videoUrl ? `Video: ${videoUrl}` : '',
    normalizeText(video.title) ? `Title: ${normalizeText(video.title)}` : '',
  ].filter(Boolean);

  const customFields = {};
  if (substack) customFields.substack = substack;
  if (medium) customFields.medium = medium;
  if (normalizeText(owner.linktree)) customFields.linktree = normalizeText(owner.linktree);
  if (normalizeText(owner.channel_id)) customFields.youtube_channel_id = normalizeText(owner.channel_id);
  if (normalizeText(video.id)) customFields.youtube_video_id = normalizeText(video.id);

  return {
    contactType: 'lead',
    email: emails[0] || null,
    firstName: '',
    lastName: '',
    company: normalizeText(owner.name),
    website: normalizeText(owner.website),
    youtube,
    instagram,
    tiktok,
    facebook,
    x,
    bluesky,
    patreon,
    linkedin,
    source: 'youtube_harvest',
    status: 'new',
    notes: noteLines.join('\n'),
    tags: ['youtube', 'harvest'],
    customFields,
  };
}

function hasMinimumIdentity(candidate) {
  return Boolean(
    normalizeText(candidate.email) ||
    normalizeText(candidate.company) ||
    normalizeText(candidate.youtube) ||
    normalizeText(candidate.instagram) ||
    normalizeText(candidate.tiktok) ||
    normalizeText(candidate.facebook) ||
    normalizeText(candidate.x) ||
    normalizeText(candidate.bluesky) ||
    normalizeText(candidate.linkedin) ||
    normalizeText(candidate.patreon)
  );
}

function findExistingContact(rows, candidate) {
  const contacts = Array.isArray(rows) ? rows.map(rowToContact).filter(Boolean) : [];
  const candidateEmail = normalizeText(candidate.email).toLowerCase();
  const candidateYoutube = normalizeUrl(candidate.youtube);

  if (candidateEmail) {
    const hit = contacts.find((c) => normalizeText(c.email).toLowerCase() === candidateEmail);
    if (hit) return hit;
  }

  if (candidateYoutube) {
    const hit = contacts.find((c) => normalizeUrl(c.youtube) === candidateYoutube);
    if (hit) return hit;
  }

  return null;
}

function mergePatch(existing, candidate) {
  const patch = {};
  const assignIfEmpty = (field) => {
    const current = normalizeText(existing[field]);
    const next = normalizeText(candidate[field]);
    if (!current && next) patch[field] = next;
  };

  [
    'company', 'website', 'youtube', 'instagram', 'tiktok',
    'facebook', 'x', 'bluesky', 'patreon', 'linkedin', 'source', 'status',
  ].forEach(assignIfEmpty);

  if (!normalizeText(existing.email) && normalizeText(candidate.email)) {
    patch.email = normalizeText(candidate.email).toLowerCase();
  }

  const existingTags = Array.isArray(existing.tags) ? existing.tags.map((v) => String(v).trim()).filter(Boolean) : [];
  const candidateTags = Array.isArray(candidate.tags) ? candidate.tags.map((v) => String(v).trim()).filter(Boolean) : [];
  const mergedTags = [...new Set([...existingTags, ...candidateTags])];
  if (mergedTags.length !== existingTags.length) patch.tags = mergedTags;

  const existingCustom = existing.customFields && typeof existing.customFields === 'object' ? existing.customFields : {};
  const candidateCustom = candidate.customFields && typeof candidate.customFields === 'object' ? candidate.customFields : {};
  const mergedCustom = { ...existingCustom };
  let customChanged = false;
  Object.entries(candidateCustom).forEach(([k, v]) => {
    if (!normalizeText(mergedCustom[k]) && normalizeText(v)) {
      mergedCustom[k] = v;
      customChanged = true;
    }
  });
  if (customChanged) patch.customFields = mergedCustom;

  const existingNotes = normalizeText(existing.notes);
  const candidateNotes = normalizeText(candidate.notes);
  if (candidateNotes && !existingNotes.includes(candidateNotes)) {
    patch.notes = existingNotes ? `${existingNotes}\n\n${candidateNotes}` : candidateNotes;
  }

  return patch;
}

async function captureYoutubeContact(result, fallbackVideoUrl = '') {
  const candidate = buildCandidateFromYoutubeResult(result, fallbackVideoUrl);
  if (!hasMinimumIdentity(candidate)) {
    return {
      ok: false,
      status: 400,
      error: 'No usable channel-owner identity found in this harvest result',
    };
  }
  const listRes = await listContacts({ limit: 5000, orderBy: 'updated_at', orderDir: 'desc' });
  if (!listRes.ok) return listRes;

  const existing = findExistingContact(listRes.data, candidate);
  if (!existing) {
    const createRes = await createContact({
      id: nextId('contact'),
      ...candidate,
    });
    if (!createRes.ok) return createRes;
    const createdRow = Array.isArray(createRes.data) ? createRes.data[0] : createRes.data;
    return { ok: true, status: 201, data: { mode: 'created', contact: rowToContact(createdRow) } };
  }

  const patch = mergePatch(existing, candidate);
  if (!Object.keys(patch).length) {
    return { ok: true, status: 200, data: { mode: 'existing', contact: existing } };
  }

  const updateRes = await updateContact(existing.id, patch);
  if (!updateRes.ok) return updateRes;
  const updatedRow = Array.isArray(updateRes.data) ? updateRes.data[0] : updateRes.data;
  return { ok: true, status: 200, data: { mode: 'updated', contact: rowToContact(updatedRow) } };
}

module.exports = { captureYoutubeContact };
