window.App = window.App || {};

App.richText = (function () {
  function safeHtml(value) {
    return typeof value === 'string' ? value : '';
  }

  function loadTipTapModules() {
    const bundle = window.TipTapBundle;
    if (!bundle || typeof bundle !== 'object') {
      return Promise.reject(new Error('TipTap vendor bundle is not available on window.TipTapBundle'));
    }
    return Promise.resolve(bundle);
  }

  function makeToolbarButton(label, title, command) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'builder-richtext-tool';
    button.textContent = label;
    button.title = title;
    button.setAttribute('data-richtext-command', command);
    return button;
  }

  function getEditorHtml(editor) {
    if (!editor) return '';
    const html = typeof editor.getHTML === 'function' ? editor.getHTML() : '';
    return String(html || '').trim();
  }

  function ensureToolbar(toolbar, editor) {
    if (!toolbar || !editor) return;
    toolbar.innerHTML = '';
    const buttons = [
      ['B', 'Bold', 'bold'],
      ['I', 'Italic', 'italic'],
      ['U', 'Underline', 'underline'],
      ['UL', 'Bullet List', 'bulletList'],
      ['OL', 'Ordered List', 'orderedList'],
      ['H2', 'Heading 2', 'heading2'],
      ['H3', 'Heading 3', 'heading3'],
      ['L', 'Align Left', 'alignLeft'],
      ['C', 'Align Center', 'alignCenter'],
      ['R', 'Align Right', 'alignRight'],
      ['Link', 'Insert Link', 'link'],
      ['Clear', 'Clear Formatting', 'clear'],
    ];

    buttons.forEach(([label, title, command]) => {
      const button = makeToolbarButton(label, title, command);
      button.addEventListener('click', (event) => {
        event.preventDefault();
        if (command === 'link') {
          const previousHref = editor.getAttributes('link')?.href || '';
          const href = window.prompt('Enter link URL', previousHref);
          if (href === null) return;
          if (!String(href).trim()) {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            return;
          }
          editor.chain().focus().extendMarkRange('link').setLink({ href: String(href).trim() }).run();
          return;
        }

        const chain = editor.chain().focus();
        switch (command) {
          case 'bulletList':
            chain.toggleBulletList().run();
            break;
          case 'orderedList':
            chain.toggleOrderedList().run();
            break;
          case 'bold':
            chain.toggleBold().run();
            break;
          case 'italic':
            chain.toggleItalic().run();
            break;
          case 'underline':
            chain.toggleUnderline().run();
            break;
          case 'heading2':
            chain.toggleHeading({ level: 2 }).run();
            break;
          case 'heading3':
            chain.toggleHeading({ level: 3 }).run();
            break;
          case 'alignLeft':
            chain.setTextAlign('left').run();
            break;
          case 'alignCenter':
            chain.setTextAlign('center').run();
            break;
          case 'alignRight':
            chain.setTextAlign('right').run();
            break;
          case 'clear':
            chain.clearNodes().unsetAllMarks().run();
            break;
          default:
            break;
        }
      });
      toolbar.appendChild(button);
    });
  }

  async function createRichTextEditor({ element, toolbar, content = '', placeholder = '' } = {}) {
    if (!element) throw new Error('Rich text element is required');
    if (element._tiptap && typeof element._tiptap.destroy === 'function') {
      element._tiptap.destroy();
      element._tiptap = null;
    }

    const {
      Editor,
      StarterKit,
      Underline,
      Link,
      TextAlign,
    } = await loadTipTapModules();

    element.innerHTML = '';
    element.setAttribute('data-placeholder', placeholder || '');

    const editor = new Editor({
      element,
      content: safeHtml(content) || '<p></p>',
      extensions: [
        StarterKit,
        Underline,
        Link.configure({
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          HTMLAttributes: {
            rel: 'noopener noreferrer nofollow',
            target: '_blank',
          },
        }),
        TextAlign.configure({
          types: ['heading', 'paragraph'],
        }),
      ],
      editorProps: {
        attributes: {
          class: 'builder-richtext-editor ProseMirror',
        },
      },
    });

    ensureToolbar(toolbar, editor);
    element._tiptap = editor;
    return editor;
  }

  function getHtml(element) {
    if (!element) return '';
    if (element._tiptap) return getEditorHtml(element._tiptap);
    return String(element.innerHTML || '').trim();
  }

  return {
    createRichTextEditor,
    getHtml,
    loadTipTapModules,
  };
}());

window.AppRichText = App.richText;
