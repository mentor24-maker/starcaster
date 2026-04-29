const fs = require('fs');
let content = fs.readFileSync('public/js/devAgent.js', 'utf8');

content = content.replace("App.devAgent.openTaskEditor = async function(taskId, returnToProjectId = null) {\n  App.setActivePage('devTasksPage');", "App.devAgent.openTaskEditor = async function(taskId, returnToProjectId = null) {\n  devState.skipNextBrowserReset = true;\n  App.setActivePage('devTasksPage');");

content = content.replace("      } else if (pageId === 'devTasksPage') {\n        await App.devAgent.loadTasks();\n        setTimeout(() => App.devAgent.showTaskBrowser(), 50);", "      } else if (pageId === 'devTasksPage') {\n        await App.devAgent.loadTasks();\n        if (devState.skipNextBrowserReset) {\n          devState.skipNextBrowserReset = false;\n        } else {\n          setTimeout(() => App.devAgent.showTaskBrowser(), 50);\n        }");

// We also need to fix the click listener that does `setActivePage` AND `openTaskEditor`!
// It's in the Project Tasks row render.
content = content.replace("if (App.setActivePage) App.setActivePage('devTasksPage');\n               setTimeout(() => {\n                 App.devAgent.openTaskEditor(t.id);\n               }, 100);", "App.devAgent.openTaskEditor(t.id, id);");

// And for editBtn
content = content.replace("if (App.setActivePage) App.setActivePage('devTasksPage');\n               setTimeout(() => {\n                 App.devAgent.openTaskEditor(t.id);\n               }, 100);", "App.devAgent.openTaskEditor(t.id, id);");

fs.writeFileSync('public/js/devAgent.js', content, 'utf8');
