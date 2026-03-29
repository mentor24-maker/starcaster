'use strict';

function requestProjectScope(req) {
  const projectIds = Array.isArray(req?.projectContext?.projects)
    ? req.projectContext.projects.map((project) => String(project?.id || '').trim()).filter(Boolean)
    : [];
  return {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId: String(req?.authUser?.id || '').trim(),
    projectIds,
  };
}

module.exports = {
  requestProjectScope,
};
