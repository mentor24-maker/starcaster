const fs = require('fs');

const codeToAppend = `

// --- Global Messages Feature ---

App.devAgent.allMessages = [];
App.devAgent.allMessagesSortKey = 'created_at';
App.devAgent.allMessagesSortAsc = false;

App.devAgent.loadAllMessages = async function() {
  if (!window.supabaseClient) return;
  const { data: messages, error: msgsError } = await window.supabaseClient
    .from('agent_messages')
    .select('id, session_id, role, created_at, content')
    .order('created_at', { ascending: false })
    .limit(100);

  if (msgsError) {
    console.error("Error fetching agent_messages:", msgsError);
    return;
  }

  const sessionIds = [...new Set(messages.map(m => m.session_id).filter(id => id))];
  
  let tasksDict = {};
  if (sessionIds.length > 0) {
    const { data: tasks, error: tasksError } = await window.supabaseClient
      .from('dev_tasks')
      .select('session_id, title')
      .in('session_id', sessionIds);

    if (!tasksError && tasks) {
      tasks.forEach(t => {
        tasksDict[t.session_id] = t.title;
      });
    }
  }

  const parseTargetAgent = (content) => {
    try {
      const match = content.match(/\\\`\\\`\\\`json\\n([\\s\\S]*?)\\n\\\`\\\`\\\`/);
      if (match) {
        const json = JSON.parse(match[1]);
        if (json.state && json.state.target_agent) return json.state.target_agent;
      }
    } catch(e) {}
    return '-';
  };

  const parseMessageSnippet = (content) => {
    try {
      const match = content.match(/\\\`\\\`\\\`json\\n([\\s\\S]*?)\\n\\\`\\\`\\\`/);
      if (match) {
        const json = JSON.parse(match[1]);
        if (json.payload && json.payload.content) {
            const txt = json.payload.content;
            return txt.length > 100 ? txt.substring(0, 100) + '...' : txt;
        }
      }
    } catch(e) {}
    const cleanContent = content.replace(/\\\`\\\`\\\`[\\s\\S]*?\\\`\\\`\\\`/g, '').trim();
    return cleanContent.length > 100 ? cleanContent.substring(0, 100) + '...' : cleanContent || '[JSON Payload]';
  };

  App.devAgent.allMessages = messages.map(m => ({
    created_at: m.created_at,
    task_title: tasksDict[m.session_id] || \`Session \${m.session_id}\`,
    sender: m.role,
    receiver: parseTargetAgent(m.content),
    message: parseMessageSnippet(m.content),
    raw_content: m.content
  }));

  App.devAgent.renderAllMessages();
};

App.devAgent.renderAllMessages = function() {
  const tbody = document.getElementById('devAllMessagesTable');
  if (!tbody) return;

  const filterText = (document.getElementById('devAllMessagesFilter')?.value || '').toLowerCase();

  let filtered = App.devAgent.allMessages.filter(m => {
    if (!filterText) return true;
    return (m.task_title && m.task_title.toLowerCase().includes(filterText)) ||
           (m.sender && m.sender.toLowerCase().includes(filterText)) ||
           (m.receiver && m.receiver.toLowerCase().includes(filterText)) ||
           (m.message && m.message.toLowerCase().includes(filterText));
  });

  const key = App.devAgent.allMessagesSortKey;
  const asc = App.devAgent.allMessagesSortAsc;
  
  filtered.sort((a, b) => {
    let valA = a[key] || '';
    let valB = b[key] || '';
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();
    if (valA < valB) return asc ? -1 : 1;
    if (valA > valB) return asc ? 1 : -1;
    return 0;
  });

  tbody.innerHTML = '';
  filtered.forEach(m => {
    const tr = document.createElement('tr');
    tr.innerHTML = \`
      <td style="white-space: nowrap;">\${new Date(m.created_at).toLocaleString()}</td>
      <td>\${m.task_title}</td>
      <td style="text-transform: capitalize;"><strong>\${m.sender}</strong></td>
      <td>\${m.receiver}</td>
      <td style="color: #666; max-width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="\${m.message.replace(/"/g, '&quot;')}">\${m.message}</td>
    \`;
    tbody.appendChild(tr);
  });
};

App.devAgent.sortAllMessages = function(key) {
  if (App.devAgent.allMessagesSortKey === key) {
    App.devAgent.allMessagesSortAsc = !App.devAgent.allMessagesSortAsc;
  } else {
    App.devAgent.allMessagesSortKey = key;
    App.devAgent.allMessagesSortAsc = true;
  }
  App.devAgent.renderAllMessages();
};

App.devAgent.filterAllMessages = function() {
  App.devAgent.renderAllMessages();
};
`;

const fileStr = fs.readFileSync('public/js/devAgent.js', 'utf8');

// Inject the call to loadAllMessages into loadSessions
const newFileStr = fileStr.replace(
  'App.devAgent.loadSessions = async function() {',
  'App.devAgent.loadSessions = async function() { App.devAgent.loadAllMessages();'
) + codeToAppend;

fs.writeFileSync('public/js/devAgent.js', newFileStr, 'utf8');
console.log("Appended devAgent.js");

