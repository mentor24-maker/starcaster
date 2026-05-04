'use strict';

const { sbQuery, tableConfig } = require('./supabase');

/**
 * List all polls, optionally with their options
 */
async function listPolls() {
  const table = tableConfig().polls;
  const optionsKey = tableConfig().pollOptions;
  // Use postgrest embedding to get options with polls if possible, 
  // or fetch them separately if foreign keys aren't introspected
  const res = await sbQuery({
    method: 'GET',
    table,
    query: `select=*,${optionsKey}(*)&order=created_at.desc`
  });
  
  if (!res.ok) {
    // Fallback: If the embedding fails due to schema cache issues, fetch separately
    const plainRes = await sbQuery({
      method: 'GET',
      table,
      query: 'order=created_at.desc'
    });
    if (!plainRes.ok) throw new Error(plainRes.error || 'Failed to list polls');
    
    const polls = plainRes.data || [];
    if (!polls.length) return [];
    
    const optionsRes = await sbQuery({
      method: 'GET',
      table: optionsKey,
      query: 'order=sort_order.asc'
    });
    
    const options = optionsRes.ok ? (optionsRes.data || []) : [];
    const optionsByPoll = {};
    for (const opt of options) {
      if (!optionsByPoll[opt.poll_id]) optionsByPoll[opt.poll_id] = [];
      optionsByPoll[opt.poll_id].push(opt);
    }
    
    return polls.map(p => ({
      ...p,
      poll_options: optionsByPoll[p.id] || []
    }));
  }
  
  return (res.data || []).map(p => {
    const pCopy = { ...p };
    if (pCopy[optionsKey]) {
      pCopy.poll_options = pCopy[optionsKey];
      if (optionsKey !== 'poll_options') delete pCopy[optionsKey];
    } else if (!pCopy.poll_options) {
      pCopy.poll_options = [];
    }
    return pCopy;
  });
}

/**
 * Create a new poll with options
 */
async function createPoll(pollData, optionsList = []) {
  const table = tableConfig().polls;
  const res = await sbQuery({
    method: 'POST',
    table,
    body: {
      question: pollData.question,
      category: pollData.category || null,
      order_index: pollData.order_index || 0,
      is_published: pollData.is_published !== false
    },
    headers: { Prefer: 'return=representation' }
  });
  
  if (!res.ok) throw new Error(res.error || 'Failed to create poll');
  const poll = res.data?.[0];
  if (!poll) throw new Error('No data returned on poll creation');
  
  const savedOptions = [];
  if (optionsList.length > 0) {
    const optsBody = optionsList.map((opt, i) => ({
      poll_id: poll.id,
      label: String(opt.label || '').trim(),
      sort_order: opt.sort_order ?? (i + 1)
    }));
    
    const optRes = await sbQuery({
      method: 'POST',
      table: tableConfig().pollOptions,
      body: optsBody,
      headers: { Prefer: 'return=representation' }
    });
    
    if (optRes.ok && optRes.data) {
      savedOptions.push(...optRes.data);
    }
  }
  
  return { ...poll, poll_options: savedOptions };
}

/**
 * Update a poll and its options
 */
async function updatePoll(id, pollData, optionsList = null) {
  const table = tableConfig().polls;
  
  // 1. Update poll
  if (Object.keys(pollData).length > 0) {
    const res = await sbQuery({
      method: 'PATCH',
      table,
      query: `id=eq.${encodeURIComponent(id)}`,
      body: pollData,
      headers: { Prefer: 'return=representation' }
    });
    if (!res.ok) throw new Error(res.error || 'Failed to update poll');
  }
  
  // 2. Replace options if provided
  if (optionsList !== null) {
    const optsTable = tableConfig().pollOptions;
    // Delete existing options
    await sbQuery({
      method: 'DELETE',
      table: optsTable,
      query: `poll_id=eq.${encodeURIComponent(id)}`
    });
    
    // Insert new options
    if (optionsList.length > 0) {
      const optsBody = optionsList.map((opt, i) => ({
        poll_id: id,
        label: String(opt.label || opt || '').trim(),
        sort_order: opt.sort_order ?? (i + 1)
      }));
      await sbQuery({
        method: 'POST',
        table: optsTable,
        body: optsBody
      });
    }
  }
  
  return { success: true };
}

/**
 * Delete a poll
 */
async function deletePoll(id) {
  const table = tableConfig().polls;
  const res = await sbQuery({
    method: 'DELETE',
    table,
    query: `id=eq.${encodeURIComponent(id)}`
  });
  if (!res.ok) throw new Error(res.error || 'Failed to delete poll');
  return { success: true };
}

module.exports = {
  listPolls,
  createPoll,
  updatePoll,
  deletePoll
};
