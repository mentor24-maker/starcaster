const fs = require('fs');
let content = fs.readFileSync('public/js/devAgent.js', 'utf8');

const oldCode = `  const forumTbody = document.getElementById('devProjectForumMessagesTableBody');
  if (forumTbody) {
    if (id) {
      forumTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #666; font-style: italic;">Loading messages...</td></tr>';
      try {
        const { data: messages, error } = await window.supabaseClient.from('agent_messages')
          .select('*')
          .eq('project_id', id)
          .order('created_at', { ascending: false });
          
        if (error) throw error;
        
        if (!messages || messages.length === 0) {
           forumTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #666; font-style: italic;">No forum messages for this project.</td></tr>';
        } else {
           forumTbody.innerHTML = '';
           messages.forEach(m => {
             const tr = document.createElement('tr');
             
             let timeStr = '';
             if (m.created_at) {
               const d = new Date(m.created_at);
               timeStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
             }
             
             let sender = m.role === 'user' ? 'Human' : (m.role === 'roger' ? 'DevAgent' : m.role);
             let receiver = m.role === 'user' ? 'DevAgent' : 'Human';
             if (m.content) {
               if (m.content.toLowerCase().includes('awaiting archie') || m.content.toLowerCase().includes('@archie') || m.content.toLowerCase().includes('@antigravity')) {
                 receiver = 'Archie';
               } else if (m.content.toLowerCase().includes('@angie')) {
                 receiver = 'Angie';
               }
             }

             let truncMsg = m.content || '';
             if (truncMsg.length > 80) truncMsg = truncMsg.substring(0, 80) + '...';
             
             tr.innerHTML = \`
               <td style="white-space: nowrap;">\${timeStr}</td>
               <td><span class="badge \${sender === 'Human' ? 'badge-blue' : (sender === 'DevAgent' ? 'badge-gray' : 'badge-green')}">\${sender}</span></td>
               <td><span class="badge \${receiver === 'Human' ? 'badge-blue' : (receiver === 'DevAgent' ? 'badge-gray' : 'badge-green')}">\${receiver}</span></td>
               <td title="\${m.content.replace(/"/g, '&quot;')}">\${truncMsg}</td>
             \`;
             
             tr.style.cursor = 'pointer';
             tr.addEventListener('click', () => {
               if (App.setActivePage) App.setActivePage('devForumPage');
               setTimeout(() => {
                 App.devAgent.expandThreadAccordion(m.session_id);
               }, 100);
             });
             
             forumTbody.appendChild(tr);
           });
        }
      } catch (err) {
        forumTbody.innerHTML = \`<tr><td colspan="4" style="text-align: center; color: red;">Failed to load messages: \${err.message}</td></tr>\`;
      }
    } else {
      forumTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #666; font-style: italic;">Save project first to see messages.</td></tr>';
    }
  }`;

const newCode = `  const taskTbody = document.getElementById('devProjectTasksTableBody');
  if (taskTbody) {
    if (id) {
      taskTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #666; font-style: italic;">Loading tasks...</td></tr>';
      try {
        const { data: tasks, error } = await window.supabaseClient.from('dev_tasks')
          .select('*')
          .eq('project_id', id)
          .order('created_at', { ascending: false });
          
        if (error) throw error;
        
        if (!tasks || tasks.length === 0) {
           taskTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #666; font-style: italic;">No tasks for this project.</td></tr>';
        } else {
           taskTbody.innerHTML = '';
           tasks.forEach(t => {
             const tr = document.createElement('tr');
             
             tr.innerHTML = \`
               <td>\${t.title}</td>
               <td><span class="badge badge-gray" style="text-transform: capitalize;">\${t.status.replace('_', ' ')}</span></td>
               <td><span class="badge badge-gray" style="text-transform: capitalize;">\${t.priority}</span></td>
               <td style="text-transform: capitalize;">\${t.assignee}</td>
             \`;
             
             tr.style.cursor = 'pointer';
             tr.addEventListener('click', () => {
               if (App.setActivePage) App.setActivePage('devTasksPage');
               setTimeout(() => {
                 App.devAgent.openTaskEditor(t.id);
               }, 100);
             });
             
             taskTbody.appendChild(tr);
           });
        }
      } catch (err) {
        taskTbody.innerHTML = \`<tr><td colspan="4" style="text-align: center; color: red;">Failed to load tasks: \${err.message}</td></tr>\`;
      }
    } else {
      taskTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #666; font-style: italic;">Save project first to see tasks.</td></tr>';
    }
  }`;

if (content.includes(oldCode)) {
  content = content.replace(oldCode, newCode);
  fs.writeFileSync('public/js/devAgent.js', content, 'utf8');
  console.log('Success replacing tasks code');
} else {
  console.log('Could not find old code in devAgent.js');
}
