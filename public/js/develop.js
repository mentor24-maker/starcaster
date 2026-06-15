/**
 * public/js/develop.js
 * Develop menu: Agents, Templates, and Extensions forms for OpenClaw job control.
 */

window.App = window.App || {};
App.develop = (function () {
  const { state, els, api, notify, parseJsonInput, setPreview } = App;
  const LANDING_TEMPLATES = [
    {
      id: 'standard-right-form',
      name: 'Standard Right-Form',
      summary: 'Classic conversion layout with message left, form right, and a clean supporting body section.',
      eyebrow: 'Standard Page Template',
      headline: 'Build a clean, conversion-focused offer page with a form on the right.',
      lead: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
      primaryCta: 'Primary CTA',
      secondaryCta: 'Secondary CTA',
      featureOneTitle: 'Feature One',
      featureOneCopy: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod.',
      featureTwoTitle: 'Feature Two',
      featureTwoCopy: 'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi.',
      formTitle: 'Request More Information',
      formCopy: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
      bodyTitle: 'Lorem Ipsum Content Block',
    },
    {
      id: 'founder-story',
      name: 'Founder Story',
      summary: 'A warm narrative-first template that leads with origin story and trust-building copy.',
      eyebrow: 'Founder-Led Story',
      headline: 'Lead with the founder story, then convert with a focused inquiry form.',
      lead: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
      primaryCta: 'Work With Us',
      secondaryCta: 'Read The Story',
      featureOneTitle: 'Origin Story',
      featureOneCopy: 'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.',
      featureTwoTitle: 'Credibility Layer',
      featureTwoCopy: 'Totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto.',
      formTitle: 'Start The Conversation',
      formCopy: 'Tell us what you are building and what support you need.',
      bodyTitle: 'Founder-Led Narrative',
    },
    {
      id: 'lead-magnet-download',
      name: 'PDF Download',
      summary: 'Optimized for giving away a guide, checklist, or PDF in exchange for lead capture.',
      eyebrow: 'PDF Focus',
      headline: 'Offer a downloadable resource and keep the call-to-action simple.',
      lead: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Excepteur sint occaecat cupidatat non proident.',
      primaryCta: 'Download Now',
      secondaryCta: 'See What’s Inside',
      featureOneTitle: 'Quick Value',
      featureOneCopy: 'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
      featureTwoTitle: 'Fast Conversion',
      featureTwoCopy: 'Sunt in culpa qui officia deserunt mollit anim id est laborum.',
      formTitle: 'Get The PDF',
      formCopy: 'Enter your details and we will send the resource instantly.',
      bodyTitle: 'Resource Overview',
    },
    {
      id: 'webinar-registration',
      name: 'Webinar Registration',
      summary: 'Event-driven template that highlights urgency, speaker value, and a registration form.',
      eyebrow: 'Event Registration',
      headline: 'Promote a webinar, training, or live session with urgency and clarity.',
      lead: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit.',
      primaryCta: 'Reserve My Spot',
      secondaryCta: 'View Agenda',
      featureOneTitle: 'What You’ll Learn',
      featureOneCopy: 'Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur.',
      featureTwoTitle: 'Why Attend Live',
      featureTwoCopy: 'Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae.',
      formTitle: 'Register For The Session',
      formCopy: 'Save your seat and we will send event details to your inbox.',
      bodyTitle: 'Session Details',
    },
    {
      id: 'case-study-showcase',
      name: 'Case Study Showcase',
      summary: 'A proof-oriented template built around outcomes, transformation, and inquiry.',
      eyebrow: 'Results-Driven',
      headline: 'Use a case-study-style page to prove the offer before asking for the lead.',
      lead: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam.',
      primaryCta: 'See The Results',
      secondaryCta: 'Request A Strategy Call',
      featureOneTitle: 'Before / After',
      featureOneCopy: 'Eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.',
      featureTwoTitle: 'Measured Outcome',
      featureTwoCopy: 'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur.',
      formTitle: 'Ask About Your Project',
      formCopy: 'Share a few details and we will outline what this could look like for you.',
      bodyTitle: 'Case Study Breakdown',
    },
    {
      id: 'newsletter-signup',
      name: 'Newsletter Signup',
      summary: 'A lighter, editorial-style layout for list building, content subscriptions, and updates.',
      eyebrow: 'Audience Building',
      headline: 'Grow a newsletter or content list with a cleaner, lower-friction signup page.',
      lead: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. At vero eos et accusamus et iusto odio dignissimos ducimus.',
      primaryCta: 'Join The List',
      secondaryCta: 'Read A Sample',
      featureOneTitle: 'Editorial Promise',
      featureOneCopy: 'Et harum quidem rerum facilis est et expedita distinctio nam libero tempore.',
      featureTwoTitle: 'Reader Benefit',
      featureTwoCopy: 'Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet.',
      formTitle: 'Subscribe For Updates',
      formCopy: 'Add your email to receive ongoing content, offers, and updates.',
      bodyTitle: 'What Subscribers Get',
    },
  ];
  const FORM_TEMPLATES = [
    {
      id: 'squeeze-form',
      name: 'Squeeze Form',
      defaultHeading: 'Get Instant Access',
      defaultSubmitLabel: 'Submit',
      fields: [
        { key: 'first_name', label: 'First Name', type: 'text', required: true },
        { key: 'email', label: 'Email', type: 'email', required: true },
      ],
    },
    {
      id: 'short-form',
      name: 'Short Form',
      defaultHeading: 'Tell Us About Yourself',
      defaultSubmitLabel: 'Send Request',
      fields: [
        { key: 'first_name', label: 'First Name', type: 'text', required: true },
        { key: 'last_name', label: 'Last Name', type: 'text', required: false },
        { key: 'email', label: 'Email', type: 'email', required: true },
        { key: 'phone', label: 'Phone Number', type: 'tel', required: false },
      ],
    },
    {
      id: 'long-form',
      name: 'Long Form',
      defaultHeading: 'Complete The Form',
      defaultSubmitLabel: 'Submit Form',
      fields: [
        { key: 'first_name', label: 'First Name', type: 'text', required: true },
        { key: 'last_name', label: 'Last Name', type: 'text', required: false },
        { key: 'email', label: 'Email', type: 'email', required: true },
        { key: 'phone', label: 'Phone Number', type: 'tel', required: false },
        { key: 'city', label: 'City', type: 'text', required: false },
        { key: 'state', label: 'State', type: 'text', required: false },
        { key: 'country', label: 'Country', type: 'text', required: false },
      ],
    },
  ];
  const CONTACT_TYPE_OPTIONS = [
    { value: 'lead', label: 'Lead' },
    { value: 'prospect', label: 'Prospect' },
    { value: 'subscriber', label: 'Subscriber' },
    { value: 'member', label: 'Member' },
    { value: 'partner', label: 'Partner' },
    { value: 'other', label: 'Other' },
  ];
  const FORM_LEAD_MAGNET_TYPES = [
    { value: 'White Paper', label: 'White Paper' },
    { value: 'Report', label: 'Report' },
    { value: 'Video', label: 'Video' },
    { value: 'Infographic', label: 'Infographic' },
  ];
  const MODULE_TYPE_DEFINITIONS = [
    {
      value: 'header',
      label: 'Header',
      description: 'A reusable heading block for page titles, section headers, and callout headlines.',
      starterName: 'Header',
      defaults: {
        text: 'Section Heading',
        headlineId: '',
        headingLevel: 'H2',
        textColor: '#173c61',
        align: 'left',
      },
      fields: [
        { key: 'text', label: 'Text', control: 'textarea', rows: 3, placeholder: 'Header text', contentSource: 'headline', contentSettingKey: 'headlineId', contentLabel: 'Saved Headline' },
        { key: 'headingLevel', label: 'Heading Level', control: 'select', options: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'] },
        { key: 'textColor', label: 'Text Color', control: 'color' },
        { key: 'align', label: 'Alignment', control: 'select', options: ['left', 'center', 'right'] },
      ],
    },
    {
      value: 'button',
      label: 'Button',
      description: 'A clickable CTA button with label, link, style, sizing, and alignment controls.',
      starterName: 'Button',
      defaults: {
        label: 'Learn More',
        ctaId: '',
        linkUrl: '',
        style: 'solid',
        size: 'medium',
        align: 'left',
        backgroundColor: '#0b82d4',
        textColor: '#ffffff',
        borderRadius: 20,
        fullWidth: false,
        openInNewTab: false,
      },
      fields: [
        { key: 'label', label: 'Label', control: 'text', placeholder: 'Button label', contentSource: 'cta', contentSettingKey: 'ctaId', contentLabel: 'Incentive' },
        { key: 'linkUrl', label: 'Link URL', control: 'text', placeholder: 'https://...' },
        { key: 'style', label: 'Style', control: 'select', options: ['solid', 'outline', 'ghost', 'link'] },
        { key: 'size', label: 'Size', control: 'select', options: ['small', 'medium', 'large'] },
        { key: 'align', label: 'Alignment', control: 'select', options: ['left', 'center', 'right'] },
        { key: 'backgroundColor', label: 'Background Color', control: 'color' },
        { key: 'textColor', label: 'Text Color', control: 'color' },
        { key: 'borderRadius', label: 'Border Radius', control: 'number', min: 0, max: 40, step: 1 },
        { key: 'fullWidth', label: 'Full Width', control: 'checkbox' },
        { key: 'openInNewTab', label: 'Open In New Tab', control: 'checkbox' },
      ],
    },
    {
      value: 'navigation',
      label: 'Navigation',
      description: 'WordPress-style website menu with links, submenus, and theme locations.',
      starterName: 'Main Menu',
      defaults: {
        menuName: 'Main Menu',
        menuLocation: 'primary',
        variant: 'horizontal',
        navItems: App.developNavMenu?.defaultNavMenuItemsJson?.() || '[]',
        navFontSize: 16,
        navBold: false,
        navBorderRadius: 0,
        navPadding: '8px 12px',
        navColor: '#173c61',
        navHoverColor: '#0b82d4',
        navHoverBackground: '#e8f4ff',
        showSubmenuIndicator: true,
      },
      fields: [
        { key: 'menuName', label: 'Menu Name', control: 'text', placeholder: 'Main Menu' },
        { key: 'menuLocation', label: 'Theme Location', control: 'select', options: ['primary', 'footer', 'social'] },
        { key: 'variant', label: 'Layout', control: 'select', options: ['horizontal', 'vertical'] },
        { key: 'navItems', label: 'Menu Structure', control: 'nav-menu-editor' },
        { key: 'navFontSize', label: 'Link Font Size', control: 'number', min: 10, max: 48, step: 1 },
        { key: 'navBold', label: 'Bold Links', control: 'checkbox' },
        { key: 'navBorderRadius', label: 'Link Border Radius', control: 'number', min: 0, max: 48, step: 1 },
        { key: 'navPadding', label: 'Link Padding', control: 'text', placeholder: '8px 12px' },
        { key: 'navColor', label: 'Link Color', control: 'color' },
        { key: 'navHoverColor', label: 'Hover Text Color', control: 'color' },
        { key: 'navHoverBackground', label: 'Hover Background', control: 'color' },
        { key: 'showSubmenuIndicator', label: 'Show Submenu Indicator', control: 'checkbox' },
      ],
    },
    {
      value: 'poll',
      label: 'Poll',
      description: 'An interactive poll module that displays a question from your Polls database.',
      starterName: 'Poll',
      defaults: {
        pollId: '',
        submitLabel: 'Vote',
        showResults: false,
        backgroundColor: '#ffffff',
      },
      fields: [
        { key: 'pollId', label: 'Select Poll', control: 'select', options: [] }, // We will populate this dynamically
        { key: 'submitLabel', label: 'Submit Button Label', control: 'text', placeholder: 'Vote' },
        { key: 'showResults', label: 'Show Results After Voting', control: 'checkbox' },
        { key: 'backgroundColor', label: 'Background Color', control: 'color' },
      ],
    },
    {
      value: 'form',
      label: 'Form',
      description: 'Embed or style a lead-capture form module with form selection and CTA settings.',
      starterName: 'Form',
      defaults: {
        title: 'Request More Information',
        headlineId: '',
        formId: '',
        submitLabel: 'Submit Form',
        width: 'standard',
        backgroundColor: '#f5fbff',
      },
      fields: [
        { key: 'title', label: 'Title', control: 'text', placeholder: 'Form title', contentSource: 'headline', contentSettingKey: 'headlineId', contentLabel: 'Saved Headline' },
        { key: 'formId', label: 'Saved Form', control: 'saved-form-picker' },
        { key: 'submitLabel', label: 'Submit Label', control: 'text', placeholder: 'Submit Form' },
        { key: 'width', label: 'Width', control: 'select', options: ['compact', 'standard', 'wide', 'full'] },
        { key: 'backgroundColor', label: 'Background Color', control: 'color' },
      ],
    },
    {
      value: 'image',
      label: 'Image',
      description: 'A flexible image block with linking, sizing, and overlay treatment controls.',
      starterName: 'Image',
      defaults: {
        imageAssetId: '',
        imageUrl: '',
        altText: 'Image',
        linkUrl: '',
        maxWidth: 100,
        maxWidthPx: 0,
        overlayOpacity: 0,
        aspectRatio: 'auto',
      },
      fields: [
        { key: 'imageAssetId', label: 'Gallery Image', control: 'image-asset-picker', pickerTitle: 'Module Image' },
        { key: 'imageUrl', label: 'Manual Image URL', control: 'text', placeholder: 'https://...' },
        { key: 'altText', label: 'Alt Text', control: 'text', placeholder: 'Describe the image' },
        { key: 'linkUrl', label: 'Link URL', control: 'text', placeholder: 'https://...' },
        { key: 'maxWidth', label: 'Max Width %', control: 'number', min: 10, max: 100, step: 5 },
        { key: 'maxWidthPx', label: 'Max Width px (Overrides %)', control: 'number', min: 0, max: 2000, step: 10 },
        { key: 'overlayOpacity', label: 'Overlay Opacity', control: 'number', min: 0, max: 100, step: 5 },
        { key: 'aspectRatio', label: 'Aspect Ratio', control: 'select', options: ['auto', '16:9', '4:3', '3:2', '1:1', '9:16'] },
      ],
    },
    {
      value: 'video',
      label: 'Video',
      description: 'A video block with source, poster, playback, and aspect-ratio controls.',
      starterName: 'Video',
      defaults: {
        videoAssetId: '',
        videoUrl: '',
        posterAssetId: '',
        posterUrl: '',
        aspectRatio: '16:9',
        autoplay: false,
        muted: true,
        controls: true,
      },
      fields: [
        { key: 'videoAssetId', label: 'Gallery Video', control: 'video-asset-picker', pickerTitle: 'Module Video' },
        { key: 'videoUrl', label: 'Video URL', control: 'text', placeholder: 'https://...' },
        { key: 'posterAssetId', label: 'Poster Image', control: 'image-asset-picker', pickerTitle: 'Video Poster' },
        { key: 'posterUrl', label: 'Poster URL', control: 'text', placeholder: 'https://...' },
        { key: 'aspectRatio', label: 'Aspect Ratio', control: 'select', options: ['16:9', '4:3', '1:1', '9:16'] },
        { key: 'autoplay', label: 'Autoplay', control: 'checkbox' },
        { key: 'muted', label: 'Muted', control: 'checkbox' },
        { key: 'controls', label: 'Show Controls', control: 'checkbox' },
      ],
    },
    {
      value: 'table',
      label: 'Table',
      description: 'A presentation-ready table block for charts, pricing grids, and structured tabular data.',
      starterName: 'Table',
      defaults: {
        caption: '',
        headlineId: '',
        columnsCount: 3,
        rowsCount: 4,
        tableContents: '[]',
        headerColor: '#173c61',
        headerTextColor: '#ffffff',
        borderColor: '#d6e6f5',
        borderThickness: 1,
        cellPadding: 14,
        striped: true,
        compact: false,
        style: 'clean',
      },
      fields: [
        { key: 'caption', label: 'Caption', control: 'text', placeholder: 'Table caption', contentSource: 'headline', contentSettingKey: 'headlineId', contentLabel: 'Saved Headline' },
        { key: 'columnsCount', label: 'Columns', control: 'number', min: 1, max: 8, step: 1 },
        { key: 'rowsCount', label: 'Rows', control: 'number', min: 1, max: 20, step: 1 },
        { key: 'tableContents', label: 'Contents', control: 'table-contents-editor' },
        { key: 'headerColor', label: 'Header Color', control: 'color', allowTransparent: true },
        { key: 'headerTextColor', label: 'Header Text Color', control: 'color' },
        { key: 'borderColor', label: 'Border Color', control: 'color', allowTransparent: true },
        { key: 'borderThickness', label: 'Border Thickness', control: 'number', min: 0, max: 8, step: 1 },
        { key: 'cellPadding', label: 'Cell Padding', control: 'number', min: 4, max: 40, step: 1 },
        { key: 'style', label: 'Style', control: 'select', options: ['clean', 'boxed', 'minimal', 'editorial'] },
        { key: 'striped', label: 'Striped Rows', control: 'checkbox' },
        { key: 'compact', label: 'Compact', control: 'checkbox' },
      ],
    },
    {
      value: 'textarea',
      label: 'Text Block',
      description: 'A rich text content block for body copy, commentary, and formatted editorial content.',
      starterName: 'Text Block',
      defaults: {
        content: '<p>Write your content here.</p>',
        pitchId: '',
        textAlign: 'left',
        textColor: '#173c61',
        background: {
          mode: 'color',
          color: '#ffffff',
          color2: '#eaf4ff',
          imageUrl: '',
          imageAssetId: '',
          styleKey: '',
        },
        backgroundColor: '#ffffff',
        maxWidth: 'full',
      },
      fields: [
        { key: 'content', label: 'Content', control: 'richtext', rows: 8, placeholder: '<p>Write your content here.</p>', contentSource: 'pitch', contentSettingKey: 'pitchId', contentLabel: 'Saved Pitch' },
        { key: 'textAlign', label: 'Text Alignment', control: 'select', options: ['left', 'center', 'right'] },
        { key: 'textColor', label: 'Text Color', control: 'color' },
        { key: 'background', label: 'Background', control: 'modular-background' },
        { key: 'maxWidth', label: 'Width', control: 'select', options: ['compact', 'standard', 'wide', 'full'] },
      ],
    },
    {
      value: 'pod',
      label: 'Channel Pod',
      description: 'A stylized 20px radius card with a brand logo, title, and description designed for the Acquire Hub.',
      starterName: 'Channel Pod',
      defaults: {
        title: 'Channel Name',
        description: 'Channel description text goes here.',
        logoUrl: '/images/logos/web.svg',
        targetPage: '',
      },
      fields: [
        { key: 'title', label: 'Title', control: 'text', placeholder: 'Channel Name' },
        { key: 'description', label: 'Description', control: 'textarea', rows: 2, placeholder: 'Brief description' },
        { key: 'logoUrl', label: 'Logo URL', control: 'text', placeholder: '/images/logos/...' },
        { key: 'targetPage', label: 'Target Page ID', control: 'text', placeholder: 'e.g., acquireWebPage' },
      ],
    },
  ];
  let selectedTemplateId = LANDING_TEMPLATES[0].id;
  let selectedFormTemplateId = FORM_TEMPLATES[0].id;
  let selectedEmailTemplateId = '';
  let savedThemes = [];
  let selectedThemeId = '';
  let formBuilderState = null;
  const DEFAULT_FORM_ACCENT = '#0b82d4';
  const MATCH_LANDING_GREY = '#6b7280';
  const DEFAULT_LANDING_PRIMARY = '#0b82d4';
  const DEFAULT_LANDING_BACKGROUND = '#f5fbff';
  const DEFAULT_LANDING_ACCENT = '#1a4f81';
  let landingPageColors = {
    primary: DEFAULT_LANDING_PRIMARY,
    background: DEFAULT_LANDING_BACKGROUND,
    accent: DEFAULT_LANDING_ACCENT,
  };
  let savedForms = [];
  let savedModules = [];
  let savedModuleClasses = [];
  let savedLandingPages = [];
  let savedPageTemplates = [];
  let modularPageTemplateDraft = null;
  let draggedNewPageSectionLayout = '';
  let draggedNewPageSectionLayoutClearTimer = null;
  let activePageLayoutPointerDrag = null;
  let suppressLayoutTileClickUntil = 0;
  let activePageModulePointerDrag = null;
  let activePlacedPageModulePointerDrag = null;
  let activeModularPageModulePicker = null;
  let activeModularPageModuleEditor = null;
  let activeModularContainerEditor = null;
  let activeModularRowEditor = null;
  let modularPageEditorMode = 'template';
  let modularPageEditorSourceTemplateId = '';
  let modularPageEditorOptions = null;
  let savedExtensions = [];
  let savedEmailTemplates = [];
  let savedAgents = [];
  let emailTemplateBlocksDraft = [];
  let landingPageHeadlines = [];
  let landingPageSubheadings = [];
  let landingPagePitches = [];
  let landingPageCtas = [];
  const landingPageSelectorFilterState = {};
  let pendingLandingPageFormRecord = null;
  let selectedLandingPageIds = new Set();
  let activeLandingPagePreviewRecord = null;
  let activeLandingPagePreviewMode = 'page';
  let activeLandingPageVisualRecord = null;
  let activeLandingPageVisualMode = 'page';
  let landingPageVisualEditMode = true;
  let landingPageVisualDraft = {};
  let landingPageThankYouState = null;
  const activeLandingPageVisualEditors = new Set();
  const collapsedExtensionIds = new Set();
  const formTableState = {
    sort: {
      key: 'updatedAt',
      dir: 'desc',
    },
  };

  function getEmailTemplatesByKind(kind) {
    const normalized = safeText(kind).toLowerCase();
    return savedEmailTemplates.filter((template) => {
      const templateKind = safeText(template?.templateKind).toLowerCase() || 'text';
      return normalized ? templateKind === normalized : true;
    });
  }

  function getThemeById(themeId) {
    const id = safeText(themeId);
    return savedThemes.find((item) => String(item.id) === id) || null;
  }
  const landingPageTableState = {
    filters: {
      name: '',
      templateId: '',
    },
    sort: {
      key: 'updatedAt',
      dir: 'desc',
    },
  };
  const EXTENSION_TYPE_OPTIONS = [
    { value: 'manager', label: 'Manager' },
    { value: 'utility', label: 'Utility' },
    { value: 'generator', label: 'Generator' },
    { value: 'connector', label: 'Connector' },
    { value: 'workflow', label: 'Workflow' },
    { value: 'automation', label: 'Automation' },
    { value: 'analytics', label: 'Analytics' },
    { value: 'catalog', label: 'Catalog' },
    { value: 'custom', label: 'Custom' },
  ];
  const extensionTableState = {
    filters: {
      name: '',
      extensionType: '',
      status: '',
      tags: '',
    },
    sort: {
      key: 'updatedAt',
      dir: 'desc',
    },
  };
  const LANDING_THANK_YOU_STATE_KEY = 'develop_landing_thank_you_state_v1';
  const SAVED_AGENTS_STORAGE_KEY = 'develop_saved_agents_v1';
  let extensionManagerConfig = {
    defaultFilters: {},
    defaultSortKey: 'updatedAt',
    defaultSortDir: 'desc',
  };

  function safeText(value) {
    return String(value || '').trim();
  }

  function safeNumericSetting(value, fallback = '') {
    if (value === 0 || value === '0') return '0';
    const parsed = safeText(value, 20);
    return parsed === '' ? fallback : parsed;
  }

  function escapeHtml(value) {
    return safeText(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeHtml(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function getModularTextBlockHtml(module) {
    return safeHtml(module?.settings?.content)
      || safeHtml(module?.settings?.text)
      || escapeHtml(safeText(module?.text));
  }

  function isModularTextBlockModule(module) {
    const type = safeText(module?.type).toLowerCase();
    if (type === 'textarea') return true;
    if (type !== 'text') return false;
    const settings = module?.settings && typeof module.settings === 'object' ? module.settings : {};
    return Boolean(
      safeHtml(settings.content)
      || safeText(settings.textAlign)
      || safeText(settings.maxWidth)
    );
  }

  function buildModularTextBlockInlineStyle(settings) {
    const next = settings && typeof settings === 'object' ? settings : {};
    const style = {};
    if (next.textColor) style.color = safeText(next.textColor);
    if (next.textAlign) style.textAlign = safeText(next.textAlign);
    const bg = normalizeBackgroundSettings(next.background, next.backgroundColor, next.backgroundImageId);
    Object.assign(style, getBuilderBackgroundCssStyle(bg));
    if (bg.mode !== 'none') {
      style.padding = '0.5rem 0.75rem';
      style.borderRadius = '12px';
    }
    return styleObjectToCssText(style);
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function setThemesBuilderVisible(visible) {
    const panel = byId('developThemesBuilderPanel');
    const toggle = byId('developThemesBuilderToggleBtn');
    if (panel) panel.classList.toggle('hidden', !visible);
    if (toggle) {
      toggle.setAttribute('aria-expanded', visible ? 'true' : 'false');
    }
  }

  function openThemesPage() {
    setThemesBuilderVisible(false);
    App.setActivePage('developThemesPage');
    refresh().catch((err) => notify(err.message || 'Unable to load themes', true));
  }

  function openThemesBuilder() {
    App.setActivePage('developThemesPage');
    setThemesBuilderVisible(true);
    const panel = byId('developThemesBuilderPanel');
    if (panel && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function openAgentsPage() {
    setAgentsBuilderVisible(false);
    App.setActivePage('developAgentsPage');
    refresh().catch((err) => notify(err.message || 'Unable to load agents page', true));
  }

  function setAgentsBuilderVisible(visible) {
    const panel = byId('developAgentsBuilderPanel');
    if (panel) panel.classList.toggle('hidden', !visible);
  }

  function nextLocalId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function loadSavedAgents() {
    try {
      const raw = String(window.localStorage.getItem(SAVED_AGENTS_STORAGE_KEY) || '').trim();
      if (!raw) {
        savedAgents = [];
        return;
      }
      const parsed = JSON.parse(raw);
      savedAgents = Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      savedAgents = [];
    }
  }

  function persistSavedAgents() {
    try {
      window.localStorage.setItem(SAVED_AGENTS_STORAGE_KEY, JSON.stringify(savedAgents));
    } catch (_) {}
  }

  function getAgentFormPayload() {
    const form = els.developAgentsForm;
    const formData = new FormData(form);
    return {
      id: safeText(formData.get('agent_preset_id')),
      name: safeText(formData.get('agent_name')),
      action: safeText(formData.get('action')) || 'create_job',
      job_id: safeText(formData.get('job_id')),
      workspace_id: safeText(formData.get('workspace_id')) || 'alphire-main',
      type: safeText(formData.get('type')) || 'acquire.web',
      requested_by_user_id: safeText(formData.get('requested_by_user_id')) || 'alphire-ui',
      requested_by_email: safeText(formData.get('requested_by_email')) || 'ops@alphire.ai',
      payload_json: String(formData.get('payload_json') || '').trim() || '{"source_urls":[],"max_pages":20}',
      approval_decision: safeText(formData.get('approval_decision')) || 'APPROVE',
      approval_token: safeText(formData.get('approval_token')),
      approval_comment: safeText(formData.get('approval_comment')),
      manual_confirmed: formData.get('manual_confirmed') === 'on',
    };
  }

  function populateAgentForm(record) {
    const form = els.developAgentsForm;
    if (!form || !record) return;
    const setValue = (name, value) => {
      const field = form.elements.namedItem(name);
      if (!field) return;
      if (field.type === 'checkbox') {
        field.checked = Boolean(value);
      } else {
        field.value = String(value || '');
      }
    };
    setValue('agent_preset_id', record.id);
    setValue('agent_name', record.name);
    setValue('action', record.action);
    setValue('job_id', record.job_id);
    setValue('workspace_id', record.workspace_id);
    setValue('type', record.type);
    setValue('requested_by_user_id', record.requested_by_user_id);
    setValue('requested_by_email', record.requested_by_email);
    setValue('payload_json', record.payload_json);
    setValue('approval_decision', record.approval_decision);
    setValue('approval_token', record.approval_token);
    setValue('approval_comment', record.approval_comment);
    setValue('manual_confirmed', record.manual_confirmed);
  }

  function resetAgentsForm() {
    if (els.developAgentsForm) els.developAgentsForm.reset();
    const presetId = byId('developAgentPresetIdInput');
    const nameInput = byId('developAgentNameInput');
    if (presetId) presetId.value = '';
    if (nameInput) nameInput.value = '';
    const actionSelect = byId('agentsActionSelect');
    if (actionSelect) actionSelect.value = 'agent_api_setup_orchestrator';
    const workspaceField = els.developAgentsForm?.elements?.namedItem('workspace_id');
    const typeField = els.developAgentsForm?.elements?.namedItem('type');
    const requestedById = els.developAgentsForm?.elements?.namedItem('requested_by_user_id');
    const requestedByEmail = els.developAgentsForm?.elements?.namedItem('requested_by_email');
    const payload = els.developAgentsForm?.elements?.namedItem('payload_json');
    if (workspaceField) workspaceField.value = 'alphire-main';
    if (typeField) typeField.value = 'acquire.web';
    if (requestedById) requestedById.value = 'alphire-ui';
    if (requestedByEmail) requestedByEmail.value = 'ops@alphire.ai';
    if (payload) payload.value = '{"source_urls":[],"max_pages":20}';
  }

  function renderSavedAgentsTable() {
    const body = byId('developAgentsTableBody');
    if (!body) return;
    if (!savedAgents.length) {
      body.textContent = '';
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.className = 'meta';
      td.textContent = 'No saved agents yet.';
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }
    body.textContent = '';
    savedAgents
      .slice()
      .sort((a, b) => String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')))
      .forEach((item) => {
        const row = document.createElement('tr');
        
        const tdName = document.createElement('td');
        tdName.textContent = safeText(item.name) || 'Untitled Agent';
        row.appendChild(tdName);
        
        const tdAction = document.createElement('td');
        tdAction.textContent = safeText(item.action) || '-';
        row.appendChild(tdAction);
        
        const tdWorkspace = document.createElement('td');
        tdWorkspace.textContent = safeText(item.workspace_id) || '-';
        row.appendChild(tdWorkspace);
        
        const tdType = document.createElement('td');
        tdType.textContent = safeText(item.type) || '-';
        row.appendChild(tdType);
        
        const tdUpdated = document.createElement('td');
        tdUpdated.textContent = safeText(item.updatedAt) || '-';
        row.appendChild(tdUpdated);
        
        const actions = document.createElement('td');
        actions.className = 'develop-agents-actions-cell';
        row.appendChild(actions);
        
        if (actions) {
          actions.appendChild(App.makeIconButton('edit', 'Edit Agent', () => {
            populateAgentForm(item);
            setAgentsBuilderVisible(true);
            const panel = byId('developAgentsBuilderPanel');
            if (panel && typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }));
          actions.appendChild(App.makeIconButton('copy', 'Clone Agent', () => {
            const clone = { ...item, id: '', name: `${safeText(item.name) || 'Agent'} Copy` };
            populateAgentForm(clone);
            const presetId = byId('developAgentPresetIdInput');
            if (presetId) presetId.value = '';
            setAgentsBuilderVisible(true);
          }));
          actions.appendChild(App.makeIconButton('delete', 'Delete Agent', () => {
            if (!window.confirm(`Delete agent "${safeText(item.name) || 'Untitled Agent'}"?`)) return;
            savedAgents = savedAgents.filter((entry) => safeText(entry.id) !== safeText(item.id));
            persistSavedAgents();
            renderSavedAgentsTable();
            notify('Agent deleted');
          }));
        }
        body.appendChild(row);
      });
  }

  function saveAgentPresetFromForm({ clone = false } = {}) {
    const payload = getAgentFormPayload();
    if (!payload.name) throw new Error('Agent name is required');
    const now = new Date().toISOString();
    const nextIdValue = clone || !payload.id ? nextLocalId('agent') : payload.id;
    const record = {
      ...payload,
      id: nextIdValue,
      updatedAt: now,
      createdAt: clone || !payload.id
        ? now
        : (savedAgents.find((entry) => safeText(entry.id) === safeText(payload.id))?.createdAt || now),
    };
    const existingIndex = savedAgents.findIndex((entry) => safeText(entry.id) === safeText(payload.id));
    if (!clone && existingIndex >= 0) savedAgents.splice(existingIndex, 1, record);
    else savedAgents.unshift(record);
    persistSavedAgents();
    renderSavedAgentsTable();
    populateAgentForm(record);
    const presetId = byId('developAgentPresetIdInput');
    if (presetId) presetId.value = record.id;
    notify(clone ? 'Agent cloned' : (existingIndex >= 0 ? 'Agent updated' : 'Agent saved'));
  }

  function openAgentsCreate() {
    App.setActivePage('developAgentsPage');
    resetAgentsForm();
    setAgentsBuilderVisible(true);
    const panel = byId('developAgentsBuilderPanel');
    if (panel && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function slugify(value) {
    return safeText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120);
  }

  function setSelectOptions(select, options, placeholder, currentValue) {
    if (!select) return;
    const desired = String(currentValue || '');
    select.textContent = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder;
    select.appendChild(first);

    (Array.isArray(options) ? options : []).forEach((item) => {
      const option = document.createElement('option');
      option.value = String(item.value);
      option.textContent = item.label;
      select.appendChild(option);
    });

    if (desired && Array.from(select.options).some((option) => option.value === desired)) {
      select.value = desired;
    }
  }

  function assetLabel(asset, fallbackLabel) {
    return safeText(asset?.assetName) || fallbackLabel;
  }

  function isValidUrl(value) {
    const text = safeText(value);
    if (!text) return false;
    try {
      const parsed = new URL(text);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function extractDriveId(url) {
    const text = safeText(url);
    if (!text) return '';
    const byProxyPath = text.match(/\/api\/assets\/drive-file\/([a-zA-Z0-9_-]{10,})/);
    if (byProxyPath) return byProxyPath[1];
    const byProxyPathNoLeadingSlash = text.match(/^api\/assets\/drive-file\/([a-zA-Z0-9_-]{10,})/);
    if (byProxyPathNoLeadingSlash) return byProxyPathNoLeadingSlash[1];
    const byPath = text.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    if (byPath) return byPath[1];
    if (/^[a-zA-Z0-9_-]{10,}$/.test(text)) return text;
    try {
      const parsed = new URL(text);
      const byParam = parsed.searchParams.get('id');
      if (byParam) return byParam;
      const byPathInUrl = parsed.pathname.match(/\/api\/assets\/drive-file\/([a-zA-Z0-9_-]{10,})/);
      if (byPathInUrl) return byPathInUrl[1];
      return '';
    } catch {
      return '';
    }
  }

  function toDirectAssetUrl(url) {
    const text = safeText(url);
    if (!text) return '';
    if (text.startsWith('/api/assets/drive-file/')) return text;
    if (text.startsWith('api/assets/drive-file/')) return `/${text}`;
    const driveId = extractDriveId(text);
    if (driveId) return `/api/assets/drive-file/${encodeURIComponent(driveId)}`;
    if (isValidUrl(text)) return text;
    if (text.startsWith('/')) return text;
    return text;
  }

  function isDirectVideoMediaUrl(url) {
    const text = safeText(url);
    if (!text) return false;
    if (text.startsWith('/api/assets/drive-file/')) return true;
    if (text.includes('.public.blob.vercel-storage.com/')) return true;
    return /(\.mp4|\.webm|\.ogg|\.mov|\.m4v)(\?|#|$)/i.test(text);
  }

  function getEmbeddableVideoUrl(url) {
    const text = safeText(url);
    if (!text) return '';
    try {
      const parsed = new URL(text, window.location.origin);
      const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
      if (host === 'youtube.com' || host === 'm.youtube.com') {
        const id = parsed.searchParams.get('v');
        return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}` : '';
      }
      if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts[0] === 'embed' && parts[1]) return `https://www.youtube.com/embed/${encodeURIComponent(parts[1])}`;
        if (parts[0] === 'shorts' && parts[1]) return `https://www.youtube.com/embed/${encodeURIComponent(parts[1])}`;
        if (parts[0] === 'live' && parts[1]) return `https://www.youtube.com/embed/${encodeURIComponent(parts[1])}`;
      }
      if (host === 'youtu.be') {
        const id = parsed.pathname.replace(/^\/+/, '').split('/')[0];
        return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}` : '';
      }
      if (host === 'youtube-nocookie.com') {
        return text;
      }
      if (host === 'vimeo.com' || host === 'player.vimeo.com') {
        const parts = parsed.pathname.split('/').filter(Boolean);
        const id = parts.pop();
        return id ? `https://player.vimeo.com/video/${encodeURIComponent(id)}` : '';
      }
    } catch {
      return '';
    }
    return '';
  }

  function buildResponsiveVideoMarkup(content, options = {}) {
    const assetUrl = safeText(content?.assetUrl);
    const posterAttr = content?.posterUrl ? ` poster="${escapeHtml(content.posterUrl)}"` : '';
    const autoplayAttr = content?.autoplay ? ' autoplay' : '';
    const mutedAttr = content?.muted ? ' muted' : '';
    const controlsAttr = content?.controls ? ' controls' : '';
    const className = safeText(options.className);
    const classAttr = className ? ` class="${escapeHtml(className)}"` : '';
    const embedUrl = getEmbeddableVideoUrl(assetUrl);
    if (embedUrl) {
      return `<iframe${classAttr} src="${escapeHtml(embedUrl)}" title="${escapeHtml(content?.assetName || 'Video')}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
    }
    if (isDirectVideoMediaUrl(assetUrl)) {
      return `<video${classAttr} src="${escapeHtml(assetUrl)}"${posterAttr}${autoplayAttr}${mutedAttr}${controlsAttr}></video>`;
    }
    return `<div class="develop-template-empty-slot">${escapeHtml(content?.assetName || 'No video selected')}</div>`;
  }

  function getAssetsByType(assetType) {
    return (Array.isArray(state.assets) ? state.assets : []).filter(
      (asset) => safeText(asset?.assetType) === safeText(assetType)
    );
  }

  function getFormLeadMagnetTypeDisplayLabel(type) {
    const value = safeText(type);
    const match = FORM_LEAD_MAGNET_TYPES.find((item) => safeText(item.value) === value);
    return match ? match.label : getAssetTypeDisplayLabel(value);
  }

  function getFormLeadMagnetTypeOptions(currentType) {
    const rows = FORM_LEAD_MAGNET_TYPES.map((item) => ({ value: item.value, label: item.label }));
    const legacy = safeText(currentType);
    if (legacy && !rows.some((item) => safeText(item.value) === legacy)) {
      rows.push({ value: legacy, label: getFormLeadMagnetTypeDisplayLabel(legacy) });
    }
    return rows;
  }

  function assetMatchesFormLeadMagnetType(asset, leadMagnetType) {
    const type = safeText(leadMagnetType);
    const assetType = safeText(asset?.assetType);
    const category = safeText(asset?.category);
    if (!type) return true;
    if (type === 'White Paper') {
      return (assetType === 'Lead Magnet' || assetType === 'File') && category === 'White Paper';
    }
    if (type === 'Report') {
      return (assetType === 'Lead Magnet' || assetType === 'File') && category === 'Report';
    }
    if (type === 'Video') {
      return assetType === 'Video';
    }
    if (type === 'Infographic') {
      return assetType === 'Image' && category === 'Infographic';
    }
    return assetType === type || category === type;
  }

  function getAssetTypeDisplayLabel(assetType) {
    return safeText(assetType) === 'Lead Magnet' ? 'PDF' : safeText(assetType);
  }

  function setThemeStatus(message, isError = false) {
    const node = byId('developThemesStatusMsg');
    if (!node) return;
    const text = safeText(message, 500);
    node.textContent = text;
    node.classList.toggle('hidden', !text);
    node.classList.toggle('error', Boolean(text && isError));
  }

  function getThemeImageAssets() {
    return getAssetsByType('Image');
  }

  const THEME_ASSET_PICKERS = {
    developThemesLogoWideSelect: {
      selectId: 'developThemesLogoWideSelect',
      buttonId: 'developThemesLogoWidePickerBtn',
      previewId: 'developThemesLogoWidePreview',
      title: 'Logo - Wide',
      category: 'Logo - Wide',
      categories: ['Logo - Wide'],
      tags: ['theme', 'logo-wide', 'builder'],
    },
    developThemesLogoSquareSelect: {
      selectId: 'developThemesLogoSquareSelect',
      buttonId: 'developThemesLogoSquarePickerBtn',
      previewId: 'developThemesLogoSquarePreview',
      title: 'Logo - Square',
      category: 'Logo - Square',
      categories: ['Logo - Square', 'Square Logo'],
      tags: ['theme', 'logo-square', 'builder'],
    },
    developThemesFeatureImageSelect: {
      selectId: 'developThemesFeatureImageSelect',
      buttonId: 'developThemesFeatureImagePickerBtn',
      previewId: 'developThemesFeatureImagePreview',
      title: 'Feature Image',
      category: 'Feature Image',
      categories: ['Feature Image', 'Feature', 'Feature Graphic', 'Featured Image'],
      tags: ['theme', 'feature-image', 'builder'],
    },
    developThemesBackgroundImageSelect: {
      selectId: 'developThemesBackgroundImageSelect',
      buttonId: 'developThemesBackgroundImagePickerBtn',
      previewId: 'developThemesBackgroundImagePreview',
      title: 'Background Image',
      category: 'Background Image',
      categories: ['Background Image'],
      tags: ['theme', 'background-image', 'builder'],
    },
  };

  const LANDING_IMAGE_PICKERS = {
    developLandingBannerImageSelect: {
      selectId: 'developLandingBannerImageSelect',
      fieldKey: 'websiteBannerImageId',
      buttonId: 'developLandingBannerImagePickerBtn',
      previewId: 'developLandingBannerImagePreview',
      title: 'Website Banner Image',
      category: 'Banner Image',
      categories: ['Banner Image', 'Website Banner', 'Website Banner Image', 'Hero Banner', 'Article Banner'],
      tags: ['landing-page', 'website-banner', 'builder'],
    },
    developLandingBackgroundImageSelect: {
      selectId: 'developLandingBackgroundImageSelect',
      fieldKey: 'backgroundImageId',
      buttonId: 'developLandingBackgroundImagePickerBtn',
      previewId: 'developLandingBackgroundImagePreview',
      title: 'Background Image',
      category: 'Background Image',
      categories: ['Background Image'],
      tags: ['landing-page', 'background-image', 'builder'],
    },
    developLandingFeatureImageSelect: {
      selectId: 'developLandingFeatureImageSelect',
      fieldKey: 'featureImageId',
      buttonId: 'developLandingFeatureImagePickerBtn',
      previewId: 'developLandingFeatureImagePreview',
      title: 'Feature Image',
      category: 'Feature Image',
      categories: ['Feature Image', 'Feature', 'Feature Graphic', 'Featured Image'],
      tags: ['landing-page', 'feature-image', 'builder'],
    },
    developLandingHighlightImageSelect: {
      selectId: 'developLandingHighlightImageSelect',
      fieldKey: 'highlightImageId',
      buttonId: 'developLandingHighlightImagePickerBtn',
      previewId: 'developLandingHighlightImagePreview',
      title: 'Highlight Image',
      category: 'Highlight Image',
      categories: ['Highlight Image', 'Highlight'],
      tags: ['landing-page', 'highlight-image', 'builder'],
    },
    developLandingLogoSquareSelect: {
      selectId: 'developLandingLogoSquareSelect',
      fieldKey: 'logoSquareId',
      buttonId: 'developLandingLogoSquarePickerBtn',
      previewId: 'developLandingLogoSquarePreview',
      title: 'Logo - Square',
      category: 'Logo - Square',
      categories: ['Logo - Square', 'Square Logo'],
      tags: ['landing-page', 'logo-square', 'builder'],
    },
    developLandingLogoWideSelect: {
      selectId: 'developLandingLogoWideSelect',
      fieldKey: 'logoWideId',
      buttonId: 'developLandingLogoWidePickerBtn',
      previewId: 'developLandingLogoWidePreview',
      title: 'Logo - Wide',
      category: 'Logo - Wide',
      categories: ['Logo - Wide', 'Wide Logo'],
      tags: ['landing-page', 'logo-wide', 'builder'],
    },
  };

  function isLandingImageFieldKey(fieldKey) {
    return [
      'websiteBannerImageId',
      'backgroundImageId',
      'featureImageId',
      'highlightImageId',
      'logoSquareId',
      'logoWideId',
    ].includes(safeText(fieldKey));
  }

  function isLandingImageSelectId(selectId) {
    return Boolean(LANDING_IMAGE_PICKERS[safeText(selectId)]);
  }

  function getImagePickerConfig(selectId) {
    const key = String(selectId || '').trim();
    return THEME_ASSET_PICKERS[key] || LANDING_IMAGE_PICKERS[key] || null;
  }

  function resolveImagePickerConfig(target) {
    if (!target) return null;
    if (typeof target === 'string') return getImagePickerConfig(target);
    if (typeof target === 'object' && !Array.isArray(target)) return target;
    return null;
  }

  function getThemePickerConfig(selectId) {
    return THEME_ASSET_PICKERS[String(selectId || '').trim()] || null;
  }

  function normalizeAssetFilterToken(value) {
    return safeText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function getAssetTagText(asset) {
    return Array.isArray(asset?.tags)
      ? asset.tags.map((item) => safeText(item)).filter(Boolean).join(' ')
      : safeText(asset?.tags).replace(/[;,]+/g, ' ');
  }

  function assetMatchesPickerContext(asset, config) {
    if (!asset || !config) return false;
    const category = normalizeAssetFilterToken(asset?.category);
    const haystack = [
      category,
      normalizeAssetFilterToken(asset?.assetName),
      normalizeAssetFilterToken(asset?.location),
      normalizeAssetFilterToken(getAssetTagText(asset)),
    ].join(' ').trim();
    const allowedCategories = (config?.categories || []).map((item) => normalizeAssetFilterToken(item)).filter(Boolean);
    const contextTags = (config?.tags || []).map((item) => normalizeAssetFilterToken(item)).filter(Boolean);
    if (allowedCategories.some((value) => value && (category === value || haystack.includes(value)))) {
      return true;
    }
    if (contextTags.some((value) => value && haystack.includes(value))) {
      return true;
    }
    return false;
  }

  function getImagePickerAssets(selectId, currentValue = '') {
    const config = getImagePickerConfig(selectId);
    const currentId = safeText(currentValue);
    const rows = getThemeImageAssets().filter((asset) => {
      if (!config) return true;
      return assetMatchesPickerContext(asset, config);
    });
    if (currentId && !rows.some((asset) => String(asset.id) === currentId)) {
      const currentAsset = (Array.isArray(state.assets) ? state.assets : []).find((asset) => String(asset.id) === currentId);
      if (currentAsset && safeText(currentAsset.assetType) === 'Image') rows.unshift(currentAsset);
    }
    return rows;
  }

  function getThemePickerAssets(selectId, currentValue = '') {
    return getImagePickerAssets(selectId, currentValue);
  }

  function renderThemeAssetPickerDisplay(selectId) {
    const config = getImagePickerConfig(selectId);
    if (!config) return;
    const select = byId(config.selectId);
    const button = byId(config.buttonId);
    const preview = byId(config.previewId);
    const selectedId = safeText(select?.value);
    const asset = selectedId
      ? (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === selectedId)
      : null;
    if (button) button.textContent = asset ? `Change ${config.title}` : `Choose ${config.title}`;
    if (!preview) return;
    if (!asset) {
      preview.textContent = 'No image selected';
      return;
    }
    const imageUrl = toDirectAssetUrl(asset.location);
    preview.textContent = '';
    if (imageUrl) {
      const img = document.createElement('img');
      img.src = imageUrl;
      img.alt = safeText(asset.assetName) || config.title;
      preview.appendChild(img);
    }
    const textDiv = document.createElement('div');
    textDiv.className = 'develop-theme-asset-preview-text';
    const strong = document.createElement('strong');
    strong.textContent = safeText(assetLabel(asset, config.title));
    const span = document.createElement('span');
    span.textContent = safeText(asset.category) || 'Image';
    textDiv.appendChild(strong);
    textDiv.appendChild(span);
    preview.appendChild(textDiv);
  }

  function renderLandingAssetPickerDisplay(selectId) {
    const config = getImagePickerConfig(selectId);
    if (!config) return;
    const select = byId(config.selectId);
    const button = byId(config.buttonId);
    const preview = byId(config.previewId);
    const selectedId = safeText(select?.value);
    const asset = selectedId
      ? (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === selectedId)
      : null;
    if (button) button.textContent = asset ? `Change ${config.title}` : `Choose ${config.title}`;
    if (!preview) return;
    if (!asset) {
      preview.textContent = 'No image selected';
      return;
    }
    const imageUrl = toDirectAssetUrl(asset.location);
    preview.textContent = '';
    if (imageUrl) {
      const img = document.createElement('img');
      img.src = imageUrl;
      img.alt = safeText(asset.assetName) || config.title;
      preview.appendChild(img);
    }
    const textDiv = document.createElement('div');
    textDiv.className = 'develop-theme-asset-preview-text';
    const strong = document.createElement('strong');
    strong.textContent = safeText(assetLabel(asset, config.title));
    const span = document.createElement('span');
    span.textContent = safeText(asset.category) || 'Image';
    textDiv.appendChild(strong);
    textDiv.appendChild(span);
    preview.appendChild(textDiv);
  }

  function renderThemeAssetSelect(selectId, currentValue, placeholderLabel) {
    const select = byId(selectId);
    if (!select) return;
    setSelectOptions(
      select,
      getThemePickerAssets(selectId, currentValue).map((asset) => ({
        value: String(asset.id),
        label: assetLabel(asset, `Asset ${asset.id}`),
      })),
      placeholderLabel || 'None',
      currentValue
    );
    renderThemeAssetPickerDisplay(selectId);
  }

  function renderLandingAssetSelect(selectId, currentValue, placeholderLabel) {
    const select = byId(selectId);
    if (!select) return;
    setSelectOptions(
      select,
      getImagePickerAssets(selectId, currentValue).map((asset) => ({
        value: String(asset.id),
        label: assetLabel(asset, `Asset ${asset.id}`),
      })),
      placeholderLabel || 'None',
      currentValue
    );
    renderLandingAssetPickerDisplay(selectId);
  }

  async function uploadThemeAssetFile(file, selectId) {
    const config = getImagePickerConfig(selectId);
    if (!file || !config) return null;
    if (!String(file.type || '').startsWith('image/')) {
      throw new Error('Please choose an image file');
    }
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    const result = await api('/api/assets/upload-google-drive', {
      method: 'POST',
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileBase64: btoa(binary),
        fileSize: Number(file.size || 0),
        assetType: 'Image',
        assetName: file.name.replace(/\.[^.]+$/, '') || file.name,
        category: config.category,
        tags: config.tags,
      }),
    });
    const asset = result?.asset || result?.data?.asset || null;
    if (!asset?.id) throw new Error('Image upload did not return an asset');
    state.assets = [asset].concat(Array.isArray(state.assets) ? state.assets.filter((item) => String(item.id) !== String(asset.id)) : []);
    return asset;
  }

  async function uploadLandingAssetFile(file, selectId) {
    const asset = await uploadThemeAssetFile(file, selectId);
    renderLandingAssetSelect(selectId, String(asset.id), 'None');
    updateLandingPageFieldOutlines();
    return asset;
  }

  function bindAssetPickerTrigger(element, openPicker, label = 'Choose image') {
    if (!element || typeof openPicker !== 'function') return;
    const trigger = element;
    if (trigger.tagName !== 'BUTTON') {
      trigger.setAttribute('role', 'button');
      if (!trigger.hasAttribute('tabindex')) trigger.tabIndex = 0;
    }
    trigger.setAttribute('aria-label', label);
    trigger.classList.add('develop-asset-picker-trigger');
    const activate = (event) => {
      event.preventDefault();
      event.stopPropagation();
      openPicker(event);
    };
    trigger.addEventListener('click', activate);
    trigger.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      activate(event);
    });
  }

  function openImageAssetPicker(target, options = {}) {
    const config = resolveImagePickerConfig(target);
    const selectId = safeText(config?.selectId) || safeText(target);
    const select = selectId ? byId(selectId) : null;
    if (!config || !App.components || typeof App.components.Modal !== 'function') return false;
    const getValue = typeof options.getValue === 'function' ? options.getValue : (() => safeText(select.value));
    const setValue = typeof options.setValue === 'function'
      ? options.setValue
      : ((value) => {
        if (select) select.value = safeText(value);
      });
    const afterChange = typeof options.afterChange === 'function' ? options.afterChange : (() => {});
    const uploadHandler = typeof options.uploadHandler === 'function'
      ? options.uploadHandler
      : ((file) => uploadThemeAssetFile(file, selectId));
    const extraDialogClass = safeText(options.dialogClass);
    const backdropClass = safeText(options.backdropClass);
    const body = document.createElement('div');
    body.className = 'develop-theme-picker-body';
    const toolbar = document.createElement('div');
    toolbar.className = 'develop-theme-picker-toolbar';

    const filterInput = document.createElement('input');
    filterInput.placeholder = 'Search images by name, category, or tag';

    const categoryFilter = document.createElement('select');
    const tagFilter = document.createElement('select');

    const resultCount = document.createElement('div');
    resultCount.className = 'develop-theme-picker-result-count';
    resultCount.textContent = '0 images';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = 'Clear Selection';

    const uploadWrap = document.createElement('div');
    uploadWrap.className = 'develop-theme-picker-upload';
    const uploadInput = document.createElement('input');
    uploadInput.type = 'file';
    uploadInput.accept = 'image/*';
    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.textContent = 'Upload Image';
    uploadWrap.appendChild(uploadInput);
    uploadWrap.appendChild(uploadBtn);

    toolbar.appendChild(filterInput);
    toolbar.appendChild(categoryFilter);
    toolbar.appendChild(tagFilter);
    toolbar.appendChild(resultCount);
    toolbar.appendChild(clearBtn);
    toolbar.appendChild(uploadWrap);

    const grid = document.createElement('div');
    grid.className = 'develop-theme-picker-groups';
    body.appendChild(toolbar);
    body.appendChild(grid);

    let modal = null;
    let previewModal = null;

    function getScopedAssets() {
      return getImagePickerAssets(selectId, getValue());
    }

    function syncPickerFilters() {
      const scopedAssets = getScopedAssets();
      const categoryValues = Array.from(new Set(scopedAssets.map((asset) => safeText(asset?.category)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
      const tagValues = Array.from(new Set(
        scopedAssets.flatMap((asset) => {
          const tags = Array.isArray(asset?.tags)
            ? asset.tags
            : safeText(asset?.tags).split(/[;,]+/g);
          return tags.map((item) => safeText(item)).filter(Boolean);
        })
      )).sort((a, b) => a.localeCompare(b));

      setSelectOptions(
        categoryFilter,
        categoryValues.map((value) => ({ value, label: value })),
        'All Relevant Categories',
        safeText(categoryFilter.value)
      );
      setSelectOptions(
        tagFilter,
        tagValues.map((value) => ({ value, label: value })),
        'All Relevant Tags',
        safeText(tagFilter.value)
      );
    }

    function openImagePreview(asset) {
      if (!asset || !App.components || typeof App.components.Modal !== 'function') return;
      const imageUrl = toDirectAssetUrl(asset.location);
      if (!imageUrl) return;
      const previewBody = document.createElement('div');
      previewBody.className = 'develop-theme-image-preview-modal-body';
      const pParser = new DOMParser();
      const pDoc = pParser.parseFromString(`
        <div class="develop-theme-image-preview-stage">
          <img src="${imageUrl}" alt="${safeText(assetLabel(asset, config.title))}" />
        </div>
        <div class="develop-theme-image-preview-meta">
          <strong>${safeText(assetLabel(asset, config.title))}</strong>
          <span>${safeText(asset.category) || 'Image'}</span>
        </div>
      `, 'text/html');
      previewBody.textContent = '';
      Array.from(pDoc.body.childNodes).forEach(n => previewBody.appendChild(n.cloneNode(true)));
      previewModal = App.components.Modal({
        title: safeText(assetLabel(asset, config.title)) || config.title,
        body: previewBody,
        dialogClass: 'develop-theme-image-preview-modal',
      });
      previewModal.open();
    }

    function renderGrid() {
      syncPickerFilters();
      const filter = safeText(filterInput.value).toLowerCase();
      const categoryValue = safeText(categoryFilter.value);
      const tagValue = safeText(tagFilter.value).toLowerCase();
      const assets = getScopedAssets().filter((asset) => {
        if (categoryValue && safeText(asset?.category) !== categoryValue) return false;
        const tagText = getAssetTagText(asset).toLowerCase();
        if (tagValue && !tagText.includes(tagValue)) return false;
        if (!filter) return true;
        const haystack = [
          assetLabel(asset, ''),
          safeText(asset.category),
          safeText(asset.assetName),
          safeText(asset.location),
          safeText(asset?.aspect),
          tagText,
        ].join(' ').toLowerCase();
        return haystack.includes(filter);
      });
      resultCount.textContent = `${assets.length} image${assets.length === 1 ? '' : 's'}`;
      grid.textContent = '';
      if (!App.assetPicker || typeof App.assetPicker.renderGroupedImageGrid !== 'function') {
        const fallback = document.createElement('div');
        fallback.className = 'meta';
        fallback.textContent = 'Image picker is unavailable.';
        grid.appendChild(fallback);
        return;
      }
      App.assetPicker.renderGroupedImageGrid(grid, {
        assets,
        getSelectedId: getValue,
        toDirectAssetUrl,
        assetLabel: (asset) => assetLabel(asset, config.title),
        onChoose: (asset) => {
          setValue(String(asset.id));
          afterChange(asset);
          if (modal) modal.close();
        },
        onPreview: openImagePreview,
      });
    }

    filterInput.addEventListener('input', renderGrid);
    categoryFilter.addEventListener('change', renderGrid);
    tagFilter.addEventListener('change', renderGrid);
    clearBtn.addEventListener('click', () => {
      setValue('');
      afterChange(null);
      if (modal) modal.close();
    });
    const performUpload = async () => {
      const file = uploadInput.files && uploadInput.files[0];
      if (!file) {
        notify('Choose an image file first', true);
        return;
      }
      try {
        uploadBtn.disabled = true;
        uploadInput.disabled = true;
        notify('Uploading image...', false);
        const asset = await uploadHandler(file);
        notify('Image uploaded successfully!');
        if (asset?.id) {
          setValue(String(asset.id));
          afterChange(asset);
        }
        renderGrid();
        if (modal) modal.close();
      } catch (err) {
        notify(err.message || 'Could not upload image', true);
      } finally {
        uploadBtn.disabled = false;
        uploadInput.disabled = false;
        uploadInput.value = ''; // Reset input to allow selecting the same file again
      }
    };

    uploadInput.addEventListener('change', performUpload);
    uploadBtn.addEventListener('click', performUpload);

    modal = App.components.Modal({
      title: `Choose ${config.title}`,
      body,
      dialogClass: ['develop-theme-picker-modal', extraDialogClass].filter(Boolean).join(' '),
    });
    applyDevelopNestedModalPresentation(modal, {
      anchor: options.anchor || 'upper-right',
      transparentBackdrop: options.transparentBackdrop !== false,
    });
    if (backdropClass && modal?.el) {
      modal.el.classList.add(backdropClass);
    }
    renderGrid();
    modal.open();
    const parentModalCandidates = Array.from(document.querySelectorAll(
      'dialog[open], .develop-module-editor-modal, .c-modal__backdrop.develop-nested-modal-backdrop'
    )).filter((el) => el !== modal.el && !modal.el.contains(el));
    const openParentModal = parentModalCandidates[parentModalCandidates.length - 1];
    if (openParentModal && modal?.el && modal.el.parentNode !== openParentModal) {
      openParentModal.appendChild(modal.el);
    }
    return modal;
  }

  function getDevelopImageAssets(currentValue = '') {
    const rows = getThemeImageAssets();
    const currentId = safeText(currentValue);
    if (currentId && !rows.some((asset) => String(asset.id) === currentId)) {
      const currentAsset = (Array.isArray(state.assets) ? state.assets : []).find((asset) => String(asset.id) === currentId);
      if (currentAsset && safeText(currentAsset.assetType) === 'Image') rows.unshift(currentAsset);
    }
    return rows;
  }

  function mountDevelopInlineImagePicker(container, options = {}) {
    if (!container) return null;
    const {
      inputId = 'developInlineImagePickerInput',
      initialValue = '',
      title = 'Image',
      emptyMessage = 'No matching images found.',
      onChange = () => {},
      onPreview,
    } = options;

    container.className = 'develop-inline-image-picker';
    container.textContent = '';

    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'hidden';
    hiddenInput.id = inputId;
    hiddenInput.value = safeText(initialValue);

    const toolbar = document.createElement('div');
    toolbar.className = 'develop-theme-picker-toolbar develop-inline-image-picker-toolbar';

    const filterInput = document.createElement('input');
    filterInput.type = 'search';
    filterInput.placeholder = 'Search images by name, category, or tag';
    filterInput.setAttribute('aria-label', 'Search Images');

    const categoryFilter = document.createElement('select');
    categoryFilter.setAttribute('aria-label', 'Filter Category');

    const tagFilter = document.createElement('select');
    tagFilter.setAttribute('aria-label', 'Filter Tag');

    const resultCount = document.createElement('div');
    resultCount.className = 'develop-theme-picker-result-count';
    resultCount.textContent = '0 images';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn-ghost';
    clearBtn.textContent = 'Clear Selection';

    toolbar.appendChild(filterInput);
    toolbar.appendChild(categoryFilter);
    toolbar.appendChild(tagFilter);
    toolbar.appendChild(resultCount);
    toolbar.appendChild(clearBtn);

    const grid = document.createElement('div');
    grid.className = 'develop-theme-picker-groups develop-inline-image-picker-grid';

    container.appendChild(hiddenInput);
    container.appendChild(toolbar);
    container.appendChild(grid);

    const setSelectedId = (value) => {
      hiddenInput.value = safeText(value);
      renderGrid();
      onChange(safeText(value));
    };

    function syncPickerFilters() {
      const scopedAssets = getDevelopImageAssets(hiddenInput.value);
      const categoryValues = Array.from(new Set(scopedAssets.map((asset) => safeText(asset?.category)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
      const tagValues = Array.from(new Set(
        scopedAssets.flatMap((asset) => {
          const tags = Array.isArray(asset?.tags)
            ? asset.tags
            : safeText(asset?.tags).split(/[;,]+/g);
          return tags.map((item) => safeText(item)).filter(Boolean);
        })
      )).sort((a, b) => a.localeCompare(b));

      setSelectOptions(
        categoryFilter,
        categoryValues.map((value) => ({ value, label: value })),
        'All Categories',
        safeText(categoryFilter.value)
      );
      setSelectOptions(
        tagFilter,
        tagValues.map((value) => ({ value, label: value })),
        'All Tags',
        safeText(tagFilter.value)
      );
    }

    function openInlineImagePreview(asset) {
      if (!asset || !App.components || typeof App.components.Modal !== 'function') return;
      const imageUrl = toDirectAssetUrl(asset.location);
      if (!imageUrl) return;
      const previewBody = document.createElement('div');
      previewBody.className = 'develop-theme-image-preview-modal-body';
      const pParser = new DOMParser();
      const pDoc = pParser.parseFromString(`
        <div class="develop-theme-image-preview-stage">
          <img src="${imageUrl}" alt="${escapeHtml(safeText(assetLabel(asset, title)))}" />
        </div>
        <div class="develop-theme-image-preview-meta">
          <strong>${escapeHtml(safeText(assetLabel(asset, title)))}</strong>
          <span>${escapeHtml(safeText(asset.category) || 'Image')}</span>
        </div>
      `, 'text/html');
      previewBody.textContent = '';
      Array.from(pDoc.body.childNodes).forEach((node) => previewBody.appendChild(node.cloneNode(true)));
      const previewModal = App.components.Modal({
        title: safeText(assetLabel(asset, title)) || title,
        body: previewBody,
        dialogClass: 'develop-theme-image-preview-modal',
      });
      applyDevelopNestedModalPresentation(previewModal, {
        anchor: 'upper-right',
        transparentBackdrop: true,
      });
      previewModal.open();
    }

    function renderGrid() {
      syncPickerFilters();
      const filter = safeText(filterInput.value).toLowerCase();
      const categoryValue = safeText(categoryFilter.value);
      const tagValue = safeText(tagFilter.value).toLowerCase();
      const assets = getDevelopImageAssets(hiddenInput.value).filter((asset) => {
        if (categoryValue && safeText(asset?.category) !== categoryValue) return false;
        const tagText = getAssetTagText(asset).toLowerCase();
        if (tagValue && !tagText.includes(tagValue)) return false;
        if (!filter) return true;
        const haystack = [
          assetLabel(asset, ''),
          safeText(asset.category),
          safeText(asset.assetName),
          safeText(asset.location),
          safeText(asset?.aspect),
          tagText,
        ].join(' ').toLowerCase();
        return haystack.includes(filter);
      });
      resultCount.textContent = `${assets.length} image${assets.length === 1 ? '' : 's'}`;
      grid.textContent = '';
      if (!App.assetPicker || typeof App.assetPicker.renderGroupedImageGrid !== 'function') {
        const fallback = document.createElement('div');
        fallback.className = 'meta';
        fallback.textContent = 'Image picker is unavailable.';
        grid.appendChild(fallback);
        return;
      }
      App.assetPicker.renderGroupedImageGrid(grid, {
        assets,
        getSelectedId: () => hiddenInput.value,
        toDirectAssetUrl,
        assetLabel: (asset) => assetLabel(asset, title),
        emptyMessage,
        onChoose: (asset) => setSelectedId(String(asset.id)),
        onPreview: typeof onPreview === 'function' ? onPreview : openInlineImagePreview,
      });
    }

    filterInput.addEventListener('input', renderGrid);
    categoryFilter.addEventListener('change', renderGrid);
    tagFilter.addEventListener('change', renderGrid);
    clearBtn.addEventListener('click', () => setSelectedId(''));

    renderGrid();

    return {
      getValue: () => safeText(hiddenInput.value),
      setValue: (value) => setSelectedId(value),
      clear: () => setSelectedId(''),
      refresh: renderGrid,
    };
  }

  function markDevelopModuleEditorDialogExpanded(panel) {
    panel?.querySelector('.develop-module-editor-modal__dialog')?.classList.add('develop-module-editor-modal__dialog--expanded');
  }

  function applyDevelopNestedModalPresentation(modal, options = {}) {
    if (!modal?.el) return modal;
    const anchor = safeText(options.anchor) || 'upper-right';
    const transparentBackdrop = options.transparentBackdrop !== false;
    modal.el.classList.add('develop-nested-modal-backdrop');
    if (transparentBackdrop) {
      modal.el.classList.add('develop-nested-modal-backdrop--transparent');
    }
    if (anchor === 'upper-right') {
      modal.el.classList.add('develop-nested-modal-backdrop--upper-right');
    }
    const dialog = modal.el.querySelector('.c-modal__dialog');
    if (dialog) {
      dialog.classList.add('develop-nested-modal-dialog');
      if (anchor === 'upper-right') {
        dialog.classList.add('develop-nested-modal-dialog--upper-right');
      }
    }
    return modal;
  }

  function openThemeAssetPicker(selectId) {
    openImageAssetPicker(selectId, {
      afterChange: () => {
        renderThemeAssetPickerDisplay(selectId);
        renderThemesPreview();
      },
      uploadHandler: (file) => uploadThemeAssetFile(file, selectId).then((asset) => {
        renderThemeAssetSelect(selectId, String(asset.id), 'None');
        renderThemesTable();
        renderThemesPreview();
        return asset;
      }),
    });
  }

  function openLandingAssetPicker(selectId) {
    openImageAssetPicker(selectId, {
      afterChange: () => {
        renderLandingAssetPickerDisplay(selectId);
        updateLandingPageFieldOutlines();
      },
      uploadHandler: (file) => uploadLandingAssetFile(file, selectId),
    });
  }

  function getVideoAssets() {
    return (Array.isArray(state.assets) ? state.assets : []).filter((asset) => safeText(asset?.assetType) === 'Video');
  }

  function openSavedFormPicker(options = {}) {
    if (!App.components || typeof App.components.Modal !== 'function') return false;
    const getValue = typeof options.getValue === 'function' ? options.getValue : (() => '');
    const setValue = typeof options.setValue === 'function' ? options.setValue : (() => {});
    const afterChange = typeof options.afterChange === 'function' ? options.afterChange : (() => {});
    const title = safeText(options.title) || 'Saved Form';
    const body = document.createElement('div');
    body.className = 'develop-theme-picker-body';
    const list = document.createElement('div');
    list.className = 'develop-theme-picker-grid develop-theme-picker-grid--unknown';
    body.appendChild(list);
    let modal = null;

    const renderList = () => {
      list.textContent = '';
      const forms = Array.isArray(savedForms) ? savedForms.slice() : [];
      if (!forms.length) {
        const empty = document.createElement('div');
        empty.className = 'meta';
        empty.textContent = 'No saved forms available.';
        list.appendChild(empty);
        return;
      }
      forms.forEach((form) => {
        const card = document.createElement('div');
        card.className = `develop-theme-picker-card${safeText(getValue()) === safeText(form.id) ? ' is-selected' : ''}`;
        const fieldCount = Array.isArray(form?.fields) ? form.fields.length : 0;
        const titleDiv = document.createElement('div');
        titleDiv.className = 'develop-theme-picker-card-title';
        titleDiv.textContent = safeText(form?.name) || safeText(form?.id) || 'Saved Form';

        const metaDiv = document.createElement('div');
        metaDiv.className = 'develop-theme-picker-card-meta';
        metaDiv.textContent = `${safeText(form?.formType) || 'Form'} · ${fieldCount} fields`;

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'develop-theme-picker-card-actions';

        const selectBtn = document.createElement('button');
        selectBtn.type = 'button';
        selectBtn.className = 'tiny-btn develop-theme-picker-select-btn';
        selectBtn.textContent = 'Use Form';

        actionsDiv.appendChild(selectBtn);

        card.appendChild(titleDiv);
        card.appendChild(metaDiv);
        card.appendChild(actionsDiv);

        selectBtn.addEventListener('click', () => {
          setValue(safeText(form.id));
          afterChange(form);
          modal?.close();
        });
        list.appendChild(card);
      });
    };

    modal = App.components.Modal({
      title: `Choose ${title}`,
      body,
      dialogClass: 'develop-theme-picker-modal develop-module-image-picker-modal',
    });
    applyDevelopNestedModalPresentation(modal, {
      anchor: 'upper-right',
      transparentBackdrop: true,
    });
    renderList();
    modal.open();
    return modal;
  }

  function openVideoAssetPicker(options = {}) {
    if (!App.components || typeof App.components.Modal !== 'function') return false;
    const getValue = typeof options.getValue === 'function' ? options.getValue : (() => '');
    const setValue = typeof options.setValue === 'function' ? options.setValue : (() => {});
    const afterChange = typeof options.afterChange === 'function' ? options.afterChange : (() => {});
    const title = safeText(options.title) || 'Video';
    const body = document.createElement('div');
    body.className = 'develop-theme-picker-body';
    const filterInput = document.createElement('input');
    filterInput.placeholder = 'Search videos by name, category, or tag';
    const list = document.createElement('div');
    list.className = 'develop-theme-picker-grid develop-theme-picker-grid--wide';
    body.appendChild(filterInput);
    body.appendChild(list);
    let modal = null;

    const renderList = () => {
      const filter = safeText(filterInput.value).toLowerCase();
      const videos = getVideoAssets().filter((asset) => {
        if (!filter) return true;
        const haystack = [
          safeText(assetLabel(asset, 'Video')),
          safeText(asset?.category),
          safeText(asset?.assetName),
          safeText(asset?.location),
          getAssetTagText(asset),
        ].join(' ').toLowerCase();
        return haystack.includes(filter);
      });
      list.textContent = '';
      if (!videos.length) {
        const empty = document.createElement('div');
        empty.className = 'meta';
        empty.textContent = 'No matching videos found.';
        list.appendChild(empty);
        return;
      }
      videos.forEach((asset) => {
        const card = document.createElement('div');
        card.className = `develop-theme-picker-card${safeText(getValue()) === safeText(asset.id) ? ' is-selected' : ''}`;
        const titleDiv = document.createElement('div');
        titleDiv.className = 'develop-theme-picker-card-title';
        titleDiv.textContent = assetLabel(asset, title);

        const metaDiv = document.createElement('div');
        metaDiv.className = 'develop-theme-picker-card-meta';
        metaDiv.textContent = safeText(asset.category) || 'Video';

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'develop-theme-picker-card-actions';

        const selectBtn = document.createElement('button');
        selectBtn.type = 'button';
        selectBtn.className = 'tiny-btn develop-theme-picker-select-btn';
        selectBtn.textContent = 'Use Video';

        actionsDiv.appendChild(selectBtn);

        card.appendChild(titleDiv);
        card.appendChild(metaDiv);
        card.appendChild(actionsDiv);

        selectBtn.addEventListener('click', () => {
          setValue(safeText(asset.id));
          afterChange(asset);
          modal?.close();
        });
        list.appendChild(card);
      });
    };

    filterInput.addEventListener('input', renderList);
    modal = App.components.Modal({
      title: `Choose ${title}`,
      body,
      dialogClass: 'develop-theme-picker-modal develop-module-image-picker-modal',
    });
    applyDevelopNestedModalPresentation(modal, {
      anchor: 'upper-right',
      transparentBackdrop: true,
    });
    renderList();
    modal.open();
    return modal;
  }

  function normalizeDevelopTableContents(rawValue, columnsCount = 3, rowsCount = 4) {
    const cols = Math.max(1, Math.min(8, Number(columnsCount) || 1));
    const rows = Math.max(1, Math.min(20, Number(rowsCount) || 1));
    let parsed = rawValue;
    if (typeof parsed === 'string') {
      try {
        parsed = parsed ? JSON.parse(parsed) : [];
      } catch (_) {
        parsed = [];
      }
    }
    const source = Array.isArray(parsed) ? parsed : [];
    const byKey = new Map();
    source.forEach((cell) => {
      const row = Number(cell?.row);
      const column = Number(cell?.column);
      if (row >= 0 && column >= 0) {
        byKey.set(`${row}:${column}`, {
          row,
          column,
          cellType: ['empty', 'heading', 'text', 'image', 'video'].includes(safeText(cell?.cellType)) ? safeText(cell.cellType) : 'empty',
          headingLevel: safeText(cell?.headingLevel) || 'H3',
          text: safeText(cell?.text, 20000),
          imageAssetId: safeText(cell?.imageAssetId),
          videoAssetId: safeText(cell?.videoAssetId),
        });
      }
    });
    const cells = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < cols; column += 1) {
        const key = `${row}:${column}`;
        cells.push(byKey.get(key) || {
          row,
          column,
          cellType: 'empty',
          headingLevel: 'H3',
          text: '',
          imageAssetId: '',
          videoAssetId: '',
        });
      }
    }
    return cells;
  }

  function getDevelopTableContentsSummary(rawValue, columnsCount = 3, rowsCount = 4) {
    const cells = normalizeDevelopTableContents(rawValue, columnsCount, rowsCount);
    const configuredCount = cells.filter((cell) => safeText(cell?.cellType) !== 'empty').length;
    return `${rowsCount} x ${columnsCount} table · ${configuredCount} configured cell${configuredCount === 1 ? '' : 's'}`;
  }

  function openDevelopTableContentsEditor(options = {}) {
    if (!App.components || typeof App.components.Modal !== 'function') return false;
    const getValue = typeof options.getValue === 'function' ? options.getValue : (() => '[]');
    const setValue = typeof options.setValue === 'function' ? options.setValue : (() => {});
    const afterChange = typeof options.afterChange === 'function' ? options.afterChange : (() => {});
    const getDimensions = typeof options.getDimensions === 'function'
      ? options.getDimensions
      : (() => ({ columnsCount: 3, rowsCount: 4 }));
    const title = safeText(options.title) || 'Table Contents';
    const body = document.createElement('div');
    body.className = 'stack-form';
    const summary = document.createElement('div');
    summary.className = 'meta';
    const grid = document.createElement('div');
    grid.className = 'grid-form';
    body.appendChild(summary);
    body.appendChild(grid);
    let modal = null;
    let cells = [];

    const buildImageChooser = (targetCell, host) => {
      const controls = document.createElement('div');
      controls.className = 'develop-inline-asset-nav develop-inline-asset-nav--table-cell';
      const chooseBtn = document.createElement('button');
      chooseBtn.type = 'button';
      chooseBtn.className = 'btn btn-ghost';
      const status = document.createElement('button');
      status.type = 'button';
      status.className = 'develop-inline-asset-status develop-inline-asset-status-btn';
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'btn btn-ghost';
      clearBtn.textContent = 'Clear';
      const openPicker = () => {
        openImageAssetPicker(
          { selectId: '', title: 'Table Cell Image' },
          {
            dialogClass: 'develop-module-image-picker-modal',
            backdropClass: 'develop-module-image-picker-backdrop',
            getValue: () => safeText(targetCell.imageAssetId),
            setValue: (nextValue) => {
              targetCell.imageAssetId = safeText(nextValue);
            },
            afterChange: () => {
              updateState();
            },
          }
        );
      };
      const updateState = () => {
        const asset = getAssetById(targetCell.imageAssetId);
        const imageUrl = asset ? toDirectAssetUrl(asset.location) : '';
        chooseBtn.textContent = asset ? 'Change Image' : 'Choose Image';
        status.textContent = '';
        if (imageUrl) {
          const img = document.createElement('img');
          img.src = imageUrl;
          img.alt = assetLabel(asset, 'Image');
          status.appendChild(img);
          const label = document.createElement('span');
          label.className = 'develop-inline-asset-status-label';
          label.textContent = assetLabel(asset, 'Image');
          status.appendChild(label);
        } else {
          status.textContent = 'No image selected';
        }
      };
      bindAssetPickerTrigger(chooseBtn, openPicker, 'Choose table cell image');
      bindAssetPickerTrigger(status, openPicker, 'Choose table cell image');
      clearBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        targetCell.imageAssetId = '';
        updateState();
      });
      controls.appendChild(chooseBtn);
      controls.appendChild(status);
      controls.appendChild(clearBtn);
      host.appendChild(controls);
      updateState();
    };

    const buildVideoChooser = (targetCell, host) => {
      const controls = document.createElement('div');
      controls.className = 'develop-inline-asset-nav develop-inline-asset-nav--table-cell';
      const chooseBtn = document.createElement('button');
      chooseBtn.type = 'button';
      chooseBtn.className = 'btn btn-ghost';
      const status = document.createElement('button');
      status.type = 'button';
      status.className = 'develop-inline-asset-status develop-inline-asset-status-btn';
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'btn btn-ghost';
      clearBtn.textContent = 'Clear';
      const openPicker = () => {
        openVideoAssetPicker({
          title: 'Table Cell Video',
          getValue: () => safeText(targetCell.videoAssetId),
          setValue: (nextValue) => {
            targetCell.videoAssetId = safeText(nextValue);
          },
          afterChange: () => {
            updateState();
          },
        });
      };
      const updateState = () => {
        const asset = getAssetById(targetCell.videoAssetId);
        chooseBtn.textContent = asset ? 'Change Video' : 'Choose Video';
        status.textContent = asset ? assetLabel(asset, 'Video') : 'No video selected';
      };
      bindAssetPickerTrigger(chooseBtn, openPicker, 'Choose table cell video');
      bindAssetPickerTrigger(status, openPicker, 'Choose table cell video');
      clearBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        targetCell.videoAssetId = '';
        updateState();
      });
      controls.appendChild(chooseBtn);
      controls.appendChild(status);
      controls.appendChild(clearBtn);
      host.appendChild(controls);
      updateState();
    };

    const renderGrid = () => {
      const { columnsCount, rowsCount } = getDimensions();
      cells = normalizeDevelopTableContents(getValue(), columnsCount, rowsCount);
      summary.textContent = getDevelopTableContentsSummary(cells, columnsCount, rowsCount);
      grid.textContent = '';
      cells.forEach((cell) => {
        const card = document.createElement('div');
        card.className = 'stack-form';
        card.style.padding = '0.85rem';
        card.style.border = '1px solid #c7d8eb';
        card.style.borderRadius = '14px';
        card.style.background = '#f8fbff';
        const titleNode = document.createElement('strong');
        titleNode.textContent = `Cell ${cell.row + 1}, ${cell.column + 1}`;
        card.appendChild(titleNode);

        const typeWrap = document.createElement('label');
        typeWrap.className = 'stack-form';
        typeWrap.textContent = '';
        const tSpan = document.createElement('span');
        tSpan.textContent = 'Content Type';
        typeWrap.appendChild(tSpan);
        const typeSelect = document.createElement('select');
        [
          ['empty', 'Empty'],
          ['heading', 'Heading'],
          ['text', 'Text'],
          ['image', 'Image'],
          ['video', 'Video'],
        ].forEach(([value, label]) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          typeSelect.appendChild(option);
        });
        typeSelect.value = safeText(cell.cellType) || 'empty';
        typeWrap.appendChild(typeSelect);
        card.appendChild(typeWrap);

        const detailHost = document.createElement('div');
        detailHost.className = 'stack-form';
        card.appendChild(detailHost);

        const renderDetails = () => {
          detailHost.textContent = '';
          cell.cellType = safeText(typeSelect.value) || 'empty';
          if (cell.cellType === 'heading') {
            const levelWrap = document.createElement('label');
            levelWrap.className = 'stack-form';
            levelWrap.textContent = '';
            const lSpan = document.createElement('span');
            lSpan.textContent = 'Heading Level';
            levelWrap.appendChild(lSpan);
            const levelSelect = document.createElement('select');
            ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].forEach((item) => {
              const option = document.createElement('option');
              option.value = item;
              option.textContent = item;
              levelSelect.appendChild(option);
            });
            levelSelect.value = safeText(cell.headingLevel) || 'H3';
            levelSelect.addEventListener('change', () => {
              cell.headingLevel = safeText(levelSelect.value) || 'H3';
            });
            levelWrap.appendChild(levelSelect);
            const textWrap = document.createElement('label');
            textWrap.className = 'stack-form';
            textWrap.textContent = '';
            const tSpan2 = document.createElement('span');
            tSpan2.textContent = 'Text';
            textWrap.appendChild(tSpan2);
            const input = document.createElement('input');
            input.type = 'text';
            input.value = safeText(cell.text, 2000);
            input.placeholder = 'Heading text';
            input.addEventListener('input', () => {
              cell.text = safeText(input.value, 2000);
            });
            textWrap.appendChild(input);
            detailHost.appendChild(levelWrap);
            detailHost.appendChild(textWrap);
            return;
          }
          if (cell.cellType === 'text') {
            const textWrap = document.createElement('label');
            textWrap.className = 'stack-form';
            textWrap.textContent = '';
            const s = document.createElement('span');
            s.textContent = 'Text';
            textWrap.appendChild(s);
            const input = document.createElement('textarea');
            input.rows = 4;
            input.value = safeText(cell.text, 10000);
            input.placeholder = 'Cell text';
            input.addEventListener('input', () => {
              cell.text = safeText(input.value, 10000);
            });
            textWrap.appendChild(input);
            detailHost.appendChild(textWrap);
            return;
          }
          if (cell.cellType === 'image') {
            buildImageChooser(cell, detailHost);
            return;
          }
          if (cell.cellType === 'video') {
            buildVideoChooser(cell, detailHost);
          }
        };

        typeSelect.addEventListener('change', renderDetails);
        renderDetails();
        grid.appendChild(card);
      });
    };

    modal = App.components.Modal({
      title,
      body,
      actions: [
        { label: 'Cancel', onClick: () => modal.close() },
        {
          label: 'Save Contents',
          onClick: () => {
            setValue(JSON.stringify(cells));
            afterChange(cells);
            modal.close();
          },
        },
      ],
      dialogClass: 'develop-module-image-picker-modal develop-table-contents-modal',
      bodyClass: 'develop-email-template-modal-body',
    });
    applyDevelopNestedModalPresentation(modal, {
      anchor: 'upper-right',
      transparentBackdrop: true,
    });
    renderGrid();
    modal.open();
    return modal;
  }

  function buildThemePayload() {
    return {
      name: safeText(byId('developThemesNameInput')?.value),
      primaryColor: safeText(byId('developThemesPrimaryColorInput')?.value) || DEFAULT_LANDING_PRIMARY,
      backgroundColor: safeText(byId('developThemesBackgroundColorInput')?.value) || DEFAULT_LANDING_BACKGROUND,
      accentColor: safeText(byId('developThemesAccentColorInput')?.value) || DEFAULT_LANDING_ACCENT,
      borderThickness: Number(byId('developThemesBorderThicknessInput')?.value || 1) || 1,
      borderRadius: Number(byId('developThemesBorderRadiusInput')?.value || 12) || 12,
      containerBlur: Number(byId('developThemesContainerBlurInput')?.value || 0) || 0,
      contrastLevel: Number(byId('developThemesContrastLevelInput')?.value || 0) || 0,
      logoWideId: safeText(byId('developThemesLogoWideSelect')?.value),
      logoSquareId: safeText(byId('developThemesLogoSquareSelect')?.value),
      featureImageId: safeText(byId('developThemesFeatureImageSelect')?.value),
      backgroundImageId: safeText(byId('developThemesBackgroundImageSelect')?.value),
    };
  }

  function syncThemeRangeLabels() {
    const pairs = [
      ['developThemesBorderThicknessInput', 'developThemesBorderThicknessValue'],
      ['developThemesBorderRadiusInput', 'developThemesBorderRadiusValue'],
      ['developThemesContainerBlurInput', 'developThemesContainerBlurValue'],
      ['developThemesContrastLevelInput', 'developThemesContrastLevelValue'],
    ];
    pairs.forEach(([inputId, outputId]) => {
      const input = byId(inputId);
      const output = byId(outputId);
      if (!input || !output) return;
      output.textContent = String(input.value || '0');
    });
  }

  function resetThemeBuilder() {
    selectedThemeId = '';
    if (byId('developThemesThemeSelect')) byId('developThemesThemeSelect').value = '';
    if (byId('developThemesNameInput')) byId('developThemesNameInput').value = '';
    if (byId('developThemesPrimaryColorInput')) byId('developThemesPrimaryColorInput').value = DEFAULT_LANDING_PRIMARY;
    if (byId('developThemesBackgroundColorInput')) byId('developThemesBackgroundColorInput').value = DEFAULT_LANDING_BACKGROUND;
    if (byId('developThemesAccentColorInput')) byId('developThemesAccentColorInput').value = DEFAULT_LANDING_ACCENT;
    if (byId('developThemesBorderThicknessInput')) byId('developThemesBorderThicknessInput').value = '1';
    if (byId('developThemesBorderRadiusInput')) byId('developThemesBorderRadiusInput').value = '12';
    if (byId('developThemesContainerBlurInput')) byId('developThemesContainerBlurInput').value = '0';
    if (byId('developThemesContrastLevelInput')) byId('developThemesContrastLevelInput').value = '0';
    renderThemeAssetSelect('developThemesLogoWideSelect', '', 'None');
    renderThemeAssetSelect('developThemesLogoSquareSelect', '', 'None');
    renderThemeAssetSelect('developThemesFeatureImageSelect', '', 'None');
    renderThemeAssetSelect('developThemesBackgroundImageSelect', '', 'None');
    syncThemeRangeLabels();
    setThemeStatus('');
    renderThemesPreview();
  }

  function applyThemeToBuilder(theme) {
    if (!theme) {
      resetThemeBuilder();
      return;
    }
    selectedThemeId = String(theme.id || '');
    if (byId('developThemesThemeSelect')) byId('developThemesThemeSelect').value = selectedThemeId;
    if (byId('developThemesNameInput')) byId('developThemesNameInput').value = safeText(theme.name);
    if (byId('developThemesPrimaryColorInput')) byId('developThemesPrimaryColorInput').value = safeText(theme.primaryColor) || DEFAULT_LANDING_PRIMARY;
    if (byId('developThemesBackgroundColorInput')) byId('developThemesBackgroundColorInput').value = safeText(theme.backgroundColor) || DEFAULT_LANDING_BACKGROUND;
    if (byId('developThemesAccentColorInput')) byId('developThemesAccentColorInput').value = safeText(theme.accentColor) || DEFAULT_LANDING_ACCENT;
    if (byId('developThemesBorderThicknessInput')) byId('developThemesBorderThicknessInput').value = String(theme.borderThickness ?? 1);
    if (byId('developThemesBorderRadiusInput')) byId('developThemesBorderRadiusInput').value = String(theme.borderRadius ?? 12);
    if (byId('developThemesContainerBlurInput')) byId('developThemesContainerBlurInput').value = String(theme.containerBlur ?? 0);
    if (byId('developThemesContrastLevelInput')) byId('developThemesContrastLevelInput').value = String(theme.contrastLevel ?? 0);
    renderThemeAssetSelect('developThemesLogoWideSelect', safeText(theme.logoWideId), 'None');
    renderThemeAssetSelect('developThemesLogoSquareSelect', safeText(theme.logoSquareId), 'None');
    renderThemeAssetSelect('developThemesFeatureImageSelect', safeText(theme.featureImageId), 'None');
    renderThemeAssetSelect('developThemesBackgroundImageSelect', safeText(theme.backgroundImageId), 'None');
    syncThemeRangeLabels();
    setThemeStatus('');
    renderThemesPreview();
  }

  function syncThemesBuilder() {
    setSelectOptions(
      byId('developThemesThemeSelect'),
      savedThemes.map((theme) => ({ value: String(theme.id), label: safeText(theme.name) || `Theme ${theme.id}` })),
      'Select Theme',
      selectedThemeId
    );
    const current = getThemeById(selectedThemeId);
    if (current) applyThemeToBuilder(current);
    else resetThemeBuilder();
  }

  function getThemeAssetLabel(id, fallback = '-') {
    const cleanId = safeText(id);
    if (!cleanId) return fallback;
    const asset = (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === cleanId);
    return assetLabel(asset, fallback);
  }

  function renderThemePaletteSwatches(theme) {
    const colors = [
      { label: 'Primary', value: safeText(theme?.primaryColor) },
      { label: 'Background', value: safeText(theme?.backgroundColor) },
      { label: 'Accent', value: safeText(theme?.accentColor) },
    ].filter((item) => item.value);

    if (!colors.length) {
      const empty = document.createElement('span');
      empty.textContent = '-';
      return empty;
    }

    const container = document.createElement('div');
    container.className = 'develop-theme-palette-cell';

    colors.forEach(item => {
      const chip = document.createElement('span');
      chip.className = 'develop-theme-palette-chip';
      chip.title = `${item.label}: ${item.value}`;
      
      const dot = document.createElement('span');
      dot.className = 'develop-theme-palette-dot';
      dot.style.background = item.value;
      
      const label = document.createElement('span');
      label.textContent = item.value;
      
      chip.appendChild(dot);
      chip.appendChild(label);
      container.appendChild(chip);
    });

    return container;
  }

  function renderThemeStyleGlyph(theme) {
    const borderThickness = Math.max(0, Number(theme?.borderThickness || 0) || 0);
    const borderRadius = Math.max(0, Number(theme?.borderRadius || 0) || 0);
    const scaledRadius = Math.min(14, Math.round(borderRadius / 4));
    const borderWidth = borderThickness > 0 ? 1 : 0;
    
    const container = document.createElement('div');
    container.className = 'develop-theme-style-cell';
    
    const glyph = document.createElement('span');
    glyph.className = 'develop-theme-style-glyph';
    glyph.style.borderWidth = `${borderWidth}px`;
    glyph.style.borderRadius = `${scaledRadius}px`;
    
    const label = document.createElement('span');
    label.textContent = `B:${borderThickness} R:${borderRadius} Blur:${theme?.containerBlur ?? 0} C:${theme?.contrastLevel ?? 0}`;
    
    container.appendChild(glyph);
    container.appendChild(label);
    
    return container;
  }

  function getThemePreviewMessagingContent() {
    const headlineRows = Array.isArray(landingPageHeadlines) ? landingPageHeadlines : [];
    const subheadingRows = Array.isArray(landingPageSubheadings) ? landingPageSubheadings : [];
    const pitchRows = Array.isArray(landingPagePitches) ? landingPagePitches : [];
    const ctaRows = Array.isArray(landingPageCtas) ? landingPageCtas : [];
    return {
      heroHeadline: safeText(headlineRows[0]?.headline) || 'Messaging headline preview',
      heroPitch: safeText(pitchRows[0]?.pitch) || 'Use real Headlines, Pitches, and Calls to Action from this project to preview a landing page theme in context.',
      primaryCta: safeText(ctaRows[0]?.cta) || 'Primary CTA',
      secondaryCta: safeText(ctaRows[1]?.cta || ctaRows[0]?.cta) || 'Secondary CTA',
      featureHeadline: safeText(headlineRows[1]?.headline || headlineRows[0]?.headline) || 'Feature headline',
      featureSubheading: safeText(subheadingRows[0]?.subheading) || 'Feature sub-heading from Messaging',
      highlightHeadline: safeText(headlineRows[2]?.headline || headlineRows[0]?.headline) || 'Highlight headline',
      highlightPitch: safeText(pitchRows[1]?.pitch || pitchRows[0]?.pitch) || 'Highlight support copy from Messaging Pitches.',
      bodyHeadline: safeText(headlineRows[3]?.headline || headlineRows[0]?.headline) || 'Body headline',
      bodySubheading: safeText(subheadingRows[1]?.subheading || subheadingRows[0]?.subheading) || 'Body sub-heading',
      bodyPitch: safeText(pitchRows[2]?.pitch || pitchRows[0]?.pitch) || 'Body pitch content appears here using project-scoped Messaging records.',
    };
  }

  function renderThemesPreview() {
    const host = byId('developThemesPreviewHost');
    if (!host) return;
    const payload = buildThemePayload();
    const content = getThemePreviewMessagingContent();
    const logoWideAsset = (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === safeText(payload.logoWideId));
    const logoSquareAsset = (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === safeText(payload.logoSquareId));
    const featureAsset = (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === safeText(payload.featureImageId));
    const backgroundAsset = (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === safeText(payload.backgroundImageId));
    const logoWideUrl = logoWideAsset ? toDirectAssetUrl(logoWideAsset.location) : '';
    const logoSquareUrl = logoSquareAsset ? toDirectAssetUrl(logoSquareAsset.location) : '';
    const featureUrl = featureAsset ? toDirectAssetUrl(featureAsset.location) : '';
    const backgroundUrl = backgroundAsset ? toDirectAssetUrl(backgroundAsset.location) : '';
    const pParser = new DOMParser();
    const pDoc = pParser.parseFromString(`
      <div class="develop-themes-preview-frame" style="${backgroundUrl ? `background-image:linear-gradient(rgba(7,33,66,0.18), rgba(7,33,66,0.18)), url('${backgroundUrl}');` : `background:${payload.backgroundColor};`}">
        <div class="develop-themes-preview-card" style="background:${payload.backgroundColor}; border:${payload.borderThickness}px solid ${payload.accentColor}; border-radius:${payload.borderRadius}px; backdrop-filter:blur(${payload.containerBlur}px);">
          <div class="develop-themes-preview-header">
            <div class="develop-themes-preview-brand">
              ${logoWideUrl ? `<img class="develop-themes-preview-logo-wide" src="${logoWideUrl}" alt="Wide logo" />` : `<div class="develop-themes-preview-logo-fallback" style="color:${payload.primaryColor};">${safeText(payload.name) || 'Theme Brand'}</div>`}
              <div class="develop-themes-preview-eyebrow" style="color:${payload.accentColor};">Landing Page Theme</div>
            </div>
            ${logoSquareUrl ? `<img class="develop-themes-preview-logo-square" src="${logoSquareUrl}" alt="Square logo" />` : ''}
          </div>
          <div class="develop-themes-preview-hero">
            <div class="develop-themes-preview-copy">
              <div class="develop-themes-preview-kicker" style="color:${payload.accentColor};">${safeText(payload.name) || 'Untitled Theme'}</div>
              <h4 style="color:${payload.primaryColor};">${content.heroHeadline}</h4>
              <p>${content.heroPitch}</p>
              <div class="develop-themes-preview-actions">
                <button type="button" style="background:${payload.primaryColor}; border-color:${payload.primaryColor};">${content.primaryCta}</button>
                <button type="button" style="border:${Math.max(1, payload.borderThickness)}px solid ${payload.accentColor}; color:${payload.accentColor}; background:transparent;">${content.secondaryCta}</button>
              </div>
            </div>
            <div class="develop-themes-preview-feature" style="border-radius:${payload.borderRadius}px;">
              ${featureUrl ? `<img src="${featureUrl}" alt="Feature" />` : '<div class="develop-themes-preview-feature-placeholder">Feature Image</div>'}
            </div>
          </div>
          <div class="develop-themes-preview-modules">
            <article class="develop-themes-preview-module">
              <h5 style="color:${payload.primaryColor};">${content.featureHeadline}</h5>
              <p class="develop-themes-preview-module-subheading">${content.featureSubheading}</p>
            </article>
            <article class="develop-themes-preview-module">
              <h5 style="color:${payload.primaryColor};">${content.highlightHeadline}</h5>
              <p>${content.highlightPitch}</p>
            </article>
          </div>
          <div class="develop-themes-preview-body">
            <div class="develop-themes-preview-body-copy">
              <h5 style="color:${payload.primaryColor};">${content.bodyHeadline}</h5>
              <p class="develop-themes-preview-module-subheading">${content.bodySubheading}</p>
              <p>${content.bodyPitch}</p>
            </div>
            <div class="develop-themes-preview-body-side" style="border-radius:${payload.borderRadius}px; border:${Math.max(1, payload.borderThickness)}px solid ${payload.accentColor};">
              <span style="color:${payload.accentColor};">${content.secondaryCta}</span>
            </div>
          </div>
        </div>
      </div>
    `, 'text/html');
    host.textContent = '';
    Array.from(pDoc.body.childNodes).forEach(n => host.appendChild(n.cloneNode(true)));
  }

  function renderThemesInventory() {
    const tbody = byId('developThemesInventoryBody');
    const list = byId('developThemesConsolidationList');
    if (tbody) {
      const p1 = new DOMParser();
      const doc1 = p1.parseFromString(`<table><tbody>
        <tr><td>Palette</td><td>Primary / Background / Accent</td><td>Supabase Theme Record</td><td>Shared theme builder</td></tr>
        <tr><td>Container Styles</td><td>Border, Radius, Blur, Contrast</td><td>Supabase Theme Record</td><td>Shared theme builder</td></tr>
        <tr><td>Image Assets</td><td>Logo Wide, Logo Square, Feature, Background</td><td>Supabase Theme Record</td><td>Shared theme builder</td></tr>
      </tbody></table>`, 'text/html');
      tbody.textContent = '';
      const dTb = doc1.querySelector('tbody');
      if (dTb) Array.from(dTb.childNodes).forEach(n => tbody.appendChild(n.cloneNode(true)));
    }
    if (list) {
      const p2 = new DOMParser();
      const doc2 = p2.parseFromString(`<ul>
        <li>Use Builder: Themes as the shared visual source of truth for campaigns and pages.</li>
        <li>Keep asset-driven visual references attached to each theme record.</li>
      </ul>`, 'text/html');
      list.textContent = '';
      const dUl = doc2.querySelector('ul');
      if (dUl) Array.from(dUl.childNodes).forEach(n => list.appendChild(n.cloneNode(true)));
    }
  }

  function buildThemeActions(theme) {
    const wrap = document.createElement('div');
    wrap.className = 'page-heading-actions';
    wrap.style.justifyContent = 'flex-start';
    wrap.appendChild(App.makeIconButton('edit', 'Edit Theme', () => {
      setThemesBuilderVisible(true);
      applyThemeToBuilder(theme);
      const panel = byId('developThemesBuilderPanel');
      if (panel && typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    wrap.appendChild(App.makeIconButton('delete', 'Delete Theme', async () => {
      if (!window.confirm(`Delete theme "${safeText(theme.name) || theme.id}"?`)) return;
      try {
        await api(`/api/develop/themes/${encodeURIComponent(theme.id)}`, { method: 'DELETE' });
        if (String(selectedThemeId) === String(theme.id)) selectedThemeId = '';
        await refresh();
        notify('Theme deleted');
      } catch (err) {
        notify(err.message || 'Could not delete theme', true);
      }
    }, { danger: true, marginLeft: '8px' }));
    return wrap;
  }

  function renderThemesTable() {
    const tbody = byId('developThemesTableBody');
    if (!tbody) return;
    tbody.textContent = '';
    if (!savedThemes.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.textContent = 'No saved themes yet.';
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }
    savedThemes.forEach((theme) => {
      const tr = document.createElement('tr');
      const featureTd = document.createElement('td');
      featureTd.className = 'develop-theme-table-thumb';
      const featureAsset = (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === safeText(theme.featureImageId));
      const featureUrl = featureAsset ? toDirectAssetUrl(featureAsset.location) : '';
      if (featureUrl) {
        const img = document.createElement('img');
        img.src = featureUrl;
        img.alt = 'Feature image';
        featureTd.appendChild(img);
      } else {
        const empty = document.createElement('div');
        empty.className = 'develop-theme-table-thumb-empty';
        empty.textContent = 'None';
        featureTd.appendChild(empty);
      }
      
      const nameTd = document.createElement('td');
      nameTd.textContent = safeText(theme.name) || '-';
      
      const paletteTd = document.createElement('td');
      paletteTd.appendChild(renderThemePaletteSwatches(theme));
      
      const stylesTd = document.createElement('td');
      stylesTd.appendChild(renderThemeStyleGlyph(theme));
      
      const updatedTd = document.createElement('td');
      updatedTd.textContent = theme.updatedAt ? new Date(theme.updatedAt).toLocaleString() : '-';
      
      const actionsTd = document.createElement('td');
      actionsTd.appendChild(buildThemeActions(theme));
      
      tr.appendChild(featureTd);
      tr.appendChild(nameTd);
      tr.appendChild(paletteTd);
      tr.appendChild(stylesTd);
      tr.appendChild(updatedTd);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
  }

  function getAssetsByCategory(category) {
    return (Array.isArray(state.assets) ? state.assets : []).filter(
      (asset) => safeText(asset?.category) === safeText(category)
    );
  }

  function getAssetsByCategoryAliases(categories, assetType) {
    const allowedCategories = new Set(
      (Array.isArray(categories) ? categories : [])
        .map((item) => safeText(item))
        .filter(Boolean)
    );
    const normalizedType = safeText(assetType);
    return (Array.isArray(state.assets) ? state.assets : []).filter((asset) => {
      if (normalizedType && safeText(asset?.assetType) !== normalizedType) return false;
      return allowedCategories.has(safeText(asset?.category));
    });
  }

  async function submitToolJob(toolName, input, workspaceId, requestPreviewEl, responsePreviewEl, successMessage) {
    const request = {
      manual_confirmed: true,
      type:             'tool.run',
      workspace_id:     safeText(workspaceId) || 'alphire-main',
      requested_by:     { user_id: 'alphire-ui', email: 'ops@alphire.ai' },
      payload:          { tool_name: safeText(toolName), input },
      policy:           { requires_manual_approval: true }
    };
    setPreview(requestPreviewEl, { action: 'create_job', request });
    const result = await api('/api/openclaw/create_job', { method: 'POST', body: JSON.stringify(request) });
    setPreview(responsePreviewEl, result);
    notify(successMessage);
    return result;
  }

  function renderIconBuilderResult(icon) {
    if (!els.iconBuilderResultCard || !els.iconBuilderResultImage) return;
    const hasIcon = Boolean(icon?.dataUrl);
    els.iconBuilderResultCard.classList.toggle('hidden', !hasIcon);
    if (!hasIcon) {
      els.iconBuilderResultImage.removeAttribute('src');
      if (els.iconBuilderResultTitle) els.iconBuilderResultTitle.textContent = 'Generated Icon';
      if (els.iconBuilderResultCaption) els.iconBuilderResultCaption.textContent = '';
      return;
    }
    els.iconBuilderResultImage.src = String(icon.dataUrl);
    if (els.iconBuilderResultTitle) {
      els.iconBuilderResultTitle.textContent = safeText(icon.objectName) || 'Generated Icon';
    }
    if (els.iconBuilderResultCaption) {
      const bits = [safeText(icon.objectType), safeText(icon.visualStyle), safeText(icon.size)].filter(Boolean);
      els.iconBuilderResultCaption.textContent = bits.join(' | ');
    }
  }

  function renderScreenshotResult(asset) {
    const card = byId('developScreenshotResultCard');
    const image = byId('developScreenshotResultImage');
    const title = byId('developScreenshotResultTitle');
    const caption = byId('developScreenshotResultCaption');
    const hasAsset = Boolean(asset && safeText(asset.location));
    if (card) card.classList.toggle('hidden', !hasAsset);
    if (!image) return;
    if (!hasAsset) {
      image.removeAttribute('src');
      if (title) title.textContent = 'Captured Screenshot';
      if (caption) caption.textContent = '';
      return;
    }
    image.src = safeText(asset.location);
    if (title) title.textContent = safeText(asset.assetName) || 'Captured Screenshot';
    if (caption) {
      const bits = [safeText(asset.assetType), safeText(asset.category), asset.imageWidth && asset.imageHeight ? `${asset.imageWidth}x${asset.imageHeight}` : '']
        .filter(Boolean);
      caption.textContent = bits.join(' | ');
    }
  }

  function renderThumbnailResult(asset) {
    const card = byId('developThumbnailResultCard');
    const image = byId('developThumbnailResultImage');
    const title = byId('developThumbnailResultTitle');
    const caption = byId('developThumbnailResultCaption');
    const hasAsset = Boolean(asset && safeText(asset.location));
    if (card) card.classList.toggle('hidden', !hasAsset);
    if (!image) return;
    if (!hasAsset) {
      image.removeAttribute('src');
      if (title) title.textContent = 'Generated Thumbnail';
      if (caption) caption.textContent = '';
      return;
    }
    image.src = safeText(asset.location);
    if (title) title.textContent = safeText(asset.assetName) || 'Generated Thumbnail';
    if (caption) {
      const bits = [safeText(asset.assetType), safeText(asset.category), asset.imageWidth && asset.imageHeight ? `${asset.imageWidth}x${asset.imageHeight}` : '']
        .filter(Boolean);
      caption.textContent = bits.join(' | ');
    }
  }

  function renderThumbnailSourceAssetOptions() {
    const select = byId('developThumbnailSourceAssetSelect');
    if (!select) return;
    const items = (Array.isArray(state.assets) ? state.assets : [])
      .slice()
      .sort((a, b) => safeText(a?.assetName).localeCompare(safeText(b?.assetName)))
      .map((asset) => ({
        value: safeText(asset.id),
        label: `${assetLabel(asset, 'Asset')} (${safeText(asset.assetType) || 'Unknown'})`,
      }));
    setSelectOptions(select, items, 'Source Asset (Optional)');
  }

  function getBaseLandingTemplateById(templateId) {
    const id = safeText(templateId);
    return LANDING_TEMPLATES.find((item) => item.id === id) || LANDING_TEMPLATES[0];
  }

  function createStarterHeaderModule(column, text, headingLevel = 'H2') {
    const module = createModularPageModule('header', column);
    module.name = safeText(text) || module.name;
    module.settings.text = safeText(text);
    module.settings.headingLevel = safeText(headingLevel) || 'H2';
    return module;
  }

  function createStarterTextBlockModule(column, content) {
    const module = createModularPageModule('textarea', column);
    module.name = safeText(content, 80) || module.name;
    module.settings.content = safeText(content)
      ? `<p>${escapeHtml(safeText(content)).replace(/\n/g, '<br />')}</p>`
      : '<p></p>';
    return module;
  }

  function createStarterFormModule(column, title) {
    const module = createModularPageModule('form', column);
    module.name = safeText(title) || module.name;
    module.settings.title = safeText(title) || module.settings.title;
    return module;
  }

  function buildStarterModularLayoutSections(baseTemplate) {
    const template = baseTemplate || LANDING_TEMPLATES[0];
    const hero = createModularPageSection('4-2');
    hero.title = safeText(template.eyebrow);
    hero.modules = [
      createStarterHeaderModule('col1', safeText(template.headline), 'H1'),
      createStarterTextBlockModule('col1', safeText(template.lead)),
      createStarterFormModule('col2', safeText(template.formTitle)),
    ];

    const features = createModularPageSection('3-3');
    features.modules = [
      createStarterHeaderModule('col1', safeText(template.featureOneTitle), 'H3'),
      createStarterTextBlockModule('col1', safeText(template.featureOneCopy)),
      createStarterHeaderModule('col2', safeText(template.featureTwoTitle), 'H3'),
      createStarterTextBlockModule('col2', safeText(template.featureTwoCopy)),
    ];

    const body = createModularPageSection('6');
    body.modules = [
      createStarterHeaderModule('col1', safeText(template.bodyTitle), 'H2'),
      createStarterTextBlockModule('col1', safeText(template.summary || template.formCopy || template.lead)),
    ];

    return [hero, features, body];
  }

  function getStarterModularPageTemplates() {
    return LANDING_TEMPLATES.map((template) => ({
      id: `starter::${safeText(template.id)}`,
      name: safeText(template.name) || 'Starter Template',
      templateKind: 'modular',
      templateId: safeText(template.id),
      isSystemTemplate: true,
      summary: safeText(template.summary),
      layoutSections: buildStarterModularLayoutSections(template),
      createdAt: '',
      updatedAt: '',
    }));
  }

  function getStarterModularPageTemplateById(templateId) {
    const id = safeText(templateId);
    return getStarterModularPageTemplates().find((item) => safeText(item.id) === id) || null;
  }

  function getSavedPageTemplateById(templateId) {
    const id = safeText(templateId);
    return savedPageTemplates.find((item) => String(item?.id) === id) || null;
  }

  function getUnifiedModularPageTemplates() {
    const saved = savedPageTemplates
      .filter((item) => normalizePageTemplateKind(item.templateKind) === 'modular')
      .map((item) => ({
        ...item,
        isSystemTemplate: false,
      }))
      .sort((a, b) => {
        const aTime = new Date(a?.updatedAt || a?.createdAt || 0).getTime() || 0;
        const bTime = new Date(b?.updatedAt || b?.createdAt || 0).getTime() || 0;
        return bTime - aTime;
      });
    return {
      saved,
      starters: getStarterModularPageTemplates(),
      all: saved.concat(getStarterModularPageTemplates()),
    };
  }

  function getUnifiedModularPageTemplateSelectOptions() {
    return getUnifiedModularPageTemplates().all.map((template) => ({
      value: String(template.id),
      label: `${template.isSystemTemplate ? 'Starter' : 'Template'}: ${safeText(template.name) || 'Untitled Template'}`,
    }));
  }

  function getTemplateById(templateId) {
    const saved = getSavedPageTemplateById(templateId);
    if (saved) return saved;
    const starter = getStarterModularPageTemplateById(templateId);
    if (starter) return starter;
    return getBaseLandingTemplateById(templateId);
  }

  function getPageTemplateSelectOptions() {
    const saved = savedPageTemplates.map((template) => ({
      value: String(template.id),
      label: `${normalizePageTemplateKind(template.templateKind) === 'modular' ? 'Modular' : 'Template'}: ${safeText(template.name) || `Template ${template.id}`}`,
    }));
    const starters = getStarterModularPageTemplates().map((template) => ({
      value: String(template.id),
      label: `Starter: ${safeText(template.name) || 'Starter Template'}`,
    }));
    const base = LANDING_TEMPLATES.map((template) => ({
      value: template.id,
      label: `Base: ${template.name}`,
    }));
    return [...saved, ...starters, ...base];
  }

  function getFormTemplateById(templateId) {
    const id = safeText(templateId);
    return FORM_TEMPLATES.find((item) => item.id === id) || FORM_TEMPLATES[0];
  }

  function buildDefaultFormState(templateId) {
    const template = getFormTemplateById(templateId);
    return {
      id: '',
      name: '',
      formType: template.id,
      contactType: 'lead',
      leadMagnetType: '',
      leadMagnetId: '',
      ctaId: '',
      heading: template.defaultHeading,
      submitLabel: template.defaultSubmitLabel,
      successMessage: 'Thanks. Your request has been received.',
      errorMessage: 'Something went wrong. Please try again.',
      accentColor: DEFAULT_FORM_ACCENT,
      matchLandingColor: false,
      landingColorMode: 'primary',
      useLandingBackground: false,
      required: Object.fromEntries(template.fields.map((field) => [field.key, Boolean(field.required)])),
    };
  }

  function ensureFormBuilderState(templateId) {
    const requestedTemplate = getFormTemplateById(templateId);
    if (!formBuilderState || formBuilderState.formType !== requestedTemplate.id) {
      formBuilderState = buildDefaultFormState(requestedTemplate.id);
    }
    return formBuilderState;
  }

  function renderFormBuilderFieldConfig() {
    const host = byId('developFormFieldsConfig');
    if (!host) return;

    const current = ensureFormBuilderState(byId('developFormTypeSelect')?.value || FORM_TEMPLATES[0].id);
    const template = getFormTemplateById(current.formType);
    host.textContent = '';

    template.fields.forEach((field) => {
      const row = document.createElement('div');
      row.className = 'develop-form-config-row';

      const label = document.createElement('div');
      label.className = 'develop-form-config-label';
      label.textContent = field.label;

      const toggleWrap = document.createElement('label');
      toggleWrap.className = 'checkbox-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(current.required[field.key]);
      checkbox.addEventListener('change', () => {
        current.required[field.key] = checkbox.checked;
        renderFormBuilderPreview();
      });
      toggleWrap.appendChild(checkbox);
      toggleWrap.appendChild(document.createTextNode('Required'));

      row.appendChild(label);
      row.appendChild(toggleWrap);
      host.appendChild(row);
    });
  }

  function renderFormBuilderPreview() {
    const host = byId('developFormPreviewHost');
    if (!host) return;

    const current = ensureFormBuilderState(byId('developFormTypeSelect')?.value || FORM_TEMPLATES[0].id);
    const template = getFormTemplateById(current.formType);
    const accentColor = current.matchLandingColor
      ? MATCH_LANDING_GREY
      : (safeText(current.accentColor) || DEFAULT_FORM_ACCENT);
    const previewBackground = current.matchLandingColor && current.useLandingBackground
      ? landingPageColors.background
      : '';

    host.textContent = '';
    const card = document.createElement('div');
    card.className = 'develop-form-preview';
    card.style.borderColor = accentColor;
    card.style.boxShadow = `0 10px 22px ${accentColor}22`;
    card.style.background = previewBackground || 'linear-gradient(135deg, #ffffff 0%, #f5fbff 100%)';

    const heading = document.createElement('h3');
    heading.textContent = current.heading || template.defaultHeading;
    heading.style.color = accentColor;
    card.appendChild(heading);

    template.fields.forEach((field) => {
      const input = document.createElement('input');
      input.type = field.type;
      input.placeholder = field.label;
      if (current.required[field.key]) input.required = true;
      card.appendChild(input);
    });

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.textContent = getLandingPageCtaLabel(current.ctaId) || current.submitLabel || template.defaultSubmitLabel;
    submitBtn.style.background = accentColor;
    submitBtn.style.borderColor = accentColor;
    submitBtn.style.color = '#ffffff';
    card.appendChild(submitBtn);

    if (current.leadMagnetId) {
      const helper = document.createElement('p');
      helper.style.margin = '0.75rem 0 0 0';
      helper.style.fontSize = '0.84rem';
      helper.style.color = '#36516a';
      helper.textContent = `Lead Magnet: ${getLandingPageAssetName(current.leadMagnetId, 'Selected Asset')}`;
      card.appendChild(helper);
    }

    host.appendChild(card);
  }

  function buildCurrentFormPayload(nameOverride) {
    const current = ensureFormBuilderState(byId('developFormTypeSelect')?.value || FORM_TEMPLATES[0].id);
    const template = getFormTemplateById(current.formType);
    const ctaLabel = getLandingPageCtaLabel(current.ctaId) || current.submitLabel || template.defaultSubmitLabel;
    return {
      id: safeText(current.id),
      name: safeText(nameOverride || byId('developFormNameInput')?.value),
      formType: template.id,
      contactType: safeText(current.contactType) || 'lead',
      leadMagnetType: safeText(current.leadMagnetType),
      leadMagnetId: safeText(current.leadMagnetId),
      ctaId: safeText(current.ctaId),
      heading: current.heading || template.defaultHeading,
      submitLabel: ctaLabel,
      successMessage: safeText(current.successMessage),
      errorMessage: safeText(current.errorMessage),
      accentColor: safeText(current.accentColor) || DEFAULT_FORM_ACCENT,
      matchLandingColor: Boolean(current.matchLandingColor),
      landingColorMode: current.matchLandingColor ? (safeText(current.landingColorMode) || 'primary') : '',
      useLandingBackground: Boolean(current.matchLandingColor && current.useLandingBackground),
      fields: template.fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        required: Boolean(current.required[field.key]),
      })),
    };
  }

  function formatRequiredFieldsSummary(form) {
    const requiredLabels = (Array.isArray(form?.fields) ? form.fields : [])
      .filter((field) => Boolean(field?.required))
      .map((field) => safeText(field?.label))
      .filter(Boolean);
    return requiredLabels.length ? requiredLabels.join(', ') : 'None';
  }

  function getFilteredSortedForms() {
    const rows = savedForms.slice();
    const direction = formTableState.sort.dir === 'asc' ? 1 : -1;
    const getValue = (row, key) => {
      switch (key) {
        case 'name':
          return safeText(row?.name).toLowerCase();
        case 'formType':
          return safeText(getFormTemplateById(row?.formType).name).toLowerCase();
        case 'leadMagnetType':
          return safeText(getFormLeadMagnetTypeDisplayLabel(row?.leadMagnetType)).toLowerCase();
        case 'leadMagnetId':
          return safeText(getLandingPageAssetName(row?.leadMagnetId, '')).toLowerCase();
        case 'ctaId':
          return safeText(getLandingPageCtaLabel(row?.ctaId)).toLowerCase();
        case 'contactType':
          return safeText(row?.contactType).toLowerCase();
        case 'updatedAt':
        default:
          return new Date(row?.updatedAt || row?.createdAt || 0).getTime();
      }
    };
    rows.sort((a, b) => {
      const left = getValue(a, formTableState.sort.key);
      const right = getValue(b, formTableState.sort.key);
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
      return String(left).localeCompare(String(right)) * direction;
    });
    return rows;
  }

  function applySavedFormToBuilder(form) {
    const template = getFormTemplateById(form?.formType);
    const required = Object.fromEntries(template.fields.map((field) => [field.key, false]));
    (Array.isArray(form?.fields) ? form.fields : []).forEach((field) => {
      const key = safeText(field?.key);
      if (key && Object.prototype.hasOwnProperty.call(required, key)) {
        required[key] = Boolean(field?.required);
      }
    });

    formBuilderState = {
      id: safeText(form?.id),
      name: safeText(form?.name),
      formType: template.id,
      contactType: safeText(form?.contactType) || 'lead',
      leadMagnetType: safeText(form?.leadMagnetType),
      leadMagnetId: safeText(form?.leadMagnetId),
      ctaId: safeText(form?.ctaId),
      heading: safeText(form?.heading) || template.defaultHeading,
      submitLabel: safeText(form?.submitLabel) || template.defaultSubmitLabel,
      successMessage: safeText(form?.successMessage) || 'Thanks. Your request has been received.',
      errorMessage: safeText(form?.errorMessage) || 'Something went wrong. Please try again.',
      accentColor: safeText(form?.accentColor) || DEFAULT_FORM_ACCENT,
      matchLandingColor: Boolean(form?.matchLandingColor),
      landingColorMode: safeText(form?.landingColorMode) || 'primary',
      useLandingBackground: Boolean(form?.useLandingBackground),
      required,
    };

    const nameInput = byId('developFormNameInput');
    if (nameInput) nameInput.value = safeText(form?.name);
    const editorTitle = byId('developFormsEditorTitle');
    if (editorTitle) editorTitle.textContent = 'Edit Form';
    byId('developFormEditorPanel')?.classList.remove('hidden');
    syncFormBuilderInputs();
    renderFormBuilderFieldConfig();
    renderFormBuilderPreview();
  }

  function renderSavedForms() {
    const tbody = byId('developFormsTableBody');
    if (!tbody) return;

    tbody.textContent = '';
    if (!savedForms.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 8;
      cell.textContent = 'No saved forms yet.';
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }

    getFilteredSortedForms().forEach((form) => {
      const row = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.textContent = safeText(form.name) || '-';

      const typeTd = document.createElement('td');
      typeTd.textContent = getFormTemplateById(form.formType).name;

      const leadMagnetTypeTd = document.createElement('td');
      leadMagnetTypeTd.textContent = getFormLeadMagnetTypeDisplayLabel(form.leadMagnetType) || '-';

      const leadMagnetTd = document.createElement('td');
      leadMagnetTd.textContent = getLandingPageAssetName(form.leadMagnetId, '-') || '-';

      const ctaTd = document.createElement('td');
      ctaTd.textContent = getLandingPageCtaLabel(form.ctaId) || '-';

      const contactTypeTd = document.createElement('td');
      contactTypeTd.textContent = CONTACT_TYPE_OPTIONS.find((item) => item.value === safeText(form.contactType))?.label || safeText(form.contactType) || '-';

      const updatedTd = document.createElement('td');
      updatedTd.textContent = form.updatedAt ? new Date(form.updatedAt).toLocaleString() : '-';

      const actionsTd = document.createElement('td');
      const editBtn = App.makeIconButton('edit', 'Edit Form', () => {
        applySavedFormToBuilder(form);
        notify(`Editing form: ${safeText(form.name) || form.id}`);
      });
      const cloneBtn = App.makeIconButton('clone', 'Clone Form', async () => {
        try {
          const payload = {
            name: safeText(form.name),
            formType: safeText(form.formType),
            contactType: safeText(form.contactType),
            leadMagnetType: safeText(form.leadMagnetType),
            leadMagnetId: safeText(form.leadMagnetId),
            ctaId: safeText(form.ctaId),
            heading: safeText(form.heading),
            submitLabel: safeText(form.submitLabel),
            successMessage: safeText(form.successMessage),
            errorMessage: safeText(form.errorMessage),
            accentColor: safeText(form.accentColor),
            matchLandingColor: Boolean(form.matchLandingColor),
            landingColorMode: safeText(form.landingColorMode),
            useLandingBackground: Boolean(form.useLandingBackground),
            fields: Array.isArray(form.fields)
              ? form.fields.map((field) => ({
                  key: safeText(field?.key),
                  label: safeText(field?.label),
                  type: safeText(field?.type),
                  required: Boolean(field?.required),
                }))
              : [],
          };
          await api('/api/develop/forms', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          await refresh();
          notify('Form cloned');
        } catch (err) {
          notify(err.message, true);
        }
      }, { marginLeft: '8px' });
      const deleteBtn = App.makeIconButton('delete', 'Delete Form', async () => {
        if (!window.confirm(`Delete form "${safeText(form.name) || form.id}"?`)) return;
        try {
          await api(`/api/develop/forms/${encodeURIComponent(form.id)}`, { method: 'DELETE' });
          await refresh();
          notify('Form deleted');
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(cloneBtn);
      actionsTd.appendChild(deleteBtn);

      row.appendChild(nameTd);
      row.appendChild(typeTd);
      row.appendChild(leadMagnetTypeTd);
      row.appendChild(leadMagnetTd);
      row.appendChild(ctaTd);
      row.appendChild(contactTypeTd);
      row.appendChild(updatedTd);
      row.appendChild(actionsTd);
      tbody.appendChild(row);
    });
  }

  function resetDevelopModuleForm() {
    const idInput = byId('developModulesIdInput');
    const nameInput = byId('developModulesNameInput');
    const typeSelect = byId('developModulesTypeSelect');
    if (idInput) idInput.value = '';
    if (nameInput) nameInput.value = '';
    updateDevelopModuleTypeFields();
    if (nameInput) nameInput.focus();
  }

  function getDevelopModuleTypeDefinition(type) {
    const normalized = safeText(type);
    if (normalized === 'izzy') return null;
    return MODULE_TYPE_DEFINITIONS.find((item) => item.value === normalized) || MODULE_TYPE_DEFINITIONS[0];
  }

  function getDevelopModuleStarterBlueprints() {
    return MODULE_TYPE_DEFINITIONS.map((definition) => ({
      name: definition.starterName,
      moduleType: definition.value,
      settings: { ...(definition.defaults || {}) },
    }));
  }

  function getCanonicalSavedModules(modulesInput = savedModules) {
    const seen = new Map();
    (Array.isArray(modulesInput) ? modulesInput : []).forEach((module) => {
      const typeKey = safeText(module?.moduleType).toLowerCase();
      let nameKey = safeText(module?.name).toLowerCase();
      if (typeKey === 'textarea' && nameKey === 'textarea') {
        nameKey = 'text block';
      }
      const key = `${typeKey}::${nameKey}`;
      if (!key || key === '::') return;
      const nextTime = new Date(module?.updatedAt || module?.createdAt || 0).getTime();
      const existing = seen.get(key);
      const existingTime = existing ? new Date(existing.updatedAt || existing.createdAt || 0).getTime() : -1;
      if (!existing || nextTime >= existingTime) {
        seen.set(key, module);
      }
    });
    return Array.from(seen.values()).sort((a, b) => {
      const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return bTime - aTime;
    });
  }

  function getDevelopModuleContentSourceOptions(kind) {
    const normalized = safeText(kind).toLowerCase();
    if (normalized === 'headline') {
      return landingPageHeadlines.map((item) => ({
        value: safeText(item?.id),
        label: safeText(item?.headline) || safeText(item?.id) || 'Untitled headline',
        content: safeText(item?.headline, 10000),
      })).filter((item) => item.value);
    }
    if (normalized === 'pitch') {
      return landingPagePitches.map((item) => ({
        value: safeText(item?.id),
        label: safeText(item?.pitch) || safeText(item?.id) || 'Untitled pitch',
        content: safeText(item?.pitch, 10000),
      })).filter((item) => item.value);
    }
    if (normalized === 'subheading') {
      return landingPageSubheadings.map((item) => ({
        value: safeText(item?.id),
        label: safeText(item?.subheading) || safeText(item?.id) || 'Untitled sub-heading',
        content: safeText(item?.subheading, 10000),
      })).filter((item) => item.value);
    }
    if (normalized === 'cta') {
      return landingPageCtas.map((item) => ({
        value: safeText(item?.id),
        label: safeText(item?.cta) || safeText(item?.id) || 'Untitled CTA',
        content: safeText(item?.cta, 10000),
      })).filter((item) => item.value);
    }
    return [];
  }

  function applyDevelopModuleContentSelection(control, field, selectedOption) {
    if (!control || !field || !selectedOption) return;
    const nextContent = safeText(selectedOption.content, 20000);
    if (field.control === 'richtext') {
      control.textContent = '';
      const cParser = new DOMParser();
      const cDoc = cParser.parseFromString(
        nextContent ? `<p>${escapeHtml(nextContent).replace(/\\n/g, '<br />')}</p>` : '<p></p>',
        'text/html'
      );
      Array.from(cDoc.body.childNodes).forEach(n => control.appendChild(n.cloneNode(true)));
      return;
    }
    if ('value' in control) {
      control.value = nextContent;
    }
  }

  function populateDevelopModuleTypeOptions() {
    const select = byId('developModulesTypeSelect');
    if (!select) return;
    select.textContent = '';
    MODULE_TYPE_DEFINITIONS.forEach((definition) => {
      const option = document.createElement('option');
      option.value = definition.value;
      option.textContent = definition.label;
      select.appendChild(option);
    });
  }

  function renderDevelopModuleSettingsFieldsInto(host, type, settings = {}, options = {}) {
    if (!host) return;
    const help = options.helpNode || null;
    const prefix = safeText(options.prefix) || 'developModuleField';
    const definition = getDevelopModuleTypeDefinition(type) || MODULE_TYPE_DEFINITIONS[0];
    host.textContent = '';
    host.className = 'grid-form';
    if (help) {
      help.textContent = safeText(definition.description, 500);
    }

    definition.fields.forEach((field) => {
      if (field.control === 'modular-background') {
        const bgPrefix = `${prefix}_${field.key}`;
        const background = normalizeBackgroundSettings(
          settings?.[field.key],
          settings?.backgroundColor,
          settings?.backgroundImageId
        );
        const wrap = document.createElement('div');
        wrap.className = 'stack-form develop-module-background-field-wrap';
        wrap.setAttribute('data-module-bg-field-key', field.key);
        const controlsParser = new DOMParser();
        const controlsDoc = controlsParser.parseFromString(
          buildModularBackgroundControlsHtml(bgPrefix, background),
          'text/html'
        );
        Array.from(controlsDoc.body.childNodes).forEach((node) => wrap.appendChild(node.cloneNode(true)));
        host.appendChild(wrap);
        const imagePickerHost = wrap.querySelector(`#${bgPrefix}ImagePickerHost`);
        if (imagePickerHost) {
          mountDevelopInlineImagePicker(imagePickerHost, {
            inputId: `${bgPrefix}ImageAssetInput`,
            initialValue: safeText(background.imageAssetId),
            title: safeText(field.label) || 'Background Image',
            onChange: (assetId) => {
              const urlInput = wrap.querySelector(`#${bgPrefix}ImageUrlInput`);
              if (urlInput && assetId) urlInput.value = getLandingPageAssetUrl(assetId) || urlInput.value;
            },
          });
        }
        syncModularBackgroundControlVisibility(wrap, bgPrefix);
        wrap.querySelector(`#${bgPrefix}ModeSelect`)?.addEventListener('change', () => {
          syncModularBackgroundControlVisibility(wrap, bgPrefix);
        });
        return;
      }

      const wrap = document.createElement('label');
      wrap.className = field.control === 'textarea' ? 'stack-form' : 'stack-form';
      if (prefix === 'developModuleField') {
        wrap.classList.add('develop-modules-studio-row');
      }
      const label = document.createElement('span');
      label.textContent = field.label;
      wrap.appendChild(label);

      const value = Object.prototype.hasOwnProperty.call(settings || {}, field.key)
        ? settings[field.key]
        : definition.defaults?.[field.key];

      let control = null;
      const contentSettingKey = safeText(field.contentSettingKey) || `${field.key}SourceId`;
      if (field.contentSource) {
        const pickerWrap = document.createElement('label');
        pickerWrap.className = 'stack-form';
        if (prefix === 'developModuleField') {
          pickerWrap.classList.add('develop-modules-studio-row');
        }
        const pickerLabel = document.createElement('span');
        pickerLabel.textContent = safeText(field.contentLabel) || 'Saved Content';
        pickerWrap.appendChild(pickerLabel);
        const picker = document.createElement('select');
        picker.id = `${prefix}_${field.key}_source`;
        picker.setAttribute('data-module-field-source-key', contentSettingKey);
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = 'None';
        picker.appendChild(empty);
        const contentOptions = getDevelopModuleContentSourceOptions(field.contentSource);
        contentOptions.forEach((item) => {
          const option = document.createElement('option');
          option.value = item.value;
          option.textContent = item.label;
          picker.appendChild(option);
        });
        picker.value = safeText(settings?.[contentSettingKey]);
        picker.addEventListener('change', () => {
          const selectedOption = contentOptions.find((item) => item.value === safeText(picker.value));
          if (selectedOption && control) {
            applyDevelopModuleContentSelection(control, field, selectedOption);
          }
        });
        pickerWrap.appendChild(picker);
        host.appendChild(pickerWrap);
      }

      if (field.control === 'image-asset-picker') {
        const pickerId = `${prefix}_${field.key}`;
        const pickerConfig = {
          selectId: pickerId,
          title: safeText(field.pickerTitle) || safeText(field.label) || 'Image',
        };
        const currentAssetId = safeText(value);
        const currentAsset = getAssetById(currentAssetId);
        const currentImageUrl = currentAsset
          ? toDirectAssetUrl(currentAsset.location)
          : '';

        wrap.className = 'stack-form develop-module-image-field';

        control = document.createElement('input');
        control.type = 'hidden';
        control.id = pickerId;
        control.value = currentAssetId;
        control.setAttribute('data-module-field-key', field.key);
        control.setAttribute('data-module-field-control', field.control);

        const pickerControls = document.createElement('div');
        pickerControls.className = 'develop-inline-asset-nav';

        const chooseBtn = document.createElement('button');
        chooseBtn.type = 'button';
        chooseBtn.className = 'btn btn-ghost';
        chooseBtn.textContent = currentAsset ? `Change ${pickerConfig.title}` : `Choose ${pickerConfig.title}`;

        const status = document.createElement('button');
        status.type = 'button';
        status.className = 'develop-inline-asset-status develop-inline-asset-status-btn';

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'btn btn-ghost';
        clearBtn.textContent = 'Clear';

        const preview = document.createElement('div');
        preview.className = 'develop-inline-asset-preview';

        const updatePickerState = () => {
          const selectedId = safeText(control.value);
          const asset = getAssetById(selectedId);
          const imageUrl = asset ? toDirectAssetUrl(asset.location) : '';
          chooseBtn.textContent = asset ? `Change ${pickerConfig.title}` : `Choose ${pickerConfig.title}`;
          status.textContent = asset ? assetLabel(asset, pickerConfig.title) : 'No image selected';
          preview.textContent = '';
          if (imageUrl) {
            const img = document.createElement('img');
            img.src = imageUrl;
            img.alt = safeText(assetLabel(asset, pickerConfig.title));
            preview.appendChild(img);
          } else {
            const empty = document.createElement('span');
            empty.textContent = 'No image selected';
            preview.appendChild(empty);
          }
        };

        const openPicker = () => {
          const modal = openImageAssetPicker(pickerConfig, {
            dialogClass: 'develop-module-image-picker-modal',
            backdropClass: 'develop-module-image-picker-backdrop',
            getValue: () => safeText(control.value),
            setValue: (nextValue) => {
              control.value = safeText(nextValue);
            },
            afterChange: () => {
              updatePickerState();
            },
            uploadHandler: async (file) => {
              if (!file) return null;
              if (!String(file.type || '').startsWith('image/')) {
                throw new Error('Please choose an image file');
              }
              const buffer = await file.arrayBuffer();
              const bytes = new Uint8Array(buffer);
              let binary = '';
              const chunkSize = 0x8000;
              for (let index = 0; index < bytes.length; index += chunkSize) {
                binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
              }
              const result = await api('/api/assets/upload-google-drive', {
                method: 'POST',
                body: JSON.stringify({
                  fileName: file.name,
                  mimeType: file.type || 'application/octet-stream',
                  fileBase64: btoa(binary),
                  fileSize: Number(file.size || 0),
                  assetType: 'Image',
                  assetName: file.name.replace(/\.[^.]+$/, '') || file.name,
                  category: 'Image',
                  tags: ['module', 'gallery'],
                }),
              });
              const asset = result?.asset || result?.data?.asset || null;
              if (!asset?.id) throw new Error('Image upload did not return an asset');
              state.assets = [asset].concat(Array.isArray(state.assets) ? state.assets.filter((item) => String(item.id) !== String(asset.id)) : []);
              return asset;
            },
          });
          if (!modal) {
            notify(`Could not open the image picker for ${pickerConfig.title}`, true);
          }
        };

        const pickerLabel = `Choose ${pickerConfig.title}`;
        bindAssetPickerTrigger(chooseBtn, openPicker, pickerLabel);
        bindAssetPickerTrigger(status, openPicker, pickerLabel);
        bindAssetPickerTrigger(preview, openPicker, pickerLabel);

        clearBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          control.value = '';
          updatePickerState();
        });

        pickerControls.appendChild(chooseBtn);
        pickerControls.appendChild(status);
        pickerControls.appendChild(clearBtn);
        wrap.appendChild(pickerControls);
        wrap.appendChild(preview);
        wrap.appendChild(control);
        updatePickerState();
        host.appendChild(wrap);
        return;
      }

      if (field.control === 'video-asset-picker') {
        const pickerId = `${prefix}_${field.key}`;
        const currentAssetId = safeText(value);
        const currentAsset = getAssetById(currentAssetId);
        wrap.className = 'stack-form develop-module-image-field';

        control = document.createElement('input');
        control.type = 'hidden';
        control.id = pickerId;
        control.value = currentAssetId;
        control.setAttribute('data-module-field-key', field.key);
        control.setAttribute('data-module-field-control', field.control);

        const pickerControls = document.createElement('div');
        pickerControls.className = 'develop-inline-asset-nav';

        const videoTitle = safeText(field.pickerTitle) || safeText(field.label) || 'Video';
        const chooseBtn = document.createElement('button');
        chooseBtn.type = 'button';
        chooseBtn.className = 'btn btn-ghost';
        chooseBtn.textContent = currentAsset ? `Change ${videoTitle}` : `Choose ${videoTitle}`;

        const status = document.createElement('button');
        status.type = 'button';
        status.className = 'develop-inline-asset-status develop-inline-asset-status-btn';

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'btn btn-ghost';
        clearBtn.textContent = 'Clear';

        const preview = document.createElement('div');
        preview.className = 'develop-inline-asset-preview';

        const updatePickerState = () => {
          const selectedId = safeText(control.value);
          const asset = getAssetById(selectedId);
          chooseBtn.textContent = asset ? `Change ${videoTitle}` : `Choose ${videoTitle}`;
          status.textContent = asset ? assetLabel(asset, videoTitle) : 'No video selected';
          preview.textContent = '';
          const meta = document.createElement('span');
          meta.textContent = asset ? (safeText(asset.category) || 'Video asset') : 'No video selected';
          preview.appendChild(meta);
        };

        const openPicker = () => {
          openVideoAssetPicker({
            title: videoTitle,
            getValue: () => safeText(control.value),
            setValue: (nextValue) => {
              control.value = safeText(nextValue);
            },
            afterChange: () => {
              updatePickerState();
            },
          });
        };

        bindAssetPickerTrigger(chooseBtn, openPicker, `Choose ${videoTitle}`);
        bindAssetPickerTrigger(status, openPicker, `Choose ${videoTitle}`);
        bindAssetPickerTrigger(preview, openPicker, `Choose ${videoTitle}`);

        clearBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          control.value = '';
          updatePickerState();
        });

        pickerControls.appendChild(chooseBtn);
        pickerControls.appendChild(status);
        pickerControls.appendChild(clearBtn);
        wrap.appendChild(pickerControls);
        wrap.appendChild(preview);
        wrap.appendChild(control);
        updatePickerState();
        host.appendChild(wrap);
        return;
      }

      if (field.control === 'saved-form-picker') {
        const pickerId = `${prefix}_${field.key}`;
        const currentFormId = safeText(value);
        wrap.className = 'stack-form develop-module-image-field';

        control = document.createElement('input');
        control.type = 'hidden';
        control.id = pickerId;
        control.value = currentFormId;
        control.setAttribute('data-module-field-key', field.key);
        control.setAttribute('data-module-field-control', field.control);

        const pickerControls = document.createElement('div');
        pickerControls.className = 'develop-inline-asset-nav';

        const chooseBtn = document.createElement('button');
        chooseBtn.type = 'button';

        const status = document.createElement('span');
        status.className = 'develop-inline-asset-status';

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = 'Clear';

        const preview = document.createElement('div');
        preview.className = 'develop-inline-asset-preview';

        const updatePickerState = () => {
          const selectedId = safeText(control.value);
          const form = savedForms.find((item) => safeText(item.id) === selectedId) || null;
          chooseBtn.textContent = form ? `Change ${field.label}` : `Choose ${field.label}`;
          status.textContent = form ? (safeText(form.name) || safeText(form.id)) : 'No form selected';
          preview.textContent = '';
          const meta = document.createElement('span');
          meta.textContent = form
            ? `${safeText(form.formType) || 'Form'} · ${Array.isArray(form.fields) ? form.fields.length : 0} fields`
            : 'No form selected';
          preview.appendChild(meta);
        };

        chooseBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          openSavedFormPicker({
            title: field.label,
            getValue: () => safeText(control.value),
            setValue: (nextValue) => {
              control.value = safeText(nextValue);
            },
            afterChange: () => {
              updatePickerState();
            },
          });
        });

        clearBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          control.value = '';
          updatePickerState();
        });

        pickerControls.appendChild(chooseBtn);
        pickerControls.appendChild(status);
        pickerControls.appendChild(clearBtn);
        wrap.appendChild(pickerControls);
        wrap.appendChild(preview);
        wrap.appendChild(control);
        updatePickerState();
        host.appendChild(wrap);
        return;
      }

      if (field.control === 'table-contents-editor') {
        const editorId = `${prefix}_${field.key}`;
        wrap.className = 'stack-form develop-module-image-field';

        control = document.createElement('input');
        control.type = 'hidden';
        control.id = editorId;
        control.value = typeof value === 'string' ? value : JSON.stringify(normalizeDevelopTableContents(value));
        control.setAttribute('data-module-field-key', field.key);
        control.setAttribute('data-module-field-control', field.control);

        const pickerControls = document.createElement('div');
        pickerControls.className = 'develop-inline-asset-nav';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.textContent = 'Edit Contents';

        const status = document.createElement('span');
        status.className = 'develop-inline-asset-status';

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = 'Clear';

        const preview = document.createElement('div');
        preview.className = 'develop-inline-asset-preview';

        const getDimensions = () => ({
          columnsCount: Number(byId(`${prefix}_columnsCount`)?.value) || Number(settings?.columnsCount) || 3,
          rowsCount: Number(byId(`${prefix}_rowsCount`)?.value) || Number(settings?.rowsCount) || 4,
        });

        const updateTableState = () => {
          const { columnsCount, rowsCount } = getDimensions();
          const normalized = normalizeDevelopTableContents(control.value, columnsCount, rowsCount);
          control.value = JSON.stringify(normalized);
          status.textContent = getDevelopTableContentsSummary(normalized, columnsCount, rowsCount);
          preview.textContent = '';
          const meta = document.createElement('span');
          const configured = normalized.filter((cell) => safeText(cell?.cellType) !== 'empty').length;
          meta.textContent = configured
            ? `${configured} cell${configured === 1 ? '' : 's'} configured`
            : 'No cell content configured yet';
          preview.appendChild(meta);
        };

        editBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          openDevelopTableContentsEditor({
            title: field.label,
            getValue: () => control.value,
            setValue: (nextValue) => {
              control.value = safeText(nextValue, 500000);
            },
            getDimensions,
            afterChange: () => {
              updateTableState();
            },
          });
        });

        clearBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          control.value = '[]';
          updateTableState();
        });

        pickerControls.appendChild(editBtn);
        pickerControls.appendChild(status);
        pickerControls.appendChild(clearBtn);
        wrap.appendChild(pickerControls);
        wrap.appendChild(preview);
        wrap.appendChild(control);
        updateTableState();
        host.appendChild(wrap);
        return;
      }

      if (field.control === 'nav-menu-editor') {
        const editorId = `${prefix}_${field.key}`;
        wrap.className = 'stack-form develop-module-nav-menu-field';

        control = document.createElement('input');
        control.type = 'hidden';
        control.id = editorId;
        control.value = typeof value === 'string'
          ? value
          : (App.developNavMenu?.serializeNavMenuItems?.(value) || '[]');
        control.setAttribute('data-module-field-key', field.key);
        control.setAttribute('data-module-field-control', field.control);

        const pickerControls = document.createElement('div');
        pickerControls.className = 'develop-inline-asset-nav';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn btn-ghost';
        editBtn.textContent = 'Edit Menu';

        const status = document.createElement('span');
        status.className = 'develop-inline-asset-status';

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'btn btn-ghost';
        clearBtn.textContent = 'Reset';

        const preview = document.createElement('div');
        preview.className = 'develop-nav-menu-inline-preview';

        const updateNavState = () => {
          status.textContent = App.developNavMenu?.getNavMenuSummary?.(control.value) || 'No menu items';
          preview.innerHTML = App.developNavMenu?.buildNavigationModuleMarkup?.({
            menuName: safeText(settings?.menuName) || 'Menu Preview',
            menuLocation: safeText(settings?.menuLocation) || 'primary',
            variant: safeText(settings?.variant) || 'horizontal',
            navItems: control.value,
            navFontSize: settings?.navFontSize,
            navBold: settings?.navBold,
            navBorderRadius: settings?.navBorderRadius,
            navPadding: settings?.navPadding,
            navColor: settings?.navColor,
            navHoverColor: settings?.navHoverColor,
            navHoverBackground: settings?.navHoverBackground,
            showSubmenuIndicator: settings?.showSubmenuIndicator,
          }, { includeDataAttrs: false }) || '';
        };

        editBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          App.developNavMenu?.openNavMenuEditor?.({
            title: field.label || 'Edit Menu',
            getValue: () => control.value,
            setValue: (nextValue) => {
              control.value = safeText(nextValue, 500000);
            },
            afterChange: () => {
              updateNavState();
            },
          });
        });

        clearBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          control.value = App.developNavMenu?.defaultNavMenuItemsJson?.() || '[]';
          updateNavState();
        });

        pickerControls.appendChild(editBtn);
        pickerControls.appendChild(status);
        pickerControls.appendChild(clearBtn);
        wrap.appendChild(pickerControls);
        wrap.appendChild(preview);
        wrap.appendChild(control);
        updateNavState();
        host.appendChild(wrap);
        return;
      }

      if (field.control === 'textarea') {
        control = document.createElement('textarea');
        control.rows = Number(field.rows) || 3;
        control.value = safeText(value, 10000);
      } else if (field.control === 'richtext') {
        wrap.className = 'stack-form';
        const toolbar = document.createElement('div');
        toolbar.className = 'develop-richtext-toolbar';
        const editor = document.createElement('div');
        editor.id = `${prefix}_${field.key}`;
        editor.className = 'develop-richtext-editor';
        editor.contentEditable = 'true';
        editor.setAttribute('data-module-field-key', field.key);
        editor.setAttribute('data-module-field-control', field.control);
        editor.setAttribute('data-placeholder', field.placeholder || '');
        const eParser = new DOMParser();
        const eDoc = eParser.parseFromString(safeHtml(value) || '<p></p>', 'text/html');
        editor.textContent = '';
        Array.from(eDoc.body.childNodes).forEach(n => editor.appendChild(n.cloneNode(true)));

        [
          { label: 'B', command: 'bold' },
          { label: 'I', command: 'italic' },
          { label: 'U', command: 'underline' },
          { label: 'UL', command: 'insertUnorderedList' },
          { label: 'OL', command: 'insertOrderedList' },
        ].forEach((tool) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'develop-richtext-tool';
          button.textContent = tool.label;
          button.addEventListener('click', (event) => {
            event.preventDefault();
            editor.focus();
            document.execCommand(tool.command, false, null);
          });
          toolbar.appendChild(button);
        });

        const linkButton = document.createElement('button');
        linkButton.type = 'button';
        linkButton.className = 'develop-richtext-tool';
        linkButton.textContent = 'Link';
        linkButton.addEventListener('click', (event) => {
          event.preventDefault();
          const href = window.prompt('Enter link URL');
          if (!href) return;
          editor.focus();
          document.execCommand('createLink', false, href);
        });
        toolbar.appendChild(linkButton);

        wrap.appendChild(toolbar);
        wrap.appendChild(editor);
        if (App.richText && typeof App.richText.createRichTextEditor === 'function') {
          App.richText.createRichTextEditor({
            element: editor,
            toolbar,
            content: safeHtml(value),
            placeholder: field.placeholder || '',
          }).catch((err) => {
            console.warn('TipTap editor failed to initialize; using fallback editor instead.', err);
          });
        }
        host.appendChild(wrap);
        return;
      } else if (field.control === 'select') {
        control = document.createElement('select');
        (field.options || []).forEach((optionValue) => {
          const option = document.createElement('option');
          option.value = String(optionValue);
          option.textContent = String(optionValue);
          control.appendChild(option);
        });
        control.value = safeText(value) || String(field.options?.[0] || '');
      } else if (field.control === 'saved-form-select') {
        control = document.createElement('select');
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = savedForms.length ? 'Choose a form' : 'No forms available yet';
        control.appendChild(empty);
        savedForms.forEach((form) => {
          const option = document.createElement('option');
          option.value = safeText(form.id);
          option.textContent = safeText(form.name) || safeText(form.id);
          control.appendChild(option);
        });
        control.value = safeText(value);
      } else if (field.control === 'poll-options') {
        control = document.createElement('input');
        control.type = 'hidden';
        control.value = safeText(value, 10000);
        
        const listContainer = document.createElement('div');
        listContainer.style.display = 'flex';
        listContainer.style.flexDirection = 'column';
        listContainer.style.gap = '0.5rem';
        listContainer.style.marginTop = '0.5rem';
        
        const updateControlValue = () => {
          const inputs = Array.from(listContainer.querySelectorAll('.poll-option-dynamic-input'));
          const vals = inputs.map(i => String(i.value || '').trim()).filter(Boolean);
          control.value = vals.join(', ');
        };

        const createRow = (val = '') => {
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.gap = '0.5rem';
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'poll-option-dynamic-input';
          input.value = val;
          input.placeholder = field.placeholder || 'Option...';
          input.addEventListener('input', updateControlValue);
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.innerHTML = '&times;';
          remove.style.background = 'transparent';
          remove.style.border = 'none';
          remove.style.color = 'var(--danger)';
          remove.style.cursor = 'pointer';
          remove.addEventListener('click', () => { row.remove(); updateControlValue(); });
          row.appendChild(input);
          row.appendChild(remove);
          return row;
        };

        const existing = String(control.value || '').split(',').map(s => s.trim()).filter(Boolean);
        if (existing.length) existing.forEach(opt => listContainer.appendChild(createRow(opt)));
        else { listContainer.appendChild(createRow('')); listContainer.appendChild(createRow('')); }
        
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn';
        addBtn.textContent = '+ Add Option';
        addBtn.style.alignSelf = 'flex-start';
        addBtn.addEventListener('click', () => listContainer.appendChild(createRow('')));
        
        listContainer.appendChild(addBtn);
        wrap.appendChild(listContainer);

      } else if (field.control === 'poll-csv-upload') {
        control = document.createElement('input');
        control.type = 'hidden';
        control.value = '';
        
        const uploadWrap = document.createElement('div');
        uploadWrap.style.display = 'flex';
        uploadWrap.style.gap = '1rem';
        uploadWrap.style.alignItems = 'center';
        uploadWrap.style.marginTop = '0.5rem';
        uploadWrap.style.padding = '1rem';
        uploadWrap.style.background = 'var(--bg-alt)';
        uploadWrap.style.borderRadius = '8px';
        
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.csv';
        fileInput.style.flex = '1';
        
        const importBtn = document.createElement('button');
        importBtn.type = 'button';
        importBtn.className = 'btn btn-primary';
        importBtn.textContent = 'Import CSV';
        
        const status = document.createElement('div');
        status.style.fontSize = '0.85rem';
        status.style.color = 'var(--muted)';
        status.style.marginTop = '0.5rem';
        
        importBtn.addEventListener('click', async () => {
          const file = fileInput.files[0];
          if (!file) { status.textContent = 'Please select a CSV file first.'; return; }
          importBtn.textContent = 'Importing...';
          importBtn.disabled = true;
          try {
            const text = await file.text();
            const rawRows = App.parseCsv(text);
            if (!rawRows || rawRows.length < 2) throw new Error('CSV must have a header row and at least one data row.');
            const headers = rawRows[0].map(h => String(h || '').trim());
            const rows = rawRows.slice(1).map(rowArr => {
              const obj = {};
              headers.forEach((h, i) => { obj[h] = rowArr[i]; });
              return obj;
            });
            const res = await App.api('/api/polls/import', {
              method: 'POST',
              body: JSON.stringify({ rows })
            });
            status.textContent = `Successfully imported ${res.data?.count || 0} polls from ${file.name}`;
            status.style.color = 'var(--success)';
            fileInput.value = '';
            if (typeof loadDevelopPolls === 'function') loadDevelopPolls();
          } catch (err) {
            status.textContent = 'Import failed: ' + err.message;
            status.style.color = 'var(--danger)';
          } finally {
            importBtn.textContent = 'Import CSV';
            importBtn.disabled = false;
          }
        });
        
        uploadWrap.appendChild(fileInput);
        uploadWrap.appendChild(importBtn);
        wrap.appendChild(uploadWrap);
        wrap.appendChild(status);
        
      } else if (field.control === 'color') {
        const fallbackColor = normalizeModuleHexColorValue(definition.defaults?.[field.key], '#173c61');
        const storedColor = safeText(value);
        const isTransparent = Boolean(field.allowTransparent) && isTransparentBuilderColor(storedColor);
        if (field.allowTransparent) {
          control = document.createElement('input');
          control.type = 'hidden';
          control.value = isTransparent ? 'transparent' : resolveModuleColorValue(storedColor, fallbackColor);
          const fieldRow = document.createElement('div');
          fieldRow.className = 'develop-module-color-field-row';
          const colorInput = document.createElement('input');
          colorInput.type = 'color';
          colorInput.className = 'develop-module-color-field-swatch';
          colorInput.value = normalizeModuleHexColorValue(
            isTransparent ? fallbackColor : storedColor,
            fallbackColor
          );
          colorInput.disabled = isTransparent;
          const transparentLabel = document.createElement('label');
          transparentLabel.className = 'checkbox-row develop-module-color-transparent-row';
          const transparentCheck = document.createElement('input');
          transparentCheck.type = 'checkbox';
          transparentCheck.checked = isTransparent;
          transparentCheck.setAttribute('data-color-transparent-toggle', field.key);
          const transparentText = document.createElement('span');
          transparentText.textContent = 'Transparent';
          transparentLabel.appendChild(transparentCheck);
          transparentLabel.appendChild(transparentText);
          const syncColorValue = () => {
            control.value = transparentCheck.checked
              ? 'transparent'
              : normalizeModuleHexColorValue(colorInput.value, fallbackColor);
          };
          transparentCheck.addEventListener('change', () => {
            colorInput.disabled = transparentCheck.checked;
            syncColorValue();
          });
          colorInput.addEventListener('input', () => {
            if (!transparentCheck.checked) syncColorValue();
          });
          fieldRow.appendChild(colorInput);
          fieldRow.appendChild(transparentLabel);
          wrap.appendChild(fieldRow);
        } else {
          control = document.createElement('input');
          control.type = 'color';
          control.value = normalizeModuleHexColorValue(storedColor, fallbackColor);
        }
      } else if (field.control === 'number') {
        control = document.createElement('input');
        control.type = 'number';
        control.value = value === null || value === undefined || value === '' ? '' : String(value);
        if (field.min !== undefined) control.min = String(field.min);
        if (field.max !== undefined) control.max = String(field.max);
        if (field.step !== undefined) control.step = String(field.step);
      } else if (field.control === 'checkbox') {
        wrap.className = 'checkbox-row';
        control = document.createElement('input');
        control.type = 'checkbox';
        control.checked = Boolean(value);
        wrap.textContent = '';
        wrap.appendChild(control);
        wrap.appendChild(label);
      } else {
        control = document.createElement('input');
        control.type = 'text';
        control.value = safeText(value, 10000);
      }

      control.id = `${prefix}_${field.key}`;
      control.setAttribute('data-module-field-key', field.key);
      control.setAttribute('data-module-field-control', field.control);
      if (field.placeholder && 'placeholder' in control) {
        control.placeholder = field.placeholder;
      }
      if (field.control !== 'checkbox') {
        wrap.appendChild(control);
      }
      host.appendChild(wrap);
    });
  }

  function renderDevelopModuleSettingsFields(type, settings = {}) {
    const host = byId('developModulesSettingsFields');
    const help = byId('developModulesTypeHelp');
    renderDevelopModuleSettingsFieldsInto(host, type, settings, { helpNode: help, prefix: 'developModuleField' });
  }

  function getDevelopModuleSettingsFromHost(type, options = {}) {
    const definition = getDevelopModuleTypeDefinition(type) || MODULE_TYPE_DEFINITIONS[0];
    const prefix = safeText(options.prefix) || 'developModuleField';
    const root = options.hostElement && typeof options.hostElement.querySelector === 'function'
      ? options.hostElement
      : document;
    const settings = {};
    definition.fields.forEach((field) => {
      if (field.control === 'modular-background') {
        const bgPrefix = `${prefix}_${field.key}`;
        const controlsRoot = root.querySelector(`[data-modular-bg-prefix="${bgPrefix}"]`);
        const panel = controlsRoot?.closest('.develop-module-background-field-wrap') || root;
        const background = backgroundSettingsForSave(readModularBackgroundFromPanel(panel, bgPrefix));
        settings[field.key] = background;
        const bg = normalizeBackgroundSettings(background);
        settings.backgroundColor = bg.mode === 'color'
          ? safeText(bg.color)
          : (bg.mode === 'transparent' ? 'transparent' : '');
        if (bg.mode === 'image') {
          settings.backgroundImageId = safeText(bg.imageAssetId, 120);
        }
        return;
      }
      const input = root.querySelector(`#${prefix}_${field.key}`) || byId(`${prefix}_${field.key}`);
      if (!input) return;
      if (field.contentSource) {
        const contentSettingKey = safeText(field.contentSettingKey) || `${field.key}SourceId`;
        const sourceInput = root.querySelector(`#${prefix}_${field.key}_source`) || byId(`${prefix}_${field.key}_source`);
        settings[contentSettingKey] = safeText(sourceInput?.value);
      }
      if (field.control === 'checkbox') {
        settings[field.key] = Boolean(input.checked);
      } else if (field.control === 'richtext') {
        settings[field.key] = App.richText && typeof App.richText.getHtml === 'function'
          ? App.richText.getHtml(input)
          : String(input.innerHTML || '').trim();
      } else if (field.control === 'number') {
        const raw = safeText(input.value);
        if (raw === '') {
          settings[field.key] = '';
        } else {
          const parsed = Number(raw);
          settings[field.key] = Number.isFinite(parsed) ? parsed : '';
        }
      } else if (field.control === 'color' && field.allowTransparent) {
        const transparentToggle = root.querySelector(`[data-color-transparent-toggle="${field.key}"]`);
        settings[field.key] = transparentToggle?.checked ? 'transparent' : safeText(input.value, 10000);
      } else {
        settings[field.key] = safeText(input.value, 10000);
      }
    });
    return settings;
  }

  function getDevelopModuleSettingsFromForm(type) {
    return getDevelopModuleSettingsFromHost(type, {
      prefix: 'developModuleField',
      hostElement: byId('developModulesSettingsFields'),
    });
  }

  function getDevelopModulePayloadFromForm() {
    const moduleType = safeText(byId('developModulesTypeSelect')?.value) || 'header';
    return {
      id: safeText(byId('developModulesIdInput')?.value),
      name: safeText(byId('developModulesNameInput')?.value),
      moduleType,
      classId: safeText(byId('developModulesClassSelect')?.value) || null,
      settings: getDevelopModuleSettingsFromForm(moduleType),
    };
  }

  function getDevelopModulePreview(module) {
    const type = safeText(module?.moduleType);
    const settings = module?.settings || {};
    if (type === 'header') {
      return `${safeText(settings.headingLevel) || 'H1'}: ${safeText(settings.text) || getDevelopModuleContentSourceOptions('headline').find((item) => item.value === safeText(settings.headlineId))?.label || 'No text set'}`;
    }
    if (type === 'form') {
      return `${safeText(settings.title) || getDevelopModuleContentSourceOptions('headline').find((item) => item.value === safeText(settings.headlineId))?.label || 'Form'} · ${safeText(getSavedFormName(settings.formId)) || 'No form linked'}`;
    }
    if (type === 'button') {
      const ctaLabel = getDevelopModuleContentSourceOptions('cta').find((item) => item.value === safeText(settings.ctaId))?.label || '';
      return `${safeText(settings.label) || ctaLabel || 'Button'} · ${safeText(settings.style) || 'solid'} · ${safeText(settings.linkUrl) || 'No link set'}`;
    }
    if (type === 'navigation') {
      const menuName = safeText(settings.menuName) || 'Menu';
      const summary = App.developNavMenu?.getNavMenuSummary?.(settings.navItems) || 'No menu items';
      const location = safeText(settings.menuLocation) || 'primary';
      return `${menuName} · ${location} · ${summary}`;
    }
    if (type === 'image') {
      const imageAsset = getAssetById(settings.imageAssetId);
      const imageLabel = imageAsset
        ? assetLabel(imageAsset, 'Image')
        : (safeText(settings.altText) || 'Image');
      return `${imageLabel} · ${safeText(settings.aspectRatio) || 'auto'} · ${safeText(settings.maxWidth)}%`;
    }
    if (type === 'video') {
      const videoAsset = getAssetById(settings.videoAssetId);
      const videoLabel = videoAsset
        ? assetLabel(videoAsset, 'Video')
        : (safeText(settings.videoUrl) ? 'Video linked' : 'No video set');
      return `${videoLabel} · ${safeText(settings.aspectRatio) || '16:9'}`;
    }
    if (type === 'table') {
      const columnsCount = Number(settings.columnsCount) || 0;
      const rowsCount = Number(settings.rowsCount) || 0;
      const configured = normalizeDevelopTableContents(settings.tableContents, columnsCount || 1, rowsCount || 1)
        .filter((cell) => safeText(cell?.cellType) !== 'empty').length;
      return `${safeText(settings.caption) || getDevelopModuleContentSourceOptions('headline').find((item) => item.value === safeText(settings.headlineId))?.label || 'Table'} · ${columnsCount} cols · ${rowsCount} rows · ${configured} cells`;
    }
    if (type === 'textarea') {
      return `${safeText(settings.content, 120).replace(/<[^>]+>/g, ' ') || getDevelopModuleContentSourceOptions('pitch').find((item) => item.value === safeText(settings.pitchId))?.label || 'No content set'} · ${safeText(settings.maxWidth) || 'full'}`;
    }
    if (type === 'pod') {
      return `${safeText(settings.title) || 'Channel Pod'} · ${safeText(settings.description, 60) || 'No description'}`;
    }
    return safeText(module?.name) || '-';
  }

  function getSavedModuleById(moduleId) {
    const id = safeText(moduleId);
    if (!id) return null;
    return savedModules.find((item) => safeText(item?.id) === id) || null;
  }

  function applyDevelopModuleToForm(module) {
    if (!module) {
      resetDevelopModuleForm();
      return;
    }
    const idInput = byId('developModulesIdInput');
    const nameInput = byId('developModulesNameInput');
    const typeSelect = byId('developModulesTypeSelect');
    if (idInput) idInput.value = safeText(module.id);
    if (nameInput) nameInput.value = safeText(module.name);
    if (typeSelect) typeSelect.value = safeText(module.moduleType) || 'header';
    updateDevelopModuleTypeFields(module.settings || {});
  }

  let savedModulesGrid = null;

  function setupSavedModulesGrid() {
    const mountPoint = byId('developModulesGridMountPoint');
    if (!mountPoint) return;

    const modules = getCanonicalSavedModules(savedModules)
      .filter((module) => Boolean(getDevelopModuleTypeDefinition(module.moduleType)));

    if (!savedModulesGrid) {
      savedModulesGrid = App.components.DataGrid({
        columns: [
          {
            key: 'name',
            label: 'Name',
            render: (val, row) => {
              const displayName = safeText(row.moduleType) === 'textarea' && safeText(row.name).toLowerCase() === 'textarea'
                ? 'Text Block'
                : safeText(row.name) || '-';
              return displayName;
            }
          },
          {
            key: 'moduleType',
            label: 'Type',
            render: (val) => (getDevelopModuleTypeDefinition(val) || { label: safeText(val) || '-' }).label
          },
          {
            key: 'preview',
            label: 'Preview',
            sortable: false,
            render: (val, row) => getDevelopModulePreview(row)
          },
          {
            key: 'updatedAt',
            label: 'Updated',
            render: (val) => val ? new Date(val).toLocaleString() : '-'
          },
          {
            key: 'actions',
            label: 'Actions',
            sortable: false,
            render: (val, row) => {
              const div = document.createElement('div');
              const editBtn = App.makeIconButton('edit', 'Edit Module', () => {
                applyDevelopModuleToForm(row);
                updateDevelopModuleTypeFields();
                const modal = byId('developModulesModal');
                if (modal) modal.showModal();
                notify(`Editing module: ${safeText(row.name) || row.id}`);
              });
              const cloneBtn = App.makeIconButton('clone', 'Clone Module', async () => {
                try {
                  const payload = {
                    name: safeText(row.name),
                    moduleType: safeText(row.moduleType),
                    settings: row && typeof row.settings === 'object' ? JSON.parse(JSON.stringify(row.settings)) : {},
                  };
                  await api('/api/develop/modules', {
                    method: 'POST',
                    body: JSON.stringify(payload),
                  });
                  await refresh();
                  notify('Module cloned');
                } catch (err) {
                  notify(err.message, true);
                }
              }, { marginLeft: '8px' });
              const deleteBtn = App.makeIconButton('delete', 'Delete Module', async () => {
                if (!window.confirm(`Delete module "${safeText(row.name) || row.id}"?`)) return;
                try {
                  await api(`/api/develop/modules/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
                  await refresh();
                  notify('Module deleted');
                } catch (err) {
                  notify(err.message, true);
                }
              }, { danger: true, marginLeft: '8px' });

              div.appendChild(editBtn);
              div.appendChild(cloneBtn);
              div.appendChild(deleteBtn);
              return div;
            }
          }
        ],
        rows: modules,
        emptyMessage: 'No saved modules yet.',
        filterable: true,
        sortable: true,
        selectable: true,
        bulkActions: [
          {
            label: 'Delete Selected',
            danger: true,
            onClick: async (selectedIds, clearSelection) => {
              if (!confirm(`Are you sure you want to delete ${selectedIds.length} module(s)?`)) return;
              try {
                await Promise.all(selectedIds.map(id => api(`/api/develop/modules/${encodeURIComponent(id)}`, { method: 'DELETE' })));
                notify(`${selectedIds.length} module(s) deleted`);
                clearSelection();
                await refresh();
              } catch (err) {
                notify(err.message, true);
              }
            }
          }
        ]
      });
      mountPoint.appendChild(savedModulesGrid.el);
    } else {
      savedModulesGrid.update({ rows: modules });
    }
  }


  async function loadSavedForms() {
    const result = await api('/api/develop/forms');
    savedForms = Array.isArray(result.forms) ? result.forms : [];
  }

  async function loadSavedModules() {
    try {
      const result = await api('/api/develop/modules');
      savedModules = App.normalizeApiArray(result, 'modules');
      const starterModules = getDevelopModuleStarterBlueprints();
      const canonicalModules = getCanonicalSavedModules(savedModules);
      const missingStarterModules = starterModules.filter((starter) => !canonicalModules.some((module) => {
        const sameType = safeText(module.moduleType) === safeText(starter.moduleType);
        const moduleName = safeText(module.name).toLowerCase();
        const starterName = safeText(starter.name).toLowerCase();
        const sameName = moduleName === starterName
          || (safeText(module.moduleType) === 'textarea' && moduleName === 'textarea' && starterName === 'text block');
        return sameType && sameName;
      }));
      if (missingStarterModules.length) {
        for (const module of missingStarterModules) {
          // Seed the first-pass module library once per empty project.
          await api('/api/develop/modules', {
            method: 'POST',
            body: JSON.stringify(module),
          });
        }
        const seeded = await api('/api/develop/modules');
        savedModules = App.normalizeApiArray(seeded, 'modules');
      }
    } catch (_) {
      savedModules = [];
    }
  }

  async function loadSavedModuleClasses() {
    try {
      const result = await api('/api/develop/module-classes');
      savedModuleClasses = Array.isArray(result.classes) ? result.classes : [];
    } catch (_) {
      savedModuleClasses = [];
    }
  }

  function renderDevelopModuleClasses() {
    const tbody = byId('developClassesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (!savedModuleClasses.length) {
      tbody.innerHTML = '<tr><td colspan="3">No module classes created yet.</td></tr>';
      return;
    }

    savedModuleClasses.forEach((cls) => {
      const row = document.createElement('tr');
      
      const nameTd = document.createElement('td');
      nameTd.textContent = cls.name;
      
      const createdTd = document.createElement('td');
      createdTd.className = 'meta';
      createdTd.textContent = cls.createdAt ? new Date(cls.createdAt).toLocaleDateString() : '';
      
      const actionsTd = document.createElement('td');
      actionsTd.className = 'develop-agents-actions-cell';
      
      const editBtn = App.makeIconButton('edit', 'Edit Class', async () => {
        const newName = window.prompt(`Rename module class "${safeText(cls.name)}":`, cls.name);
        if (!newName || newName === cls.name) return;
        try {
          await api(`/api/develop/module-classes/${encodeURIComponent(cls.id)}`, { 
            method: 'PATCH',
            body: JSON.stringify({ name: newName })
          });
          await refresh();
          notify('Module class renamed');
        } catch (err) {
          notify(err.message, true);
        }
      });

      const deleteBtn = App.makeIconButton('delete', 'Delete Class', async () => {
        if (!window.confirm(`Delete module class "${safeText(cls.name)}"?`)) return;
        try {
          await api(`/api/develop/module-classes/${encodeURIComponent(cls.id)}`, { method: 'DELETE' });
          await refresh();
          notify('Module class deleted');
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(deleteBtn);
      
      row.appendChild(nameTd);
      row.appendChild(createdTd);
      row.appendChild(actionsTd);
      tbody.appendChild(row);
    });
  }

  function populateDevelopModulesClassSelect() {
    const select = byId('developModulesClassSelect');
    if (!select) return;
    const prev = select.value;
    select.innerHTML = '<option value="">None</option>';
    savedModuleClasses.forEach((cls) => {
      const option = document.createElement('option');
      option.value = cls.id;
      option.textContent = cls.name;
      select.appendChild(option);
    });
    if (prev) {
      select.value = prev;
    }
  }


  async function updateDevelopModuleTypeFields(settings = null) {
    const type = safeText(byId('developModulesTypeSelect')?.value) || 'header';
    const definition = getDevelopModuleTypeDefinition(type);
    if (definition?.fields?.some((field) => field.control === 'modular-background')) {
      await ensureAssetsLoaded().catch(() => {});
    }
    renderDevelopModuleSettingsFields(type, settings || {});
  }

  async function loadSavedThemes() {
    const result = await api('/api/develop/themes');
    savedThemes = Array.isArray(result.themes) ? result.themes : [];
    if (!selectedThemeId && savedThemes[0]?.id) {
      selectedThemeId = String(savedThemes[0].id);
    }
    if (selectedThemeId && !savedThemes.some((item) => String(item.id) === String(selectedThemeId))) {
      selectedThemeId = String(savedThemes[0]?.id || '');
    }
  }

  async function loadSavedEmailTemplates() {
    const result = await api('/api/develop/email-templates');
    savedEmailTemplates = Array.isArray(result.emailTemplates) ? result.emailTemplates : [];
    if (!selectedEmailTemplateId && savedEmailTemplates[0]?.id) {
      selectedEmailTemplateId = String(savedEmailTemplates[0].id);
    }
    if (selectedEmailTemplateId && !savedEmailTemplates.some((item) => String(item.id) === String(selectedEmailTemplateId))) {
      selectedEmailTemplateId = String(savedEmailTemplates[0]?.id || '');
    }
  }

  async function loadSavedLandingPages() {
    const result = await api('/api/develop/landing-pages');
    savedLandingPages = Array.isArray(result.landingPages) ? result.landingPages : [];
  }

  async function loadSavedPageTemplates() {
    try {
      const result = await api('/api/develop/page-templates');
      savedPageTemplates = Array.isArray(result.pageTemplates) ? result.pageTemplates : [];
    } catch (_) {
      savedPageTemplates = [];
    }
  }

  async function loadSavedExtensions() {
    const result = await api('/api/develop/extensions');
    savedExtensions = Array.isArray(result.extensions) ? result.extensions : [];
  }

  async function loadExtensionManagerConfig() {
    try {
      const result = await api('/api/develop/extensions-manager');
      const manager = result.manager || result.data || {};
      extensionManagerConfig = {
        defaultFilters: manager.defaultFilters && typeof manager.defaultFilters === 'object' ? manager.defaultFilters : {},
        defaultSortKey: safeText(manager.defaultSortKey) || 'updatedAt',
        defaultSortDir: safeText(manager.defaultSortDir) || 'desc',
      };
      extensionTableState.filters = {
        name: safeText(extensionManagerConfig.defaultFilters.name),
        extensionType: safeText(extensionManagerConfig.defaultFilters.extensionType),
        status: safeText(extensionManagerConfig.defaultFilters.status),
        tags: safeText(extensionManagerConfig.defaultFilters.tags),
      };
      extensionTableState.sort = {
        key: safeText(extensionManagerConfig.defaultSortKey) || 'updatedAt',
        dir: safeText(extensionManagerConfig.defaultSortDir) || 'desc',
      };
    } catch (_) {
      extensionManagerConfig = {
        defaultFilters: {},
        defaultSortKey: 'updatedAt',
        defaultSortDir: 'desc',
      };
    }
  }

  async function saveExtensionManagerConfig() {
    try {
      await api('/api/develop/extensions-manager', {
        method: 'POST',
        body: JSON.stringify({
          defaultFilters: { ...extensionTableState.filters },
          defaultSortKey: extensionTableState.sort.key,
          defaultSortDir: extensionTableState.sort.dir,
        }),
      });
    } catch (_) {
      // Non-blocking UI preference persistence.
    }
  }

  function getExtensionTypeLabel(value) {
    return EXTENSION_TYPE_OPTIONS.find((item) => item.value === safeText(value))?.label || safeText(value) || '-';
  }

  function buildExtensionPath(id, map, seen = new Set()) {
    const cleanId = safeText(id);
    if (!cleanId || seen.has(cleanId)) return '';
    const item = map.get(cleanId);
    if (!item) return '';
    seen.add(cleanId);
    const parentPath = buildExtensionPath(item.parentId, map, seen);
    const name = safeText(item.name) || cleanId;
    return parentPath ? `${parentPath} / ${name}` : name;
  }

  function populateExtensionParentSelect(currentId) {
    const select = byId('developExtensionParentSelect');
    if (!select) return;
    const current = safeText(currentId);
    const map = new Map(savedExtensions.map((item) => [safeText(item.id), item]));
    const options = savedExtensions
      .filter((item) => safeText(item.id) && safeText(item.id) !== current)
      .map((item) => ({
        value: item.id,
        label: buildExtensionPath(item.id, map),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    setSelectOptions(select, options, 'Parent Extension (Optional)');
  }

  function resetExtensionManagerForm() {
    const form = byId('developExtensionManagerForm');
    if (form) form.reset();
    const idInput = byId('developExtensionIdInput');
    const statusSelect = byId('developExtensionStatusSelect');
    const submitBtn = byId('developExtensionSubmitBtn');
    if (idInput) idInput.value = '';
    if (statusSelect) statusSelect.value = 'active';
    if (submitBtn) submitBtn.textContent = 'Save Extension';
    populateExtensionParentSelect('');
  }

  function deriveExtensionSlug(name) {
    return safeText(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 160);
  }

  function applyExtensionToForm(item) {
    const idInput = byId('developExtensionIdInput');
    const nameInput = byId('developExtensionNameInput');
    const typeSelect = byId('developExtensionTypeSelect');
    const parentSelect = byId('developExtensionParentSelect');
    const statusSelect = byId('developExtensionStatusSelect');
    const tagsInput = byId('developExtensionTagsInput');
    const summaryInput = byId('developExtensionSummaryInput');
    const definitionInput = byId('developExtensionDefinitionInput');
    const submitBtn = byId('developExtensionSubmitBtn');
    if (idInput) idInput.value = safeText(item?.id);
    if (nameInput) nameInput.value = safeText(item?.name);
    if (typeSelect) typeSelect.value = safeText(item?.extensionType);
    populateExtensionParentSelect(safeText(item?.id));
    if (parentSelect) parentSelect.value = safeText(item?.parentId);
    if (statusSelect) statusSelect.value = safeText(item?.status) || 'active';
    if (tagsInput) tagsInput.value = safeText(item?.tags);
    if (summaryInput) summaryInput.value = safeText(item?.summary, 1000);
    if (definitionInput) definitionInput.value = safeText(item?.definition, 10000);
    if (submitBtn) submitBtn.textContent = 'Update Extension';
    App.setActivePage('developExtensionsManagerPage');
  }

  function sortExtensionsForLanding(rows) {
    return rows.slice().sort((a, b) => {
      const featuredDelta = (b.isFeatured === true ? 1 : 0) - (a.isFeatured === true ? 1 : 0);
      if (featuredDelta) return featuredDelta;
      const usageDelta = (Number(b.usageCount || 0) || 0) - (Number(a.usageCount || 0) || 0);
      if (usageDelta) return usageDelta;
      const left = new Date(b.lastUsedAt || b.updatedAt || 0).getTime();
      const right = new Date(a.lastUsedAt || a.updatedAt || 0).getTime();
      if (left !== right) return left - right;
      return safeText(a.name).localeCompare(safeText(b.name));
    });
  }

  async function openExtensionItem(item) {
    if (!item) return;
    try {
      if (safeText(item.id)) {
        await api(`/api/develop/extensions/${encodeURIComponent(item.id)}/use`, { method: 'POST' });
      }
    } catch (_) {
      // Non-blocking usage tracking.
    }
    await refresh();
    const launchPageId = safeText(item.launchPageId);
    if (launchPageId) {
      App.setActivePage(launchPageId);
      return;
    }
    applyExtensionToForm(item);
  }

  function renderExtensionsLanding() {
    const host = byId('developExtensionsFeaturedGrid');
    if (!host) return;
    host.textContent = '';
    if (!savedExtensions.length) {
      const empty = document.createElement('div');
      empty.className = 'messaging-content-node';
      empty.textContent = 'No extensions yet.';
      host.appendChild(empty);
      return;
    }

    const header = document.createElement('div');
    header.className = 'develop-extensions-header';
    ['Extension Name', 'Extension Type', 'Summary'].forEach((label) => {
      const cell = document.createElement('div');
      cell.className = 'develop-extensions-header-cell';
      cell.textContent = label;
      header.appendChild(cell);
    });
    host.appendChild(header);

    const byParent = new Map();
    savedExtensions.forEach((item) => {
      const parentKey = safeText(item.parentId) || 'root';
      if (!byParent.has(parentKey)) byParent.set(parentKey, []);
      byParent.get(parentKey).push(item);
    });

    const renderNode = (item, depth = 0) => {
      const id = safeText(item.id);
      const children = sortExtensionsForLanding(byParent.get(id) || []);
      const hasChildren = children.length > 0;
      const isCollapsed = hasChildren && collapsedExtensionIds.has(id);

      const row = document.createElement('div');
      row.className = 'develop-extension-table-row';

      const nameCell = document.createElement('div');
      nameCell.className = 'develop-extension-name-cell';
      nameCell.style.setProperty('--extension-depth', String(depth));

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = `develop-extension-tree-toggle${hasChildren ? '' : ' is-empty'}`;
      toggle.textContent = hasChildren ? (isCollapsed ? '▶' : '▼') : '▶';
      toggle.disabled = !hasChildren;
      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!hasChildren) return;
        if (collapsedExtensionIds.has(id)) collapsedExtensionIds.delete(id);
        else collapsedExtensionIds.add(id);
        renderExtensionsLanding();
      });

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'develop-extension-name-link';
      button.addEventListener('click', () => {
        openExtensionItem(item).catch((err) => {
          notify(err.message, true);
        });
      });

      button.textContent = safeText(item.name) || 'Extension';

      const typeCell = document.createElement('div');
      typeCell.className = 'develop-extension-table-cell';
      typeCell.textContent = getExtensionTypeLabel(item.extensionType);

      const summaryCell = document.createElement('div');
      summaryCell.className = 'develop-extension-table-cell develop-extension-summary-cell';
      summaryCell.textContent = safeText(item.summary, 220) || 'Open extension';

      nameCell.appendChild(toggle);
      nameCell.appendChild(button);
      row.appendChild(nameCell);
      row.appendChild(typeCell);
      row.appendChild(summaryCell);

      return row;
    };

    const appendVisibleNodes = (item, depth = 0) => {
      const id = safeText(item.id);
      const children = sortExtensionsForLanding(byParent.get(id) || []);
      const hasChildren = children.length > 0;
      const isCollapsed = hasChildren && collapsedExtensionIds.has(id);
      host.appendChild(renderNode(item, depth));
      if (hasChildren && !isCollapsed) {
        children.forEach((child) => {
          appendVisibleNodes(child, depth + 1);
        });
      }
    };

    const roots = sortExtensionsForLanding(byParent.get('root') || []);
    roots.forEach((item) => {
      appendVisibleNodes(item, 0);
    });
  }

  function getFilteredSortedExtensions() {
    const map = new Map(savedExtensions.map((item) => [safeText(item.id), item]));
    const filters = extensionTableState.filters;
    const rows = savedExtensions
      .filter((item) => {
        const name = safeText(item.name).toLowerCase();
        const tags = safeText(item.tags).toLowerCase();
        const type = safeText(item.extensionType);
        const status = safeText(item.status);
        if (filters.name && !name.includes(filters.name.toLowerCase())) return false;
        if (filters.extensionType && type !== filters.extensionType) return false;
        if (filters.status && status !== filters.status) return false;
        if (filters.tags && !tags.includes(filters.tags.toLowerCase())) return false;
        return true;
      })
      .map((item) => ({
        ...item,
        taxonomyPath: buildExtensionPath(item.id, map),
      }));

    const { key, dir } = extensionTableState.sort;
    rows.sort((a, b) => {
      let left = '';
      let right = '';
      if (key === 'updatedAt') {
        left = new Date(a.updatedAt || 0).getTime();
        right = new Date(b.updatedAt || 0).getTime();
      } else if (key === 'taxonomyPath') {
        left = safeText(a.taxonomyPath).toLowerCase();
        right = safeText(b.taxonomyPath).toLowerCase();
      } else {
        left = safeText(a[key]).toLowerCase();
        right = safeText(b[key]).toLowerCase();
      }
      if (left < right) return dir === 'asc' ? -1 : 1;
      if (left > right) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    return rows;
  }

  function renderExtensionsTable() {
    const tbody = byId('developExtensionsTableBody');
    const typeFilter = byId('developExtensionsFilterType');
    const nameFilter = byId('developExtensionsFilterName');
    const statusFilter = byId('developExtensionsFilterStatus');
    const tagsFilter = byId('developExtensionsFilterTags');
    if (!tbody) return;
    if (nameFilter) nameFilter.value = extensionTableState.filters.name;
    if (typeFilter) {
      setSelectOptions(typeFilter, EXTENSION_TYPE_OPTIONS, 'All Types', extensionTableState.filters.extensionType);
    }
    if (statusFilter) statusFilter.value = extensionTableState.filters.status;
    if (tagsFilter) tagsFilter.value = extensionTableState.filters.tags;

    tbody.textContent = '';
    const rows = getFilteredSortedExtensions();
    if (!rows.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.textContent = 'No extensions yet.';
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }

    rows.forEach((item) => {
      const row = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.textContent = safeText(item.name) || '-';

      const typeTd = document.createElement('td');
      typeTd.textContent = getExtensionTypeLabel(item.extensionType);

      const pathTd = document.createElement('td');
      pathTd.textContent = safeText(item.taxonomyPath) || '-';

      const statusTd = document.createElement('td');
      statusTd.textContent = safeText(item.status) || '-';

      const updatedTd = document.createElement('td');
      updatedTd.textContent = item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '-';

      const actionsTd = document.createElement('td');
      const viewBtn = App.makeIconButton('view', 'Open Extension', () => {
        openExtensionItem(item).catch((err) => {
          notify(err.message, true);
        });
      });
      const editBtn = App.makeIconButton('edit', 'Edit Extension', () => {
        applyExtensionToForm(item);
        notify(`Loaded extension: ${safeText(item.name) || item.id}`);
      }, { marginLeft: '8px' });
      const deleteBtn = App.makeIconButton('delete', 'Delete Extension', async () => {
        if (!window.confirm(`Delete extension "${safeText(item.name) || item.id}"?`)) return;
        try {
          await api(`/api/develop/extensions/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
          await refresh();
          notify('Extension deleted');
          resetExtensionManagerForm();
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actionsTd.appendChild(viewBtn);
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(deleteBtn);

      row.appendChild(nameTd);
      row.appendChild(typeTd);
      row.appendChild(pathTd);
      row.appendChild(statusTd);
      row.appendChild(updatedTd);
      row.appendChild(actionsTd);
      tbody.appendChild(row);
    });
  }

  function getLandingPageFormPayload(formData) {
    const landingPageId = safeText(formData.get('landing_page_id'));
    const existing = savedLandingPages.find((item) => safeText(item.id) === landingPageId) || null;
    const templateId = safeText(formData.get('template_id')) || selectedTemplateId;
    const selectedSavedTemplate = getSavedPageTemplateById(templateId);
    return {
      name: safeText(formData.get('landing_page_name')),
      templateKind: normalizePageTemplateKind(existing?.templateKind || selectedSavedTemplate?.templateKind),
      templateId,
      primaryColor: landingPageColors.primary,
      backgroundColor: landingPageColors.background,
      accentColor: landingPageColors.accent,
      formId: safeText(formData.get('form_id')),
      leadMagnetId: safeText(formData.get('lead_magnet_id')),
      headlineId: safeText(formData.get('headline_id')),
      pitchId: safeText(formData.get('pitch_id')),
      ctaId: safeText(formData.get('cta_id')),
      websiteBannerImageId: safeText(formData.get('website_banner_image_id')),
      backgroundImageId: safeText(formData.get('background_image_id')),
      featureImageId: safeText(formData.get('feature_image_id')),
      highlightImageId: safeText(formData.get('highlight_image_id')),
      featureHeadlineId: safeText(formData.get('feature_headline_id')),
      featureSubheadingId: safeText(formData.get('feature_subheading_id')),
      featureTitle: safeText(formData.get('feature_title'), 500),
      featureCopy: safeText(formData.get('feature_copy'), 5000),
      highlightHeadlineId: safeText(formData.get('highlight_headline_id')),
      highlightPitchId: safeText(formData.get('highlight_pitch_id')),
      highlightTitle: safeText(formData.get('highlight_title'), 500),
      highlightCopy: safeText(formData.get('highlight_copy'), 5000),
      bodyHeadlineId: safeText(formData.get('body_headline_id')),
      bodySubheadingId: safeText(formData.get('body_subheading_id')),
      bodyPitchId: safeText(formData.get('body_pitch_id')),
      logoWideId: safeText(formData.get('logo_wide_id')),
      logoSquareId: safeText(formData.get('logo_square_id')),
      layoutSections: normalizePageTemplateLayoutSections(existing?.layoutSections).length
        ? normalizePageTemplateLayoutSections(existing?.layoutSections)
        : normalizePageTemplateLayoutSections(selectedSavedTemplate?.layoutSections),
      contentOverrides: normalizeLandingPageContentOverrides(existing?.contentOverrides),
    };
  }

  function getLandingPageTemplateName(templateId) {
    const saved = getSavedPageTemplateById(templateId);
    if (saved) return safeText(saved.name) || `Template ${saved.id}`;
    const starter = getStarterModularPageTemplateById(templateId);
    if (starter) return safeText(starter.name) || 'Starter Template';
    return getBaseLandingTemplateById(templateId).name;
  }

  function getLandingPageFieldRows(key) {
    const fieldKey = safeText(key);
    if (fieldKey === 'formId') return savedForms.slice();
    if (fieldKey === 'leadMagnetId') return getAssetsByType('Lead Magnet');
    if (fieldKey === 'headlineId' || fieldKey === 'featureHeadlineId' || fieldKey === 'highlightHeadlineId' || fieldKey === 'bodyHeadlineId') {
      return landingPageHeadlines.slice();
    }
    if (fieldKey === 'featureSubheadingId' || fieldKey === 'bodySubheadingId') {
      return landingPageSubheadings.slice();
    }
    if (fieldKey === 'pitchId' || fieldKey === 'highlightPitchId' || fieldKey === 'bodyPitchId') {
      return landingPagePitches.slice();
    }
    if (fieldKey === 'ctaId') return landingPageCtas.slice();
    if (fieldKey === 'websiteBannerImageId') {
      return getAssetsByCategoryAliases(
        ['Banner Image', 'Website Banner', 'Website Banner Image', 'Hero Banner', 'Article Banner'],
        'Image'
      );
    }
    if (fieldKey === 'backgroundImageId') {
      return getAssetsByCategoryAliases(['Background Image'], 'Image');
    }
    if (fieldKey === 'featureImageId') {
      return getAssetsByCategoryAliases(['Feature Image', 'Feature', 'Feature Graphic', 'Featured Image'], 'Image');
    }
    if (fieldKey === 'highlightImageId') {
      return getAssetsByCategoryAliases(['Highlight Image', 'Highlight'], 'Image');
    }
    if (fieldKey === 'logoSquareId') {
      return getAssetsByCategoryAliases(['Logo - Square', 'Square Logo'], 'Image');
    }
    if (fieldKey === 'logoWideId') {
      return getAssetsByCategoryAliases(['Logo - Wide', 'Wide Logo'], 'Image');
    }
    return [];
  }

  function getLandingPageFieldOptionLabel(key, row) {
    const fieldKey = safeText(key);
    if (fieldKey === 'formId') {
      return safeText(row?.name) || getFormTemplateById(row?.formType).name;
    }
    if (fieldKey === 'headlineId' || fieldKey === 'featureHeadlineId' || fieldKey === 'highlightHeadlineId' || fieldKey === 'bodyHeadlineId') {
      return safeText(row?.headline) || `Headline ${safeText(row?.id)}`;
    }
    if (fieldKey === 'featureSubheadingId' || fieldKey === 'bodySubheadingId') {
      return safeText(row?.subheading) || `Sub-heading ${safeText(row?.id)}`;
    }
    if (fieldKey === 'pitchId' || fieldKey === 'highlightPitchId' || fieldKey === 'bodyPitchId') {
      return safeText(row?.pitch) || `Pitch ${safeText(row?.id)}`;
    }
    if (fieldKey === 'ctaId') {
      return safeText(row?.cta) || `CTA ${safeText(row?.id)}`;
    }
    return assetLabel(row, `Item ${safeText(row?.id)}`);
  }

  function getLandingPageFieldFilterMeta(key) {
    const fieldKey = safeText(key);
    if (fieldKey === 'formId') {
      return {
        placeholder: 'All Form Types',
        label: 'Form Type Filter',
        getValue: (row) => safeText(row?.formType),
        getLabel: (value) => getFormTemplateById(value).name,
      };
    }
    if ([
      'leadMagnetId',
      'headlineId',
      'featureHeadlineId',
      'highlightHeadlineId',
      'bodyHeadlineId',
      'featureSubheadingId',
      'bodySubheadingId',
      'pitchId',
      'highlightPitchId',
      'bodyPitchId',
      'ctaId',
      'websiteBannerImageId',
      'backgroundImageId',
      'featureImageId',
      'highlightImageId',
      'logoSquareId',
      'logoWideId',
    ].includes(fieldKey)) {
      return {
        placeholder: 'All Categories',
        label: 'Category Filter',
        getValue: (row) => safeText(row?.category),
        getLabel: (value) => value || 'Uncategorized',
      };
    }
    return null;
  }

  function getLandingPageDefaultSelectorFilters() {
    try {
      const raw = window.localStorage.getItem(LANDING_SELECTOR_DEFAULTS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function getLandingPageFilterState(fieldKey) {
    const key = safeText(fieldKey);
    if (!landingPageSelectorFilterState[key]) {
      const defaults = getLandingPageDefaultSelectorFilters();
      const saved = defaults && typeof defaults[key] === 'object' ? defaults[key] : {};
      if (key === 'formId') {
        landingPageSelectorFilterState[key] = {
          formType: safeText(saved.formType),
        };
      } else if ([
        'leadMagnetId',
        'websiteBannerImageId',
        'backgroundImageId',
        'featureImageId',
        'highlightImageId',
        'logoSquareId',
        'logoWideId',
      ].includes(key)) {
        landingPageSelectorFilterState[key] = {
          asset_name: safeText(saved.asset_name),
          asset_type: safeText(saved.asset_type),
          category: safeText(saved.category),
          tags: safeText(saved.tags),
        };
      } else if (getLandingPageFieldFilterMeta(key)) {
        landingPageSelectorFilterState[key] = {
          category: safeText(saved.category),
        };
      } else {
        landingPageSelectorFilterState[key] = {};
      }
    }
    return landingPageSelectorFilterState[key];
  }

  function saveLandingPageSelectorDefaults() {
    try {
      window.localStorage.setItem(LANDING_SELECTOR_DEFAULTS_KEY, JSON.stringify(landingPageSelectorFilterState));
      notify('Selector defaults saved');
    } catch {
      notify('Could not save selector defaults', true);
    }
  }

  function getLandingPageVisualEditorOptions(key, filterValue = '') {
    if (safeText(key) === 'templateId') {
      return getPageTemplateSelectOptions();
    }
    const rows = getLandingPageFieldRows(key);
    const meta = getLandingPageFieldFilterMeta(key);
    const state = (filterValue && typeof filterValue === 'object')
      ? filterValue
      : { category: safeText(filterValue) };
    const filteredRows = rows.filter((row) => {
      if (state.asset_name) {
        const name = assetLabel(row, '').toLowerCase();
        if (!name.includes(String(state.asset_name).trim().toLowerCase())) return false;
      }
      if (state.asset_type && safeText(row?.assetType) !== safeText(state.asset_type)) {
        return false;
      }
      if (state.tags) {
        const tagText = Array.isArray(row?.tags) ? row.tags.join(', ').toLowerCase() : '';
        if (!tagText.includes(String(state.tags).trim().toLowerCase())) return false;
      }
      if (state.formType && safeText(row?.formType) !== safeText(state.formType)) {
        return false;
      }
      if (state.category && meta && safeText(meta.getValue(row)) !== safeText(state.category)) {
        return false;
      }
      return true;
    });
    return filteredRows.map((row) => ({
      value: row.id,
      label: getLandingPageFieldOptionLabel(key, row),
    }));
  }

  function clearLandingPageSelectorFilters() {
    Object.keys(landingPageSelectorFilterState).forEach((key) => {
      delete landingPageSelectorFilterState[key];
    });
  }

  function ensureLandingPageFieldFilterSelect(select, fieldKey) {
    if (!select) return null;
    const key = safeText(fieldKey);
    const wrapId = `${select.id}FilterWrap`;
    const existingWrap = byId(wrapId);
    if (isLandingImageFieldKey(key)) {
      if (existingWrap) existingWrap.remove();
      return null;
    }
    const meta = getLandingPageFieldFilterMeta(key);
    const state = getLandingPageFilterState(key);
    let wrap = byId(wrapId);
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = wrapId;
      wrap.className = 'develop-selector-filter-wrap';
      wrap.dataset.filterFor = select.id;
      select.parentNode.insertBefore(wrap, select);
    }
    wrap.textContent = '';

    const rerender = () => {
      renderLandingPageBuilderSelect(select.id, key, select.dataset.placeholder || select.options[0]?.textContent || '');
    };

    if ([
      'leadMagnetId',
      'websiteBannerImageId',
      'backgroundImageId',
      'featureImageId',
      'highlightImageId',
        'logoSquareId',
        'logoWideId',
      ].includes(key)) {
      const rows = getLandingPageFieldRows(key);
      const typeValues = Array.from(new Set(rows.map((row) => safeText(row?.assetType)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
      const categoryValues = Array.from(new Set(rows.map((row) => safeText(row?.category)).filter(Boolean))).sort((a, b) => a.localeCompare(b));

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'Filter: Asset Name';
      nameInput.value = safeText(state.asset_name);
      nameInput.addEventListener('input', () => {
        state.asset_name = safeText(nameInput.value);
        rerender();
      });
      wrap.appendChild(nameInput);

      const typeSelect = document.createElement('select');
      setSelectOptions(
        typeSelect,
        typeValues.map((value) => ({ value, label: value })),
        'All Asset Types',
        state.asset_type
      );
      typeSelect.addEventListener('change', () => {
        state.asset_type = safeText(typeSelect.value);
        rerender();
      });
      wrap.appendChild(typeSelect);

      const categorySelect = document.createElement('select');
      setSelectOptions(
        categorySelect,
        categoryValues.map((value) => ({ value, label: value })),
        'All Categories',
        state.category
      );
      categorySelect.addEventListener('change', () => {
        state.category = safeText(categorySelect.value);
        rerender();
      });
      wrap.appendChild(categorySelect);

      const tagsInput = document.createElement('input');
      tagsInput.type = 'text';
      tagsInput.placeholder = 'Filter: Tags';
      tagsInput.value = safeText(state.tags);
      tagsInput.addEventListener('input', () => {
        state.tags = safeText(tagsInput.value);
        rerender();
      });
      wrap.appendChild(tagsInput);
      return wrap;
    }

    if (key === 'formId') {
      const typeSelect = document.createElement('select');
      const values = Array.from(new Set(savedForms.map((row) => safeText(row?.formType)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
      setSelectOptions(
        typeSelect,
        values.map((value) => ({ value, label: getFormTemplateById(value).name })),
        'All Form Types',
        state.formType
      );
      typeSelect.addEventListener('change', () => {
        state.formType = safeText(typeSelect.value);
        rerender();
      });
      wrap.appendChild(typeSelect);
      return wrap;
    }

    if (meta) {
      const categorySelect = document.createElement('select');
      const rows = getLandingPageFieldRows(key);
      const values = Array.from(new Set(rows.map((row) => safeText(meta.getValue(row))).filter(Boolean))).sort((a, b) => a.localeCompare(b));
      setSelectOptions(
        categorySelect,
        values.map((value) => ({ value, label: meta.getLabel(value) })),
        meta.placeholder,
        state.category
      );
      categorySelect.addEventListener('change', () => {
        state.category = safeText(categorySelect.value);
        rerender();
      });
      wrap.appendChild(categorySelect);
      return wrap;
    }

    return null;
  }

  function renderLandingPageBuilderSelect(selectId, fieldKey, placeholder) {
    const select = byId(selectId);
    if (!select) return;
    select.dataset.placeholder = placeholder;
    const currentValue = safeText(select.value);
    ensureLandingPageFieldFilterSelect(select, fieldKey);
    if (isLandingImageSelectId(selectId)) {
      renderLandingAssetSelect(selectId, currentValue, placeholder);
      return;
    }
    setSelectOptions(
      select,
      getLandingPageVisualEditorOptions(fieldKey, getLandingPageFilterState(fieldKey)),
      placeholder,
      currentValue
    );
  }

  function getSavedFormName(formId) {
    const id = safeText(formId);
    if (!id) return '';
    const match = savedForms.find((form) => safeText(form.id) === id);
    return match ? (safeText(match.name) || getFormTemplateById(match.formType).name) : '';
  }

  function getLandingMessageLabel(rows, id, field, fallbackPrefix) {
    const targetId = safeText(id);
    if (!targetId) return '';
    const match = (Array.isArray(rows) ? rows : []).find((item) => safeText(item.id) === targetId);
    return match ? (safeText(match[field]) || `${fallbackPrefix} ${targetId}`) : '';
  }

  function getLandingPageHeadlineLabel(headlineId) {
    return getLandingMessageLabel(landingPageHeadlines, headlineId, 'headline', 'Headline');
  }

  function getLandingPageSubheadingLabel(subheadingId) {
    return getLandingMessageLabel(landingPageSubheadings, subheadingId, 'subheading', 'Sub-heading');
  }

  function getLandingPagePitchLabel(pitchId) {
    return getLandingMessageLabel(landingPagePitches, pitchId, 'pitch', 'Pitch');
  }

  function getLandingPageCtaLabel(ctaId) {
    return getLandingMessageLabel(landingPageCtas, ctaId, 'cta', 'CTA');
  }

  function getDefaultLandingPageFieldValue(fieldKey) {
    const rows = getLandingPageFieldRows(fieldKey);
    const first = Array.isArray(rows) && rows.length ? rows[0] : null;
    return safeText(first?.id);
  }

  function applyLandingPageDefaultSelections(record, options = {}) {
    const source = record && typeof record === 'object' ? record : {};
    const overwrite = options.overwrite === true;
    const next = { ...source };
    [
      'formId',
      'leadMagnetId',
      'headlineId',
      'pitchId',
      'ctaId',
      'websiteBannerImageId',
      'backgroundImageId',
      'featureImageId',
      'highlightImageId',
      'featureHeadlineId',
      'featureSubheadingId',
      'highlightHeadlineId',
      'highlightPitchId',
      'bodyHeadlineId',
      'bodySubheadingId',
      'bodyPitchId',
      'logoSquareId',
    ].forEach((fieldKey) => {
      if (!overwrite && safeText(next[fieldKey])) return;
      next[fieldKey] = getDefaultLandingPageFieldValue(fieldKey);
    });
    return next;
  }

  function applyLandingPageDefaultsToForm() {
    const form = els.developLandingPagesForm;
    if (!form) return;
    const current = getLandingPageFormPayload(new FormData(form));
    const next = applyLandingPageDefaultSelections(current);
    [
      ['developLandingFormSelect', next.formId],
      ['developLandingLeadMagnetSelect', next.leadMagnetId],
      ['developLandingHeadlineSelect', next.headlineId],
      ['developLandingPitchSelect', next.pitchId],
      ['developLandingCtaSelect', next.ctaId],
      ['developLandingBannerImageSelect', next.websiteBannerImageId],
      ['developLandingBackgroundImageSelect', next.backgroundImageId],
      ['developLandingFeatureImageSelect', next.featureImageId],
      ['developLandingHighlightImageSelect', next.highlightImageId],
      ['developLandingFeatureHeadlineSelect', next.featureHeadlineId],
      ['developLandingFeatureSubheadingSelect', next.featureSubheadingId],
      ['developLandingHighlightHeadlineSelect', next.highlightHeadlineId],
      ['developLandingHighlightPitchSelect', next.highlightPitchId],
      ['developLandingBodyHeadlineSelect', next.bodyHeadlineId],
      ['developLandingBodySubheadingSelect', next.bodySubheadingId],
      ['developLandingBodyPitchSelect', next.bodyPitchId],
      ['developLandingLogoSquareSelect', next.logoSquareId],
    ].forEach(([id, value]) => {
      const node = byId(id);
      if (node && !safeText(node.value) && safeText(value)) {
        node.value = safeText(value);
      }
    });
    updateLandingPageFieldOutlines();
  }

  function getAssetById(assetId) {
    const targetId = safeText(assetId);
    if (!targetId) return null;
    return (Array.isArray(state.assets) ? state.assets : []).find((asset) => safeText(asset?.id) === targetId) || null;
  }

  function getLandingPageAssetUrl(assetId) {
    const candidates = getLandingPageAssetUrlCandidates(assetId);
    return candidates[0] || '';
  }

  function getLandingPageAssetUrlCandidates(assetId) {
    const asset = getAssetById(assetId);
    if (!asset) return [];
    const location = safeText(asset.location);
    const driveId = extractDriveId(location);
    const assetType = safeText(asset.assetType);
    const urls = [];
    if (driveId && (assetType === 'Image' || assetType === 'Video')) {
      urls.push(`/api/assets/drive-file/${encodeURIComponent(driveId)}`);
      if (assetType === 'Image') {
        urls.push(`https://drive.google.com/uc?export=view&id=${encodeURIComponent(driveId)}`);
        urls.push(`https://drive.google.com/thumbnail?id=${encodeURIComponent(driveId)}&sz=w2400`);
      }
    }
    const direct = toDirectAssetUrl(location);
    if (direct) urls.push(direct);
    if (location) urls.push(location);
    return Array.from(new Set(urls.filter(Boolean)));
  }

  function buildLandingAssetImage(assetId, altText, className = '') {
    const candidates = getLandingPageAssetUrlCandidates(assetId);
    if (!candidates.length) return '';
    const primary = candidates[0];
    const fallbackSrcs = candidates.slice(1);
    const classAttr = className ? ` class="${className}"` : '';
    const fallbackAttr = fallbackSrcs.length
      ? ` data-fallback-srcs="${encodeURIComponent(JSON.stringify(fallbackSrcs))}" data-fallback-idx="0"`
      : '';
    return `<img src="${primary}" alt="${safeText(altText)}"${classAttr}${fallbackAttr} />`;
  }

  function bindLandingImageFallbacks(host) {
    if (!host) return;
    host.querySelectorAll('img[data-fallback-srcs]').forEach((img) => {
      if (img.dataset.fallbackBound === '1') return;
      img.dataset.fallbackBound = '1';
      img.addEventListener('error', () => {
        let fallbacks = [];
        try {
          const raw = decodeURIComponent(safeText(img.dataset.fallbackSrcs));
          const parsed = JSON.parse(raw);
          fallbacks = Array.isArray(parsed) ? parsed.map((item) => safeText(item)).filter(Boolean) : [];
        } catch (_) {
          fallbacks = [];
        }
        const idx = Math.max(0, Number(img.dataset.fallbackIdx || 0) || 0);
        if (idx >= fallbacks.length) return;
        img.dataset.fallbackIdx = String(idx + 1);
        img.src = fallbacks[idx];
      });
    });
  }

  function getLandingPageAssetName(assetId, fallbackLabel) {
    const asset = getAssetById(assetId);
    return assetLabel(asset, fallbackLabel);
  }

  async function ensureAssetsLoaded() {
    if (Array.isArray(state.assets) && state.assets.length) return;
    const result = await api('/api/assets');
    state.assets = Array.isArray(result?.assets) ? result.assets : [];
  }

  function normalizeLandingPageContentOverrides(value) {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) {
      const next = {};
      Object.entries(value).forEach(([key, raw]) => {
        const cleanKey = safeText(key, 120);
        if (!cleanKey) return;
        next[cleanKey] = safeText(raw, 10000);
      });
      return next;
    }
    if (typeof value === 'string') {
      try {
        return normalizeLandingPageContentOverrides(JSON.parse(value));
      } catch (_) {
        return {};
      }
    }
    return {};
  }

  function normalizePageTemplateKind(value) {
    return safeText(value).toLowerCase() === 'modular' ? 'modular' : 'fixed';
  }

  function createDefaultContainerSettings() {
    return {
      margin: '',
      padding: '',
      backgroundColor: '',
      backgroundImageId: '',
      background: createDefaultBackgroundSettings(),
      borderColor: '#999',
      borderThickness: '1',
      borderRadius: '14',
    };
  }

  function normalizeContainerSettings(value) {
    const next = value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};
    const legacyColor = safeText(next.backgroundColor);
    const legacyImageId = safeText(next.backgroundImageId, 120);
    let background = normalizeBackgroundSettings(next.background, legacyColor, legacyImageId);
    if (!next.background && legacyImageId && background.mode !== 'image') {
      background = normalizeBackgroundSettings({
        mode: 'image',
        imageAssetId: legacyImageId,
        imageUrl: getLandingPageAssetUrl(legacyImageId) || '',
      }, legacyColor);
    }
    return {
      margin: safeText(next.margin, 20),
      padding: safeText(next.padding, 20),
      backgroundColor: background.mode === 'color'
        ? safeText(background.color)
        : (background.mode === 'transparent' ? 'transparent' : legacyColor),
      backgroundImageId: background.mode === 'image' ? safeText(background.imageAssetId, 120) : legacyImageId,
      background,
      borderColor: safeText(next.borderColor, 20) || '#999',
      borderThickness: safeNumericSetting(next.borderThickness, '1'),
      borderRadius: safeNumericSetting(next.borderRadius, '14'),
    };
  }

  function normalizeContainerSettingsMap(value, columnIds = []) {
    const defaults = {};
    (Array.isArray(columnIds) ? columnIds : []).forEach((columnId) => {
      const cleanId = safeText(columnId) || 'col1';
      defaults[cleanId] = createDefaultContainerSettings();
    });
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
    const next = { ...defaults };
    Object.entries(value).forEach(([columnId, raw]) => {
      const cleanId = safeText(columnId) || 'col1';
      next[cleanId] = normalizeContainerSettings(raw);
    });
    return next;
  }

  function normalizePageTemplateLayoutSections(value) {
    if (!value) return [];
    if (typeof value === 'string') {
      try {
        return normalizePageTemplateLayoutSections(JSON.parse(value));
      } catch (_) {
        return [];
      }
    }
    if (!Array.isArray(value)) return [];
    return value
      .map((section, index) => {
        if (!section || typeof section !== 'object' || Array.isArray(section)) return null;
        const id = safeText(section.id) || `section_${index + 1}`;
        const layout = resolveLegacySectionLayout(section);
        const title = safeText(section.title, 255);
        const collapsed = Boolean(section.collapsed);
        const rowSettings = normalizeRowSettings({
          ...(section.rowSettings && typeof section.rowSettings === 'object' ? section.rowSettings : {}),
          background: section.rowSettings?.background || section.background,
          overlayScreen: section.rowSettings?.overlayScreen || section.overlayScreen,
        });
        const columnIds = getModularPageLayoutMeta(layout).columns.map((column) => safeText(column.id) || 'col1');
        const containerSettings = normalizeContainerSettingsMap(section.containerSettings, columnIds);
        const modules = Array.isArray(section.modules)
          ? section.modules
            .map((module, moduleIndex) => {
              if (!module || typeof module !== 'object' || Array.isArray(module)) return null;
              return {
                id: safeText(module.id) || `${id}_module_${moduleIndex + 1}`,
                sourceModuleId: safeText(module.sourceModuleId),
                name: safeText(module.name, 255),
                type: safeText(module.type) || 'text',
                column: safeText(module.column) || getModularPageLayoutColumnIds(layout)[0] || 'col1',
                contentId: safeText(module.contentId),
                assetId: safeText(module.assetId),
                text: safeText(module.text, 10000),
                collapsed: Boolean(module.collapsed),
                settings: module.settings && typeof module.settings === 'object' && !Array.isArray(module.settings)
                  ? JSON.parse(JSON.stringify(module.settings))
                  : {},
              };
            })
            .filter(Boolean)
        : [];
      return { id, layout, title, collapsed, rowSettings, containerSettings, modules };
    })
    .filter(Boolean);
  }

  function getPageTemplateKindLabel(value) {
    return normalizePageTemplateKind(value) === 'modular' ? 'Modular' : 'Fixed';
  }

  function nextModularPageId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  const MODULAR_PAGE_LAYOUT_OPTIONS = [
    { value: '1-5', label: '1-5 (Left Column)', columns: [{ id: 'col1', span: 1 }, { id: 'col2', span: 5 }] },
    { value: '2-4', label: '2-4 (1-2 Ratio)', columns: [{ id: 'col1', span: 2 }, { id: 'col2', span: 4 }] },
    { value: '2-2-2', label: '2-2-2 (Three Columns)', columns: [{ id: 'col1', span: 2 }, { id: 'col2', span: 2 }, { id: 'col3', span: 2 }] },
    { value: '3-3', label: '3-3 (50-50%)', columns: [{ id: 'col1', span: 3 }, { id: 'col2', span: 3 }] },
    { value: '4-2', label: '4-2 (2-1 Ratio)', columns: [{ id: 'col1', span: 4 }, { id: 'col2', span: 2 }] },
    { value: '5-1', label: '5-1 (Right Column)', columns: [{ id: 'col1', span: 5 }, { id: 'col2', span: 1 }] },
    { value: '1-4-1', label: '1-4-1 (Center Focus)', columns: [{ id: 'col1', span: 1 }, { id: 'col2', span: 4 }, { id: 'col3', span: 1 }] },
    { value: '6', label: '6 (Full Width)', columns: [{ id: 'col1', span: 6 }] },
  ];

  const MODULAR_PAGE_MODULE_TYPES = [
    { value: 'eyebrow', label: 'Eyebrow', fieldKey: null },
    { value: 'headline', label: 'Headline', fieldKey: 'headlineId' },
    { value: 'subheading', label: 'Sub-heading', fieldKey: 'bodySubheadingId' },
    { value: 'pitch', label: 'Pitch', fieldKey: 'pitchId' },
    { value: 'cta', label: 'CTA', fieldKey: 'ctaId' },
    { value: 'form', label: 'Form', fieldKey: 'formId' },
    { value: 'image', label: 'Image', fieldKey: 'featureImageId' },
    { value: 'logo-wide', label: 'Logo - Wide', fieldKey: null },
    { value: 'logo-square', label: 'Logo - Square', fieldKey: 'logoSquareId' },
    { value: 'poll', label: 'Poll', fieldKey: null },
    { value: 'spacer', label: 'Spacer', fieldKey: null },
    { value: 'text', label: 'Text', fieldKey: null },
    { value: 'navigation', label: 'Navigation', fieldKey: null },
  ];

  const NORMIE_LAYOUT_TO_LEGACY = {
    single: '6',
    banner: '6',
    'hero-split': '4-2',
    'two-column': '3-3',
    'three-column': '2-2-2',
    'one-four-one': '1-4-1',
    'four-two': '4-2',
    'two-four': '2-4',
    'one-five': '1-5',
    'five-one': '5-1',
  };

  const LEGACY_TO_NORMIE_LAYOUT = {
    '6': 'single',
    '3-3': 'two-column',
    '2-2-2': 'three-column',
    '1-4-1': 'one-four-one',
    '4-2': 'four-two',
    '2-4': 'two-four',
    '1-5': 'one-five',
    '5-1': 'five-one',
  };

  function getNormieLayoutColumnKeys(layout) {
    const columnCount = getModularPageLayoutMeta(layout).columns.length;
    if (columnCount === 3) return ['left', 'center', 'right'];
    if (columnCount === 2) return ['left', 'right'];
    return ['main'];
  }

  function inferLegacyLayoutFromNormieCellKeys(section) {
    const cellKeys = new Set(
      [
        ...Object.keys(section?.cellBackgrounds || {}),
        ...Object.keys(section?.cellPadding || {}),
        ...Object.keys(section?.cellBorderWidth || {}),
      ].map((key) => safeText(key).toLowerCase()).filter(Boolean)
    );
    if (cellKeys.has('center') || (cellKeys.has('left') && cellKeys.has('right') && cellKeys.size >= 3)) {
      return '2-2-2';
    }
    if (cellKeys.has('left') && cellKeys.has('right')) {
      return '3-3';
    }
    if (cellKeys.has('main') || cellKeys.size <= 1) {
      return '6';
    }
    return '';
  }

  function resolveLegacySectionLayout(section) {
    const hintedLayout = safeText(section?.layout);
    if (hintedLayout) {
      return getModularPageLayoutMeta(hintedLayout).value;
    }
    const inferredLayout = inferLegacyLayoutFromNormieCellKeys(section);
    if (inferredLayout) {
      return inferredLayout;
    }
    const modules = Array.isArray(section?.modules) ? section.modules : [];
    const legacyColumns = new Set(modules.map((module) => {
      const column = safeText(module?.column).toLowerCase();
      if (/^col\d+$/.test(column)) return column;
      return mapNormieColumnToLegacy(column, '2-2-2');
    }));
    if (legacyColumns.has('col2') || legacyColumns.has('col3')) return '2-2-2';
    return '6';
  }

  function resolveNormieLayoutFromSection(section) {
    const legacyLayout = resolveLegacySectionLayout(section);
    return LEGACY_TO_NORMIE_LAYOUT[legacyLayout] || safeText(section?.layout).toLowerCase() || 'single';
  }

  function mapLegacyColumnToNormie(column, layout) {
    const legacyCol = safeText(column).toLowerCase() || '';
    const legacyLayout = getModularPageLayoutMeta(layout).value;
    const normieKeys = getNormieLayoutColumnKeys(legacyLayout);
    if (normieKeys.length === 1) return normieKeys[0] || 'main';
    if (['left', 'center', 'right', 'main'].includes(legacyCol)) {
      return legacyCol === 'main' ? (normieKeys[0] || 'main') : legacyCol;
    }
    if (/^col\d+$/.test(legacyCol)) {
      const legacyCols = getModularPageLayoutColumnIds(legacyLayout);
      const idx = legacyCols.indexOf(legacyCol);
      if (idx >= 0 && normieKeys[idx]) return normieKeys[idx];
    }
    return normieKeys[0] || 'main';
  }

  function modulesForNormieSave(section, legacyLayout) {
    return (Array.isArray(section?.modules) ? section.modules : []).map((module) => ({
      ...module,
      column: mapLegacyColumnToNormie(module?.column, legacyLayout),
    }));
  }

  function mapNormieColumnToLegacy(column, layout) {
    const normieCol = safeText(column).toLowerCase() || 'main';
    if (/^col\d+$/.test(normieCol)) return normieCol;
    const layoutKey = safeText(layout).toLowerCase();
    const legacyLayout = NORMIE_LAYOUT_TO_LEGACY[layoutKey] || layoutKey;
    const meta = getModularPageLayoutMeta(legacyLayout);
    const legacyCols = meta.columns.map((entry) => safeText(entry.id) || 'col1');
    const normieKeys = getNormieLayoutColumnKeys(layout);
    if (normieKeys.length === 1) return legacyCols[0] || 'col1';
    const idx = normieKeys.indexOf(normieCol);
    if (idx >= 0 && legacyCols[idx]) return legacyCols[idx];
    if (normieCol === 'main' || normieCol === 'left') return legacyCols[0] || 'col1';
    if (normieCol === 'center') return legacyCols[1] || legacyCols[0] || 'col1';
    if (normieCol === 'right') return legacyCols[legacyCols.length - 1] || 'col2';
    return legacyCols[0] || 'col1';
  }

  function isNormieModularSection(section) {
    if (!section || typeof section !== 'object') return false;
    const layout = safeText(section.layout).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(NORMIE_LAYOUT_TO_LEGACY, layout)) return true;
    if (section.cellBackgrounds || section.cellPadding) return true;
    const column = safeText(section.modules?.[0]?.column).toLowerCase();
    return ['main', 'left', 'right', 'center'].includes(column);
  }

  function mapNormieModuleTypeToLegacy(module) {
    const type = safeText(module?.type).toLowerCase();
    const settings = module?.settings && typeof module.settings === 'object' ? module.settings : {};
    if (type === 'header' || type === 'heading') return 'header';
    if (type === 'contact-form') return 'form';
    if (type === 'current-poll') return 'poll';
    if (type === 'text') {
      if (safeText(settings.headingLevel) || safeText(settings.level)) return 'header';
      if (safeText(module.contentId)) return 'pitch';
      if (safeText(settings.content) || safeText(settings.textAlign) || safeText(settings.maxWidth)) return 'textarea';
    }
    if (type === 'textarea') return 'textarea';
    if (type === 'button' || type === 'image' || type === 'video' || type === 'form' || type === 'poll') return type;
    return type || 'text';
  }

  function mapNormieModuleSettingsToLegacy(legacyType, settings, module) {
    const next = settings && typeof settings === 'object'
      ? JSON.parse(JSON.stringify(settings))
      : {};
    if (legacyType === 'header') {
      if (!safeText(next.headingLevel) && safeText(next.level)) {
        const level = safeText(next.level).toLowerCase();
        next.headingLevel = /^h[1-6]$/.test(level) ? level.toUpperCase() : 'H2';
      }
    }
    if (legacyType === 'form' && !safeText(next.formId)) {
      next.formId = safeText(module?.contentId) || safeText(next.formId);
    }
    if (legacyType === 'pitch' && !safeText(module?.contentId) && safeText(next.contentId)) {
      // keep contentId on module, not settings
    }
    if (legacyType === 'textarea') {
      next.background = normalizeBackgroundSettings(next.background, next.backgroundColor, next.backgroundImageId);
    }
    return next;
  }

  function remapNormieModulesToLegacyEditorShape(sections) {
    return (Array.isArray(sections) ? sections : []).map((section) => {
      if (!section || typeof section !== 'object') return section;
      const legacyLayout = resolveLegacySectionLayout(section);
      const modules = (Array.isArray(section.modules) ? section.modules : []).map((module) => {
        if (!module || typeof module !== 'object') return module;
        const legacyType = mapNormieModuleTypeToLegacy(module);
        const settings = mapNormieModuleSettingsToLegacy(legacyType, module.settings, module);
        const text = safeText(module.text, 10000)
          || safeText(settings.text, 10000)
          || safeText(module.settings?.text, 10000);
        return {
          ...module,
          type: legacyType,
          column: mapNormieColumnToLegacy(module.column, legacyLayout),
          contentId: legacyType === 'pitch'
            ? (safeText(module.contentId) || safeText(settings.contentId))
            : safeText(module.contentId),
          text,
          settings,
        };
      });
      return { ...section, modules };
    });
  }

  function coerceNormieSectionToLegacy(section, index) {
    const legacyLayout = resolveLegacySectionLayout(section);
    const meta = getModularPageLayoutMeta(legacyLayout);
    const legacyColumnIds = meta.columns.map((entry) => safeText(entry.id) || 'col1');
    const normieColumnKeys = getNormieLayoutColumnKeys(legacyLayout);
    const containerSettings = {};
    legacyColumnIds.forEach((colId, columnIndex) => {
      const normieKey = normieColumnKeys[columnIndex] || normieColumnKeys[0] || 'main';
      const bg = section.cellBackgrounds?.[normieKey];
      containerSettings[colId] = normalizeContainerSettings({
        margin: safeText(section.cellVerticalMargin?.[normieKey]) || '0',
        padding: safeText(section.cellPadding?.[normieKey]) || '18',
        background: bg,
        backgroundColor: bg && bg.mode === 'color' ? safeText(bg.color) : '',
        borderThickness: safeText(section.cellBorderWidth?.[normieKey]) || '1',
        borderColor: safeText(section.cellBorderColor?.[normieKey]) || '#d9e4ef',
        borderRadius: safeText(section.cellBorderRadius?.[normieKey]) || '24',
      });
    });
    const rowBg = section.background || section.rowSettings?.background;
    const rowSettings = normalizeRowSettings({
      margin: safeText(section.marginTop) || '0',
      padding: '20',
      backgroundColor: rowBg && rowBg.mode === 'color' ? safeText(rowBg.color) : safeText(section.rowSettings?.backgroundColor),
      background: rowBg,
      overlayScreen: section.overlayScreen || section.rowSettings?.overlayScreen,
    });
    const modules = (Array.isArray(section.modules) ? section.modules : []).map((module, moduleIndex) => {
      const legacyType = mapNormieModuleTypeToLegacy(module);
      const settings = mapNormieModuleSettingsToLegacy(legacyType, module.settings, module);
      return {
        id: safeText(module.id) || `section_${index + 1}_module_${moduleIndex + 1}`,
        sourceModuleId: safeText(module.sourceModuleId),
        name: safeText(module.name, 255),
        type: legacyType,
        column: mapNormieColumnToLegacy(module.column, legacyLayout),
        contentId: legacyType === 'pitch'
          ? (safeText(module.contentId) || safeText(settings.contentId))
          : safeText(module.contentId),
        assetId: safeText(module.assetId),
        text: safeText(module.text, 10000) || safeText(settings.text, 10000),
        collapsed: Boolean(module.collapsed),
        settings,
      };
    });
    return {
      id: safeText(section.id) || `section_${index + 1}`,
      layout: legacyLayout,
      title: safeText(section.title, 255),
      collapsed: Boolean(section.collapsed),
      rowSettings,
      containerSettings,
      modules,
    };
  }

  function resolveModularLayoutSectionsForEditor(source) {
    const raw = source?.layoutSections ?? source?.sections;
    if (!raw) return createDefaultModularPageSections();
    const sections = Array.isArray(raw)
      ? raw
      : (raw && typeof raw === 'object' && Array.isArray(raw.sections) ? raw.sections : []);
    if (!sections.length) return createDefaultModularPageSections();
    let resolved;
    if (sections.some(isNormieModularSection)) {
      resolved = sections
        .map((section, sectionIndex) => coerceNormieSectionToLegacy(section, sectionIndex))
        .filter(Boolean);
    } else {
      resolved = normalizePageTemplateLayoutSections(sections);
      if (!resolved.length) return createDefaultModularPageSections();
    }
    return remapNormieModulesToLegacyEditorShape(resolved);
  }

  function getModularSectionModulesForColumn(section, columnId) {
    const column = safeText(columnId) || 'col1';
    return (Array.isArray(section?.modules) ? section.modules : []).filter((module) => {
      const moduleColumn = safeText(module?.column);
      return moduleColumn === column || mapNormieColumnToLegacy(moduleColumn, section.layout) === column;
    });
  }

  function getModularEditorLayoutSections(source) {
    return resolveModularLayoutSectionsForEditor(
      source && typeof source === 'object' && !Array.isArray(source)
        ? source
        : { layoutSections: source }
    );
  }

  function getModularPageLayoutMeta(layout) {
    const normalized = safeText(layout).toLowerCase();
    const legacyMap = {
      banner: '6',
      single: '6',
      'hero-form-right': '4-2',
      'hero-split': '4-2',
      'two-column': '3-3',
      'three-column': '2-2-2',
      'one-four-one': '1-4-1',
      'four-two': '4-2',
      'two-four': '2-4',
      'one-five': '1-5',
      'five-one': '5-1',
      'feature-grid-2': '3-3',
    };
    const resolved = legacyMap[normalized] || normalized;
    return MODULAR_PAGE_LAYOUT_OPTIONS.find((item) => item.value === resolved) || MODULAR_PAGE_LAYOUT_OPTIONS[3];
  }

  function createModularPageSection(layout = '3-3') {
    const meta = getModularPageLayoutMeta(layout);
    const containerSettings = {};
    meta.columns.forEach((column) => {
      const columnId = safeText(column.id) || 'col1';
      containerSettings[columnId] = createDefaultContainerSettings();
    });
    return {
      id: nextModularPageId('section'),
      layout: meta.value,
      title: '',
      collapsed: false,
      rowSettings: createDefaultRowSettings(),
      containerSettings,
      modules: [],
    };
  }

  function createDefaultRowSettings() {
    return {
      margin: '',
      padding: '20',
      backgroundColor: '',
      background: createDefaultBackgroundSettings(),
      overlayScreen: createDefaultRowOverlayScreenSettings(),
    };
  }

  function createDefaultRowOverlayScreenSettings() {
    return {
      background: createDefaultBackgroundSettings(),
      opacity: 100,
    };
  }

  function normalizeRowOverlayScreenSettings(value) {
    const next = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const opacityRaw = Number(next.opacity);
    const opacity = Number.isFinite(opacityRaw)
      ? Math.min(100, Math.max(0, Math.round(opacityRaw)))
      : 100;
    return {
      background: normalizeBackgroundSettings(next.background),
      opacity,
    };
  }

  function hasActiveRowOverlayScreen(overlayScreen) {
    return normalizeRowOverlayScreenSettings(overlayScreen).background.mode !== 'none';
  }

  function buildRowOverlayScreenStyle(overlayScreen) {
    const normalized = normalizeRowOverlayScreenSettings(overlayScreen);
    if (!hasActiveRowOverlayScreen(normalized)) return {};
    const style = getBuilderBackgroundCssStyle(normalized.background);
    const opacity = normalized.opacity / 100;
    if (Number.isFinite(opacity) && opacity < 1) {
      style.opacity = String(opacity);
    }
    return style;
  }

  function overlayScreenSettingsForSave(overlayScreen) {
    return normalizeRowOverlayScreenSettings(overlayScreen);
  }

  function readRowOverlayScreenFromPanel(panel, prefix = 'developRowOverlayScreen') {
    return normalizeRowOverlayScreenSettings({
      background: readModularBackgroundFromPanel(panel, prefix),
      opacity: panel.querySelector(`#${prefix}OpacityRange`)?.value,
    });
  }

  const BUILDER_BACKGROUND_STYLE_PRESETS = [
    { value: 'blue-yellow-circles', label: 'Blue Yellow Circles' },
  ];

  function createDefaultBackgroundSettings() {
    return {
      mode: 'none',
      color: '#ffffff',
      color2: '#eaf4ff',
      imageUrl: '',
      imageAssetId: '',
      styleKey: '',
    };
  }

  function normalizeBackgroundMode(value) {
    const mode = safeText(value).toLowerCase();
    if (['none', 'transparent', 'color', 'gradient', 'image', 'style'].includes(mode)) return mode;
    return 'none';
  }

  function isTransparentBuilderColor(value) {
    const trimmed = safeText(value).toLowerCase();
    if (!trimmed || trimmed === 'transparent') return true;
    if (/^#[0-9a-f]{8}$/i.test(trimmed) && trimmed.slice(-2) === '00') return true;
    const rgbaMatch = trimmed.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
    if (rgbaMatch) {
      const alpha = rgbaMatch[4] !== undefined ? Number(rgbaMatch[4]) : 1;
      return Number.isFinite(alpha) && alpha <= 0;
    }
    return false;
  }

  function resolveModuleColorValue(value, fallback = '') {
    const trimmed = safeText(value);
    if (isTransparentBuilderColor(trimmed)) return 'transparent';
    return trimmed || fallback;
  }

  function normalizeModuleHexColorValue(value, fallback = '#173c61') {
    const trimmed = safeText(value);
    if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
    return fallback;
  }

  function normalizeTableBorderThickness(value, fallback = 1) {
    if (value === '' || value === null || value === undefined) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  function getTableModuleBorderThickness(settings) {
    const raw = settings?.borderThickness ?? settings?.borderWidth;
    return normalizeTableBorderThickness(raw, 1);
  }

  function syncTableModuleBorderSettings(settings) {
    if (!settings || typeof settings !== 'object') return settings;
    const thickness = getTableModuleBorderThickness(settings);
    settings.borderThickness = thickness;
    settings.borderWidth = String(thickness);
    return settings;
  }

  function buildTableCellBorderCss(thickness, color, fallbackColor = '#d6e6f5') {
    const borderThickness = normalizeTableBorderThickness(thickness, 0);
    if (borderThickness <= 0) {
      return 'border:0!important;border-width:0!important;border-style:none!important;border-color:transparent!important;border-bottom:0!important;outline:none!important;box-shadow:none!important;';
    }
    const borderColor = resolveModuleColorValue(color, fallbackColor);
    return `border:${borderThickness}px solid ${borderColor}!important;border-bottom:${borderThickness}px solid ${borderColor}!important;`;
  }

  function normalizeBackgroundSettings(value, legacyColor = '', legacyImageId = '') {
    const fallbackColor = safeText(legacyColor);
    const fallbackImageId = safeText(legacyImageId, 120);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      const next = createDefaultBackgroundSettings();
      if (fallbackImageId) {
        next.mode = 'image';
        next.imageAssetId = fallbackImageId;
        next.imageUrl = getLandingPageAssetUrl(fallbackImageId) || '';
      } else if (fallbackColor) {
        next.mode = isTransparentBuilderColor(fallbackColor) ? 'transparent' : 'color';
        next.color = fallbackColor;
      }
      return next;
    }
    const background = value;
    const normalized = {
      mode: normalizeBackgroundMode(background.mode),
      color: safeText(background.color) || '#ffffff',
      color2: safeText(background.color2) || '#eaf4ff',
      imageUrl: safeText(background.imageUrl, 2000),
      imageAssetId: safeText(background.imageAssetId, 120),
      styleKey: safeText(background.styleKey, 80) === 'blue-yellow-circles' ? 'blue-yellow-circles' : '',
    };
    if (normalized.mode === 'image' && !normalized.imageUrl && normalized.imageAssetId) {
      normalized.imageUrl = getLandingPageAssetUrl(normalized.imageAssetId) || '';
    }
    if (normalized.mode === 'none' && fallbackImageId) {
      normalized.mode = 'image';
      normalized.imageAssetId = fallbackImageId;
      normalized.imageUrl = getLandingPageAssetUrl(fallbackImageId) || '';
    } else if (normalized.mode === 'none' && fallbackColor) {
      normalized.mode = isTransparentBuilderColor(fallbackColor) ? 'transparent' : 'color';
      normalized.color = fallbackColor;
    }
    if (normalized.mode === 'color' && isTransparentBuilderColor(normalized.color)) {
      normalized.mode = 'transparent';
    }
    if (normalized.mode === 'transparent') {
      normalized.color = 'transparent';
    }
    return normalized;
  }

  function getBuilderBackgroundCssStyle(background) {
    const bg = normalizeBackgroundSettings(background);
    if (bg.mode === 'none') return {};
    if (bg.mode === 'transparent') {
      return { background: 'transparent', backgroundColor: 'transparent' };
    }
    if (bg.mode === 'color') {
      if (isTransparentBuilderColor(bg.color)) {
        return { background: 'transparent', backgroundColor: 'transparent' };
      }
      return { background: bg.color };
    }
    if (bg.mode === 'gradient') {
      return {
        backgroundImage: `linear-gradient(135deg, ${bg.color} 0%, ${bg.color2} 100%)`,
      };
    }
    if (bg.mode === 'image' && bg.imageUrl) {
      return {
        backgroundImage: `url("${bg.imageUrl}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      };
    }
    if (bg.mode === 'style' && bg.styleKey === 'blue-yellow-circles') {
      return {
        background: 'radial-gradient(circle at 15% 15%, rgba(255, 214, 10, 0.35), transparent 18%), radial-gradient(circle at 82% 14%, rgba(23, 183, 238, 0.28), transparent 18%), radial-gradient(circle at 50% 72%, rgba(255, 255, 255, 0.92), transparent 24%), linear-gradient(135deg, #d9f5ff 0%, #f8feff 36%, #fff7bf 100%)',
      };
    }
    return {};
  }

  function readModularBackgroundFromPanel(panel, prefix) {
    const mode = normalizeBackgroundMode(panel.querySelector(`#${prefix}ModeSelect`)?.value);
    const background = createDefaultBackgroundSettings();
    background.mode = mode;
    background.color = safeText(panel.querySelector(`#${prefix}ColorPrimaryInput`)?.value) || '#ffffff';
    background.color2 = safeText(panel.querySelector(`#${prefix}ColorSecondaryInput`)?.value) || '#eaf4ff';
    background.styleKey = safeText(panel.querySelector(`#${prefix}StyleSelect`)?.value) || '';
    background.imageAssetId = safeText(panel.querySelector(`#${prefix}ImageAssetInput`)?.value) || '';
    background.imageUrl = safeText(panel.querySelector(`#${prefix}ImageUrlInput`)?.value, 2000)
      || (background.imageAssetId ? getLandingPageAssetUrl(background.imageAssetId) : '');
    return normalizeBackgroundSettings(background);
  }

  function readRowBackgroundFromPanel(panel) {
    return readModularBackgroundFromPanel(panel, 'developRowBackground');
  }

  function syncModularBackgroundControlVisibility(panel, prefix) {
    const controlsRoot = panel.querySelector(`[data-modular-bg-prefix="${prefix}"]`);
    if (!controlsRoot) return;
    const mode = normalizeBackgroundMode(controlsRoot.querySelector(`#${prefix}ModeSelect`)?.value);
    controlsRoot.querySelectorAll('[data-modular-bg-field]').forEach((el) => {
      const modes = String(el.getAttribute('data-modular-bg-field') || '').split(',').map((value) => value.trim()).filter(Boolean);
      el.classList.toggle('hidden', !modes.includes(mode));
    });
  }

  function syncRowBackgroundControlVisibility(panel) {
    syncModularBackgroundControlVisibility(panel, 'developRowBackground');
  }

  function buildModularBackgroundControlsHtml(prefix, background, options = {}) {
    const bg = normalizeBackgroundSettings(background);
    const sectionLabel = safeText(options.sectionLabel) || 'Background';
    const styleOptions = BUILDER_BACKGROUND_STYLE_PRESETS.map((preset) => (
      `<option value="${escapeHtml(preset.value)}"${bg.styleKey === preset.value ? ' selected' : ''}>${escapeHtml(preset.label)}</option>`
    )).join('');
    return `
      <div class="develop-modular-background-controls stack-form" data-modular-bg-prefix="${escapeHtml(prefix)}">
        <label class="stack-form">
          <span>${escapeHtml(sectionLabel)}</span>
          <select id="${prefix}ModeSelect">
            <option value="none"${bg.mode === 'none' ? ' selected' : ''}>None</option>
            <option value="transparent"${bg.mode === 'transparent' ? ' selected' : ''}>Transparent</option>
            <option value="color"${bg.mode === 'color' ? ' selected' : ''}>Color</option>
            <option value="gradient"${bg.mode === 'gradient' ? ' selected' : ''}>Gradient</option>
            <option value="image"${bg.mode === 'image' ? ' selected' : ''}>Image</option>
            <option value="style"${bg.mode === 'style' ? ' selected' : ''}>Style</option>
          </select>
        </label>
        <label class="stack-form develop-modular-background-field" data-modular-bg-field="color,gradient">
          <span>Primary Color</span>
          <input id="${prefix}ColorPrimaryInput" type="color" value="${escapeHtml(bg.mode === 'transparent' ? '#ffffff' : (bg.color || '#ffffff'))}" />
        </label>
        <label class="stack-form develop-modular-background-field" data-modular-bg-field="gradient">
          <span>Secondary Color</span>
          <input id="${prefix}ColorSecondaryInput" type="color" value="${escapeHtml(bg.color2 || '#eaf4ff')}" />
        </label>
        <label class="stack-form develop-modular-background-field" data-modular-bg-field="style">
          <span>Style Preset</span>
          <select id="${prefix}StyleSelect">
            <option value="">Choose A Style</option>
            ${styleOptions}
          </select>
        </label>
        <div class="develop-modular-background-field develop-inline-image-picker-wrap" data-modular-bg-field="image">
          <div class="develop-inline-image-picker-label">Background Image</div>
          <div id="${prefix}ImagePickerHost"></div>
        </div>
        <label class="stack-form develop-modular-background-field" data-modular-bg-field="image">
          <span>Background Image URL</span>
          <input id="${prefix}ImageUrlInput" type="text" value="${escapeHtml(bg.imageUrl)}" placeholder="https://..." />
        </label>
      </div>
    `;
  }

  function buildRowBackgroundControlsHtml(background) {
    return buildModularBackgroundControlsHtml('developRowBackground', background, { sectionLabel: 'Row Background' });
  }

  function mountRowOverlayScreenControls(panel, overlayScreen) {
    if (!panel || panel.querySelector('#developRowOverlayScreenSection')) return false;
    const body = panel.querySelector('.develop-module-editor-modal__body');
    const backgroundRoot = panel.querySelector('[data-modular-bg-prefix="developRowBackground"]');
    if (!body || !backgroundRoot) return false;
    const template = document.createElement('template');
    template.innerHTML = buildRowOverlayScreenControlsHtml(overlayScreen).replace(
      'class="develop-modular-overlay-screen-controls stack-form"',
      'id="developRowOverlayScreenSection" class="develop-modular-overlay-screen-controls stack-form"'
    );
    const overlayRoot = template.content.firstElementChild;
    if (!overlayRoot) return false;
    backgroundRoot.parentElement.insertBefore(overlayRoot, backgroundRoot);
    return true;
  }

  function buildModularOverlayScreenControlsHtml(prefix, overlayScreen) {
    const overlay = normalizeRowOverlayScreenSettings(overlayScreen);
    return `
      <div class="develop-modular-overlay-screen-controls stack-form">
        <div class="develop-modular-overlay-screen-controls__heading">Overlay Screen</div>
        ${buildModularBackgroundControlsHtml(prefix, overlay.background, { sectionLabel: 'Overlay Type' })}
        <label class="stack-form develop-modular-overlay-screen-opacity">
          <span>Overlay Opacity</span>
          <div class="develop-modular-overlay-screen-opacity__row">
            <input id="${prefix}OpacityRange" type="range" min="0" max="100" step="1" value="${overlay.opacity}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${overlay.opacity}" />
            <output id="${prefix}OpacityValue" for="${prefix}OpacityRange">${overlay.opacity}%</output>
          </div>
        </label>
      </div>
    `;
  }

  function buildRowOverlayScreenControlsHtml(overlayScreen) {
    return buildModularOverlayScreenControlsHtml('developRowOverlayScreen', overlayScreen);
  }

  function syncRowOverlayScreenControlVisibility(panel) {
    syncModularBackgroundControlVisibility(panel, 'developRowOverlayScreen');
  }

  function normalizeRowSettings(value) {
    const next = value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};
    const legacyColor = safeText(next.backgroundColor);
    const background = normalizeBackgroundSettings(next.background, legacyColor);
    return {
      margin: safeText(next.margin),
      padding: safeText(next.padding) || '20',
      backgroundColor: background.mode === 'color'
        ? safeText(background.color)
        : (background.mode === 'transparent' ? 'transparent' : legacyColor),
      background,
      overlayScreen: normalizeRowOverlayScreenSettings(next.overlayScreen),
    };
  }

  function createModularPageModule(type = 'text', column = 'col1') {
    const normalizedType = safeText(type) || 'text';
    const definition = getDevelopModuleTypeDefinition(normalizedType);
    return {
      id: nextModularPageId('module'),
      sourceModuleId: '',
      name: safeText(definition?.starterName) || '',
      type: normalizedType,
      column: safeText(column) || 'col1',
      contentId: '',
      assetId: '',
      text: '',
      collapsed: false,
      settings: definition && definition.defaults && typeof definition.defaults === 'object'
        ? JSON.parse(JSON.stringify(definition.defaults))
        : {},
    };
  }

  function createModularPageModuleFromSavedModule(savedModule, column = 'col1') {
    const definition = getDevelopModuleTypeDefinition(savedModule?.moduleType);
    return {
      id: nextModularPageId('module'),
      sourceModuleId: safeText(savedModule?.id),
      name: safeText(savedModule?.name) || safeText(definition?.starterName) || safeText(savedModule?.moduleType) || 'Module',
      type: safeText(savedModule?.moduleType) || 'header',
      column: safeText(column) || 'col1',
      contentId: '',
      assetId: '',
      text: '',
      collapsed: false,
      settings: savedModule && typeof savedModule.settings === 'object'
        ? JSON.parse(JSON.stringify(savedModule.settings))
        : (definition && definition.defaults && typeof definition.defaults === 'object'
          ? JSON.parse(JSON.stringify(definition.defaults))
          : {}),
    };
  }

  function getSectionContainerSettings(section, columnId) {
    const cleanId = safeText(columnId) || 'col1';
    if (!section.containerSettings || typeof section.containerSettings !== 'object' || Array.isArray(section.containerSettings)) {
      section.containerSettings = {};
    }
    if (!section.containerSettings[cleanId] || typeof section.containerSettings[cleanId] !== 'object' || Array.isArray(section.containerSettings[cleanId])) {
      section.containerSettings[cleanId] = createDefaultContainerSettings();
    }
    section.containerSettings[cleanId] = normalizeContainerSettings(section.containerSettings[cleanId]);
    return section.containerSettings[cleanId];
  }

  function getSectionRowSettings(section) {
    if (!section.rowSettings || typeof section.rowSettings !== 'object' || Array.isArray(section.rowSettings)) {
      section.rowSettings = createDefaultRowSettings();
    }
    section.rowSettings = normalizeRowSettings({
      ...section.rowSettings,
      background: section.rowSettings?.background || section.background,
      overlayScreen: section.rowSettings?.overlayScreen || section.overlayScreen,
    });
    return section.rowSettings;
  }

  function buildSectionRowStyle(section) {
    return buildRowStyle(getSectionRowSettings(section));
  }

  function buildModularPageSectionMarkup(section, innerMarkup, layoutValue) {
    const rowSettings = getSectionRowSettings(section);
    const rowStyleStr = styleObjectToCssText(buildRowStyle(rowSettings));
    const overlayStyleStr = styleObjectToCssText(buildRowOverlayScreenStyle(rowSettings.overlayScreen));
    const overlayMarkup = hasActiveRowOverlayScreen(rowSettings.overlayScreen)
      ? `<div class="develop-row-overlay-screen"${overlayStyleStr ? ` style="${escapeHtml(overlayStyleStr)}"` : ''}></div>`
      : '';
    return `<section class="develop-modular-page-section develop-modular-page-layout-${layoutValue}"${rowStyleStr ? ` style="${escapeHtml(rowStyleStr)}"` : ''}>
        ${overlayMarkup}
        <div class="develop-modular-page-section__content">${innerMarkup}</div>
      </section>`;
  }

  function appendRowOverlayScreenElement(parent, section) {
    if (!parent) return null;
    parent.querySelectorAll('.develop-row-overlay-screen').forEach((node) => node.remove());
    const rowSettings = getSectionRowSettings(section);
    if (!hasActiveRowOverlayScreen(rowSettings.overlayScreen)) return null;
    const overlay = document.createElement('div');
    overlay.className = 'develop-row-overlay-screen';
    Object.assign(overlay.style, buildRowOverlayScreenStyle(rowSettings.overlayScreen));
    parent.insertBefore(overlay, parent.firstChild);
    return overlay;
  }

  function buildRowStyle(settings) {
    const next = normalizeRowSettings(settings);
    const style = {};
    const margin = Number(safeText(next.margin));
    const padding = Number(safeText(next.padding));
    if (Number.isFinite(margin) && margin >= 0) style.margin = `${margin}px`;
    if (Number.isFinite(padding) && padding >= 0) style.padding = `${padding}px`;
    Object.assign(style, getBuilderBackgroundCssStyle(next.background));
    if (!style.background && !style.backgroundImage && safeText(next.backgroundColor)) {
      style.background = safeText(next.backgroundColor);
    }
    return style;
  }

  function buildContainerStyle(settings) {
    const next = normalizeContainerSettings(settings);
    const style = {};
    const margin = Number(safeText(next.margin));
    const padding = Number(safeText(next.padding));
    const borderThickness = Number(safeText(next.borderThickness));
    const borderRadius = Number(safeText(next.borderRadius));
    if (Number.isFinite(margin) && margin >= 0) style.margin = `${margin}px`;
    if (Number.isFinite(padding) && padding >= 0) style.padding = `${padding}px`;
    Object.assign(style, getBuilderBackgroundCssStyle(next.background));
    if (!style.background && !style.backgroundImage && safeText(next.backgroundColor)) {
      style.background = safeText(next.backgroundColor);
    }
    if (Number.isFinite(borderThickness) && borderThickness > 0) {
      style.border = `${borderThickness}px solid ${safeText(next.borderColor) || '#999'}`;
    } else if (Number.isFinite(borderThickness) && borderThickness === 0) {
      style.border = '0';
      style.boxShadow = 'none';
    }
    if (Number.isFinite(borderRadius) && borderRadius >= 0) style.borderRadius = `${borderRadius}px`;
    return style;
  }

  function styleObjectToCssText(style) {
    if (!style || typeof style !== 'object') return '';
    return Object.entries(style)
      .map(([key, value]) => {
        const cleanValue = safeText(value, 1000);
        if (!cleanValue) return '';
        const cssKey = String(key).replace(/([A-Z])/g, '-$1').toLowerCase();
        return `${cssKey}:${cleanValue};`;
      })
      .filter(Boolean)
      .join('');
  }

  function getBuilderInlineIconMarkup(iconKey, extraClass = '') {
    if (window.App && typeof App.makeInlineIcon === 'function') {
      return App.makeInlineIcon(iconKey, extraClass).outerHTML;
    }
    return `<span class="develop-builder-fallback-icon ${escapeHtml(extraClass)}" aria-hidden="true"></span>`;
  }

  function createDefaultModularPageSections() {
    const hero = createModularPageSection('4-2');
    hero.modules = [
      createModularPageModule('eyebrow', 'col1'),
      createModularPageModule('headline', 'col1'),
      createModularPageModule('pitch', 'col1'),
      createModularPageModule('cta', 'col1'),
      createModularPageModule('form', 'col2'),
      createModularPageModule('logo-square', 'col2'),
    ];
    const features = createModularPageSection('3-3');
    features.modules = [
      createModularPageModule('image', 'col1'),
      createModularPageModule('headline', 'col1'),
      createModularPageModule('subheading', 'col1'),
      createModularPageModule('image', 'col2'),
      createModularPageModule('headline', 'col2'),
      createModularPageModule('pitch', 'col2'),
    ];
    return [hero, features];
  }

  function getPageModuleTypeMeta(type) {
    const normalized = safeText(type);
    const definition = getDevelopModuleTypeDefinition(normalized);
    if (definition) {
      return { value: definition.value, label: definition.label, fieldKey: null };
    }
    return MODULAR_PAGE_MODULE_TYPES.find((item) => item.value === normalized) || MODULAR_PAGE_MODULE_TYPES[0];
  }

  function getModularPageLayoutShortLabel(layout) {
    return getModularPageLayoutMeta(layout).value;
  }

  function getModularPageLayoutVisual(layout) {
    return getModularPageLayoutMeta(layout)
      .columns
      .map((column) => `<span class="develop-layout-tile-cell" style="grid-column:span ${Math.max(1, Number(column.span) || 1)};"></span>`)
      .join('');
  }

  function buildModularPageLayoutIconMarkup(layout, baseClass = 'develop-layout-picker-icon') {
    const meta = getModularPageLayoutMeta(layout);
    const iconClass = `${baseClass} ${baseClass}--${safeText(meta.value)}`;
    if (baseClass === 'develop-layout-picker-icon' || baseClass === 'develop-layout-toolbar-icon') {
      const width = 240;
      const height = 44;
      const paddingX = 8;
      const gap = 8;
      const totalFlex = meta.columns.reduce((sum, column) => sum + Math.max(1, Number(column.span) || 1), 0);
      const usableWidth = width - (paddingX * 2) - (gap * Math.max(0, meta.columns.length - 1));
      let currentX = paddingX;
      const rects = meta.columns.map((column) => {
        const flex = Math.max(1, Number(column.span) || 1);
        const rectWidth = (usableWidth * flex) / totalFlex;
        const rect = `<rect x="${currentX}" y="4" width="${rectWidth}" height="36" rx="6" ry="6" fill="rgba(15, 79, 143, 0.18)" stroke="#444" stroke-width="1"></rect>`;
        currentX += rectWidth + gap;
        return rect;
      }).join('');
      return `<span class="${iconClass}" style="display:block; width:88%; height:44px; margin:0 auto;"><svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet">${rects}</svg></span>`;
    }
    const cells = meta.columns.map(() => '<span></span>').join('');
    return `<span class="${iconClass}">${cells}</span>`;
  }

  function getModularPageLayoutColumnIds(layout) {
    return getModularPageLayoutMeta(layout).columns.map((column) => safeText(column.id) || 'col1');
  }

  function moduleBelongsToLayoutColumn(module, sectionLayout, columnId) {
    const moduleColumn = safeText(module?.column);
    const legacyColumn = safeText(columnId) || 'col1';
    if (!moduleColumn) return legacyColumn === getModularPageLayoutColumnIds(sectionLayout)[0];
    return moduleColumn === legacyColumn
      || mapNormieColumnToLegacy(moduleColumn, sectionLayout) === legacyColumn;
  }

  function remapSectionToLayout(section, nextLayout) {
    const normalizedNextLayout = getModularPageLayoutMeta(nextLayout).value;
    const currentColumnIds = getModularPageLayoutColumnIds(section.layout);
    const nextColumnIds = getModularPageLayoutColumnIds(normalizedNextLayout);
    const assignedModuleIds = new Set();
    const moduleBuckets = currentColumnIds.map((columnId) => (
      (Array.isArray(section.modules) ? section.modules : []).filter((module) => {
        const moduleId = safeText(module?.id);
        if (moduleId && assignedModuleIds.has(moduleId)) return false;
        if (!moduleBelongsToLayoutColumn(module, section.layout, columnId)) return false;
        if (moduleId) assignedModuleIds.add(moduleId);
        return true;
      })
    ));
    const orphanModules = (Array.isArray(section.modules) ? section.modules : []).filter((module) => {
      const moduleId = safeText(module?.id);
      return !moduleId || !assignedModuleIds.has(moduleId);
    });
    if (orphanModules.length) {
      const fallbackIndex = nextColumnIds.length === 3
        ? Math.min(1, nextColumnIds.length - 1)
        : 0;
      moduleBuckets[fallbackIndex] = [...(moduleBuckets[fallbackIndex] || []), ...orphanModules];
    }
    const settingsBuckets = currentColumnIds.map((columnId) => ({ ...getSectionContainerSettings(section, columnId) }));

    while (moduleBuckets.length > nextColumnIds.length) {
      let removableIndex = -1;
      for (let index = moduleBuckets.length - 1; index >= 0; index -= 1) {
        if (!moduleBuckets[index].length) {
          removableIndex = index;
          break;
        }
      }
      if (removableIndex === -1) {
        const sourceIndex = moduleBuckets.length - 1;
        const targetIndex = Math.max(0, sourceIndex - 1);
        moduleBuckets[targetIndex].push(...moduleBuckets[sourceIndex]);
        removableIndex = sourceIndex;
      }
      moduleBuckets.splice(removableIndex, 1);
      settingsBuckets.splice(removableIndex, 1);
    }

    while (moduleBuckets.length < nextColumnIds.length) {
      moduleBuckets.push([]);
      settingsBuckets.push(createDefaultContainerSettings());
    }

    const nextModules = [];
    const nextContainerSettings = {};
    nextColumnIds.forEach((columnId, index) => {
      moduleBuckets[index].forEach((module) => {
        nextModules.push({
          ...module,
          column: columnId,
        });
      });
      nextContainerSettings[columnId] = settingsBuckets[index]
        ? { ...settingsBuckets[index] }
        : createDefaultContainerSettings();
    });

    return {
      ...section,
      layout: normalizedNextLayout,
      containerSettings: nextContainerSettings,
      modules: nextModules,
    };
  }

  function getModularModuleIcon(type) {
    switch (safeText(type)) {
      case 'button':
        return 'Btn';
      case 'eyebrow':
        return 'Ey';
      case 'headline':
        return 'H1';
      case 'subheading':
        return 'H2';
      case 'pitch':
        return 'P';
      case 'cta':
        return 'Go';
      case 'form':
        return 'F';
      case 'image':
        return 'Img';
      case 'video':
        return 'Vid';
      case 'pod':
        return 'Pod';
      case 'table':
        return 'Tbl';
      case 'navigation':
        return 'Nav';
      case 'textarea':
        return 'Txt';
      case 'header':
        return 'Hd';
      case 'logo-wide':
        return 'LW';
      case 'logo-square':
        return 'LS';
      case 'spacer':
        return 'Sp';
      default:
        return 'Txt';
    }
  }

  function getModularModuleDisplayName(module) {
    return safeText(module?.name, 255) || safeText(getSavedModuleById(module?.sourceModuleId)?.name, 255) || getModularModuleContentLabel(module);
  }

  function getDefaultModularModulePickerItems() {
    return MODULE_TYPE_DEFINITIONS
      .filter((definition) => Boolean(getDevelopModuleTypeDefinition(definition.value)))
      .map((definition) => ({
        moduleId: '',
        value: definition.value,
        label: definition.label,
        icon: getModularModuleIcon(definition.value),
      }));
  }

  function getModularModulePickerItems() {
    const fromSaved = getCanonicalSavedModules(savedModules)
      .filter((item) => Boolean(getDevelopModuleTypeDefinition(item.moduleType)))
      .map((item) => ({
        moduleId: safeText(item.id),
        value: safeText(item.moduleType),
        label: safeText(item.name) || getPageModuleTypeMeta(item.moduleType).label,
        icon: getModularModuleIcon(item.moduleType),
      }));
    return fromSaved.length ? fromSaved : getDefaultModularModulePickerItems();
  }

  function buildModularPageGridTemplate(layout) {
    const meta = getModularPageLayoutMeta(layout);
    return meta.columns.map((column) => `minmax(0, ${Math.max(1, Number(column.span) || 1)}fr)`).join(' ');
  }

  function getModularModuleContentOptions(type) {
    const meta = getPageModuleTypeMeta(type);
    if (!meta.fieldKey) return [];
    return getLandingPageVisualEditorOptions(meta.fieldKey, getLandingPageFilterState(meta.fieldKey));
  }

  function getModularModuleContentLabel(module) {
    const type = safeText(module?.type);
    if (type === 'image' || type === 'logo-wide' || type === 'logo-square') {
      const asset = getAssetById(module?.settings?.imageAssetId || module?.assetId || module?.contentId);
      return assetLabel(asset, 'No asset selected');
    }
    if (type === 'form') return getSavedFormName(module?.contentId) || 'No form selected';
    if (type === 'headline') return getLandingPageHeadlineLabel(module?.contentId) || 'No headline selected';
    if (type === 'subheading') {
      const row = landingPageSubheadings.find((item) => String(item?.id) === String(module?.contentId));
      return safeText(row?.subheading) || 'No sub-heading selected';
    }
    if (type === 'pitch') {
      const row = landingPagePitches.find((item) => String(item?.id) === String(module?.contentId));
      return safeText(row?.pitch) || 'No pitch selected';
    }
    if (type === 'cta') {
      const row = landingPageCtas.find((item) => String(item?.id) === String(module?.contentId));
      return safeText(row?.cta) || 'No CTA selected';
    }
    if (type === 'pod') {
      return safeText(module?.settings?.title) || 'Channel Pod';
    }
    if (type === 'navigation') {
      const menuName = safeText(module?.settings?.menuName) || safeText(module?.name) || 'Menu';
      return `${menuName} · ${App.developNavMenu?.getNavMenuSummary?.(module?.settings?.navItems) || 'No menu items'}`;
    }
    if (type === 'header' || type === 'heading') {
      return safeText(module?.settings?.text, 10000)
        || safeText(module?.text, 10000)
        || getLandingPageHeadlineLabel(module?.settings?.headlineId || module?.contentId)
        || 'No text set';
    }
    if (type === 'textarea' || type === 'text') {
      return safeText(module?.settings?.text, 10000)
        || safeText(module?.settings?.content, 10000)
        || safeText(module?.text, 10000)
        || 'No text set';
    }
    return safeText(module?.settings?.text, 10000) || safeText(module?.text) || 'No text set';
  }

  function getLandingPageMergedContentOverrides(record) {
    const base = normalizeLandingPageContentOverrides(record?.contentOverrides);
    const draft = normalizeLandingPageContentOverrides(landingPageVisualDraft.contentOverrides);
    return {
      ...base,
      ...draft,
    };
  }

  const LANDING_TEXT_SCALE_OPTIONS = ['0.80', '0.90', '1.00', '1.10', '1.20'];

  function getLandingPageTextStyleKey(slot) {
    return `__style__${safeText(slot)}`;
  }

  function parseLandingPageTextStyle(value) {
    if (!value) return { fontScale: '1.00', sizeToFit: false };
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      const scale = LANDING_TEXT_SCALE_OPTIONS.includes(String(parsed?.fontScale || ''))
        ? String(parsed.fontScale)
        : '1.00';
      return {
        fontScale: scale,
        sizeToFit: parsed?.sizeToFit === true,
      };
    } catch {
      return { fontScale: '1.00', sizeToFit: false };
    }
  }

  function getLandingPageTextStyle(record, slot) {
    const overrides = getLandingPageMergedContentOverrides(record);
    return parseLandingPageTextStyle(overrides[getLandingPageTextStyleKey(slot)]);
  }

  function setLandingPageTextStyle(slot, nextStyle) {
    const overrides = getLandingPageMergedContentOverrides(getActiveLandingPageVisualRecord());
    const current = getLandingPageTextStyle(getActiveLandingPageVisualRecord(), slot);
    const merged = {
      fontScale: LANDING_TEXT_SCALE_OPTIONS.includes(String(nextStyle?.fontScale || ''))
        ? String(nextStyle.fontScale)
        : current.fontScale,
      sizeToFit: nextStyle?.sizeToFit === true,
    };
    overrides[getLandingPageTextStyleKey(slot)] = JSON.stringify(merged);
    landingPageVisualDraft.contentOverrides = overrides;
  }

  function buildLandingPageTextAttrs(record, slot, extraStyle = '') {
    const textStyle = getLandingPageTextStyle(record, slot);
    const styles = [];
    if (extraStyle) styles.push(extraStyle);
    if (textStyle.fontScale && textStyle.fontScale !== '1.00') {
      styles.push(`font-size:${Number(textStyle.fontScale).toFixed(2)}em;`);
    }
    const styleAttr = styles.length ? ` style="${styles.join(' ')}"` : '';
    return ` data-text-slot="${slot}" data-size-to-fit="${textStyle.sizeToFit ? '1' : '0'}"${styleAttr}`;
  }

  function setLandingPageContentOverride(slot, value) {
    const overrides = getLandingPageMergedContentOverrides(getActiveLandingPageVisualRecord());
    const nextValue = safeText(value, 10000);
    if (nextValue) {
      overrides[slot] = nextValue;
    } else {
      delete overrides[slot];
    }
    landingPageVisualDraft.contentOverrides = overrides;
  }

  function getLandingPageTextSlotFieldKey(slot) {
    return {
    }[safeText(slot)] || '';
  }

  function getLandingPageSlotSelectSpec(slot) {
    return {
      'feature-one-title': { fieldKey: 'featureHeadlineId', label: 'Feature One Headline', placeholder: 'No Headline' },
      'feature-one-copy': { fieldKey: 'featureSubheadingId', label: 'Feature One Sub-heading', placeholder: 'No Sub-heading' },
      'feature-two-title': { fieldKey: 'highlightHeadlineId', label: 'Feature Two Headline', placeholder: 'No Headline' },
      'feature-two-copy': { fieldKey: 'highlightPitchId', label: 'Feature Two Pitch', placeholder: 'No Pitch' },
      'body-title': { fieldKey: 'bodyHeadlineId', label: 'Body Headline', placeholder: 'No Headline' },
      'body-lead': { fieldKey: 'bodySubheadingId', label: 'Body Sub-heading', placeholder: 'No Sub-heading' },
      'body-copy': { fieldKey: 'bodyPitchId', label: 'Body Pitch', placeholder: 'No Pitch' },
    }[safeText(slot)] || null;
  }

  function getLandingPageEditorId(key, slot) {
    const cleanKey = safeText(key);
    const cleanSlot = safeText(slot);
    return cleanSlot ? `${cleanKey}::${cleanSlot}` : cleanKey;
  }

  function parseLandingPageEditorId(editorId) {
    const [key, slot] = safeText(editorId).split('::');
    return {
      key: safeText(key),
      slot: safeText(slot),
    };
  }

  function getLandingPageResolvedTemplateRecord(record, options = {}) {
    const page = record && typeof record === 'object' ? record : {};
    if (options.skipTemplateMerge) {
      return {
        ...page,
        layoutSections: getModularEditorLayoutSections(page),
      };
    }
    const savedTemplate = getSavedPageTemplateById(page.templateId);
    if (!savedTemplate) {
      return {
        ...page,
        layoutSections: getModularEditorLayoutSections(page),
      };
    }
    const rawPageSections = page.layoutSections ?? page.sections;
    const hasPageLayout = Array.isArray(rawPageSections)
      || (rawPageSections && typeof rawPageSections === 'object');
    const merged = {
      ...savedTemplate,
      ...page,
      templateKind: normalizePageTemplateKind(page.templateKind || savedTemplate.templateKind),
      contentOverrides: {
        ...normalizeLandingPageContentOverrides(savedTemplate.contentOverrides),
        ...normalizeLandingPageContentOverrides(page.contentOverrides),
      },
      layoutSections: hasPageLayout
        ? getModularEditorLayoutSections(page)
        : getModularEditorLayoutSections(savedTemplate),
    };
    [
      'primaryColor','backgroundColor','accentColor','formId','leadMagnetId','headlineId','pitchId','ctaId',
      'websiteBannerImageId','backgroundImageId','featureImageId','highlightImageId','featureHeadlineId',
      'featureSubheadingId','featureTitle','featureCopy','highlightHeadlineId','highlightPitchId',
      'highlightTitle','highlightCopy','bodyHeadlineId','bodySubheadingId','bodyPitchId','logoWideId','logoSquareId'
    ].forEach((key) => {
      if (!safeText(merged[key]) && safeText(savedTemplate[key])) merged[key] = safeText(savedTemplate[key]);
    });
    return merged;
  }

  function buildModularPageModuleContent(record, module) {
    const type = safeText(module?.type);
    const linkedId = safeText(module?.contentId);
    const assetId = safeText(module?.assetId || module?.contentId);
    if (type === 'headline') return getLandingPageHeadlineLabel(linkedId);
    if (type === 'subheading') return getLandingPageSubheadingLabel(linkedId);
    if (type === 'pitch') return getLandingPagePitchLabel(linkedId);
    if (type === 'cta') return getLandingPageCtaLabel(linkedId);
    if (type === 'form') {
      const form = savedForms.find((item) => String(item?.id) === linkedId);
      return { title: safeText(form?.heading) || 'Form', submitLabel: safeText(form?.submitLabel) || 'Submit Form', form };
    }
    if (type === 'poll') {
      return module?.settings || {};
    }
    if (type === 'pod') {
      return module?.settings || {};
    }
    if (type === 'button') {
      const ctaText = safeText(module?.settings?.label)
        || getDevelopModuleContentSourceOptions('cta').find((item) => item.value === safeText(module?.settings?.ctaId))?.content
        || getDevelopModuleContentSourceOptions('cta').find((item) => item.value === safeText(module?.settings?.ctaId))?.label
        || 'Learn More';
      return {
        label: ctaText,
        linkUrl: safeText(module?.settings?.linkUrl),
        style: safeText(module?.settings?.style) || 'solid',
        size: safeText(module?.settings?.size) || 'md',
        align: safeText(module?.settings?.align) || 'left',
        backgroundColor: safeText(module?.settings?.backgroundColor) || '#0b82d4',
        textColor: safeText(module?.settings?.textColor) || '#ffffff',
        borderRadius: Number(module?.settings?.borderRadius) || 14,
        fullWidth: Boolean(module?.settings?.fullWidth),
        openInNewTab: Boolean(module?.settings?.openInNewTab),
      };
    }
    if (type === 'image' || type === 'logo-wide' || type === 'logo-square') {
      const settingsAssetId = safeText(module?.settings?.imageAssetId);
      const resolvedAssetId = settingsAssetId || assetId;
      const manualImageUrl = safeText(module?.settings?.imageUrl);
      const asset = getAssetById(resolvedAssetId);
      const resolvedAssetUrl = resolvedAssetId ? getLandingPageAssetUrl(resolvedAssetId) : '';
      return {
        assetId: resolvedAssetId,
        assetName: asset ? assetLabel(asset, 'Image') : (safeText(module?.settings?.altText) || 'Image'),
        assetUrl: resolvedAssetUrl || manualImageUrl,
        maxWidth: Number(module?.settings?.maxWidth),
        maxWidthPx: Number(module?.settings?.maxWidthPx),
      };
    }
    if (type === 'video') {
      const settingsVideoAssetId = safeText(module?.settings?.videoAssetId);
      const settingsPosterAssetId = safeText(module?.settings?.posterAssetId);
      const videoAsset = getAssetById(settingsVideoAssetId);
      const posterAsset = getAssetById(settingsPosterAssetId);
      return {
        assetId: settingsVideoAssetId,
        assetName: videoAsset ? assetLabel(videoAsset, 'Video') : 'Video',
        assetUrl: settingsVideoAssetId ? getLandingPageAssetUrl(settingsVideoAssetId) : safeText(module?.settings?.videoUrl),
        posterAssetId: settingsPosterAssetId,
        posterName: posterAsset ? assetLabel(posterAsset, 'Poster') : 'Poster',
        posterUrl: settingsPosterAssetId ? getLandingPageAssetUrl(settingsPosterAssetId) : safeText(module?.settings?.posterUrl),
        aspectRatio: safeText(module?.settings?.aspectRatio) || '16:9',
        controls: module?.settings?.controls !== false,
        muted: module?.settings?.muted !== false,
        autoplay: Boolean(module?.settings?.autoplay),
      };
    }
    if (type === 'table') {
      return {
        caption: safeText(module?.settings?.caption)
          || getDevelopModuleContentSourceOptions('headline').find((item) => item.value === safeText(module?.settings?.headlineId))?.content
          || getDevelopModuleContentSourceOptions('headline').find((item) => item.value === safeText(module?.settings?.headlineId))?.label
          || '',
        columnsCount: Number(module?.settings?.columnsCount) || 3,
        rowsCount: Number(module?.settings?.rowsCount) || 4,
        headerColor: resolveModuleColorValue(module?.settings?.headerColor, '#173c61'),
        headerTextColor: safeText(module?.settings?.headerTextColor) || '#ffffff',
        borderColor: resolveModuleColorValue(module?.settings?.borderColor, '#d6e6f5'),
        borderThickness: getTableModuleBorderThickness(module?.settings),
        cellPadding: Number(module?.settings?.cellPadding) || 14,
        striped: module?.settings?.striped !== false,
        compact: Boolean(module?.settings?.compact),
        style: safeText(module?.settings?.style) || 'clean',
        cells: normalizeDevelopTableContents(
          module?.settings?.tableContents,
          Number(module?.settings?.columnsCount) || 3,
          Number(module?.settings?.rowsCount) || 4
        ),
      };
    }
    if (type === 'header' || type === 'heading') {
      return safeText(module?.settings?.text, 10000) || safeText(module?.text, 10000);
    }
    if (type === 'navigation') {
      return module?.settings || {};
    }
    if (type === 'textarea' || type === 'text') {
      return getModularTextBlockHtml(module) || safeText(module?.settings?.text, 10000) || safeText(module?.text, 10000);
    }
    return safeText(module?.settings?.text, 10000) || safeText(module?.text, 10000);
  }

  function getModularPageCanvasStyleVariables(record, sections = []) {
    const resolvedRecord = record && typeof record === 'object' ? record : {};
    const canvasStyles = [
      `--lp-primary:${safeText(resolvedRecord.primaryColor) || DEFAULT_LANDING_PRIMARY};`,
      `--lp-background:${safeText(resolvedRecord.backgroundColor) || DEFAULT_LANDING_BACKGROUND};`,
      `--lp-accent:${safeText(resolvedRecord.accentColor) || DEFAULT_LANDING_ACCENT};`,
    ];
    const pageBackgroundUrl = getLandingPageAssetUrl(resolvedRecord.backgroundImageId);
    if (pageBackgroundUrl) {
      canvasStyles.push(`--lp-page-background-image:url('${safeText(pageBackgroundUrl)}');`);
      return canvasStyles;
    }
    const resolvedSections = Array.isArray(sections) ? sections : [];
    for (const section of resolvedSections) {
      const rowStyle = buildSectionRowStyle(section);
      if (rowStyle.backgroundImage) {
        canvasStyles.push(`--lp-page-background-image:${rowStyle.backgroundImage};`);
        if (rowStyle.backgroundSize) canvasStyles.push(`--lp-page-background-size:${rowStyle.backgroundSize};`);
        if (rowStyle.backgroundPosition) canvasStyles.push(`--lp-page-background-position:${rowStyle.backgroundPosition};`);
        if (rowStyle.backgroundRepeat) canvasStyles.push(`--lp-page-background-repeat:${rowStyle.backgroundRepeat};`);
        break;
      }
      if (rowStyle.background && rowStyle.background !== 'transparent') {
        canvasStyles.push(`--lp-background:${safeText(rowStyle.background)};`);
        break;
      }
    }
    return canvasStyles;
  }

  function buildModularLandingPageMarkup(record, options = {}) {
    const { interactive = false, editableClass = 'develop-landing-editable', skipTemplateMerge = false } = options;
    const resolvedRecord = getLandingPageResolvedTemplateRecord(record, { skipTemplateMerge });
    const sections = getModularEditorLayoutSections(resolvedRecord);
    const attr = (key, label, slot = '') => (
      interactive ? ` data-edit-key="${key}" data-edit-label="${label}"${slot ? ` data-edit-slot="${slot}"` : ''}` : ''
    );
    const editable = (baseClass = '') => {
      const classes = [];
      if (baseClass) classes.push(baseClass);
      if (interactive) classes.push(editableClass);
      return classes.length ? ` class="${classes.join(' ')}"` : '';
    };
    const baseTemplate = getBaseLandingTemplateById(resolvedRecord.templateId);
    const canvasStyles = getModularPageCanvasStyleVariables(resolvedRecord, sections);
    const sectionMarkup = sections.map((section, sectionIndex) => {
      const layout = getModularPageLayoutMeta(section.layout);
      const columns = layout.columns.map((columnDef) => {
        const column = safeText(columnDef.id) || 'col1';
        const modules = getModularSectionModulesForColumn(section, column);
        const moduleMarkup = modules.map((module, moduleIndex) => {
          const moduleKey = `modularModule::${section.id}::${module.id}`;
          const content = buildModularPageModuleContent(resolvedRecord, module);
          const titleText = safeText(module.settings?.title || module.text || content?.title || '');
          const headerText = safeText(
            module.settings?.text
            || getDevelopModuleContentSourceOptions('headline').find((item) => item.value === safeText(module.settings?.headlineId))?.content
            || getDevelopModuleContentSourceOptions('headline').find((item) => item.value === safeText(module.settings?.headlineId))?.label
            || content
            || titleText
            || baseTemplate.headline
          );
          const textBlockHtml = getModularTextBlockHtml(module);
          const innerMarkup = (() => {
            if (module.type === 'form') {
              const formFields = Array.isArray(content?.form?.fields) && content.form.fields.length
                ? content.form.fields
                : [{ key: 'first_name', label: 'First Name', type: 'text', required: true }, { key: 'email', label: 'Email', type: 'email', required: true }];
              const runtimeFieldMarkup = formFields.map((field, fieldIndex) => `<input name="${safeText(field?.key) || `field_${fieldIndex}`}" type="${safeText(field?.type) || 'text'}" placeholder="${safeText(field?.label) || 'Field'}${field?.required ? ' *' : ''}"${field?.required ? ' required' : ''}${editable()}${attr(moduleKey, 'Module', `module-${sectionIndex}-${moduleIndex}`)} />`).join('');
              return `<aside${editable('develop-template-form-card')}${attr(moduleKey, 'Module', `module-${sectionIndex}-${moduleIndex}`)}><h3>${escapeHtml(content?.title || titleText || 'Form')}</h3>${runtimeFieldMarkup}<button type="button">${escapeHtml(content?.submitLabel || 'Submit Form')}</button></aside>`;
            }
            if (module.type === 'poll') {
              const question = safeText(content?.question) || 'Poll Question';
              const optionsStr = safeText(content?.options) || 'Option A, Option B';
              const options = optionsStr.split(',').map(o => String(o || '').trim()).filter(Boolean);
              const submitLabel = safeText(content?.submitLabel) || 'Vote';
              const bgColor = safeText(content?.backgroundColor) || '#ffffff';
              const pollId = safeText(module.id);
              const optionsMarkup = options.map((opt, idx) => `
                <label class="develop-poll-option" style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;cursor:pointer;">
                  <input type="radio" name="poll_${pollId}" value="${escapeHtml(opt)}" required${editable()}${attr(moduleKey, 'Module', `module-${sectionIndex}-${moduleIndex}`)} />
                  <span>${escapeHtml(opt)}</span>
                </label>
              `).join('');
              return `<aside class="develop-template-poll-card" style="background:${escapeHtml(bgColor)};padding:2rem;border-radius:16px;box-shadow:0 4px 12px rgba(0,0,0,0.05);"${editable()}${attr(moduleKey, 'Module', `module-${sectionIndex}-${moduleIndex}`)}><h3 style="margin-top:0;margin-bottom:1.5rem;font-size:1.25rem;">${escapeHtml(question)}</h3><form class="develop-template-runtime-poll-form" data-poll-id="${pollId}"><div class="develop-poll-options">${optionsMarkup}</div><button type="submit" style="margin-top:1rem;width:100%;">${escapeHtml(submitLabel)}</button><div class="develop-poll-status" aria-live="polite" style="margin-top:1rem;font-size:0.9rem;"></div></form></aside>`;
            }
            if (module.type === 'navigation') {
              const navMarkup = App.developNavMenu?.buildNavigationModuleMarkup?.(module.settings || {}, { includeDataAttrs: true })
                || '<nav class="site-nav"><p class="site-nav-empty">Navigation module</p></nav>';
              return `<div class="develop-template-navigation-slot"${editable()}${attr(moduleKey, 'Module', `module-${sectionIndex}-${moduleIndex}`)}>${navMarkup}</div>`;
            }
            if (module.type === 'button') {
              const sizeMap = {
                small: 'padding:0.55rem 1rem;font-size:0.92rem;',
                medium: 'padding:0.8rem 1.35rem;font-size:1rem;',
                large: 'padding:1rem 1.7rem;font-size:1.08rem;',
              };
              const align = ['left', 'center', 'right'].includes(safeText(content?.align)) ? safeText(content.align) : 'left';
              const styleMode = safeText(content?.style) || 'solid';
              const backgroundColor = safeText(content?.backgroundColor) || '#0b82d4';
              const textColor = safeText(content?.textColor) || '#ffffff';
              const radius = Number(content?.borderRadius) || 14;
              let buttonStyle = `${sizeMap[safeText(content?.size)] || sizeMap.medium}border-radius:${radius}px;font-weight:700;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;`;
              if (styleMode === 'outline') {
                buttonStyle += `background:transparent;color:${textColor};border:2px solid ${backgroundColor};`;
              } else if (styleMode === 'ghost') {
                buttonStyle += `background:rgba(11,130,212,0.08);color:${backgroundColor};border:1px solid transparent;`;
              } else if (styleMode === 'link') {
                buttonStyle += `background:transparent;color:${backgroundColor};border:none;padding-left:0;padding-right:0;border-radius:0;`;
              } else {
                buttonStyle += `background:${backgroundColor};color:${textColor};border:1px solid ${backgroundColor};`;
              }
              if (content?.fullWidth) buttonStyle += 'width:100%;';
              const href = safeText(content?.linkUrl) || '#';
              const targetAttrs = content?.openInNewTab ? ' target="_blank" rel="noopener noreferrer"' : '';
              return `<div class="develop-template-button-row" style="text-align:${align};"><a href="${escapeHtml(href)}"${targetAttrs}${editable()}${attr(moduleKey, 'Module', `module-${sectionIndex}-${moduleIndex}`)} style="${buttonStyle}">${escapeHtml(content?.label || 'Learn More')}</a></div>`;
            }
            if (module.type === 'image' || module.type === 'logo-wide' || module.type === 'logo-square') {
              const styleBits = [];
              if (content.maxWidthPx > 0) {
                styleBits.push(`max-width:${content.maxWidthPx}px;`);
              } else if (content.maxWidth > 0 && content.maxWidth < 100) {
                styleBits.push(`max-width:${content.maxWidth}%;`);
              }
              const imageMarkup = content?.assetId
                ? buildLandingAssetImage(content.assetId, content.assetName)
                : (content?.assetUrl ? `<img src="${escapeHtml(content.assetUrl)}" alt="${escapeHtml(content.assetName || 'Image')}" />` : '');
              return `<div${editable('develop-template-image-slot')}${attr(moduleKey, 'Module', `module-${sectionIndex}-${moduleIndex}`)}${styleBits.length ? ` style="${styleBits.join(' ')}"` : ''}>${imageMarkup || escapeHtml(content?.assetName || 'Image')}</div>`;
            }
            if (module.type === 'video') {
              const styleBits = [];
              if (safeText(content?.aspectRatio).includes(':')) {
                const [widthPart, heightPart] = safeText(content.aspectRatio).split(':');
                const width = Number(widthPart) || 16;
                const height = Number(heightPart) || 9;
                styleBits.push(`aspect-ratio:${width}/${height};`);
              }
              const videoMarkup = buildResponsiveVideoMarkup(content);
              return `<div${editable('develop-template-video-slot')}${attr(moduleKey, 'Module', `module-${sectionIndex}-${moduleIndex}`)}${styleBits.length ? ` style="${styleBits.join(' ')}"` : ''}>${videoMarkup}</div>`;
            }
            if (module.type === 'table') {
              const columnsCount = Number(content?.columnsCount) || 3;
              const rowsCount = Number(content?.rowsCount) || 4;
              const cellMap = new Map((Array.isArray(content?.cells) ? content.cells : []).map((cell) => [`${cell.row}:${cell.column}`, cell]));
              const rowMarkup = Array.from({ length: rowsCount }).map((_, rowIndex) => {
                const tag = rowIndex === 0 ? 'th' : 'td';
                const cellMarkup = Array.from({ length: columnsCount }).map((__, columnIndex) => {
                  const cell = cellMap.get(`${rowIndex}:${columnIndex}`) || { cellType: 'empty', text: '' };
                  let cellInner = '&nbsp;';
                  if (cell.cellType === 'heading') {
                    const headingTag = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(safeText(cell.headingLevel).toLowerCase())
                      ? safeText(cell.headingLevel).toLowerCase()
                      : 'h3';
                    cellInner = `<${headingTag}>${escapeHtml(safeText(cell.text) || 'Heading')}</${headingTag}>`;
                  } else if (cell.cellType === 'text') {
                    cellInner = escapeHtml(safeText(cell.text) || '');
                  } else if (cell.cellType === 'image') {
                    cellInner = cell.imageAssetId
                      ? buildLandingAssetImage(cell.imageAssetId, assetLabel(getAssetById(cell.imageAssetId), 'Image'))
                      : '<div class="develop-template-empty-slot">No image</div>';
                  } else if (cell.cellType === 'video') {
                    const videoUrl = cell.videoAssetId ? getLandingPageAssetUrl(cell.videoAssetId) : '';
                    cellInner = videoUrl
                      ? buildResponsiveVideoMarkup({ assetUrl: videoUrl, assetName: 'Video', controls: true }, { className: 'develop-table-video' })
                      : '<div class="develop-template-empty-slot">No video</div>';
                  }
                  const cellStyle = `padding:${Number(content?.cellPadding) || 14}px;${buildTableCellBorderCss(content?.borderThickness, content?.borderColor, '#d6e6f5')}`;
                  const headerBg = resolveModuleColorValue(content?.headerColor, '#173c61');
                  const headerStyle = rowIndex === 0
                    ? `background:${escapeHtml(headerBg)};color:${escapeHtml(safeText(content?.headerTextColor) || '#ffffff')};`
                    : '';
                  return `<${tag} style="${cellStyle}${headerStyle}">${cellInner}</${tag}>`;
                }).join('');
                const rowStyle = rowIndex > 0 && content?.striped && rowIndex % 2 === 1 ? ' style="background:rgba(11,130,212,0.06);"' : '';
                return `<tr${rowStyle}>${cellMarkup}</tr>`;
              }).join('');
              const tableBorderThickness = getTableModuleBorderThickness({
                borderThickness: content?.borderThickness,
                borderWidth: content?.borderWidth,
              });
              const tableBorderAttr = tableBorderThickness <= 0 ? ' data-zero-border="true"' : '';
              return `<div${editable('develop-template-table-slot')}${attr(moduleKey, 'Module', `module-${sectionIndex}-${moduleIndex}`)}>${content?.caption ? `<div class="develop-template-eyebrow">${escapeHtml(content.caption)}</div>` : ''}<table class="develop-module-table"${tableBorderAttr} style="width:100%;border-collapse:collapse;border-spacing:0;${tableBorderThickness <= 0 ? 'border:0!important;' : ''}">${rowMarkup}</table></div>`;
            }
            if (module.type === 'header' || module.type === 'heading') {
              const headingLevel = safeText(module.settings?.headingLevel || module.settings?.level).toLowerCase();
              const tag = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(headingLevel) ? headingLevel : 'h2';
              const inlineStyle = [
                module.settings?.textColor ? `color:${safeText(module.settings.textColor)};` : '',
                module.settings?.align ? `text-align:${safeText(module.settings.align)};` : '',
              ].join('');
              return `<${tag}${editable()}${attr(moduleKey, 'Module', `module-${sectionIndex}-${moduleIndex}`)}${inlineStyle ? ` style="${inlineStyle}"` : ''}>${escapeHtml(headerText || 'Heading')}</${tag}>`;
            }
            if (module.type === 'headline') return `<h3${editable()}${attr(moduleKey, 'Module', `module-${sectionIndex}-${moduleIndex}`)}>${escapeHtml(content || titleText || baseTemplate.headline)}</h3>`;
            if (module.type === 'subheading') return `<h4${editable()}${attr(moduleKey, 'Module', `module-${sectionIndex}-${moduleIndex}`)}>${escapeHtml(content || titleText || '')}</h4>`;
            if (module.type === 'textarea' || isModularTextBlockModule(module)) {
              const inlineStyle = buildModularTextBlockInlineStyle(module.settings);
              return `<div${editable()}${attr(moduleKey, 'Module', `module-${sectionIndex}-${moduleIndex}`)}${inlineStyle ? ` style="${inlineStyle}"` : ''}>${textBlockHtml || '<p>No text set</p>'}</div>`;
            }
            if (module.type === 'pitch' || module.type === 'text') return `<p${editable()}${attr(moduleKey, 'Module', `module-${sectionIndex}-${moduleIndex}`)}>${escapeHtml(content || titleText || '')}</p>`;
            if (module.type === 'cta') return `<div class="develop-template-cta-row"><button type="button"${editable()}${attr(moduleKey, 'Module', `module-${sectionIndex}-${moduleIndex}`)}>${escapeHtml(content || titleText || 'Call To Action')}</button></div>`;
            if (module.type === 'eyebrow') return `<div${editable('develop-template-eyebrow')}${attr(moduleKey, 'Module', `module-${sectionIndex}-${moduleIndex}`)}>${escapeHtml(content || titleText || baseTemplate.eyebrow)}</div>`;
            if (module.type === 'pod') {
              const podData = buildModularPageModuleContent(resolvedRecord, module);
              const clickAction = podData.targetPage ? `onclick="if(window.App && App.setActivePage) App.setActivePage('${escapeHtml(podData.targetPage)}');"` : '';
              return `
                <div class="pod card-hover"${editable()}${attr(moduleKey, 'Module', `module-${sectionIndex}-${moduleIndex}`)} ${clickAction}>
                  <div class="pod-icon-col"><img src="${escapeHtml(podData.logoUrl || '/images/logos/web.svg')}" class="pod-logo" alt="${escapeHtml(podData.title || 'Pod')} Logo" /></div>
                  <div class="pod-content">
                    <h3>${escapeHtml(podData.title || 'Channel Pod')}</h3>
                    <p>${escapeHtml(podData.description || '')}</p>
                  </div>
                </div>
              `;
            }
            if (module.type === 'spacer') return '<div style="height:1.25rem;"></div>';
            return `<div class="meta"${attr(moduleKey, 'Module', `module-${sectionIndex}-${moduleIndex}`)}>${escapeHtml(content || titleText || 'Module')}</div>`;
          })();

          let classString = '';
          if (module.sourceModuleId) {
            const sourceModule = getSavedModuleById(module.sourceModuleId);
            if (sourceModule && sourceModule.classId) {
              const cls = savedModuleClasses.find((c) => c.id === Number(sourceModule.classId) || String(c.id) === String(sourceModule.classId));
              if (cls && cls.name) {
                classString = ` develop-module-class-${slugify(cls.name)}`;
              }
            }
          }

          if (classString) {
            return `<div class="develop-module-wrapper${classString}">${innerMarkup}</div>`;
          }
          return innerMarkup;
        }).join('');
        const containerSettings = getSectionContainerSettings(section, column);
        const containerStyleStr = styleObjectToCssText(buildContainerStyle(containerSettings));
        return `<div class="develop-modular-page-column develop-modular-page-column-${column}"${containerStyleStr ? ` style="${escapeHtml(containerStyleStr)}"` : ''}>${moduleMarkup}</div>`;
      }).join('');
      const rowStyleStr = styleObjectToCssText(buildSectionRowStyle(section));
      const rowSettings = getSectionRowSettings(section);
      const overlayStyleStr = styleObjectToCssText(buildRowOverlayScreenStyle(rowSettings.overlayScreen));
      const overlayMarkup = hasActiveRowOverlayScreen(rowSettings.overlayScreen)
        ? `<div class="develop-row-overlay-screen"${overlayStyleStr ? ` style="${escapeHtml(overlayStyleStr)}"` : ''}></div>`
        : '';
      return `<section class="develop-modular-page-section develop-modular-page-layout-${layout.value}"${rowStyleStr ? ` style="${escapeHtml(rowStyleStr)}"` : ''}>${overlayMarkup}<div class="develop-modular-page-section__content">${section.title ? `<div class="develop-template-eyebrow">${escapeHtml(section.title)}</div>` : ''}<div class="develop-modular-page-columns" style="grid-template-columns:${buildModularPageGridTemplate(layout.value)};">${columns}</div></div></section>`;
    }).join('');
    return `<div class="develop-template-canvas develop-modular-page-preview"${attr('backgroundImageId', 'Background Image', 'page-background')} style="${canvasStyles.join(' ')}">${sectionMarkup}</div>`;
  }

  function getLandingPagePreviewContext(record) {
    const resolvedRecord = getLandingPageResolvedTemplateRecord(record);
    const template = getBaseLandingTemplateById(resolvedRecord?.templateId);
    const overrides = getLandingPageMergedContentOverrides(record);
    const headline = overrides.headline || getLandingPageHeadlineLabel(resolvedRecord?.headlineId) || template.headline;
    const pitch = overrides.pitch || getLandingPagePitchLabel(resolvedRecord?.pitchId) || template.lead;
    const cta = overrides['primary-cta'] || getLandingPageCtaLabel(resolvedRecord?.ctaId) || template.primaryCta;
    const form = savedForms.find((item) => safeText(item.id) === safeText(resolvedRecord?.formId)) || null;
    const formFields = Array.isArray(form?.fields) && form.fields.length
      ? form.fields
      : [
          { key: 'first_name', label: 'First Name', type: 'text', required: true },
          { key: 'email', label: 'Email', type: 'email', required: true },
          { key: 'company', label: 'Company', type: 'text', required: false },
        ];

    return {
      template,
      overrides,
      headline,
      pitch,
      cta,
      form,
      formFields,
      bannerUrl: getLandingPageAssetUrl(resolvedRecord?.websiteBannerImageId),
      backgroundUrl: getLandingPageAssetUrl(resolvedRecord?.backgroundImageId),
      featureUrl: getLandingPageAssetUrl(resolvedRecord?.featureImageId),
      highlightUrl: getLandingPageAssetUrl(resolvedRecord?.highlightImageId),
      logoWideUrl: getLandingPageAssetUrl(resolvedRecord?.logoWideId),
      logoSquareUrl: getLandingPageAssetUrl(resolvedRecord?.logoSquareId),
      primaryColor: safeText(resolvedRecord?.primaryColor) || DEFAULT_LANDING_PRIMARY,
      backgroundColor: safeText(resolvedRecord?.backgroundColor) || DEFAULT_LANDING_BACKGROUND,
      accentColor: safeText(resolvedRecord?.accentColor) || DEFAULT_LANDING_ACCENT,
      eyebrow: overrides.eyebrow || template.eyebrow,
      secondaryCta: overrides['secondary-cta'] || template.secondaryCta,
      featureOneTitle: getLandingPageHeadlineLabel(resolvedRecord?.featureHeadlineId) || safeText(resolvedRecord?.featureTitle, 500) || overrides['feature-one-title'] || template.featureOneTitle,
      featureOneCopy: getLandingPageSubheadingLabel(resolvedRecord?.featureSubheadingId) || safeText(resolvedRecord?.featureCopy, 5000) || overrides['feature-one-copy'] || template.featureOneCopy,
      featureTwoTitle: getLandingPageHeadlineLabel(resolvedRecord?.highlightHeadlineId) || safeText(resolvedRecord?.highlightTitle, 500) || overrides['feature-two-title'] || template.featureTwoTitle,
      featureTwoCopy: getLandingPagePitchLabel(resolvedRecord?.highlightPitchId) || safeText(resolvedRecord?.highlightCopy, 5000) || overrides['feature-two-copy'] || template.featureTwoCopy,
      formTitle: overrides['form-heading'] || safeText(form?.heading) || template.formTitle,
      formCopy: overrides['form-copy'] || template.formCopy,
      formSubmitLabel: overrides['form-submit'] || safeText(form?.submitLabel) || 'Submit Form',
      bodyTitle: getLandingPageHeadlineLabel(resolvedRecord?.bodyHeadlineId) || overrides['body-title'] || template.bodyTitle,
      bodyLead: getLandingPageSubheadingLabel(resolvedRecord?.bodySubheadingId) || overrides['body-lead'] || template.lead,
      bodyCopy: getLandingPagePitchLabel(resolvedRecord?.bodyPitchId) || overrides['body-copy'] || template.featureOneCopy,
    };
  }

  function buildLandingPageMarkup(record, options = {}) {
    if (!record) return '';
    const resolvedRecord = getLandingPageResolvedTemplateRecord(record);
    const modularSections = getModularEditorLayoutSections(resolvedRecord);
    if (normalizePageTemplateKind(resolvedRecord.templateKind) === 'modular' && modularSections.length) {
      return buildModularLandingPageMarkup({ ...resolvedRecord, layoutSections: modularSections }, options);
    }
    const {
      interactive = false,
      editableClass = 'develop-landing-editable',
    } = options;
    const ctx = getLandingPagePreviewContext(resolvedRecord);
    const attr = (key, label, slot = '') => (
      interactive
        ? ` data-edit-key="${key}" data-edit-label="${label}"${slot ? ` data-edit-slot="${slot}"` : ''}`
        : ''
    );
    const editable = (baseClass = '') => {
      const classes = [];
      if (baseClass) classes.push(baseClass);
      if (interactive) classes.push(editableClass);
      return classes.length ? ` class="${classes.join(' ')}"` : '';
    };
    const canvasStyles = [
      `--lp-primary:${ctx.primaryColor};`,
      `--lp-background:${ctx.backgroundColor};`,
      `--lp-accent:${ctx.accentColor};`,
    ];
    if (ctx.backgroundUrl) {
      canvasStyles.push(`--lp-page-background-image:url('${safeText(ctx.backgroundUrl)}');`);
    }
    const runtimeFieldMarkup = ctx.formFields.map((field, index) => {
      const fieldType = safeText(field?.type) || 'text';
      const fieldLabel = safeText(field?.label) || 'Field';
      const fieldKey = safeText(field?.key) || `field_${index}`;
      const required = Boolean(field?.required);
      return `<input name="${fieldKey}" type="${fieldType}" placeholder="${fieldLabel}${required ? ' *' : ''}"${required ? ' required' : ''}${editable()}${attr('formId', 'Form', 'form-fields')} />`;
    }).join('');

    return `
        <div class="develop-template-canvas"${attr('backgroundImageId', 'Background Image', 'page-background')} style="${canvasStyles.join(' ')}">
          <div${editable('develop-template-banner')}${attr('websiteBannerImageId', 'Website Banner Image', 'banner')}>${
          ctx.bannerUrl
            ? buildLandingAssetImage(record.websiteBannerImageId, getLandingPageAssetName(record.websiteBannerImageId, 'Page Banner Image'), 'develop-template-banner-img')
            : getLandingPageAssetName(record.websiteBannerImageId, 'Page Banner Image')
        }</div>
        <div class="develop-template-hero" style="background:${ctx.backgroundColor};">
          <div class="develop-template-copy">
            <div${editable('develop-template-eyebrow')}${attr('theme', 'Theme', 'eyebrow')}${buildLandingPageTextAttrs(record, 'eyebrow', `color:${ctx.accentColor};`)}>${ctx.eyebrow}</div>
            <h3${editable()}${attr('headlineId', 'Headline', 'headline')}${buildLandingPageTextAttrs(record, 'headline', `color:${ctx.primaryColor};`)}>${ctx.headline}</h3>
            <p${editable()}${attr('pitchId', 'Pitch', 'pitch')}${buildLandingPageTextAttrs(record, 'pitch')}>${ctx.pitch}</p>
            <div class="develop-template-cta-row">
              <button type="button"${editable()}${attr('ctaId', 'Call To Action', 'primary-cta')}${buildLandingPageTextAttrs(record, 'primary-cta', `background:${ctx.primaryColor}; border-color:${ctx.primaryColor};`)}>${ctx.cta}</button>
              <button type="button"${editable('develop-template-secondary-btn')}${attr('theme', 'Theme', 'secondary-cta')}${buildLandingPageTextAttrs(record, 'secondary-cta', `border-color:${ctx.accentColor}; color:${ctx.accentColor};`)}>${ctx.secondaryCta}</button>
            </div>
            <div class="develop-template-feature-grid">
              <div class="develop-template-feature-card">
                <div${editable('develop-template-image-slot')}${attr('featureImageId', 'Feature Image', 'feature-image')}>${
                  ctx.featureUrl
                    ? buildLandingAssetImage(record.featureImageId, getLandingPageAssetName(record.featureImageId, 'Feature Image'))
                    : getLandingPageAssetName(record.featureImageId, 'Feature Image')
                }</div>
                <h4${editable()}${attr('theme', 'Theme', 'feature-one-title')}${buildLandingPageTextAttrs(record, 'feature-one-title')}>${ctx.featureOneTitle}</h4>
                <p${editable()}${attr('theme', 'Theme', 'feature-one-copy')}${buildLandingPageTextAttrs(record, 'feature-one-copy')}>${ctx.featureOneCopy}</p>
              </div>
              <div class="develop-template-feature-card">
                <div${editable('develop-template-image-slot')}${attr('highlightImageId', 'Highlight Image', 'highlight-image')}>${
                  ctx.highlightUrl
                    ? buildLandingAssetImage(record.highlightImageId, getLandingPageAssetName(record.highlightImageId, 'Highlight Image'))
                    : getLandingPageAssetName(record.highlightImageId, 'Highlight Image')
                }</div>
                <h4${editable()}${attr('theme', 'Theme', 'feature-two-title')}${buildLandingPageTextAttrs(record, 'feature-two-title')}>${ctx.featureTwoTitle}</h4>
                <p${editable()}${attr('theme', 'Theme', 'feature-two-copy')}${buildLandingPageTextAttrs(record, 'feature-two-copy')}>${ctx.featureTwoCopy}</p>
              </div>
            </div>
          </div>
          <aside${editable('develop-template-form-card')}${attr('formId', 'Form', 'form-card')}>
            <div class="develop-template-logo-row">
              <div${editable('develop-template-logo-slot develop-template-logo-square')}${attr('logoSquareId', 'Logo - Square', 'logo-square')}>${
                ctx.logoSquareUrl
                  ? buildLandingAssetImage(record.logoSquareId, 'Logo - Square')
                  : 'Logo - Square'
              }</div>
            </div>
            <form class="develop-template-runtime-form${interactive ? ' develop-template-runtime-form-disabled' : ''}" data-landing-page-id="${safeText(record.id)}" data-form-id="${safeText(record.formId)}">
              <h3${editable()}${attr('formId', 'Form', 'form-heading')}${buildLandingPageTextAttrs(record, 'form-heading', `color:${ctx.accentColor};`)}>${ctx.formTitle}</h3>
              <p${editable()}${attr('formId', 'Form', 'form-copy')}${buildLandingPageTextAttrs(record, 'form-copy')}>${ctx.formCopy}</p>
              ${runtimeFieldMarkup}
              <button type="${interactive ? 'button' : 'submit'}"${editable()}${attr('formId', 'Form', 'form-submit')}${buildLandingPageTextAttrs(record, 'form-submit', `background:${ctx.primaryColor}; border-color:${ctx.primaryColor};`)}>${ctx.formSubmitLabel}</button>
              <div class="develop-template-form-status" aria-live="polite"></div>
            </form>
          </aside>
        </div>
        <div class="develop-template-content">
          <div class="develop-template-body-copy">
            <h3${editable()}${attr('theme', 'Theme', 'body-title')}${buildLandingPageTextAttrs(record, 'body-title')}>${ctx.bodyTitle}</h3>
            <p${editable()}${attr('theme', 'Theme', 'body-lead')}${buildLandingPageTextAttrs(record, 'body-lead')}>${ctx.bodyLead}</p>
            <p${editable()}${attr('theme', 'Theme', 'body-copy')}${buildLandingPageTextAttrs(record, 'body-copy')}>${ctx.bodyCopy}</p>
          </div>
        </div>
      </div>
    `;
  }

  function bindLandingPageRuntimeForms(host, record) {
    if (!host || !record) return;
    const formConfig = savedForms.find((item) => safeText(item.id) === safeText(record.formId)) || null;
    const leadMagnetId = safeText(formConfig?.leadMagnetId) || safeText(record?.leadMagnetId);
    const leadMagnetAsset = getAssetById(leadMagnetId);
    const leadMagnetUrl = leadMagnetAsset ? toDirectAssetUrl(leadMagnetAsset.location) : '';
    host.querySelectorAll('.develop-template-runtime-form').forEach((form) => {
      const submitButton = form.querySelector('button[type="submit"]');
      const status = form.querySelector('.develop-template-form-status');
      if (!submitButton) return;
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submitButton.disabled = true;
        if (status) {
          status.textContent = 'Submitting...';
          status.classList.remove('is-error', 'is-success');
        }
        try {
          const formData = new FormData(form);
          const fields = {};
          formData.forEach((value, key) => {
            fields[String(key)] = String(value || '').trim();
          });
          await api(`/api/develop/landing-pages/${encodeURIComponent(record.id)}/submit`, {
            method: 'POST',
            body: JSON.stringify({
              formId: safeText(record.formId),
              fields,
            }),
          });
          form.reset();
          if (status) {
            status.textContent = safeText(formConfig?.successMessage) || 'Contact saved.';
            status.classList.remove('is-error');
            status.classList.add('is-success');
          }
          openLandingPageThankYouPage({
            title: 'Thank You',
            message: safeText(formConfig?.successMessage) || 'Thank you. Your request has been received.',
            leadMagnetUrl,
            leadMagnetId: leadMagnetAsset ? safeText(leadMagnetAsset.id) : '',
            landingPageId: safeText(record.id),
            leadMagnetLabel: leadMagnetAsset ? `Download ${assetLabel(leadMagnetAsset, 'Lead Magnet')}` : 'Open Lead Magnet',
          });
        } catch (err) {
          if (status) {
            status.textContent = safeText(formConfig?.errorMessage) || err.message || 'Could not save contact';
            status.classList.remove('is-success');
            status.classList.add('is-error');
          }
        } finally {
          submitButton.disabled = false;
        }
      });
    });

    host.querySelectorAll('.develop-template-runtime-poll-form').forEach((form) => {
      const submitButton = form.querySelector('button[type="submit"]');
      const status = form.querySelector('.develop-poll-status');
      if (!submitButton) return;
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submitButton.disabled = true;
        if (status) {
          status.textContent = 'Submitting...';
          status.classList.remove('is-error', 'is-success');
        }
        try {
          const formData = new FormData(form);
          const pollId = safeText(form.getAttribute('data-poll-id'));
          const vote = String(formData.get(`poll_${pollId}`) || '').trim();
          if (!vote) throw new Error('Please select an option');
          await api(`/api/develop/modules/${encodeURIComponent(pollId)}/poll-submit`, {
            method: 'POST',
            body: JSON.stringify({ vote }),
          });
          form.reset();
          if (status) {
            status.innerHTML = 'Thank you for your vote! Fetching results...';
            status.classList.remove('is-error');
            status.classList.add('is-success');
            
            try {
              const res = await api(`/api/develop/modules/${encodeURIComponent(pollId)}/poll-results`);
              const results = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
              if (results.length > 0) {
                const total = res.total || results.reduce((acc, r) => acc + (r.count || 0), 0);
                const resultsMarkup = results.map(r => {
                  return `<div style="margin-bottom: 0.5rem;">
                    <div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-bottom:0.2rem;">
                      <span>${escapeHtml(r.option)}</span>
                      <span>${r.percentage}% (${r.count})</span>
                    </div>
                    <div style="width:100%;height:6px;background:rgba(0,0,0,0.1);border-radius:3px;overflow:hidden;">
                      <div style="width:${r.percentage}%;height:100%;background:#0b82d4;border-radius:3px;"></div>
                    </div>
                  </div>`;
                }).join('');
                
                const optionsContainer = form.querySelector('.develop-poll-options');
                if (optionsContainer) optionsContainer.style.display = 'none';
                submitButton.style.display = 'none';
                
                status.innerHTML = `<div style="margin-top: 1rem;">${resultsMarkup}</div><div style="margin-top: 0.5rem;font-size:0.8rem;opacity:0.7;text-align:center;">Total votes: ${total}</div>`;
              } else {
                status.textContent = 'Thank you for your vote! No results yet.';
              }
            } catch (err) {
              status.textContent = 'Thank you for your vote!';
            }
          }
        } catch (err) {
          if (status) {
            status.textContent = err.message || 'Could not submit vote';
            status.classList.remove('is-success');
            status.classList.add('is-error');
          }
        } finally {
          submitButton.disabled = false;
        }
      });
    });
  }

  function getActiveLandingPageVisualRecord() {
    if (!activeLandingPageVisualRecord) return null;
    const baseOverrides = normalizeLandingPageContentOverrides(activeLandingPageVisualRecord.contentOverrides);
    const draftOverrides = normalizeLandingPageContentOverrides(landingPageVisualDraft.contentOverrides);
    return {
      ...activeLandingPageVisualRecord,
      ...landingPageVisualDraft,
      contentOverrides: {
        ...baseOverrides,
        ...draftOverrides,
      },
    };
  }

  function getLandingPageVisualEditorTitle(key) {
    return {
      theme: 'Theme',
      headlineId: 'Headline',
      pitchId: 'Pitch',
      ctaId: 'Call To Action',
      formId: 'Form',
      websiteBannerImageId: 'Website Banner Image',
      featureImageId: 'Feature Image',
      highlightImageId: 'Highlight Image',
      backgroundImageId: 'Background Image',
      logoWideId: 'Logo - Wide',
      logoSquareId: 'Logo - Square',
    }[key] || key;
  }

  function setLandingPageVisualDraftValue(fieldKey, value, options = {}) {
    const nextValue = safeText(value);
    landingPageVisualDraft[fieldKey] = nextValue;
    if (fieldKey === 'templateId') {
      activeLandingPageVisualRecord.templateId = nextValue || activeLandingPageVisualRecord.templateId;
    }
    if (!options.skipRender) {
      renderLandingPageVisualEditor();
    }
  }

  function createLandingPageVisualSelectControl(record, fieldKey, label, placeholder) {
    const wrap = document.createElement('label');
    wrap.className = 'develop-inline-editor-field';

    const text = document.createElement('span');
    text.className = 'develop-inline-editor-field-label';
    text.textContent = label;
    wrap.appendChild(text);

    const meta = getLandingPageFieldFilterMeta(fieldKey);
    let activeFilter = '';
    if (meta) {
      const filter = document.createElement('select');
      const rows = getLandingPageFieldRows(fieldKey);
      const values = Array.from(new Set(rows.map((row) => safeText(meta.getValue(row))).filter(Boolean))).sort((a, b) => a.localeCompare(b));
      setSelectOptions(
        filter,
        values.map((value) => ({ value, label: meta.getLabel(value) })),
        meta.placeholder,
        getLandingPageFilterState(fieldKey).category
      );
      activeFilter = safeText(filter.value);
      filter.addEventListener('change', () => {
        getLandingPageFilterState(fieldKey).category = safeText(filter.value);
        renderLandingPageVisualEditor();
      });
      wrap.appendChild(filter);
    }

    const select = document.createElement('select');
    const first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder;
    select.appendChild(first);
    const optionFilterState = meta
      ? { ...getLandingPageFilterState(fieldKey), category: activeFilter }
      : getLandingPageFilterState(fieldKey);
    getLandingPageVisualEditorOptions(fieldKey, optionFilterState).forEach((item) => {
      const option = document.createElement('option');
      option.value = String(item.value);
      option.textContent = item.label;
      select.appendChild(option);
    });
    select.value = safeText(record[fieldKey]);
    select.addEventListener('change', () => {
      setLandingPageVisualDraftValue(fieldKey, select.value);
    });
    wrap.appendChild(select);
    return wrap;
  }

  function createLandingPageVisualColorControl(record, fieldKey, label, fallback) {
    const wrap = document.createElement('label');
    wrap.className = 'develop-inline-editor-field';

    const text = document.createElement('span');
    text.className = 'develop-inline-editor-field-label';
    text.textContent = label;
    wrap.appendChild(text);

    const input = document.createElement('input');
    input.type = 'color';
    input.value = safeText(record[fieldKey]) || fallback;
    input.addEventListener('input', () => {
      setLandingPageVisualDraftValue(fieldKey, input.value);
    });
    wrap.appendChild(input);
    return wrap;
  }

  function createLandingPageVisualAssetNavigator(record, fieldKey, label, placeholder, options = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'develop-inline-editor-field';
    wrap.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    const title = document.createElement('span');
    title.className = 'develop-inline-editor-field-label';
    title.textContent = label;
    wrap.appendChild(title);

    const controls = document.createElement('div');
    controls.className = 'develop-inline-asset-nav';

    const chooseBtn = document.createElement('button');
    chooseBtn.type = 'button';
    chooseBtn.textContent = `Choose ${label}`;

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = 'Clear';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';

    const status = document.createElement('span');
    status.className = 'develop-inline-asset-status';

    const preview = document.createElement('div');
    preview.className = 'develop-inline-asset-preview';

    const updateStatus = () => {
      const currentValue = safeText(getActiveLandingPageVisualRecord()?.[fieldKey] || record[fieldKey]);
      const asset = getAssetById(currentValue);
      status.textContent = asset ? assetLabel(asset, label) : placeholder;
      const assetUrl = asset ? toDirectAssetUrl(asset.location) : '';
      preview.textContent = '';
      if (assetUrl) {
        const img = document.createElement('img');
        img.src = assetUrl;
        img.alt = assetLabel(asset, label);
        preview.appendChild(img);
      } else {
        const fallback = document.createElement('span');
        fallback.textContent = asset ? assetLabel(asset, label) : 'No asset selected';
        preview.appendChild(fallback);
      }
    };

    chooseBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const config = getLandingPageImagePickerConfigForField(fieldKey);
      if (!config) {
        notify(`No image picker is configured for ${label}`, true);
        return;
      }
      window.setTimeout(() => {
        const modal = openImageAssetPicker(config, {
          getValue: () => safeText(getActiveLandingPageVisualRecord()?.[fieldKey] || record[fieldKey]),
          setValue: (value) => {
            setLandingPageVisualDraftValue(fieldKey, value);
          },
          afterChange: () => {
            updateStatus();
          },
          uploadHandler: (file) => {
            return uploadThemeAssetFile(file, config.selectId);
          },
        });
        if (!modal) {
          notify(`Could not open the image picker for ${label}`, true);
        }
      }, 0);
    });
    clearBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setLandingPageVisualDraftValue(fieldKey, '');
    });
    closeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof options.onClose === 'function') {
        options.onClose();
      }
    });

    controls.appendChild(chooseBtn);
    controls.appendChild(status);
    controls.appendChild(clearBtn);
    if (typeof options.onClose === 'function') {
      controls.appendChild(closeBtn);
    }
    wrap.appendChild(controls);
    wrap.appendChild(preview);
    updateStatus();
    return wrap;
  }

  function getLandingPageImagePickerConfigForField(fieldKey) {
    const key = safeText(fieldKey);
    return Object.values(LANDING_IMAGE_PICKERS).find((config) => safeText(config.fieldKey) === key) || null;
  }

  function createLandingPageInlineEditor(key, record) {
    const panel = document.createElement('section');
    panel.className = 'develop-inline-editor';

    const header = document.createElement('div');
    header.className = 'develop-inline-editor-header';

    const title = document.createElement('strong');
    title.textContent = getLandingPageVisualEditorTitle(key);
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      activeLandingPageVisualEditors.delete(key);
      renderLandingPageVisualEditor();
    });
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'develop-inline-editor-body';

    if (key === 'theme') {
      body.appendChild(createLandingPageVisualSelectControl(record, 'templateId', 'Template', 'Template'));
      body.appendChild(createLandingPageVisualColorControl(record, 'primaryColor', 'Primary Color', DEFAULT_LANDING_PRIMARY));
      body.appendChild(createLandingPageVisualColorControl(record, 'backgroundColor', 'Background Color', DEFAULT_LANDING_BACKGROUND));
      body.appendChild(createLandingPageVisualColorControl(record, 'accentColor', 'Accent Color', DEFAULT_LANDING_ACCENT));
    } else if (key === 'headlineId') {
      body.appendChild(createLandingPageVisualSelectControl(record, 'headlineId', 'Headline', 'No Headline'));
    } else if (key === 'pitchId') {
      body.appendChild(createLandingPageVisualSelectControl(record, 'pitchId', 'Pitch', 'No Pitch'));
    } else if (key === 'ctaId') {
      body.appendChild(createLandingPageVisualSelectControl(record, 'ctaId', 'Call To Action', 'No CTA'));
    } else if (key === 'formId') {
      body.appendChild(createLandingPageVisualSelectControl(record, 'formId', 'Form', 'No Form'));
    } else if (key === 'websiteBannerImageId') {
      body.appendChild(createLandingPageVisualAssetNavigator(record, 'websiteBannerImageId', 'Website Banner Image', 'No Banner Image'));
    } else if (key === 'featureImageId') {
      body.appendChild(createLandingPageVisualAssetNavigator(record, 'featureImageId', 'Feature Image', 'No Feature Image'));
    } else if (key === 'highlightImageId') {
      body.appendChild(createLandingPageVisualAssetNavigator(record, 'highlightImageId', 'Highlight Image', 'No Highlight Image'));
    } else if (key === 'backgroundImageId') {
      body.appendChild(createLandingPageVisualAssetNavigator(record, 'backgroundImageId', 'Background Image', 'No Background Image'));
    } else if (key === 'logoWideId') {
      body.appendChild(createLandingPageVisualAssetNavigator(record, 'logoWideId', 'Logo - Wide', 'No Wide Logo'));
    } else if (key === 'logoSquareId') {
      body.appendChild(createLandingPageVisualAssetNavigator(record, 'logoSquareId', 'Logo - Square', 'No Square Logo'));
    }

    panel.appendChild(body);
    return panel;
  }

  function isLandingPageImageEditorKey(key) {
    return [
      'websiteBannerImageId',
      'featureImageId',
      'highlightImageId',
      'backgroundImageId',
      'logoWideId',
      'logoSquareId',
    ].includes(safeText(key));
  }

  function mountLandingPageInlineAssetSelect(target, key, record, editorId, config = {}) {
    const label = safeText(config.label) || getLandingPageVisualEditorTitle(key);
    const current = safeText(record?.[key]);
    if (isLandingPageImageEditorKey(key)) {
      const wrap = document.createElement('div');
      wrap.className = 'develop-inline-textarea-wrap';
      wrap.addEventListener('click', (event) => {
        event.stopPropagation();
      });
      wrap.appendChild(createLandingPageVisualAssetNavigator(
        record,
        key,
        label,
        safeText(config.placeholder) || `Select ${label}`,
        {
          onClose: () => {
            activeLandingPageVisualEditors.delete(editorId);
            renderLandingPageVisualEditor();
          },
        }
      ));
      target.classList.add('develop-inline-hidden-target');
      target.insertAdjacentElement('afterend', wrap);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'develop-inline-image-select';
    const state = getLandingPageFilterState(key);
    const rows = getLandingPageFieldRows(key);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Filter: Asset Name';
    nameInput.value = safeText(state.asset_name);
    nameInput.addEventListener('click', (event) => event.stopPropagation());
    nameInput.addEventListener('input', () => {
      state.asset_name = safeText(nameInput.value);
      renderLandingPageVisualEditor();
    });
    wrap.appendChild(nameInput);

    const typeValues = Array.from(new Set(rows.map((row) => safeText(row?.assetType)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    const typeSelect = document.createElement('select');
    setSelectOptions(
      typeSelect,
      typeValues.map((value) => ({ value, label: value })),
      'All Asset Types',
      state.asset_type
    );
    typeSelect.addEventListener('click', (event) => event.stopPropagation());
    typeSelect.addEventListener('change', () => {
      state.asset_type = safeText(typeSelect.value);
      renderLandingPageVisualEditor();
    });
    wrap.appendChild(typeSelect);

    const categoryValues = Array.from(new Set(rows.map((row) => safeText(row?.category)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    const categorySelect = document.createElement('select');
    setSelectOptions(
      categorySelect,
      categoryValues.map((value) => ({ value, label: value })),
      'All Categories',
      state.category
    );
    categorySelect.addEventListener('click', (event) => event.stopPropagation());
    categorySelect.addEventListener('change', () => {
      state.category = safeText(categorySelect.value);
      renderLandingPageVisualEditor();
    });
    wrap.appendChild(categorySelect);

    const tagsInput = document.createElement('input');
    tagsInput.type = 'text';
    tagsInput.placeholder = 'Filter: Tags';
    tagsInput.value = safeText(state.tags);
    tagsInput.addEventListener('click', (event) => event.stopPropagation());
    tagsInput.addEventListener('input', () => {
      state.tags = safeText(tagsInput.value);
      renderLandingPageVisualEditor();
    });
    wrap.appendChild(tagsInput);

    const select = document.createElement('select');
    const first = document.createElement('option');
    first.value = '';
    first.textContent = safeText(config.placeholder) || `Select ${label}`;
    select.appendChild(first);
    getLandingPageVisualEditorOptions(key, state).forEach((item) => {
      const option = document.createElement('option');
      option.value = String(item.value);
      option.textContent = item.label;
      select.appendChild(option);
    });
    select.value = current;
    select.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    select.addEventListener('change', () => {
      setLandingPageVisualDraftValue(key, select.value);
    });

    if (config.textSlot) {
      wrap.appendChild(createLandingPageTextStyleControls(config.textSlot));
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      activeLandingPageVisualEditors.delete(editorId);
      renderLandingPageVisualEditor();
    });

    wrap.appendChild(select);
    wrap.appendChild(closeBtn);
    target.textContent = '';
    target.appendChild(wrap);
    target.classList.add('develop-inline-image-editor-target');
  }

  function mountLandingPageInlineFormSelect(target, record, editorId) {
    const key = 'formId';
    const current = safeText(record?.formId);
    const state = getLandingPageFilterState(key);
    const rows = getLandingPageFieldRows(key);

    const wrap = document.createElement('div');
    wrap.className = 'develop-inline-image-select';

    const templateSelect = document.createElement('select');
    const templateValues = Array.from(new Set(rows.map((row) => safeText(row?.formType)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    setSelectOptions(
      templateSelect,
      templateValues.map((value) => ({ value, label: getFormTemplateById(value).name })),
      'All Form Templates',
      state.formType
    );
    templateSelect.addEventListener('click', (event) => event.stopPropagation());
    templateSelect.addEventListener('change', () => {
      state.formType = safeText(templateSelect.value);
      renderLandingPageVisualEditor();
    });
    wrap.appendChild(templateSelect);

    const select = document.createElement('select');
    const first = document.createElement('option');
    first.value = '';
    first.textContent = 'No Form';
    select.appendChild(first);
    getLandingPageVisualEditorOptions(key, state).forEach((item) => {
      const option = document.createElement('option');
      option.value = String(item.value);
      option.textContent = item.label;
      select.appendChild(option);
    });
    select.value = current;
    select.addEventListener('click', (event) => event.stopPropagation());
    select.addEventListener('change', () => {
      setLandingPageVisualDraftValue(key, select.value);
    });
    wrap.appendChild(select);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      activeLandingPageVisualEditors.delete(editorId);
      renderLandingPageVisualEditor();
    });
    wrap.appendChild(closeBtn);

    target.textContent = '';
    target.appendChild(wrap);
    target.classList.add('develop-inline-image-editor-target');
  }

  function mountLandingPageInlineTextEditor(target, slot, record, editorId) {
    const slotSelectSpec = getLandingPageSlotSelectSpec(slot);
    if (slotSelectSpec) {
      mountLandingPageInlineAssetSelect(target, slotSelectSpec.fieldKey, record, editorId, {
        label: slotSelectSpec.label,
        placeholder: slotSelectSpec.placeholder,
        textSlot: slot,
      });
      return;
    }
    const directFieldKey = getLandingPageTextSlotFieldKey(slot);
    const overrides = getLandingPageMergedContentOverrides(record);
    const fallbackText = safeText(
      target.textContent || target.getAttribute('placeholder') || target.value || '',
      10000
    );
    const currentText = directFieldKey
      ? safeText(record?.[directFieldKey], 10000) || fallbackText
      : (safeText(overrides[slot], 10000) || fallbackText);
    const wrap = document.createElement('div');
    wrap.className = 'develop-inline-textarea-wrap';
    const textArea = document.createElement('textarea');
    textArea.className = 'develop-inline-textarea';
    textArea.value = currentText;
    textArea.rows = Math.max(2, Math.min(8, Math.ceil((currentText || fallbackText || 'X').length / 42)));
    textArea.style.minHeight = `${Math.max(target.offsetHeight || 72, 56)}px`;
    textArea.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    textArea.addEventListener('input', () => {
      if (directFieldKey) {
        setLandingPageVisualDraftValue(directFieldKey, textArea.value, { skipRender: true });
      } else {
        setLandingPageContentOverride(slot, textArea.value);
      }
    });
    textArea.addEventListener('blur', () => {
      renderLandingPageVisualEditor();
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';
    closeBtn.className = 'develop-inline-textarea-close';
    closeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      activeLandingPageVisualEditors.delete(editorId);
      renderLandingPageVisualEditor();
    });

    wrap.appendChild(textArea);
    wrap.appendChild(createLandingPageTextStyleControls(slot));
    wrap.appendChild(closeBtn);
    target.classList.add('develop-inline-hidden-target');
    target.insertAdjacentElement('afterend', wrap);
    setTimeout(() => {
      textArea.focus();
      textArea.select();
    }, 0);
  }

  function applyLandingPageAutoFit(host) {
    if (!host) return;
    host.querySelectorAll('[data-text-slot][data-size-to-fit="1"]').forEach((node) => {
      const inlineScale = Number(node.style.fontSize.replace('em', '')) || 1;
      const parentFontPx = Number(window.getComputedStyle(node.parentElement || node).fontSize.replace('px', '')) || 16;
      const basePx = parentFontPx * inlineScale;
      let nextPx = Math.max(10, Math.min(72, basePx));
      node.style.fontSize = `${nextPx}px`;

      let guard = 0;
      while (guard < 12 && (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)) {
        nextPx -= 1;
        if (nextPx <= 10) break;
        node.style.fontSize = `${nextPx}px`;
        guard += 1;
      }
      while (
        guard < 24 &&
        node.scrollHeight <= node.clientHeight * 0.9 &&
        node.scrollWidth <= node.clientWidth * 0.9 &&
        nextPx < 72
      ) {
        nextPx += 1;
        node.style.fontSize = `${nextPx}px`;
        guard += 1;
        if (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1) {
          nextPx -= 1;
          node.style.fontSize = `${nextPx}px`;
          break;
        }
      }
    });
  }

  function createLandingPageTextStyleControls(slot) {
    const textStyle = getLandingPageTextStyle(getActiveLandingPageVisualRecord(), slot);
    const controls = document.createElement('div');
    controls.className = 'develop-inline-text-controls';

    const title = document.createElement('div');
    title.className = 'develop-inline-text-controls-label';
    title.textContent = 'Text Size';

    const sizeRow = document.createElement('div');
    sizeRow.className = 'develop-inline-fontsize-row';

    const currentIndex = Math.max(0, LANDING_TEXT_SCALE_OPTIONS.indexOf(textStyle.fontScale));

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.textContent = '◀';
    prevBtn.disabled = currentIndex <= 0;
    prevBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const currentIndex = Math.max(0, LANDING_TEXT_SCALE_OPTIONS.indexOf(getLandingPageTextStyle(getActiveLandingPageVisualRecord(), slot).fontScale));
      const nextIndex = Math.max(0, currentIndex - 1);
      setLandingPageTextStyle(slot, {
        ...getLandingPageTextStyle(getActiveLandingPageVisualRecord(), slot),
        fontScale: LANDING_TEXT_SCALE_OPTIONS[nextIndex],
      });
      renderLandingPageVisualEditor();
    });

    const sizeLabel = document.createElement('span');
    sizeLabel.className = 'develop-inline-fontsize-label';
    sizeLabel.textContent = `${Number(textStyle.fontScale).toFixed(2)}x${textStyle.fontScale === '1.00' ? ' (Default)' : ''}`;

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.textContent = '▶';
    nextBtn.disabled = currentIndex >= LANDING_TEXT_SCALE_OPTIONS.length - 1;
    nextBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const currentIndex = Math.max(0, LANDING_TEXT_SCALE_OPTIONS.indexOf(getLandingPageTextStyle(getActiveLandingPageVisualRecord(), slot).fontScale));
      const nextIndex = Math.min(LANDING_TEXT_SCALE_OPTIONS.length - 1, currentIndex + 1);
      setLandingPageTextStyle(slot, {
        ...getLandingPageTextStyle(getActiveLandingPageVisualRecord(), slot),
        fontScale: LANDING_TEXT_SCALE_OPTIONS[nextIndex],
      });
      renderLandingPageVisualEditor();
    });

    const fitToggle = document.createElement('label');
    fitToggle.className = 'checkbox-row';
    fitToggle.addEventListener('click', (event) => event.stopPropagation());
    const fitCheckbox = document.createElement('input');
    fitCheckbox.type = 'checkbox';
    fitCheckbox.checked = Boolean(textStyle.sizeToFit);
    fitCheckbox.addEventListener('change', () => {
      setLandingPageTextStyle(slot, {
        ...getLandingPageTextStyle(getActiveLandingPageVisualRecord(), slot),
        sizeToFit: fitCheckbox.checked,
      });
      renderLandingPageVisualEditor();
    });
    fitToggle.appendChild(fitCheckbox);
    fitToggle.appendChild(document.createTextNode('Size to fit'));

    const hint = document.createElement('div');
    hint.className = 'develop-inline-fontsize-hint';
    hint.textContent = 'Steps: 0.80x, 0.90x, 1.00x, 1.10x, 1.20x';

    controls.appendChild(title);
    sizeRow.appendChild(prevBtn);
    sizeRow.appendChild(sizeLabel);
    sizeRow.appendChild(nextBtn);
    controls.appendChild(sizeRow);
    controls.appendChild(fitToggle);
    controls.appendChild(hint);
    return controls;
  }

  function setLandingPageFormMode(isEditing) {
    const title = byId('developLandingPagesFormTitle');
    const submitBtn = byId('developLandingPagesSubmitBtn');
    const form = els.developLandingPagesForm;
    if (title) title.textContent = isEditing ? 'Builder: Edit Page' : 'Builder: Create Page';
    if (submitBtn) submitBtn.textContent = isEditing ? 'Update Page' : 'Save Page';
    if (form) {
      form.classList.toggle('develop-landing-page-editing', Boolean(isEditing));
    }
    updateLandingPageFieldOutlines();
  }

  function updateLandingPageFieldOutlines() {
    const form = els.developLandingPagesForm;
    if (!form) return;
    const isEditing = form.classList.contains('develop-landing-page-editing');
    const fields = form.querySelectorAll('input, select, textarea');
    fields.forEach((field) => {
      if (!field || field.type === 'hidden') return;
      field.classList.remove('develop-field-complete', 'develop-field-missing');
      if (!isEditing) return;
      const hasValue = safeText(field.value) !== '';
      field.classList.add(hasValue ? 'develop-field-complete' : 'develop-field-missing');
    });
  }

  function applyLandingPageRecordToForm(record) {
    if (!record) return;
    const form = els.developLandingPagesForm;
    if (!form) return;

    const idInput = byId('developLandingPageIdInput');
    const nameInput = byId('developLandingPageNameInput');
    if (idInput) idInput.value = safeText(record.id);
    if (nameInput) nameInput.value = safeText(record.name);

    landingPageColors = {
      primary: safeText(record.primaryColor) || DEFAULT_LANDING_PRIMARY,
      background: safeText(record.backgroundColor) || DEFAULT_LANDING_BACKGROUND,
      accent: safeText(record.accentColor) || DEFAULT_LANDING_ACCENT,
    };

    const primaryInput = byId('developLandingPrimaryColorInput');
    const backgroundInput = byId('developLandingBackgroundColorInput');
    const accentInput = byId('developLandingAccentColorInput');
    if (primaryInput) primaryInput.value = landingPageColors.primary;
    if (backgroundInput) backgroundInput.value = landingPageColors.background;
    if (accentInput) accentInput.value = landingPageColors.accent;

    const setValue = (id, value) => {
      const select = byId(id);
      if (select) select.value = safeText(value);
    };
    setValue('developLandingTemplateSelect', record.templateId);
    setValue('developLandingFormSelect', record.formId);
    setValue('developLandingLeadMagnetSelect', record.leadMagnetId);
    setValue('developLandingHeadlineSelect', record.headlineId);
    setValue('developLandingPitchSelect', record.pitchId);
    setValue('developLandingCtaSelect', record.ctaId);
    setValue('developLandingBannerImageSelect', record.websiteBannerImageId);
    setValue('developLandingBackgroundImageSelect', record.backgroundImageId);
    setValue('developLandingFeatureImageSelect', record.featureImageId);
    setValue('developLandingHighlightImageSelect', record.highlightImageId);
    setValue('developLandingFeatureHeadlineSelect', record.featureHeadlineId);
    setValue('developLandingFeatureSubheadingSelect', record.featureSubheadingId);
    setValue('developLandingHighlightHeadlineSelect', record.highlightHeadlineId);
    setValue('developLandingHighlightPitchSelect', record.highlightPitchId);
    setValue('developLandingBodyHeadlineSelect', record.bodyHeadlineId);
    setValue('developLandingBodySubheadingSelect', record.bodySubheadingId);
    setValue('developLandingBodyPitchSelect', record.bodyPitchId);
    setValue('developLandingLogoSquareSelect', record.logoSquareId);

    selectedTemplateId = safeText(record.templateId) || selectedTemplateId;
    renderTemplateLibrary();
    renderTemplatePreview(selectedTemplateId);
    setLandingPageFormMode(Boolean(safeText(record.id)));
    pendingLandingPageFormRecord = null;
  }

  function resetLandingPageForm() {
    pendingLandingPageFormRecord = null;
    clearLandingPageSelectorFilters();
    const form = els.developLandingPagesForm;
    if (form) form.reset();
    const idInput = byId('developLandingPageIdInput');
    if (idInput) idInput.value = '';
    landingPageColors = {
      primary: DEFAULT_LANDING_PRIMARY,
      background: DEFAULT_LANDING_BACKGROUND,
      accent: DEFAULT_LANDING_ACCENT,
    };
    const primaryInput = byId('developLandingPrimaryColorInput');
    const backgroundInput = byId('developLandingBackgroundColorInput');
    const accentInput = byId('developLandingAccentColorInput');
    if (primaryInput) primaryInput.value = landingPageColors.primary;
    if (backgroundInput) backgroundInput.value = landingPageColors.background;
    if (accentInput) accentInput.value = landingPageColors.accent;
    selectedTemplateId = LANDING_TEMPLATES[0].id;
    const templateSelect = byId('developLandingTemplateSelect');
    if (templateSelect) templateSelect.value = selectedTemplateId;
    renderTemplateLibrary();
    renderTemplatePreview(selectedTemplateId);
    setLandingPageFormMode(false);
    updateLandingPageFieldOutlines();
  }

  function buildEmptyLandingRecord(name, templateId) {
    const savedTemplate = getSavedPageTemplateById(templateId);
    return applyLandingPageDefaultSelections({
      id: '',
      name: safeText(name, 255),
      templateKind: normalizePageTemplateKind(savedTemplate?.templateKind),
      templateId: safeText(templateId, 120) || LANDING_TEMPLATES[0].id,
      primaryColor: DEFAULT_LANDING_PRIMARY,
      backgroundColor: DEFAULT_LANDING_BACKGROUND,
      accentColor: DEFAULT_LANDING_ACCENT,
      formId: '',
      leadMagnetId: '',
      headlineId: '',
      pitchId: '',
      ctaId: '',
      websiteBannerImageId: '',
      backgroundImageId: '',
      featureImageId: '',
      highlightImageId: '',
      featureHeadlineId: '',
      featureSubheadingId: '',
      featureTitle: '',
      featureCopy: '',
      highlightHeadlineId: '',
      highlightPitchId: '',
      highlightTitle: '',
      highlightCopy: '',
      bodyHeadlineId: '',
      bodySubheadingId: '',
      bodyPitchId: '',
      logoWideId: '',
      logoSquareId: '',
      layoutSections: normalizePageTemplateLayoutSections(savedTemplate?.layoutSections),
      contentOverrides: {},
      createdAt: '',
      updatedAt: '',
    });
  }

  function openCreateLandingPage() {
    loadLandingPageBuilderOptions()
      .catch(() => {})
      .finally(() => {
        openCreateLandingPageTemplatePicker();
      });
  }

  async function openCreateLandingTemplate() {
    try {
      await loadLandingPageBuilderOptions();
    } catch (_) {
      // We can still open the editor with whatever builder data is currently available.
    }
    const baseTemplate = getTemplateById(selectedTemplateId);
    const suggestedName = `${safeText(baseTemplate?.name) || 'Page'} Template`;
    const name = safeText(window.prompt('Template name', suggestedName), 255) || suggestedName;
    const record = buildEmptyLandingRecord(name, safeText(baseTemplate?.id) || selectedTemplateId);
    openLandingPageVisualEditor(record, { mode: 'template' });
  }

  async function openCreateModularLandingTemplate() {
    try {
      await loadLandingPageBuilderOptions();
    } catch (_) {
      await ensureAssetsLoaded().catch(() => {});
    }
    const baseTemplate = getTemplateById(selectedTemplateId);
    openModularPageTemplateEditor({
      id: '',
      name: `${safeText(baseTemplate?.name) || 'Page'} Modular Template`,
      templateKind: 'modular',
      templateId: safeText(baseTemplate?.id) || selectedTemplateId,
      layoutSections: createDefaultModularPageSections(),
    });
  }

  function openCreateLandingPageTemplatePicker() {
    const modularTemplates = getUnifiedModularPageTemplates();
    if (!App.components || typeof App.components.Modal !== 'function') {
      notify('Template picker is unavailable right now.', true);
      return;
    }
    const body = document.createElement('div');
    body.className = 'develop-template-records-card';
    if (!modularTemplates.all.length) {
      const empty = document.createElement('div');
      empty.className = 'develop-template-records-empty';
      empty.textContent = 'No modular page templates yet.';
      body.appendChild(empty);
    } else {
      const intro = document.createElement('p');
      intro.className = 'meta';
      intro.textContent = 'Choose a modular template to use as the starting point for this page.';
      body.appendChild(intro);
      const renderTemplateGroup = (label, templates) => {
        if (!templates.length) return;
        const heading = document.createElement('div');
        heading.className = 'develop-template-records-heading';
        heading.textContent = label;
        body.appendChild(heading);

        const list = document.createElement('div');
        list.className = 'stack-form';
        templates.forEach((template) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'develop-template-picker-row';
          const updatedLabel = template.updatedAt
            ? new Date(template.updatedAt).toLocaleString()
            : (template.createdAt ? new Date(template.createdAt).toLocaleString() : 'Starter Template');
          const copySpan = document.createElement('span');
          copySpan.className = 'develop-template-picker-row__copy';
          
          const titleSpan = document.createElement('span');
          titleSpan.className = 'develop-template-picker-row__title';
          titleSpan.textContent = safeText(template.name) || 'Untitled Template';
          
          const metaSpan = document.createElement('span');
          metaSpan.className = 'develop-template-picker-row__meta';
          metaSpan.textContent = `Base: ${getBaseLandingTemplateById(template.templateId).name || 'Base Template'} · Updated: ${updatedLabel}`;
          
          copySpan.appendChild(titleSpan);
          copySpan.appendChild(metaSpan);
          
          const actionSpan = document.createElement('span');
          actionSpan.className = 'develop-template-picker-row__action';
          actionSpan.textContent = 'Use Template';
          
          button.appendChild(copySpan);
          button.appendChild(actionSpan);
          button.addEventListener('click', () => {
            try {
              const pageName = `${safeText(template.name) || 'Modular'} Page`;
              openModularPageTemplateEditor({
                ...template,
                id: '',
                name: pageName,
                templateId: safeText(template.templateId),
                pageBackground: template.pageBackground || null,
                layoutSections: template.layoutSections ?? template.sections ?? [],
              }, {
                mode: 'page',
                sourceTemplateId: safeText(template.id),
                targetPage: 'developLandingPagesPage',
              });
              modal.close();
            } catch (err) {
              notify(err.message || 'Could not open page editor', true);
            }
          });
          list.appendChild(button);
        });
        body.appendChild(list);
      };

      renderTemplateGroup('My Templates', modularTemplates.saved);
      renderTemplateGroup('Starter Templates', modularTemplates.starters);
    }
    const modal = App.components.Modal({
      title: 'Choose Page Template',
      body,
      actions: [{ label: 'Close', onClick: () => modal.close() }],
      dialogClass: 'develop-email-template-modal',
      bodyClass: 'develop-email-template-modal-body',
    });
    modal.open();
  }

  function openEditLandingPage(record) {
    if (!record) return;
    clearLandingPageSelectorFilters();
    pendingLandingPageFormRecord = { ...record };
    setLandingPageFormMode(true);
    loadLandingPageBuilderOptions().catch(() => {
      if (pendingLandingPageFormRecord) applyLandingPageRecordToForm(pendingLandingPageFormRecord);
    });
    App.setActivePage('developLandingPagesPage', { skipNormalize: true });
  }

  function previewCurrentLandingPageForm() {
    const form = els.developLandingPagesForm;
    if (!form) return;
    const formData = new FormData(form);
    const payload = getLandingPageFormPayload(formData);
    if (!payload.templateId) {
      notify('Choose a template before previewing', true);
      return;
    }
    renderLandingPagePreview({
      id: safeText(formData.get('landing_page_id')),
      name: payload.name || 'Unsaved Page Preview',
      ...payload,
    });
    App.setActivePage('developLandingPagePreviewPage');
  }

  function renderLandingPagePreview(record) {
    const host = byId('developLandingPagePreviewHost');
    const title = byId('developLandingPagePreviewTitle');
    const modeBtn = byId('developLandingPagePreviewModeBtn');
    if (!host || !record) return;

    activeLandingPagePreviewRecord = record;
    if (title) title.textContent = safeText(record.name) || (activeLandingPagePreviewMode === 'template' ? 'Template Preview' : 'Page Preview');
    if (modeBtn) modeBtn.disabled = false;
    const parser = new DOMParser();
    const doc = parser.parseFromString(buildLandingPageMarkup(record), 'text/html');
    host.textContent = '';
    Array.from(doc.body.childNodes).forEach(n => host.appendChild(n.cloneNode(true)));
    bindLandingImageFallbacks(host);
    applyLandingPageAutoFit(host);
    if (activeLandingPagePreviewMode !== 'template') {
      bindLandingPageRuntimeForms(host, record);
    }
  }

  function saveLandingPageThankYouState(payload) {
    landingPageThankYouState = payload && typeof payload === 'object' ? payload : null;
    try {
      if (landingPageThankYouState) {
        window.sessionStorage.setItem(LANDING_THANK_YOU_STATE_KEY, JSON.stringify(landingPageThankYouState));
      } else {
        window.sessionStorage.removeItem(LANDING_THANK_YOU_STATE_KEY);
      }
    } catch (_) {
      // no-op
    }
  }

  function getLandingPageThankYouState() {
    if (landingPageThankYouState) return landingPageThankYouState;
    try {
      const raw = window.sessionStorage.getItem(LANDING_THANK_YOU_STATE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      landingPageThankYouState = parsed && typeof parsed === 'object' ? parsed : null;
      return landingPageThankYouState;
    } catch {
      return null;
    }
  }

  function getAssetTags(asset) {
    if (!asset) return [];
    if (Array.isArray(asset.tags)) return asset.tags.map((item) => safeText(item)).filter(Boolean);
    return safeText(asset.tags)
      .split(',')
      .map((item) => safeText(item))
      .filter(Boolean);
  }

  function getLeadMagnetThumbnailUrl(asset) {
    if (!asset) return '';
    if (safeText(asset.assetType) === 'Image') return toDirectAssetUrl(asset.location);
    const sourceAssetId = safeText(asset.id);
    const sourceLocation = safeText(asset.location);
    const thumbnail = (Array.isArray(state.assets) ? state.assets : []).find((item) => {
      if (safeText(item?.assetType) !== 'Image') return false;
      if (safeText(item?.category) !== 'Thumbnail') return false;
      const tags = getAssetTags(item);
      if (sourceAssetId && tags.includes(`source_asset_id:${sourceAssetId}`)) return true;
      if (sourceLocation && tags.includes(`source_location:${sourceLocation}`)) return true;
      return false;
    });
    return thumbnail ? toDirectAssetUrl(thumbnail.location) : '';
  }

  function renderLandingPageThankYouPage() {
    const host = byId('developLandingThankYouHost');
    if (!host) return;
    const state = getLandingPageThankYouState();
    const message = safeText(state?.message, 2000) || 'Thank you. Your request has been received.';
    const leadMagnetUrl = safeText(state?.leadMagnetUrl);
    const label = safeText(state?.leadMagnetLabel) || 'Open Lead Magnet';
    const title = safeText(state?.title) || 'Thank You';
    const hasLink = Boolean(leadMagnetUrl);
    const landingPageId = safeText(state?.landingPageId);
    const leadMagnetId = safeText(state?.leadMagnetId);
    const sourceRecord = savedLandingPages.find((item) => safeText(item.id) === landingPageId)
      || activeLandingPagePreviewRecord
      || null;
    const ctx = sourceRecord ? getLandingPagePreviewContext(sourceRecord) : null;
    const fallbackLabel = leadMagnetId ? getLandingPageAssetName(leadMagnetId, '') : '';
    const leadMagnetAsset = getAssetById(leadMagnetId)
      || (leadMagnetUrl ? (Array.isArray(state.assets) ? state.assets : []).find((asset) => toDirectAssetUrl(asset?.location) === leadMagnetUrl) : null)
      || null;
    const downloadThumbUrl = getLeadMagnetThumbnailUrl(leadMagnetAsset);
    const displayLabel = hasLink ? (label || fallbackLabel || 'Open Lead Magnet') : 'Lead Magnet Unavailable';

    const tParser = new DOMParser();
    const tDoc = tParser.parseFromString(`
      <div class="develop-template-canvas develop-thankyou-canvas">
        <div class="develop-template-banner">${
          ctx?.bannerUrl
            ? `<img src="${ctx.bannerUrl}" alt="${getLandingPageAssetName(sourceRecord?.websiteBannerImageId, 'Page Banner Image')}" class="develop-template-banner-img" />`
            : 'Page Banner Image'
        }</div>
        <div class="develop-template-hero develop-thankyou-hero-shell" style="${ctx ? `background:${ctx.backgroundColor};` : ''}">
          <div class="develop-thankyou-center">
            <h3 style="${ctx ? `color:${ctx.primaryColor};` : ''}">${title}</h3>
            <p>${message}</p>
            <a
              class="develop-thankyou-download${hasLink ? '' : ' is-disabled'}"
              href="${hasLink ? leadMagnetUrl : '#'}"
              ${hasLink ? 'target="_blank" rel="noopener noreferrer"' : ''}
              aria-label="${displayLabel}"
            >
              <span class="develop-thankyou-download-icon-wrap" aria-hidden="true">${
                downloadThumbUrl
                  ? `<img src="${downloadThumbUrl}" alt="${displayLabel}" class="develop-thankyou-download-thumb" />`
                  : '<span class="develop-thankyou-download-icon">⬇</span>'
              }</span>
              <span class="develop-thankyou-download-label">${displayLabel}</span>
            </a>
          </div>
        </div>
      </div>
    `, 'text/html');
    host.textContent = '';
    Array.from(tDoc.body.childNodes).forEach(n => host.appendChild(n.cloneNode(true)));
    bindLandingImageFallbacks(host);
  }

  function openLandingPageThankYouPage(payload) {
    saveLandingPageThankYouState(payload);
    ensureAssetsLoaded()
      .catch(() => {})
      .finally(() => {
        renderLandingPageThankYouPage();
        App.setActivePage('developLandingPageThankYouPage');
      });
  }

  function openLandingPagePreview(record, options = {}) {
    if (!record) return;
    ensureAssetsLoaded()
      .catch(() => {})
      .finally(() => {
        activeLandingPagePreviewMode = safeText(options.mode) === 'template' ? 'template' : 'page';
        renderLandingPagePreview(record);
        App.setActivePage('developLandingPagePreviewPage');
      });
  }

  function syncLandingVisualChrome(record) {
    const title = byId('developLandingPageVisualEditorTitle');
    const saveBtn = byId('developLandingPageVisualSaveBtn');
    const backBtn = byId('developLandingPageVisualBackBtn');
    const subject = activeLandingPageVisualMode === 'template' ? 'Template' : 'Page';
    if (title) title.textContent = record ? `Visual Editor: ${safeText(record.name) || subject}` : `Visual ${subject} Editor`;
    if (saveBtn) saveBtn.textContent = activeLandingPageVisualMode === 'template' ? 'Save Template' : 'Save All Changes';
    if (backBtn) backBtn.textContent = activeLandingPageVisualMode === 'template' ? 'Back To Templates' : 'Back To Pages';
  }

  function renderLandingPageVisualEditor() {
    const host = byId('developLandingPageVisualEditorHost');
    const saveBtn = byId('developLandingPageVisualSaveBtn');
    const modeBtn = byId('developLandingPageVisualModeBtn');
    const record = getActiveLandingPageVisualRecord();
    if (!host) return;
    if (saveBtn) saveBtn.disabled = !record || !landingPageVisualEditMode;
    if (modeBtn) {
      modeBtn.textContent = landingPageVisualEditMode ? 'Display Mode' : 'Edit Mode';
    }
    if (!record) {
      host.textContent = '';
      syncLandingVisualChrome(null);
      return;
    }
    syncLandingVisualChrome(record);
    const vParser = new DOMParser();
    const vDoc = vParser.parseFromString(buildLandingPageMarkup(record, { interactive: landingPageVisualEditMode }), 'text/html');
    host.textContent = '';
    Array.from(vDoc.body.childNodes).forEach(n => host.appendChild(n.cloneNode(true)));
    bindLandingImageFallbacks(host);
    applyLandingPageAutoFit(host);
    if (!landingPageVisualEditMode) {
      bindLandingPageRuntimeForms(host, record);
      return;
    }
    host.querySelectorAll('[data-edit-key]').forEach((node) => {
      node.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const key = safeText(node.dataset.editKey);
        const slot = safeText(node.dataset.editSlot);
        if (!key) return;
        const editorId = key === 'formId' ? 'formId' : getLandingPageEditorId(key, slot || key);
        activeLandingPageVisualEditors.add(editorId);
        renderLandingPageVisualEditor();
      });
    });
    Array.from(activeLandingPageVisualEditors).forEach((editorId) => {
      const { key, slot } = parseLandingPageEditorId(editorId);
      let target = null;
      if (slot) {
        target = host.querySelector(`[data-edit-key="${key}"][data-edit-slot="${slot}"]`);
      }
      if (!target && key) {
        target = host.querySelector(`[data-edit-key="${key}"]`);
      }
      if (!target) return;
      target.classList.add('develop-landing-editing-active');
      if (key === 'formId') {
        target = host.querySelector('[data-edit-key="formId"][data-edit-slot="form-card"]') || target;
        mountLandingPageInlineFormSelect(target, record, editorId);
      } else if (isLandingPageImageEditorKey(key)) {
        mountLandingPageInlineAssetSelect(target, key, record, editorId);
      } else {
        mountLandingPageInlineTextEditor(target, slot || key, record, editorId);
      }
    });
  }

  function openLandingPageVisualEditor(record, options = {}) {
    if (!record) return;
    loadLandingPageBuilderOptions()
      .catch(() => ensureAssetsLoaded().catch(() => {}))
      .finally(() => {
        activeLandingPageVisualMode = safeText(options.mode) === 'template' ? 'template' : 'page';
        activeLandingPageVisualRecord = applyLandingPageDefaultSelections({
          ...record,
          templateKind: normalizePageTemplateKind(record.templateKind || record.template_kind),
          layoutSections: normalizePageTemplateLayoutSections(record.layoutSections || record.layout_sections),
          contentOverrides: normalizeLandingPageContentOverrides(record.contentOverrides),
        });
        landingPageVisualEditMode = true;
        landingPageVisualDraft = {};
        activeLandingPageVisualEditors.clear();
        renderLandingPageVisualEditor();
        App.setActivePage('developLandingPageVisualEditorPage');
      });
  }

  function getFilteredSortedLandingPages() {
    const nameFilter = safeText(landingPageTableState.filters.name).toLowerCase();
    const templateFilter = safeText(landingPageTableState.filters.templateId);

    const rows = savedLandingPages.filter((item) => {
      const name = safeText(item.name).toLowerCase();
      const templateId = safeText(item.templateId);
      if (nameFilter && !name.includes(nameFilter)) return false;
      if (templateFilter && templateId !== templateFilter) return false;
      return true;
    });

    const key = safeText(landingPageTableState.sort.key);
    const dir = landingPageTableState.sort.dir === 'asc' ? 'asc' : 'desc';
    rows.sort((a, b) => {
      let left = '';
      let right = '';
      if (key === 'name') {
        left = safeText(a.name).toLowerCase();
        right = safeText(b.name).toLowerCase();
      } else if (key === 'templateId') {
        left = getLandingPageTemplateName(a.templateId).toLowerCase();
        right = getLandingPageTemplateName(b.templateId).toLowerCase();
      } else if (key === 'headlineId') {
        left = getLandingPageHeadlineLabel(a.headlineId).toLowerCase();
        right = getLandingPageHeadlineLabel(b.headlineId).toLowerCase();
      } else if (key === 'formId') {
        left = getSavedFormName(a.formId).toLowerCase();
        right = getSavedFormName(b.formId).toLowerCase();
      } else {
        left = safeText(a.updatedAt);
        right = safeText(b.updatedAt);
      }
      if (left === right) return 0;
      const result = left < right ? -1 : 1;
      return dir === 'asc' ? result : -result;
    });

    return rows;
  }

  function syncLandingPageTableControls() {
    const visibleIds = getFilteredSortedLandingPages().map((item) => safeText(item.id)).filter(Boolean);
    selectedLandingPageIds = new Set(Array.from(selectedLandingPageIds).filter((id) => visibleIds.includes(id) || savedLandingPages.some((item) => safeText(item.id) === id)));

    const selectAll = byId('developLandingPagesSelectAllVisible');
    const bulkDeleteBtn = byId('developLandingPagesBulkDeleteBtn');
    if (selectAll) {
      const selectedVisibleCount = visibleIds.filter((id) => selectedLandingPageIds.has(id)).length;
      selectAll.checked = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
      selectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length;
      selectAll.disabled = visibleIds.length === 0;
    }
    if (bulkDeleteBtn) bulkDeleteBtn.disabled = !selectedLandingPageIds.size;
  }

  function renderLandingPagesTable() {
    const tbody = byId('developLandingPagesTableBody');
    if (!tbody) return;
    tbody.textContent = '';

    const sortButtons = [
      ['developLandingPagesSortNameBtn', 'name', 'Name'],
      ['developLandingPagesSortTemplateBtn', 'templateId', 'Template'],
      ['developLandingPagesSortHeadlineBtn', 'headlineId', 'Headline'],
      ['developLandingPagesSortFormBtn', 'formId', 'Form'],
      ['developLandingPagesSortUpdatedBtn', 'updatedAt', 'Updated'],
    ];
    sortButtons.forEach(([id, key, label]) => {
      const button = byId(id);
      if (!button) return;
      const marker = landingPageTableState.sort.key === key
        ? (landingPageTableState.sort.dir === 'asc' ? ' ▲' : ' ▼')
        : '';
      button.textContent = `${label}${marker}`;
    });

    const templateFilter = byId('developLandingPagesTemplateFilter');
    if (templateFilter) {
      const current = safeText(landingPageTableState.filters.templateId);
      setSelectOptions(
        templateFilter,
        LANDING_TEMPLATES.map((template) => ({ value: template.id, label: template.name })),
        'All Templates',
        current
      );
    }

    const rows = getFilteredSortedLandingPages();
    if (!rows.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.textContent = 'No pages yet.';
      row.appendChild(cell);
      tbody.appendChild(row);
      syncLandingPageTableControls();
      return;
    }

    rows.forEach((item) => {
      const row = document.createElement('tr');
      const id = safeText(item.id);

      const selectTd = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedLandingPageIds.has(id);
      checkbox.setAttribute('aria-label', `Select page ${safeText(item.name) || id}`);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedLandingPageIds.add(id);
        else selectedLandingPageIds.delete(id);
        syncLandingPageTableControls();
      });
      selectTd.appendChild(checkbox);
      row.appendChild(selectTd);

      const append = (text) => {
        const td = document.createElement('td');
        td.textContent = text || '-';
        row.appendChild(td);
      };

      append(safeText(item.name) || '-');
      append(getLandingPageTemplateName(item.templateId) || '-');
      append(getLandingPageHeadlineLabel(item.headlineId) || '-');
      append(getSavedFormName(item.formId) || '-');
      append(item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '-');

      const actionsTd = document.createElement('td');
      actionsTd.className = 'develop-pages-actions-cell';
      const viewBtn = App.makeIconButton('view', 'View Page', () => {
        openLandingPagePreview(item);
      });
      const editBtn = App.makeIconButton('edit', 'Edit Page', () => {
        const layoutSections = resolveModularLayoutSectionsForEditor(item);
        if (normalizePageTemplateKind(item.templateKind) === 'modular' && layoutSections.length) {
          openModularPageTemplateEditor({
            ...item,
            layoutSections,
          }, {
            mode: 'page',
            sourceTemplateId: safeText(item.templateId),
            targetPage: 'developLandingPagesPage',
          });
        } else {
          openLandingPageVisualEditor(item);
        }
      }, { marginLeft: '10px' });
      const deleteBtn = App.makeIconButton('delete', 'Delete Page', async () => {
        if (!window.confirm(`Delete page "${safeText(item.name) || id}"?`)) return;
        try {
          await api(`/api/develop/landing-pages/${encodeURIComponent(id)}`, { method: 'DELETE' });
          selectedLandingPageIds.delete(id);
          await refresh();
          notify('Landing page deleted');
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '10px' });
      actionsTd.appendChild(viewBtn);
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(deleteBtn);
      row.appendChild(actionsTd);
      tbody.appendChild(row);
    });

    syncLandingPageTableControls();
  }

  function syncFormBuilderInputs() {
    const current = ensureFormBuilderState(byId('developFormTypeSelect')?.value || FORM_TEMPLATES[0].id);
    const idInput = byId('developFormIdInput');
    const nameInput = byId('developFormNameInput');
    const typeSelect = byId('developFormTypeSelect');
    const contactTypeSelect = byId('developFormContactTypeSelect');
    const leadMagnetTypeSelect = byId('developFormLeadMagnetTypeSelect');
    const leadMagnetSelect = byId('developFormLeadMagnetSelect');
    const ctaSelect = byId('developFormCtaSelect');
    const headingInput = byId('developFormHeadingInput');
    const successMessageInput = byId('developFormSuccessMessageInput');
    const errorMessageInput = byId('developFormErrorMessageInput');
    const accentInput = byId('developFormAccentColorInput');
    const matchInput = byId('developFormMatchLandingColorInput');
    const landingColorModeWrap = byId('developFormLandingColorModeWrap');
    const landingColorModeSelect = byId('developFormLandingColorModeSelect');
    const useLandingBackgroundWrap = byId('developFormUseLandingBackgroundWrap');
    const useLandingBackgroundInput = byId('developFormUseLandingBackgroundInput');

    if (idInput) idInput.value = current.id || '';
    if (nameInput) nameInput.value = current.name || '';
    if (typeSelect) typeSelect.value = current.formType;
    if (contactTypeSelect) contactTypeSelect.value = current.contactType || 'lead';
    if (leadMagnetTypeSelect) {
      setSelectOptions(
        leadMagnetTypeSelect,
        getFormLeadMagnetTypeOptions(current.leadMagnetType),
        'Lead Magnet Type',
        current.leadMagnetType || ''
      );
    }
    if (leadMagnetSelect) {
      const selectedType = safeText(current.leadMagnetType);
      const options = (Array.isArray(state.assets) ? state.assets : []).filter((asset) =>
        assetMatchesFormLeadMagnetType(asset, selectedType)
      );
      setSelectOptions(
        leadMagnetSelect,
        options.map((asset) => ({ value: String(asset.id), label: assetLabel(asset, String(asset.id)) })),
        'Lead Magnet (Optional)',
        current.leadMagnetId || ''
      );
      if (current.leadMagnetId && !options.some((asset) => safeText(asset.id) === safeText(current.leadMagnetId))) {
        current.leadMagnetId = '';
        leadMagnetSelect.value = '';
      }
    }
    if (ctaSelect) {
      setSelectOptions(
        ctaSelect,
        landingPageCtas.map((row) => ({ value: String(row.id), label: safeText(row.cta) || `CTA ${row.id}` })),
        landingPageCtas.length ? 'Call To Action' : 'Call To Action (optional)',
        current.ctaId || ''
      );
    }
    if (headingInput) headingInput.value = current.heading;
    if (successMessageInput) successMessageInput.value = current.successMessage || '';
    if (errorMessageInput) errorMessageInput.value = current.errorMessage || '';
    if (accentInput) accentInput.value = current.accentColor || DEFAULT_FORM_ACCENT;
    if (accentInput) accentInput.disabled = Boolean(current.matchLandingColor);
    if (matchInput) matchInput.checked = Boolean(current.matchLandingColor);
    if (landingColorModeSelect) landingColorModeSelect.value = current.landingColorMode || 'primary';
    if (useLandingBackgroundInput) useLandingBackgroundInput.checked = Boolean(current.useLandingBackground);
    if (landingColorModeWrap) landingColorModeWrap.classList.toggle('hidden', !current.matchLandingColor);
    if (useLandingBackgroundWrap) useLandingBackgroundWrap.classList.toggle('hidden', !current.matchLandingColor);
  }

  function renderTemplatePreview(templateId) {
    const host = byId('developTemplatesPreviewHost');
    if (!host) return;
    const template = getTemplateById(templateId);
    selectedTemplateId = template.id;

    const parser = new DOMParser();
    const doc = parser.parseFromString(buildTemplatePreviewMarkup(template), 'text/html');
    host.textContent = '';
    Array.from(doc.body.childNodes).forEach(n => host.appendChild(n.cloneNode(true)));
  }

  function openCreateFormEditor() {
    var initialTemplateId = arguments.length ? arguments[0] : FORM_TEMPLATES[0].id;
    formBuilderState = buildDefaultFormState(initialTemplateId);
    const editorTitle = byId('developFormsEditorTitle');
    if (editorTitle) editorTitle.textContent = 'Create Form';
    byId('developFormEditorPanel')?.classList.remove('hidden');
    syncFormBuilderInputs();
    renderFormBuilderFieldConfig();
    renderFormBuilderPreview();
  }

  function closeFormEditor() {
    byId('developFormEditorPanel')?.classList.add('hidden');
    const editorTitle = byId('developFormsEditorTitle');
    if (editorTitle) editorTitle.textContent = 'Create Form';
  }

  function buildFormTemplatePreviewMarkup(template) {
    const fields = Array.isArray(template?.fields) ? template.fields : [];
    const fieldMarkup = fields.map((field) => `<input type="${safeText(field.type) || 'text'}" placeholder="${safeText(field.label) || 'Field'}${field.required ? ' *' : ''}" />`).join('');
    return `
      <div class="develop-form-preview">
        <h3>${safeText(template?.defaultHeading) || 'Form Template'}</h3>
        ${fieldMarkup}
        <button type="button">${safeText(template?.defaultSubmitLabel) || 'Submit'}</button>
      </div>
    `;
  }

  function renderFormTemplatePreview(templateId) {
    const host = byId('developFormTemplatesPreviewHost');
    if (!host) return;
    const template = getFormTemplateById(templateId);
    selectedFormTemplateId = template.id;
    const fParser = new DOMParser();
    const fDoc = fParser.parseFromString(buildFormTemplatePreviewMarkup(template), 'text/html');
    host.textContent = '';
    Array.from(fDoc.body.childNodes).forEach(n => host.appendChild(n.cloneNode(true)));
  }

  function buildEmailTemplatePreviewMarkup(template, options = {}) {
    const sampleContent = options && options.sampleContent === true;
    const loremParagraph = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';
    const loremHeading = 'Lorem Ipsum Headline';
    const loremEyebrow = 'Sample Email';
    const loremButton = 'Call To Action';
    const subject = safeText(template?.subject) || 'Sample subject line';
    const blocks = normalizeEmailTemplateBlocks(template);
    const blockMarkup = blocks.map((block) => {
      const blockText = safeText(block.text);
      const displayText = sampleContent ? (blockText || (block.type === 'heading'
        ? loremHeading
        : block.type === 'eyebrow'
          ? loremEyebrow
          : block.type === 'button'
            ? loremButton
            : loremParagraph)) : blockText;
      if (block.type === 'eyebrow') {
        return `<div class="develop-template-eyebrow">${displayText || 'Email Template'}</div>`;
      }
      if (block.type === 'heading') {
        return `<h3>${displayText || 'Heading'}</h3>`;
      }
      if (block.type === 'paragraph') {
        return `<p>${displayText || ''}</p>`;
      }
      if (block.type === 'button') {
        return `<button type="button">${displayText || 'Open'}</button>`;
      }
      if (block.type === 'image') {
        const src = resolveEmailTemplateImageSource(block);
        if (!src) {
          return sampleContent
            ? '<div class="develop-email-template-image-placeholder">Image Placeholder</div>'
            : '';
        }
        const alt = safeText(block.alt) || 'Email image';
        return `<div class="develop-email-template-image-wrap"><img src="${src}" alt="${alt}" class="develop-email-template-image" /></div>`;
      }
      if (block.type === 'divider') {
        return '<hr style="margin:0.8rem 0;border:none;border-top:1px solid rgba(15,79,143,0.2);" />';
      }
      if (block.type === 'spacer') {
        return '<div style="height:1rem;"></div>';
      }
      return '';
    }).join('');
    return `
      <div class="develop-email-template-preview">
        <div class="develop-email-template-preview-meta"><strong>Subject:</strong> ${subject}</div>
        ${blockMarkup}
      </div>
    `;
  }

  function openEmailTemplatePreviewModal(template) {
    if (!template || !App.components || typeof App.components.Modal !== 'function') return;
    const body = document.createElement('div');
    const eParser = new DOMParser();
    const eDoc = eParser.parseFromString(buildEmailTemplatePreviewMarkup(template, { sampleContent: true }), 'text/html');
    body.textContent = '';
    Array.from(eDoc.body.childNodes).forEach(n => body.appendChild(n.cloneNode(true)));
    const modal = App.components.Modal({
      title: `${safeText(template.name) || 'Email Template'} Preview`,
      body,
      actions: [
        {
          label: 'Close',
          onClick: () => modal.close(),
        },
      ],
      dialogClass: 'develop-email-template-modal',
      bodyClass: 'develop-email-template-modal-body',
    });
    modal.open();
  }

  function normalizeEmailTemplateBlocks(template) {
    const raw = Array.isArray(template?.blocks) ? template.blocks : [];
    const normalized = raw
      .map((block, index) => ({
        id: safeText(block?.id) || `block_${index + 1}`,
        type: safeText(block?.type).toLowerCase() || 'paragraph',
        text: safeText(block?.text),
        url: safeText(block?.url),
        sourceMode: safeText(block?.sourceMode).toLowerCase() || (safeText(block?.assetId) ? 'gallery' : (safeText(block?.url) ? 'url' : 'gallery')),
        assetId: safeText(block?.assetId),
        alt: safeText(block?.alt),
      }))
      .filter((block) => block.type);
    if (normalized.length) return normalized;
    const fallback = [];
    if (safeText(template?.heading)) fallback.push({ id: 'heading_1', type: 'heading', text: safeText(template.heading), url: '' });
    if (safeText(template?.body)) fallback.push({ id: 'paragraph_1', type: 'paragraph', text: safeText(template.body), url: '' });
    if (safeText(template?.cta)) fallback.push({ id: 'button_1', type: 'button', text: safeText(template.cta), url: '' });
    return fallback.length ? fallback : [{ id: 'paragraph_1', type: 'paragraph', text: '', url: '' }];
  }

  function createEmailTemplateBlock(type = 'paragraph') {
    return {
      id: `block_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      text: '',
      url: '',
      sourceMode: 'gallery',
      assetId: '',
      alt: '',
    };
  }

  function getImageAssets() {
    return (Array.isArray(state.assets) ? state.assets : []).filter((asset) => safeText(asset?.assetType) === 'Image');
  }

  function resolveEmailTemplateImageSource(block) {
    if (!block || block.type !== 'image') return '';
    if (safeText(block.sourceMode) === 'url') {
      return safeText(block.url);
    }
    const assetId = safeText(block.assetId);
    if (!assetId) return '';
    const asset = getImageAssets().find((item) => safeText(item.id) === assetId);
    if (!asset) return '';
    return toDirectAssetUrl(asset.location);
  }

  async function uploadEmailTemplateBlockImage(file, block) {
    if (!file || !block) return;
    if (!String(file.type || '').startsWith('image/')) {
      throw new Error('Please choose an image file');
    }
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    const payload = {
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      fileBase64: btoa(binary),
      fileSize: Number(file.size || 0),
      assetType: 'Image',
      assetName: file.name,
      category: 'Email Template',
      tags: ['email-template', 'builder'],
    };
    const result = await api('/api/assets/upload-google-drive', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const asset = result?.asset || result?.data?.asset || null;
    if (!asset?.id) throw new Error('Image upload did not return an asset');
    block.sourceMode = 'gallery';
    block.assetId = safeText(asset.id);
    block.url = '';
    if (!safeText(block.alt)) {
      block.alt = file.name.replace(/\.[^.]+$/, '');
    }
    await loadLandingPageBuilderOptions().catch(() => {});
  }

  function renderEmailTemplatePreview(templateId) {
    const host = byId('developEmailTemplatesPreviewHost');
    if (!host) return;
    const textTemplates = getEmailTemplatesByKind('text');
    const template = textTemplates.find((item) => safeText(item.id) === safeText(templateId)) || textTemplates[0];
    selectedEmailTemplateId = safeText(template?.id);
    const e2Parser = new DOMParser();
    const markup = template ? buildEmailTemplatePreviewMarkup(template) : '';
    const e2Doc = e2Parser.parseFromString(markup, 'text/html');
    host.textContent = '';
    Array.from(e2Doc.body.childNodes).forEach(n => host.appendChild(n.cloneNode(true)));
  }

  function openCampaignBuilderWithEmailTemplate(templateId) {
    const nextTemplateId = safeText(templateId) || safeText(savedEmailTemplates[0]?.id);
    App.setActivePage('campaignCreatePage');
    setTimeout(() => {
      const select = byId('campaignEmailTemplateSelect');
      if (select) select.value = nextTemplateId;
    }, 120);
  }

  function openModularEmailTemplateEditor(template) {
    if (!template) return;
    if (App.builder && typeof App.builder.useReactIsland === 'function' && App.builder.useReactIsland()) {
      App.setActivePage('developTemplatesPage');
      const mounted = App.builder.mount({
        surface: 'editor',
        editorMode: 'template',
        menuMode: 'templates',
        record: {
          ...template,
          templateKind: 'email',
          emailSlug: safeText(template.slug || template.emailSlug),
          pageBackground: template.pageBackground || null,
          layoutSections: template.layoutSections || [],
        },
        onClose: () => {
          setEmailTemplateEditorVisible(false);
        },
        onSaved: async () => {
          await refresh();
        },
      });
      if (mounted) {
        setEmailTemplateEditorVisible(false);
        return;
      }
    }
    const builderIdInput = byId('developTemplateEditorIdInput');
    const builderNameInput = byId('developTemplateEditorNameInput');
    const builderSlugInput = byId('developTemplateEditorSlugInput');
    const builderSummaryInput = byId('developTemplateEditorSummaryInput');
    const builderSubjectInput = byId('developTemplateEditorSubjectInput');
    const builderCtaInput = byId('developTemplateEditorCtaInput');
    if (builderIdInput) builderIdInput.value = safeText(template.id);
    if (builderNameInput) builderNameInput.value = safeText(template.name);
    if (builderSlugInput) builderSlugInput.value = safeText(template.slug);
    if (builderSummaryInput) builderSummaryInput.value = safeText(template.summary);
    if (builderSubjectInput) builderSubjectInput.value = safeText(template.subject);
    if (builderCtaInput) builderCtaInput.value = safeText(template.cta);
    emailTemplateBlocksDraft = normalizeEmailTemplateBlocks(template);
    renderEmailTemplateBlockEditor();
    const builderSubmitBtnTop = byId('developTemplateEditorSaveBtnTop');
    const builderSubmitBtnBottom = byId('developTemplateEditorSaveBtnBottom');
    const label = template?.id ? 'Update Template' : 'Save Template';
    if (builderSubmitBtnTop) builderSubmitBtnTop.textContent = label;
    if (builderSubmitBtnBottom) builderSubmitBtnBottom.textContent = label;
    setEmailTemplateEditorVisible(true);
    const panel = byId('developTemplateEditorPanel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderTemplateRecordsTable(hostId, title, headers, rows) {
    const host = byId(hostId);
    if (!host) return;
    host.textContent = '';
    const card = document.createElement('div');
    card.className = 'develop-template-records-card';
    const heading = document.createElement('h4');
    heading.textContent = title;
    card.appendChild(heading);
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'develop-template-records-empty';
      empty.textContent = 'No records yet.';
      card.appendChild(empty);
      host.appendChild(card);
      return;
    }
    const table = document.createElement('table');
    table.className = 'develop-template-records-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headers.forEach((header) => {
      const th = document.createElement('th');
      th.textContent = header;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    rows.forEach((cells) => {
      const tr = document.createElement('tr');
      cells.forEach((cell) => {
        const td = document.createElement('td');
        if (cell && typeof cell === 'object' && cell.nodeType) {
          td.appendChild(cell);
        } else {
          td.textContent = safeText(cell) || '-';
        }
        if (td.childNodes.length && td.firstChild && td.firstChild.nodeType === 1 && td.firstChild.classList?.contains('page-heading-actions')) {
          td.classList.add('actions-cell');
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    card.appendChild(table);
    host.appendChild(card);
  }

  function buildEmailTemplateActions(template) {
    const wrap = document.createElement('div');
    wrap.className = 'page-heading-actions';
    wrap.style.justifyContent = 'flex-start';
    const previewBtn = App.makeIconButton('preview', 'Preview Template', () => {
      openEmailTemplatePreviewModal(template);
    });
    const editBtn = App.makeIconButton('edit', 'Edit Template', () => {
      const kind = safeText(template.templateKind).toLowerCase() || 'text';
      if (kind === 'modular' || kind === 'email') {
        openModularEmailTemplateEditor({ ...template, templateKind: kind === 'email' ? 'email' : 'modular' });
      } else {
        populateEmailTemplateForm(template);
      }
    }, { marginLeft: '8px' });
    const deleteBtn = App.makeIconButton('delete', 'Delete Template', async () => {
      const confirmed = window.confirm(`Delete email template "${safeText(template.name) || 'Untitled'}"?`);
      if (!confirmed) return;
      try {
        await api(`/api/develop/email-templates/${encodeURIComponent(template.id)}`, { method: 'DELETE' });
        if (String(selectedEmailTemplateId) === String(template.id)) {
          selectedEmailTemplateId = '';
        }
        await refresh();
        notify('Email template deleted');
      } catch (err) {
        notify(err.message || 'Could not delete email template', true);
      }
    }, { danger: true, marginLeft: '8px' });
    wrap.appendChild(previewBtn);
    wrap.appendChild(editBtn);
    wrap.appendChild(deleteBtn);
    return wrap;
  }

  function renderEmailTemplateTables() {
    const host = byId('developEmailTemplatesPrimaryTableHost');
    if (host) host.textContent = '';
  }

  function renderFormTemplateRecordsTable() {
    const host = byId('developFormTemplatesTableHost');
    if (host?.closest('.hidden')) {
      host.textContent = '';
      return;
    }
    const rows = savedForms.map((form) => {
      const actions = document.createElement('div');
      actions.className = 'page-heading-actions';
      actions.style.justifyContent = 'flex-start';
      const editBtn = App.makeIconButton('edit', 'Edit Form', () => {
        App.setActivePage('developFormsPage');
        setTimeout(() => applySavedFormToBuilder(form), 60);
      });
      const cloneBtn = App.makeIconButton('clone', 'Clone Form', async () => {
        try {
          const payload = {
            name: safeText(form.name),
            formType: safeText(form.formType),
            contactType: safeText(form.contactType),
            leadMagnetType: safeText(form.leadMagnetType),
            leadMagnetId: safeText(form.leadMagnetId),
            ctaId: safeText(form.ctaId),
            heading: safeText(form.heading),
            submitLabel: safeText(form.submitLabel),
            successMessage: safeText(form.successMessage),
            errorMessage: safeText(form.errorMessage),
            accentColor: safeText(form.accentColor),
            matchLandingColor: Boolean(form.matchLandingColor),
            landingColorMode: safeText(form.landingColorMode),
            useLandingBackground: Boolean(form.useLandingBackground),
            fields: Array.isArray(form.fields)
              ? form.fields.map((field) => ({
                  key: safeText(field?.key),
                  label: safeText(field?.label),
                  type: safeText(field?.type),
                  required: Boolean(field?.required),
                }))
              : [],
          };
          await api('/api/develop/forms', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          await refresh();
          notify('Form cloned');
        } catch (err) {
          notify(err.message, true);
        }
      }, { marginLeft: '8px' });
      const deleteBtn = App.makeIconButton('delete', 'Delete Form', async () => {
        if (!window.confirm(`Delete form "${safeText(form.name) || form.id}"?`)) return;
        try {
          await api(`/api/develop/forms/${encodeURIComponent(form.id)}`, { method: 'DELETE' });
          await refresh();
          notify('Form deleted');
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actions.appendChild(editBtn);
      actions.appendChild(cloneBtn);
      actions.appendChild(deleteBtn);
      return [
        safeText(form.name) || '-',
        getFormTemplateById(form.formType).name,
        form.updatedAt ? new Date(form.updatedAt).toLocaleString() : '-',
        actions,
      ];
    });
    renderTemplateRecordsTable(
      'developFormTemplatesTableHost',
      'Saved Forms',
      ['Name', 'Type', 'Updated', 'Actions'],
      rows
    );
  }

  function createPageTemplateActions(page) {
    const actions = document.createElement('div');
    actions.className = 'page-heading-actions';
    actions.style.justifyContent = 'flex-start';
    actions.appendChild(App.makeIconButton('view', 'View Template', async () => {
      if (normalizePageTemplateKind(page.templateKind) === 'modular') {
        await ensureAssetsLoaded().catch(() => {});
        openModularPageTemplatePreviewModal(page);
      } else {
        openLandingPagePreview(page, { mode: 'template' });
      }
    }));
    actions.appendChild(App.makeIconButton('edit', 'Edit Template', () => {
      if (normalizePageTemplateKind(page.templateKind) === 'modular') {
        openModularPageTemplateEditor(page);
      } else {
        openLandingPageVisualEditor(page, { mode: 'template' });
      }
    }, { marginLeft: '8px' }));
    actions.appendChild(App.makeIconButton('clone', 'Clone Template', async () => {
      try {
        const payload = {
          name: safeText(page.name),
          templateKind: normalizePageTemplateKind(page.templateKind),
          templateId: safeText(page.templateId),
          primaryColor: safeText(page.primaryColor),
          backgroundColor: safeText(page.backgroundColor),
          accentColor: safeText(page.accentColor),
          formId: safeText(page.formId),
          leadMagnetId: safeText(page.leadMagnetId),
          headlineId: safeText(page.headlineId),
          pitchId: safeText(page.pitchId),
          ctaId: safeText(page.ctaId),
          websiteBannerImageId: safeText(page.websiteBannerImageId),
          backgroundImageId: safeText(page.backgroundImageId),
          featureImageId: safeText(page.featureImageId),
          highlightImageId: safeText(page.highlightImageId),
          featureHeadlineId: safeText(page.featureHeadlineId),
          featureSubheadingId: safeText(page.featureSubheadingId),
          featureTitle: safeText(page.featureTitle),
          featureCopy: safeText(page.featureCopy),
          highlightHeadlineId: safeText(page.highlightHeadlineId),
          highlightPitchId: safeText(page.highlightPitchId),
          highlightTitle: safeText(page.highlightTitle),
          highlightCopy: safeText(page.highlightCopy),
          bodyHeadlineId: safeText(page.bodyHeadlineId),
          bodySubheadingId: safeText(page.bodySubheadingId),
          bodyPitchId: safeText(page.bodyPitchId),
          logoWideId: safeText(page.logoWideId),
          logoSquareId: safeText(page.logoSquareId),
          layoutSections: Array.isArray(page.layoutSections) ? JSON.parse(JSON.stringify(page.layoutSections)) : [],
          contentOverrides: page && typeof page.contentOverrides === 'object'
            ? JSON.parse(JSON.stringify(page.contentOverrides))
            : {},
        };
        await api('/api/develop/page-templates', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        await refresh();
        notify('Page template cloned');
      } catch (err) {
        notify(err.message, true);
      }
    }, { marginLeft: '8px' }));
    actions.appendChild(App.makeIconButton('delete', 'Delete Template', async () => {
      const id = safeText(page.id);
      if (!window.confirm(`Delete template "${safeText(page.name) || id}"?`)) return;
      try {
        await api(`/api/develop/page-templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await refresh();
        notify('Page template deleted');
      } catch (err) {
        notify(err.message, true);
      }
    }, { danger: true, marginLeft: '8px' }));
    return actions;
  }

  function renderPageTemplateRecordsTableHost(hostId) {
    const host = byId(hostId);
    if (!host) return;
    host.textContent = '';
    const card = document.createElement('div');
    card.className = 'develop-template-records-card';
    const heading = document.createElement('h4');
    heading.textContent = 'Saved Page Templates';
    card.appendChild(heading);

    if (!savedPageTemplates.length) {
      const empty = document.createElement('div');
      empty.className = 'develop-template-records-empty';
      empty.textContent = 'No page templates yet.';
      card.appendChild(empty);
      host.appendChild(card);
      return;
    }

    const table = document.createElement('table');
    table.className = 'develop-template-records-table';
    const tbParser = new DOMParser();
    const tbDoc = tbParser.parseFromString(`
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Kind</th>
            <th>Template</th>
            <th>Updated</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    `, 'text/html');
    table.textContent = '';
    const newTable = tbDoc.querySelector('table');
    if (newTable) {
      Array.from(newTable.childNodes).forEach(n => table.appendChild(n.cloneNode(true)));
    }
    const tbody = table.querySelector('tbody');
    savedPageTemplates.forEach((page) => {
      const tr = document.createElement('tr');
      const td1 = document.createElement('td');
      td1.textContent = safeText(page.name) || '-';
      const td2 = document.createElement('td');
      td2.textContent = getPageTemplateKindLabel(page.templateKind);
      const td3 = document.createElement('td');
      td3.textContent = getLandingPageTemplateName(page.templateId) || '-';
      const td4 = document.createElement('td');
      td4.textContent = page.updatedAt ? new Date(page.updatedAt).toLocaleString() : '-';
      const td5 = document.createElement('td');
      td5.className = 'actions-cell';
      tr.appendChild(td1);
      tr.appendChild(td2);
      tr.appendChild(td3);
      tr.appendChild(td4);
      tr.appendChild(td5);
      const actionsCell = tr.querySelector('.actions-cell');
      if (actionsCell) actionsCell.appendChild(createPageTemplateActions(page));
      tbody.appendChild(tr);
    });
    card.appendChild(table);
    host.appendChild(card);
  }

  function renderPageTemplateRecordsTable() {
    renderPageTemplateRecordsTableHost('developEmailTemplatesPrimaryTableHost');
    renderPageTemplateRecordsTableHost('developPageTemplatesTableHost');
  }

  function renderEmailTemplateLibrary() {
    const host = byId('developEmailTemplatesLibrary');
    if (!host) return;
    host.textContent = '';
    const textTemplates = getEmailTemplatesByKind('text');
    if (!textTemplates.length) {
      const meta = document.createElement('p');
      meta.className = 'meta';
      meta.textContent = 'No email templates yet. Create one above to start building your library.';
      host.appendChild(meta);
      return;
    }
    textTemplates.forEach((template) => {
      const card = document.createElement('article');
      card.className = `develop-template-library-card${String(template.id) === String(selectedEmailTemplateId) ? ' is-selected' : ''}`;
      const copyWrap = document.createElement('div');
      copyWrap.className = 'develop-template-library-copy';
      const mediaWrap = document.createElement('div');
      mediaWrap.className = 'develop-template-library-media';
      const mParser = new DOMParser();
      const mDoc = mParser.parseFromString(`
        <div class="develop-template-preview-frame" aria-hidden="true">
          <div class="develop-template-preview-scale">
            ${buildEmailTemplatePreviewMarkup(template)}
          </div>
        </div>
      `, 'text/html');
      mediaWrap.textContent = '';
      Array.from(mDoc.body.childNodes).forEach(n => mediaWrap.appendChild(n.cloneNode(true)));
      const title = document.createElement('h3');
      title.textContent = template.name;
      const summary = document.createElement('p');
      summary.textContent = template.summary;
      const actionRow = document.createElement('div');
      actionRow.className = 'page-heading-actions';
      actionRow.style.justifyContent = 'flex-start';
      const previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.textContent = String(template.id) === String(selectedEmailTemplateId) ? 'Selected' : 'Preview';
      previewBtn.addEventListener('click', () => {
        selectedEmailTemplateId = String(template.id);
        renderEmailTemplateLibrary();
        renderEmailTemplatePreview(template.id);
      });
      const launchBtn = document.createElement('button');
      launchBtn.type = 'button';
      launchBtn.textContent = 'Use In Campaign';
      launchBtn.addEventListener('click', () => {
        selectedEmailTemplateId = String(template.id);
        renderEmailTemplateLibrary();
        renderEmailTemplatePreview(template.id);
        openCampaignBuilderWithEmailTemplate(template.id);
      });
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => {
        populateEmailTemplateForm(template);
      });
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', async () => {
        const confirmed = window.confirm(`Delete email template "${safeText(template.name) || 'Untitled'}"?`);
        if (!confirmed) return;
        try {
          await api(`/api/develop/email-templates/${encodeURIComponent(template.id)}`, { method: 'DELETE' });
          if (String(selectedEmailTemplateId) === String(template.id)) {
            selectedEmailTemplateId = '';
          }
          await refresh();
          notify('Email template deleted');
        } catch (err) {
          notify(err.message || 'Could not delete email template', true);
        }
      });
      actionRow.appendChild(previewBtn);
      actionRow.appendChild(launchBtn);
      actionRow.appendChild(editBtn);
      actionRow.appendChild(deleteBtn);
      copyWrap.appendChild(title);
      copyWrap.appendChild(summary);
      copyWrap.appendChild(actionRow);
      card.appendChild(copyWrap);
      card.appendChild(mediaWrap);
      host.appendChild(card);
    });
  }

  function populateEmailTemplateForm(template) {
    const form = byId('developEmailTemplateForm');
    if (!form) return;
    setCollapsibleSectionExpanded('developEmailSectionToggle', 'developEmailSectionBody', true);
    const builderIdInput = byId('developTemplateEditorIdInput');
    const builderNameInput = byId('developTemplateEditorNameInput');
    const builderSlugInput = byId('developTemplateEditorSlugInput');
    const builderSummaryInput = byId('developTemplateEditorSummaryInput');
    const builderSubjectInput = byId('developTemplateEditorSubjectInput');
    const builderCtaInput = byId('developTemplateEditorCtaInput');
    if (builderIdInput) builderIdInput.value = '';
    if (builderNameInput) builderNameInput.value = '';
    if (builderSlugInput) builderSlugInput.value = '';
    if (builderSummaryInput) builderSummaryInput.value = '';
    if (builderSubjectInput) builderSubjectInput.value = '';
    if (builderCtaInput) builderCtaInput.value = '';
    byId('developEmailTemplateIdInput').value = safeText(template?.id);
    byId('developEmailTemplateNameInput').value = safeText(template?.name);
    byId('developEmailTemplateSlugInput').value = safeText(template?.slug);
    byId('developEmailTemplateSummaryInput').value = safeText(template?.summary);
    byId('developEmailTemplateSubjectInput').value = safeText(template?.subject);
    byId('developEmailTemplateHeadingInput').value = safeText(template?.heading);
    byId('developEmailTemplateBodyInput').value = safeText(template?.body);
    byId('developEmailTemplateCtaInput').value = safeText(template?.cta);
    const submitBtn = byId('developEmailTemplateSubmitBtn');
    const submitBtnTop = byId('developEmailTemplateSubmitBtnTop');
    const label = template?.id ? 'Update Template' : 'Save Template';
    if (submitBtn) submitBtn.textContent = label;
    if (submitBtnTop) submitBtnTop.textContent = label;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetEmailTemplateForm(options = {}) {
    const renderBuilder = options.renderBuilder !== false;
    const form = byId('developEmailTemplateForm');
    if (form) form.reset();
    byId('developEmailTemplateIdInput').value = '';
    const builderIdInput = byId('developTemplateEditorIdInput');
    if (builderIdInput) builderIdInput.value = '';
    const builderNameInput = byId('developTemplateEditorNameInput');
    if (builderNameInput) builderNameInput.value = '';
    const builderSlugInput = byId('developTemplateEditorSlugInput');
    const builderSummaryInput = byId('developTemplateEditorSummaryInput');
    const builderSubjectInput = byId('developTemplateEditorSubjectInput');
    const builderCtaInput = byId('developTemplateEditorCtaInput');
    if (builderSlugInput) builderSlugInput.value = '';
    if (builderSummaryInput) builderSummaryInput.value = '';
    if (builderSubjectInput) builderSubjectInput.value = '';
    if (builderCtaInput) builderCtaInput.value = '';
    emailTemplateBlocksDraft = [
      createEmailTemplateBlock('heading'),
      createEmailTemplateBlock('paragraph'),
      createEmailTemplateBlock('button'),
    ];
    if (renderBuilder) renderEmailTemplateBlockEditor();
    const submitBtn = byId('developEmailTemplateSubmitBtn');
    const submitBtnTop = byId('developEmailTemplateSubmitBtnTop');
    const builderSubmitBtnTop = byId('developTemplateEditorSaveBtnTop');
    const builderSubmitBtnBottom = byId('developTemplateEditorSaveBtnBottom');
    if (submitBtn) submitBtn.textContent = 'Save Template';
    if (submitBtnTop) submitBtnTop.textContent = 'Save Template';
    if (builderSubmitBtnTop) builderSubmitBtnTop.textContent = 'Save Template';
    if (builderSubmitBtnBottom) builderSubmitBtnBottom.textContent = 'Save Template';
  }

  function setEmailTemplateEditorVisible(visible) {
    const panel = byId('developTemplateEditorPanel');
    if (!panel) return;
    panel.classList.toggle('hidden', !visible);
    if (visible) {
      setCollapsibleSectionExpanded('developTemplateEditorToggle', 'developTemplateEditorBody', true);
    }
  }

  function setPageTemplateEditorVisible(visible) {
    const panel = byId('developPageTemplateEditorPanel');
    if (!panel) return;
    panel.classList.toggle('hidden', !visible);
    if (visible) {
      setCollapsibleSectionExpanded('developPageTemplateEditorToggle', 'developPageTemplateEditorBody', true);
    }
  }

  function syncModularPageEditorPlacement() {
    const panel = byId('developPageTemplateEditorPanel');
    const pagesHost = byId('developLandingPagesModularHost');
    const templatesHost = byId('developTemplatesModularHost');
    const landingForm = els.developLandingPagesForm || byId('developLandingPagesForm');
    if (!panel || !pagesHost || !templatesHost) return;
    if (modularPageEditorMode === 'page') {
      pagesHost.appendChild(panel);
      panel.classList.add('develop-template-editor--page-mode');
      if (landingForm) landingForm.classList.add('hidden');
    } else {
      templatesHost.appendChild(panel);
      panel.classList.remove('develop-template-editor--page-mode');
      if (landingForm) landingForm.classList.remove('hidden');
    }
  }

  function setCollapsibleSectionExpanded(toggleId, bodyId, expanded) {
    const toggle = byId(toggleId);
    const body = byId(bodyId);
    if (!toggle || !body) return false;
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    body.classList.toggle('hidden', !expanded);
    return true;
  }

  function bindCollapsibleSection(toggleId, bodyId, { defaultExpanded = true } = {}) {
    const toggle = byId(toggleId);
    const body = byId(bodyId);
    if (!toggle || !body) return;
    setCollapsibleSectionExpanded(toggleId, bodyId, defaultExpanded);
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') !== 'false';
      setCollapsibleSectionExpanded(toggleId, bodyId, !expanded);
    });
  }

  function renderEmailTemplateBlockEditor() {
    const title = byId('developTemplateEditorTitle');
    const meta = byId('developTemplateEditorMeta');
    const host = byId('developTemplateEditorModules');
    if (!host) return;
    let draggedIndex = null;
    if (title) title.textContent = 'Email: Modular';
    if (meta) meta.textContent = 'Build the email as ordered blocks. Use move buttons to rearrange sections.';
    host.textContent = '';

    emailTemplateBlocksDraft.forEach((block, index) => {
      const item = document.createElement('div');
      item.className = 'develop-template-module-item';

      const grip = document.createElement('div');
      grip.className = 'develop-template-module-grip';
      grip.textContent = '::';
      grip.draggable = true;
      grip.title = 'Drag to reorder';
      grip.addEventListener('dragstart', (event) => {
        draggedIndex = index;
        item.classList.add('is-dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', String(index));
        }
      });
      grip.addEventListener('dragend', () => {
        draggedIndex = null;
        host.querySelectorAll('.develop-template-module-item').forEach((node) => {
          node.classList.remove('is-drag-over', 'is-dragging');
        });
      });

      item.addEventListener('dragover', (event) => {
        event.preventDefault();
        if (draggedIndex === null || draggedIndex === index) return;
        item.classList.add('is-drag-over');
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      });
      item.addEventListener('dragleave', () => {
        item.classList.remove('is-drag-over');
      });
      item.addEventListener('drop', (event) => {
        event.preventDefault();
        item.classList.remove('is-drag-over');
        if (draggedIndex === null || draggedIndex === index) return;
        const [moved] = emailTemplateBlocksDraft.splice(draggedIndex, 1);
        const insertIndex = draggedIndex < index ? index - 1 : index;
        emailTemplateBlocksDraft.splice(insertIndex, 0, moved);
        renderEmailTemplateBlockEditor();
      });

      const fields = document.createElement('div');
      fields.className = 'develop-template-module-fields';

      const typeSelect = document.createElement('select');
      [
        ['eyebrow', 'Eyebrow'],
        ['heading', 'Heading'],
        ['paragraph', 'Paragraph'],
        ['image', 'Image'],
        ['button', 'Button'],
        ['divider', 'Divider'],
        ['spacer', 'Spacer'],
      ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        typeSelect.appendChild(option);
      });
      typeSelect.value = block.type;
      typeSelect.addEventListener('change', () => {
        block.type = safeText(typeSelect.value) || 'paragraph';
        renderEmailTemplateBlockEditor();
      });

      const textInput = document.createElement(block.type === 'paragraph' ? 'textarea' : 'input');
      textInput.className = 'develop-template-module-span';
      if (block.type === 'paragraph') textInput.rows = 3;
      textInput.placeholder = block.type === 'button' ? 'Button label' : 'Block text';
      textInput.value = safeText(block.text);
      textInput.addEventListener('input', () => {
        block.text = safeText(textInput.value);
      });

      fields.appendChild(typeSelect);

      if (block.type === 'button') {
        const urlInput = document.createElement('input');
        urlInput.placeholder = 'Button URL (optional)';
        urlInput.value = safeText(block.url);
        urlInput.addEventListener('input', () => {
          block.url = safeText(urlInput.value);
        });
        fields.appendChild(urlInput);
      } else if (block.type === 'image') {
        const sourceModeSelect = document.createElement('select');
        [
          ['gallery', 'Choose From Gallery'],
          ['url', 'Use URL'],
        ].forEach(([value, label]) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          sourceModeSelect.appendChild(option);
        });
        sourceModeSelect.value = safeText(block.sourceMode) || 'gallery';
        sourceModeSelect.addEventListener('change', () => {
          block.sourceMode = safeText(sourceModeSelect.value) || 'gallery';
          renderEmailTemplateBlockEditor();
        });
        fields.appendChild(sourceModeSelect);
      } else {
        const filler = document.createElement('div');
        fields.appendChild(filler);
      }

      if (block.type === 'image') {
        const imageControls = document.createElement('div');
        imageControls.className = 'develop-template-module-span';

        const assetSelect = document.createElement('select');
        assetSelect.style.display = block.sourceMode === 'gallery' ? '' : 'none';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = getImageAssets().length ? 'Select Image Asset' : 'No image assets available yet';
        assetSelect.appendChild(placeholder);
        getImageAssets().forEach((asset) => {
          const option = document.createElement('option');
          option.value = safeText(asset.id);
          option.textContent = safeText(asset.assetName) || `Image ${asset.id}`;
          assetSelect.appendChild(option);
        });
        assetSelect.value = safeText(block.assetId);
        assetSelect.addEventListener('change', () => {
          block.assetId = safeText(assetSelect.value);
        });

        const urlInput = document.createElement('input');
        urlInput.placeholder = 'https://...';
        urlInput.style.display = block.sourceMode === 'url' ? '' : 'none';
        urlInput.value = safeText(block.url);
        urlInput.addEventListener('input', () => {
          block.url = safeText(urlInput.value);
        });

        const altInput = document.createElement('input');
        altInput.placeholder = 'Alt text';
        altInput.value = safeText(block.alt);
        altInput.addEventListener('input', () => {
          block.alt = safeText(altInput.value);
        });

        const uploadWrap = document.createElement('div');
        uploadWrap.className = 'page-heading-actions';
        uploadWrap.style.justifyContent = 'flex-start';
        uploadWrap.style.marginTop = '0.45rem';
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        const uploadBtn = document.createElement('button');
        uploadBtn.type = 'button';
        uploadBtn.textContent = 'Upload Image';
        uploadBtn.addEventListener('click', async () => {
          const file = fileInput.files && fileInput.files[0];
          if (!file) {
            notify('Choose an image file first', true);
            return;
          }
          try {
            uploadBtn.disabled = true;
            await uploadEmailTemplateBlockImage(file, block);
            renderEmailTemplateBlockEditor();
            notify('Image uploaded');
          } catch (err) {
            notify(err.message || 'Could not upload image', true);
          } finally {
            uploadBtn.disabled = false;
          }
        });
        uploadWrap.appendChild(fileInput);
        uploadWrap.appendChild(uploadBtn);

        const previewUrl = resolveEmailTemplateImageSource(block);
        const preview = document.createElement('div');
        preview.className = 'develop-template-module-span';
        preview.style.marginTop = '0.4rem';
        preview.textContent = '';
        if (previewUrl) {
          const img = document.createElement('img');
          img.src = previewUrl;
          img.alt = safeText(block.alt) || 'Email image';
          img.style.cssText = 'display:block;max-width:240px;max-height:160px;height:auto;width:auto;border-radius:10px;border:1px solid rgba(15,79,143,0.16);';
          preview.appendChild(img);
        } else {
          const meta = document.createElement('div');
          meta.className = 'meta';
          meta.textContent = 'No image selected yet.';
          preview.appendChild(meta);
        }

        imageControls.appendChild(assetSelect);
        imageControls.appendChild(urlInput);
        imageControls.appendChild(altInput);
        imageControls.appendChild(uploadWrap);
        imageControls.appendChild(preview);
        fields.appendChild(imageControls);
      } else if (!['divider', 'spacer'].includes(block.type)) {
        fields.appendChild(textInput);
      } else {
        const note = document.createElement('div');
        note.className = 'develop-template-module-span meta';
        note.textContent = block.type === 'divider'
          ? 'Divider adds a visual separator line.'
          : 'Spacer adds breathing room between blocks.';
        fields.appendChild(note);
      }

      const actions = document.createElement('div');
      actions.className = 'develop-template-module-actions develop-template-module-span';

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.textContent = 'Move Up';
      upBtn.disabled = index === 0;
      upBtn.addEventListener('click', () => {
        const prior = emailTemplateBlocksDraft[index - 1];
        emailTemplateBlocksDraft[index - 1] = block;
        emailTemplateBlocksDraft[index] = prior;
        renderEmailTemplateBlockEditor();
      });

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.textContent = 'Move Down';
      downBtn.disabled = index === emailTemplateBlocksDraft.length - 1;
      downBtn.addEventListener('click', () => {
        const next = emailTemplateBlocksDraft[index + 1];
        emailTemplateBlocksDraft[index + 1] = block;
        emailTemplateBlocksDraft[index] = next;
        renderEmailTemplateBlockEditor();
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        emailTemplateBlocksDraft.splice(index, 1);
        if (!emailTemplateBlocksDraft.length) {
          emailTemplateBlocksDraft.push(createEmailTemplateBlock('paragraph'));
        }
        renderEmailTemplateBlockEditor();
      });

      actions.appendChild(upBtn);
      actions.appendChild(downBtn);
      actions.appendChild(removeBtn);
      fields.appendChild(actions);

      item.appendChild(grip);
      item.appendChild(fields);
      host.appendChild(item);
    });
  }

  function syncPageTemplateEditorInputs() {
    const idInput = byId('developPageTemplateEditorIdInput');
    const nameInput = byId('developPageTemplateEditorNameInput');
    const baseTemplateSelect = byId('developPageTemplateEditorBaseTemplateSelect');
    const baseTemplateWrap = byId('developPageTemplateEditorBaseTemplateWrap');
    const title = byId('developPageTemplateEditorTitle');
    const meta = byId('developPageTemplateEditorMeta');
    const saveTop = byId('developPageTemplateEditorSaveBtnTop');
    const saveBottom = byId('developPageTemplateEditorSaveBtnBottom');
    const closeTop = byId('developPageTemplateEditorCloseBtnTop');
    const topActions = byId('developPageTemplateEditorTopActions');
    const bottomActions = byId('developPageTemplateEditorBottomActions');
    const pageHeaderPreviewBtn = byId('developLandingPageHeaderPreviewBtn');
    const pageHeaderSaveBtn = byId('developLandingPageHeaderSaveBtn');
    const pageHeaderBackBtn = byId('developLandingPageHeaderBackBtn');
    if (idInput) idInput.value = safeText(modularPageTemplateDraft?.id);
    if (nameInput) nameInput.value = safeText(modularPageTemplateDraft?.name, 255);
    if (baseTemplateSelect) {
      setSelectOptions(
        baseTemplateSelect,
        getUnifiedModularPageTemplateSelectOptions(),
        'Choose Template',
        safeText(modularPageEditorSourceTemplateId) || safeText(modularPageTemplateDraft?.templateId) || selectedTemplateId
      );
      baseTemplateSelect.disabled = modularPageEditorMode !== 'page';
    }
    if (baseTemplateWrap) {
      baseTemplateWrap.classList.toggle('hidden', modularPageEditorMode !== 'page');
    }
    if (title) title.textContent = modularPageEditorMode === 'page' ? 'Page: Modular' : 'Page Template: Modular';
    if (meta) {
      meta.textContent = modularPageEditorMode === 'page'
        ? 'Choose a template, then configure the modules for this page and save it as a page.'
        : 'Build landing-page templates as ordered sections with configurable layouts and module slots.';
    }
    if (saveTop) saveTop.textContent = modularPageEditorMode === 'page' ? 'Save Page' : 'Save Modular Template';
    if (saveBottom) saveBottom.textContent = modularPageEditorMode === 'page' ? 'Save Page' : 'Save Modular Template';
    if (pageHeaderSaveBtn) pageHeaderSaveBtn.textContent = modularPageEditorMode === 'page' ? 'Save Page' : 'Save Template';
    if (closeTop) closeTop.textContent = modularPageEditorMode === 'page' ? 'Back To Pages' : 'Close';
    if (topActions) topActions.classList.toggle('hidden', modularPageEditorMode === 'page');
    if (bottomActions) bottomActions.classList.toggle('hidden', modularPageEditorMode === 'page');
    if (pageHeaderPreviewBtn) pageHeaderPreviewBtn.classList.toggle('hidden', modularPageEditorMode !== 'page');
    if (pageHeaderSaveBtn) pageHeaderSaveBtn.classList.toggle('hidden', modularPageEditorMode !== 'page');
    if (pageHeaderBackBtn) pageHeaderBackBtn.classList.toggle('hidden', modularPageEditorMode !== 'page');
  }

  function closeModularPageTemplateEditor() {
    if (App.builder && App.builder.isActive && App.builder.isActive()) {
      App.builder.unmount();
    }
    setPageTemplateEditorVisible(false);
    modularPageTemplateDraft = null;
    modularPageEditorOptions = null;
  }

  function openModularPageTemplateEditor(template, options = {}) {
    const source = template && typeof template === 'object' ? template : {};
    modularPageEditorOptions = options || null;
    modularPageEditorMode = safeText(options.mode) === 'page' ? 'page' : 'template';
    modularPageEditorSourceTemplateId = safeText(options.sourceTemplateId || source.templateId || source.id);
    const next = applyLandingPageDefaultSelections({
      id: safeText(source.id),
      name: safeText(source.name, 255) || (modularPageEditorMode === 'page' ? 'Modular Page' : 'Modular Page Template'),
      templateKind: 'modular',
      templateId: safeText(options.templateId || source.templateId) || selectedTemplateId || LANDING_TEMPLATES[0].id,
      primaryColor: safeText(source.primaryColor),
      backgroundColor: safeText(source.backgroundColor),
      accentColor: safeText(source.accentColor),
      formId: safeText(source.formId),
      leadMagnetId: safeText(source.leadMagnetId),
      headlineId: safeText(source.headlineId),
      pitchId: safeText(source.pitchId),
      ctaId: safeText(source.ctaId),
      websiteBannerImageId: safeText(source.websiteBannerImageId),
      backgroundImageId: safeText(source.backgroundImageId),
      featureImageId: safeText(source.featureImageId),
      highlightImageId: safeText(source.highlightImageId),
      featureHeadlineId: safeText(source.featureHeadlineId),
      featureSubheadingId: safeText(source.featureSubheadingId),
      featureTitle: safeText(source.featureTitle, 500),
      featureCopy: safeText(source.featureCopy, 5000),
      highlightHeadlineId: safeText(source.highlightHeadlineId),
      highlightPitchId: safeText(source.highlightPitchId),
      highlightTitle: safeText(source.highlightTitle, 500),
      highlightCopy: safeText(source.highlightCopy, 5000),
      bodyHeadlineId: safeText(source.bodyHeadlineId),
      bodySubheadingId: safeText(source.bodySubheadingId),
      bodyPitchId: safeText(source.bodyPitchId),
      logoWideId: safeText(source.logoWideId),
      logoSquareId: safeText(source.logoSquareId),
      contentOverrides: normalizeLandingPageContentOverrides(source.contentOverrides),
      layoutSections: resolveModularLayoutSectionsForEditor(source),
    });
    modularPageTemplateDraft = next;

    if (modularPageEditorMode === 'page' && App.builder && App.builder.isActive && App.builder.isActive()) {
      App.builder.unmount();
    }

    const useReactBuilder = App.builder
      && typeof App.builder.useReactIsland === 'function'
      && App.builder.useReactIsland();

    if (useReactBuilder) {
      syncModularPageEditorPlacement();
      const mounted = App.builder.mount({
        surface: 'editor',
        editorMode: modularPageEditorMode,
        record: {
          ...source,
          id: safeText(source.id),
          name: safeText(source.name, 255) || (modularPageEditorMode === 'page' ? 'Modular Page' : 'Modular Page Template'),
          templateKind: safeText(source.templateKind) || 'modular',
          templateId: safeText(options.templateId || source.templateId) || selectedTemplateId || LANDING_TEMPLATES[0].id,
          pageBackground: source.pageBackground || null,
          layoutSections: source.layoutSections || [],
          contentOverrides: normalizeLandingPageContentOverrides(source.contentOverrides),
        },
        sourceTemplateId: modularPageEditorSourceTemplateId,
        options: modularPageEditorOptions,
        onClose: () => {
          closeModularPageTemplateEditor();
          if (modularPageEditorMode === 'page') {
            App.setActivePage('developManageLandingPagesPage');
          }
        },
        onSaved: async () => {
          await refresh();
        },
      });
      if (mounted) {
        setPageTemplateEditorVisible(false);
        if (safeText(options.targetPage)) {
          App.setActivePage(safeText(options.targetPage), { skipNormalize: true });
        }
        return;
      }
    }

    syncModularPageEditorPlacement();
    syncPageTemplateEditorInputs();
    renderModularPageTemplateEditor();
    if (safeText(options.targetPage)) {
      App.setActivePage(safeText(options.targetPage), { skipNormalize: true });
    }
    setPageTemplateEditorVisible(true);
  }

  function ensureModularPageTemplateDraft() {
    if (modularPageTemplateDraft) return;
    modularPageTemplateDraft = buildEmptyLandingRecord('Modular Page Template', selectedTemplateId || LANDING_TEMPLATES[0].id);
    modularPageTemplateDraft.templateKind = 'modular';
    modularPageTemplateDraft.layoutSections = [];
  }

  function reorderModularPageSections(fromIndex, toIndex) {
    if (!modularPageTemplateDraft) return;
    const sections = normalizePageTemplateLayoutSections(modularPageTemplateDraft.layoutSections);
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= sections.length || toIndex >= sections.length) return;
    const [moved] = sections.splice(fromIndex, 1);
    const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
    sections.splice(insertIndex, 0, moved);
    modularPageTemplateDraft.layoutSections = sections;
  }

  function insertModularPageSectionAt(layout, index = null) {
    if (!modularPageTemplateDraft) return;
    const sections = normalizePageTemplateLayoutSections(modularPageTemplateDraft.layoutSections);
    const nextSection = createModularPageSection(layout);
    const insertIndex = typeof index === 'number'
      ? Math.max(0, Math.min(index, sections.length))
      : sections.length;
    sections.splice(insertIndex, 0, nextSection);
    modularPageTemplateDraft.layoutSections = sections;
  }

  function clearModularPageWorkspaceIndicators() {
    const host = byId('developPageTemplateEditorSections');
    if (!host) return;
    host.classList.remove('is-drag-over');
    host.querySelectorAll('.develop-page-template-workspace-row').forEach((node) => {
      node.classList.remove('is-drop-before', 'is-drop-after', 'is-drag-over');
    });
  }

  function getModularPageWorkspaceDropTarget(clientX, clientY) {
    const host = byId('developPageTemplateEditorSections');
    if (!host) return null;
    const target = document.elementFromPoint(clientX, clientY);
    if (!target) return null;
    const row = target.closest('.develop-page-template-workspace-row');
    if (row && host.contains(row)) {
      const index = Number(row.dataset.sectionIndex);
      if (!Number.isNaN(index)) {
        const rect = row.getBoundingClientRect();
        return {
          type: 'row',
          index,
          before: clientY < rect.top + (rect.height / 2),
        };
      }
    }
    if (host.contains(target)) return { type: 'workspace' };
    return null;
  }

  function updateModularPageWorkspacePointerDropIndicators(clientX, clientY) {
    clearModularPageWorkspaceIndicators();
    const host = byId('developPageTemplateEditorSections');
    const dropTarget = getModularPageWorkspaceDropTarget(clientX, clientY);
    if (!host || !dropTarget) return null;
    host.classList.add('is-drag-over');
    if (dropTarget.type === 'row') {
      const row = host.querySelector(`.develop-page-template-workspace-row[data-section-index="${dropTarget.index}"]`);
      row?.classList.add(dropTarget.before ? 'is-drop-before' : 'is-drop-after');
    }
    return dropTarget;
  }

  function endModularPageLayoutPointerDrag(commit = false) {
    const drag = activePageLayoutPointerDrag;
    if (!drag) return;
    window.removeEventListener('pointermove', drag.onPointerMove);
    window.removeEventListener('pointerup', drag.onPointerUp);
    window.removeEventListener('pointercancel', drag.onPointerUp);
    document.body.classList.remove('develop-layout-dragging');
    document.body.style.cursor = '';
    drag.tile.classList.remove('is-dragging');
    drag.ghost.remove();
    if (commit && drag.dropTarget) {
      if (!modularPageTemplateDraft) {
        modularPageTemplateDraft = buildEmptyLandingRecord('Modular Page Template', selectedTemplateId || LANDING_TEMPLATES[0].id);
        modularPageTemplateDraft.templateKind = 'modular';
        modularPageTemplateDraft.layoutSections = [];
      }
      if (drag.dropTarget.type === 'row') {
        insertModularPageSectionAt(drag.layout, drag.dropTarget.before ? drag.dropTarget.index : drag.dropTarget.index + 1);
      } else {
        insertModularPageSectionAt(drag.layout);
      }
      renderModularPageTemplateEditor();
    } else {
      clearModularPageWorkspaceIndicators();
    }
    suppressLayoutTileClickUntil = Date.now() + 300;
    activePageLayoutPointerDrag = null;
  }

  function closeModularPageModulePicker() {
    const picker = activeModularPageModulePicker;
    if (!picker) return;
    picker.panel.remove();
    activeModularPageModulePicker = null;
  }

  function clearModularPageModuleCellIndicators() {
    const host = byId('developPageTemplateEditorSections');
    if (!host) return;
    host.querySelectorAll('.develop-page-template-row-cell').forEach((node) => {
      node.classList.remove('is-module-drop-target');
    });
  }

  function clearPlacedModuleReorderIndicators() {
    const host = byId('developPageTemplateEditorSections');
    if (!host) return;
    host.querySelectorAll('.develop-page-template-module-pill').forEach((node) => {
      node.classList.remove('is-drop-before', 'is-drop-after', 'is-dragging');
    });
    host.querySelectorAll('.develop-page-template-row-cell-stack').forEach((node) => {
      node.classList.remove('is-drop-append');
    });
    host.querySelectorAll('.develop-page-template-row-cell').forEach((node) => {
      node.classList.remove('is-module-drop-target');
    });
  }

  function getPlacedModuleDropTarget(clientX, clientY, drag) {
    const host = byId('developPageTemplateEditorSections');
    if (!host || !drag) return null;
    const target = document.elementFromPoint(clientX, clientY);
    if (!target) return null;
    const stack = target.closest('.develop-page-template-row-cell-stack');
    if (stack && host.contains(stack)) {
      const sectionIndex = Number(stack.dataset.sectionIndex);
      const column = safeText(stack.dataset.column) || 'col1';
      if (sectionIndex !== drag.sectionIndex) return null;
      const pill = target.closest('.develop-page-template-module-pill');
      if (!pill || !stack.contains(pill)) {
        return {
          type: 'append',
          stack,
          sectionIndex,
          column,
        };
      }
      const moduleIndex = Number(pill.dataset.moduleIndex);
      if (Number.isNaN(moduleIndex)) return null;
      if (column === drag.column && moduleIndex === drag.moduleIndex) return null;
      const rect = pill.getBoundingClientRect();
      const before = clientY < rect.top + (rect.height / 2);
      return {
        type: 'module',
        element: pill,
        before,
        sectionIndex,
        column,
        moduleIndex,
      };
    }
    const cell = target.closest('.develop-page-template-row-cell');
    if (!cell || !host.contains(cell)) return null;
    const sectionIndex = Number(cell.dataset.sectionIndex);
    const column = safeText(cell.dataset.column) || 'col1';
    if (sectionIndex !== drag.sectionIndex) return null;
    const cellStack = cell.querySelector('.develop-page-template-row-cell-stack');
    return {
      type: 'append',
      stack: cellStack || cell,
      sectionIndex,
      column,
    };
  }

  function updatePlacedModuleReorderIndicators(clientX, clientY, drag) {
    clearPlacedModuleReorderIndicators();
    const dropTarget = getPlacedModuleDropTarget(clientX, clientY, drag);
    if (!dropTarget) return null;
    if (dropTarget.type === 'append') {
      dropTarget.stack.classList.add('is-drop-append');
      const cell = dropTarget.stack.closest('.develop-page-template-row-cell');
      cell?.classList.add('is-module-drop-target');
    } else if (dropTarget.element) {
      dropTarget.element.classList.add(dropTarget.before ? 'is-drop-before' : 'is-drop-after');
      const cell = dropTarget.element.closest('.develop-page-template-row-cell');
      cell?.classList.add('is-module-drop-target');
    }
    return dropTarget;
  }

  function endPlacedPageModulePointerDrag(commit = false) {
    const drag = activePlacedPageModulePointerDrag;
    if (!drag) return;
    window.removeEventListener('pointermove', drag.onPointerMove);
    window.removeEventListener('pointerup', drag.onPointerUp);
    window.removeEventListener('pointercancel', drag.onPointerUp);
    document.body.classList.remove('develop-layout-dragging');
    document.body.style.cursor = '';
    drag.ghost.remove();
    clearPlacedModuleReorderIndicators();
    if (commit && drag.dropTarget) {
      const targetColumn = safeText(drag.dropTarget.column) || drag.column || 'col1';
      if (drag.dropTarget.type === 'append') {
        moveModularPageModule({
          fromSectionIndex: drag.sectionIndex,
          fromModuleIndex: drag.moduleIndex,
          toSectionIndex: drag.dropTarget.sectionIndex,
          toColumn: targetColumn,
          append: true,
        });
      } else {
        moveModularPageModule({
          fromSectionIndex: drag.sectionIndex,
          fromModuleIndex: drag.moduleIndex,
          toSectionIndex: drag.dropTarget.sectionIndex,
          toModuleIndex: drag.dropTarget.before ? drag.dropTarget.moduleIndex : drag.dropTarget.moduleIndex + 1,
          toColumn: targetColumn,
        });
      }
      renderModularPageTemplateEditor();
    }
    activePlacedPageModulePointerDrag = null;
  }

  function startPlacedPageModulePointerDrag(pill, details, startEvent) {
    if (!pill || !details) return;
    endPlacedPageModulePointerDrag(false);
    const ghost = pill.cloneNode(true);
    ghost.classList.add('develop-layout-tile-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ghost);
    const positionGhost = (x, y) => {
      ghost.style.left = `${x + 14}px`;
      ghost.style.top = `${y + 14}px`;
    };
    positionGhost(startEvent.clientX, startEvent.clientY);
    document.body.classList.add('develop-layout-dragging');
    document.body.style.cursor = 'grabbing';
    pill.classList.add('is-dragging');
    const drag = {
      pill,
      ghost,
      sectionIndex: details.sectionIndex,
      moduleIndex: details.moduleIndex,
      column: details.column,
      dropTarget: null,
      onPointerMove: null,
      onPointerUp: null,
    };
    drag.onPointerMove = (event) => {
      positionGhost(event.clientX, event.clientY);
      drag.dropTarget = updatePlacedModuleReorderIndicators(event.clientX, event.clientY, drag);
    };
    drag.onPointerUp = () => {
      endPlacedPageModulePointerDrag(Boolean(drag.dropTarget));
    };
    activePlacedPageModulePointerDrag = drag;
    window.addEventListener('pointermove', drag.onPointerMove);
    window.addEventListener('pointerup', drag.onPointerUp);
    window.addEventListener('pointercancel', drag.onPointerUp);
  }

  function getModularPageModuleCellDropTarget(clientX, clientY) {
    const host = byId('developPageTemplateEditorSections');
    if (!host) return null;
    const target = document.elementFromPoint(clientX, clientY);
    if (!target) return null;
    const cell = target.closest('.develop-page-template-row-cell');
    if (!cell || !host.contains(cell)) return null;
    return {
      sectionIndex: Number(cell.dataset.sectionIndex),
      column: safeText(cell.dataset.column) || 'col1',
      element: cell,
    };
  }

  function updateModularPageModuleCellIndicators(clientX, clientY) {
    clearModularPageModuleCellIndicators();
    const dropTarget = getModularPageModuleCellDropTarget(clientX, clientY);
    dropTarget?.element?.classList.add('is-module-drop-target');
    return dropTarget;
  }

  function addModularPageModuleToCell(moduleRef, sectionIndex, column) {
    if (!modularPageTemplateDraft) return;
    const sections = normalizePageTemplateLayoutSections(modularPageTemplateDraft.layoutSections);
    const section = sections[sectionIndex];
    if (!section) return;
    const savedModule = typeof moduleRef === 'object' && moduleRef
      ? moduleRef
      : getSavedModuleById(moduleRef);
    if (savedModule) {
      section.modules.push(createModularPageModuleFromSavedModule(savedModule, column));
    } else {
      section.modules.push(createModularPageModule(moduleRef, column));
    }
    modularPageTemplateDraft.layoutSections = sections;
  }

  function endModularPageModulePointerDrag(commit = false) {
    const drag = activePageModulePointerDrag;
    if (!drag) return;
    window.removeEventListener('pointermove', drag.onPointerMove);
    window.removeEventListener('pointerup', drag.onPointerUp);
    window.removeEventListener('pointercancel', drag.onPointerUp);
    document.body.classList.remove('develop-layout-dragging');
    document.body.style.cursor = '';
    drag.tile.classList.remove('is-dragging');
    drag.ghost.remove();
    if (commit && drag.dropTarget) {
      addModularPageModuleToCell(drag.moduleId || drag.moduleType, drag.dropTarget.sectionIndex, drag.dropTarget.column);
      closeModularPageModulePicker();
      renderModularPageTemplateEditor();
    }
    clearModularPageModuleCellIndicators();
    activePageModulePointerDrag = null;
  }

  function startModularPageModulePointerDrag(tile, moduleType, moduleId, startEvent) {
    if (!tile || (!moduleType && !moduleId)) return;
    endModularPageModulePointerDrag(false);
    const ghost = tile.cloneNode(true);
    ghost.classList.add('develop-layout-tile-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ghost);
    const positionGhost = (x, y) => {
      ghost.style.left = `${x + 14}px`;
      ghost.style.top = `${y + 14}px`;
    };
    positionGhost(startEvent.clientX, startEvent.clientY);
    document.body.classList.add('develop-layout-dragging');
    document.body.style.cursor = 'grabbing';
    tile.classList.add('is-dragging');
    const drag = {
      tile,
      moduleType,
      moduleId,
      ghost,
      dropTarget: null,
      onPointerMove: null,
      onPointerUp: null,
    };
    drag.onPointerMove = (event) => {
      positionGhost(event.clientX, event.clientY);
      drag.dropTarget = updateModularPageModuleCellIndicators(event.clientX, event.clientY);
    };
    drag.onPointerUp = () => {
      endModularPageModulePointerDrag(Boolean(drag.dropTarget));
    };
    activePageModulePointerDrag = drag;
    window.addEventListener('pointermove', drag.onPointerMove);
    window.addEventListener('pointerup', drag.onPointerUp);
    window.addEventListener('pointercancel', drag.onPointerUp);
  }

  async function openModularPageModulePicker(sectionIndex, column) {
    closeModularPageModulePicker();
    if (!savedModules.length) {
      await loadSavedModules().catch(() => {});
    }
    const panel = document.createElement('div');
    panel.className = 'develop-module-picker-panel';
    const pParser = new DOMParser();
    const pDoc = pParser.parseFromString(`
      <div class="develop-module-picker-header">
        <div class="develop-module-picker-header-copy">
          <div class="develop-module-picker-title">Add Module</div>
          <div class="develop-module-picker-subtitle">Drag a module into any row cell, or click one to add it here.</div>
        </div>
      </div>
      <div class="develop-module-picker-grid"></div>
    `, 'text/html');
    panel.textContent = '';
    Array.from(pDoc.body.childNodes).forEach(n => panel.appendChild(n.cloneNode(true)));
    const pickerHeader = panel.querySelector('.develop-module-picker-header');
    const closeBtn = App.makeIconButton('close', 'Close', () => {
      closeModularPageModulePicker();
    });
    closeBtn.classList.add('develop-module-picker-close');
    pickerHeader?.appendChild(closeBtn);
    const grid = panel.querySelector('.develop-module-picker-grid');
    const pickerItems = getModularModulePickerItems();
    if (!pickerItems.length && grid) {
      const empty = document.createElement('p');
      empty.className = 'develop-module-picker-subtitle';
      empty.textContent = 'No modules are available yet. Add modules under Builder: Modules, then try again.';
      grid.appendChild(empty);
    }
    pickerItems.forEach((item) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'develop-module-picker-tile';
      const tParser = new DOMParser();
      const tDoc = tParser.parseFromString(`
        <span class="develop-module-picker-icon">${escapeHtml(item.icon)}</span>
        <span class="develop-module-picker-label">${escapeHtml(item.label)}</span>
      `, 'text/html');
      tile.textContent = '';
      Array.from(tDoc.body.childNodes).forEach(n => tile.appendChild(n.cloneNode(true)));
      tile.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (event.pointerType !== 'mouse') return;
        event.preventDefault();
        startModularPageModulePointerDrag(tile, item.value, item.moduleId, event);
      });
      tile.addEventListener('click', () => {
        addModularPageModuleToCell(item.moduleId || item.value, sectionIndex, column);
        closeModularPageModulePicker();
        renderModularPageTemplateEditor();
      });
      grid?.appendChild(tile);
    });
    document.body.appendChild(panel);
    activeModularPageModulePicker = {
      panel,
      sectionIndex,
      column,
    };
  }

  function closeModularPageModuleEditor() {
    const editor = activeModularPageModuleEditor;
    if (!editor) return;
    editor.panel.remove();
    activeModularPageModuleEditor = null;
  }

  function saveActiveModularPageModuleEditor() {
    const editor = activeModularPageModuleEditor;
    if (!editor || !modularPageTemplateDraft) return false;
    const { panel, sectionIndex, moduleIndex } = editor;
    const nextSections = normalizePageTemplateLayoutSections(modularPageTemplateDraft.layoutSections);
    const nextSection = nextSections[sectionIndex];
    const nextModule = nextSection?.modules?.[moduleIndex];
    if (!nextModule) return false;
    nextModule.name = safeText(panel.querySelector('#developPageModuleEditorNameInput')?.value, 255);
    nextModule.settings = getDevelopModuleSettingsFromHost(nextModule.type, {
      prefix: 'developPageModuleEditorField',
      hostElement: panel.querySelector('#developPageModuleEditorFields') || panel,
    });
    if (nextModule.type === 'table') {
      nextModule.settings = syncTableModuleBorderSettings(nextModule.settings);
    }
    if (nextModule.type === 'image' || nextModule.type === 'logo-wide' || nextModule.type === 'logo-square') {
      nextModule.assetId = safeText(nextModule.settings?.imageAssetId || nextModule.assetId);
    }
    if (nextModule.type === 'video') {
      nextModule.assetId = safeText(nextModule.settings?.videoAssetId || nextModule.assetId);
    }
    modularPageTemplateDraft.layoutSections = nextSections;
    closeModularPageModuleEditor();
    renderModularPageTemplateEditor();
    return true;
  }

  async function openModularPageModuleEditor(sectionIndex, moduleIndex) {
    if (!modularPageTemplateDraft) return;
    const sections = normalizePageTemplateLayoutSections(modularPageTemplateDraft.layoutSections);
    const section = sections[sectionIndex];
    const module = section?.modules?.[moduleIndex];
    if (!module) return;
    const definition = getDevelopModuleTypeDefinition(module.type);
    if (!definition) {
      notify('No editor is configured for this module type yet.', true);
      return;
    }

    closeModularPageModuleEditor();
    await ensureAssetsLoaded().catch(() => {});
    const panel = document.createElement('div');
    panel.className = 'develop-module-editor-modal';
    const eParser = new DOMParser();
    const eDoc = eParser.parseFromString(`
      <div class="develop-module-editor-modal__backdrop"></div>
      <div class="develop-module-editor-modal__dialog">
        <div class="develop-module-editor-modal__header">
          <div>
            <h3>${escapeHtml(getModularModuleDisplayName(module) || definition.label)}</h3>
            <p>${escapeHtml(definition.label)} · page-specific settings</p>
          </div>
          <button type="button" class="develop-module-editor-modal__close btn btn-ghost">Close</button>
        </div>
        <div class="develop-module-editor-modal__body">
          <label class="stack-form">
            <span>Module Name</span>
            <input type="text" id="developPageModuleEditorNameInput" value="${escapeHtml(safeText(module.name, 255))}" />
          </label>
          <div id="developPageModuleEditorFields"></div>
          <div style="display: flex; gap: 0.75rem; justify-content: space-between; margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border);">
            <button type="button" id="developPageModuleEditorRemoveBtn" class="btn" style="color: var(--danger);">Remove</button>
            <div style="display: flex; gap: 0.75rem;">
              <button type="button" id="developPageModuleEditorCancelBtn" class="btn">Cancel</button>
              <button type="button" id="developPageModuleEditorSaveBtn" class="btn btn-primary">Save Module</button>
            </div>
          </div>
        </div>
      </div>
    `, 'text/html');
    panel.textContent = '';
    Array.from(eDoc.body.childNodes).forEach(n => panel.appendChild(n.cloneNode(true)));
    document.body.appendChild(panel);
    renderDevelopModuleSettingsFieldsInto(
      panel.querySelector('#developPageModuleEditorFields'),
      module.type,
      module.settings || {},
      { prefix: 'developPageModuleEditorField' }
    );
    const close = () => closeModularPageModuleEditor();
    panel.querySelector('.develop-module-editor-modal__backdrop')?.addEventListener('click', close);
    panel.querySelector('.develop-module-editor-modal__close')?.addEventListener('click', close);
    panel.querySelector('#developPageModuleEditorCancelBtn')?.addEventListener('click', close);
    panel.querySelector('#developPageModuleEditorRemoveBtn')?.addEventListener('click', () => {
      const nextSections = normalizePageTemplateLayoutSections(modularPageTemplateDraft.layoutSections);
      const nextSection = nextSections[sectionIndex];
      if (!nextSection) return;
      nextSection.modules.splice(moduleIndex, 1);
      modularPageTemplateDraft.layoutSections = nextSections;
      closeModularPageModuleEditor();
      renderModularPageTemplateEditor();
    });
    panel.querySelector('#developPageModuleEditorSaveBtn')?.addEventListener('click', () => {
      saveActiveModularPageModuleEditor();
    });
    activeModularPageModuleEditor = { panel, sectionIndex, moduleIndex };
  }

  function closeModularContainerEditor() {
    const editor = activeModularContainerEditor;
    if (!editor) return;
    editor.panel.remove();
    activeModularContainerEditor = null;
  }

  function saveActiveModularContainerEditor() {
    const editor = activeModularContainerEditor;
    if (!editor || !modularPageTemplateDraft) return false;
    const { panel, sectionIndex, columnId } = editor;
    const nextSections = normalizePageTemplateLayoutSections(modularPageTemplateDraft.layoutSections);
    const nextSection = nextSections[sectionIndex];
    if (!nextSection) return false;
    nextSection.containerSettings = nextSection.containerSettings || {};
    nextSection.containerSettings[columnId] = {
      margin: safeText(panel.querySelector('#developContainerMarginInput')?.value),
      padding: safeText(panel.querySelector('#developContainerPaddingInput')?.value),
      borderColor: safeText(panel.querySelector('#developContainerBorderColorInput')?.value),
      borderThickness: safeText(panel.querySelector('#developContainerBorderThicknessInput')?.value),
      borderRadius: safeText(panel.querySelector('#developContainerBorderRadiusInput')?.value),
      ...(() => {
        const background = readModularBackgroundFromPanel(panel, 'developContainerBackground');
        return {
          background,
          backgroundColor: background.mode === 'color'
            ? safeText(background.color)
            : (background.mode === 'transparent' ? 'transparent' : ''),
          backgroundImageId: background.mode === 'image' ? safeText(background.imageAssetId) : '',
        };
      })(),
    };
    modularPageTemplateDraft.layoutSections = nextSections;
    closeModularContainerEditor();
    renderModularPageTemplateEditor();
    return true;
  }

  function closeModularRowEditor() {
    const editor = activeModularRowEditor;
    if (!editor) return;
    editor.panel.remove();
    activeModularRowEditor = null;
  }

  function saveActiveModularRowEditor() {
    const editor = activeModularRowEditor;
    if (!editor || !modularPageTemplateDraft) return false;
    const { panel, sectionIndex } = editor;
    const nextSections = normalizePageTemplateLayoutSections(modularPageTemplateDraft.layoutSections);
    let nextSection = nextSections[sectionIndex];
    if (!nextSection) return false;
    const selectedLayout = (typeof editor.getSelectedLayout === 'function' ? editor.getSelectedLayout() : '')
      || safeText(panel.querySelector('[data-row-layout-option].is-selected')?.getAttribute('data-row-layout-option'))
      || getModularPageLayoutMeta(nextSection.layout).value;
    nextSection = remapSectionToLayout(nextSection, selectedLayout);
    nextSection.rowSettings = {
      margin: safeText(panel.querySelector('#developRowMarginInput')?.value),
      padding: safeText(panel.querySelector('#developRowPaddingInput')?.value),
      ...(() => {
        const background = readRowBackgroundFromPanel(panel);
        return {
          background,
          backgroundColor: background.mode === 'color'
            ? safeText(background.color)
            : (background.mode === 'transparent' ? 'transparent' : ''),
        };
      })(),
      overlayScreen: readRowOverlayScreenFromPanel(panel),
    };
    nextSections[sectionIndex] = nextSection;
    modularPageTemplateDraft.layoutSections = nextSections;
    closeModularRowEditor();
    renderModularPageTemplateEditor();
    return true;
  }

  function flushActiveModularEditors() {
    let changed = false;
    if (activeModularPageModuleEditor) changed = saveActiveModularPageModuleEditor() || changed;
    if (activeModularContainerEditor) changed = saveActiveModularContainerEditor() || changed;
    if (activeModularRowEditor) changed = saveActiveModularRowEditor() || changed;
    return changed;
  }

  async function openModularRowEditor(sectionIndex) {
    if (!modularPageTemplateDraft) return;
    await ensureAssetsLoaded();
    const sections = normalizePageTemplateLayoutSections(modularPageTemplateDraft.layoutSections);
    const section = sections[sectionIndex];
    if (!section) return;
    const settings = normalizeRowSettings(getSectionRowSettings(section));
    const activeLayout = getModularPageLayoutMeta(section.layout).value;
    closeModularRowEditor();
    const panel = document.createElement('div');
    panel.className = 'develop-module-editor-modal';
    const rParser = new DOMParser();
    const rDoc = rParser.parseFromString(`
      <div class="develop-module-editor-modal__backdrop"></div>
      <div class="develop-module-editor-modal__dialog">
        <div class="develop-module-editor-modal__header">
          <div>
            <h3>Row Settings</h3>
            <p>${escapeHtml(safeText(section.title) || `Row ${sectionIndex + 1}`)} · page-specific styling</p>
          </div>
          <button type="button" class="develop-module-editor-modal__close btn btn-ghost">Close</button>
        </div>
        <div class="develop-module-editor-modal__body">
          <div class="stack-form" style="margin-bottom:1rem;">
            <span>Layout</span>
            <div id="developRowLayoutPicker" class="develop-row-layout-picker">
              ${MODULAR_PAGE_LAYOUT_OPTIONS.map((option) => `
                <button type="button" class="develop-layout-tile develop-row-layout-picker__tile${safeText(option.value) === activeLayout ? ' is-selected' : ''}" data-row-layout-option="${escapeHtml(safeText(option.value))}" title="Use ${escapeHtml(safeText(option.value))} layout" aria-label="Use ${escapeHtml(safeText(option.value))} layout">
                  ${buildModularPageLayoutIconMarkup(option.value, 'develop-layout-picker-icon')}
                </button>
              `).join('')}
            </div>
          </div>
          <div class="grid-form">
            <label class="stack-form">
              <span>Margin</span>
              <input id="developRowMarginInput" type="number" min="0" step="1" value="${escapeHtml(safeText(settings.margin))}" />
            </label>
            <label class="stack-form">
              <span>Padding</span>
              <input id="developRowPaddingInput" type="number" min="0" step="1" value="${escapeHtml(safeText(settings.padding))}" />
            </label>
          </div>
          ${buildRowBackgroundControlsHtml(settings.background)}
          <div class="develop-container-editor-preview develop-module-editor-modal__preview">
            <div class="develop-container-editor-preview__label">Preview</div>
            <div id="developRowEditorPreviewBox" class="develop-container-editor-preview__box develop-row-editor-preview">
              <div id="developRowEditorPreviewOverlay" class="develop-row-overlay-screen"></div>
              <div id="developRowEditorPreviewColumns" class="develop-row-editor-preview__columns"></div>
            </div>
          </div>
        </div>
        <div class="develop-module-editor-modal__footer">
          <button type="button" id="developRowSettingsResetBtn" class="btn">Reset</button>
          <div class="develop-module-editor-modal__footer-actions">
            <button type="button" id="developRowSettingsCancelBtn" class="btn">Cancel</button>
            <button type="button" id="developRowSettingsSaveBtn" class="btn btn-primary">Save Row</button>
          </div>
        </div>
      </div>
    `, 'text/html');
    panel.textContent = '';
    Array.from(rDoc.body.childNodes).forEach(n => panel.appendChild(n.cloneNode(true)));
    mountRowOverlayScreenControls(panel, settings.overlayScreen);
    document.body.appendChild(panel);
    markDevelopModuleEditorDialogExpanded(panel);
    const close = () => closeModularRowEditor();
    panel.querySelector('.develop-module-editor-modal__backdrop')?.addEventListener('click', close);
    panel.querySelector('.develop-module-editor-modal__close')?.addEventListener('click', close);
    panel.querySelector('#developRowSettingsCancelBtn')?.addEventListener('click', close);
    let selectedLayout = activeLayout;
    const updatePreview = () => {
      const preview = panel.querySelector('#developRowEditorPreviewBox');
      if (!preview) return;
      const previewSettings = {
        margin: safeText(panel.querySelector('#developRowMarginInput')?.value),
        padding: safeText(panel.querySelector('#developRowPaddingInput')?.value),
        background: readRowBackgroundFromPanel(panel),
        overlayScreen: readRowOverlayScreenFromPanel(panel),
      };
      Object.assign(preview.style, buildRowStyle(previewSettings));
      const overlay = panel.querySelector('#developRowEditorPreviewOverlay');
      if (overlay) {
        const overlayStyle = buildRowOverlayScreenStyle(previewSettings.overlayScreen);
        Object.keys(overlay.style).forEach((key) => {
          overlay.style[key] = '';
        });
        Object.assign(overlay.style, overlayStyle);
        overlay.hidden = !hasActiveRowOverlayScreen(previewSettings.overlayScreen);
      }
      const columnsHost = panel.querySelector('#developRowEditorPreviewColumns');
      if (columnsHost) {
        const layoutValue = selectedLayout || activeLayout;
        columnsHost.style.gridTemplateColumns = buildModularPageGridTemplate(layoutValue);
        const columnCount = getModularPageLayoutMeta(layoutValue).columns.length;
        while (columnsHost.children.length < columnCount) {
          const cell = document.createElement('div');
          cell.className = 'develop-row-editor-preview__column';
          columnsHost.appendChild(cell);
        }
        while (columnsHost.children.length > columnCount) {
          columnsHost.lastElementChild?.remove();
        }
      }
    };
    panel.querySelectorAll('[data-row-layout-option]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedLayout = safeText(button.getAttribute('data-row-layout-option')) || activeLayout;
        panel.querySelectorAll('[data-row-layout-option]').forEach((node) => {
          node.classList.toggle('is-selected', node === button);
        });
        updatePreview();
      });
    });
    let rowImagePicker = null;
    let rowOverlayImagePicker = null;
    panel.querySelector('#developRowSettingsResetBtn')?.addEventListener('click', () => {
      panel.querySelector('#developRowMarginInput').value = '';
      panel.querySelector('#developRowPaddingInput').value = '';
      panel.querySelector('#developRowBackgroundModeSelect').value = 'none';
      panel.querySelector('#developRowBackgroundColorPrimaryInput').value = '#ffffff';
      panel.querySelector('#developRowBackgroundColorSecondaryInput').value = '#eaf4ff';
      panel.querySelector('#developRowBackgroundStyleSelect').value = '';
      rowImagePicker?.clear();
      panel.querySelector('#developRowBackgroundImageUrlInput').value = '';
      panel.querySelector('#developRowOverlayScreenModeSelect').value = 'none';
      panel.querySelector('#developRowOverlayScreenColorPrimaryInput').value = '#ffffff';
      panel.querySelector('#developRowOverlayScreenColorSecondaryInput').value = '#eaf4ff';
      panel.querySelector('#developRowOverlayScreenStyleSelect').value = '';
      panel.querySelector('#developRowOverlayScreenImageUrlInput').value = '';
      panel.querySelector('#developRowOverlayScreenOpacityRange').value = '100';
      const overlayOpacityValue = panel.querySelector('#developRowOverlayScreenOpacityValue');
      if (overlayOpacityValue) overlayOpacityValue.textContent = '100%';
      rowOverlayImagePicker?.clear();
      syncRowBackgroundControlVisibility(panel);
      syncRowOverlayScreenControlVisibility(panel);
      selectedLayout = activeLayout;
      panel.querySelectorAll('[data-row-layout-option]').forEach((node) => {
        node.classList.toggle('is-selected', safeText(node.getAttribute('data-row-layout-option')) === activeLayout);
      });
      updatePreview();
    });
    const rowImagePickerHost = panel.querySelector('#developRowBackgroundImagePickerHost');
    rowImagePicker = rowImagePickerHost
      ? mountDevelopInlineImagePicker(rowImagePickerHost, {
        inputId: 'developRowBackgroundImageAssetInput',
        initialValue: safeText(settings.background?.imageAssetId),
        title: 'Background Image',
        onChange: (assetId) => {
          const urlInput = panel.querySelector('#developRowBackgroundImageUrlInput');
          if (urlInput && assetId) urlInput.value = getLandingPageAssetUrl(assetId) || urlInput.value;
          updatePreview();
        },
      })
      : null;
    const rowOverlayImagePickerHost = panel.querySelector('#developRowOverlayScreenImagePickerHost');
    rowOverlayImagePicker = rowOverlayImagePickerHost
      ? mountDevelopInlineImagePicker(rowOverlayImagePickerHost, {
        inputId: 'developRowOverlayScreenImageAssetInput',
        initialValue: safeText(settings.overlayScreen?.background?.imageAssetId),
        title: 'Overlay Image',
        onChange: (assetId) => {
          const urlInput = panel.querySelector('#developRowOverlayScreenImageUrlInput');
          if (urlInput && assetId) urlInput.value = getLandingPageAssetUrl(assetId) || urlInput.value;
          updatePreview();
        },
      })
      : null;
    syncRowOverlayScreenControlVisibility(panel);
    panel.querySelector('#developRowOverlayScreenModeSelect')?.addEventListener('change', () => {
      syncRowOverlayScreenControlVisibility(panel);
      updatePreview();
    });
    const overlayOpacityRange = panel.querySelector('#developRowOverlayScreenOpacityRange');
    const overlayOpacityValue = panel.querySelector('#developRowOverlayScreenOpacityValue');
    overlayOpacityRange?.addEventListener('input', () => {
      if (overlayOpacityValue) overlayOpacityValue.textContent = `${safeText(overlayOpacityRange.value) || '0'}%`;
      updatePreview();
    });
    [
      '#developRowOverlayScreenColorPrimaryInput',
      '#developRowOverlayScreenColorSecondaryInput',
      '#developRowOverlayScreenStyleSelect',
      '#developRowOverlayScreenImageUrlInput',
    ].forEach((selector) => {
      const input = panel.querySelector(selector);
      input?.addEventListener('input', updatePreview);
      input?.addEventListener('change', updatePreview);
    });
    syncRowBackgroundControlVisibility(panel);
    panel.querySelector('#developRowBackgroundModeSelect')?.addEventListener('change', () => {
      syncRowBackgroundControlVisibility(panel);
      updatePreview();
    });
    [
      '#developRowMarginInput',
      '#developRowPaddingInput',
      '#developRowBackgroundColorPrimaryInput',
      '#developRowBackgroundColorSecondaryInput',
      '#developRowBackgroundStyleSelect',
      '#developRowBackgroundImageUrlInput',
    ].forEach((selector) => {
      const input = panel.querySelector(selector);
      input?.addEventListener('input', updatePreview);
      input?.addEventListener('change', updatePreview);
    });
    updatePreview();
    panel.querySelector('#developRowSettingsSaveBtn')?.addEventListener('click', () => {
      saveActiveModularRowEditor();
    });
    activeModularRowEditor = {
      panel,
      sectionIndex,
      getSelectedLayout: () => selectedLayout || activeLayout,
    };
  }

  async function openModularContainerEditor(sectionIndex, columnId) {
    if (!modularPageTemplateDraft) return;
    await ensureAssetsLoaded();
    const sections = normalizePageTemplateLayoutSections(modularPageTemplateDraft.layoutSections);
    const section = sections[sectionIndex];
    if (!section) return;
    const settings = normalizeContainerSettings(getSectionContainerSettings(section, columnId));
    closeModularContainerEditor();
    const panel = document.createElement('div');
    panel.className = 'develop-module-editor-modal';
    const cParser = new DOMParser();
    const cDoc = cParser.parseFromString(`
      <div class="develop-module-editor-modal__backdrop"></div>
      <div class="develop-module-editor-modal__dialog">
        <div class="develop-module-editor-modal__header">
          <div>
            <h3>Container Settings</h3>
            <p>${escapeHtml(safeText(columnId).toUpperCase() || 'Container')} · page-specific styling</p>
          </div>
          <button type="button" class="develop-module-editor-modal__close btn btn-ghost">Close</button>
        </div>
        <div class="develop-module-editor-modal__body">
          <div class="grid-form">
            <label class="stack-form">
              <span>Margin</span>
              <input id="developContainerMarginInput" type="number" min="0" step="1" value="${escapeHtml(safeText(settings.margin))}" />
            </label>
            <label class="stack-form">
              <span>Padding</span>
              <input id="developContainerPaddingInput" type="number" min="0" step="1" value="${escapeHtml(safeText(settings.padding))}" />
            </label>
            <label class="stack-form">
              <span>Border Color</span>
              <input id="developContainerBorderColorInput" type="color" value="${escapeHtml(safeText(settings.borderColor) || '#d6e6f5')}" />
            </label>
            <label class="stack-form">
              <span>Border Thickness</span>
              <input id="developContainerBorderThicknessInput" type="number" min="0" step="1" value="${escapeHtml(safeText(settings.borderThickness))}" />
            </label>
            <label class="stack-form">
              <span>Border Radius</span>
              <input id="developContainerBorderRadiusInput" type="number" min="0" step="1" value="${escapeHtml(safeText(settings.borderRadius))}" />
            </label>
          </div>
          ${buildModularBackgroundControlsHtml('developContainerBackground', settings.background)}
          <div class="develop-container-editor-preview develop-module-editor-modal__preview">
            <div class="develop-container-editor-preview__label">Preview</div>
            <div id="developContainerEditorPreviewBox" class="develop-container-editor-preview__box">Container preview</div>
          </div>
        </div>
        <div class="develop-module-editor-modal__footer">
          <button type="button" id="developContainerSettingsResetBtn" class="btn">Reset</button>
          <div class="develop-module-editor-modal__footer-actions">
            <button type="button" id="developContainerSettingsCancelBtn" class="btn">Cancel</button>
            <button type="button" id="developContainerSettingsSaveBtn" class="btn btn-primary">Save Container</button>
          </div>
        </div>
      </div>
    `, 'text/html');
    panel.textContent = '';
    Array.from(cDoc.body.childNodes).forEach(n => panel.appendChild(n.cloneNode(true)));
    document.body.appendChild(panel);
    markDevelopModuleEditorDialogExpanded(panel);
    const close = () => closeModularContainerEditor();
    panel.querySelector('.develop-module-editor-modal__backdrop')?.addEventListener('click', close);
    panel.querySelector('.develop-module-editor-modal__close')?.addEventListener('click', close);
    panel.querySelector('#developContainerSettingsCancelBtn')?.addEventListener('click', close);
    let containerImagePicker = null;
    const updatePreview = () => {
      const preview = panel.querySelector('#developContainerEditorPreviewBox');
      if (!preview) return;
      const previewSettings = {
        margin: safeText(panel.querySelector('#developContainerMarginInput')?.value),
        padding: safeText(panel.querySelector('#developContainerPaddingInput')?.value),
        borderColor: safeText(panel.querySelector('#developContainerBorderColorInput')?.value),
        borderThickness: safeText(panel.querySelector('#developContainerBorderThicknessInput')?.value),
        borderRadius: safeText(panel.querySelector('#developContainerBorderRadiusInput')?.value),
        background: readModularBackgroundFromPanel(panel, 'developContainerBackground'),
      };
      Object.assign(preview.style, buildContainerStyle(previewSettings));
    };
    const containerImagePickerHost = panel.querySelector('#developContainerBackgroundImagePickerHost');
    containerImagePicker = containerImagePickerHost
      ? mountDevelopInlineImagePicker(containerImagePickerHost, {
        inputId: 'developContainerBackgroundImageAssetInput',
        initialValue: safeText(settings.background?.imageAssetId || settings.backgroundImageId),
        title: 'Container Background Image',
        onChange: (assetId) => {
          const urlInput = panel.querySelector('#developContainerBackgroundImageUrlInput');
          if (urlInput && assetId) urlInput.value = getLandingPageAssetUrl(assetId) || urlInput.value;
          updatePreview();
        },
      })
      : null;
    syncModularBackgroundControlVisibility(panel, 'developContainerBackground');
    panel.querySelector('#developContainerBackgroundModeSelect')?.addEventListener('change', () => {
      syncModularBackgroundControlVisibility(panel, 'developContainerBackground');
      updatePreview();
    });
    panel.querySelector('#developContainerSettingsResetBtn')?.addEventListener('click', () => {
      panel.querySelector('#developContainerMarginInput').value = '';
      panel.querySelector('#developContainerPaddingInput').value = '';
      panel.querySelector('#developContainerBackgroundModeSelect').value = 'none';
      panel.querySelector('#developContainerBackgroundColorPrimaryInput').value = '#ffffff';
      panel.querySelector('#developContainerBackgroundColorSecondaryInput').value = '#eaf4ff';
      panel.querySelector('#developContainerBackgroundStyleSelect').value = '';
      containerImagePicker?.clear();
      panel.querySelector('#developContainerBackgroundImageUrlInput').value = '';
      syncModularBackgroundControlVisibility(panel, 'developContainerBackground');
      panel.querySelector('#developContainerBorderColorInput').value = '#d6e6f5';
      panel.querySelector('#developContainerBorderThicknessInput').value = '';
      panel.querySelector('#developContainerBorderRadiusInput').value = '';
      updatePreview();
    });
    [
      '#developContainerMarginInput',
      '#developContainerPaddingInput',
      '#developContainerBackgroundColorPrimaryInput',
      '#developContainerBackgroundColorSecondaryInput',
      '#developContainerBackgroundStyleSelect',
      '#developContainerBackgroundImageUrlInput',
      '#developContainerBorderColorInput',
      '#developContainerBorderThicknessInput',
      '#developContainerBorderRadiusInput',
    ].forEach((selector) => {
      const input = panel.querySelector(selector);
      input?.addEventListener('input', updatePreview);
      input?.addEventListener('change', updatePreview);
    });
    updatePreview();
    panel.querySelector('#developContainerSettingsSaveBtn')?.addEventListener('click', () => {
      saveActiveModularContainerEditor();
    });
    activeModularContainerEditor = { panel, sectionIndex, columnId };
  }

  function startModularPageLayoutPointerDrag(tile, layout, startEvent) {
    if (!tile || !layout) return;
    endModularPageLayoutPointerDrag(false);
    const ghost = tile.cloneNode(true);
    ghost.classList.add('develop-layout-tile-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ghost);
    const positionGhost = (x, y) => {
      ghost.style.left = `${x + 14}px`;
      ghost.style.top = `${y + 14}px`;
    };
    positionGhost(startEvent.clientX, startEvent.clientY);
    document.body.classList.add('develop-layout-dragging');
    document.body.style.cursor = 'grabbing';
    tile.classList.add('is-dragging');
    const drag = {
      tile,
      layout,
      ghost,
      dropTarget: null,
      onPointerMove: null,
      onPointerUp: null,
    };
    drag.onPointerMove = (event) => {
      positionGhost(event.clientX, event.clientY);
      drag.dropTarget = updateModularPageWorkspacePointerDropIndicators(event.clientX, event.clientY);
    };
    drag.onPointerUp = () => {
      endModularPageLayoutPointerDrag(Boolean(drag.dropTarget));
    };
    activePageLayoutPointerDrag = drag;
    window.addEventListener('pointermove', drag.onPointerMove);
    window.addEventListener('pointerup', drag.onPointerUp);
    window.addEventListener('pointercancel', drag.onPointerUp);
  }

  function moveModularPageSection(fromIndex, targetIndex, before = true) {
    if (!modularPageTemplateDraft) return;
    const sections = normalizePageTemplateLayoutSections(modularPageTemplateDraft.layoutSections);
    if (fromIndex < 0 || fromIndex >= sections.length || targetIndex < 0 || targetIndex >= sections.length) return;
    const [moved] = sections.splice(fromIndex, 1);
    if (!moved) return;
    let insertIndex = targetIndex;
    if (fromIndex < targetIndex) insertIndex -= 1;
    if (!before) insertIndex += 1;
    insertIndex = Math.max(0, Math.min(insertIndex, sections.length));
    sections.splice(insertIndex, 0, moved);
    modularPageTemplateDraft.layoutSections = sections;
  }

  function moveModularPageModule({
    fromSectionIndex,
    fromModuleIndex,
    toSectionIndex,
    toModuleIndex = null,
    toColumn = '',
    append = false,
  }) {
    if (!modularPageTemplateDraft) return;
    const sections = normalizePageTemplateLayoutSections(modularPageTemplateDraft.layoutSections);
    const fromSection = sections[fromSectionIndex];
    const toSection = sections[toSectionIndex];
    if (!fromSection || !toSection) return;
    if (fromModuleIndex < 0 || fromModuleIndex >= fromSection.modules.length) return;
    const [moved] = fromSection.modules.splice(fromModuleIndex, 1);
    if (!moved) return;
    moved.column = safeText(toColumn)
      || moved.column
      || getModularPageLayoutColumnIds(toSection.layout)[0]
      || 'col1';

    let insertIndex = typeof toModuleIndex === 'number' ? toModuleIndex : toSection.modules.length;
    if (append || typeof toModuleIndex !== 'number') insertIndex = toSection.modules.length;
    if (fromSectionIndex === toSectionIndex && fromModuleIndex < insertIndex) insertIndex -= 1;
    insertIndex = Math.max(0, Math.min(insertIndex, toSection.modules.length));
    toSection.modules.splice(insertIndex, 0, moved);
    modularPageTemplateDraft.layoutSections = sections;
  }

  function renderModularPageTemplateEditor() {
    const title = byId('developPageTemplateEditorTitle');
    const meta = byId('developPageTemplateEditorMeta');
    const host = byId('developPageTemplateEditorSections');
    if (!host || !modularPageTemplateDraft) return;
    if (title) title.textContent = modularPageEditorMode === 'page' ? '' : 'Page: Modular';
    if (meta) meta.textContent = modularPageEditorMode === 'page' ? '' : 'Drag row layouts into the workspace. Dropping a layout creates a row of empty cells.';
    host.textContent = '';
    host.className = 'develop-template-module-list develop-page-template-workspace';
    const sections = normalizePageTemplateLayoutSections(modularPageTemplateDraft.layoutSections);
    if (!sections.length) modularPageTemplateDraft.layoutSections = [];
    let draggedSectionIndex = null;
    const clearWorkspaceDropIndicators = () => {
      clearModularPageWorkspaceIndicators();
    };
    host.addEventListener('dragover', (event) => {
      if (!draggedNewPageSectionLayout && draggedSectionIndex === null) return;
      event.preventDefault();
      host.classList.add('is-drag-over');
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    });
    host.addEventListener('dragleave', () => {
      clearWorkspaceDropIndicators();
    });
    host.addEventListener('drop', (event) => {
      const droppedLayout = draggedSectionIndex === null
        ? (draggedNewPageSectionLayout || safeText(event.dataTransfer?.getData('text/plain')).replace(/^layout:/, ''))
        : '';
      if (!droppedLayout && draggedSectionIndex === null) return;
      event.preventDefault();
      event.stopPropagation();
      clearWorkspaceDropIndicators();
      if (droppedLayout) {
        insertModularPageSectionAt(droppedLayout);
        draggedNewPageSectionLayout = '';
        if (draggedNewPageSectionLayoutClearTimer) {
          clearTimeout(draggedNewPageSectionLayoutClearTimer);
          draggedNewPageSectionLayoutClearTimer = null;
        }
        renderModularPageTemplateEditor();
      }
    });
    if (!normalizePageTemplateLayoutSections(modularPageTemplateDraft.layoutSections).length) {
      const emptyState = document.createElement('div');
      emptyState.className = 'develop-page-template-workspace-empty';
      const esParser = new DOMParser();
      const esDoc = esParser.parseFromString(`
        <div class="develop-page-template-workspace-empty-title">Workspace</div>
        <div class="develop-page-template-workspace-empty-copy">Drag a row layout from below into this workspace to start building your page.</div>
      `, 'text/html');
      emptyState.textContent = '';
      Array.from(esDoc.body.childNodes).forEach(n => emptyState.appendChild(n.cloneNode(true)));
      host.appendChild(emptyState);
    }
    normalizePageTemplateLayoutSections(modularPageTemplateDraft.layoutSections).forEach((section, sectionIndex) => {
      const item = document.createElement('div');
      item.className = 'develop-page-template-workspace-row';
      item.dataset.sectionIndex = String(sectionIndex);
      Object.assign(item.style, buildSectionRowStyle(section));
      appendRowOverlayScreenElement(item, section);
      item.draggable = true;
      item.title = 'Drag to reorder row';
      item.addEventListener('dragstart', (event) => {
        draggedNewPageSectionLayout = '';
        if (draggedNewPageSectionLayoutClearTimer) {
          clearTimeout(draggedNewPageSectionLayoutClearTimer);
          draggedNewPageSectionLayoutClearTimer = null;
        }
        draggedSectionIndex = sectionIndex;
        item.classList.add('is-dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', `section:${sectionIndex}`);
        }
      });
      item.addEventListener('dragend', () => {
        draggedSectionIndex = null;
        clearWorkspaceDropIndicators();
        host.querySelectorAll('.develop-page-template-workspace-row').forEach((node) => {
          node.classList.remove('is-dragging');
        });
      });

      item.addEventListener('dragover', (event) => {
        if (!draggedNewPageSectionLayout && (draggedSectionIndex === null || draggedSectionIndex === sectionIndex)) return;
        event.preventDefault();
        event.stopPropagation();
        clearWorkspaceDropIndicators();
        const rect = item.getBoundingClientRect();
        const before = event.clientY < rect.top + (rect.height / 2);
        item.classList.add(before ? 'is-drop-before' : 'is-drop-after');
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      });
      item.addEventListener('dragleave', () => {
        item.classList.remove('is-drop-before', 'is-drop-after');
      });
      item.addEventListener('drop', (event) => {
        const droppedLayout = draggedSectionIndex === null
          ? (draggedNewPageSectionLayout || safeText(event.dataTransfer?.getData('text/plain')).replace(/^layout:/, ''))
          : '';
        if (!droppedLayout && (draggedSectionIndex === null || draggedSectionIndex === sectionIndex)) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = item.getBoundingClientRect();
        const before = event.clientY < rect.top + (rect.height / 2);
        clearWorkspaceDropIndicators();
        if (droppedLayout) {
          insertModularPageSectionAt(droppedLayout, before ? sectionIndex : sectionIndex + 1);
          draggedNewPageSectionLayout = '';
          if (draggedNewPageSectionLayoutClearTimer) {
            clearTimeout(draggedNewPageSectionLayoutClearTimer);
            draggedNewPageSectionLayoutClearTimer = null;
          }
          renderModularPageTemplateEditor();
          return;
        }
        moveModularPageSection(draggedSectionIndex, sectionIndex, before);
        renderModularPageTemplateEditor();
      });

      const rowActions = document.createElement('div');
      rowActions.className = 'develop-page-template-row-actions';
      const rowEdit = document.createElement('button');
      rowEdit.type = 'button';
      rowEdit.className = 'develop-page-template-row-action';
      const reParser = new DOMParser();
      const reDoc = reParser.parseFromString(getBuilderInlineIconMarkup('settings', 'develop-builder-inline-icon'), 'text/html');
      rowEdit.textContent = '';
      Array.from(reDoc.body.childNodes).forEach(n => rowEdit.appendChild(n.cloneNode(true)));
      rowEdit.title = `Edit ${safeText(section.title) || `Row ${sectionIndex + 1}`}`;
      rowEdit.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openModularRowEditor(sectionIndex);
      });
      const rowDelete = document.createElement('button');
      rowDelete.type = 'button';
      rowDelete.className = 'develop-page-template-row-action develop-page-template-row-action--delete';
      const rdParser = new DOMParser();
      const rdDoc = rdParser.parseFromString(getBuilderInlineIconMarkup('trash', 'develop-builder-inline-icon'), 'text/html');
      rowDelete.textContent = '';
      Array.from(rdDoc.body.childNodes).forEach(n => rowDelete.appendChild(n.cloneNode(true)));
      rowDelete.title = `Remove ${safeText(section.title) || `Row ${sectionIndex + 1}`}`;
      rowDelete.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        modularPageTemplateDraft.layoutSections.splice(sectionIndex, 1);
        renderModularPageTemplateEditor();
      });
      rowActions.appendChild(rowEdit);
      rowActions.appendChild(rowDelete);
      const columnOptions = getModularPageLayoutMeta(section.layout).columns;
      const columnGroups = document.createElement('div');
      columnGroups.className = 'develop-page-template-row-cells';
      columnGroups.style.gridTemplateColumns = buildModularPageGridTemplate(section.layout);
      columnOptions.forEach((columnDef) => {
        const columnId = safeText(columnDef.id) || 'col1';
        const columnDropZone = document.createElement('div');
        columnDropZone.className = 'develop-page-template-row-cell';
        columnDropZone.dataset.column = columnId;
        columnDropZone.dataset.sectionIndex = String(sectionIndex);
        const containerSettings = getSectionContainerSettings(section, columnId);
        Object.assign(columnDropZone.style, buildContainerStyle(containerSettings));
        const cellModules = section.modules
          .map((module, originalIndex) => ({ module, originalIndex }))
          .filter((entry) => {
            const moduleColumn = safeText(entry.module?.column);
            return moduleColumn === columnId || mapNormieColumnToLegacy(moduleColumn, section.layout) === columnId;
          });
        const stack = document.createElement('div');
        stack.className = 'develop-page-template-row-cell-stack';
        stack.dataset.sectionIndex = String(sectionIndex);
        stack.dataset.column = columnId;
        const settingsBtn = document.createElement('button');
        settingsBtn.type = 'button';
        settingsBtn.className = 'develop-page-template-cell-settings';
        const sbParser = new DOMParser();
        const sbDoc = sbParser.parseFromString(getBuilderInlineIconMarkup('settings', 'develop-builder-inline-icon'), 'text/html');
        settingsBtn.textContent = '';
        Array.from(sbDoc.body.childNodes).forEach(n => settingsBtn.appendChild(n.cloneNode(true)));
        settingsBtn.title = 'Container settings';
        settingsBtn.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await openModularContainerEditor(sectionIndex, columnId);
        });
        if (cellModules.length) {
          cellModules.forEach(({ module, originalIndex }) => {
            const pill = document.createElement('div');
            pill.className = 'develop-page-template-module-pill';
            pill.setAttribute('role', 'button');
            pill.setAttribute('tabindex', '0');
            pill.dataset.sectionIndex = String(sectionIndex);
            pill.dataset.column = columnId;
            pill.dataset.moduleIndex = String(originalIndex);
            const plParser = new DOMParser();
            const plDoc = plParser.parseFromString(`
              <span class="develop-page-template-module-pill-icon">${escapeHtml(getModularModuleIcon(module.type))}</span>
              <span class="develop-page-template-module-pill-copy">
                <span class="develop-page-template-module-pill-label">${escapeHtml(getModularModuleDisplayName(module))}</span>
                <span class="develop-page-template-module-pill-type">${escapeHtml(getPageModuleTypeMeta(module.type).label)}</span>
                <span class="develop-page-template-module-pill-preview">${escapeHtml(getDevelopModulePreview({ moduleType: module.type, name: module.name, settings: module.settings || {} }))}</span>
              </span>
              <span class="develop-page-template-module-pill-actions">
                <button type="button" class="develop-page-template-module-pill-action" title="Edit module" aria-label="Edit module">${getBuilderInlineIconMarkup('settings', 'develop-builder-inline-icon')}</button>
                <button type="button" class="develop-page-template-module-pill-action develop-page-template-module-pill-action--delete" title="Remove module" aria-label="Remove module">${getBuilderInlineIconMarkup('trash', 'develop-builder-inline-icon')}</button>
              </span>
            `, 'text/html');
            pill.textContent = '';
            Array.from(plDoc.body.childNodes).forEach(n => pill.appendChild(n.cloneNode(true)));
            pill.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              openModularPageModuleEditor(sectionIndex, originalIndex);
            });
            pill.addEventListener('pointerdown', (event) => {
              if (event.button !== 0) return;
              const interactiveChild = event.target instanceof Element
                ? event.target.closest('.develop-page-template-module-pill-action')
                : null;
              if (interactiveChild) return;
              event.preventDefault();
              event.stopPropagation();
              startPlacedPageModulePointerDrag(pill, {
                sectionIndex,
                moduleIndex: originalIndex,
                column: columnId,
              }, event);
            });
            pill.addEventListener('keydown', (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.stopPropagation();
              openModularPageModuleEditor(sectionIndex, originalIndex);
            });
            const editBtn = pill.querySelector('.develop-page-template-module-pill-action');
            editBtn?.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              openModularPageModuleEditor(sectionIndex, originalIndex);
            });
            const deleteBtn = pill.querySelector('.develop-page-template-module-pill-action--delete');
            deleteBtn?.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              const nextSections = normalizePageTemplateLayoutSections(modularPageTemplateDraft.layoutSections);
              const nextSection = nextSections[sectionIndex];
              if (!nextSection) return;
              nextSection.modules.splice(originalIndex, 1);
              modularPageTemplateDraft.layoutSections = nextSections;
              renderModularPageTemplateEditor();
            });
            stack.appendChild(pill);
          });
        }
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'develop-page-template-cell-add';
        const abParser = new DOMParser();
        const abDoc = abParser.parseFromString(getBuilderInlineIconMarkup('plus', 'develop-builder-inline-icon'), 'text/html');
        addBtn.textContent = '';
        Array.from(abDoc.body.childNodes).forEach(n => addBtn.appendChild(n.cloneNode(true)));
        addBtn.title = 'Add module';
        addBtn.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await openModularPageModulePicker(sectionIndex, columnId);
        });
        columnDropZone.appendChild(settingsBtn);
        columnDropZone.appendChild(stack);
        columnDropZone.appendChild(addBtn);
        columnGroups.appendChild(columnDropZone);
      });
      item.appendChild(columnGroups);
      item.appendChild(rowActions);
      host.appendChild(item);
    });
  }

  function backgroundSettingsForSave(background) {
    const bg = normalizeBackgroundSettings(background);
    if (bg.mode === 'transparent') {
      return {
        ...bg,
        mode: 'color',
        color: 'transparent',
      };
    }
    return bg;
  }

  function layoutSectionsForSave(sections) {
    return normalizePageTemplateLayoutSections(sections).map((section) => {
      const legacyLayout = resolveLegacySectionLayout(section);
      const normieLayout = resolveNormieLayoutFromSection({ ...section, layout: legacyLayout });
      const rowSettings = normalizeRowSettings(section.rowSettings);
      const columnIds = getModularPageLayoutMeta(legacyLayout).columns.map((column) => safeText(column.id) || 'col1');
      const containerSettings = normalizeContainerSettingsMap(section.containerSettings, columnIds);
      const normieColumnKeys = getNormieLayoutColumnKeys(legacyLayout);
      const cellBackgrounds = {};
      columnIds.forEach((colId, columnIndex) => {
        const normieKey = normieColumnKeys[columnIndex] || normieColumnKeys[0] || 'main';
        const settings = containerSettings[colId] || createDefaultContainerSettings();
        cellBackgrounds[normieKey] = backgroundSettingsForSave(
          normalizeBackgroundSettings(settings.background, settings.backgroundColor, settings.backgroundImageId)
        );
      });
      const normieModules = modulesForNormieSave(section, legacyLayout);
      const cellPadding = {};
      const cellBorderWidth = {};
      const cellBorderColor = {};
      const cellBorderRadius = {};
      const cellVerticalMargin = {};
      columnIds.forEach((colId, columnIndex) => {
        const normieKey = normieColumnKeys[columnIndex] || normieColumnKeys[0] || 'main';
        const settings = containerSettings[colId] || createDefaultContainerSettings();
        cellPadding[normieKey] = safeText(settings.padding) || '18';
        cellBorderWidth[normieKey] = safeNumericSetting(settings.borderThickness, '1');
        cellBorderColor[normieKey] = safeText(settings.borderColor) || '#d9e4ef';
        cellBorderRadius[normieKey] = safeText(settings.borderRadius) || '24';
        cellVerticalMargin[normieKey] = safeText(settings.margin) || '0';
      });
      return {
        ...section,
        layout: normieLayout,
        modules: normieModules,
        rowSettings: {
          ...rowSettings,
          background: backgroundSettingsForSave(rowSettings.background),
          overlayScreen: overlayScreenSettingsForSave(rowSettings.overlayScreen),
        },
        background: backgroundSettingsForSave(normalizeBackgroundSettings(rowSettings.background, rowSettings.backgroundColor)),
        overlayScreen: overlayScreenSettingsForSave(rowSettings.overlayScreen),
        cellBackgrounds,
        cellPadding,
        cellBorderWidth,
        cellBorderColor,
        cellBorderRadius,
        cellVerticalMargin,
      };
    });
  }

  function buildModularPageTemplatePreviewRecord() {
    flushActiveModularEditors();
    const draft = modularPageTemplateDraft && typeof modularPageTemplateDraft === 'object'
      ? modularPageTemplateDraft
      : {};
    const draftSections = draft.layoutSections;
    return {
      ...draft,
      id: safeText(byId('developPageTemplateEditorIdInput')?.value) || safeText(draft.id),
      name: safeText(byId('developPageTemplateEditorNameInput')?.value, 255) || safeText(draft.name),
      templateKind: 'modular',
      templateId: modularPageEditorMode === 'page'
        ? (safeText(byId('developPageTemplateEditorBaseTemplateSelect')?.value) || modularPageEditorSourceTemplateId || selectedTemplateId || LANDING_TEMPLATES[0].id)
        : (safeText(draft.templateId) || selectedTemplateId || LANDING_TEMPLATES[0].id),
      layoutSections: layoutSectionsForSave(draftSections),
    };
  }

  function syncModularPageDraftFromEditorInputs() {
    if (!modularPageTemplateDraft) return;
    const name = safeText(byId('developPageTemplateEditorNameInput')?.value, 255);
    if (name) modularPageTemplateDraft.name = name;
    const id = safeText(byId('developPageTemplateEditorIdInput')?.value);
    if (id) modularPageTemplateDraft.id = id;
  }

  function resolveLandingPageBaseTemplateId() {
    const modularTemplateId = safeText(byId('developPageTemplateEditorBaseTemplateSelect')?.value);
    const selectedModularTemplate = modularTemplateId ? getTemplateById(modularTemplateId) : null;
    if (safeText(selectedModularTemplate?.templateId)) {
      return safeText(selectedModularTemplate.templateId);
    }
    if (safeText(modularPageTemplateDraft?.templateId)) {
      return safeText(modularPageTemplateDraft.templateId);
    }
    return selectedTemplateId || LANDING_TEMPLATES[0].id;
  }

  function getModularLayoutColumnCount(layout) {
    return getModularPageLayoutColumnIds(getModularPageLayoutMeta(layout).value).length;
  }

  function countModulesInLayoutColumns(section) {
    const layout = resolveLegacySectionLayout(section);
    const columnIds = getModularPageLayoutColumnIds(layout);
    const counts = Object.fromEntries(columnIds.map((colId) => [colId, 0]));
    (Array.isArray(section?.modules) ? section.modules : []).forEach((module) => {
      const legacyCol = mapNormieColumnToLegacy(module?.column, layout);
      if (Object.prototype.hasOwnProperty.call(counts, legacyCol)) {
        counts[legacyCol] += 1;
      }
    });
    return counts;
  }

  function modulesLostColumnDistribution(draftSection, savedSection) {
    const layout = resolveLegacySectionLayout(draftSection);
    const columnIds = getModularPageLayoutColumnIds(layout);
    if (columnIds.length <= 1) return false;
    const draftCounts = countModulesInLayoutColumns(draftSection);
    const savedCounts = countModulesInLayoutColumns(savedSection);
    const draftSpread = columnIds.filter((colId) => draftCounts[colId] > 0).length;
    const savedSpread = columnIds.filter((colId) => savedCounts[colId] > 0).length;
    const moduleCount = (savedSection?.modules || []).length;
    return moduleCount > 1 && draftSpread > 1 && savedSpread <= 1;
  }

  function mergeModulePlacementsFromDraft(draftSection, savedSection) {
    const draftById = new Map(
      (Array.isArray(draftSection?.modules) ? draftSection.modules : [])
        .map((module) => [safeText(module?.id), module])
        .filter(([id]) => id)
    );
    const savedModules = Array.isArray(savedSection?.modules) ? savedSection.modules : [];
    const draftModules = Array.isArray(draftSection?.modules) ? draftSection.modules : [];
    const modules = savedModules.map((savedModule, moduleIndex) => {
      const moduleId = safeText(savedModule?.id);
      const draftModule = (moduleId && draftById.get(moduleId))
        || draftModules[moduleIndex]
        || null;
      if (!draftModule) return savedModule;
      const draftColumn = safeText(draftModule.column);
      if (!draftColumn) return savedModule;
      return { ...savedModule, column: draftColumn };
    });
    draftModules.forEach((draftModule, moduleIndex) => {
      const moduleId = safeText(draftModule?.id);
      if (moduleId && modules.some((module) => safeText(module?.id) === moduleId)) return;
      if (!moduleId && modules[moduleIndex]) {
        modules[moduleIndex] = { ...modules[moduleIndex], column: safeText(draftModule.column) || modules[moduleIndex].column };
        return;
      }
      if (moduleId && !modules.some((module) => safeText(module?.id) === moduleId)) {
        modules.push({ ...draftModule });
      }
    });
    const merged = normalizePageTemplateLayoutSections([{
      ...savedSection,
      modules,
    }]);
    return merged[0] || savedSection;
  }

  function mergeModularLayoutSectionsAfterSave(draftSections, savedSections) {
    const normalizedDraft = normalizePageTemplateLayoutSections(draftSections);
    const normalizedSaved = normalizePageTemplateLayoutSections(savedSections);
    if (!normalizedDraft.length) return normalizedSaved;
    if (!normalizedSaved.length) return normalizedDraft;
    const draftById = new Map(
      normalizedDraft.map((section) => [safeText(section.id), section]).filter(([id]) => id)
    );
    return normalizedSaved.map((savedSection, index) => {
      const draftSection = draftById.get(safeText(savedSection.id))
        || normalizedDraft[index]
        || null;
      if (!draftSection) return savedSection;
      let nextSection = savedSection;
      const savedColumns = getModularLayoutColumnCount(savedSection.layout);
      const draftColumns = getModularLayoutColumnCount(draftSection.layout);
      if (savedColumns < draftColumns) {
        const merged = normalizePageTemplateLayoutSections([{
          ...savedSection,
          layout: draftSection.layout,
          containerSettings: {
            ...(draftSection.containerSettings || {}),
            ...(savedSection.containerSettings || {}),
          },
          modules: Array.isArray(savedSection.modules) && savedSection.modules.length
            ? savedSection.modules
            : (draftSection.modules || []),
        }]);
        nextSection = merged[0] || savedSection;
      }
      return mergeModulePlacementsFromDraft(draftSection, nextSection);
    });
  }

  function setModularSaveButtonState(button, state, defaultLabel = 'Save Page') {
    if (!button) return;
    const labels = {
      idle: defaultLabel,
      saving: 'Saving…',
      success: 'Saved',
    };
    button.disabled = state === 'saving';
    button.classList.toggle('is-saving', state === 'saving');
    button.classList.toggle('is-success', state === 'success');
    button.classList.toggle('btn-primary', modularPageEditorMode === 'page' && state !== 'success');
    button.textContent = labels[state] || defaultLabel;
    if (state === 'success') {
      window.setTimeout(() => {
        if (!button.classList.contains('is-success')) return;
        setModularSaveButtonState(button, 'idle', defaultLabel);
      }, 1800);
    }
  }

  function getModularSaveButtonDefaultLabel(button) {
    if (button?.id === 'developLandingPageHeaderSaveBtn') {
      return modularPageEditorMode === 'page' ? 'Save Page' : 'Save Template';
    }
    return modularPageEditorMode === 'page' ? 'Save Page' : 'Save Modular Template';
  }

  async function refreshAfterModularPageSave() {
    if (modularPageEditorMode === 'page') {
      await loadSavedLandingPages();
      renderLandingPagesTable();
      return;
    }
    await loadSavedPageTemplates();
    renderPageTemplateRecordsTable();
  }

  async function saveModularPageRecord(triggerButton) {
    flushActiveModularEditors();
    syncModularPageDraftFromEditorInputs();
    const defaultLabel = getModularSaveButtonDefaultLabel(triggerButton);
    const payload = modularPageEditorMode === 'page'
      ? buildModularLandingPagePayload()
      : buildModularPageTemplatePayload();
    if (!payload) {
      notify('Nothing to save', true);
      return false;
    }

    if (modularPageEditorOptions && typeof modularPageEditorOptions.onSave === 'function') {
      setModularSaveButtonState(triggerButton, 'saving', defaultLabel);
      try {
        await Promise.resolve(modularPageEditorOptions.onSave(payload));
        setModularSaveButtonState(triggerButton, 'success', defaultLabel);
        notify(modularPageEditorMode === 'page' ? 'Page saved' : 'Template saved');
        closeModularPageTemplateEditor();
        return true;
      } catch (err) {
        setModularSaveButtonState(triggerButton, 'idle', defaultLabel);
        notify(err.message || 'Error executing custom save handler', true);
        return false;
      }
    }

    if (!payload.name) {
      notify(modularPageEditorMode === 'page' ? 'Page name is required' : 'Template name is required', true);
      return false;
    }

    setModularSaveButtonState(triggerButton, 'saving', defaultLabel);
    const saveButtons = [
      byId('developPageTemplateEditorSaveBtnTop'),
      byId('developPageTemplateEditorSaveBtnBottom'),
      byId('developLandingPageHeaderSaveBtn'),
    ].filter(Boolean);
    saveButtons.forEach((button) => {
      if (button !== triggerButton) button.disabled = true;
    });

    const draftSectionsSnapshot = normalizePageTemplateLayoutSections(
      modularPageTemplateDraft?.layoutSections
    );

    try {
      const hasId = Boolean(safeText(payload.id));
      const endpoint = modularPageEditorMode === 'page'
        ? (hasId
          ? `/api/develop/landing-pages/${encodeURIComponent(payload.id)}`
          : '/api/develop/landing-pages')
        : (hasId
          ? `/api/develop/page-templates/${encodeURIComponent(payload.id)}`
          : '/api/develop/page-templates');
      const method = hasId ? 'PATCH' : 'POST';
      const result = await api(endpoint, { method, body: JSON.stringify(payload) });
      const saved = result?.landingPage || result?.page || result?.pageTemplate || result?.data || payload;
      const savedSections = getModularEditorLayoutSections(saved);
      const mergedSections = mergeModularLayoutSectionsAfterSave(draftSectionsSnapshot, savedSections);
      modularPageTemplateDraft = applyLandingPageDefaultSelections({
        ...modularPageTemplateDraft,
        ...saved,
        templateKind: 'modular',
        layoutSections: mergedSections.length ? mergedSections : draftSectionsSnapshot,
      });
      if (byId('developPageTemplateEditorIdInput') && saved?.id) {
        byId('developPageTemplateEditorIdInput').value = String(saved.id);
      }
      await refreshAfterModularPageSave();
      syncPageTemplateEditorInputs();
      renderModularPageTemplateEditor();
      setPageTemplateEditorVisible(true);
      const successMessage = modularPageEditorMode === 'page'
        ? (hasId ? 'Page updated' : 'Page created')
        : (hasId ? 'Modular page template updated' : 'Modular page template created');
      notify(successMessage);
      setModularSaveButtonState(triggerButton, 'success', defaultLabel);
      return true;
    } catch (err) {
      notify(err.message || (modularPageEditorMode === 'page' ? 'Could not save page' : 'Could not save modular page template'), true);
      setModularSaveButtonState(triggerButton, 'idle', defaultLabel);
      return false;
    } finally {
      saveButtons.forEach((button) => {
        if (button !== triggerButton) button.disabled = false;
      });
    }
  }

  function buildModularPageTemplatePayload() {
    flushActiveModularEditors();
    syncModularPageDraftFromEditorInputs();
    const draftSections = modularPageTemplateDraft?.layoutSections;
    return {
      id: safeText(byId('developPageTemplateEditorIdInput')?.value) || safeText(modularPageTemplateDraft?.id),
      name: safeText(byId('developPageTemplateEditorNameInput')?.value, 255)
        || safeText(modularPageTemplateDraft?.name, 255),
      templateKind: 'modular',
      templateId: modularPageEditorMode === 'page'
        ? resolveLandingPageBaseTemplateId()
        : (safeText(modularPageTemplateDraft?.templateId) || selectedTemplateId || LANDING_TEMPLATES[0].id),
      layoutSections: layoutSectionsForSave(draftSections),
      contentOverrides: {},
      primaryColor: '',
      backgroundColor: '',
      accentColor: '',
      formId: '',
      leadMagnetId: '',
      headlineId: '',
      pitchId: '',
      ctaId: '',
      websiteBannerImageId: '',
      backgroundImageId: '',
      featureImageId: '',
      highlightImageId: '',
      featureHeadlineId: '',
      featureSubheadingId: '',
      featureTitle: '',
      featureCopy: '',
      highlightHeadlineId: '',
      highlightPitchId: '',
      highlightTitle: '',
      highlightCopy: '',
      bodyHeadlineId: '',
      bodySubheadingId: '',
      bodyPitchId: '',
      logoWideId: '',
      logoSquareId: '',
    };
  }

  function buildModularLandingPagePayload() {
    return buildModularPageTemplatePayload();
  }

  function buildModularPageTemplatePreviewMarkup(template) {
    const sections = getModularEditorLayoutSections(template);
    const renderModule = (module) => {
      const type = safeText(module.type);
      const contentLabel = escapeHtml(getModularModuleContentLabel(module));
      if (type === 'header' || type === 'heading') return `<h2>${contentLabel}</h2>`;
      if (type === 'textarea' || isModularTextBlockModule(module)) {
        const inlineStyle = buildModularTextBlockInlineStyle(module.settings);
        const html = getModularTextBlockHtml(module) || '<p>No text set</p>';
        return `<div${inlineStyle ? ` style="${inlineStyle}"` : ''}>${html}</div>`;
      }
      if (type === 'form') return `<div class="develop-template-form-card"><h3>${contentLabel}</h3><input type="text" placeholder="First Name" /><input type="email" placeholder="Email" /><button type="button">Submit Form</button></div>`;
      if (type === 'image' || type === 'logo-wide' || type === 'logo-square') return `<div class="develop-template-image-slot">${contentLabel}</div>`;
      if (type === 'headline') return `<h3>${contentLabel}</h3>`;
      if (type === 'subheading') return `<h4>${contentLabel}</h4>`;
      if (type === 'pitch' || type === 'text') return `<p>${contentLabel}</p>`;
      if (type === 'cta') return `<div class="develop-template-cta-row"><button type="button">${contentLabel}</button></div>`;
      if (type === 'eyebrow') return `<div class="develop-template-eyebrow">${contentLabel}</div>`;
      if (type === 'spacer') return `<div style="height:1.25rem;"></div>`;
      if (type === 'navigation') {
        return App.developNavMenu?.buildNavigationModuleMarkup?.(module.settings || {}, { includeDataAttrs: true })
          || `<div class="meta">${contentLabel}</div>`;
      }
      if (type === 'pod') {
        const podData = buildModularPageModuleContent({}, module);
        const clickAction = podData.targetPage ? `onclick="if(window.App && App.setActivePage) App.setActivePage('${escapeHtml(podData.targetPage)}');"` : '';
        return `
          <div class="pod card-hover" ${clickAction}>
            <div class="pod-icon-col"><img src="${escapeHtml(podData.logoUrl)}" class="pod-logo" alt="${escapeHtml(podData.title)} Logo" /></div>
            <div class="pod-content">
              <h3>${escapeHtml(podData.title)}</h3>
              <p>${escapeHtml(podData.description)}</p>
            </div>
          </div>
        `;
      }
      if (type === 'system-app') {
        const mountId = safeText(module.content || module.systemId);
        const liveMountId = `mount-${mountId}`;
        
        let projection = '';
        const liveNode = document.getElementById(liveMountId);
        if (liveNode) {
          const clone = liveNode.cloneNode(true);
          clone.id = '';
          const subIds = clone.querySelectorAll('[id]');
          for (let i = 0; i < subIds.length; i++) subIds[i].id = '';
          projection = `<div class="system-app-preview-wrap" style="pointer-events: none; opacity: 0.95;">${clone.innerHTML}</div>`;
        }
        
        return `<div id="${liveMountId}">${projection}</div>`;
      }
      return `<div class="meta">${contentLabel}</div>`;
    };
    const renderColumn = (modules, className, settings) => {
      const body = modules.length
        ? modules.map(renderModule).join('')
        : '<div class="develop-modular-page-column-empty">Empty container</div>';
      return `<div class="${className}" style="${escapeHtml(styleObjectToCssText(buildContainerStyle(settings)))}">${body}</div>`;
    };
    const markup = sections.map((section) => {
      const layout = getModularPageLayoutMeta(section.layout);
      const columnMarkup = layout.columns.map((column) => {
        const columnId = safeText(column.id) || 'col1';
        const modules = getModularSectionModulesForColumn(section, columnId);
      return renderColumn(
          modules,
          `develop-modular-page-column develop-modular-page-column-${columnId}`,
          getSectionContainerSettings(section, columnId)
        );
      }).join('');
      return buildModularPageSectionMarkup(
        section,
        `${section.title ? `<div class="develop-template-eyebrow">${escapeHtml(section.title)}</div>` : ''}<div class="develop-modular-page-columns" style="grid-template-columns:${buildModularPageGridTemplate(layout.value)};">${columnMarkup}</div>`,
        layout.value
      );
    }).join('');
    return `<div class="develop-template-canvas develop-modular-page-preview">${markup}</div>`;
  }

  function openModularPageTemplatePreviewModal(template) {
    if (!template) return;
    const title = safeText(template.name) || 'Modular Page Template Preview';
    const pageMarkup = buildModularLandingPageMarkup(template, { skipTemplateMerge: true });
    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        background: #f5f8fb;
        color: #173c61;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .develop-preview-page {
        min-height: 100vh;
        padding: 0;
      }
      .develop-preview-page__shell {
        width: 100%;
      }
      .develop-preview-page__bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        margin-bottom: 18px;
        padding: 24px 24px 0;
      }
      .develop-preview-page__bar-main {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
        align-items: center;
        gap: 1rem;
        flex: 1 1 auto;
        min-width: 0;
      }
      .develop-preview-page__bar-main::after {
        content: "";
        display: block;
        min-width: 0;
      }
      .develop-preview-page__bar-copy {
        min-width: 0;
        margin-right: 1.1rem;
        grid-column: 1;
      }
      .develop-preview-page__title {
        margin: 0;
        font-size: 1.4rem;
        font-weight: 800;
      }
      .develop-preview-page__hint {
        margin: 0.35rem 0 0;
        color: #587592;
      }
      .develop-preview-page__close {
        border: 1px solid rgba(15, 79, 143, 0.16);
        background: #ffffff;
        color: #173c61;
        border-radius: 999px;
        padding: 0.75rem 1rem;
        font-weight: 700;
        cursor: pointer;
      }
      .develop-preview-page__controls {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        flex-wrap: wrap;
        justify-content: center;
        grid-column: 2;
      }
      .develop-preview-page__control-label {
        margin: 0 0 0.35rem;
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #587592;
      }
      .develop-preview-device-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      .develop-preview-device-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        border: 1px solid rgba(15, 79, 143, 0.16);
        background: #ffffff;
        color: #173c61;
        border-radius: 999px;
        padding: 0.48rem 0.74rem;
        font: inherit;
        font-weight: 700;
        font-size: 0.92rem;
        cursor: pointer;
        box-shadow: 0 8px 18px rgba(15, 55, 90, 0.06);
        transition: transform 140ms ease, box-shadow 140ms ease, background 140ms ease, color 140ms ease, border-color 140ms ease;
      }
      .develop-preview-device-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 12px 22px rgba(15, 55, 90, 0.1);
      }
      .develop-preview-device-btn.is-active {
        background: #173c61;
        border-color: #173c61;
        color: #f7fbff;
      }
      .develop-preview-device-btn svg {
        width: 16px;
        height: 16px;
        stroke: currentColor;
        fill: none;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .develop-preview-stage {
        min-height: calc(100vh - 214px);
        display: grid;
        place-items: start center;
        padding: 10px 0 32px;
      }
      .develop-preview-page[data-device-mode="desktop"] .develop-preview-stage,
      .develop-preview-page[data-device-mode="full"] .develop-preview-stage {
        border-top: 6px solid #173c61;
        padding-top: 18px;
      }
      .develop-preview-device-wrap {
        width: 100%;
        display: grid;
        justify-items: center;
      }
      .develop-preview-device-shell {
        --device-width: min(100%, 1280px);
        --device-ratio: 0.625;
        width: var(--device-width);
        max-width: 100%;
        transition: width 180ms ease;
      }
      .develop-preview-device-shell[data-device="mobile-portrait"] {
        --device-width: min(100%, 430px);
        --device-ratio: 2.08;
      }
      .develop-preview-device-shell[data-device="mobile-landscape"] {
        --device-width: min(100%, 780px);
        --device-ratio: 0.52;
      }
      .develop-preview-device-shell[data-device="tablet"] {
        --device-width: min(100%, 980px);
        --device-ratio: 1.35;
      }
      .develop-preview-device-shell[data-device="desktop"] {
        --device-width: 100%;
        --device-ratio: 0.72;
      }
      .develop-preview-device-shell[data-device="full"] {
        --device-width: 100%;
        --device-ratio: auto;
      }
      .develop-preview-device-frame {
        position: relative;
        padding: 16px;
        border-radius: 34px;
        background:
          linear-gradient(145deg, rgba(22, 31, 44, 0.92) 0%, rgba(66, 74, 88, 0.96) 100%);
        box-shadow:
          0 26px 56px rgba(6, 20, 34, 0.24),
          inset 0 2px 0 rgba(255, 255, 255, 0.16),
          inset 0 -18px 28px rgba(0, 0, 0, 0.18);
      }
      .develop-preview-device-shell[data-device="desktop"] .develop-preview-device-frame,
      .develop-preview-device-shell[data-device="full"] .develop-preview-device-frame {
        padding: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
      }
      .develop-preview-device-shell[data-device="full"] .develop-preview-device-frame {
        background: transparent;
        box-shadow: none;
        padding: 0;
      }
      .develop-preview-device-shell[data-device="desktop"] .develop-preview-device-frame::after {
        display: none;
      }
      .develop-preview-device-shell[data-device="mobile-portrait"] .develop-preview-device-frame::before,
      .develop-preview-device-shell[data-device="mobile-landscape"] .develop-preview-device-frame::before,
      .develop-preview-device-shell[data-device="tablet"] .develop-preview-device-frame::before {
        content: "";
        position: absolute;
        top: 8px;
        left: 50%;
        transform: translateX(-50%);
        width: 24%;
        height: 8px;
        border-radius: 999px;
        background: rgba(14, 17, 21, 0.92);
      }
      .develop-preview-device-screen {
        position: relative;
        overflow: hidden;
        background: #eef5fb;
        border-radius: 24px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2);
      }
      .develop-preview-device-shell[data-device="desktop"] .develop-preview-device-screen,
      .develop-preview-device-shell[data-device="full"] .develop-preview-device-screen {
        border-radius: 0;
      }
      .develop-preview-device-shell[data-device="full"] .develop-preview-device-screen {
        border: none;
        box-shadow: none;
      }
      .develop-preview-device-shell[data-device="desktop"] .develop-preview-device-screen {
        border: none;
        box-shadow: none;
      }
      .develop-preview-device-shell[data-device="full"] .develop-preview-device-screen::before,
      .develop-preview-device-shell[data-device="full"] .develop-preview-device-screen::after {
        display: none;
      }
      .develop-preview-device-shell[data-device="mobile-landscape"] .develop-preview-device-screen::before,
      .develop-preview-device-shell[data-device="tablet"] .develop-preview-device-screen::before,
      .develop-preview-device-shell[data-device="mobile-portrait"] .develop-preview-device-screen::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
      }
      .develop-preview-device-shell[data-device="mobile-portrait"] .develop-preview-device-screen {
        aspect-ratio: 9 / 19;
      }
      .develop-preview-device-shell[data-device="mobile-landscape"] .develop-preview-device-screen {
        aspect-ratio: 19 / 9;
      }
      .develop-preview-device-shell[data-device="tablet"] .develop-preview-device-screen {
        aspect-ratio: 10 / 13;
      }
      .develop-preview-device-shell[data-device="desktop"] .develop-preview-device-screen {
        aspect-ratio: 16 / 10;
      }
      .develop-preview-device-shell[data-device="full"] .develop-preview-device-screen {
        aspect-ratio: auto;
      }
      .develop-preview-device-scroll {
        width: 100%;
        height: 100%;
        overflow: auto;
        background: #ffffff;
      }
      .develop-preview-device-shell[data-device="full"] .develop-preview-device-scroll {
        min-height: calc(100vh - 220px);
      }
      .develop-preview-page__viewport {
        width: 100%;
        min-height: 100%;
      }
      .develop-template-canvas {
        --lp-primary: #0b82d4;
        --lp-background: #f5fbff;
        --lp-accent: #1a4f81;
        --lp-page-background-image: none;
        --lp-page-background-overlay: none;
        --lp-page-background-size: cover;
        --lp-page-background-position: center center;
        --lp-page-background-repeat: no-repeat;
        min-height: calc(100vh - 120px);
        padding: 0;
        border: none;
        border-radius: 0;
        box-shadow: none;
        background-color: var(--lp-background, #f5fbff);
        background-image:
          var(--lp-page-background-overlay, none),
          var(--lp-page-background-image, none);
        background-size: var(--lp-page-background-size, cover), var(--lp-page-background-size, cover);
        background-position: var(--lp-page-background-position, center center), var(--lp-page-background-position, center center);
        background-repeat: var(--lp-page-background-repeat, no-repeat), var(--lp-page-background-repeat, no-repeat);
      }
      .develop-preview-device-shell[data-device="mobile-portrait"] .develop-template-canvas,
      .develop-preview-device-shell[data-device="mobile-landscape"] .develop-template-canvas,
      .develop-preview-device-shell[data-device="tablet"] .develop-template-canvas,
      .develop-preview-device-shell[data-device="desktop"] .develop-template-canvas {
        min-height: 100%;
        border-radius: 0;
        box-shadow: none;
      }
      .develop-preview-device-shell[data-device="full"] .develop-template-canvas {
        min-height: calc(100vh - 220px);
      }
      .develop-modular-page-preview {
        display: grid;
        gap: 1rem;
      }
      .develop-modular-page-section {
        border: none;
        border-radius: 0;
        padding: 0;
      }
      .develop-modular-page-columns {
        display: grid;
        gap: 0.9rem;
      }
      .develop-modular-page-column {
        display: grid;
        gap: 0.7rem;
      }
      .develop-modular-page-column-empty {
        min-height: 96px;
        display: grid;
        place-items: center;
        border: 2px dashed rgba(15, 79, 143, 0.18);
        border-radius: 12px;
        background: rgba(240, 248, 255, 0.32);
        color: #587592;
        font-weight: 700;
        text-align: center;
        padding: 1rem;
      }
      .develop-template-table-slot .develop-module-table {
        border-collapse: collapse;
        border-spacing: 0;
        background: transparent;
      }
      .develop-template-table-slot .develop-module-table th,
      .develop-template-table-slot .develop-module-table td {
        border: 0 !important;
        border-width: 0 !important;
        border-style: none !important;
        border-bottom: 0 !important;
        outline: none;
        box-shadow: none;
        background: transparent;
        color: inherit;
        font-weight: inherit;
        cursor: default;
        user-select: auto;
        white-space: normal;
        vertical-align: middle;
      }
      .develop-template-table-slot .develop-module-table[data-zero-border="true"] th,
      .develop-template-table-slot .develop-module-table[data-zero-border="true"] td {
        border: 0 !important;
        border-width: 0 !important;
        border-style: none !important;
        border-bottom-width: 0 !important;
      }
      .develop-template-table-slot .develop-module-table thead tr th {
        background: inherit;
        color: inherit;
        font-weight: inherit;
        border-bottom-width: 0;
      }
      .develop-template-eyebrow {
        margin-bottom: 0.6rem;
        color: #315879;
        font-size: 0.82rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .develop-template-cta-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }
      .develop-template-cta-row button,
      .develop-template-form-card button {
        border: 0;
        border-radius: 12px;
        background: #2c7cd6;
        color: #ffffff;
        font-weight: 700;
        padding: 0.9rem 1.15rem;
        cursor: pointer;
      }
      .develop-template-form-card {
        display: grid;
        gap: 0.75rem;
        padding: 1rem;
        border-radius: 16px;
        background: rgba(245, 251, 255, 0.94);
        border: 1px solid rgba(15, 79, 143, 0.12);
      }
      .develop-template-form-card h3,
      .develop-modular-page-preview h3,
      .develop-modular-page-preview h4,
      .develop-modular-page-preview p {
        margin: 0;
      }
      .develop-template-form-card input,
      .develop-template-form-card textarea {
        width: 100%;
        border: 1px solid rgba(15, 79, 143, 0.16);
        border-radius: 10px;
        padding: 0.85rem 0.95rem;
        font: inherit;
        background: #ffffff;
      }
      .develop-template-image-slot,
      .develop-template-video-slot {
        display: block;
        border-radius: 0;
        border: none;
        background: transparent;
        color: #35516c;
        font-weight: 700;
        padding: 0;
        text-align: center;
        overflow: hidden;
      }
      .develop-template-image-slot {
        min-height: 0;
      }
      .develop-template-video-slot {
        min-height: 140px;
      }
      .develop-template-image-slot img {
        width: 100%;
        height: auto;
        max-width: 100%;
        object-fit: contain;
        display: block;
        margin: 0 auto;
      }
      .develop-template-video-slot {
        aspect-ratio: 16 / 9;
      }
      .develop-template-video-slot video,
      .develop-template-video-slot iframe {
        display: block;
        width: 100%;
        height: 100%;
        max-width: 100%;
        border: 0;
        object-fit: cover;
      }
      /* Website navigation module (matches src/css/legacy.css) */
      .site-nav {
        display: flex;
        flex-wrap: wrap;
        align-items: stretch;
        gap: 4px;
        padding: 8px;
        border-radius: 20px;
        background: rgba(255, 255, 255, 0.82);
        border: 1px solid rgba(15, 79, 143, 0.12);
        box-shadow: 0 10px 28px rgba(15, 55, 90, 0.08);
      }
      .site-nav--vertical {
        flex-direction: column;
        align-items: stretch;
      }
      .site-nav-menu,
      .site-nav-submenu,
      .site-nav ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .site-nav-menu {
        display: flex;
        flex: 1 1 auto;
        flex-wrap: wrap;
        gap: 4px;
        align-items: stretch;
        min-width: 0;
      }
      .site-nav-menu--vertical {
        flex-direction: column;
        align-items: stretch;
      }
      .site-nav-submenu {
        margin-top: 0.35rem;
        padding: 0.35rem 0 0;
        display: grid;
        gap: 0.2rem;
      }
      .site-nav-menu--horizontal .site-nav-item--has-children {
        position: relative;
      }
      .site-nav-menu--horizontal .site-nav-submenu {
        position: absolute;
        top: calc(100% - 2px);
        left: 0;
        z-index: 4;
        min-width: 180px;
        padding: 0.45rem;
        border: 1px solid rgba(15, 79, 143, 0.14);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.98);
        box-shadow: 0 14px 32px rgba(15, 55, 90, 0.16);
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transform: translateY(4px);
        transition: opacity 140ms ease, transform 140ms ease, visibility 140ms ease;
      }
      .site-nav-menu--horizontal .site-nav-item--has-children:hover > .site-nav-submenu,
      .site-nav-menu--horizontal .site-nav-item--has-children:focus-within > .site-nav-submenu {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
        transform: translateY(0);
      }
      .site-nav-item {
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        align-items: stretch;
      }
      .site-nav-menu--horizontal > .site-nav-item {
        flex: 0 0 auto;
      }
      .site-nav-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.35rem;
        min-height: 40px;
        padding: var(--site-nav-link-padding, 8px 12px);
        border-radius: var(--site-nav-link-radius, 12px);
        color: var(--site-nav-link-color, #173c61);
        text-decoration: none;
        font-weight: 600;
        white-space: nowrap;
        transition: background 140ms ease, color 140ms ease, transform 140ms ease;
      }
      .site-nav-link:hover,
      .site-nav-link:focus-visible {
        background: var(--site-nav-link-hover-bg, #e8f4ff);
        color: var(--site-nav-link-hover-color, #0b82d4);
        transform: translateY(-1px);
      }
      .site-nav-submenu-indicator {
        font-size: 0.75rem;
        opacity: 0.75;
      }
      .site-nav-empty {
        margin: 0;
        padding: 0.75rem 1rem;
        color: #587592;
        font-size: 0.9rem;
      }
      .meta {
        color: #587592;
      }
      @media (max-width: 900px) {
        .develop-preview-page__bar {
          padding: 16px 16px 0;
          flex-direction: column;
          align-items: flex-start;
        }
        .develop-preview-page__bar-main {
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }
        .develop-preview-page__bar-main::after {
          display: none;
        }
        .develop-preview-page__controls {
          width: 100%;
          justify-content: flex-start;
        }
        .develop-modular-page-columns {
          grid-template-columns: 1fr !important;
        }
      }
    </style>
  </head>
  <body>
    <div class="develop-preview-page" data-device-mode="desktop" id="developPreviewPageRoot">
      <div class="develop-preview-page__shell">
        <div class="develop-preview-page__bar">
          <div class="develop-preview-page__bar-main">
            <div class="develop-preview-page__bar-copy">
              <h1 class="develop-preview-page__title">${escapeHtml(title)}</h1>
              <p class="develop-preview-page__hint">Full-page modular template preview</p>
            </div>
            <div class="develop-preview-page__controls">
              <div>
                <p class="develop-preview-page__control-label">Preview Mode</p>
                <div class="develop-preview-device-bar" role="tablist" aria-label="Preview device modes">
                  <button type="button" class="develop-preview-device-btn is-active" data-device="desktop" role="tab" aria-selected="true">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1.8"></rect><path d="M8 20h8"></path><path d="M12 16v4"></path></svg>
                    <span>Desktop</span>
                  </button>
                  <button type="button" class="develop-preview-device-btn" data-device="mobile-portrait" role="tab" aria-selected="false">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5"></rect><path d="M11 18.5h2"></path></svg>
                    <span>Mobile</span>
                  </button>
                  <button type="button" class="develop-preview-device-btn" data-device="mobile-landscape" role="tab" aria-selected="false">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="7" width="19" height="10" rx="2.5"></rect><path d="M18.5 11v2"></path></svg>
                    <span>Landscape</span>
                  </button>
                  <button type="button" class="develop-preview-device-btn" data-device="tablet" role="tab" aria-selected="false">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="2.5" width="13" height="19" rx="2.4"></rect><path d="M11 18.5h2"></path></svg>
                    <span>Tablet</span>
                  </button>
                  <button type="button" class="develop-preview-device-btn" data-device="full" role="tab" aria-selected="false">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4v4"></path><path d="M16 4h4v4"></path><path d="M8 20H4v-4"></path><path d="M16 20h4v-4"></path></svg>
                    <span>Full</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
          <button type="button" class="develop-preview-page__close" onclick="window.close()">Close Preview</button>
        </div>
        <div class="develop-preview-stage">
          <div class="develop-preview-device-wrap">
            <div class="develop-preview-device-shell" data-device="desktop" id="developPreviewDeviceShell">
              <div class="develop-preview-device-frame">
                <div class="develop-preview-device-screen">
                  <div class="develop-preview-device-scroll">
                    <div class="develop-preview-page__viewport">
                      ${pageMarkup}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <script>
      (function () {
        const root = document.getElementById('developPreviewPageRoot');
        const shell = document.getElementById('developPreviewDeviceShell');
        const buttons = Array.from(document.querySelectorAll('.develop-preview-device-btn'));
        if (!root || !shell || !buttons.length) return;
        buttons.forEach((button) => {
          button.addEventListener('click', () => {
            const device = button.getAttribute('data-device') || 'mobile-portrait';
            root.setAttribute('data-device-mode', device);
            shell.setAttribute('data-device', device);
            buttons.forEach((candidate) => {
              const active = candidate === button;
              candidate.classList.toggle('is-active', active);
              candidate.setAttribute('aria-selected', active ? 'true' : 'false');
            });
          });
        });
      }());
    </script>
  </body>
</html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const previewUrl = URL.createObjectURL(blob);
    const previewWindow = window.open(previewUrl, '_blank');
    if (!previewWindow) {
      URL.revokeObjectURL(previewUrl);
      notify('Could not open preview tab. Please allow pop-ups for this site.', true);
      return;
    }
    window.setTimeout(() => {
      URL.revokeObjectURL(previewUrl);
    }, 60000);
  }

  function renderFormTemplateLibrary() {
    const host = byId('developFormTemplatesLibrary');
    if (!host) return;
    host.textContent = '';
    FORM_TEMPLATES.forEach((template) => {
      const card = document.createElement('article');
      card.className = `develop-template-library-card${template.id === selectedFormTemplateId ? ' is-selected' : ''}`;
      const copyWrap = document.createElement('div');
      copyWrap.className = 'develop-template-library-copy';
      const mediaWrap = document.createElement('div');
      mediaWrap.className = 'develop-template-library-media';
      const fParser = new DOMParser();
      const fDoc = fParser.parseFromString(`
        <div class="develop-template-preview-frame" aria-hidden="true">
          <div class="develop-template-preview-scale">
            ${buildFormTemplatePreviewMarkup(template)}
          </div>
        </div>
      `, 'text/html');
      mediaWrap.textContent = '';
      Array.from(fDoc.body.childNodes).forEach(n => mediaWrap.appendChild(n.cloneNode(true)));
      const title = document.createElement('h3');
      title.textContent = template.name;
      const summary = document.createElement('p');
      summary.textContent = `${template.fields.length} fields · ${template.defaultSubmitLabel}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = template.id === selectedFormTemplateId ? 'Selected' : 'Use Template';
      button.addEventListener('click', () => {
        selectedFormTemplateId = template.id;
        renderFormTemplateLibrary();
        renderFormTemplatePreview(template.id);
      });
      const launchBtn = document.createElement('button');
      launchBtn.type = 'button';
      launchBtn.textContent = 'Open In Form Builder';
      launchBtn.addEventListener('click', () => {
        selectedFormTemplateId = template.id;
        renderFormTemplateLibrary();
        renderFormTemplatePreview(template.id);
        App.setActivePage('developFormsPage');
        openCreateFormEditor(template.id);
      });
      copyWrap.appendChild(title);
      copyWrap.appendChild(summary);
      copyWrap.appendChild(button);
      copyWrap.appendChild(launchBtn);
      card.appendChild(copyWrap);
      card.appendChild(mediaWrap);
      host.appendChild(card);
    });
  }

  function buildTemplatePreviewMarkup(template, canvasClass = '') {
    return `
      <div class="develop-template-canvas${canvasClass ? ` ${canvasClass}` : ''}">
        <div class="develop-template-banner">Page Banner Image</div>
        <div class="develop-template-hero">
          <div class="develop-template-copy">
            <div class="develop-template-eyebrow">${template.eyebrow}</div>
            <h3>${template.headline}</h3>
            <p>${template.lead}</p>
            <div class="develop-template-cta-row">
              <button type="button">${template.primaryCta}</button>
              <button type="button" class="develop-template-secondary-btn">${template.secondaryCta}</button>
            </div>
            <div class="develop-template-feature-grid">
              <div class="develop-template-feature-card">
                <div class="develop-template-image-slot">Feature Image</div>
                <h4>${template.featureOneTitle}</h4>
                <p>${template.featureOneCopy}</p>
              </div>
              <div class="develop-template-feature-card">
                <div class="develop-template-image-slot">Logo - Wide</div>
                <h4>${template.featureTwoTitle}</h4>
                <p>${template.featureTwoCopy}</p>
              </div>
            </div>
          </div>
          <aside class="develop-template-form-card">
            <div class="develop-template-logo-row">
              <div class="develop-template-logo-slot develop-template-logo-wide">Logo - Wide</div>
              <div class="develop-template-logo-slot develop-template-logo-square">Logo - Square</div>
            </div>
            <h3>${template.formTitle}</h3>
            <p>${template.formCopy}</p>
            <input type="text" placeholder="First Name" />
            <input type="email" placeholder="Email Address" />
            <input type="text" placeholder="Company" />
            <textarea rows="4" placeholder="What are you looking for?"></textarea>
            <button type="button">Submit Form</button>
          </aside>
        </div>
        <div class="develop-template-content">
          <div class="develop-template-body-copy">
            <h3>${template.bodyTitle}</h3>
            <p>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt
              ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco
              laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in
              voluptate velit esse cillum dolore eu fugiat nulla pariatur.
            </p>
            <p>
              Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit
              anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium
              doloremque laudantium, totam rem aperiam.
            </p>
          </div>
          <div class="develop-template-side-image">Background Image / Supporting Visual</div>
        </div>
      </div>
    `;
  }

  function renderTemplateLibrary() {
    const host = byId('developTemplatesLibrary');
    if (!host) return;

    host.textContent = '';
    LANDING_TEMPLATES.forEach((template) => {
      const card = document.createElement('article');
      card.className = `develop-template-library-card${template.id === selectedTemplateId ? ' is-selected' : ''}`;

      const copyWrap = document.createElement('div');
      copyWrap.className = 'develop-template-library-copy';

      const mediaWrap = document.createElement('div');
      mediaWrap.className = 'develop-template-library-media';
      const lParser = new DOMParser();
      const lDoc = lParser.parseFromString(`
        <div class="develop-template-preview-frame" aria-hidden="true">
          <div class="develop-template-preview-scale">
            ${buildTemplatePreviewMarkup(template, 'develop-template-canvas-mini')}
          </div>
        </div>
      `, 'text/html');
      mediaWrap.textContent = '';
      Array.from(lDoc.body.childNodes).forEach(n => mediaWrap.appendChild(n.cloneNode(true)));

      const title = document.createElement('h3');
      title.textContent = template.name;

      const summary = document.createElement('p');
      summary.textContent = template.summary;

      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = template.id === selectedTemplateId ? 'Selected' : 'Use Template';
      button.addEventListener('click', () => {
        selectedTemplateId = template.id;
        renderTemplateLibrary();
        renderTemplatePreview(template.id);
        const landingTemplateSelect = byId('developLandingTemplateSelect');
        if (landingTemplateSelect) landingTemplateSelect.value = template.id;
      });
      const launchBtn = document.createElement('button');
      launchBtn.type = 'button';
      launchBtn.textContent = 'Open In Page Builder';
      launchBtn.addEventListener('click', () => {
        selectedTemplateId = template.id;
        renderTemplateLibrary();
        renderTemplatePreview(template.id);
        const landingTemplateSelect = byId('developLandingTemplateSelect');
        if (landingTemplateSelect) landingTemplateSelect.value = template.id;
        openCreateLandingPage();
        setTimeout(() => {
          const select = byId('developLandingTemplateSelect');
          if (select) select.value = template.id;
        }, 120);
      });
      const manageBtn = document.createElement('button');
      manageBtn.type = 'button';
      manageBtn.textContent = 'Open Pages Gateway';
      manageBtn.addEventListener('click', () => {
        App.setActivePage('developManageLandingPagesPage');
      });

      copyWrap.appendChild(title);
      copyWrap.appendChild(summary);
      copyWrap.appendChild(button);
      copyWrap.appendChild(launchBtn);
      copyWrap.appendChild(manageBtn);
      card.appendChild(copyWrap);
      card.appendChild(mediaWrap);
      host.appendChild(card);
    });
  }

  async function loadLandingPageBuilderOptions() {
    const landingTemplateSelectEl = byId('developLandingTemplateSelect');
    const [assetsResult, headlinesResult, subheadingsResult, pitchesResult, ctasResult] = await Promise.allSettled([
      api('/api/assets'),
      api('/api/messaging/headlines?limit=200'),
      api('/api/messaging/subheadings?limit=200'),
      api('/api/messaging/pitches?limit=200'),
      api('/api/messaging/ctas?limit=200'),
    ]);

    if (assetsResult.status !== 'fulfilled') {
      throw assetsResult.reason || new Error('Could not load assets');
    }

    state.assets = assetsResult.value.assets || [];

    landingPageHeadlines = headlinesResult.status === 'fulfilled'
      ? (Array.isArray(headlinesResult.value.headlines) ? headlinesResult.value.headlines : [])
      : [];
    landingPageSubheadings = subheadingsResult.status === 'fulfilled'
      ? (Array.isArray(subheadingsResult.value.subheadings) ? subheadingsResult.value.subheadings : [])
      : [];
    landingPagePitches = pitchesResult.status === 'fulfilled'
      ? (Array.isArray(pitchesResult.value.pitches) ? pitchesResult.value.pitches : [])
      : [];
    landingPageCtas = ctasResult.status === 'fulfilled'
      ? (Array.isArray(ctasResult.value.ctas) ? ctasResult.value.ctas : [])
      : [];

    if (landingTemplateSelectEl) {
      setSelectOptions(
        landingTemplateSelectEl,
        getPageTemplateSelectOptions(),
        'Template',
        selectedTemplateId
      );
    }

    const landingPrimaryInput = byId('developLandingPrimaryColorInput');
    const landingBackgroundInput = byId('developLandingBackgroundColorInput');
    const landingAccentInput = byId('developLandingAccentColorInput');
    if (landingPrimaryInput) landingPrimaryInput.value = landingPageColors.primary;
    if (landingBackgroundInput) landingBackgroundInput.value = landingPageColors.background;
    if (landingAccentInput) landingAccentInput.value = landingPageColors.accent;

    if (landingTemplateSelectEl) {
      renderLandingPageBuilderSelect('developLandingFormSelect', 'formId', savedForms.length ? 'Form' : 'Form (save a form first)');
      renderLandingPageBuilderSelect('developLandingLeadMagnetSelect', 'leadMagnetId', getLandingPageFieldRows('leadMagnetId').length ? 'PDF' : 'PDF (add assets with type "Lead Magnet")');
      renderLandingPageBuilderSelect('developLandingHeadlineSelect', 'headlineId', landingPageHeadlines.length ? 'Headline' : 'Headline (add Messaging > Headlines first)');
      renderLandingPageBuilderSelect('developLandingPitchSelect', 'pitchId', landingPagePitches.length ? 'Pitch' : 'Pitch (add Messaging > Pitches first)');
      renderLandingPageBuilderSelect('developLandingCtaSelect', 'ctaId', landingPageCtas.length ? 'CTA' : 'CTA (add Messaging > Calls to Action first)');
      renderLandingPageBuilderSelect('developLandingBannerImageSelect', 'websiteBannerImageId', getLandingPageFieldRows('websiteBannerImageId').length ? 'Website Banner Image' : 'Website Banner Image (add image assets in "Banner Image")');
      renderLandingPageBuilderSelect('developLandingBackgroundImageSelect', 'backgroundImageId', getLandingPageFieldRows('backgroundImageId').length ? 'Background Image' : 'Background Image (add image assets in "Background Image")');
      renderLandingPageBuilderSelect('developLandingFeatureImageSelect', 'featureImageId', getLandingPageFieldRows('featureImageId').length ? 'Feature Image' : 'Feature Image (add image assets in "Feature Image")');
      renderLandingPageBuilderSelect('developLandingHighlightImageSelect', 'highlightImageId', getLandingPageFieldRows('highlightImageId').length ? 'Highlight Image' : 'Highlight Image (add image assets in "Highlight Image")');
      renderLandingPageBuilderSelect('developLandingFeatureHeadlineSelect', 'featureHeadlineId', landingPageHeadlines.length ? 'Feature One Headline' : 'Feature One Headline (add Messaging > Headlines first)');
      renderLandingPageBuilderSelect('developLandingFeatureSubheadingSelect', 'featureSubheadingId', landingPageSubheadings.length ? 'Feature One Sub-heading' : 'Feature One Sub-heading (add Messaging > Sub-headings first)');
      renderLandingPageBuilderSelect('developLandingHighlightHeadlineSelect', 'highlightHeadlineId', landingPageHeadlines.length ? 'Feature Two Headline' : 'Feature Two Headline (add Messaging > Headlines first)');
      renderLandingPageBuilderSelect('developLandingHighlightPitchSelect', 'highlightPitchId', landingPagePitches.length ? 'Feature Two Pitch' : 'Feature Two Pitch (add Messaging > Pitches first)');
      renderLandingPageBuilderSelect('developLandingBodyHeadlineSelect', 'bodyHeadlineId', landingPageHeadlines.length ? 'Body Headline' : 'Body Headline (add Messaging > Headlines first)');
      renderLandingPageBuilderSelect('developLandingBodySubheadingSelect', 'bodySubheadingId', landingPageSubheadings.length ? 'Body Sub-heading' : 'Body Sub-heading (add Messaging > Sub-headings first)');
      renderLandingPageBuilderSelect('developLandingBodyPitchSelect', 'bodyPitchId', landingPagePitches.length ? 'Body Pitch' : 'Body Pitch (add Messaging > Pitches first)');
      renderLandingPageBuilderSelect('developLandingLogoSquareSelect', 'logoSquareId', getLandingPageFieldRows('logoSquareId').length ? 'Logo - Square' : 'Logo - Square (add image assets in "Logo - Square")');
    }

    if (pendingLandingPageFormRecord) {
      applyLandingPageRecordToForm(pendingLandingPageFormRecord);
    } else if (landingTemplateSelectEl) {
      applyLandingPageDefaultsToForm();
    }
  }

  async function refresh() {
    loadSavedAgents();
    await Promise.all([
      loadSavedForms(),
      loadSavedModuleClasses(),
      loadSavedModules(),
      loadSavedThemes(),
      loadSavedEmailTemplates(),
      loadSavedLandingPages(),
      loadSavedPageTemplates(),
      loadSavedExtensions(),
      loadExtensionManagerConfig(),
    ]);
    try {
      await loadLandingPageBuilderOptions();
    } catch (_) {
      await ensureAssetsLoaded().catch(() => {});
    }
    ensureFormBuilderState(formBuilderState?.formType || FORM_TEMPLATES[0].id);
    syncFormBuilderInputs();
    renderFormBuilderFieldConfig();
    renderFormBuilderPreview();
    renderSavedForms();
    renderDevelopModuleClasses();
    populateDevelopModulesClassSelect();
    setupSavedModulesGrid();
    renderThemesTable();
    syncThemesBuilder();
    renderThemesPreview();
    renderExtensionsLanding();
    populateExtensionParentSelect(byId('developExtensionIdInput')?.value);
    renderExtensionsTable();
    renderLandingPagesTable();
    renderFormTemplateRecordsTable();
    renderEmailTemplateTables();
    renderPageTemplateRecordsTable();
    const reactBuilderActive = App.builder && typeof App.builder.isActive === 'function' && App.builder.isActive();
    if (!reactBuilderActive) {
      ensureModularPageTemplateDraft();
      syncPageTemplateEditorInputs();
      renderModularPageTemplateEditor();
      setPageTemplateEditorVisible(true);
    } else {
      setPageTemplateEditorVisible(false);
    }
    setEmailTemplateEditorVisible(false);
    setCollapsibleSectionExpanded('developTemplateEditorToggle', 'developTemplateEditorBody', false);
    setCollapsibleSectionExpanded('developFormsSectionToggle', 'developFormsSectionBody', false);
    setCollapsibleSectionExpanded('developEmailSectionToggle', 'developEmailSectionBody', false);
    if (!reactBuilderActive) {
      setCollapsibleSectionExpanded('developPageTemplateEditorToggle', 'developPageTemplateEditorBody', true);
    }
    renderLandingPageThankYouPage();
    renderThumbnailSourceAssetOptions();
    renderFormTemplateLibrary();
    renderFormTemplatePreview(selectedFormTemplateId);
    renderEmailTemplateLibrary();
    renderEmailTemplatePreview(selectedEmailTemplateId);
    resetEmailTemplateForm({ renderBuilder: false });
    renderTemplateLibrary();
    renderTemplatePreview(selectedTemplateId);
    renderSavedAgentsTable();
    if (
      safeText(state.activePage) === 'developLandingPagesPage'
      && modularPageEditorMode !== 'page'
      && !reactBuilderActive
    ) {
      App.setActivePage('developManageLandingPagesPage');
    }
  }

  // ---------------------------------------------------------------------------
  // Request builders
  // ---------------------------------------------------------------------------

  function buildAgentsRequest(formData) {
    const action          = String(formData.get('action') || 'create_job');
    const manualConfirmed = formData.get('manual_confirmed') === 'on';
    const payload         = parseJsonInput(formData.get('payload_json'), {});
    const requestedBy     = {
      user_id: String(formData.get('requested_by_user_id') || '').trim() || 'alphire-ui',
      email:   String(formData.get('requested_by_email')   || '').trim() || 'ops@alphire.ai'
    };
    const jobId = String(formData.get('job_id') || '').trim();

    if (!manualConfirmed) throw new Error('Manual confirmation is required');

    const request = { manual_confirmed: true };

    if (action === 'create_job') {
      request.type         = String(formData.get('type')         || '').trim() || 'acquire.web';
      request.workspace_id = String(formData.get('workspace_id') || '').trim() || 'alphire-main';
      request.requested_by = requestedBy;
      request.payload      = payload;
      request.policy       = { requires_manual_approval: true };
      return { action, request };
    }

    if (!jobId) throw new Error('job_id is required for this action');
    request.job_id = jobId;

    if (action === 'preview_job') {
      request.requested_by = requestedBy;
      request.options      = { include_confidence: true, sample_size: 25 };
      return { action, request };
    }
    if (action === 'approve_job') {
      request.decision    = String(formData.get('approval_decision') || 'APPROVE');
      request.approver    = requestedBy;
      request.comment     = String(formData.get('approval_comment') || '').trim();
      request.constraints = { expires_in_minutes: 30 };
      return { action, request };
    }
    if (action === 'execute_job') {
      const approvalToken = String(formData.get('approval_token') || '').trim();
      if (!approvalToken) throw new Error('approval_token is required for execute_job');
      request.requested_by  = requestedBy;
      request.approval_token = approvalToken;
      request.execution     = { priority: 'normal', dry_run: false };
      return { action, request };
    }
    if (action === 'job_status') return { action, request };

    throw new Error('Unsupported action');
  }

  // ---------------------------------------------------------------------------
  // Init — wire up form handlers
  // ---------------------------------------------------------------------------

  function init() {
    const formIdInput = byId('developFormIdInput');
    const formNameInput = byId('developFormNameInput');
    const emailTemplateForm = byId('developEmailTemplateForm');
    const templateEditorIdInput = byId('developTemplateEditorIdInput');
    const emailTemplateNameInput = byId('developEmailTemplateNameInput');
    const templateEditorNameInput = byId('developTemplateEditorNameInput');
    const templateEditorSlugInput = byId('developTemplateEditorSlugInput');
    const templateEditorSummaryInput = byId('developTemplateEditorSummaryInput');
    const templateEditorSubjectInput = byId('developTemplateEditorSubjectInput');
    const templateEditorCtaInput = byId('developTemplateEditorCtaInput');
    const landingPreviewAction = byId('developLandingPagePreviewAction');
    const openCreateFormBtn = byId('developOpenCreateFormBtn');
    const cancelFormEditBtn = byId('developCancelFormEditBtn');
    const formTypeSelect = byId('developFormTypeSelect');
    const formContactTypeSelect = byId('developFormContactTypeSelect');
    const formLeadMagnetTypeSelect = byId('developFormLeadMagnetTypeSelect');
    const formLeadMagnetSelect = byId('developFormLeadMagnetSelect');
    const formCtaSelect = byId('developFormCtaSelect');
    const formHeadingInput = byId('developFormHeadingInput');
    const formSuccessMessageInput = byId('developFormSuccessMessageInput');
    const themesBuilderToggleBtn = byId('developThemesBuilderToggleBtn');
    const themesCreateBtn = byId('developThemesCreateBtn');
    const themesThemeSelect = byId('developThemesThemeSelect');
    const themesNewBtn = byId('developThemesNewBtn');
    const themesSaveBtn = byId('developThemesSaveBtn');
    const themesDeleteBtn = byId('developThemesDeleteBtn');
    const agentsSavePresetBtn = byId('developAgentsSavePresetBtn');
    const agentsClonePresetBtn = byId('developAgentsClonePresetBtn');

    if (themesBuilderToggleBtn) {
      themesBuilderToggleBtn.addEventListener('click', () => {
        const nextExpanded = themesBuilderToggleBtn.getAttribute('aria-expanded') !== 'true';
        setThemesBuilderVisible(nextExpanded);
      });
    }

    if (themesCreateBtn) {
      themesCreateBtn.addEventListener('click', () => {
        openThemesBuilder();
      });
    }

    if (themesThemeSelect) {
      themesThemeSelect.addEventListener('change', () => {
        selectedThemeId = safeText(themesThemeSelect.value);
        const selected = getThemeById(selectedThemeId);
        if (selected) applyThemeToBuilder(selected);
        else resetThemeBuilder();
        renderThemesPreview();
      });
    }

    if (themesNewBtn) {
      themesNewBtn.addEventListener('click', () => {
        resetThemeBuilder();
        setThemesBuilderVisible(true);
      });
    }

    [
      'developThemesNameInput',
      'developThemesPrimaryColorInput',
      'developThemesBackgroundColorInput',
      'developThemesAccentColorInput',
      'developThemesLogoWideSelect',
      'developThemesLogoSquareSelect',
      'developThemesFeatureImageSelect',
      'developThemesBackgroundImageSelect',
    ].forEach((id) => {
      const node = byId(id);
      if (!node) return;
      node.addEventListener('input', () => {
        if (id.endsWith('Select')) renderThemeAssetPickerDisplay(id);
        renderThemesPreview();
      });
      node.addEventListener('change', () => {
        if (id.endsWith('Select')) renderThemeAssetPickerDisplay(id);
        renderThemesPreview();
      });
    });

    [
      'developThemesBorderThicknessInput',
      'developThemesBorderRadiusInput',
      'developThemesContainerBlurInput',
      'developThemesContrastLevelInput',
    ].forEach((id) => {
      const input = byId(id);
      if (!input) return;
      input.addEventListener('input', () => {
        syncThemeRangeLabels();
        renderThemesPreview();
      });
      input.addEventListener('change', () => {
        syncThemeRangeLabels();
        renderThemesPreview();
      });
    });

    [
      ['developThemesLogoWidePickerBtn', 'developThemesLogoWideSelect'],
      ['developThemesLogoSquarePickerBtn', 'developThemesLogoSquareSelect'],
      ['developThemesFeatureImagePickerBtn', 'developThemesFeatureImageSelect'],
      ['developThemesBackgroundImagePickerBtn', 'developThemesBackgroundImageSelect'],
    ].forEach(([buttonId, selectId]) => {
      const button = byId(buttonId);
      if (!button) return;
      button.addEventListener('click', () => {
        openThemeAssetPicker(selectId);
      });
    });

    [
      ['developLandingBannerImagePickerBtn', 'developLandingBannerImageSelect'],
      ['developLandingBackgroundImagePickerBtn', 'developLandingBackgroundImageSelect'],
      ['developLandingFeatureImagePickerBtn', 'developLandingFeatureImageSelect'],
      ['developLandingHighlightImagePickerBtn', 'developLandingHighlightImageSelect'],
      ['developLandingLogoSquarePickerBtn', 'developLandingLogoSquareSelect'],
    ].forEach(([buttonId, selectId]) => {
      const button = byId(buttonId);
      if (!button) return;
      button.addEventListener('click', () => {
        openLandingAssetPicker(selectId);
      });
    });

    if (themesSaveBtn) {
      themesSaveBtn.addEventListener('click', async () => {
        const payload = buildThemePayload();
        if (!payload.name) {
          notify('Theme name is required', true);
          return;
        }
        try {
          const current = getThemeById(selectedThemeId);
          const endpoint = current?.id
            ? `/api/develop/themes/${encodeURIComponent(current.id)}`
            : '/api/develop/themes';
          const method = current?.id ? 'PATCH' : 'POST';
          const result = await api(endpoint, { method, body: JSON.stringify(payload) });
          const saved = result.theme || result.data?.theme || result.data || null;
          selectedThemeId = safeText(saved?.id) || selectedThemeId;
          await refresh();
          notify(current?.id ? 'Theme updated' : 'Theme created');
          setThemesBuilderVisible(true);
        } catch (err) {
          notify(err.message || 'Could not save theme', true);
        }
      });
    }

    if (themesDeleteBtn) {
      themesDeleteBtn.addEventListener('click', async () => {
        const current = getThemeById(selectedThemeId);
        if (!current?.id) {
          resetThemeBuilder();
          return;
        }
        if (!window.confirm(`Delete theme "${safeText(current.name) || current.id}"?`)) return;
        try {
          await api(`/api/develop/themes/${encodeURIComponent(current.id)}`, { method: 'DELETE' });
          selectedThemeId = '';
          await refresh();
          resetThemeBuilder();
          notify('Theme deleted');
        } catch (err) {
          notify(err.message || 'Could not delete theme', true);
        }
      });
    }

    if (agentsSavePresetBtn) {
      agentsSavePresetBtn.addEventListener('click', () => {
        try {
          saveAgentPresetFromForm({ clone: false });
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (agentsClonePresetBtn) {
      agentsClonePresetBtn.addEventListener('click', () => {
        try {
          saveAgentPresetFromForm({ clone: true });
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (landingPreviewAction && typeof App.makeIconButton === 'function') {
      landingPreviewAction.textContent = '';
      landingPreviewAction.appendChild(
        App.makeIconButton('preview', 'Preview Page', () => {
          previewCurrentLandingPageForm();
        }, { primary: true })
      );
    }

    const templateEditorCloseBtn = byId('developTemplateEditorCloseBtn');
    if (templateEditorCloseBtn) {
      templateEditorCloseBtn.addEventListener('click', () => {
        setEmailTemplateEditorVisible(false);
      });
    }

    const developModulesCreateBtn = byId('developModulesCreateBtn');
    const developModulesResetBtn = byId('developModulesResetBtn');
    const developModulesTypeSelect = byId('developModulesTypeSelect');
    const developModulesForm = byId('developModulesForm');

    populateDevelopModuleTypeOptions();

    const developManageClassesModal = byId('developManageClassesModal');
    const developManageClassesBtn = byId('developManageClassesBtn');
    const developManageClassesCloseBtn = byId('developManageClassesCloseBtn');
    const developClassCreateForm = byId('developClassCreateForm');

    if (developManageClassesBtn && developManageClassesModal) {
      developManageClassesBtn.addEventListener('click', () => {
        developManageClassesModal.showModal();
        renderDevelopModuleClasses();
      });
    }

    if (developManageClassesCloseBtn && developManageClassesModal) {
      developManageClassesCloseBtn.addEventListener('click', () => {
        developManageClassesModal.close();
      });
    }

    if (developClassCreateForm) {
      developClassCreateForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const input = byId('developClassNameInput');
        const name = input ? input.value.trim() : '';
        if (!name) return;
        try {
          await api('/api/develop/module-classes', {
            method: 'POST',
            body: JSON.stringify({ name })
          });
          if (input) input.value = '';
          await refresh();
          renderDevelopModuleClasses(); // Refresh modal table immediately
          notify('Module class created');
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (developModulesCreateBtn) {
      developModulesCreateBtn.addEventListener('click', () => {
        resetDevelopModuleForm();
        updateDevelopModuleTypeFields();
        const modal = byId('developModulesModal');
        if (modal) modal.showModal();
      });
    }

    if (developModulesResetBtn) {
      developModulesResetBtn.addEventListener('click', () => {
        resetDevelopModuleForm();
        updateDevelopModuleTypeFields();
      });
    }

    if (developModulesTypeSelect) {
      developModulesTypeSelect.addEventListener('change', () => {
        updateDevelopModuleTypeFields();
      });
    }

    bindCollapsibleSection('developTemplateEditorToggle', 'developTemplateEditorBody', { defaultExpanded: false });
    bindCollapsibleSection('developPageTemplateEditorToggle', 'developPageTemplateEditorBody', { defaultExpanded: true });
    bindCollapsibleSection('developModulesLibraryToggle', 'developModulesLibraryBody', { defaultExpanded: true });
    bindCollapsibleSection('developFormsSectionToggle', 'developFormsSectionBody', { defaultExpanded: false });
    bindCollapsibleSection('developEmailSectionToggle', 'developEmailSectionBody', { defaultExpanded: false });

    updateDevelopModuleTypeFields();

    const templateEditorToolbar = byId('developTemplateEditorToolbar');
    if (templateEditorToolbar) {
      templateEditorToolbar.querySelectorAll('button[data-block-type]').forEach((button) => {
        button.addEventListener('click', () => {
          const type = safeText(button.getAttribute('data-block-type')) || 'paragraph';
          emailTemplateBlocksDraft.push(createEmailTemplateBlock(type));
          renderEmailTemplateBlockEditor();
        });
      });
    }

    if (emailTemplateForm) {
      emailTemplateForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const derivedHeading = emailTemplateBlocksDraft.find((block) => block.type === 'heading')?.text || '';
        const derivedBody = emailTemplateBlocksDraft.find((block) => block.type === 'paragraph')?.text || '';
        const derivedCta = emailTemplateBlocksDraft.find((block) => block.type === 'button')?.text || '';
        const id = safeText(byId('developEmailTemplateIdInput')?.value);
        const payload = {
          templateKind: 'text',
          name: safeText(byId('developEmailTemplateNameInput')?.value),
          slug: safeText(byId('developEmailTemplateSlugInput')?.value) || slugify(byId('developEmailTemplateNameInput')?.value),
          summary: safeText(byId('developEmailTemplateSummaryInput')?.value),
          subject: safeText(byId('developEmailTemplateSubjectInput')?.value),
          heading: safeText(byId('developEmailTemplateHeadingInput')?.value) || derivedHeading,
          body: safeText(byId('developEmailTemplateBodyInput')?.value) || derivedBody,
          cta: safeText(byId('developEmailTemplateCtaInput')?.value) || derivedCta,
          blocks: [],
        };
        if (!payload.name) {
          notify('Template name is required', true);
          return;
        }
        try {
          const endpoint = id
            ? `/api/develop/email-templates/${encodeURIComponent(id)}`
            : '/api/develop/email-templates';
          const method = id ? 'PATCH' : 'POST';
          await api(endpoint, { method, body: JSON.stringify(payload) });
          notify(id ? 'Email template updated' : 'Email template created');
          await refresh();
        } catch (err) {
          notify(err.message || 'Could not save email template', true);
        }
      });
    }

    if (developModulesForm) {
      developModulesForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const payload = getDevelopModulePayloadFromForm();
        const id = safeText(payload.id);
        if (!payload.name) {
          notify('Module name is required', true);
          return;
        }
        if (!payload.moduleType) {
          notify('Module type is required', true);
          return;
        }
        if (payload.moduleType === 'header' && !safeText(payload.settings?.text, 10000)) {
          notify('Header text is required', true);
          return;
        }
        try {
          const endpoint = id
            ? `/api/develop/modules/${encodeURIComponent(id)}`
            : '/api/develop/modules';
          const method = id ? 'PATCH' : 'POST';
          await api(endpoint, { method, body: JSON.stringify(payload) });
          
          if (payload.moduleType === 'poll') {
            try {
              const q = safeText(payload.settings?.question);
              const opts = safeText(payload.settings?.options).split(',').map(o => ({ label: o.trim() })).filter(o => o.label);
              if (q && opts.length > 0) {
                await api('/api/polls', { method: 'POST', body: JSON.stringify({ question: q, options: opts }) });
              }
            } catch (pollErr) {
              console.error('Failed to dual-save poll to builder_polls:', pollErr);
            }
          }
          
          notify(id ? 'Module updated' : 'Module created');
          resetDevelopModuleForm();
          updateDevelopModuleTypeFields();
          await refresh();
          const modal = byId('developModulesModal');
          if (modal) modal.close();
        } catch (err) {
          notify(err.message || 'Could not save module', true);
        }
      });
    }

    const saveModularTemplate = async () => {
      const derivedHeading = emailTemplateBlocksDraft.find((block) => block.type === 'heading')?.text || '';
      const derivedBody = emailTemplateBlocksDraft.find((block) => block.type === 'paragraph')?.text || '';
      const derivedCta = emailTemplateBlocksDraft.find((block) => block.type === 'button')?.text || '';
      const id = safeText(templateEditorIdInput?.value);
      const name = safeText(templateEditorNameInput?.value);
      const slug = safeText(templateEditorSlugInput?.value) || slugify(templateEditorNameInput?.value);
      const summary = safeText(templateEditorSummaryInput?.value);
      const subject = safeText(templateEditorSubjectInput?.value);
      const cta = safeText(templateEditorCtaInput?.value) || derivedCta;
      const payload = {
        templateKind: 'modular',
        name,
        slug,
        summary,
        subject,
        heading: derivedHeading,
        body: derivedBody,
        cta,
        blocks: emailTemplateBlocksDraft.map((block) => ({
          id: safeText(block.id),
          type: safeText(block.type),
          text: safeText(block.text),
          url: safeText(block.url),
          sourceMode: safeText(block.sourceMode),
          assetId: safeText(block.assetId),
          alt: safeText(block.alt),
        })),
      };
      if (!payload.name) {
        notify('Template name is required', true);
        return;
      }
      try {
        const endpoint = id
          ? `/api/develop/email-templates/${encodeURIComponent(id)}`
          : '/api/develop/email-templates';
        const method = id ? 'PATCH' : 'POST';
        await api(endpoint, { method, body: JSON.stringify(payload) });
        notify(id ? 'Modular email template updated' : 'Modular email template created');
        await refresh();
      } catch (err) {
        notify(err.message || 'Could not save modular email template', true);
      }
    };

    const bindModularSaveButton = (button) => {
      if (!button) return;
      button.addEventListener('click', saveModularTemplate);
    };
    bindModularSaveButton(byId('developTemplateEditorSaveBtnTop'));
    bindModularSaveButton(byId('developTemplateEditorSaveBtnBottom'));

    const bindResetEmailTemplate = (button) => {
      if (!button) return;
      button.addEventListener('click', () => {
        resetEmailTemplateForm();
      });
    };
    bindResetEmailTemplate(byId('developEmailTemplateResetBtn'));
    bindResetEmailTemplate(byId('developEmailTemplateResetBtnTop'));
    const formErrorMessageInput = byId('developFormErrorMessageInput');
    const formAccentInput = byId('developFormAccentColorInput');
    const formMatchLandingInput = byId('developFormMatchLandingColorInput');
    const formLandingColorModeSelect = byId('developFormLandingColorModeSelect');
    const formUseLandingBackgroundInput = byId('developFormUseLandingBackgroundInput');
    const formBuilderForm = byId('developFormBuilderForm');
    const landingTemplateSelect = byId('developLandingTemplateSelect');
    const landingPrimaryInput = byId('developLandingPrimaryColorInput');
    const landingBackgroundInput = byId('developLandingBackgroundColorInput');
    const landingAccentInput = byId('developLandingAccentColorInput');

    if (openCreateFormBtn) {
      openCreateFormBtn.addEventListener('click', () => {
        openCreateFormEditor();
      });
    }

    if (cancelFormEditBtn) {
      cancelFormEditBtn.addEventListener('click', () => {
        closeFormEditor();
      });
    }

    if (formNameInput) {
      formNameInput.addEventListener('input', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.name = safeText(formNameInput.value);
      });
    }

    if (formTypeSelect) {
      formTypeSelect.addEventListener('change', () => {
        const next = buildDefaultFormState(formTypeSelect.value || FORM_TEMPLATES[0].id);
        next.id = safeText(formIdInput?.value);
        next.name = safeText(formNameInput?.value);
        next.leadMagnetType = safeText(formLeadMagnetTypeSelect?.value);
        next.leadMagnetId = safeText(formLeadMagnetSelect?.value);
        next.ctaId = safeText(formCtaSelect?.value);
        next.successMessage = safeText(formSuccessMessageInput?.value) || next.successMessage;
        next.errorMessage = safeText(formErrorMessageInput?.value) || next.errorMessage;
        formBuilderState = next;
        syncFormBuilderInputs();
        renderFormBuilderFieldConfig();
        renderFormBuilderPreview();
      });
    }

    if (formContactTypeSelect) {
      setSelectOptions(
        formContactTypeSelect,
        CONTACT_TYPE_OPTIONS,
        'Contact Type',
        ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id).contactType
      );
      formContactTypeSelect.addEventListener('change', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.contactType = safeText(formContactTypeSelect.value) || 'lead';
      });
    }

    if (formLeadMagnetSelect) {
      formLeadMagnetSelect.addEventListener('change', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.leadMagnetId = safeText(formLeadMagnetSelect.value);
        renderFormBuilderPreview();
      });
    }

    if (formLeadMagnetTypeSelect) {
      formLeadMagnetTypeSelect.addEventListener('change', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.leadMagnetType = safeText(formLeadMagnetTypeSelect.value);
        current.leadMagnetId = '';
        syncFormBuilderInputs();
        renderFormBuilderPreview();
      });
    }

    if (formCtaSelect) {
      formCtaSelect.addEventListener('change', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.ctaId = safeText(formCtaSelect.value);
        renderFormBuilderPreview();
      });
    }

    if (formHeadingInput) {
      formHeadingInput.addEventListener('input', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.heading = safeText(formHeadingInput.value) || getFormTemplateById(current.formType).defaultHeading;
        renderFormBuilderPreview();
      });
    }

    if (formSuccessMessageInput) {
      formSuccessMessageInput.addEventListener('input', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.successMessage = safeText(formSuccessMessageInput.value);
      });
    }

    if (formErrorMessageInput) {
      formErrorMessageInput.addEventListener('input', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.errorMessage = safeText(formErrorMessageInput.value);
      });
    }

    if (formAccentInput) {
      formAccentInput.addEventListener('input', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.accentColor = safeText(formAccentInput.value) || DEFAULT_FORM_ACCENT;
        renderFormBuilderPreview();
      });
    }

    if (formMatchLandingInput) {
      formMatchLandingInput.addEventListener('change', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.matchLandingColor = formMatchLandingInput.checked;
        syncFormBuilderInputs();
        renderFormBuilderPreview();
      });
    }

    if (formLandingColorModeSelect) {
      formLandingColorModeSelect.addEventListener('change', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.landingColorMode = safeText(formLandingColorModeSelect.value) || 'primary';
        renderFormBuilderPreview();
      });
    }

    if (formUseLandingBackgroundInput) {
      formUseLandingBackgroundInput.addEventListener('change', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.useLandingBackground = formUseLandingBackgroundInput.checked;
        renderFormBuilderPreview();
      });
    }

    if (landingPrimaryInput) {
      landingPrimaryInput.addEventListener('input', () => {
        landingPageColors.primary = safeText(landingPrimaryInput.value) || '#0b82d4';
        updateLandingPageFieldOutlines();
        if (ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id).matchLandingColor) {
          renderFormBuilderPreview();
        }
      });
    }

    if (landingBackgroundInput) {
      landingBackgroundInput.addEventListener('input', () => {
        landingPageColors.background = safeText(landingBackgroundInput.value) || '#f5fbff';
        updateLandingPageFieldOutlines();
        if (ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id).matchLandingColor
          && ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id).useLandingBackground) {
          renderFormBuilderPreview();
        }
      });
    }

    if (landingAccentInput) {
      landingAccentInput.addEventListener('input', () => {
        landingPageColors.accent = safeText(landingAccentInput.value) || '#1a4f81';
        updateLandingPageFieldOutlines();
        if (ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id).matchLandingColor) {
          renderFormBuilderPreview();
        }
      });
    }

    if (landingTemplateSelect) {
      landingTemplateSelect.addEventListener('change', () => {
        selectedTemplateId = safeText(landingTemplateSelect.value) || LANDING_TEMPLATES[0].id;
        renderTemplateLibrary();
        renderTemplatePreview(selectedTemplateId);
        updateLandingPageFieldOutlines();
      });
    }

    if (els.developLandingPagesForm) {
      els.developLandingPagesForm.querySelectorAll('input, select, textarea').forEach((field) => {
        if (!field || field.type === 'hidden') return;
        field.addEventListener('input', () => {
          updateLandingPageFieldOutlines();
        });
        field.addEventListener('change', () => {
          updateLandingPageFieldOutlines();
        });
      });
    }

    const openCreateLandingPageBtn = byId('developOpenCreateLandingPageBtn');
    if (openCreateLandingPageBtn) {
      openCreateLandingPageBtn.addEventListener('click', () => {
        openCreateLandingPage();
      });
    }

    const createPageTemplateBtn = byId('developCreatePageTemplateBtn');
    if (createPageTemplateBtn) {
      createPageTemplateBtn.addEventListener('click', () => {
        openCreateLandingTemplate();
      });
    }

    const createModularPageTemplateBtn = byId('developCreateModularPageTemplateBtn');
    if (createModularPageTemplateBtn) {
      createModularPageTemplateBtn.addEventListener('click', () => {
        openCreateModularLandingTemplate();
      });
    }

    const visualSaveBtn = byId('developLandingPageVisualSaveBtn');
    const visualModeBtn = byId('developLandingPageVisualModeBtn');
    const visualBackBtn = byId('developLandingPageVisualBackBtn');
    const previewModeBtn = byId('developLandingPagePreviewModeBtn');
    const previewBackBtn = byId('developLandingPagePreviewBackBtn');
    const thankYouBackBtn = byId('developLandingThankYouBackBtn');
    const saveSelectorDefaultsBtn = byId('developLandingSaveSelectorDefaultsBtn');
    const pageHeaderPreviewBtn = byId('developLandingPageHeaderPreviewBtn');
    const pageHeaderSaveBtn = byId('developLandingPageHeaderSaveBtn');
    const pageHeaderBackBtn = byId('developLandingPageHeaderBackBtn');
    const pageTemplateEditorNameInput = byId('developPageTemplateEditorNameInput');
    const pageTemplateEditorBaseTemplateSelect = byId('developPageTemplateEditorBaseTemplateSelect');
    const pageTemplateEditorCloseBtnTop = byId('developPageTemplateEditorCloseBtnTop');
    const pageTemplateEditorPreviewBtnTop = byId('developPageTemplateEditorPreviewBtnTop');
    const pageTemplateEditorPreviewBtn = byId('developPageTemplateEditorPreviewBtn');
    const pageTemplateEditorToolbar = byId('developPageTemplateEditorToolbar');

    if (saveSelectorDefaultsBtn) {
      saveSelectorDefaultsBtn.addEventListener('click', () => {
        saveLandingPageSelectorDefaults();
      });
    }

    if (pageTemplateEditorNameInput) {
      pageTemplateEditorNameInput.addEventListener('input', () => {
        if (!modularPageTemplateDraft) return;
        modularPageTemplateDraft.name = safeText(pageTemplateEditorNameInput.value, 255);
      });
    }

    if (pageTemplateEditorBaseTemplateSelect) {
      pageTemplateEditorBaseTemplateSelect.addEventListener('change', () => {
        if (!modularPageTemplateDraft) return;
        const selectedId = safeText(pageTemplateEditorBaseTemplateSelect.value);
        const selectedTemplate = getTemplateById(selectedId);
        if (!selectedTemplate) return;
        modularPageEditorSourceTemplateId = selectedId;
        modularPageTemplateDraft.templateId = safeText(selectedTemplate.templateId || selectedTemplate.id);
        modularPageTemplateDraft.layoutSections = normalizePageTemplateLayoutSections(selectedTemplate.layoutSections).length
          ? normalizePageTemplateLayoutSections(selectedTemplate.layoutSections)
          : createDefaultModularPageSections();
        renderModularPageTemplateEditor();
      });
    }

    if (pageTemplateEditorCloseBtnTop) {
      pageTemplateEditorCloseBtnTop.addEventListener('click', () => {
        setPageTemplateEditorVisible(false);
        if (modularPageEditorMode === 'page') {
          syncModularPageEditorPlacement();
          App.setActivePage('developManageLandingPagesPage');
        } else if (modularPageEditorOptions && typeof modularPageEditorOptions.onClose === 'function') {
          modularPageEditorOptions.onClose();
        }
      });
    }

    if (pageTemplateEditorPreviewBtn) {
      pageTemplateEditorPreviewBtn.addEventListener('click', async () => {
        if (!modularPageTemplateDraft) {
          notify('Open a modular template first', true);
          return;
        }
        await ensureAssetsLoaded().catch(() => {});
        flushActiveModularEditors();
        openModularPageTemplatePreviewModal(buildModularPageTemplatePreviewRecord());
      });
    }

    if (pageTemplateEditorPreviewBtnTop) {
      pageTemplateEditorPreviewBtnTop.addEventListener('click', async () => {
        if (!modularPageTemplateDraft) {
          notify('Open a modular template first', true);
          return;
        }
        await ensureAssetsLoaded().catch(() => {});
        flushActiveModularEditors();
        openModularPageTemplatePreviewModal(buildModularPageTemplatePreviewRecord());
      });
    }

    if (pageTemplateEditorToolbar) {
      pageTemplateEditorToolbar.querySelectorAll('[data-section-layout]').forEach((tile) => {
        const layout = safeText(tile.getAttribute('data-section-layout'));
        if (!layout) return;
        const tParser = new DOMParser();
        const tDoc = tParser.parseFromString(buildModularPageLayoutIconMarkup(layout, 'develop-layout-toolbar-icon'), 'text/html');
        tile.textContent = '';
        Array.from(tDoc.body.childNodes).forEach(n => tile.appendChild(n.cloneNode(true)));
      });
    }

    if (pageHeaderPreviewBtn) {
      pageHeaderPreviewBtn.addEventListener('click', async () => {
        if (!modularPageTemplateDraft) {
          notify('Open a modular template first', true);
          return;
        }
        await ensureAssetsLoaded().catch(() => {});
        flushActiveModularEditors();
        openModularPageTemplatePreviewModal(buildModularPageTemplatePreviewRecord());
      });
    }

    if (pageHeaderBackBtn) {
      pageHeaderBackBtn.addEventListener('click', () => {
        setPageTemplateEditorVisible(false);
        syncModularPageEditorPlacement();
        App.setActivePage('developManageLandingPagesPage');
      });
    }

    if (pageTemplateEditorToolbar) {
      pageTemplateEditorToolbar.querySelectorAll('[data-section-layout]').forEach((tile) => {
        tile.draggable = true;
        tile.addEventListener('pointerdown', (event) => {
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          if (event.pointerType !== 'mouse') return;
          event.preventDefault();
          startModularPageLayoutPointerDrag(tile, safeText(tile.getAttribute('data-section-layout')) || '6', event);
        });
        tile.addEventListener('dragstart', (event) => {
          if (activePageLayoutPointerDrag) {
            event.preventDefault();
            return;
          }
          if (draggedNewPageSectionLayoutClearTimer) {
            clearTimeout(draggedNewPageSectionLayoutClearTimer);
            draggedNewPageSectionLayoutClearTimer = null;
          }
          draggedNewPageSectionLayout = safeText(tile.getAttribute('data-section-layout')) || '6';
          tile.classList.add('is-dragging');
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'copy';
            event.dataTransfer.setData('text/plain', `layout:${draggedNewPageSectionLayout}`);
          }
        });
        tile.addEventListener('dragend', () => {
          draggedNewPageSectionLayoutClearTimer = window.setTimeout(() => {
            draggedNewPageSectionLayout = '';
            draggedNewPageSectionLayoutClearTimer = null;
          }, 120);
          tile.classList.remove('is-dragging');
          const workspace = byId('developPageTemplateEditorSections');
          workspace?.classList.remove('is-drag-over');
        });
        tile.addEventListener('click', () => {
          if (Date.now() < suppressLayoutTileClickUntil) return;
          if (!modularPageTemplateDraft) {
            modularPageTemplateDraft = buildEmptyLandingRecord('Modular Page Template', selectedTemplateId || LANDING_TEMPLATES[0].id);
            modularPageTemplateDraft.templateKind = 'modular';
            modularPageTemplateDraft.layoutSections = [];
          }
          const layout = safeText(tile.getAttribute('data-section-layout')) || '6';
          modularPageTemplateDraft.layoutSections.push(createModularPageSection(layout));
          renderModularPageTemplateEditor();
        });
        tile.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          tile.click();
        });
      });
    }

    const bindSaveModularPageTemplateButton = (button) => {
      if (!button) return;
      button.addEventListener('click', () => {
        saveModularPageRecord(button);
      });
    };
    bindSaveModularPageTemplateButton(byId('developPageTemplateEditorSaveBtnTop'));
    bindSaveModularPageTemplateButton(byId('developPageTemplateEditorSaveBtnBottom'));
    bindSaveModularPageTemplateButton(pageHeaderSaveBtn);

    if (visualModeBtn) {
      visualModeBtn.addEventListener('click', () => {
        landingPageVisualEditMode = !landingPageVisualEditMode;
        if (!landingPageVisualEditMode) {
          activeLandingPageVisualEditors.clear();
        }
        renderLandingPageVisualEditor();
      });
    }

    if (previewModeBtn) {
      previewModeBtn.addEventListener('click', () => {
        if (!activeLandingPagePreviewRecord) {
          notify('Open a page preview first', true);
          return;
        }
        openLandingPageVisualEditor(activeLandingPagePreviewRecord, { mode: activeLandingPagePreviewMode });
      });
    }

    if (previewBackBtn) {
      previewBackBtn.addEventListener('click', () => {
        App.setActivePage(activeLandingPagePreviewMode === 'template' ? 'developTemplatesPage' : 'developManageLandingPagesPage');
      });
    }

    if (visualBackBtn) {
      visualBackBtn.addEventListener('click', () => {
        App.setActivePage(activeLandingPageVisualMode === 'template' ? 'developTemplatesPage' : 'developManageLandingPagesPage');
      });
    }

    if (thankYouBackBtn) {
      thankYouBackBtn.addEventListener('click', () => {
        if (activeLandingPagePreviewRecord) {
          App.setActivePage('developLandingPagePreviewPage');
        } else {
          App.setActivePage('developManageLandingPagesPage');
        }
      });
    }

    if (visualSaveBtn) {
      visualSaveBtn.addEventListener('click', async () => {
        const record = getActiveLandingPageVisualRecord();
        if (!record) {
          notify('Open an item in the visual editor first', true);
          return;
        }
        try {
          const endpointBase = activeLandingPageVisualMode === 'template'
            ? '/api/develop/page-templates'
            : '/api/develop/landing-pages';
          const hasId = Boolean(safeText(record.id));
          const result = await api(hasId ? `${endpointBase}/${encodeURIComponent(record.id)}` : endpointBase, {
            method: hasId ? 'PATCH' : 'POST',
            body: JSON.stringify({
              name: safeText(record.name),
              templateKind: normalizePageTemplateKind(record.templateKind),
              templateId: safeText(record.templateId),
              primaryColor: safeText(record.primaryColor),
              backgroundColor: safeText(record.backgroundColor),
              accentColor: safeText(record.accentColor),
              formId: safeText(record.formId),
              leadMagnetId: safeText(record.leadMagnetId),
              headlineId: safeText(record.headlineId),
              pitchId: safeText(record.pitchId),
              ctaId: safeText(record.ctaId),
              websiteBannerImageId: safeText(record.websiteBannerImageId),
              backgroundImageId: safeText(record.backgroundImageId),
              featureImageId: safeText(record.featureImageId),
              highlightImageId: safeText(record.highlightImageId),
              featureHeadlineId: safeText(record.featureHeadlineId),
              featureSubheadingId: safeText(record.featureSubheadingId),
              featureTitle: safeText(record.featureTitle, 500),
              featureCopy: safeText(record.featureCopy, 5000),
              highlightHeadlineId: safeText(record.highlightHeadlineId),
              highlightPitchId: safeText(record.highlightPitchId),
              highlightTitle: safeText(record.highlightTitle, 500),
              highlightCopy: safeText(record.highlightCopy, 5000),
              bodyHeadlineId: safeText(record.bodyHeadlineId),
              bodySubheadingId: safeText(record.bodySubheadingId),
              bodyPitchId: safeText(record.bodyPitchId),
              logoWideId: safeText(record.logoWideId),
              logoSquareId: safeText(record.logoSquareId),
              layoutSections: normalizePageTemplateLayoutSections(record.layoutSections),
              contentOverrides: normalizeLandingPageContentOverrides(record.contentOverrides),
            }),
          });
          activeLandingPageVisualRecord = result?.landingPage || result?.pageTemplate || result?.data || record;
          landingPageVisualDraft = {};
          await refresh();
          renderLandingPageVisualEditor();
          notify(activeLandingPageVisualMode === 'template'
            ? (hasId ? 'Page template updated' : 'Page template created')
            : (hasId ? 'Landing page updated' : 'Landing page created'));
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    const landingPageNameFilter = byId('developLandingPagesNameFilter');
    const landingPageTemplateFilter = byId('developLandingPagesTemplateFilter');
    const landingPageSelectAll = byId('developLandingPagesSelectAllVisible');
    const landingPageBulkDeleteBtn = byId('developLandingPagesBulkDeleteBtn');
    const landingPageBulkEditBtn = byId('developLandingPagesBulkEditBtn');
    const landingPageBulkEditForm = byId('developLandingPagesBulkEditForm');
    const landingPageBulkEditSummary = byId('developLandingPagesBulkEditSummary');
    const landingPageBackFromBulkEditBtn = byId('developLandingPagesBackFromBulkEditBtn');

    if (landingPageNameFilter) {
      landingPageNameFilter.addEventListener('input', () => {
        landingPageTableState.filters.name = safeText(landingPageNameFilter.value);
        renderLandingPagesTable();
      });
    }

    if (landingPageTemplateFilter) {
      landingPageTemplateFilter.addEventListener('change', () => {
        landingPageTableState.filters.templateId = safeText(landingPageTemplateFilter.value);
        renderLandingPagesTable();
      });
    }

    [
      ['developLandingPagesSortNameBtn', 'name', 'asc'],
      ['developLandingPagesSortTemplateBtn', 'templateId', 'asc'],
      ['developLandingPagesSortHeadlineBtn', 'headlineId', 'asc'],
      ['developLandingPagesSortFormBtn', 'formId', 'asc'],
      ['developLandingPagesSortUpdatedBtn', 'updatedAt', 'desc'],
    ].forEach(([id, key, defaultDir]) => {
      const button = byId(id);
      if (!button) return;
      button.addEventListener('click', () => {
        if (landingPageTableState.sort.key === key) {
          landingPageTableState.sort.dir = landingPageTableState.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          landingPageTableState.sort.key = key;
          landingPageTableState.sort.dir = defaultDir;
        }
        renderLandingPagesTable();
      });
    });

    if (landingPageSelectAll) {
      landingPageSelectAll.addEventListener('change', () => {
        const visibleIds = getFilteredSortedLandingPages().map((item) => safeText(item.id)).filter(Boolean);
        if (landingPageSelectAll.checked) visibleIds.forEach((id) => selectedLandingPageIds.add(id));
        else visibleIds.forEach((id) => selectedLandingPageIds.delete(id));
        renderLandingPagesTable();
      });
    }

    if (landingPageBulkDeleteBtn) {
      landingPageBulkDeleteBtn.addEventListener('click', async () => {
        const ids = Array.from(selectedLandingPageIds);
        if (!ids.length) {
          notify('Select at least one page first', true);
          return;
        }
        const n = ids.length;
        if (!window.confirm(`Delete ${n} page${n === 1 ? '' : 's'}? This cannot be undone.`)) return;
        landingPageBulkDeleteBtn.disabled = true;
        landingPageBulkDeleteBtn.textContent = 'Deleting…';
        let failed = 0;
        for (const id of ids) {
          try {
            await api(`/api/develop/landing-pages/${encodeURIComponent(id)}`, { method: 'DELETE' });
            selectedLandingPageIds.delete(id);
          } catch (_) {
            failed++;
          }
        }
        await refresh();
        syncLandingPageTableControls();
        if (failed) {
          notify(`${failed} page${failed === 1 ? '' : 's'} could not be deleted`, true);
        } else {
          notify(`${n} page${n === 1 ? '' : 's'} deleted`);
        }
        landingPageBulkDeleteBtn.textContent = 'Delete Selected';
      });
    }

    if (landingPageBulkEditBtn) {
      landingPageBulkEditBtn.addEventListener('click', () => {
        const ids = Array.from(selectedLandingPageIds);
        if (!ids.length) { notify('Select at least one page first', true); return; }
        if (landingPageBulkEditSummary) {
          landingPageBulkEditSummary.textContent = `${ids.length} page${ids.length === 1 ? '' : 's'} selected.`;
        }
        setSelectOptions(
          byId('developLandingPagesBulkTemplateSelect'),
          LANDING_TEMPLATES.map((template) => ({ value: template.id, label: template.name })),
          'Leave Unchanged'
        );
        const applyPrimary = byId('developLandingPagesBulkApplyPrimaryColor');
        const applyBackground = byId('developLandingPagesBulkApplyBackgroundColor');
        const applyAccent = byId('developLandingPagesBulkApplyAccentColor');
        const bulkPrimary = byId('developLandingPagesBulkPrimaryColorInput');
        const bulkBackground = byId('developLandingPagesBulkBackgroundColorInput');
        const bulkAccent = byId('developLandingPagesBulkAccentColorInput');
        if (applyPrimary) applyPrimary.checked = false;
        if (applyBackground) applyBackground.checked = false;
        if (applyAccent) applyAccent.checked = false;
        if (bulkPrimary) bulkPrimary.value = DEFAULT_LANDING_PRIMARY;
        if (bulkBackground) bulkBackground.value = DEFAULT_LANDING_BACKGROUND;
        if (bulkAccent) bulkAccent.value = DEFAULT_LANDING_ACCENT;
        App.setActivePage('developLandingPagesBulkEditPage');
      });
    }

    if (landingPageBackFromBulkEditBtn) {
      landingPageBackFromBulkEditBtn.addEventListener('click', () => {
        App.setActivePage('developManageLandingPagesPage');
      });
    }

    if (landingPageBulkEditForm) {
      landingPageBulkEditForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const ids = Array.from(selectedLandingPageIds);
        if (!ids.length) {
          notify('Select at least one page first', true);
          return;
        }
        const formData = new FormData(landingPageBulkEditForm);
        const nextTemplateId = safeText(formData.get('template_id'));
        const applyPrimary = formData.get('apply_primary_color') === 'on';
        const applyBackground = formData.get('apply_background_color') === 'on';
        const applyAccent = formData.get('apply_accent_color') === 'on';

        if (!nextTemplateId && !applyPrimary && !applyBackground && !applyAccent) {
          notify('Choose at least one field to update', true);
          return;
        }

        try {
          for (const id of ids) {
            const item = savedLandingPages.find((entry) => safeText(entry.id) === id);
            if (!item) continue;
            await api(`/api/develop/landing-pages/${encodeURIComponent(id)}`, {
              method: 'PATCH',
              body: JSON.stringify({
                name: safeText(item.name),
                templateId: nextTemplateId || safeText(item.templateId),
                primaryColor: applyPrimary ? safeText(formData.get('primary_color')) : safeText(item.primaryColor),
                backgroundColor: applyBackground ? safeText(formData.get('background_color')) : safeText(item.backgroundColor),
                accentColor: applyAccent ? safeText(formData.get('accent_color')) : safeText(item.accentColor),
                formId: safeText(item.formId),
                leadMagnetId: safeText(item.leadMagnetId),
                headlineId: safeText(item.headlineId),
                pitchId: safeText(item.pitchId),
                ctaId: safeText(item.ctaId),
                websiteBannerImageId: safeText(item.websiteBannerImageId),
                backgroundImageId: safeText(item.backgroundImageId),
                featureImageId: safeText(item.featureImageId),
                highlightImageId: safeText(item.highlightImageId),
                featureHeadlineId: safeText(item.featureHeadlineId),
                featureSubheadingId: safeText(item.featureSubheadingId),
                featureTitle: safeText(item.featureTitle, 500),
                featureCopy: safeText(item.featureCopy, 5000),
                highlightHeadlineId: safeText(item.highlightHeadlineId),
                highlightPitchId: safeText(item.highlightPitchId),
                highlightTitle: safeText(item.highlightTitle, 500),
                highlightCopy: safeText(item.highlightCopy, 5000),
                bodyHeadlineId: safeText(item.bodyHeadlineId),
                bodySubheadingId: safeText(item.bodySubheadingId),
                bodyPitchId: safeText(item.bodyPitchId),
                logoWideId: safeText(item.logoWideId),
                logoSquareId: safeText(item.logoSquareId),
                contentOverrides: normalizeLandingPageContentOverrides(item.contentOverrides),
              }),
            });
          }
          selectedLandingPageIds = new Set();
          await refresh();
          notify('Landing pages updated');
          App.setActivePage('developManageLandingPagesPage');
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (formBuilderForm) {
      formBuilderForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const payload = buildCurrentFormPayload();
          if (!payload.name) throw new Error('Form name is required');
          if (!payload.heading) throw new Error('Heading is required');
          if (!payload.successMessage) throw new Error('Success confirmation message is required');
          if (!payload.errorMessage) throw new Error('Error confirmation message is required');
          if (payload.id) {
            await api(`/api/develop/forms/${encodeURIComponent(payload.id)}`, {
              method: 'PATCH',
              body: JSON.stringify(payload),
            });
            notify('Form updated');
          } else {
            await api('/api/develop/forms', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
            notify('Form created');
          }
          await refresh();
          closeFormEditor();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    [
      ['developFormsSortNameBtn', 'name', 'asc'],
      ['developFormsSortTypeBtn', 'formType', 'asc'],
      ['developFormsSortLeadMagnetTypeBtn', 'leadMagnetType', 'asc'],
      ['developFormsSortLeadMagnetBtn', 'leadMagnetId', 'asc'],
      ['developFormsSortCtaBtn', 'ctaId', 'asc'],
      ['developFormsSortContactTypeBtn', 'contactType', 'asc'],
      ['developFormsSortUpdatedBtn', 'updatedAt', 'desc'],
    ].forEach(([id, key, defaultDir]) => {
      const button = byId(id);
      if (!button) return;
      button.addEventListener('click', () => {
        if (formTableState.sort.key === key) {
          formTableState.sort.dir = formTableState.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          formTableState.sort.key = key;
          formTableState.sort.dir = defaultDir;
        }
        renderSavedForms();
      });
    });

    const extensionManagerForm = byId('developExtensionManagerForm');
    const extensionResetBtn = byId('developExtensionResetBtn');
    const extensionNameFilter = byId('developExtensionsFilterName');
    const extensionTypeFilter = byId('developExtensionsFilterType');
    const extensionStatusFilter = byId('developExtensionsFilterStatus');
    const extensionTagsFilter = byId('developExtensionsFilterTags');

    if (extensionResetBtn) {
      extensionResetBtn.addEventListener('click', () => {
        resetExtensionManagerForm();
      });
    }

    if (extensionManagerForm) {
      extensionManagerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const formData = new FormData(extensionManagerForm);
          const extensionId = safeText(formData.get('extension_id'));
          const existing = savedExtensions.find((item) => safeText(item.id) === extensionId) || null;
          const payload = {
            slug: existing?.slug || deriveExtensionSlug(formData.get('name')),
            name: safeText(formData.get('name')),
            extensionType: safeText(formData.get('extension_type')),
            parentId: safeText(formData.get('parent_id')),
            status: safeText(formData.get('status')) || 'active',
            tags: safeText(formData.get('tags')),
            summary: safeText(formData.get('summary'), 1000),
            definition: safeText(formData.get('definition'), 10000),
            launchPageId: existing?.launchPageId || '',
            isFeatured: existing?.isFeatured === true,
            usageCount: Number(existing?.usageCount || 0) || 0,
            lastUsedAt: existing?.lastUsedAt || '',
          };
          if (!payload.name) throw new Error('Extension name is required');
          if (!payload.extensionType) throw new Error('Extension type is required');
          if (payload.parentId && payload.parentId === extensionId) throw new Error('An extension cannot be its own parent');

          if (extensionId) {
            await api(`/api/develop/extensions/${encodeURIComponent(extensionId)}`, {
              method: 'PATCH',
              body: JSON.stringify(payload),
            });
          } else {
            await api('/api/develop/extensions', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
          }

          await refresh();
          resetExtensionManagerForm();
          notify(extensionId ? 'Extension updated' : 'Extension saved');
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (extensionNameFilter) {
      extensionNameFilter.addEventListener('input', () => {
        extensionTableState.filters.name = safeText(extensionNameFilter.value);
        renderExtensionsTable();
        saveExtensionManagerConfig();
      });
    }

    if (extensionTypeFilter) {
      extensionTypeFilter.addEventListener('change', () => {
        extensionTableState.filters.extensionType = safeText(extensionTypeFilter.value);
        renderExtensionsTable();
        saveExtensionManagerConfig();
      });
    }

    if (extensionStatusFilter) {
      extensionStatusFilter.addEventListener('change', () => {
        extensionTableState.filters.status = safeText(extensionStatusFilter.value);
        renderExtensionsTable();
        saveExtensionManagerConfig();
      });
    }

    if (extensionTagsFilter) {
      extensionTagsFilter.addEventListener('input', () => {
        extensionTableState.filters.tags = safeText(extensionTagsFilter.value);
        renderExtensionsTable();
        saveExtensionManagerConfig();
      });
    }

    [
      ['developExtensionsSortNameBtn', 'name', 'asc'],
      ['developExtensionsSortTypeBtn', 'extensionType', 'asc'],
      ['developExtensionsSortTaxonomyBtn', 'taxonomyPath', 'asc'],
      ['developExtensionsSortStatusBtn', 'status', 'asc'],
      ['developExtensionsSortUpdatedBtn', 'updatedAt', 'desc'],
    ].forEach(([id, key, defaultDir]) => {
      const button = byId(id);
      if (!button) return;
      button.addEventListener('click', () => {
        if (extensionTableState.sort.key === key) {
          extensionTableState.sort.dir = extensionTableState.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          extensionTableState.sort.key = key;
          extensionTableState.sort.dir = defaultDir;
        }
        renderExtensionsTable();
        saveExtensionManagerConfig();
      });
    });

    if (els.developLandingPagesForm) {
      els.developLandingPagesForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const formData = new FormData(els.developLandingPagesForm);
          const landingPageId = safeText(formData.get('landing_page_id'));
          const payload = getLandingPageFormPayload(formData);
          if (!payload.name) throw new Error('Landing page name is required');
          if (!payload.templateId) throw new Error('Template is required');
          selectedTemplateId = payload.templateId;
          renderTemplateLibrary();
          renderTemplatePreview(selectedTemplateId);

          let result;
          if (landingPageId) {
            result = await api(`/api/develop/landing-pages/${encodeURIComponent(landingPageId)}`, {
              method: 'PATCH',
              body: JSON.stringify(payload),
            });
          } else {
            result = await api('/api/develop/landing-pages', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
          }

          await refresh();
          notify(landingPageId ? 'Landing page updated' : 'Landing page saved');
          App.setActivePage('developManageLandingPagesPage');
          resetLandingPageForm();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (els.developAgentsForm) {
      els.developAgentsForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const formData = new FormData(els.developAgentsForm);
          const built    = buildAgentsRequest(formData);
          setPreview(els.agentsRequestPreview, built);
          const result = await api(`/api/openclaw/${built.action}`, {
            method: 'POST',
            body: JSON.stringify(built.request)
          });
          setPreview(els.agentsResponsePreview, result);
          notify(`OpenClaw ${built.action} request sent`);
        } catch (err) { notify(err.message, true); }
      });
    }

    if (els.developToolsForm) {
      els.developToolsForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const formData        = new FormData(els.developToolsForm);
          const manualConfirmed = formData.get('manual_confirmed') === 'on';
          if (!manualConfirmed) throw new Error('Manual confirmation is required');
          const toolName = safeText(formData.get('tool_name'));
          if (toolName === 'icon.builder') {
            throw new Error('Use the dedicated Icon Builder form above for icon generation.');
          }
          const input   = parseJsonInput(formData.get('input_json'), {});
          await submitToolJob(
            toolName,
            input,
            formData.get('workspace_id'),
            els.toolsRequestPreview,
            els.toolsResponsePreview,
            'Tool job sent to OpenClaw'
          );
        } catch (err) {
          setPreview(els.toolsResponsePreview, {
            ok: false,
            error: err.message || 'Tool job failed'
          });
          notify(err.message, true);
        }
      });
    }

    if (els.iconBuilderForm) {
      els.iconBuilderForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const formData = new FormData(els.iconBuilderForm);
          const manualConfirmed = formData.get('manual_confirmed') === 'on';
          if (!manualConfirmed) throw new Error('Manual confirmation is required');
          const objectType = safeText(formData.get('object_type'));
          const objectName = safeText(formData.get('object_name'));
          if (!objectName) throw new Error('Object name is required');
          const input = {
            manual_confirmed: true,
            workspace_id: safeText(formData.get('workspace_id')) || 'alphire-main',
            object_type: objectType || 'custom',
            object_name: objectName,
            category: safeText(formData.get('category')),
            summary: safeText(formData.get('object_summary')),
            icon_spec: {
              visual_style: safeText(formData.get('visual_style')) || 'clean-flat',
              palette: safeText(formData.get('palette')),
              destination: safeText(formData.get('destination')) || 'menu-bar',
              size: safeText(formData.get('size')) || '64x64',
              usage: 'Generate a compact icon for use between the main navigation and the right-side system menu.'
            }
          };
          setPreview(els.iconBuilderRequestPreview, { action: 'build_icon', request: input });
          const result = await api('/api/develop/icon-builder', {
            method: 'POST',
            body: JSON.stringify(input)
          });
          setPreview(els.iconBuilderResponsePreview, result);
          renderIconBuilderResult(result?.data || result?.icon || null);
          notify('Icon generated');
        } catch (err) {
          setPreview(els.iconBuilderResponsePreview, {
            ok: false,
            error: err.message || 'Icon Builder job failed'
          });
          renderIconBuilderResult(null);
          notify(err.message, true);
        }
      });
    }

    const screenshotForm = byId('developScreenshotForm');
    const screenshotResponsePreview = byId('developScreenshotResponsePreview');
    if (screenshotForm) {
      screenshotForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const formData = new FormData(screenshotForm);
          const url = safeText(formData.get('url'));
          if (!url) throw new Error('URL is required');
          const payload = {
            url,
            assetName: safeText(formData.get('asset_name')),
            tags: safeText(formData.get('tags')),
          };
          const result = await api('/api/develop/extensions/screenshot-capture', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          setPreview(screenshotResponsePreview, result);
          renderScreenshotResult(result?.asset || result?.data || null);
          notify('Screenshot captured');
        } catch (err) {
          setPreview(screenshotResponsePreview, {
            ok: false,
            error: err.message || 'Could not capture screenshot',
          });
          renderScreenshotResult(null);
          notify(err.message, true);
        }
      });
    }

    const thumbnailForm = byId('developThumbnailForm');
    const thumbnailResponsePreview = byId('developThumbnailResponsePreview');
    if (thumbnailForm) {
      thumbnailForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const formData = new FormData(thumbnailForm);
          const fileLocation = safeText(formData.get('file_location'));
          if (!fileLocation) throw new Error('PDF file location is required');
          const payload = {
            fileLocation,
            sourceAssetId: safeText(formData.get('source_asset_id')),
            assetName: safeText(formData.get('asset_name')),
            tags: safeText(formData.get('tags')),
          };
          const result = await api('/api/develop/extensions/thumbnail-capture', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          setPreview(thumbnailResponsePreview, result);
          renderThumbnailResult(result?.asset || result?.data || null);
          notify('Thumbnail generated');
        } catch (err) {
          setPreview(thumbnailResponsePreview, {
            ok: false,
            error: err.message || 'Could not generate thumbnail',
          });
          renderThumbnailResult(null);
          notify(err.message, true);
        }
      });
    }
  }

  return {
    manifest: { id: 'develop', label: 'Develop', pageId: 'developPage', pagePrefixes: ['develop'] },
    init,
    refresh,
    onPageActivated: refresh,
    openThemesPage,
    openThemesBuilder,
    openAgentsPage,
    openAgentsCreate,
    openModularPageTemplateEditor,
    buildModularPageTemplatePreviewMarkup
  };
})();
