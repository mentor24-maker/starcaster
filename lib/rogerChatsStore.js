'use strict';

const { sbQuery, tableConfig } = require('./supabase');

function table() {
  return tableConfig().agentMessages || 'agent_messages';
}

function sessionsTable() {
  return tableConfig().rogerSessions || 'dev_sessions';
}

function rowToChat(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    session_id: Number(row.session_id || 0) || 0,
    project_id: row.project_id || null,
    role: String(row.role || ''),
    content: String(row.content || ''),
    status: String(row.status || 'complete'),
    error_details: row.error_details ? String(row.error_details) : null,
    attachment_url: row.attachment_url ? String(row.attachment_url) : null,
    attachment_mime: row.attachment_mime ? String(row.attachment_mime) : null,
    attachment_name: row.attachment_name ? String(row.attachment_name) : null,
    parent_id: row.parent_id ? Number(row.parent_id) : null,
    created_at: String(row.created_at || ''),
  };
}

function rowToSession(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    project_id: row.project_id || null,
    name: String(row.name || ''),
    created_at: String(row.created_at || ''),
  };
}

async function listRogerSessions(projectId = null) {
  let query = `select=*&order=id.desc`;
  if (projectId) {
    query += `&project_id=eq.${encodeURIComponent(projectId)}`;
  } else {
    query += `&project_id=is.null`;
  }
  
  const res = await sbQuery({
    method: 'GET',
    table: sessionsTable(),
    query,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToSession) : [],
  };
}

async function createRogerSession(input) {
  const payload = {
    name: String(input?.name || 'New Discussion'),
  };
  if (input?.project_id) {
    payload.project_id = input.project_id;
  }

  const res = await sbQuery({
    method: 'POST',
    table: sessionsTable(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [payload],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToSession(created) };
}

async function listPendingCommands(projectId = null) {
  let query = `select=*&role=in.(roger,antigravity,angie)&order=id.desc&limit=50`;
  if (projectId) {
    query += `&project_id=eq.${encodeURIComponent(projectId)}`;
  }
  
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!res.ok) return res;
  
  const commands = [];
  const rows = Array.isArray(res.data) ? res.data : [];
  
  for (const row of rows) {
    try {
      const match = row.content ? row.content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i) : null;
      const potentialJson = match ? match[1] : (row.content ? row.content.trim() : '');
      const parsed = JSON.parse(potentialJson);
      
      let isPending = false;
      
      if (parsed && parsed.payload && parsed.payload.type === 'COMMAND' && parsed.state && parsed.state.target_agent) {
        const target = String(parsed.state.target_agent).toLowerCase();
        if (target.includes('@antigravity') || target.includes('@ag app') || target.includes('@archie')) {
          isPending = true;
        }
      } else if (parsed && parsed.payload && typeof parsed.payload.content === 'string') {
        const text = parsed.payload.content.toLowerCase();
        if (text.includes("awaiting archie") || text.includes("awaiting @archie") || text.includes("awaiting @antigravity") || text.includes("awaiting antigravity")) {
          isPending = true;
          // Coerce into a command format for the frontend
          parsed.payload.type = 'COMMAND';
          if (!parsed.state) parsed.state = {};
          parsed.state.target_agent = '@Archie';
        }
      }
      
      if (isPending) {
        commands.push({
           chat: rowToChat(row),
           parsed: parsed
        });
      }
    } catch(e) {}
  }
  
  return {
    ok: true,
    status: 200,
    data: commands,
  };
}

async function listRogerChats(sessionId, projectId = null, limit = 100) {
  let query = `select=*&session_id=eq.${Number(sessionId)}&order=id.desc&limit=${limit}`;
  if (projectId) {
    query += `&project_id=eq.${encodeURIComponent(projectId)}`;
  } else {
    query += `&project_id=is.null`;
  }
  
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!res.ok) return res;
  const data = Array.isArray(res.data) ? res.data.map(rowToChat) : [];
  data.reverse(); // Reverse back to chronological asc
  
  return {
    ok: true,
    status: 200,
    data,
  };
}

async function createRogerChat(input) {
  const payload = {
    session_id: Number(input?.session_id || 0),
    role: String(input?.role || 'user'),
    content: String(input?.content || '').trim(),
    status: String(input?.status || 'complete'),
  };
  if (input?.project_id) {
    payload.project_id = input.project_id;
  }
  if (input?.attachment_url) payload.attachment_url = String(input.attachment_url);
  if (input?.attachment_mime) payload.attachment_mime = String(input.attachment_mime);
  if (input?.attachment_name) payload.attachment_name = String(input.attachment_name);
  if (input?.parent_id !== undefined) payload.parent_id = Number(input.parent_id) || null;

  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [payload],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToChat(created) };
}

async function updateRogerSession(sessionId, input) {
  const payload = {};
  if (input?.name !== undefined) payload.name = String(input.name);
  if (Object.keys(payload).length === 0) return { ok: false, status: 400, error: 'No fields to update' };

  const res = await sbQuery({
    method: 'PATCH',
    table: sessionsTable(),
    query: `id=eq.${Number(sessionId)}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: payload,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 200, data: rowToSession(updated) };
}

async function updateRogerChat(chatId, input) {
  const payload = {};
  if (input?.content !== undefined) payload.content = String(input.content).trim();
  if (input?.status !== undefined) payload.status = String(input.status);
  if (input?.error_details !== undefined) payload.error_details = input.error_details ? String(input.error_details) : null;

  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: `id=eq.${chatId}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: payload,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  return {
    ok: true,
    status: 200,
    data: rowToChat(updated),
  };
}

async function evaluateAndUpdateTaskStatus(sessionId) {
  const tasksRes = await sbQuery({ method: 'GET', table: 'dev_tasks', query: `select=*&session_id=eq.${Number(sessionId)}` });
  if (!tasksRes.ok || !tasksRes.data || tasksRes.data.length === 0) return;

  const chatsRes = await listRogerChats(sessionId, null, 20);
  let newStatus = 'todo';
  let estimatedMinutes = null;

  if (chatsRes.ok && Array.isArray(chatsRes.data) && chatsRes.data.length > 0) {
    const validChats = chatsRes.data.filter(c => c.status === 'complete' && !c.content.includes('[SYSTEM::'));
    if (validChats.length > 0) {
      const lastMessage = validChats[validChats.length - 1];
      
      if (lastMessage.role === 'user') {
        newStatus = 'in_progress';
      } else {
        let payloadType = null;
        let isCompleted = false;
        
        try {
          const match = lastMessage.content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
          const potentialJson = match ? match[1] : lastMessage.content.trim();
          const parsed = JSON.parse(potentialJson);
          
          if (parsed && parsed.state) {
            if (parsed.state.task_status) {
              const explicitStatus = String(parsed.state.task_status).toLowerCase();
              if (['todo', 'in_progress', 'review', 'completed', 'backlog'].includes(explicitStatus)) {
                newStatus = explicitStatus;
                payloadType = 'EXPLICIT'; // Skip heuristic
              }
            }
            if (parsed.state.estimated_minutes !== undefined) {
              estimatedMinutes = Number(parsed.state.estimated_minutes);
              if (isNaN(estimatedMinutes) || estimatedMinutes <= 0) estimatedMinutes = null;
            }
          }

          if (payloadType !== 'EXPLICIT' && parsed && parsed.payload) {
            payloadType = parsed.payload.type;
            const textContent = String(parsed.payload.content || '').toLowerCase();
            if (textContent.includes('execution completed') || textContent.includes('objective met') || textContent.includes('execution finished') || textContent.includes('process complete')) {
               isCompleted = true;
            }
          }
        } catch(e) {}
        
        if (payloadType !== 'EXPLICIT') {
          if (payloadType === 'QUERY') {
            newStatus = 'review';
          } else if (payloadType === 'COMMAND') {
            newStatus = 'in_progress';
          } else if (payloadType === 'RESPONSE') {
            newStatus = isCompleted ? 'completed' : 'in_progress';
          } else {
            newStatus = 'in_progress';
          }
        }
      }
    }
  }

  for (const task of tasksRes.data) {
    const updates = {};
    if (task.status !== newStatus) {
      updates.status = newStatus;
    }
    
    if (estimatedMinutes !== null) {
      const futureDate = new Date(Date.now() + estimatedMinutes * 60000);
      updates.estimated_completion_time = futureDate.toISOString();
      updates.timer_active = true;
    } else if (newStatus === 'completed' || newStatus === 'review') {
      updates.timer_active = false;
    }

    if (Object.keys(updates).length > 0) {
      await sbQuery({
        method: 'PATCH',
        table: 'dev_tasks',
        query: `id=eq.${task.id}`,
        body: updates
      });
    }
  }
}

async function createMessageLink(sourceMessageId, targetType, targetId) {
  const payload = {
    source_message_id: Number(sourceMessageId),
    target_type: String(targetType),
    target_id: String(targetId)
  };

  const res = await sbQuery({
    method: 'POST',
    table: 'dev_message_links',
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [payload],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: created };
}

module.exports = {
  listRogerChats,
  createRogerChat,
  updateRogerChat,
  listRogerSessions,
  createRogerSession,
  updateRogerSession,
  evaluateAndUpdateTaskStatus,
  createMessageLink,
  listPendingCommands,
};
