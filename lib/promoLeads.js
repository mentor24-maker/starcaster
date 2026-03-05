const STANDARD_COLUMNS = new Set([
  'id',
  'email',
  'first_name',
  'last_name',
  'phone',
  'company',
  'source',
  'status',
  'notes',
  'tags',
  'custom_fields',
  'created_at',
  'updated_at'
]);

const FIELD_TYPES = new Set(['text', 'number', 'boolean', 'date', 'select', 'multi_select']);
const { sbQuery, tableConfig, isConfigured } = require('./supabase');

function hasSupabaseConfig() { return isConfigured(); }

function configuredTables() {
  const t = tableConfig();
  return { promoLeads: t.promoLeads, fieldConfigs: t.promoLeadFields };
}

// Thin alias so existing call sites (supabaseConfig().fieldsTable etc.) work unchanged
function supabaseConfig() {
  const t = tableConfig();
  return { leadsTable: t.promoLeads, fieldsTable: t.promoLeadFields };
}

// Thin alias so existing supabaseRequest({...}) call sites work unchanged
function supabaseRequest(opts) {
  return sbQuery({ ...opts, headers: opts.headers || {} });
}

// ---------------------------------------------------------------------------
// Field helpers (were in the old client block, still needed here)
// ---------------------------------------------------------------------------

function normalizeFieldKey(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  return fallback;
}

function normalizeFieldType(value) {
  const type = String(value || 'text').trim().toLowerCase();
  return FIELD_TYPES.has(type) ? type : 'text';
}

function parseOptions(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter(Boolean);
}
async function listFieldConfigs() {
  const table = supabaseConfig().fieldsTable;
  return supabaseRequest({
    method: 'GET',
    table,
    query: 'select=*&order=position.asc,key.asc'
  });
}

async function createFieldConfig(input) {
  const table = supabaseConfig().fieldsTable;
  const key = normalizeFieldKey(input.key || input.label);
  const label = String(input.label || input.key || '').trim();
  const type = normalizeFieldType(input.type);
  const required = parseBoolean(input.required, false);
  const active = parseBoolean(input.is_active, true);
  const position = Number.isFinite(Number(input.position)) ? Number(input.position) : 0;
  const options = parseOptions(input.options);

  if (!key) return { ok: false, status: 400, error: 'Field key is required' };
  if (!label) return { ok: false, status: 400, error: 'Field label is required' };
  if (STANDARD_COLUMNS.has(key)) {
    return { ok: false, status: 400, error: `Key "${key}" conflicts with a standard lead column` };
  }

  return supabaseRequest({
    method: 'POST',
    table,
    headers: { Prefer: 'return=representation' },
    body: [
      {
        key,
        label,
        type,
        required,
        is_active: active,
        position,
        options
      }
    ]
  });
}

async function updateFieldConfig(fieldId, input) {
  const table = supabaseConfig().fieldsTable;
  const patch = {};

  if (input.label !== undefined) patch.label = String(input.label || '').trim();
  if (input.type !== undefined) patch.type = normalizeFieldType(input.type);
  if (input.required !== undefined) patch.required = parseBoolean(input.required, false);
  if (input.is_active !== undefined) patch.is_active = parseBoolean(input.is_active, true);
  if (input.position !== undefined) patch.position = Number.isFinite(Number(input.position)) ? Number(input.position) : 0;
  if (input.options !== undefined) patch.options = parseOptions(input.options);
  if (input.key !== undefined) {
    const normalized = normalizeFieldKey(input.key);
    if (!normalized) return { ok: false, status: 400, error: 'Field key cannot be empty' };
    if (STANDARD_COLUMNS.has(normalized)) {
      return { ok: false, status: 400, error: `Key "${normalized}" conflicts with a standard lead column` };
    }
    patch.key = normalized;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, status: 400, error: 'No field updates provided' };
  }

  const encodedId = encodeURIComponent(String(fieldId));
  return supabaseRequest({
    method: 'PATCH',
    table,
    query: `id=eq.${encodedId}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: patch
  });
}

async function deleteFieldConfig(fieldId) {
  const table = supabaseConfig().fieldsTable;
  const encodedId = encodeURIComponent(String(fieldId));
  return supabaseRequest({
    method: 'DELETE',
    table,
    query: `id=eq.${encodedId}`,
    headers: { Prefer: 'return=representation' }
  });
}

async function listPromoLeads(limit = 500) {
  const table = supabaseConfig().leadsTable;
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 5000));
  return supabaseRequest({
    method: 'GET',
    table,
    query: `select=*&order=id.desc&limit=${safeLimit}`
  });
}

function splitLeadColumns(input) {
  const source = input && typeof input === 'object' ? input : {};
  const row = {};
  const custom = source.custom_fields && typeof source.custom_fields === 'object'
    ? { ...source.custom_fields }
    : {};

  Object.entries(source).forEach(([key, value]) => {
    const normalized = normalizeFieldKey(key);
    if (!normalized) return;
    if (normalized === 'custom_fields') return;
    if (STANDARD_COLUMNS.has(normalized)) {
      row[normalized] = value;
      return;
    }
    custom[normalized] = value;
  });

  if (Object.keys(custom).length > 0) {
    row.custom_fields = custom;
  } else if (source.custom_fields !== undefined) {
    row.custom_fields = {};
  }

  return row;
}

function normalizeLeadPayload(rawPayload, fieldConfigs = []) {
  const source = splitLeadColumns(rawPayload);
  const out = {};

  if (source.email !== undefined) out.email = String(source.email || '').trim().toLowerCase();
  if (source.first_name !== undefined || source.firstName !== undefined) {
    out.first_name = String(source.first_name ?? source.firstName ?? '').trim();
  }
  if (source.last_name !== undefined || source.lastName !== undefined) {
    out.last_name = String(source.last_name ?? source.lastName ?? '').trim();
  }
  if (source.phone !== undefined) out.phone = String(source.phone || '').trim();
  if (source.company !== undefined) out.company = String(source.company || '').trim();
  if (source.source !== undefined) out.source = String(source.source || '').trim();
  if (source.status !== undefined) out.status = String(source.status || '').trim() || 'new';
  if (source.notes !== undefined) out.notes = String(source.notes || '').trim();

  if (source.tags !== undefined) {
    if (Array.isArray(source.tags)) {
      out.tags = source.tags.map((t) => String(t).trim()).filter(Boolean);
    } else if (typeof source.tags === 'string' && source.tags.trim()) {
      out.tags = source.tags.split(',').map((t) => t.trim()).filter(Boolean);
    } else {
      out.tags = [];
    }
  }

  const custom = {};
  const keySet = new Set(fieldConfigs.map((f) => String(f.key || '')));
  if (source.custom_fields && typeof source.custom_fields === 'object') {
    Object.entries(source.custom_fields).forEach(([key, value]) => {
      const normalizedKey = normalizeFieldKey(key);
      if (!normalizedKey || STANDARD_COLUMNS.has(normalizedKey)) return;
      if (keySet.size > 0 && !keySet.has(normalizedKey)) return;
      custom[normalizedKey] = value;
    });
  }

  if (Object.keys(custom).length > 0) {
    out.custom_fields = custom;
  }

  return out;
}

async function createPromoLead(payload) {
  const fieldsRes = await listFieldConfigs();
  if (!fieldsRes.ok) return fieldsRes;
  const fields = Array.isArray(fieldsRes.data) ? fieldsRes.data : [];
  const normalized = normalizeLeadPayload(payload, fields);

  if (!normalized.email || !normalized.email.includes('@')) {
    return { ok: false, status: 400, error: 'Valid email is required' };
  }

  const table = supabaseConfig().leadsTable;
  return supabaseRequest({
    method: 'POST',
    table,
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [normalized]
  });
}

async function updatePromoLead(id, payload) {
  const fieldsRes = await listFieldConfigs();
  if (!fieldsRes.ok) return fieldsRes;
  const fields = Array.isArray(fieldsRes.data) ? fieldsRes.data : [];
  const normalized = normalizeLeadPayload(payload, fields);

  if (Object.keys(normalized).length === 0) {
    return { ok: false, status: 400, error: 'No lead updates provided' };
  }

  const table = supabaseConfig().leadsTable;
  const encodedId = encodeURIComponent(String(id));
  return supabaseRequest({
    method: 'PATCH',
    table,
    query: `id=eq.${encodedId}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: normalized
  });
}

async function deletePromoLead(id) {
  const table = supabaseConfig().leadsTable;
  const encodedId = encodeURIComponent(String(id));
  return supabaseRequest({
    method: 'DELETE',
    table,
    query: `id=eq.${encodedId}`,
    headers: { Prefer: 'return=representation' }
  });
}

async function detectPromoLeadColumns(columns) {
  const unique = Array.from(
    new Set(
      (Array.isArray(columns) ? columns : [])
        .map((c) => normalizeFieldKey(c))
        .filter(Boolean)
    )
  );
  const table = supabaseConfig().leadsTable;
  const results = [];

  for (const col of unique) {
    const query = `select=${encodeURIComponent(col)}&limit=1`;
    const probe = await supabaseRequest({
      method: 'GET',
      table,
      query
    });

    if (probe.ok) {
      results.push({ column: col, exists: true, error: null });
      continue;
    }

    const msg = String(probe.error || '');
    const missing = /could not find .* column/i.test(msg) || /schema cache/i.test(msg);
    results.push({
      column: col,
      exists: !missing,
      error: missing ? null : msg || 'Unknown error while checking column'
    });
  }

  return {
    ok: true,
    status: 200,
    data: results
  };
}

async function importPromoLeads(rows) {
  if (!Array.isArray(rows)) {
    return { ok: false, status: 400, error: 'contacts must be an array' };
  }

  const fieldsRes = await listFieldConfigs();
  if (!fieldsRes.ok) return fieldsRes;
  const fields = Array.isArray(fieldsRes.data) ? fieldsRes.data : [];

  const prepared = rows
    .map((row) => normalizeLeadPayload(row, fields))
    .filter((lead) => lead.email && lead.email.includes('@'));

  if (prepared.length === 0) {
    return { ok: false, status: 400, error: 'No valid contacts found (email required)' };
  }

  const table = supabaseConfig().leadsTable;
  const result = await supabaseRequest({
    method: 'POST',
    table,
    query: 'on_conflict=email&select=id,email',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: prepared
  });

  if (!result.ok) return result;

  return {
    ok: true,
    status: 200,
    data: {
      upserted: Array.isArray(result.data) ? result.data.length : prepared.length,
      rows: result.data || []
    }
  };
}

function listDatabaseTables() {
  const tables = configuredTables();
  return supabaseRequest({
    method: 'GET',
    table: '',
    headers: { Accept: 'application/openapi+json' }
  }).then((openApiRes) => {
    const discovered = [];
    if (openApiRes.ok && openApiRes.data && typeof openApiRes.data === 'object') {
      const paths = openApiRes.data.paths && typeof openApiRes.data.paths === 'object'
        ? openApiRes.data.paths
        : {};
      Object.keys(paths).forEach((pathKey) => {
        if (!pathKey.startsWith('/')) return;
        if (pathKey.startsWith('/rpc/')) return;
        if (pathKey.includes('{')) return;
        const tableName = normalizeFieldKey(pathKey.slice(1));
        if (!tableName) return;
        discovered.push(tableName);
      });
    }

    const unique = Array.from(new Set([tables.promoLeads, tables.fieldConfigs, ...discovered]))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    return {
      ok: true,
      status: 200,
      data: unique.map((name) => ({
        key: name,
        label: name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        supportsFieldCreation:
          normalizeFieldKey(name) === normalizeFieldKey(tables.promoLeads) ||
          normalizeFieldKey(name) === normalizeFieldKey(tables.fieldConfigs),
        notes:
          normalizeFieldKey(name) === normalizeFieldKey(tables.promoLeads)
            ? 'Field creation is applied as custom field metadata for promo leads.'
            : normalizeFieldKey(name) === normalizeFieldKey(tables.fieldConfigs)
              ? 'Stores custom field metadata used by this app.'
              : 'Detected table. Creation from this UI is not enabled yet.'
      }))
    };
  });
}

async function createDatabaseField(input) {
  const tables = configuredTables();
  const requestedTable = normalizeFieldKey(input.table);
  const leadsTable = normalizeFieldKey(tables.promoLeads);
  const fieldsTable = normalizeFieldKey(tables.fieldConfigs);

  if (!requestedTable) {
    return { ok: false, status: 400, error: 'Table is required' };
  }

  if (requestedTable !== leadsTable && requestedTable !== fieldsTable) {
    return {
      ok: false,
      status: 400,
      error: `Unsupported table "${input.table}". Supported: ${tables.promoLeads}, ${tables.fieldConfigs}`
    };
  }

  const payload = {
    key: input.key,
    label: input.label,
    type: input.type,
    required: input.required,
    is_active: input.is_active,
    position: input.position,
    options: input.options
  };

  const result = await createFieldConfig(payload);
  if (!result.ok) return result;

  const field = Array.isArray(result.data) ? result.data[0] : result.data;
  return {
    ok: true,
    status: 201,
    data: {
      field,
      table: tables.promoLeads,
      storageTable: tables.fieldConfigs,
      appliedTo: `${tables.promoLeads}.custom_fields`,
      message: 'Field created and available to import/editor field lists.'
    }
  };
}

module.exports = {
  hasSupabaseConfig,
  configuredTables,
  listDatabaseTables,
  createDatabaseField,
  listFieldConfigs,
  createFieldConfig,
  updateFieldConfig,
  deleteFieldConfig,
  listPromoLeads,
  createPromoLead,
  updatePromoLead,
  deletePromoLead,
  detectPromoLeadColumns,
  importPromoLeads
};
