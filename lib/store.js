'use strict';

/**
 * lib/store.js
 * Supabase-backed persistence for contacts, segments, campaigns, and events.
 * Replaces the old store.json read/write pattern in routes/contacts.js.
 *
 * All functions return { ok, status, data, error } — same envelope used
 * throughout the lib/ layer so callers handle errors consistently.
 */

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');

// Convenience alias — store.js uses fixed table names from tableConfig()
function t() { return tableConfig(); }

// Internal wrapper keeps call sites in this file concise
function sbRequest({ method = 'GET', table, query = '', body, extraHeaders = {} }) {
  return sbQuery({ method, table, query, body, headers: extraHeaders });
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

async function listContacts() {
  return sbRequest({
    table: t().contacts,
    query: 'select=*&order=created_at.desc&limit=5000'
  });
}

async function getContact(id) {
  const result = await sbRequest({
    table: t().contacts,
    query: `select=*&id=eq.${encodeURIComponent(id)}&limit=1`
  });
  if (!result.ok) return result;
  const row = Array.isArray(result.data) ? result.data[0] : null;
  if (!row) return { ok: false, status: 404, error: 'Contact not found' };
  return { ok: true, status: 200, data: row };
}

async function createContact(contact) {
  // Normalise camelCase -> snake_case for DB
  const row = {
    id:         contact.id,
    email:      String(contact.email || '').trim().toLowerCase(),
    first_name: String(contact.firstName || contact.first_name || '').trim(),
    last_name:  String(contact.lastName  || contact.last_name  || '').trim(),
    city:       String(contact.city      || '').trim(),
    tags:       Array.isArray(contact.tags) ? contact.tags.map(t => String(t).trim()).filter(Boolean) : []
  };
  return sbRequest({
    method: 'POST',
    table: t().contacts,
    query: 'select=*',
    extraHeaders: { Prefer: 'return=representation' },
    body: [row]
  });
}

async function importContacts(rows) {
  const prepared = rows
    .map(row => ({
      id:         row.id,
      email:      String(row.email || '').trim().toLowerCase(),
      first_name: String(row.firstName || row.first_name || '').trim(),
      last_name:  String(row.lastName  || row.last_name  || '').trim(),
      city:       String(row.city || '').trim(),
      tags:       Array.isArray(row.tags) ? row.tags.map(t => String(t).trim()).filter(Boolean) : []
    }))
    .filter(r => r.email && r.email.includes('@'));

  if (prepared.length === 0) {
    return { ok: false, status: 400, error: 'No valid contacts to import (email required)' };
  }

  return sbRequest({
    method: 'POST',
    table: t().contacts,
    query: 'on_conflict=email',
    extraHeaders: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: prepared
  });
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

async function listSegments(scope = null) {
  const query = await scopedListQuery(t().segments, 'select=*&order=updated_at.desc&limit=1000', scope);
  return sbRequest({
    table: t().segments,
    query
  });
}

async function createSegment(segment, scope = null) {
  const row = await scopedInsertRow(t().segments, {
    id: segment.id,
    name: segment.name,
    rules: segment.rules || [],
    definition: segment.definition || null
  }, scope);
  return sbRequest({
    method: 'POST',
    table: t().segments,
    query: 'select=*',
    extraHeaders: { Prefer: 'return=representation' },
    body: [row]
  });
}

async function updateSegment(id, patch, scope = null) {
  const scopedPatch = await scopedPatchRow(t().segments, {
    ...(patch.name       !== undefined && { name: patch.name }),
    ...(patch.rules      !== undefined && { rules: patch.rules }),
    ...(patch.definition !== undefined && { definition: patch.definition }),
    updated_at: new Date().toISOString()
  }, scope);
  const query = await scopedIdQuery(t().segments, `id=eq.${encodeURIComponent(id)}&select=*`, scope);
  return sbRequest({
    method: 'PATCH',
    table: t().segments,
    query,
    extraHeaders: { Prefer: 'return=representation' },
    body: scopedPatch
  });
}

async function deleteSegment(id, scope = null) {
  const query = await scopedIdQuery(t().segments, `id=eq.${encodeURIComponent(id)}`, scope);
  return sbRequest({
    method: 'DELETE',
    table: t().segments,
    query,
    extraHeaders: { Prefer: 'return=representation' }
  });
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

async function listCampaigns(scope = null) {
  const query = await scopedListQuery(t().campaigns, 'select=*&order=created_at.desc&limit=1000', scope);
  return sbRequest({
    table: t().campaigns,
    query
  });
}

async function createCampaign(campaign, scope = null) {
  const row = await scopedInsertRow(t().campaigns, {
    id: campaign.id,
    name: campaign.name,
    subject: campaign.subject,
    content: campaign.content,
    segment_id: campaign.segmentId || null,
    status: 'draft',
    sent_count: 0
  }, scope);
  return sbRequest({
    method: 'POST',
    table: t().campaigns,
    query: 'select=*',
    extraHeaders: { Prefer: 'return=representation' },
    body: [row]
  });
}

async function updateCampaign(id, patch, scope = null) {
  const query = await scopedIdQuery(t().campaigns, `id=eq.${encodeURIComponent(id)}&select=*`, scope);
  const scopedPatch = await scopedPatchRow(t().campaigns, patch, scope);
  return sbRequest({
    method: 'PATCH',
    table: t().campaigns,
    query,
    extraHeaders: { Prefer: 'return=representation' },
    body: scopedPatch
  });
}

// ---------------------------------------------------------------------------
// Campaign events
// ---------------------------------------------------------------------------

async function listCampaignEvents(campaignId) {
  return sbRequest({
    table: t().campaignEvents,
    query: `campaign_id=eq.${encodeURIComponent(campaignId)}&select=*`
  });
}

async function insertCampaignEvents(events) {
  if (!events.length) return { ok: true, status: 200, data: [] };
  return sbRequest({
    method: 'POST',
    table: t().campaignEvents,
    extraHeaders: { Prefer: 'return=representation' },
    body: events.map(e => ({
      id:          e.id,
      campaign_id: e.campaignId,
      contact_id:  e.contactId,
      type:        e.type
    }))
  });
}

// ---------------------------------------------------------------------------
// Helper: normalise a DB row back to the camelCase shape the frontend expects
// ---------------------------------------------------------------------------

function rowToContact(row) {
  return {
    id:        row.id,
    email:     row.email,
    firstName: row.first_name || '',
    lastName:  row.last_name  || '',
    city:      row.city       || '',
    tags:      Array.isArray(row.tags) ? row.tags : [],
    createdAt: row.created_at
  };
}

function rowToCampaign(row) {
  return {
    id:         row.id,
    name:       row.name,
    subject:    row.subject,
    content:    row.content,
    segmentId:  row.segment_id || null,
    status:     row.status,
    sentCount:  row.sent_count || 0,
    createdAt:  row.created_at,
    lastSentAt: row.last_sent_at || null
  };
}

module.exports = {
  // contacts
  listContacts,
  getContact,
  createContact,
  importContacts,
  // segments
  listSegments,
  createSegment,
  updateSegment,
  deleteSegment,
  // campaigns
  listCampaigns,
  createCampaign,
  updateCampaign,
  // events
  listCampaignEvents,
  insertCampaignEvents,
  // normalisers
  rowToContact,
  rowToCampaign
};
