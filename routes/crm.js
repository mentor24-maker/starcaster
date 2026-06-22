'use strict';

const { sendOk, sendErr, parseJsonBody, getUrlObj, nextId } = require('./http');
const { listConfigs, getConfig, createConfig, updateConfig, deleteConfig } = require('../lib/crmConfigStore');
const { listContacts, getContact, createContact, updateContact, deleteContact } = require('../lib/crmContactsStore');
const { listForms, getForm, createForm, updateForm, deleteForm } = require('../lib/crmFormsStore');
const { logActivity } = require('../lib/activityLog');

function requestScope(req) {
  return {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId: String(req?.authUser?.id || '').trim(),
  };
}

async function handle(req, res, pathname, method) {
  const urlObj = getUrlObj(req);

  // ── CRM Configs ────────────────────────────────────────────────────────────

  if (pathname === '/api/crm/configs' && method === 'GET') {
    const configs = await listConfigs(requestScope(req));
    return sendOk(res, 200, configs, { configs }, { total: configs.length }), true;
  }

  if (pathname === '/api/crm/configs' && method === 'POST') {
    const body = await parseJsonBody(req);
    const name = String(body.name || '').trim();
    if (!name) return sendErr(res, 400, 'name is required', { code: 'VALIDATION_ERROR' }), true;
    const created = await createConfig({
      name,
      status: String(body.status || 'active').trim(),
      standardFields: Array.isArray(body.standardFields) ? body.standardFields : ['email', 'first_name', 'last_name', 'phone'],
      customFields: Array.isArray(body.customFields) ? body.customFields : [],
    }, requestScope(req));
    if (!created) return sendErr(res, 500, 'Failed to create CRM config'), true;
    logActivity({ action: 'crm_config.created', entityType: 'crm_config', entityId: created.id, summary: `CRM created: "${name}"` });
    return sendOk(res, 201, created, { config: created }), true;
  }

  const configMatch = pathname.match(/^\/api\/crm\/configs\/([^/]+)$/);

  if (configMatch && method === 'GET') {
    const id = decodeURIComponent(configMatch[1]);
    const config = await getConfig(id, requestScope(req));
    if (!config) return sendErr(res, 404, 'CRM config not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, config, { config }), true;
  }

  if (configMatch && method === 'PUT') {
    const body = await parseJsonBody(req);
    const id = decodeURIComponent(configMatch[1]);
    const patch = {};
    if (body.name !== undefined) patch.name = String(body.name || '').trim();
    if (body.status !== undefined) patch.status = String(body.status || '').trim();
    if (body.standardFields !== undefined) patch.standardFields = Array.isArray(body.standardFields) ? body.standardFields : [];
    if (body.customFields !== undefined) patch.customFields = Array.isArray(body.customFields) ? body.customFields : [];
    const updated = await updateConfig(id, patch, requestScope(req));
    if (!updated) return sendErr(res, 404, 'CRM config not found', { code: 'NOT_FOUND' }), true;
    logActivity({ action: 'crm_config.updated', entityType: 'crm_config', entityId: id, summary: `CRM updated: "${updated.name}"` });
    return sendOk(res, 200, updated, { config: updated }), true;
  }

  if (configMatch && method === 'DELETE') {
    const id = decodeURIComponent(configMatch[1]);
    const deleted = await deleteConfig(id, requestScope(req));
    if (!deleted) return sendErr(res, 404, 'CRM config not found', { code: 'NOT_FOUND' }), true;
    logActivity({ action: 'crm_config.deleted', entityType: 'crm_config', entityId: id, summary: `CRM config deleted: ${id}` });
    return sendOk(res, 200, { deleted: true, id }, { deleted: true }), true;
  }

  // ── CRM Contacts ────────────────────────────────────────────────────────────

  // POST /api/crm/contact-submit — public form submission, no auth required
  if (pathname === '/api/crm/contact-submit' && method === 'POST') {
    const body = await parseJsonBody(req);
    const crmConfigId = String(body.crmConfigId || '').trim();
    if (!crmConfigId) return sendErr(res, 400, 'crmConfigId is required'), true;
    // Honeypot
    if (String(body._trap || '').trim()) {
      return sendOk(res, 200, {}, { message: 'Thank you!' }), true;
    }
    try {
      await createContact({
        crmConfigId,
        email: String(body.email || '').trim().toLowerCase() || null,
        data: (body.data && typeof body.data === 'object') ? body.data : {},
        source: String(body.source || 'form').trim(),
        tags: [],
      }, { projectId: String(body.projectId || '').trim(), userId: '' });
    } catch (err) {
      if (err.code !== 'DUPLICATE_EMAIL') throw err;
    }
    return sendOk(res, 200, {}, { message: 'Thank you! Your information has been saved.' }), true;
  }

  if (pathname === '/api/crm/contacts' && method === 'GET') {
    const crmConfigId = String(urlObj.searchParams.get('configId') || '').trim();
    if (!crmConfigId) return sendErr(res, 400, 'configId is required', { code: 'VALIDATION_ERROR' }), true;
    const contacts = await listContacts(crmConfigId, requestScope(req));
    return sendOk(res, 200, contacts, { contacts }, { total: contacts.length }), true;
  }

  if (pathname === '/api/crm/contacts' && method === 'POST') {
    const body = await parseJsonBody(req);
    const crmConfigId = String(body.crmConfigId || '').trim();
    if (!crmConfigId) return sendErr(res, 400, 'crmConfigId is required', { code: 'VALIDATION_ERROR' }), true;
    try {
      const created = await createContact({
        crmConfigId,
        email: String(body.email || '').trim().toLowerCase() || null,
        data: (body.data && typeof body.data === 'object') ? body.data : {},
        source: String(body.source || '').trim(),
        tags: Array.isArray(body.tags) ? body.tags : [],
      }, requestScope(req));
      if (!created) return sendErr(res, 500, 'Failed to create contact'), true;
      logActivity({ action: 'crm_contact.created', entityType: 'crm_contact', entityId: created.id, summary: `CRM contact added: ${created.email || created.id}` });
      return sendOk(res, 201, created, { contact: created }), true;
    } catch (err) {
      if (err.code === 'DUPLICATE_EMAIL') return sendErr(res, 409, err.message, { code: 'DUPLICATE_EMAIL' }), true;
      throw err;
    }
  }

  const contactMatch = pathname.match(/^\/api\/crm\/contacts\/([^/]+)$/);

  if (contactMatch && method === 'GET') {
    const id = decodeURIComponent(contactMatch[1]);
    const contact = await getContact(id, requestScope(req));
    if (!contact) return sendErr(res, 404, 'Contact not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, contact, { contact }), true;
  }

  if (contactMatch && method === 'PUT') {
    const body = await parseJsonBody(req);
    const id = decodeURIComponent(contactMatch[1]);
    const patch = {};
    if (body.email !== undefined) patch.email = String(body.email || '').trim().toLowerCase() || null;
    if (body.data !== undefined) patch.data = (body.data && typeof body.data === 'object') ? body.data : {};
    if (body.source !== undefined) patch.source = String(body.source || '').trim();
    if (body.tags !== undefined) patch.tags = Array.isArray(body.tags) ? body.tags : [];
    const updated = await updateContact(id, patch, requestScope(req));
    if (!updated) return sendErr(res, 404, 'Contact not found', { code: 'NOT_FOUND' }), true;
    logActivity({ action: 'crm_contact.updated', entityType: 'crm_contact', entityId: id, summary: `CRM contact updated: ${updated.email || id}` });
    return sendOk(res, 200, updated, { contact: updated }), true;
  }

  if (contactMatch && method === 'DELETE') {
    const id = decodeURIComponent(contactMatch[1]);
    const deleted = await deleteContact(id, requestScope(req));
    if (!deleted) return sendErr(res, 404, 'Contact not found', { code: 'NOT_FOUND' }), true;
    logActivity({ action: 'crm_contact.deleted', entityType: 'crm_contact', entityId: id, summary: `CRM contact deleted: ${id}` });
    return sendOk(res, 200, { deleted: true, id }, { deleted: true }), true;
  }

  // ── CRM Forms ────────────────────────────────────────────────────────────

  if (pathname === '/api/crm/forms' && method === 'GET') {
    const crmConfigId = String(urlObj.searchParams.get('configId') || '').trim();
    if (!crmConfigId) return sendErr(res, 400, 'configId is required', { code: 'VALIDATION_ERROR' }), true;
    const forms = await listForms(crmConfigId, requestScope(req));
    return sendOk(res, 200, forms, { forms }, { total: forms.length }), true;
  }

  if (pathname === '/api/crm/forms' && method === 'POST') {
    const body = await parseJsonBody(req);
    const crmConfigId = String(body.crmConfigId || '').trim();
    const name = String(body.name || '').trim();
    if (!crmConfigId || !name) {
      return sendErr(res, 400, 'crmConfigId and name are required', { code: 'VALIDATION_ERROR' }), true;
    }
    const created = await createForm({
      crmConfigId,
      name,
      heading: String(body.heading || '').trim(),
      submitLabel: String(body.submitLabel || 'Submit').trim(),
      successMessage: String(body.successMessage || 'Thank you! Your information has been saved.').trim(),
      errorMessage: String(body.errorMessage || 'Something went wrong. Please try again.').trim(),
      accentColor: String(body.accentColor || '').trim(),
      fields: Array.isArray(body.fields) ? body.fields : [],
    }, requestScope(req));
    if (!created) return sendErr(res, 500, 'Failed to create CRM form'), true;
    logActivity({ action: 'crm_form.created', entityType: 'crm_form', entityId: created.id, summary: `CRM form created: "${name}"` });
    return sendOk(res, 201, created, { form: created }), true;
  }

  const formMatch = pathname.match(/^\/api\/crm\/forms\/([^/]+)$/);

  if (formMatch && method === 'GET') {
    const id = decodeURIComponent(formMatch[1]);
    const form = await getForm(id, requestScope(req));
    if (!form) return sendErr(res, 404, 'CRM form not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, form, { form }), true;
  }

  if (formMatch && method === 'PUT') {
    const body = await parseJsonBody(req);
    const id = decodeURIComponent(formMatch[1]);
    const patch = {};
    if (body.name !== undefined) patch.name = String(body.name || '').trim();
    if (body.heading !== undefined) patch.heading = String(body.heading || '').trim();
    if (body.submitLabel !== undefined) patch.submitLabel = String(body.submitLabel || '').trim();
    if (body.successMessage !== undefined) patch.successMessage = String(body.successMessage || '').trim();
    if (body.errorMessage !== undefined) patch.errorMessage = String(body.errorMessage || '').trim();
    if (body.accentColor !== undefined) patch.accentColor = String(body.accentColor || '').trim();
    if (body.fields !== undefined) patch.fields = Array.isArray(body.fields) ? body.fields : [];
    const updated = await updateForm(id, patch, requestScope(req));
    if (!updated) return sendErr(res, 404, 'CRM form not found', { code: 'NOT_FOUND' }), true;
    logActivity({ action: 'crm_form.updated', entityType: 'crm_form', entityId: id, summary: `CRM form updated: "${updated.name}"` });
    return sendOk(res, 200, updated, { form: updated }), true;
  }

  if (formMatch && method === 'DELETE') {
    const id = decodeURIComponent(formMatch[1]);
    const deleted = await deleteForm(id, requestScope(req));
    if (!deleted) return sendErr(res, 404, 'CRM form not found', { code: 'NOT_FOUND' }), true;
    logActivity({ action: 'crm_form.deleted', entityType: 'crm_form', entityId: id, summary: `CRM form deleted: ${id}` });
    return sendOk(res, 200, { deleted: true, id }, { deleted: true }), true;
  }

  return false;
}

const manifest = {
  id: 'crm',
  label: 'CRM',
  prefixes: ['/api/crm'],
};

module.exports = { handle, manifest };
