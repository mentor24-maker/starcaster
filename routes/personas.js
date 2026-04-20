'use strict';

const { sendJson, sendErr, getUrlObj, parseJsonBody } = require('./http');
const { sbQuery, tableConfig } = require('../lib/supabase');

const HEADERS = {
  'Content-Profile': 'public',
};

const manifest = {
  id: 'influencerPersonas',
  label: 'Digital Clone Engine API',
  prefixes: ['/api/personas'],
};

async function handle(req, res, pathname, method) {
  if (!pathname.startsWith('/api/personas')) return false;
  
  if (req.authUser && req.authUser.id) {
     HEADERS['X-Supabase-Auth'] = `Bearer ${req.authUser.token}`;
  }

  const { influencerPersonas } = tableConfig();
  
  if (pathname === '/api/personas' && method === 'GET') {
     const result = await sbQuery({
       method: 'GET',
       table: influencerPersonas,
       query: 'order=created_at.desc',
       headers: HEADERS
     });
     if (!result.ok) return sendErr(res, result.status, result.error);
     return sendJson(res, 200, { ok: true, data: result.data || [] });
  }

  if (pathname === '/api/personas' && method === 'POST') {
     const body = await parseJsonBody(req);
     if (!body) return sendErr(res, 400, 'Missing payload');
     
     // Construct secure wrapper natively dropping owner context securely
     const payload = {
        base_name: body.baseName || 'Untitled Clone',
        clone_name: body.cloneName || null,
        clone_handle: body.cloneHandle || null,
        agent_email: body.agentEmail || null,
        primary_sources: Array.isArray(body.primarySources) ? body.primarySources : [],
        status: body.status || 'Provisioning'
     };
     
     if (req.authUser?.id) payload.owner_id = req.authUser.id;

     const result = await sbQuery({
        method: 'POST',
        table: influencerPersonas,
        headers: { ...HEADERS, 'Prefer': 'return=representation' },
        body: payload
     });
     if (!result.ok) return sendErr(res, result.status, result.error);
     return sendJson(res, 200, { ok: true, data: result.data?.[0] || null });
  }
  
  const matchUpdate = pathname.match(/^\/api\/personas\/(\d+)$/);
  if (matchUpdate && method === 'PATCH') {
     const id = matchUpdate[1];
     const body = await parseJsonBody(req);
     if (!body) return sendErr(res, 400, 'Missing payload');
     
     const result = await sbQuery({
        method: 'PATCH',
        table: influencerPersonas,
        query: `id=eq.${id}`,
        headers: { ...HEADERS, 'Prefer': 'return=representation' },
        body
     });
     if (!result.ok) return sendErr(res, result.status, result.error);
     return sendJson(res, 200, { ok: true, data: result.data?.[0] || null });
  }

  if (matchUpdate && method === 'DELETE') {
     const id = matchUpdate[1];
     const result = await sbQuery({
        method: 'DELETE',
        table: influencerPersonas,
        query: `id=eq.${id}`,
        headers: HEADERS
     });
     if (!result.ok) return sendErr(res, result.status, result.error);
     return sendJson(res, 200, { ok: true });
  }
  
  const matchProvision = pathname.match(/^\/api\/personas\/(\d+)\/provision$/);
  if (matchProvision && method === 'POST') {
     const id = matchProvision[1];
     
     // Stubs specific to Triggering the Headless Engine Proxy registration natively!
     console.log(`[Influencer Engine] Provision webhook invoked for persona node ID: ${id}`);
     
     const result = await sbQuery({
        method: 'PATCH',
        table: influencerPersonas,
        query: `id=eq.${id}`,
        headers: { ...HEADERS, 'Prefer': 'return=representation' },
        body: { status: 'Provisioning' }
     });
     
     // Bypass strict native Node caching forcing dynamic module mapping explicitly
     delete require.cache[require.resolve('../lib/xProvisionEngine')];
     const { provisionXAccount } = require('../lib/xProvisionEngine');
     if (result.data && result.data[0]) {
         provisionXAccount(result.data[0]).catch(err => {
             console.error('[Influencer Engine Proxy] Background orchestration fatally failed:', err);
         });
     }
     
     return sendJson(res, 200, { ok: true, data: result.data?.[0] || null, message: "Headless provision loop activated successfully in proxy!" });
  }

  return false;
}

module.exports = { handle, manifest };
