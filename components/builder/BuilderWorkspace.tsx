/**
 * Starcaster shell wrapper around the full builder editor ported from
 * the legacy builder. Honors the mount contract used by public/js/builder.js
 * (surface/editorMode/record/onClose/onSaved); the editor manages its own
 * record lists and selection, so record preselection props are accepted
 * for compatibility but selection happens inside the editor.
 */
import { useRef } from 'react';
import { AdminBuilderEditor } from '../admin-builder-editor';
import { revealAndFocus } from './builder-publish-panel';

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

export default function BuilderWorkspace({ surface = 'hub', editorMode, record, onClose }: BuilderWorkspaceProps) {
  // The legacy app mounts this island to edit a specific record (page or
  // template). Translate that mount contract into the editor's own mode +
  // preselection so it opens on the requested record instead of the default
  // (empty) Templates view.
  const initialMode =
    editorMode === 'page'
      ? 'pages'
      : editorMode === 'modules'
        ? 'modules'
        : editorMode === 'template'
          ? 'templates'
          : undefined;
  const recordId = record?.id;
  const initialRecordId =
    recordId === undefined || recordId === null || recordId === '' ? undefined : String(recordId);

  // When mounted in page mode with no existing record, open Page Details
  // immediately so the user can start filling in the new page.
  const autoNewPage = editorMode === 'page' && !initialRecordId;

  // After a Publish the next step is leaving, so Close Builder takes the focus
  // (task 86bcgmztg). The hub has no Close Builder; the ref stays empty there
  // and this does nothing.
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="builder-react-root">
      {surface !== 'hub' && typeof onClose === 'function' ? (
        <div className="builder-workspace-topbar">
          <button className="secondary-button" onClick={onClose} ref={closeButtonRef} type="button">
            Close Builder
          </button>
        </div>
      ) : null}
      <AdminBuilderEditor
        initialMode={initialMode}
        initialRecordId={initialRecordId}
        autoNewPage={autoNewPage}
        onPublished={() => revealAndFocus(closeButtonRef.current)}
      />
    </div>
  );
}
