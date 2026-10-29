import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShareWithView, readShareState, shareSummaryLine, type ShareState } from './project-share-panel';

/**
 * Settings › Projects › (a project) › Share with. Asserted on rendered markup
 * from props, because the panel itself talks to window.App: every sentence
 * here is one the operator reads to decide what another client can see.
 */

function state(overrides: Partial<ShareState> = {}): ShareState {
  return {
    types: [],
    targets: [],
    projects: [
      { id: 'proj-b', name: 'Delray' },
      { id: 'proj-c', name: 'Marinoff' },
    ],
    canEdit: true,
    ...overrides,
  };
}

function view(saved: ShareState, open = true) {
  return renderToStaticMarkup(
    <ShareWithView saved={saved} types={saved.types} targets={saved.targets} open={open} />,
  );
}

describe('shareSummaryLine', () => {
  it('names the shared types and counts the projects', () => {
    expect(shareSummaryLine(['saved_sections', 'themes'], 2)).toBe('Saved sections, Themes → 2 projects');
    expect(shareSummaryLine(['saved_sections'], 1)).toBe('Saved sections → 1 project');
  });

  it('an empty side on either list is "not shared", never "everything"', () => {
    expect(shareSummaryLine([], 0)).toBe('Not shared with any project');
    expect(shareSummaryLine(['themes'], 0)).toBe('Not shared with any project');
    expect(shareSummaryLine([], 3)).toBe('Not shared with any project');
  });
});

describe('readShareState', () => {
  it('reads the server envelope', () => {
    const s = readShareState({ ok: true, data: { types: ['themes'], targets: ['proj-b'], projects: [{ id: 'proj-b', name: 'B' }], canEdit: true } });
    expect(s).toEqual({ types: ['themes'], targets: ['proj-b'], projects: [{ id: 'proj-b', name: 'B' }], canEdit: true });
  });

  it('a missing canEdit is read-only, not editable', () => {
    expect(readShareState({ data: { types: [] } }).canEdit).toBe(false);
  });
});

describe('ShareWithView', () => {
  it('collapsed: shows only the heading and the summary', () => {
    const html = view(state({ types: ['saved_sections'], targets: ['proj-b'] }), false);
    expect(html).toContain('Share with');
    expect(html).toContain('Saved sections → 1 project');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('What to share');
  });

  it('expanded: both lists, the explanation, and a Save button for an owner', () => {
    const html = view(state());
    expect(html).toContain('Not shared with any project');
    expect(html).toContain('What to share');
    expect(html).toContain('Saved sections');
    expect(html).toContain('Page templates');
    expect(html).toContain('Themes');
    expect(html).toContain('Share with these projects');
    expect(html).toContain('Delray');
    expect(html).toContain('Marinoff');
    expect(html).toContain('Shared items stay in this project. The other project sees them and can import its own copy.');
    expect(html).toContain('>Save<');
    expect(html).not.toContain('Only a project owner');
  });

  it('a member who is not the owner sees the lists disabled, with the reason, and no Save', () => {
    const html = view(state({ canEdit: false }));
    expect(html).toContain('Only a project owner can change sharing.');
    expect((html.match(/<fieldset[^>]*disabled/g) || []).length).toBe(2);
    expect(html).not.toContain('>Save<');
  });

  it('says so when there are no other projects to share with', () => {
    const html = view(state({ projects: [] }));
    expect(html).toContain('You have no other projects to share with.');
  });

  it('a saved target that is no longer one of the caller’s projects is not counted', () => {
    const html = view(state({ types: ['themes'], targets: ['proj-gone'] }), false);
    expect(html).toContain('Not shared with any project');
  });
});
