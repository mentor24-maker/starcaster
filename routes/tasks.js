'use strict';

const { sendOk, sendErr, parseJsonBody, getUrlObj } = require('./http');
const { sbQuery } = require('../lib/supabase');

const manifest = {
  id: 'tasks',
  label: 'Task Management API',
  prefixes: ['/api/tasks']
};

/**
 * API handler for creating new tasks.
 */
async function handle(req, res, pathname, requestMethod) {
  // Handle POST /api/tasks (Create Task)
  if (pathname === '/api/tasks' && requestMethod === 'POST') {
    try {
      const body = await parseJsonBody(req);
      if (!body) return sendErr(res, 400, 'Invalid JSON body');

      const { title, session_id, status = 'todo', priority = 'medium', assignee, description, project_id, estimated_completion_time } = body;

      if (!title) {
        return sendErr(res, 400, '`title` is a required field.');
      }

      const newTask = {
        title,
        status,
        priority,
        timer_active: false
      };
      
      if (session_id !== undefined) newTask.session_id = session_id;
      if (assignee !== undefined) newTask.assignee = assignee;
      if (description !== undefined) newTask.description = description;
      if (project_id !== undefined) newTask.project_id = project_id;
      if (estimated_completion_time !== undefined) newTask.estimated_completion_time = estimated_completion_time;

      const result = await sbQuery({
        method: 'POST',
        table: 'dev_tasks',
        query: 'select=*',
        headers: { Prefer: 'return=representation' },
        body: [newTask]
      });

      if (!result.ok) {
        console.error('Supabase insertion error:', result.error);
        return sendErr(res, 500, 'Internal Server Error', { details: result.error });
      }

      const data = Array.isArray(result.data) ? result.data[0] : result.data;
      
      // Notify assignee if applicable
      if (data.assignee) {
        await notifyAssignee(data, 'assigned');
      }

      return sendOk(res, 201, data);

    } catch (err) {
      console.error('API route handler unexpected error:', err);
      return sendErr(res, 500, 'An unexpected error occurred.', { details: err.message });
    }
  }

  // Handle PATCH /api/tasks/:id (Update Task)
  if (pathname.startsWith('/api/tasks/') && requestMethod === 'PATCH') {
    try {
      const taskId = pathname.split('/').pop();
      if (!taskId) return sendErr(res, 400, 'Task ID required');

      const body = await parseJsonBody(req);
      if (!body) return sendErr(res, 400, 'Invalid JSON body');

      // Check current assignee to see if it changed
      const getRes = await sbQuery({
        method: 'GET',
        table: 'dev_tasks',
        query: `id=eq.${taskId}&select=assignee`,
      });
      const oldAssignee = getRes.ok && Array.isArray(getRes.data) && getRes.data.length > 0 ? getRes.data[0].assignee : null;

      const result = await sbQuery({
        method: 'PATCH',
        table: 'dev_tasks',
        query: `id=eq.${taskId}&select=*`,
        headers: { Prefer: 'return=representation' },
        body: body
      });

      if (!result.ok) {
        console.error('Supabase update error:', result.error);
        return sendErr(res, 500, 'Internal Server Error', { details: result.error });
      }

      const data = Array.isArray(result.data) ? result.data[0] : result.data;

      // Notify if newly assigned or assignee changed
      if (data.assignee && data.assignee !== oldAssignee) {
        await notifyAssignee(data, 'assigned');
      }

      return sendOk(res, 200, data);

    } catch (err) {
      console.error('API route handler unexpected error:', err);
      return sendErr(res, 500, 'An unexpected error occurred.', { details: err.message });
    }
  }

  // Handle POST /api/tasks/:id/thread (Create New Thread for Task)
  if (pathname.match(/^\/api\/tasks\/[^/]+\/thread$/) && requestMethod === 'POST') {
    try {
      const taskId = pathname.split('/')[3];
      if (!taskId) return sendErr(res, 400, 'Task ID required');

      // Fetch task details
      const getRes = await sbQuery({
        method: 'GET',
        table: 'dev_tasks',
        query: `id=eq.${taskId}&select=*`,
      });

      if (!getRes.ok || !Array.isArray(getRes.data) || getRes.data.length === 0) {
        return sendErr(res, 404, 'Task not found');
      }

      const task = getRes.data[0];

      // Create new session
      const sessionRes = await createRogerSession({ name: `Task: ${task.title}` });
      if (!sessionRes.ok || !sessionRes.data) {
        return sendErr(res, 500, 'Failed to create new session');
      }

      const newSessionId = sessionRes.data.id;
      task.session_id = newSessionId; // Update local task object for notifyAssignee

      // Update task with new session_id
      const updateRes = await sbQuery({
        method: 'PATCH',
        table: 'dev_tasks',
        query: `id=eq.${taskId}&select=*`,
        body: { session_id: newSessionId }
      });

      if (!updateRes.ok) {
        return sendErr(res, 500, 'Failed to update task with new session');
      }

      // Notify assignee to trigger worker in the new thread
      if (task.assignee) {
        await notifyAssignee(task, 're-assigned to a new discussion thread');
      }

      return sendOk(res, 200, { session_id: newSessionId });
    } catch (err) {
      console.error('API route handler unexpected error:', err);
      return sendErr(res, 500, 'An unexpected error occurred.', { details: err.message });
    }
  }

  // Handle other methods for /api/tasks
  if (pathname.startsWith('/api/tasks')) {
    res.setHeader('Allow', ['POST', 'PATCH']);
    return sendErr(res, 405, `Method ${requestMethod} Not Allowed`);
  }

  return false; // Route not handled by this module
}

const { createRogerChat, createRogerSession } = require('../lib/rogerChatsStore');

async function notifyAssignee(task, action) {
  // We notify if it is Roger or another agent
  if (task.assignee === 'roger' || task.assignee === 'antigravity' || task.assignee === 'angie') {
    // If the task does not have a session yet, we must create one before notifying
    if (!task.session_id) {
      try {
        // We omit project_id here because dev_tasks uses UUIDs but dev_sessions uses bigints, causing schema errors.
        const sessionRes = await createRogerSession({ name: `Task: ${task.title}` });
        if (sessionRes.ok && sessionRes.data) {
          task.session_id = sessionRes.data.id;
          // Update the task to permanently associate this new session
          await sbQuery({
            method: 'PATCH',
            table: 'dev_tasks',
            query: `id=eq.${task.id}`,
            body: { session_id: task.session_id }
          });
        } else {
           console.error('[Task API] Failed to auto-create session for agent notification', sessionRes.error);
           return;
        }
      } catch(e) {
         console.error('[Task API] Error auto-creating session:', e);
         return;
      }
    }
    
    const recipientName = task.assignee.charAt(0).toUpperCase() + task.assignee.slice(1);
    const descriptionStr = task.description ? `\nDescription: ${task.description}` : '';
    const message = `[SYSTEM ALERT] @${recipientName}: A task has been ${action} to you: Task #${task.id} - "${task.title}". Priority: ${task.priority}.${descriptionStr}\nPlease review it and take necessary actions.`;
    
    try {
      const chatRes = await createRogerChat({
        session_id: task.session_id,
        // project_id is omitted for the same schema mismatch reason
        role: 'user', // We send it as 'user' so the agent responds to it
        content: message
      });
      
      if (chatRes.ok && chatRes.data) {
        // Enqueue a processing message for the agent to take over
        const agentProcessingRes = await createRogerChat({
          session_id: task.session_id,
          role: task.assignee,
          status: 'processing',
          content: '[SYSTEM::PROCESSING]',
          parent_id: chatRes.data.id
        });

        if (agentProcessingRes.ok && agentProcessingRes.data && typeof fetch === 'function') {
           // We do a "fire and forget" local trigger for the agent to wake up immediately.
           fetch('http://127.0.0.1:3000/api/develop/devAgent/worker', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ sessionId: task.session_id, chatId: agentProcessingRes.data.id, respondingAgent: task.assignee })
           }).catch((e) => console.error('[Task API] fetch error triggering worker:', e));
        }
      }
    } catch (err) {
      console.error('[Task API] Failed to notify assignee:', err);
    }
  }
}

module.exports = { manifest, handle };
