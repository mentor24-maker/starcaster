const fs = require('fs');
let content = fs.readFileSync('public/js/devAgent.js', 'utf8');

const oldLogic = `             tr.innerHTML = \`
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
             
             taskTbody.appendChild(tr);`;

const newLogic = `             tr.innerHTML = \`
               <td>\${t.title}</td>
               <td><span class="badge badge-gray" style="text-transform: capitalize;">\${t.status.replace('_', ' ')}</span></td>
               <td><span class="badge badge-gray" style="text-transform: capitalize;">\${t.priority}</span></td>
               <td style="text-transform: capitalize;">\${t.assignee}</td>
               <td style="text-align: right; white-space: nowrap;">
                 <button type="button" class="dev-action-btn edit-task-btn" title="Edit Task" style="background:none; border:none; cursor:pointer; color:var(--text-muted); padding:4px;">
                   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                 </button>
                 <button type="button" class="dev-action-btn del-task-btn" title="Delete Task" style="background:none; border:none; cursor:pointer; color:var(--accent-danger); padding:4px;">
                   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                 </button>
               </td>
             \`;
             
             const editBtn = tr.querySelector('.edit-task-btn');
             const delBtn = tr.querySelector('.del-task-btn');
             
             editBtn.addEventListener('click', (e) => {
               e.stopPropagation();
               if (App.setActivePage) App.setActivePage('devTasksPage');
               setTimeout(() => {
                 App.devAgent.openTaskEditor(t.id);
               }, 100);
             });
             
             delBtn.addEventListener('click', async (e) => {
               e.stopPropagation();
               if (confirm('Are you sure you want to delete this task?')) {
                 try {
                   await window.supabaseClient.from('dev_tasks').delete().eq('id', t.id);
                   App.notify('Task deleted successfully', 'success');
                   App.devAgent.openProjectEditor(id); // Reload the list
                   if (typeof App.devAgent.loadDashboard === 'function') App.devAgent.loadDashboard();
                 } catch (err) {
                   App.notify('Failed to delete task', 'error');
                 }
               }
             });
             
             taskTbody.appendChild(tr);`;

content = content.replace(oldLogic, newLogic);

// Also need to change the colspan in the JS for the loading/empty states
content = content.replace("taskTbody.innerHTML = '<tr><td colspan=\"4\" style=\"text-align: center; color: #666; font-style: italic;\">Loading tasks...</td></tr>';", "taskTbody.innerHTML = '<tr><td colspan=\"5\" style=\"text-align: center; color: #666; font-style: italic;\">Loading tasks...</td></tr>';");
content = content.replace("taskTbody.innerHTML = '<tr><td colspan=\"4\" style=\"text-align: center; color: #666; font-style: italic;\">No tasks for this project.</td></tr>';", "taskTbody.innerHTML = '<tr><td colspan=\"5\" style=\"text-align: center; color: #666; font-style: italic;\">No tasks for this project.</td></tr>';");
content = content.replace("taskTbody.innerHTML = '<tr><td colspan=\"4\" style=\"text-align: center; color: #666; font-style: italic;\">Save project first to see tasks.</td></tr>';", "taskTbody.innerHTML = '<tr><td colspan=\"5\" style=\"text-align: center; color: #666; font-style: italic;\">Save project first to see tasks.</td></tr>';");

fs.writeFileSync('public/js/devAgent.js', content, 'utf8');
