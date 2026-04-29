const fs = require('fs');
let content = fs.readFileSync('public/js/devAgent.js', 'utf8');

const injection = `
  const forumTbody = document.getElementById('devProjectForumMessagesTableBody');
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
  }
`;

content = content.replace("App.devAgent.openProjectEditor = async function(id = null) {\n  const browserPanel = document.getElementById('devProjectBrowserPanel'); if(browserPanel) browserPanel.classList.add('hidden');\n  const editorPanel = document.getElementById('devProjectEditorPanel'); if(editorPanel) editorPanel.classList.remove('hidden');", "App.devAgent.openProjectEditor = async function(id = null) {\n  const browserPanel = document.getElementById('devProjectBrowserPanel'); if(browserPanel) browserPanel.classList.add('hidden');\n  const editorPanel = document.getElementById('devProjectEditorPanel'); if(editorPanel) editorPanel.classList.remove('hidden');\n  if (editorPanel) editorPanel.style.display = 'flex';\n" + injection);

fs.writeFileSync('public/js/devAgent.js', content, 'utf8');
console.log('Success');
