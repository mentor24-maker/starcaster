const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

const dashboardRegex = /<section id="devDashboardPage" class="app-page hidden">[\s\S]*?<\/section>/;
const dashboardMatch = html.match(dashboardRegex);

if (dashboardMatch) {
  let content = dashboardMatch[0];
  
  // Replace the first pod (Action Items)
  content = content.replace(
    /<div style="background: var\(--bg-card\); border-radius: 8px; padding: 1\.5rem; display: flex; flex-direction: column; grid-row: span 2; border: 1px solid var\(--border-light\); overflow-y: hidden;">/,
    '<div style="background: #e0f2fe; border-radius: 40px; padding: 2rem; display: flex; flex-direction: column; grid-row: span 2; border: 2px solid #bae6fd; overflow-y: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">'
  );

  // Replace second pod (Tasks)
  content = content.replace(
    /<div style="background: var\(--bg-card\); border-radius: 8px; padding: 1\.5rem; display: flex; flex-direction: column; border: 1px solid var\(--border-light\); overflow-y: hidden;">/,
    '<div style="background: #e1f5fe; border-radius: 40px; padding: 2rem; display: flex; flex-direction: column; border: 2px solid #b3e5fc; overflow-y: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">'
  );

  // Replace third pod (Forum)
  content = content.replace(
    /<div style="background: var\(--bg-card\); border-radius: 8px; padding: 1\.5rem; display: flex; flex-direction: column; border: 1px solid var\(--border-light\); overflow-y: hidden;">/,
    '<div style="background: #e0f7fa; border-radius: 40px; padding: 2rem; display: flex; flex-direction: column; border: 2px solid #b2ebf2; overflow-y: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">'
  );

  // Replace fourth pod (Team)
  content = content.replace(
    /<div style="background: var\(--bg-card\); border-radius: 8px; padding: 1\.5rem; display: flex; flex-direction: column; border: 1px solid var\(--border-light\); overflow-y: hidden;">/,
    '<div style="background: #e8eaf6; border-radius: 40px; padding: 2rem; display: flex; flex-direction: column; border: 2px solid #c5cae9; overflow-y: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">'
  );

  // Replace fifth pod (Friction Log)
  content = content.replace(
    /<div style="background: var\(--bg-card\); border-radius: 8px; padding: 1\.5rem; display: flex; flex-direction: column; border: 1px solid var\(--border-light\); overflow-y: hidden;">/,
    '<div style="background: #e3f2fd; border-radius: 40px; padding: 2rem; display: flex; flex-direction: column; border: 2px solid #bbdefb; overflow-y: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">'
  );

  html = html.replace(dashboardRegex, content);
  fs.writeFileSync('public/index.html', html, 'utf8');
  console.log("Pods updated successfully");
} else {
  console.log("Could not find devDashboardPage");
}
