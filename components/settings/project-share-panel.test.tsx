import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SharePagePicker, ShareWithView, pagePickerLabel, readShareState, shareSummaryLine, type ShareState } from './project-share-panel';

/**
 * Settings › Projects › (a project) › Share with. Asserted on rendered markup
 * from props, because the panel itself talks to window.App: every sentence
 * here is one the operator reads to decide what another client can see.
 */

function state(overrides: Partial<ShareState> = {}): ShareState {
  return {
    types: [],
    targets: [],
    pageIds: [],
    pages: [
      { id: 'pg-home', name: 'Home', slug: '' },
      { id: 'pg-about', name: 'About us', slug: 'about' },
    ],
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

  it('counts shared pages beside the types (86bcw3m94)', () => {
    expect(shareSummaryLine(['themes'], 1, 2)).toBe('Themes, 2 pages → 1 project');
    expect(shareSummaryLine([], 2, 1)).toBe('1 page → 2 projects');
    expect(shareSummaryLine([], 0, 3)).toBe('Not shared with any project');
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
    expect(s).toEqual({ types: ['themes'], targets: ['proj-b'], pageIds: [], projects: [{ id: 'proj-b', name: 'B' }], pages: [], canEdit: true });
  });

  it('reads the pages and the shared page ids', () => {
    const s = readShareState({ data: { pageIds: ['pg-1'], pages: [{ id: 'pg-1', name: 'Home', slug: '' }, { name: 'no id' }] } });
    expect(s.pageIds).toEqual(['pg-1']);
    expect(s.pages).toEqual([{ id: 'pg-1', name: 'Home', slug: '' }]);
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

  it('a failed read says it failed — never "no other projects", "only an owner" or "not shared" (86bcvk7uf)', () => {
    const empty: ShareState = { types: [], targets: [], pageIds: [], projects: [], pages: [], canEdit: false };
    const loadError = "Could not read this project's sharing: Sharing is not set up on this database yet";
    for (const open of [true, false]) {
      const html = renderToStaticMarkup(
        <ShareWithView saved={empty} types={[]} targets={[]} open={open} loadError={loadError} />,
      );
      expect(html).toContain('Could not read sharing settings');
      expect(html).not.toContain('You have no other projects to share with.');
      expect(html).not.toContain('Only a project owner can change sharing.');
      expect(html).not.toContain('Not shared with any project');
      if (open) expect(html).toContain('Sharing is not set up on this database yet');
    }
  });

  it('a saved target that is no longer one of the caller’s projects is not counted', () => {
    const html = view(state({ types: ['themes'], targets: ['proj-gone'] }), false);
    expect(html).toContain('Not shared with any project');
  });

  it('a saved page that is no longer in this project is not counted', () => {
    const html = view(state({ targets: ['proj-b'], pageIds: ['pg-gone'] }), false);
    expect(html).toContain('Not shared with any project');
    const counted = view(state({ targets: ['proj-b'], pageIds: ['pg-about', 'pg-gone'] }), false);
    expect(counted).toContain('1 page → 1 project');
  });

  it('expanded: a Pages dropdown under the types, closed, naming what is picked', () => {
    const html = view(state({ pageIds: ['pg-about'] }));
    expect(html).toContain('>Pages<');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('About us');
    // Closed: the list itself is not rendered.
    expect(html).not.toContain('role="listbox"');
  });

  it('a member sees the Pages dropdown disabled with the rest', () => {
    const html = view(state({ canEdit: false }));
    expect(html).toMatch(/project-share-pages-button"[^>]*disabled/);
  });
});

describe('SharePagePicker', () => {
  const pages = [
    { id: 'pg-home', name: 'Home', slug: '' },
    { id: 'pg-about', name: 'About us', slug: 'about' },
    { id: 'pg-faq', name: 'FAQ', slug: 'faq' },
  ];

  it('the closed label: nothing, one page by name, or a count', () => {
    expect(pagePickerLabel(pages, [])).toBe('Choose pages');
    expect(pagePickerLabel(pages, ['pg-faq'])).toBe('FAQ');
    expect(pagePickerLabel(pages, ['pg-faq', 'pg-home'])).toBe('2 pages selected');
    // A page with no name reads the way the Pages dialog reads it, never as its id.
    expect(pagePickerLabel([{ id: '1431', name: '', slug: 'x' }], ['1431'])).toBe('Untitled page');
    // An id that is not one of these pages is not counted.
    expect(pagePickerLabel(pages, ['pg-gone'])).toBe('Choose pages');
  });

  it('open: one checkbox per page, ticked where selected, with its address', () => {
    const html = renderToStaticMarkup(<SharePagePicker pages={pages} selected={['pg-about']} initiallyOpen />);
    expect(html).toContain('aria-multiselectable="true"');
    expect((html.match(/type="checkbox"/g) || []).length).toBe(3);
    expect((html.match(/checked=""/g) || []).length).toBe(1);
    expect(html).toContain('/about');
    expect(html).toContain('/ (home page)');
  });

  it('a project with no pages says so instead of an empty dropdown', () => {
    const html = renderToStaticMarkup(<SharePagePicker pages={[]} selected={[]} />);
    expect(html).toContain('This project has no pages to share yet.');
    expect(html).not.toContain('<button');
  });
});
