'use strict';

// Guards the fix for "Active project is required" on every scoped call:
// a brand-new session has no pinned project and a fresh browser sends no
// X-Project-ID header, so resolveCurrentProject used to hand back project:null
// even for a user who owns projects. The boot endpoint now passes
// autoSelectFirst; the per-request middleware still must not guess.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PROJECTS_FILE = path.join(__dirname, '..', 'data', 'projects.json');
const original = fs.existsSync(PROJECTS_FILE) ? fs.readFileSync(PROJECTS_FILE) : null;

// The file store is only used when Supabase is not configured. Blank the
// credentials before requiring the module so the test never touches the
// real database.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.SUPABASE_KEY;

const { resolveCurrentProject } = require('../lib/projectsStore');

const USER = 'user_test_autoselect';

function seed(projects) {
  fs.writeFileSync(
    PROJECTS_FILE,
    JSON.stringify({
      projects,
      memberships: projects.map((project) => ({
        project_id: project.id,
        user_id: USER,
        role: 'owner',
        status: 'active',
        created_at: project.created_at,
      })),
    }),
  );
}

async function run() {
  seed([
    { id: 'proj_default_x', name: 'Default Project', slug: 'default-x', created_at: '2026-01-01T00:00:00.000Z' },
    { id: 'proj_real', name: 'Marinoff', slug: 'marinoff', created_at: '2026-02-01T00:00:00.000Z' },
  ]);

  // Boot call: no session pin, no header — must still land on a project,
  // and must prefer the real one over the auto-created default.
  const booted = await resolveCurrentProject({
    userId: USER,
    requestedProjectId: '',
    sessionActiveProjectId: '',
    autoCreateDefault: true,
    autoSelectFirst: true,
  });
  assert.equal(booted.ok, true);
  assert.equal(booted.data.project?.id, 'proj_real');
  assert.equal(booted.data.resolvedFrom, 'auto');

  // The per-request middleware path must keep guessing nothing: picking a
  // scope for reads and writes on the user's behalf is how data lands in the
  // wrong workspace.
  const middleware = await resolveCurrentProject({
    userId: USER,
    requestedProjectId: '',
    sessionActiveProjectId: '',
    autoCreateDefault: false,
  });
  assert.equal(middleware.ok, true);
  assert.equal(middleware.data.project, null);
  assert.equal(middleware.data.resolvedFrom, null);

  // An explicit pin still wins over the fallback.
  const pinned = await resolveCurrentProject({
    userId: USER,
    requestedProjectId: '',
    sessionActiveProjectId: 'proj_default_x',
    autoCreateDefault: true,
    autoSelectFirst: true,
  });
  assert.equal(pinned.data.project?.id, 'proj_default_x');
  assert.equal(pinned.data.resolvedFrom, 'session');

  // Only a default project exists — take it rather than stranding the user.
  seed([
    { id: 'proj_default_x', name: 'Default Project', slug: 'default-x', created_at: '2026-01-01T00:00:00.000Z' },
  ]);
  const onlyDefault = await resolveCurrentProject({
    userId: USER,
    requestedProjectId: '',
    sessionActiveProjectId: '',
    autoCreateDefault: true,
    autoSelectFirst: true,
  });
  assert.equal(onlyDefault.data.project?.id, 'proj_default_x');
  assert.equal(onlyDefault.data.resolvedFrom, 'auto');

  // A user with no projects at all resolves to none, not to a crash.
  seed([]);
  const none = await resolveCurrentProject({
    userId: 'user_with_nothing',
    requestedProjectId: '',
    sessionActiveProjectId: '',
    autoCreateDefault: false,
    autoSelectFirst: true,
  });
  assert.equal(none.ok, true);
  assert.equal(none.data.project, null);

  // Two brand-new users must BOTH get a default project. Slugs are globally
  // unique, so when the auto-create asked for the name alone every default
  // wanted the slug "default-project": the first user took it and every user
  // after that got a 409, ended up with no project, and could not use a
  // single screen.
  seed([]);
  const firstNewUser = await resolveCurrentProject({
    userId: 'user_brand_new_one',
    requestedProjectId: '',
    sessionActiveProjectId: '',
    autoCreateDefault: true,
    autoSelectFirst: true,
  });
  const secondNewUser = await resolveCurrentProject({
    userId: 'user_brand_new_two',
    requestedProjectId: '',
    sessionActiveProjectId: '',
    autoCreateDefault: true,
    autoSelectFirst: true,
  });
  assert.ok(firstNewUser.data.project?.id, 'first new user got no default project');
  assert.ok(secondNewUser.data.project?.id, 'second new user got no default project');
  assert.notEqual(secondNewUser.data.project.id, firstNewUser.data.project.id);
  assert.notEqual(secondNewUser.data.project.slug, firstNewUser.data.project.slug);
  // Each default still reads as a default, so a real project outranks it.
  assert.ok(secondNewUser.data.project.slug.startsWith('default-'));
}

run()
  .then(() => {
    console.log('project-current-autoselect: OK');
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    if (original) fs.writeFileSync(PROJECTS_FILE, original);
  });
