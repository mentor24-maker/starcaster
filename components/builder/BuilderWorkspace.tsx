/**
 * Starcaster shell wrapper around the full builder editor ported from
 * normie. Honors the mount contract used by public/js/builder.js
 * (surface/editorMode/record/onClose/onSaved); the editor manages its own
 * record lists and selection, so record preselection props are accepted
 * for compatibility but selection happens inside the editor.
 */
import { AdminBuilderEditor } from '../admin-builder-editor';

type BuilderWorkspaceProps = {
  surface?: string;
  editorMode?: string;
  menuMode?: string;
  record?: Record<string, unknown> | null;
  sourceTemplateId?: string;
  options?: Record<string, unknown> | null;
  onClose?: () => void;
  onSaved?: (record: unknown) => void;
};

export default function BuilderWorkspace({ surface = 'hub', onClose }: BuilderWorkspaceProps) {
  return (
    <div className="builder-react-root">
      {surface !== 'hub' && typeof onClose === 'function' ? (
        <div className="builder-workspace-topbar">
          <button className="secondary-button" onClick={onClose} type="button">
            Close Builder
          </button>
        </div>
      ) : null}
      <AdminBuilderEditor />
    </div>
  );
}
