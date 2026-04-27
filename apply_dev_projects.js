require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');

if (process.env.DATABASE_URL) {
  try {
    const alterSql = `
      ALTER TABLE public.dev_tasks DROP COLUMN IF EXISTS project_id;
      ALTER TABLE public.dev_tasks ADD COLUMN project_id UUID DEFAULT NULL REFERENCES public.dev_projects(id) ON DELETE SET NULL;
    `;
    fs.writeFileSync('temp_alter.sql', alterSql);
    console.log("Applying dev_projects_setup.sql...");
    execSync(`psql "${process.env.DATABASE_URL}" -f docs/dev_projects_setup.sql`, { stdio: 'inherit' });
    console.log("Applying alter_dev_tasks...");
    execSync(`psql "${process.env.DATABASE_URL}" -f temp_alter.sql`, { stdio: 'inherit' });
    console.log("Done.");
  } catch (e) {
    console.error("Failed to run psql:", e.message);
  }
} else {
  console.log("No DATABASE_URL found.");
}
