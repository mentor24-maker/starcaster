import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listCellModules,
  listEmailTemplates,
  listLandingPages,
  listPageTemplates,
  listSavedSections,
  prepareEditorRecord,
  saveEmailTemplate,
  saveLandingPage,
  savePageTemplate,
} from './builder-api';

const MENU_MODES = [
  { id: 'templates', label: 'Templates' },
  { id: 'modules', label: 'Module Repository' },
  { id: 'pages', label: 'Pages' },
];

function safeText(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function notify(message, isError = false) {
  if (typeof window.App?.notify === 'function') {
    window.App.notify(message, isError);
  }
}

function SectionSummary({ section, index }) {
  const modules = Array.isArray(section?.modules) ? section.modules : [];
  return (
    <article className="builder-section-summary">
      <div className="builder-section-summary__title">
        {safeText(section?.title, 120) || `Section ${index + 1}`}
      </div>
      <div className="builder-section-summary__meta">
        <span>{safeText(section?.layout, 40) || 'single'}</span>
        <span>{modules.length} module{modules.length === 1 ? '' : 's'}</span>
      </div>
      {modules.length > 0 && (
        <ul className="builder-section-summary__modules">
          {modules.map((module) => (
            <li key={module.id || `${index}-${module.type}`}>
              <strong>{safeText(module.type, 40)}</strong>
              {module.name ? ` — ${safeText(module.name, 80)}` : ''}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function RecordList({ rows, selectedId, onSelect, emptyLabel }) {
  if (!rows.length) {
    return <p className="builder-list-empty">{emptyLabel}</p>;
  }
  return (
    <div className="builder-record-list">
      {rows.map((row) => {
        const id = String(row.id ?? '');
        const isModular = safeText(row.templateKind, 40).toLowerCase() === 'modular';
        const isEmail = safeText(row.templateKind, 40).toLowerCase() === 'email';
        if (!isModular && !isEmail && row.templateKind) {
          // Classic fixed templates/pages stay in vanilla UI for now.
        }
        return (
          <button
            key={id || row.name}
            type="button"
            className={`builder-record-list__item${selectedId === id ? ' is-selected' : ''}`}
            onClick={() => onSelect(row)}
          >
            <span className="builder-record-list__name">{safeText(row.name, 120) || 'Untitled'}</span>
            <span className="builder-record-list__kind">{safeText(row.templateKind, 40) || 'modular'}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function BuilderWorkspace({
  surface = 'hub',
  editorMode = 'template',
  menuMode: initialMenuMode,
  record: initialRecord = null,
  sourceTemplateId = '',
  options = null,
  onClose,
  onSaved,
}) {
  const [menuMode, setMenuMode] = useState(initialMenuMode || (editorMode === 'page' ? 'pages' : 'templates'));
  const [currentEditorMode, setCurrentEditorMode] = useState(editorMode === 'page' ? 'page' : 'template');
  const [previewDevice, setPreviewDevice] = useState('desktop');
  const [loading, setLoading] = useState(Boolean(initialRecord));
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [pages, setPages] = useState([]);
  const [modules, setModules] = useState([]);
  const [savedSections, setSavedSections] = useState([]);
  const [selectedListId, setSelectedListId] = useState('');

  const isEditor = surface === 'editor' || Boolean(draft);
  const isEmailTemplate = safeText(draft?.templateKind).toLowerCase() === 'email';
  const editorLabel = currentEditorMode === 'page'
    ? 'Page'
    : (isEmailTemplate ? 'Email Template' : 'Template');

  const loadLists = useCallback(async () => {
    const [templateRows, emailRows, pageRows, moduleRows, sectionRows] = await Promise.all([
      listPageTemplates(),
      listEmailTemplates(),
      listLandingPages(),
      listCellModules(),
      listSavedSections(),
    ]);
    const modularTemplates = templateRows.filter((row) => safeText(row.templateKind).toLowerCase() === 'modular');
    const emailTemplates = emailRows.length
      ? emailRows
      : templateRows.filter((row) => safeText(row.templateKind).toLowerCase() === 'email');
    setTemplates([...modularTemplates, ...emailTemplates]);
    setPages(pageRows.filter((row) => safeText(row.templateKind).toLowerCase() === 'modular'));
    setModules(moduleRows);
    setSavedSections(sectionRows);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (initialRecord) {
          setLoading(true);
          const prepared = await prepareEditorRecord({
            ...initialRecord,
            templateId: initialRecord.templateId || sourceTemplateId || initialRecord.template_id,
          });
          if (!cancelled) {
            setDraft(prepared);
            setSelectedListId(String(prepared.id || ''));
          }
        }
        await loadLists();
      } catch (error) {
        if (!cancelled) notify(error.message || 'Could not load builder workspace', true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [initialRecord, sourceTemplateId, loadLists]);

  const openRecord = useCallback(async (row, mode) => {
    try {
      setLoading(true);
      const prepared = await prepareEditorRecord(row);
      setDraft(prepared);
      setSelectedListId(String(prepared.id || ''));
      if (mode) {
        setMenuMode(mode);
        setCurrentEditorMode(mode === 'pages' ? 'page' : 'template');
      }
    } catch (error) {
      notify(error.message || 'Could not open record', true);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCreate = useCallback(async () => {
    const blank = await prepareEditorRecord({
      name: menuMode === 'pages' ? 'Modular Page' : 'Modular Template',
      templateKind: 'modular',
      templateId: sourceTemplateId || 'standard-right-form',
      layoutSections: [],
    });
    setDraft(blank);
    setSelectedListId('');
    setCurrentEditorMode(menuMode === 'pages' ? 'page' : 'template');
  }, [menuMode, sourceTemplateId]);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    const name = safeText(draft.name, 255);
    if (!name) {
      notify(`${editorLabel} name is required`, true);
      return;
    }

    if (options && typeof options.onSave === 'function') {
      try {
        setSaving(true);
        await Promise.resolve(options.onSave(draft));
        notify(`${editorLabel} saved`);
        if (typeof onSaved === 'function') onSaved(draft);
        if (typeof onClose === 'function') onClose();
      } catch (error) {
        notify(error.message || 'Could not save', true);
      } finally {
        setSaving(false);
      }
      return;
    }

    try {
      setSaving(true);
      const payload = {
        ...draft,
        name,
        templateKind: isEmailTemplate ? 'email' : 'modular',
        templateId: draft.templateId || sourceTemplateId,
      };
      const saved = currentEditorMode === 'page'
        ? await saveLandingPage(payload)
        : (isEmailTemplate ? await saveEmailTemplate(payload) : await savePageTemplate(payload));
      setDraft(saved);
      setSelectedListId(String(saved?.id || ''));
      notify(currentEditorMode === 'page' ? 'Page saved' : 'Template saved');
      await loadLists();
      if (typeof onSaved === 'function') onSaved(saved);
    } catch (error) {
      notify(error.message || 'Could not save', true);
    } finally {
      setSaving(false);
    }
  }, [draft, currentEditorMode, editorLabel, isEmailTemplate, options, onSaved, onClose, sourceTemplateId, loadLists]);

  const handleClose = useCallback(() => {
    if (surface === 'hub') {
      setDraft(null);
      setSelectedListId('');
      return;
    }
    if (typeof onClose === 'function') onClose();
  }, [surface, onClose]);

  const sectionRows = useMemo(
    () => (Array.isArray(draft?.layoutSections) ? draft.layoutSections : []),
    [draft]
  );

  const listRows = menuMode === 'pages'
    ? pages
    : menuMode === 'modules'
      ? modules
      : templates;

  return (
    <div className={`builder-workspace${previewDevice === 'mobile' ? ' is-mobile-preview' : ''}`}>
      <header className="builder-workspace__header">
        <div className="builder-workspace__menu" role="tablist" aria-label="Builder modes">
          {MENU_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              role="tab"
              aria-selected={menuMode === mode.id}
              className={`builder-workspace__menu-btn${menuMode === mode.id ? ' is-active' : ''}`}
              onClick={() => {
                setMenuMode(mode.id);
                if (surface === 'hub') {
                  setDraft(null);
                  setSelectedListId('');
                }
              }}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <div className="builder-workspace__actions">
          <div className="builder-workspace__device-toggle" role="group" aria-label="Preview device">
            <button
              type="button"
              className={`btn btn-ghost builder-workspace__device-btn${previewDevice === 'desktop' ? ' is-active' : ''}`}
              onClick={() => setPreviewDevice('desktop')}
            >
              Desktop
            </button>
            <button
              type="button"
              className={`btn btn-ghost builder-workspace__device-btn${previewDevice === 'mobile' ? ' is-active' : ''}`}
              onClick={() => setPreviewDevice('mobile')}
            >
              Mobile
            </button>
          </div>
          {surface === 'hub' && !isEditor && (
            <button type="button" className="btn btn-ghost" onClick={handleCreate}>
              {menuMode === 'pages' ? 'Create Page' : menuMode === 'modules' ? 'Create Module' : 'Create Template'}
            </button>
          )}
          {isEditor && (
            <>
              <button type="button" className="btn btn-primary" disabled={saving || loading} onClick={handleSave}>
                {saving ? 'Saving…' : `Save ${editorLabel}`}
              </button>
              <button type="button" className="btn btn-ghost" onClick={handleClose}>
                {surface === 'hub' ? 'Back To List' : currentEditorMode === 'page' ? 'Back To Pages' : 'Close'}
              </button>
            </>
          )}
        </div>
      </header>

      <div className="builder-workspace__body">
        <aside className="builder-workspace__sidebar">
          {menuMode === 'modules' && !isEditor && (
            <>
              <h3 className="builder-workspace__sidebar-title">Saved Modules</h3>
              <RecordList
                rows={modules}
                selectedId={selectedListId}
                onSelect={(row) => openRecord({
                  name: row.name,
                  templateKind: 'modular',
                  layoutSections: [{ id: 'section_repo', layout: 'single', title: row.name, modules: row.modules || [] }],
                }, 'modules')}
                emptyLabel="No saved modules yet."
              />
              <h3 className="builder-workspace__sidebar-title">Saved Sections</h3>
              <RecordList
                rows={savedSections}
                selectedId={selectedListId}
                onSelect={(row) => openRecord({
                  name: row.name,
                  templateKind: 'modular',
                  layoutSections: row.section ? [row.section] : [],
                }, 'modules')}
                emptyLabel="No saved sections yet."
              />
            </>
          )}
          {menuMode !== 'modules' && !isEditor && (
            <>
              <h3 className="builder-workspace__sidebar-title">
                {menuMode === 'pages' ? 'Pages' : 'Templates'}
              </h3>
              <RecordList
                rows={listRows}
                selectedId={selectedListId}
                onSelect={(row) => openRecord(row, menuMode)}
                emptyLabel={menuMode === 'pages' ? 'No modular pages yet.' : 'No modular templates yet.'}
              />
            </>
          )}
          {isEditor && (
            <div className="builder-workspace__editor-meta">
              <label className="builder-field">
                <span className="builder-field__label">{editorLabel} Name</span>
                <input
                  type="text"
                  value={safeText(draft?.name, 255)}
                  onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                />
              </label>
              {isEmailTemplate && (
                <>
                  <label className="builder-field">
                    <span className="builder-field__label">Subject</span>
                    <input
                      type="text"
                      value={safeText(draft?.subject, 500)}
                      onChange={(event) => setDraft((prev) => ({ ...prev, subject: event.target.value }))}
                    />
                  </label>
                  <label className="builder-field">
                    <span className="builder-field__label">Summary</span>
                    <input
                      type="text"
                      value={safeText(draft?.summary, 1000)}
                      onChange={(event) => setDraft((prev) => ({ ...prev, summary: event.target.value }))}
                    />
                  </label>
                </>
              )}
              <dl className="builder-workspace__stats">
                <div><dt>Sections</dt><dd>{sectionRows.length}</dd></div>
                <div><dt>Modules</dt><dd>{sectionRows.reduce((sum, section) => sum + (section.modules?.length || 0), 0)}</dd></div>
              </dl>
            </div>
          )}
        </aside>

        <main className="builder-workspace__canvas">
          {loading && <p className="builder-workspace__loading">Loading builder…</p>}
          {!loading && !isEditor && (
            <div className="builder-workspace__placeholder">
              <h3>Builder: {MENU_MODES.find((mode) => mode.id === menuMode)?.label}</h3>
              <p>Select a record from the list or create a new one to open the editor.</p>
            </div>
          )}
          {!loading && isEditor && (
            <div className="builder-workspace__sections">
              {sectionRows.length === 0 && (
                <p className="builder-list-empty">No sections yet. The full editor will add rows here.</p>
              )}
              {sectionRows.map((section, index) => (
                <SectionSummary key={section.id || `section-${index}`} section={section} index={index} />
              ))}
            </div>
          )}
        </main>

        <aside className="builder-workspace__preview" aria-label="Preview">
          <div className={`builder-preview-frame builder-preview-frame--${previewDevice}`}>
            <div className="builder-preview-frame__chrome">
              {isEditor ? safeText(draft?.name, 120) || 'Preview' : 'Preview'}
            </div>
            <div className="builder-preview-frame__body">
              {isEditor ? (
                sectionRows.map((section, index) => (
                  <div key={section.id || `preview-section-${index}`} className="builder-preview-section">
                    <div className="builder-preview-section__label">
                      {safeText(section.layout, 40) || 'single'}
                    </div>
                  </div>
                ))
              ) : (
                <p className="builder-list-empty">Open a template or page to preview.</p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
