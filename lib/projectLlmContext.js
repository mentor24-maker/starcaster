'use strict';

function safeText(value) {
  return String(value || '').trim();
}

function projectFromScope(scope) {
  const project = scope?.project && typeof scope.project === 'object' ? scope.project : {};
  return {
    id: safeText(scope?.projectId || project.id),
    name: safeText(project.name),
    slug: safeText(project.slug),
    description: safeText(project.description),
    website: safeText(project.website || project.projectUrl || project.siteUrl || project.url || project.canonicalUrl),
  };
}

function projectTrainingKey(scope) {
  const project = projectFromScope(scope);
  if (project.id) return `project:${project.id}`;
  const userId = safeText(scope?.userId || scope?.user_id);
  if (userId) return `user:${userId}`;
  return 'global';
}

function projectBoundaryText(scope) {
  const project = projectFromScope(scope);
  const lines = [
    'Active project boundary:',
    `- Project ID: ${project.id || '-'}`,
    `- Project name: ${project.name || '-'}`,
    `- Project slug: ${project.slug || '-'}`,
    project.description ? `- Project description: ${project.description}` : '',
    project.website ? `- Project website: ${project.website}` : '',
    '',
    'Hard constraints:',
    '- Generate content only for the active project above.',
    '- Do not use, mention, or borrow context from other Starcaster projects unless the user explicitly provides that material in this request.',
    '- If any saved training, global profile data, examples, URLs, or rules conflict with the active project, ignore the conflicting material.',
    '- Do not infer that a URL, brand, product, framework, or account belongs to this project unless it appears in the active project identity or the user-provided request.',
  ].filter(Boolean);
  return lines.join('\n');
}

function lineMentionsOtherProject(line, project) {
  const text = safeText(line);
  if (!text) return false;
  const lower = text.toLowerCase();
  const allowed = [project.name, project.slug, project.website]
    .map((value) => safeText(value).toLowerCase())
    .filter(Boolean);
  if (allowed.some((value) => lower.includes(value))) return false;
  return /\bisitas\b|\bisit construct\b|\bisit game\b|isitas\.org/i.test(text);
}

function removeKnownCrossProjectLines(value, scope) {
  const project = projectFromScope(scope);
  const projectKey = `${project.name} ${project.slug}`.toLowerCase();
  if (/\bisitas\b/.test(projectKey)) return safeText(value);
  return safeText(value)
    .split(/\r?\n/g)
    .filter((line) => !lineMentionsOtherProject(line, project))
    .join('\n')
    .trim();
}

function constrainTrainingToProject(training, scope) {
  return {
    context: removeKnownCrossProjectLines(training?.context, scope),
    guidelines: removeKnownCrossProjectLines(training?.guidelines, scope),
  };
}

module.exports = {
  constrainTrainingToProject,
  projectBoundaryText,
  projectFromScope,
  projectTrainingKey,
};
