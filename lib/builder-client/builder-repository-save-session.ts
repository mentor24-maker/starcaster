type RepositoryFocusForSession =
  | {
      kind: "created";
      source: { kind: string; sourceId: string; sectionId: string; moduleId: string };
    }
  | { kind: "saved"; cellModuleId: string }
  | { kind: "section"; sectionId: string };

export function repositoryEditingSessionKeyFromFocus(focus: RepositoryFocusForSession | null): string {
  if (!focus) {
    return "";
  }

  if (focus.kind === "created") {
    return `created:${focus.source.kind}:${focus.source.sourceId}:${focus.source.sectionId}:${focus.source.moduleId}`;
  }

  if (focus.kind === "saved") {
    return `saved:${focus.cellModuleId}`;
  }

  return `section:${focus.sectionId}`;
}

export function repositoryEditingSessionKeyFromLocalState(args: {
  editingCreatedId: string;
  editingId: string;
  editingSectionId: string;
}): string {
  if (args.editingSectionId) {
    return `section:${args.editingSectionId}`;
  }

  if (args.editingCreatedId) {
    return `created-open:${args.editingCreatedId}`;
  }

  if (args.editingId) {
    return `saved:${args.editingId}`;
  }

  return "";
}
