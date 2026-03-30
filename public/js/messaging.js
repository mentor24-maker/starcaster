window.App = window.App || {};

App.messaging = (function () {
  const { api, notify, state } = App;
  function cleanText(value) {
    return String(value || '').trim();
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let articleBannerAssets = [];
  let allImageAssets = [];
  let tweetImageAssets = [];
  let currentHeadlines = [];
  let currentSubheadings = [];
  let currentTaglines = [];
  let currentPitches = [];
  let currentArticles = [];
  let currentReports = [];
  let currentWhitePapers = [];
  let currentEbooks = [];
  let currentTweets = [];
  let currentTweetSuggestions = [];
  let currentHashtags = [];
  let currentMessagingTopics = [];
  let currentMessagingFormats = [];
  let currentMessagingTags = [];
  let currentMessagingTopicSuggestions = [];
  let messagingTopicsProgressTimer = null;
  let activeMessagingContentCategory = '';
  const headlineTableState = {
    filters: {
      headline: '',
      category: '',
    },
    sort: {
      key: 'created_at',
      dir: 'desc',
    },
  };
  const selectedHeadlineIds = new Set();
  const subheadingTableState = {
    filters: {
      subheading: '',
      category: '',
    },
    sort: {
      key: 'created_at',
      dir: 'desc',
    },
  };
  const selectedSubheadingIds = new Set();
  const taglineTableState = {
    filters: {
      tagline: '',
      category: '',
    },
    sort: {
      key: 'created_at',
      dir: 'desc',
    },
  };
  const selectedTaglineIds = new Set();
  const pitchTableState = {
    filters: {
      pitch: '',
      category: '',
    },
    sort: {
      key: 'created_at',
      dir: 'desc',
    },
  };
  const selectedPitchIds = new Set();
  const articleTableState = {
    sort: {
      key: 'publish_date',
      dir: 'desc',
    },
  };
  const reportTableState = {
    sort: {
      key: 'publish_date',
      dir: 'desc',
    },
  };
  const whitePaperTableState = {
    sort: {
      key: 'publish_date',
      dir: 'desc',
    },
  };
  const ebookTableState = {
    sort: {
      key: 'publish_date',
      dir: 'desc',
    },
  };
  const tweetTableState = {
    sort: {
      key: 'created_at',
      dir: 'desc',
    },
  };
  const messagingTopicTableState = {
    dir: 'asc',
  };
  const messagingTagTableState = {
    dir: 'asc',
  };
  const messagingFormatTableState = {
    sort: { key: 'format', dir: 'asc' },
  };
  const simpleContentConfigs = [
    {
      key: 'emails',
      pageId: 'messagingEmailsPage',
      bulkPageId: 'messagingEmailsLibraryBulkEditPage',
      endpoint: '/api/messaging/emails',
      responseKey: 'emails',
      field: 'email',
      singularLabel: 'Email',
      pluralLabel: 'Emails',
      singularLower: 'email',
      pluralLower: 'emails',
      inputPlaceholder: 'Email body',
      rows: 12,
      itemStem: 'Email',
      pageStem: 'messagingEmails',
    },
    {
      key: 'tweets',
      pageId: 'messagingTweetsPage',
      bulkPageId: 'messagingTweetsLibraryBulkEditPage',
      endpoint: '/api/messaging/tweets',
      responseKey: 'tweets',
      field: 'content',
      singularLabel: 'Tweet',
      pluralLabel: 'Tweets',
      singularLower: 'tweet',
      pluralLower: 'tweets',
      inputPlaceholder: 'Tweet text',
      rows: 6,
      itemStem: 'Tweet',
      pageStem: 'messagingTweets',
    },
    {
      key: 'posts',
      pageId: 'messagingPostsPage',
      bulkPageId: 'messagingPostsLibraryBulkEditPage',
      endpoint: '/api/messaging/posts',
      responseKey: 'posts',
      field: 'post',
      singularLabel: 'Post',
      pluralLabel: 'Posts',
      singularLower: 'post',
      pluralLower: 'posts',
      inputPlaceholder: 'Post text',
      rows: 6,
      itemStem: 'Post',
      pageStem: 'messagingPosts',
    },
    {
      key: 'descriptions',
      pageId: 'messagingDescriptionsPage',
      bulkPageId: 'messagingDescriptionsLibraryBulkEditPage',
      endpoint: '/api/messaging/descriptions',
      responseKey: 'descriptions',
      field: 'description',
      singularLabel: 'Description',
      pluralLabel: 'Descriptions',
      singularLower: 'description',
      pluralLower: 'descriptions',
      inputPlaceholder: 'Description text',
      rows: 6,
      itemStem: 'Description',
      pageStem: 'messagingDescriptions',
    },
    {
      key: 'transcripts',
      pageId: 'messagingTranscriptsPage',
      bulkPageId: 'messagingTranscriptsLibraryBulkEditPage',
      endpoint: '/api/messaging/transcripts',
      responseKey: 'transcripts',
      field: 'transcript',
      singularLabel: 'Transcript',
      pluralLabel: 'Transcripts',
      singularLower: 'transcript',
      pluralLower: 'transcripts',
      inputPlaceholder: 'Transcript text',
      rows: 10,
      itemStem: 'Transcript',
      pageStem: 'messagingTranscripts',
    },
    {
      key: 'comments',
      pageId: 'messagingCommentsPage',
      bulkPageId: 'messagingCommentsLibraryBulkEditPage',
      endpoint: '/api/messaging/comments',
      responseKey: 'comments',
      field: 'comment',
      singularLabel: 'Comment',
      pluralLabel: 'Comments',
      singularLower: 'comment',
      pluralLower: 'comments',
      inputPlaceholder: 'Comment text',
      rows: 6,
      itemStem: 'Comment',
      pageStem: 'messagingComments',
    },
    {
      key: 'keywords',
      pageId: 'messagingKeywordsPage',
      bulkPageId: 'messagingKeywordsLibraryBulkEditPage',
      endpoint: '/api/messaging/keywords',
      responseKey: 'keywords',
      field: 'keyword',
      singularLabel: 'Keyword',
      pluralLabel: 'Keywords',
      singularLower: 'keyword',
      pluralLower: 'keywords',
      inputPlaceholder: 'Keyword',
      rows: 4,
      itemStem: 'Keyword',
      pageStem: 'messagingKeywords',
    },
    {
      key: 'hashtags',
      pageId: 'messagingHashtagsPage',
      bulkPageId: 'messagingHashtagsLibraryBulkEditPage',
      endpoint: '/api/messaging/hashtags',
      responseKey: 'hashtags',
      field: 'hashtag',
      singularLabel: 'Hashtag',
      pluralLabel: 'Hashtags',
      singularLower: 'hashtag',
      pluralLower: 'hashtags',
      inputPlaceholder: '#hashtag',
      rows: 6,
      itemStem: 'Hashtag',
      pageStem: 'messagingHashtags',
    },
    {
      key: 'ctas',
      pageId: 'messagingCtasPage',
      bulkPageId: 'messagingCtasLibraryBulkEditPage',
      endpoint: '/api/messaging/ctas',
      responseKey: 'ctas',
      field: 'cta',
      singularLabel: 'Call to Action',
      pluralLabel: 'Calls to Action',
      singularLower: 'call to action',
      pluralLower: 'calls to action',
      inputPlaceholder: 'Call to action text',
      rows: 4,
      itemStem: 'Cta',
      pageStem: 'messagingCtas',
    },
  ];
  const simpleContentState = Object.fromEntries(simpleContentConfigs.map((config) => [
    config.key,
    {
      items: [],
      selected: new Set(),
      filters: { text: '', category: '' },
      sort: { key: 'created_at', dir: 'desc' },
    }
  ]));
  const messagingContentLibraryEntries = [
    { type: 'Headlines', family: 'Short Form', destination: 'Headlines Editor', pageId: 'messagingHeadlinesPage' },
    { type: 'Sub-headings', family: 'Short Form', destination: 'Sub-headings Editor', pageId: 'messagingSubheadingsPage' },
    { type: 'Taglines', family: 'Short Form', destination: 'Taglines Editor', pageId: 'messagingTaglinesPage' },
    { type: 'Pitches', family: 'Short Form', destination: 'Pitches Editor', pageId: 'messagingPitchesPage' },
    { type: 'Emails', family: 'Email', destination: 'Emails Editor', pageId: 'messagingEmailsPage' },
    { type: 'Tweets', family: 'Social', destination: 'Tweets Editor', pageId: 'messagingTweetsPage' },
    { type: 'Posts', family: 'Social', destination: 'Posts Editor', pageId: 'messagingPostsPage' },
    { type: 'Articles', family: 'Long Form', destination: 'Articles Editor', pageId: 'messagingArticlesPage' },
    { type: 'Reports', family: 'Long Form', destination: 'Reports Editor', pageId: 'messagingReportsPage' },
    { type: 'White Papers', family: 'Long Form', destination: 'White Papers Editor', pageId: 'messagingWhitePapersPage' },
    { type: 'eBooks', family: 'Long Form', destination: 'eBooks Editor', pageId: 'messagingEbooksPage' },
    { type: 'Descriptions', family: 'Support Copy', destination: 'Descriptions Editor', pageId: 'messagingDescriptionsPage' },
    { type: 'Transcripts', family: 'Support Copy', destination: 'Transcripts Editor', pageId: 'messagingTranscriptsPage' },
    { type: 'Comments', family: 'Support Copy', destination: 'Comments Editor', pageId: 'messagingCommentsPage' },
    { type: 'Keywords', family: 'Short Form', destination: 'Keywords Editor', pageId: 'messagingKeywordsPage' },
    { type: 'Hashtags', family: 'Support Copy', destination: 'Hashtags Editor', pageId: 'messagingHashtagsPage' },
    { type: 'Calls to Action', family: 'Support Copy', destination: 'Calls to Action Editor', pageId: 'messagingCtasPage' },
  ];
  const defaultMessagingFormatEntries = messagingContentLibraryEntries.map((entry) => ({
    format: entry.type,
    family: entry.family,
    destination: entry.destination,
    pageId: entry.pageId,
    enabled: true,
  }));

  const messagingContentRegistry = [
    { format: 'Headlines', pageId: 'messagingHeadlinesPage', field: 'headline', source: () => currentHeadlines },
    { format: 'Sub-headings', pageId: 'messagingSubheadingsPage', field: 'subheading', source: () => currentSubheadings },
    { format: 'Taglines', pageId: 'messagingTaglinesPage', field: 'tagline', source: () => currentTaglines },
    { format: 'Pitches', pageId: 'messagingPitchesPage', field: 'pitch', source: () => currentPitches },
    { format: 'Articles', pageId: 'messagingArticlesPage', field: 'title', source: () => currentArticles },
    { format: 'Reports', pageId: 'messagingReportsPage', field: 'title', source: () => currentReports },
    { format: 'White Papers', pageId: 'messagingWhitePapersPage', field: 'title', source: () => currentWhitePapers },
    { format: 'eBooks', pageId: 'messagingEbooksPage', field: 'title', source: () => currentEbooks },
    { format: 'Emails', pageId: 'messagingEmailsPage', field: 'email', source: () => simpleContentState.emails.items },
    { format: 'Tweets', pageId: 'messagingTweetsPage', field: 'content', source: () => simpleContentState.tweets.items },
    { format: 'Posts', pageId: 'messagingPostsPage', field: 'post', source: () => simpleContentState.posts.items },
    { format: 'Descriptions', pageId: 'messagingDescriptionsPage', field: 'description', source: () => simpleContentState.descriptions.items },
    { format: 'Transcripts', pageId: 'messagingTranscriptsPage', field: 'transcript', source: () => simpleContentState.transcripts.items },
    { format: 'Comments', pageId: 'messagingCommentsPage', field: 'comment', source: () => simpleContentState.comments.items },
    { format: 'Keywords', pageId: 'messagingKeywordsPage', field: 'keyword', source: () => simpleContentState.keywords.items },
    { format: 'Hashtags', pageId: 'messagingHashtagsPage', field: 'hashtag', source: () => simpleContentState.hashtags.items },
    { format: 'Calls to Action', pageId: 'messagingCtasPage', field: 'cta', source: () => simpleContentState.ctas.items },
  ];
  const createContentFormatSchemas = {
    Headlines: { kind: 'simple', endpoint: '/api/messaging/headlines', primaryKey: 'headline', primaryLabel: 'Headline', primaryRows: 3, fields: ['primary'] },
    'Sub-headings': { kind: 'simple', endpoint: '/api/messaging/subheadings', primaryKey: 'subheading', primaryLabel: 'Sub-heading', primaryRows: 3, fields: ['primary'] },
    Taglines: { kind: 'simple', endpoint: '/api/messaging/taglines', primaryKey: 'tagline', primaryLabel: 'Tagline', primaryRows: 3, fields: ['primary'] },
    Pitches: { kind: 'simple', endpoint: '/api/messaging/pitches', primaryKey: 'pitch', primaryLabel: 'Pitch', primaryRows: 5, fields: ['primary'] },
    Emails: { kind: 'simple', endpoint: '/api/messaging/emails', primaryKey: 'email', primaryLabel: 'Email Body', primaryRows: 12, fields: ['subject', 'primary'] },
    Tweets: { kind: 'tweet', endpoint: '/api/messaging/tweets', primaryKey: 'content', primaryLabel: 'Tweet', primaryRows: 6, fields: ['primary', 'url', 'hashtags', 'image'] },
    Posts: { kind: 'simple', endpoint: '/api/messaging/posts', primaryKey: 'post', primaryLabel: 'Post', primaryRows: 6, fields: ['primary', 'url', 'image'] },
    Descriptions: { kind: 'simple', endpoint: '/api/messaging/descriptions', primaryKey: 'description', primaryLabel: 'Description', primaryRows: 6, fields: ['primary'] },
    Transcripts: { kind: 'simple', endpoint: '/api/messaging/transcripts', primaryKey: 'transcript', primaryLabel: 'Transcript', primaryRows: 10, fields: ['primary', 'url'] },
    Comments: { kind: 'simple', endpoint: '/api/messaging/comments', primaryKey: 'comment', primaryLabel: 'Comment', primaryRows: 6, fields: ['primary', 'url'] },
    Keywords: { kind: 'simple', endpoint: '/api/messaging/keywords', primaryKey: 'keyword', primaryLabel: 'Keyword', primaryRows: 4, fields: ['primary'] },
    Hashtags: { kind: 'simple', endpoint: '/api/messaging/hashtags', primaryKey: 'hashtag', primaryLabel: 'Hashtags', primaryRows: 4, fields: ['primary'] },
    'Calls to Action': { kind: 'simple', endpoint: '/api/messaging/ctas', primaryKey: 'cta', primaryLabel: 'CTA', primaryRows: 4, fields: ['primary', 'url'] },
    Articles: { kind: 'longform', endpoint: '/api/messaging/articles', bodyLabel: 'Body', fields: ['author', 'title', 'subtitle', 'url', 'thumbnail', 'body'] },
    Reports: { kind: 'pdfLongform', endpoint: '/api/messaging/reports', bodyLabel: 'Body', fields: ['author', 'title', 'subtitle', 'url', 'thumbnail', 'body', 'pdf'] },
    'White Papers': { kind: 'pdfLongform', endpoint: '/api/messaging/white-papers', bodyLabel: 'Body', fields: ['author', 'title', 'subtitle', 'url', 'thumbnail', 'body', 'pdf'] },
    eBooks: { kind: 'pdfLongform', endpoint: '/api/messaging/ebooks', bodyLabel: 'Body', fields: ['author', 'title', 'subtitle', 'url', 'thumbnail', 'body', 'pdf'] },
  };
  let currentCreateContentSuggestions = [];

  function thumbnailOptionLabel(asset) {
    const name = String(asset.assetName || '').trim() || '(unnamed)';
    const category = String(asset.category || '').trim() || '-';
    return `${name} [${category}]`;
  }

  function syncHeadlineCategorySelects() {
    const categoryNames = currentMessagingTopics
      .map((item) => String(item?.topic || item?.category || '').trim())
      .filter(Boolean);
    const uniqueNames = Array.from(new Set(categoryNames)).sort((a, b) => a.localeCompare(b));

    const selectList = [
      document.getElementById('messagingHeadlineCategorySelect'),
      document.getElementById('messagingHeadlinesBulkCategorySelect'),
      document.getElementById('messagingHeadlineEditCategorySelect'),
      document.getElementById('messagingHeadlinesBulkEditCategorySelect'),
      document.getElementById('messagingHeadlinesCategoryFilter'),
      document.getElementById('messagingSubheadingCategorySelect'),
      document.getElementById('messagingSubheadingsBulkCategorySelect'),
      document.getElementById('messagingSubheadingEditCategorySelect'),
      document.getElementById('messagingSubheadingsBulkEditCategorySelect'),
      document.getElementById('messagingSubheadingsCategoryFilter'),
      document.getElementById('messagingTaglineCategorySelect'),
      document.getElementById('messagingTaglinesBulkCategorySelect'),
      document.getElementById('messagingTaglineEditCategorySelect'),
      document.getElementById('messagingTaglinesBulkEditCategorySelect'),
      document.getElementById('messagingTaglinesCategoryFilter'),
      document.getElementById('messagingPitchCategorySelect'),
      document.getElementById('messagingPitchesBulkCategorySelect'),
      document.getElementById('messagingPitchEditCategorySelect'),
      document.getElementById('messagingPitchesBulkEditCategorySelect'),
      document.getElementById('messagingPitchesCategoryFilter'),
    ];
    document.querySelectorAll('select[id^="messaging"][name="topic"]').forEach((select) => {
      selectList.push(select);
    });
    document.querySelectorAll('[data-messaging-category-select="true"]').forEach((select) => {
      selectList.push(select);
    });

    selectList.forEach((select) => {
      if (!select) return;
      const currentValue = String(select.value || '');
      const isFilter = select.id === 'messagingHeadlinesCategoryFilter'
        || select.id === 'messagingSubheadingsCategoryFilter'
        || select.id === 'messagingTaglinesCategoryFilter'
        || select.id === 'messagingPitchesCategoryFilter'
        || select.dataset.messagingCategoryRole === 'filter';
      select.innerHTML = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = isFilter ? 'All Topics' : 'No Topic';
      select.appendChild(placeholder);
      uniqueNames.forEach((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
      });
      if (currentValue && Array.from(select.options).some((option) => option.value === currentValue)) {
        select.value = currentValue;
      }
    });
  }

  function getSimpleContentIds(config) {
    return {
      categoryBtnId: `openMessagingCategoriesFrom${config.pageStem.replace(/^messaging/, '')}Btn`,
      toggleBtnId: `${config.pageStem}LibraryToggleFormBtn`,
      createWrapId: `${config.pageStem}LibraryCreateWrap`,
      formId: `messaging${config.itemStem}LibraryForm`,
      formCategorySelectId: `messaging${config.itemStem}LibraryCategorySelect`,
      bulkCreateFormId: `${config.pageStem}LibraryBulkCreateForm`,
      bulkCreateCategorySelectId: `${config.pageStem}LibraryBulkCategorySelect`,
      editFormId: `messaging${config.itemStem}LibraryEditForm`,
      cancelEditBtnId: `messaging${config.itemStem}LibraryCancelEditBtn`,
      editCategorySelectId: `messaging${config.itemStem}LibraryEditCategorySelect`,
      tableId: `${config.pageStem}LibraryTable`,
      selectAllId: `${config.pageStem}LibrarySelectAllVisible`,
      textFilterId: `${config.pageStem}LibraryTextFilter`,
      categoryFilterId: `${config.pageStem}LibraryCategoryFilter`,
      formatFilterId: `${config.pageStem}LibraryFormatFilter`,
      bulkEditBtnId: `${config.pageStem}LibraryBulkEditBtn`,
      sortTextBtnId: `${config.pageStem}LibrarySortTextBtn`,
      sortCategoryBtnId: `${config.pageStem}LibrarySortCategoryBtn`,
      sortCreatedBtnId: `${config.pageStem}LibrarySortCreatedBtn`,
      sortUpdatedBtnId: `${config.pageStem}LibrarySortUpdatedBtn`,
      bulkBackBtnId: `${config.pageStem}LibraryBackFromBulkEditBtn`,
      bulkSummaryId: `${config.pageStem}LibraryBulkEditSummary`,
      bulkEditFormId: `${config.pageStem}LibraryBulkEditForm`,
      bulkEditCategorySelectId: `${config.pageStem}LibraryBulkEditCategorySelect`,
    };
  }

  function buildSimpleContentPageMarkup(config) {
    const ids = getSimpleContentIds(config);
    return `
        <div class="page-heading-row">
          <h2>Messaging: ${config.pluralLabel}</h2>
          <div class="page-heading-actions">
            <button id="${ids.categoryBtnId}" type="button">Topics</button>
            <button id="${ids.toggleBtnId}" type="button">Create ${config.pluralLabel}</button>
            <button type="button" onclick="App.messaging.openContentLanding(); return false;">Back To Messaging</button>
          </div>
        </div>

        <section id="${ids.createWrapId}" class="hidden">
          <div class="grid-form" style="align-items: start;">
            <form id="${ids.formId}" class="stack-form">
              <h3>Single Create</h3>
              <select id="${ids.formCategorySelectId}" name="topic" data-messaging-category-select="true">
                <option value="">No Topic</option>
              </select>
              <textarea name="${config.field}" rows="${config.rows}" placeholder="${config.inputPlaceholder}" required></textarea>
              <textarea name="feedback" rows="4" placeholder="Feedback / Training (optional)"></textarea>
              <button type="submit">Save ${config.singularLabel}</button>
            </form>

            <form id="${ids.bulkCreateFormId}" class="stack-form">
              <h3>Multiple Create</h3>
              <select id="${ids.bulkCreateCategorySelectId}" name="topic" data-messaging-category-select="true">
                <option value="">No Topic</option>
              </select>
              <textarea name="${config.field}_text" rows="8" placeholder="Paste multiple ${config.pluralLower}, one per line"></textarea>
              <button type="submit">Create Multiple ${config.pluralLabel}</button>
            </form>
          </div>
        </section>

        <form id="${ids.editFormId}" class="stack-form hidden">
          <input name="id" type="hidden" />
          <div class="page-heading-row">
            <h3>Edit ${config.singularLabel}</h3>
            <button id="${ids.cancelEditBtnId}" type="button">Cancel Edit</button>
          </div>
          <select id="${ids.editCategorySelectId}" name="topic" data-messaging-category-select="true">
            <option value="">No Topic</option>
          </select>
          <textarea name="${config.field}" rows="${config.rows}" placeholder="${config.inputPlaceholder}" required></textarea>
          <textarea name="feedback" rows="4" placeholder="Feedback / Training (optional)"></textarea>
          <button type="submit">Update ${config.singularLabel}</button>
        </form>

        <div class="table-wrap">
          <table>
            <thead>
              <tr class="table-filter-row">
                <th><input id="${ids.selectAllId}" type="checkbox" aria-label="Select all visible ${config.pluralLower}" /></th>
                <th><input id="${ids.textFilterId}" placeholder="Filter ${config.singularLower}" /></th>
                <th>
                  <select id="${ids.categoryFilterId}" data-messaging-category-select="true" data-messaging-category-role="filter">
                    <option value="">All Topics</option>
                  </select>
                </th>
                <th>
                  <select id="${ids.formatFilterId}">
                    <option value="">All Formats</option>
                    <option value="${config.pluralLabel}">${config.pluralLabel}</option>
                  </select>
                </th>
                <th></th>
                <th></th>
                <th><button id="${ids.bulkEditBtnId}" type="button" class="tiny-btn" disabled>Edit Selected</button></th>
              </tr>
              <tr>
                <th></th>
                <th><button id="${ids.sortTextBtnId}" type="button" class="tiny-btn">${config.singularLabel}</button></th>
                <th><button id="${ids.sortCategoryBtnId}" type="button" class="tiny-btn">Topic</button></th>
                <th>Format</th>
                <th><button id="${ids.sortCreatedBtnId}" type="button" class="tiny-btn">Created</button></th>
                <th><button id="${ids.sortUpdatedBtnId}" type="button" class="tiny-btn">Updated</button></th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="${ids.tableId}"></tbody>
          </table>
        </div>
    `;
  }

  function buildSimpleContentBulkPageMarkup(config) {
    const ids = getSimpleContentIds(config);
    return `
        <div class="page-heading-row">
          <h2>Bulk Edit ${config.pluralLabel}</h2>
          <button id="${ids.bulkBackBtnId}" type="button">Back To ${config.pluralLabel}</button>
        </div>
        <p id="${ids.bulkSummaryId}">No ${config.pluralLower} selected.</p>
        <form id="${ids.bulkEditFormId}" class="stack-form labeled-form">
          <div class="stack-form">
            <label for="${ids.bulkEditCategorySelectId}">Topic</label>
            <select id="${ids.bulkEditCategorySelectId}" name="topic" data-messaging-category-select="true">
              <option value="">No Topic</option>
            </select>
          </div>
          <button type="submit">Apply To Selected ${config.pluralLabel}</button>
        </form>
    `;
  }

  function ensureSimpleContentPages() {
    simpleContentConfigs.forEach((config) => {
      const page = document.getElementById(config.pageId);
      if (page) {
        page.innerHTML = buildSimpleContentPageMarkup(config);
      }
      let bulkPage = document.getElementById(config.bulkPageId);
      if (!bulkPage && page && page.parentNode) {
        bulkPage = document.createElement('section');
        bulkPage.id = config.bulkPageId;
        bulkPage.className = 'app-page hidden';
        page.insertAdjacentElement('afterend', bulkPage);
      }
      if (bulkPage) {
        bulkPage.innerHTML = buildSimpleContentBulkPageMarkup(config);
      }
    });
  }

  function isValidHttpUrl(value) {
    const text = String(value || '').trim();
    if (!text) return false;
    try {
      const parsed = new URL(text);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function extractDriveId(url) {
    const text = String(url || '').trim();
    if (!text) return '';
    const byPath = text.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    if (byPath) return byPath[1];
    try {
      const u = new URL(text);
      const byParam = u.searchParams.get('id');
      return byParam || '';
    } catch {
      return '';
    }
  }

  function toDriveDirectUrl(url) {
    const id = extractDriveId(url);
    if (!id) return '';
    return `/api/assets/drive-file/${encodeURIComponent(id)}`;
  }

  function thumbnailUrlFromAsset(asset) {
    const location = String(asset && asset.location ? asset.location : '').trim();
    if (!location) return '';
    const driveDirect = toDriveDirectUrl(location);
    if (driveDirect) return driveDirect;
    if (isValidHttpUrl(location)) return location;
    return '';
  }

  function renderThumbnailOptions(select) {
    if (!select) return;
    const currentValue = String(select.value || '');
    select.innerHTML = '<option value="">Thumbnail (Image + Article Banner)</option>';
    articleBannerAssets.forEach((asset) => {
      const id = Number(asset.id || 0) || 0;
      if (!id) return;
      const option = document.createElement('option');
      option.value = String(id);
      option.textContent = thumbnailOptionLabel(asset);
      select.appendChild(option);
    });
    if (currentValue) select.value = currentValue;
  }

  function renderImageOptions(select) {
    if (!select) return;
    const currentValue = String(select.value || '');
    select.innerHTML = '<option value="">Image (optional)</option>';
    tweetImageAssets.forEach((asset) => {
      const id = Number(asset.id || 0) || 0;
      if (!id) return;
      const option = document.createElement('option');
      option.value = String(id);
      option.textContent = thumbnailOptionLabel(asset);
      select.appendChild(option);
    });
    if (currentValue) select.value = currentValue;
  }

  async function loadThumbnailOptions() {
    const addSelect = document.getElementById('messagingArticleThumbnailSelect');
    const editSelect = document.getElementById('messagingArticleEditThumbnailSelect');
    const reportAddSelect = document.getElementById('messagingReportThumbnailSelect');
    const reportEditSelect = document.getElementById('messagingReportEditThumbnailSelect');
    const whitePaperAddSelect = document.getElementById('messagingWhitePaperThumbnailSelect');
    const whitePaperEditSelect = document.getElementById('messagingWhitePaperEditThumbnailSelect');
    const ebookAddSelect = document.getElementById('messagingEbookThumbnailSelect');
    const ebookEditSelect = document.getElementById('messagingEbookEditThumbnailSelect');
    if (!addSelect && !editSelect && !reportAddSelect && !reportEditSelect && !whitePaperAddSelect && !whitePaperEditSelect && !ebookAddSelect && !ebookEditSelect) return;
    try {
      const res = await api('/api/assets');
      const assets = Array.isArray(res.assets) ? res.assets : [];
      allImageAssets = assets.filter((a) => String(a.assetType || '').trim() === 'Image');
      articleBannerAssets = allImageAssets.filter((a) => {
        const category = String(a.category || '').trim();
        return category === 'Article Banner';
      });
      tweetImageAssets = allImageAssets.filter((a) => {
        const category = String(a.category || '').trim();
        return category === 'X Post';
      });
      renderThumbnailOptions(addSelect);
      renderThumbnailOptions(editSelect);
      renderThumbnailOptions(reportAddSelect);
      renderThumbnailOptions(reportEditSelect);
      renderThumbnailOptions(whitePaperAddSelect);
      renderThumbnailOptions(whitePaperEditSelect);
      renderThumbnailOptions(ebookAddSelect);
      renderThumbnailOptions(ebookEditSelect);
      renderImageOptions(document.getElementById('messagingTweetImageSelect'));
      renderImageOptions(document.getElementById('messagingTweetEditImageSelect'));
    } catch (err) {
      notify(`Could not load thumbnail images: ${err.message}`, true);
    }
  }

  function formatDateForInput(isoValue) {
    const raw = String(isoValue || '').trim();
    if (!raw) return '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve('');
      const reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ''));
      };
      reader.onerror = function () {
        reject(new Error('Could not read the selected file'));
      };
      reader.readAsDataURL(file);
    });
  }

  async function getWhitePaperPdfFields(fileInput, fallback = null) {
    const file = fileInput && fileInput.files ? fileInput.files[0] : null;
    if (!file) {
      if (fallback) {
        return {
          pdf_name: String(fallback.pdf_name || '').trim(),
          pdf_mime_type: String(fallback.pdf_mime_type || '').trim(),
          pdf_data_url: String(fallback.pdf_data_url || '').trim(),
        };
      }
      return { pdf_name: '', pdf_mime_type: '', pdf_data_url: '' };
    }

    const fileName = String(file.name || '').trim();
    const mimeType = String(file.type || '').trim();
    const looksLikePdf = mimeType === 'application/pdf' || /\.pdf$/i.test(fileName);
    if (!looksLikePdf) {
      throw new Error('The uploaded file must be a PDF');
    }

    let pdfDataUrl = await readFileAsDataUrl(file);
    if (pdfDataUrl && !/^data:application\/pdf(?:;charset=[^;,]+)?;base64,/i.test(pdfDataUrl)) {
      pdfDataUrl = pdfDataUrl.replace(/^data:[^,]*,/, 'data:application/pdf;base64,');
    }

    return {
      pdf_name: fileName.slice(0, 255),
      pdf_mime_type: mimeType || 'application/pdf',
      pdf_data_url: pdfDataUrl,
    };
  }

  function fillFormFromArticle(form, article) {
    if (!form || !article) return;
    form.elements.platform.value = String(article.platform || '');
    form.elements.author.value = String(article.author || '');
    form.elements.publish_date.value = formatDateForInput(article.publish_date);
    form.elements.title.value = String(article.title || '');
    form.elements.subtitle.value = String(article.subtitle || '');
    form.elements.url.value = String(article.url || '');
    form.elements.content.value = String(article.content || '');
    if (form.elements.feedback) form.elements.feedback.value = String(article.feedback || '');
    form.elements.thumbnail_asset_id.value = article.thumbnail_asset_id ? String(article.thumbnail_asset_id) : '';
  }

  function openEditForm(article) {
    const editForm = document.getElementById('messagingArticlesEditForm');
    const addForm = document.getElementById('messagingArticlesForm');
    const addBtn = document.getElementById('messagingArticlesToggleFormBtn');
    if (!editForm || !article) return;
    editForm.classList.remove('hidden');
    editForm.elements.id.value = String(article.id || '');
    fillFormFromArticle(editForm, article);
    if (addForm) addForm.classList.add('hidden');
    if (addBtn) addBtn.textContent = 'Add Article';
    editForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function buildDetailGrid(pairs) {
    const grid = document.createElement('div');
    grid.className = 'contact-detail-grid';
    (Array.isArray(pairs) ? pairs : []).forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'contact-detail-row';
      const labelEl = document.createElement('div');
      labelEl.className = 'contact-detail-label';
      labelEl.textContent = `${label}:`;
      const valueEl = document.createElement('div');
      valueEl.className = 'contact-detail-value';
      valueEl.textContent = String(value || '-');
      row.appendChild(labelEl);
      row.appendChild(valueEl);
      grid.appendChild(row);
    });
    return grid;
  }

  function setGeneratedBodyEditorHtml(value) {
    const editor = document.getElementById('messagingCreateContentGeneratedBodyEditor');
    if (!editor) return;
    const raw = String(value || '').trim();
    if (!raw) {
      editor.innerHTML = '';
      return;
    }
    if (/<[a-z][\s\S]*>/i.test(raw)) {
      editor.innerHTML = raw;
      return;
    }
    editor.innerHTML = raw
      .split(/\n{2,}/)
      .map((chunk) => `<p>${escapeHtml(chunk).replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  function getGeneratedBodyEditorHtml() {
    const editor = document.getElementById('messagingCreateContentGeneratedBodyEditor');
    return editor ? String(editor.innerHTML || '').trim() : '';
  }

  function getGeneratedBodyEditorText() {
    const editor = document.getElementById('messagingCreateContentGeneratedBodyEditor');
    return editor ? cleanText(editor.innerText || editor.textContent || '') : '';
  }

  function mergeTrainingContextFeedback(existingContext, feedback) {
    const marker = '[Messaging Article Revision Feedback]';
    const existing = cleanText(existingContext);
    const nextFeedback = cleanText(feedback);
    const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const base = existing.replace(new RegExp(`\\n*${escapedMarker}[\\s\\S]*$`, 'i'), '').trim();
    if (!nextFeedback) return base;
    return [base, marker, nextFeedback].filter(Boolean).join('\n\n');
  }

  async function saveCreateContentFeedbackToTraining(feedback) {
    const current = await api('/api/settings/training/context', { method: 'GET' });
    const existingContext = cleanText(current?.training_context || current?.data?.training_context);
    const guidelines = cleanText(current?.training_guidelines || current?.data?.training_guidelines);
    const trainingContext = mergeTrainingContextFeedback(existingContext, feedback);
    await api('/api/settings/training/context', {
      method: 'POST',
      body: JSON.stringify({
        training_context: trainingContext,
        training_guidelines: guidelines,
      }),
    });
    return trainingContext;
  }

  function openMessagingDetailModal(title, pairs) {
    const modal = App.components.Modal({
      title,
      body: buildDetailGrid(pairs),
      actions: [{ label: 'Close', primary: true, onClick: () => modal.close() }],
    });
    modal.open();
  }

  function cloneArticlePayload(article) {
    return {
      platform: String(article?.platform || '').trim(),
      author: String(article?.author || '').trim(),
      title: `${String(article?.title || '').trim() || 'Untitled'} (Clone)`,
      subtitle: String(article?.subtitle || '').trim(),
      url: String(article?.url || '').trim(),
      content: String(article?.content || '').trim(),
      feedback: String(article?.feedback || '').trim(),
      publish_date: article?.publish_date || null,
      thumbnail_asset_id: Number(article?.thumbnail_asset_id || 0) || null,
    };
  }

  async function cloneArticle(article) {
    const payload = cloneArticlePayload(article);
    await api('/api/messaging/articles', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  function closeEditForm() {
    const editForm = document.getElementById('messagingArticlesEditForm');
    if (!editForm) return;
    editForm.reset();
    editForm.classList.add('hidden');
  }

  function fillFormFromReport(form, report) {
    if (!form || !report) return;
    form.elements.platform.value = String(report.platform || '');
    form.elements.author.value = String(report.author || '');
    form.elements.publish_date.value = formatDateForInput(report.publish_date);
    form.elements.title.value = String(report.title || '');
    form.elements.subtitle.value = String(report.subtitle || '');
    form.elements.url.value = String(report.url || '');
    form.elements.content.value = String(report.content || '');
    if (form.elements.feedback) form.elements.feedback.value = String(report.feedback || '');
    form.elements.thumbnail_asset_id.value = report.thumbnail_asset_id ? String(report.thumbnail_asset_id) : '';
    if (form.elements.pdf_file) form.elements.pdf_file.value = '';
  }

  function openReportEditForm(report) {
    const editForm = document.getElementById('messagingReportsEditForm');
    const addForm = document.getElementById('messagingReportsForm');
    const addBtn = document.getElementById('messagingReportsToggleFormBtn');
    if (!editForm || !report) return;
    editForm.classList.remove('hidden');
    editForm.elements.id.value = String(report.id || '');
    fillFormFromReport(editForm, report);
    if (addForm) addForm.classList.add('hidden');
    if (addBtn) addBtn.textContent = 'Add Report';
    editForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeReportEditForm() {
    const editForm = document.getElementById('messagingReportsEditForm');
    if (!editForm) return;
    editForm.reset();
    editForm.classList.add('hidden');
  }

  function fillFormFromWhitePaper(form, whitePaper) {
    if (!form || !whitePaper) return;
    form.elements.platform.value = String(whitePaper.platform || '');
    form.elements.author.value = String(whitePaper.author || '');
    form.elements.publish_date.value = formatDateForInput(whitePaper.publish_date);
    form.elements.title.value = String(whitePaper.title || '');
    form.elements.subtitle.value = String(whitePaper.subtitle || '');
    form.elements.url.value = String(whitePaper.url || '');
    form.elements.content.value = String(whitePaper.content || '');
    if (form.elements.feedback) form.elements.feedback.value = String(whitePaper.feedback || '');
    form.elements.thumbnail_asset_id.value = whitePaper.thumbnail_asset_id ? String(whitePaper.thumbnail_asset_id) : '';
    if (form.elements.pdf_file) form.elements.pdf_file.value = '';
  }

  function openWhitePaperEditForm(whitePaper) {
    const editForm = document.getElementById('messagingWhitePapersEditForm');
    const addForm = document.getElementById('messagingWhitePapersForm');
    const addBtn = document.getElementById('messagingWhitePapersToggleFormBtn');
    if (!editForm || !whitePaper) return;
    editForm.classList.remove('hidden');
    editForm.elements.id.value = String(whitePaper.id || '');
    fillFormFromWhitePaper(editForm, whitePaper);
    if (addForm) addForm.classList.add('hidden');
    if (addBtn) addBtn.textContent = 'Add White Paper';
    editForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeWhitePaperEditForm() {
    const editForm = document.getElementById('messagingWhitePapersEditForm');
    if (!editForm) return;
    editForm.reset();
    editForm.classList.add('hidden');
  }

  function fillFormFromEbook(form, ebook) {
    if (!form || !ebook) return;
    form.elements.platform.value = String(ebook.platform || '');
    form.elements.author.value = String(ebook.author || '');
    form.elements.publish_date.value = formatDateForInput(ebook.publish_date);
    form.elements.title.value = String(ebook.title || '');
    form.elements.subtitle.value = String(ebook.subtitle || '');
    form.elements.url.value = String(ebook.url || '');
    form.elements.content.value = String(ebook.content || '');
    if (form.elements.feedback) form.elements.feedback.value = String(ebook.feedback || '');
    form.elements.thumbnail_asset_id.value = ebook.thumbnail_asset_id ? String(ebook.thumbnail_asset_id) : '';
    if (form.elements.pdf_file) form.elements.pdf_file.value = '';
  }

  function openEbookEditForm(ebook) {
    const editForm = document.getElementById('messagingEbooksEditForm');
    const addForm = document.getElementById('messagingEbooksForm');
    const addBtn = document.getElementById('messagingEbooksToggleFormBtn');
    if (!editForm || !ebook) return;
    editForm.classList.remove('hidden');
    editForm.elements.id.value = String(ebook.id || '');
    fillFormFromEbook(editForm, ebook);
    if (addForm) addForm.classList.add('hidden');
    if (addBtn) addBtn.textContent = 'Add eBook';
    editForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeEbookEditForm() {
    const editForm = document.getElementById('messagingEbooksEditForm');
    if (!editForm) return;
    editForm.reset();
    editForm.classList.add('hidden');
  }

  function openTweetEditForm(tweet) {
    const editForm = document.getElementById('messagingTweetsEditForm');
    const workspace = document.getElementById('messagingTweetsWorkspace');
    const addBtn = document.getElementById('messagingTweetsToggleFormBtn');
    if (!editForm || !tweet) return;
    editForm.classList.remove('hidden');
    editForm.elements.id.value = String(tweet.id || '');
    if (editForm.elements.topic) editForm.elements.topic.value = String(tweet.topic || tweet.category || '');
    editForm.elements.content.value = String(tweet.content || '');
    editForm.elements.url.value = String(tweet.url || '');
    editForm.elements.hashtags.value = String(tweet.hashtags || '');
    if (editForm.elements.feedback) editForm.elements.feedback.value = String(tweet.feedback || '');
    editForm.elements.image_asset_id.value = tweet.image_asset_id ? String(tweet.image_asset_id) : '';
    if (workspace) workspace.classList.add('hidden');
    if (addBtn) addBtn.textContent = 'Add Tweet';
    editForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeTweetEditForm() {
    const editForm = document.getElementById('messagingTweetsEditForm');
    if (!editForm) return;
    editForm.reset();
    editForm.classList.add('hidden');
  }

  function clearTweetSuggestions() {
    currentTweetSuggestions = [];
    const empty = document.getElementById('messagingTweetsSuggestionsEmpty');
    const shortWrap = document.getElementById('messagingTweetsShortSuggestions');
    const tbody = document.getElementById('messagingTweetsSuggestionsTable');
    const checkAll = document.getElementById('messagingTweetsSelectAllSuggestions');
    if (empty) empty.classList.remove('hidden');
    if (shortWrap) shortWrap.classList.add('hidden');
    if (tbody) tbody.innerHTML = '';
    if (checkAll) checkAll.checked = false;
  }

  function renderTweetSuggestions(options) {
    const empty = document.getElementById('messagingTweetsSuggestionsEmpty');
    const shortWrap = document.getElementById('messagingTweetsShortSuggestions');
    const tbody = document.getElementById('messagingTweetsSuggestionsTable');
    const checkAll = document.getElementById('messagingTweetsSelectAllSuggestions');
    if (!tbody) return;
    currentTweetSuggestions = Array.isArray(options)
      ? options.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    tbody.innerHTML = '';
    if (!currentTweetSuggestions.length) {
      clearTweetSuggestions();
      return;
    }
    if (checkAll) checkAll.checked = true;
    currentTweetSuggestions.forEach((option, index) => {
      const tr = document.createElement('tr');
      const selectTd = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.dataset.index = String(index);
      selectTd.appendChild(checkbox);
      tr.appendChild(selectTd);
      const valueTd = document.createElement('td');
      valueTd.textContent = option;
      tr.appendChild(valueTd);
      tbody.appendChild(tr);
    });
    if (empty) empty.classList.add('hidden');
    if (shortWrap) shortWrap.classList.remove('hidden');
  }

  async function generateTweetSuggestions() {
    const form = document.getElementById('messagingTweetsForm');
    const button = document.getElementById('messagingTweetsGenerateBtn');
    if (!form || !button) return;
    const formData = new FormData(form);
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Generating...';
    try {
      const imageSelect = document.getElementById('messagingTweetImageSelect');
      const imageLabel = imageSelect && imageSelect.selectedIndex >= 0
        ? String(imageSelect.options[imageSelect.selectedIndex]?.textContent || '').trim()
        : '';
      const result = await api('/api/messaging/content-suggestions', {
        method: 'POST',
        body: JSON.stringify({
          format: 'Tweets',
          topic: String(formData.get('topic') || '').trim(),
          primary: String(formData.get('content') || '').trim(),
          url: String(formData.get('url') || '').trim(),
          hashtags: String(formData.get('hashtags') || '').trim(),
          image_label: imageLabel,
        }),
      });
      const options = Array.isArray(result?.options)
        ? result.options
        : Array.isArray(result?.data?.options)
          ? result.data.options
          : [];
      renderTweetSuggestions(options);
      notify(options.length ? 'Tweet options generated' : 'No tweet options returned', !options.length);
    } catch (err) {
      notify(err.message, true);
    } finally {
      button.disabled = false;
      button.textContent = originalText || 'Generate Option(s)';
    }
  }

  async function saveSelectedTweetSuggestions() {
    const form = document.getElementById('messagingTweetsForm');
    const tbody = document.getElementById('messagingTweetsSuggestionsTable');
    if (!form || !tbody) return;
    const formData = new FormData(form);
    const selectedIndexes = Array.from(tbody.querySelectorAll('input[type="checkbox"][data-index]:checked'))
      .map((checkbox) => Number(checkbox.dataset.index || '-1'))
      .filter((index) => index >= 0 && index < currentTweetSuggestions.length);
    if (!selectedIndexes.length) {
      notify('Select at least one tweet option', true);
      return;
    }
    const basePayload = {
      topic: String(formData.get('topic') || '').trim(),
      url: String(formData.get('url') || '').trim(),
      hashtags: String(formData.get('hashtags') || '').trim(),
      image_asset_id: Number(formData.get('image_asset_id') || 0) || null,
    };
    for (const index of selectedIndexes) {
      await api('/api/messaging/tweets', {
        method: 'POST',
        body: JSON.stringify({
          ...basePayload,
          content: currentTweetSuggestions[index],
        }),
      });
    }
    notify(selectedIndexes.length === 1 ? 'Tweet saved' : `${selectedIndexes.length} tweets saved`);
    form.reset();
    clearTweetSuggestions();
    renderMessagingCategorySelects();
    renderImageOptions(document.getElementById('messagingTweetImageSelect'));
    const workspace = document.getElementById('messagingTweetsWorkspace');
    const toggleBtn = document.getElementById('messagingTweetsToggleFormBtn');
    if (workspace) workspace.classList.add('hidden');
    if (toggleBtn) toggleBtn.textContent = 'Add Tweet';
    await refreshTweets();
  }

  function normalizeSortText(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
  }

  function compareSortValues(left, right, type) {
    if (type === 'number') {
      const a = Number(left || 0) || 0;
      const b = Number(right || 0) || 0;
      if (a === b) return 0;
      return a < b ? -1 : 1;
    }

    if (type === 'date') {
      const a = String(left || '').trim();
      const b = String(right || '').trim();
      const aTime = a ? Date.parse(a) : NaN;
      const bTime = b ? Date.parse(b) : NaN;
      const aValid = Number.isFinite(aTime);
      const bValid = Number.isFinite(bTime);
      if (aValid || bValid) {
        const aValue = aValid ? aTime : -Infinity;
        const bValue = bValid ? bTime : -Infinity;
        if (aValue === bValue) return 0;
        return aValue < bValue ? -1 : 1;
      }
    }

    const aText = normalizeSortText(left);
    const bText = normalizeSortText(right);
    if (aText === bText) return 0;
    return aText < bText ? -1 : 1;
  }

  function sortTableRows(rows, sortState, columns) {
    const list = Array.isArray(rows) ? rows.slice() : [];
    const key = String(sortState?.sort?.key || '').trim();
    const dir = sortState?.sort?.dir === 'desc' ? 'desc' : 'asc';
    const column = Array.isArray(columns) ? columns.find((item) => item.key === key) : null;
    if (!column) return list;

    list.sort((a, b) => {
      const result = compareSortValues(
        typeof column.getValue === 'function' ? column.getValue(a) : a?.[key],
        typeof column.getValue === 'function' ? column.getValue(b) : b?.[key],
        column.type
      );
      return dir === 'asc' ? result : -result;
    });

    return list;
  }

  function updateSortButtonLabels(buttonMap, sortState) {
    if (!Array.isArray(buttonMap)) return;
    buttonMap.forEach((entry) => {
      const button = document.getElementById(entry.id);
      if (!button) return;
      const marker = sortState.sort.key === entry.key
        ? (sortState.sort.dir === 'asc' ? ' ▲' : ' ▼')
        : '';
      button.textContent = `${entry.label}${marker}`;
    });
  }

  function bindSortableTableButtons(definitions, sortState, rerender) {
    if (!Array.isArray(definitions)) return;
    definitions.forEach((entry) => {
      const button = document.getElementById(entry.id);
      if (!button) return;
      button.addEventListener('click', function () {
        if (sortState.sort.key === entry.key) {
          sortState.sort.dir = sortState.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          sortState.sort.key = entry.key;
          sortState.sort.dir = entry.defaultDir === 'desc' ? 'desc' : 'asc';
        }
        if (typeof rerender === 'function') rerender();
      });
    });
  }

  function renderArticlesTable(articles) {
    const tbody = document.getElementById('messagingArticlesTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    const rows = Array.isArray(articles) ? articles : [];
    const sortedRows = sortTableRows(rows, articleTableState, [
      { key: 'publish_date', type: 'date' },
      { key: 'title', type: 'text' },
      { key: 'platform', type: 'text' },
      { key: 'author', type: 'text' },
      { key: 'thumbnail_asset_id', type: 'number' },
    ]);
    currentArticles = rows.slice();
    updateSortButtonLabels([
      { id: 'messagingArticlesSortPublishBtn', key: 'publish_date', label: 'Publish Date' },
      { id: 'messagingArticlesSortTitleBtn', key: 'title', label: 'Title' },
      { id: 'messagingArticlesSortPlatformBtn', key: 'platform', label: 'Platform' },
      { id: 'messagingArticlesSortAuthorBtn', key: 'author', label: 'Author' },
      { id: 'messagingArticlesSortThumbnailBtn', key: 'thumbnail_asset_id', label: 'Thumbnail' },
    ], articleTableState);
    if (!sortedRows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.textContent = 'No articles yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    sortedRows.forEach((article) => {
      const tr = document.createElement('tr');
      const publish = article.publish_date ? new Date(article.publish_date).toLocaleDateString() : '-';
      const title = String(article.title || '').trim() || '-';
      const platform = String(article.platform || '').trim() || '-';
      const author = String(article.author || '').trim() || '-';
      const thumb = Number(article.thumbnail_asset_id || 0) || 0;

      [publish, title, platform, author].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });

      const thumbTd = document.createElement('td');
      if (thumb) {
        const asset = articleBannerAssets.find((a) => (Number(a.id || 0) || 0) === thumb)
          || allImageAssets.find((a) => (Number(a.id || 0) || 0) === thumb);
        const imageUrl = thumbnailUrlFromAsset(asset);
        if (imageUrl) {
          const img = document.createElement('img');
          img.src = imageUrl;
          img.alt = String(asset && asset.assetName ? asset.assetName : 'thumbnail');
          img.style.height = '50px';
          img.style.width = 'auto';
          img.style.display = 'block';
          thumbTd.appendChild(img);
        } else {
          thumbTd.textContent = '-';
        }
      } else {
        thumbTd.textContent = '-';
      }
      tr.appendChild(thumbTd);

      const actionsTd = document.createElement('td');
      actionsTd.className = 'messaging-content-actions-cell';
      const viewBtn = App.makeIconButton('view', 'View Article', function () {
        openMessagingDetailModal('View Article', [
          ['Publish Date', publish],
          ['Title', title],
          ['Platform', platform],
          ['Author', author],
          ['Subtitle', String(article.subtitle || '').trim() || '-'],
          ['URL', String(article.url || '').trim() || '-'],
          ['Content', String(article.content || '').trim() || '-'],
          ['Feedback', String(article.feedback || '').trim() || '-'],
        ]);
      });
      actionsTd.appendChild(viewBtn);

      const editBtn = App.makeIconButton('edit', 'Edit Article', function () {
        openEditForm(article);
      }, { marginLeft: '8px' });
      actionsTd.appendChild(editBtn);

      const cloneBtn = App.makeIconButton('clone', 'Clone Article', async function () {
        try {
          await cloneArticle(article);
          notify('Article cloned');
          await refreshArticles();
        } catch (err) {
          notify(err.message, true);
        }
      }, { marginLeft: '8px' });
      actionsTd.appendChild(cloneBtn);

      const deleteBtn = App.makeIconButton('delete', 'Delete Article', async function () {
        if (!confirm(`Delete article "${title}"?`)) return;
        try {
          await api(`/api/messaging/articles/${encodeURIComponent(article.id)}`, { method: 'DELETE' });
          notify('Article deleted');
          await refreshArticles();
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);

      tbody.appendChild(tr);
    });
  }

  async function refreshArticles() {
    const tbody = document.getElementById('messagingArticlesTable');
    if (!tbody) return;
    try {
      const res = await api('/api/messaging/articles?limit=200');
      renderArticlesTable(Array.isArray(res.articles) ? res.articles : []);
    } catch (err) {
      notify(`Could not load articles: ${err.message}`, true);
    }
  }

  function renderReportsTable(reports) {
    const tbody = document.getElementById('messagingReportsTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    const rows = Array.isArray(reports) ? reports : [];
    const sortedRows = sortTableRows(rows, reportTableState, [
      { key: 'publish_date', type: 'date' },
      { key: 'title', type: 'text' },
      { key: 'platform', type: 'text' },
      { key: 'author', type: 'text' },
      { key: 'thumbnail_asset_id', type: 'number' },
      { key: 'pdf_name', type: 'text' },
    ]);
    currentReports = rows.slice();
    updateSortButtonLabels([
      { id: 'messagingReportsSortPublishBtn', key: 'publish_date', label: 'Publish Date' },
      { id: 'messagingReportsSortTitleBtn', key: 'title', label: 'Title' },
      { id: 'messagingReportsSortPlatformBtn', key: 'platform', label: 'Platform' },
      { id: 'messagingReportsSortAuthorBtn', key: 'author', label: 'Author' },
      { id: 'messagingReportsSortThumbnailBtn', key: 'thumbnail_asset_id', label: 'Thumbnail' },
      { id: 'messagingReportsSortPdfBtn', key: 'pdf_name', label: 'PDF' },
    ], reportTableState);
    if (!sortedRows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = 'No reports yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    sortedRows.forEach((report) => {
      const tr = document.createElement('tr');
      const publish = report.publish_date ? new Date(report.publish_date).toLocaleDateString() : '-';
      const title = String(report.title || '').trim() || '-';
      const platform = String(report.platform || '').trim() || '-';
      const author = String(report.author || '').trim() || '-';
      const thumb = Number(report.thumbnail_asset_id || 0) || 0;

      [publish, title, platform, author].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });

      const thumbTd = document.createElement('td');
      if (thumb) {
        const asset = articleBannerAssets.find((a) => (Number(a.id || 0) || 0) === thumb)
          || allImageAssets.find((a) => (Number(a.id || 0) || 0) === thumb);
        const imageUrl = thumbnailUrlFromAsset(asset);
        if (imageUrl) {
          const img = document.createElement('img');
          img.src = imageUrl;
          img.alt = String(asset && asset.assetName ? asset.assetName : 'thumbnail');
          img.style.height = '50px';
          img.style.width = 'auto';
          img.style.display = 'block';
          thumbTd.appendChild(img);
        } else {
          thumbTd.textContent = '-';
        }
      } else {
        thumbTd.textContent = '-';
      }
      tr.appendChild(thumbTd);

      const pdfTd = document.createElement('td');
      const pdfDataUrl = String(report.pdf_data_url || '').trim();
      const pdfName = String(report.pdf_name || '').trim() || 'Download PDF';
      if (pdfDataUrl) {
        const a = document.createElement('a');
        a.href = pdfDataUrl;
        a.download = pdfName;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = pdfName;
        pdfTd.appendChild(a);
      } else {
        pdfTd.textContent = '-';
      }
      tr.appendChild(pdfTd);

      const actionsTd = document.createElement('td');
      const editBtn = App.makeIconButton('edit', 'Edit Report', function () {
        openReportEditForm(report);
      });
      actionsTd.appendChild(editBtn);

      const deleteBtn = App.makeIconButton('delete', 'Delete Report', async function () {
        if (!confirm(`Delete report "${title}"?`)) return;
        try {
          await api(`/api/messaging/reports/${encodeURIComponent(report.id)}`, { method: 'DELETE' });
          notify('Report deleted');
          await refreshReports();
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);

      tbody.appendChild(tr);
    });
  }

  async function refreshReports() {
    const tbody = document.getElementById('messagingReportsTable');
    if (!tbody) return;
    try {
      const res = await api('/api/messaging/reports?limit=200');
      renderReportsTable(Array.isArray(res.reports) ? res.reports : []);
    } catch (err) {
      notify(`Could not load reports: ${err.message}`, true);
    }
  }

  function renderWhitePapersTable(whitePapers) {
    const tbody = document.getElementById('messagingWhitePapersTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    const rows = Array.isArray(whitePapers) ? whitePapers : [];
    const sortedRows = sortTableRows(rows, whitePaperTableState, [
      { key: 'publish_date', type: 'date' },
      { key: 'title', type: 'text' },
      { key: 'platform', type: 'text' },
      { key: 'author', type: 'text' },
      { key: 'thumbnail_asset_id', type: 'number' },
      { key: 'pdf_name', type: 'text' },
    ]);
    currentWhitePapers = rows.slice();
    updateSortButtonLabels([
      { id: 'messagingWhitePapersSortPublishBtn', key: 'publish_date', label: 'Publish Date' },
      { id: 'messagingWhitePapersSortTitleBtn', key: 'title', label: 'Title' },
      { id: 'messagingWhitePapersSortPlatformBtn', key: 'platform', label: 'Platform' },
      { id: 'messagingWhitePapersSortAuthorBtn', key: 'author', label: 'Author' },
      { id: 'messagingWhitePapersSortThumbnailBtn', key: 'thumbnail_asset_id', label: 'Thumbnail' },
      { id: 'messagingWhitePapersSortPdfBtn', key: 'pdf_name', label: 'PDF' },
    ], whitePaperTableState);
    if (!sortedRows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = 'No white papers yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    sortedRows.forEach((whitePaper) => {
      const tr = document.createElement('tr');
      const publish = whitePaper.publish_date ? new Date(whitePaper.publish_date).toLocaleDateString() : '-';
      const title = String(whitePaper.title || '').trim() || '-';
      const platform = String(whitePaper.platform || '').trim() || '-';
      const author = String(whitePaper.author || '').trim() || '-';
      const thumb = Number(whitePaper.thumbnail_asset_id || 0) || 0;

      [publish, title, platform, author].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });

      const thumbTd = document.createElement('td');
      if (thumb) {
        const asset = articleBannerAssets.find((a) => (Number(a.id || 0) || 0) === thumb)
          || allImageAssets.find((a) => (Number(a.id || 0) || 0) === thumb);
        const imageUrl = thumbnailUrlFromAsset(asset);
        if (imageUrl) {
          const img = document.createElement('img');
          img.src = imageUrl;
          img.alt = String(asset && asset.assetName ? asset.assetName : 'thumbnail');
          img.style.height = '50px';
          img.style.width = 'auto';
          img.style.display = 'block';
          thumbTd.appendChild(img);
        } else {
          thumbTd.textContent = '-';
        }
      } else {
        thumbTd.textContent = '-';
      }
      tr.appendChild(thumbTd);

      const pdfTd = document.createElement('td');
      const pdfDataUrl = String(whitePaper.pdf_data_url || '').trim();
      const pdfName = String(whitePaper.pdf_name || '').trim() || 'Download PDF';
      if (pdfDataUrl) {
        const a = document.createElement('a');
        a.href = pdfDataUrl;
        a.download = pdfName;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = pdfName;
        pdfTd.appendChild(a);
      } else {
        pdfTd.textContent = '-';
      }
      tr.appendChild(pdfTd);

      const actionsTd = document.createElement('td');
      const editBtn = App.makeIconButton('edit', 'Edit White Paper', function () {
        openWhitePaperEditForm(whitePaper);
      });
      actionsTd.appendChild(editBtn);

      const deleteBtn = App.makeIconButton('delete', 'Delete White Paper', async function () {
        if (!confirm(`Delete white paper "${title}"?`)) return;
        try {
          await api(`/api/messaging/white-papers/${encodeURIComponent(whitePaper.id)}`, { method: 'DELETE' });
          notify('White paper deleted');
          await refreshWhitePapers();
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);

      tbody.appendChild(tr);
    });
  }

  async function refreshWhitePapers() {
    const tbody = document.getElementById('messagingWhitePapersTable');
    if (!tbody) return;
    try {
      const res = await api('/api/messaging/white-papers?limit=200');
      renderWhitePapersTable(Array.isArray(res.whitePapers) ? res.whitePapers : []);
    } catch (err) {
      notify(`Could not load white papers: ${err.message}`, true);
    }
  }

  function renderEbooksTable(ebooks) {
    const tbody = document.getElementById('messagingEbooksTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    const rows = Array.isArray(ebooks) ? ebooks : [];
    const sortedRows = sortTableRows(rows, ebookTableState, [
      { key: 'publish_date', type: 'date' },
      { key: 'title', type: 'text' },
      { key: 'platform', type: 'text' },
      { key: 'author', type: 'text' },
      { key: 'thumbnail_asset_id', type: 'number' },
      { key: 'pdf_name', type: 'text' },
    ]);
    currentEbooks = rows.slice();
    updateSortButtonLabels([
      { id: 'messagingEbooksSortPublishBtn', key: 'publish_date', label: 'Publish Date' },
      { id: 'messagingEbooksSortTitleBtn', key: 'title', label: 'Title' },
      { id: 'messagingEbooksSortPlatformBtn', key: 'platform', label: 'Platform' },
      { id: 'messagingEbooksSortAuthorBtn', key: 'author', label: 'Author' },
      { id: 'messagingEbooksSortThumbnailBtn', key: 'thumbnail_asset_id', label: 'Thumbnail' },
      { id: 'messagingEbooksSortPdfBtn', key: 'pdf_name', label: 'PDF' },
    ], ebookTableState);
    if (!sortedRows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = 'No eBooks yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    sortedRows.forEach((ebook) => {
      const tr = document.createElement('tr');
      const publish = ebook.publish_date ? new Date(ebook.publish_date).toLocaleDateString() : '-';
      const title = String(ebook.title || '').trim() || '-';
      const platform = String(ebook.platform || '').trim() || '-';
      const author = String(ebook.author || '').trim() || '-';
      const thumb = Number(ebook.thumbnail_asset_id || 0) || 0;

      [publish, title, platform, author].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });

      const thumbTd = document.createElement('td');
      if (thumb) {
        const asset = articleBannerAssets.find((a) => (Number(a.id || 0) || 0) === thumb)
          || allImageAssets.find((a) => (Number(a.id || 0) || 0) === thumb);
        const imageUrl = thumbnailUrlFromAsset(asset);
        if (imageUrl) {
          const img = document.createElement('img');
          img.src = imageUrl;
          img.alt = String(asset && asset.assetName ? asset.assetName : 'thumbnail');
          img.style.height = '50px';
          img.style.width = 'auto';
          img.style.display = 'block';
          thumbTd.appendChild(img);
        } else {
          thumbTd.textContent = '-';
        }
      } else {
        thumbTd.textContent = '-';
      }
      tr.appendChild(thumbTd);

      const pdfTd = document.createElement('td');
      const pdfDataUrl = String(ebook.pdf_data_url || '').trim();
      const pdfName = String(ebook.pdf_name || '').trim() || 'Download PDF';
      if (pdfDataUrl) {
        const a = document.createElement('a');
        a.href = pdfDataUrl;
        a.download = pdfName;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = pdfName;
        pdfTd.appendChild(a);
      } else {
        pdfTd.textContent = '-';
      }
      tr.appendChild(pdfTd);

      const actionsTd = document.createElement('td');
      const editBtn = App.makeIconButton('edit', 'Edit eBook', function () {
        openEbookEditForm(ebook);
      });
      actionsTd.appendChild(editBtn);

      const deleteBtn = App.makeIconButton('delete', 'Delete eBook', async function () {
        if (!confirm(`Delete eBook "${title}"?`)) return;
        try {
          await api(`/api/messaging/ebooks/${encodeURIComponent(ebook.id)}`, { method: 'DELETE' });
          notify('eBook deleted');
          await refreshEbooks();
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);

      tbody.appendChild(tr);
    });
  }

  async function refreshEbooks() {
    const tbody = document.getElementById('messagingEbooksTable');
    if (!tbody) return;
    try {
      const res = await api('/api/messaging/ebooks?limit=200');
      renderEbooksTable(Array.isArray(res.ebooks) ? res.ebooks : []);
    } catch (err) {
      notify(`Could not load eBooks: ${err.message}`, true);
    }
  }

  function renderTweetsTable(tweets) {
    const tbody = document.getElementById('messagingTweetsTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    const rows = Array.isArray(tweets) ? tweets : [];
    const sortedRows = sortTableRows(rows, tweetTableState, [
      { key: 'created_at', type: 'date' },
      { key: 'content', type: 'text' },
      { key: 'url', type: 'text' },
      { key: 'hashtags', type: 'text' },
      { key: 'image_asset_id', type: 'number' },
    ]);
    currentTweets = rows.slice();
    updateSortButtonLabels([
      { id: 'messagingTweetsSortCreatedBtn', key: 'created_at', label: 'Created' },
      { id: 'messagingTweetsSortContentBtn', key: 'content', label: 'Content' },
      { id: 'messagingTweetsSortUrlBtn', key: 'url', label: 'URL' },
      { id: 'messagingTweetsSortHashtagsBtn', key: 'hashtags', label: 'Hashtags' },
      { id: 'messagingTweetsSortImageBtn', key: 'image_asset_id', label: 'Image' },
    ], tweetTableState);
    if (!sortedRows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.textContent = 'No tweets yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    sortedRows.forEach((tweet) => {
      const tr = document.createElement('tr');
      const created = tweet.created_at ? new Date(tweet.created_at).toLocaleString() : '-';
      const content = String(tweet.content || '').trim() || '-';
      const url = String(tweet.url || '').trim();
      const hashtags = String(tweet.hashtags || '').trim() || '-';
      const imageId = Number(tweet.image_asset_id || 0) || 0;

      const createdTd = document.createElement('td');
      createdTd.textContent = created;
      tr.appendChild(createdTd);

      const contentTd = document.createElement('td');
      contentTd.textContent = content;
      tr.appendChild(contentTd);

      const urlTd = document.createElement('td');
      if (url && isValidHttpUrl(url)) {
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = url;
        urlTd.appendChild(a);
      } else {
        urlTd.textContent = url || '-';
      }
      tr.appendChild(urlTd);

      const hashtagsTd = document.createElement('td');
      hashtagsTd.textContent = hashtags;
      tr.appendChild(hashtagsTd);

      const imageTd = document.createElement('td');
      if (imageId) {
        const asset = tweetImageAssets.find((a) => (Number(a.id || 0) || 0) === imageId);
        const imageUrl = thumbnailUrlFromAsset(asset);
        if (imageUrl) {
          const img = document.createElement('img');
          img.src = imageUrl;
          img.alt = String(asset && asset.assetName ? asset.assetName : 'tweet image');
          img.style.height = '50px';
          img.style.width = 'auto';
          img.style.display = 'block';
          imageTd.appendChild(img);
        } else {
          imageTd.textContent = '-';
        }
      } else {
        imageTd.textContent = '-';
      }
      tr.appendChild(imageTd);

      const actionsTd = document.createElement('td');
      const editBtn = App.makeIconButton('edit', 'Edit Tweet', function () {
        openTweetEditForm(tweet);
      });
      actionsTd.appendChild(editBtn);

      const deleteBtn = App.makeIconButton('delete', 'Delete Tweet', async function () {
        if (!confirm('Delete this tweet?')) return;
        try {
          await api(`/api/messaging/tweets/${encodeURIComponent(tweet.id)}`, { method: 'DELETE' });
          notify('Tweet deleted');
          await refreshTweets();
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);

      tbody.appendChild(tr);
    });
  }

  async function refreshTweets() {
    const tbody = document.getElementById('messagingTweetsTable');
    if (!tbody) return;
    try {
      const res = await api('/api/messaging/tweets?limit=200');
      renderTweetsTable(Array.isArray(res.tweets) ? res.tweets : []);
    } catch (err) {
      notify(`Could not load tweets: ${err.message}`, true);
    }
  }

  function renderHashtagCampaignOptions() {
    const select = document.getElementById('messagingHashtagsCampaignSelect');
    const form = document.getElementById('messagingHashtagsForm');
    const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
    if (!select) return;

    const campaigns = Array.isArray(state.campaigns) ? state.campaigns.slice() : [];
    const currentValue = String(select.value || '');
    select.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = campaigns.length
      ? 'Select Campaign'
      : 'Campaign (placeholder until campaigns are created)';
    select.appendChild(placeholder);

    campaigns.forEach((campaign) => {
      const id = Number(campaign.id || 0) || 0;
      if (!id) return;
      const option = document.createElement('option');
      option.value = String(id);
      option.textContent = String(campaign.name || `Campaign ${id}`);
      select.appendChild(option);
    });

    if (currentValue && Array.from(select.options).some((option) => option.value === currentValue)) {
      select.value = currentValue;
    }

    const hasCampaigns = campaigns.some((campaign) => (Number(campaign.id || 0) || 0) > 0);
    select.disabled = !hasCampaigns;
    if (submitBtn) submitBtn.disabled = !hasCampaigns;
  }

  function parseBulkHashtags(text) {
    const raw = String(text || '');
    return Array.from(new Set(
      raw
        .split(/\s+/)
        .map((tag) => String(tag || '').trim())
        .filter(Boolean)
        .map((tag) => tag.replace(/^[#,]+/, ''))
        .filter(Boolean)
    ));
  }

  function renderHashtagsTable(hashtags) {
    const tbody = document.getElementById('messagingHashtagsTable');
    if (!tbody) return;
    const rows = Array.isArray(hashtags) ? hashtags : [];
    currentHashtags = rows.slice();
    tbody.innerHTML = '';

    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'No hashtags yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    const campaignsById = new Map((Array.isArray(state.campaigns) ? state.campaigns : []).map((campaign) => [String(campaign.id), campaign]));
    const grouped = new Map();
    rows.forEach((row) => {
      const key = String(row.campaign_id || '0');
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    });

    Array.from(grouped.entries()).forEach(([campaignId, items]) => {
      const campaign = campaignsById.get(campaignId);
      const campaignName = String(campaign?.name || '').trim() || `Campaign ${campaignId}`;

      const headingTr = document.createElement('tr');
      const headingTd = document.createElement('td');
      headingTd.colSpan = 5;
      headingTd.textContent = campaignName;
      headingTd.style.fontWeight = '700';
      headingTd.style.background = '#eef5ff';
      headingTr.appendChild(headingTd);
      tbody.appendChild(headingTr);

      const sortedItems = items.slice().sort((a, b) => String(a.hashtag || '').localeCompare(String(b.hashtag || '')));
      for (let i = 0; i < sortedItems.length; i += 5) {
        const chunk = sortedItems.slice(i, i + 5);
        const tr = document.createElement('tr');
        chunk.forEach((item) => {
          const td = document.createElement('td');
          td.textContent = String(item.hashtag || '');
          tr.appendChild(td);
        });
        while (tr.children.length < 5) {
          tr.appendChild(document.createElement('td'));
        }
        tbody.appendChild(tr);
      }
    });
  }

  async function refreshHashtags() {
    renderHashtagCampaignOptions();
    const tbody = document.getElementById('messagingHashtagsTable');
    if (!tbody) return;
    try {
      const res = await api('/api/messaging/hashtags?limit=5000');
      renderHashtagsTable(Array.isArray(res.hashtags) ? res.hashtags : []);
    } catch (err) {
      notify(`Could not load hashtags: ${err.message}`, true);
    }
  }

  function parseHeadlineTextarea(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((line) => String(line || '').trim())
      .filter(Boolean);
  }

  function fillHeadlineFormFromItem(form, item) {
    if (!form || !item) return;
    form.elements.id.value = String(item.id || '');
    form.elements.headline.value = String(item.headline || '');
    if (form.elements.topic) form.elements.topic.value = String(item.topic || item.category || '');
  }

  function openHeadlineEditForm(item) {
    const form = document.getElementById('messagingHeadlineEditForm');
    const createWrap = document.getElementById('messagingHeadlinesCreateWrap');
    const toggleBtn = document.getElementById('messagingHeadlinesToggleFormBtn');
    if (!form || !item) return;
    syncHeadlineCategorySelects();
    fillHeadlineFormFromItem(form, item);
    form.classList.remove('hidden');
    if (createWrap) createWrap.classList.add('hidden');
    if (toggleBtn) toggleBtn.textContent = 'Create Headlines';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeHeadlineEditForm() {
    const form = document.getElementById('messagingHeadlineEditForm');
    if (!form) return;
    form.reset();
    form.classList.add('hidden');
  }

  function getFilteredSortedHeadlines() {
    const headlineFilter = String(headlineTableState.filters.headline || '').trim().toLowerCase();
    const categoryFilter = String(headlineTableState.filters.category || '').trim();
    const formatFilter = String(document.getElementById('messagingHeadlinesFormatFilter')?.value || '').trim();

    const filtered = currentHeadlines.filter((item) => {
      const headline = String(item.headline || '').toLowerCase();
      const category = String(item.category || '').trim();
      if (headlineFilter && !headline.includes(headlineFilter)) return false;
      if (categoryFilter && category !== categoryFilter) return false;
      if (formatFilter && formatFilter !== 'Headlines') return false;
      return true;
    });

    filtered.sort((a, b) => {
      const key = headlineTableState.sort.key;
      let left = a?.[key];
      let right = b?.[key];
      if (key === 'created_at' || key === 'updated_at') {
        left = new Date(left || 0).getTime();
        right = new Date(right || 0).getTime();
      } else {
        left = String(left || '').toLowerCase();
        right = String(right || '').toLowerCase();
      }
      if (left === right) return 0;
      const result = left < right ? -1 : 1;
      return headlineTableState.sort.dir === 'asc' ? result : -result;
    });

    return filtered;
  }

  function syncHeadlineSortLabels() {
    const config = [
      ['messagingHeadlinesSortHeadlineBtn', 'headline', 'Headline'],
      ['messagingHeadlinesSortCategoryBtn', 'category', 'Topic'],
      ['messagingHeadlinesSortCreatedBtn', 'created_at', 'Created'],
      ['messagingHeadlinesSortUpdatedBtn', 'updated_at', 'Updated'],
    ];
    config.forEach(([id, key, label]) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      const marker = headlineTableState.sort.key === key
        ? (headlineTableState.sort.dir === 'asc' ? ' ▲' : ' ▼')
        : '';
      btn.textContent = `${label}${marker}`;
    });
  }

  function syncHeadlineBulkUi() {
    const selectAll = document.getElementById('messagingHeadlinesSelectAllVisible');
    const bulkBtn = document.getElementById('messagingHeadlinesBulkEditBtn');
    const visibleIds = getFilteredSortedHeadlines().map((item) => Number(item.id || 0)).filter(Boolean);
    const selectedVisible = visibleIds.filter((id) => selectedHeadlineIds.has(id));

    if (selectAll) {
      selectAll.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
      selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
    }
    if (bulkBtn) bulkBtn.disabled = selectedHeadlineIds.size === 0;
  }

  function renderHeadlinesTable(headlines) {
    const tbody = document.getElementById('messagingHeadlinesTable');
    if (!tbody) return;
    currentHeadlines = Array.isArray(headlines) ? headlines.slice() : [];
    tbody.innerHTML = '';
    syncHeadlineSortLabels();
    syncHeadlineCategorySelects();

    const validIds = new Set(currentHeadlines.map((item) => Number(item.id || 0)).filter(Boolean));
    Array.from(selectedHeadlineIds).forEach((id) => {
      if (!validIds.has(id)) selectedHeadlineIds.delete(id);
    });

    const rows = getFilteredSortedHeadlines();
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = 'No headlines match current filters.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      syncHeadlineBulkUi();
      return;
    }

    rows.forEach((item) => {
      const tr = document.createElement('tr');

      const selectTd = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedHeadlineIds.has(item.id);
      checkbox.addEventListener('change', function () {
        if (checkbox.checked) selectedHeadlineIds.add(item.id);
        else selectedHeadlineIds.delete(item.id);
        syncHeadlineBulkUi();
      });
      selectTd.appendChild(checkbox);
      tr.appendChild(selectTd);

      [
        String(item.headline || '').trim() || '-',
        String(item.category || '').trim() || '-',
        'Headlines',
        item.created_at ? new Date(item.created_at).toLocaleString() : '-',
        item.updated_at ? new Date(item.updated_at).toLocaleString() : '-',
      ].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });

      const actionsTd = document.createElement('td');
      const editBtn = App.makeIconButton('edit', 'Edit Headline', function () {
        openHeadlineEditForm(item);
      });
      const deleteBtn = App.makeIconButton('delete', 'Delete Headline', async function () {
        if (!confirm(`Delete headline "${item.headline}"?`)) return;
        try {
          await api(`/api/messaging/headlines/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
          notify('Headline deleted');
          await refreshHeadlines();
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });

    syncHeadlineBulkUi();
  }

  async function refreshHeadlines() {
    const tbody = document.getElementById('messagingHeadlinesTable');
    if (!tbody) return;
    try {
      const res = await api('/api/messaging/headlines?limit=5000');
      renderHeadlinesTable(Array.isArray(res.headlines) ? res.headlines : []);
    } catch (err) {
      notify(`Could not load headlines: ${err.message}`, true);
    }
  }

  function parseSubheadingTextarea(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((line) => String(line || '').trim())
      .filter(Boolean);
  }

  function fillSubheadingFormFromItem(form, item) {
    if (!form || !item) return;
    form.elements.id.value = String(item.id || '');
    form.elements.subheading.value = String(item.subheading || '');
    if (form.elements.topic) form.elements.topic.value = String(item.topic || item.category || '');
  }

  function openSubheadingEditForm(item) {
    const form = document.getElementById('messagingSubheadingEditForm');
    const createWrap = document.getElementById('messagingSubheadingsCreateWrap');
    const toggleBtn = document.getElementById('messagingSubheadingsToggleFormBtn');
    if (!form || !item) return;
    syncHeadlineCategorySelects();
    fillSubheadingFormFromItem(form, item);
    form.classList.remove('hidden');
    if (createWrap) createWrap.classList.add('hidden');
    if (toggleBtn) toggleBtn.textContent = 'Create Sub-headings';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeSubheadingEditForm() {
    const form = document.getElementById('messagingSubheadingEditForm');
    if (!form) return;
    form.reset();
    form.classList.add('hidden');
  }

  function getFilteredSortedSubheadings() {
    const textFilter = String(subheadingTableState.filters.subheading || '').trim().toLowerCase();
    const categoryFilter = String(subheadingTableState.filters.category || '').trim();

    const filtered = currentSubheadings.filter((item) => {
      const text = String(item.subheading || '').toLowerCase();
      const category = String(item.category || '').trim();
      if (textFilter && !text.includes(textFilter)) return false;
      if (categoryFilter && category !== categoryFilter) return false;
      return true;
    });

    filtered.sort((a, b) => {
      const key = subheadingTableState.sort.key;
      let left = a?.[key];
      let right = b?.[key];
      if (key === 'created_at' || key === 'updated_at') {
        left = new Date(left || 0).getTime();
        right = new Date(right || 0).getTime();
      } else {
        left = String(left || '').toLowerCase();
        right = String(right || '').toLowerCase();
      }
      if (left === right) return 0;
      const result = left < right ? -1 : 1;
      return subheadingTableState.sort.dir === 'asc' ? result : -result;
    });

    return filtered;
  }

  function syncSubheadingSortLabels() {
    const config = [
      ['messagingSubheadingsSortTextBtn', 'subheading', 'Sub-heading'],
      ['messagingSubheadingsSortCategoryBtn', 'category', 'Format'],
      ['messagingSubheadingsSortCreatedBtn', 'created_at', 'Created'],
      ['messagingSubheadingsSortUpdatedBtn', 'updated_at', 'Updated'],
    ];
    config.forEach(([id, key, label]) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      const marker = subheadingTableState.sort.key === key
        ? (subheadingTableState.sort.dir === 'asc' ? ' ▲' : ' ▼')
        : '';
      btn.textContent = `${label}${marker}`;
    });
  }

  function syncSubheadingBulkUi() {
    const selectAll = document.getElementById('messagingSubheadingsSelectAllVisible');
    const bulkBtn = document.getElementById('messagingSubheadingsBulkEditBtn');
    const visibleIds = getFilteredSortedSubheadings().map((item) => Number(item.id || 0)).filter(Boolean);
    const selectedVisible = visibleIds.filter((id) => selectedSubheadingIds.has(id));

    if (selectAll) {
      selectAll.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
      selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
    }
    if (bulkBtn) bulkBtn.disabled = selectedSubheadingIds.size === 0;
  }

  function renderSubheadingsTable(subheadings) {
    const tbody = document.getElementById('messagingSubheadingsTable');
    if (!tbody) return;
    currentSubheadings = Array.isArray(subheadings) ? subheadings.slice() : [];
    tbody.innerHTML = '';
    syncSubheadingSortLabels();
    syncHeadlineCategorySelects();

    const validIds = new Set(currentSubheadings.map((item) => Number(item.id || 0)).filter(Boolean));
    Array.from(selectedSubheadingIds).forEach((id) => {
      if (!validIds.has(id)) selectedSubheadingIds.delete(id);
    });

    const rows = getFilteredSortedSubheadings();
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.textContent = 'No sub-headings match current filters.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      syncSubheadingBulkUi();
      return;
    }

    rows.forEach((item) => {
      const tr = document.createElement('tr');

      const selectTd = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedSubheadingIds.has(item.id);
      checkbox.addEventListener('change', function () {
        if (checkbox.checked) selectedSubheadingIds.add(item.id);
        else selectedSubheadingIds.delete(item.id);
        syncSubheadingBulkUi();
      });
      selectTd.appendChild(checkbox);
      tr.appendChild(selectTd);

      [
        String(item.subheading || '').trim() || '-',
        String(item.category || '').trim() || '-',
        item.created_at ? new Date(item.created_at).toLocaleString() : '-',
        item.updated_at ? new Date(item.updated_at).toLocaleString() : '-',
      ].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });

      const actionsTd = document.createElement('td');
      const editBtn = App.makeIconButton('edit', 'Edit Sub-heading', function () {
        openSubheadingEditForm(item);
      });
      const deleteBtn = App.makeIconButton('delete', 'Delete Sub-heading', async function () {
        if (!confirm(`Delete sub-heading "${item.subheading}"?`)) return;
        try {
          await api(`/api/messaging/subheadings/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
          notify('Sub-heading deleted');
          await refreshSubheadings();
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });

    syncSubheadingBulkUi();
  }

  async function refreshSubheadings() {
    const tbody = document.getElementById('messagingSubheadingsTable');
    if (!tbody) return;
    try {
      const res = await api('/api/messaging/subheadings?limit=5000');
      renderSubheadingsTable(Array.isArray(res.subheadings) ? res.subheadings : []);
    } catch (err) {
      notify(`Could not load sub-headings: ${err.message}`, true);
    }
  }

  function parseTaglineTextarea(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((line) => String(line || '').trim())
      .filter(Boolean);
  }

  function fillTaglineFormFromItem(form, item) {
    if (!form || !item) return;
    form.elements.id.value = String(item.id || '');
    form.elements.tagline.value = String(item.tagline || '');
    if (form.elements.topic) form.elements.topic.value = String(item.topic || item.category || '');
  }

  function openTaglineEditForm(item) {
    const form = document.getElementById('messagingTaglineEditForm');
    const createWrap = document.getElementById('messagingTaglinesCreateWrap');
    const toggleBtn = document.getElementById('messagingTaglinesToggleFormBtn');
    if (!form || !item) return;
    syncHeadlineCategorySelects();
    fillTaglineFormFromItem(form, item);
    form.classList.remove('hidden');
    if (createWrap) createWrap.classList.add('hidden');
    if (toggleBtn) toggleBtn.textContent = 'Create Taglines';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeTaglineEditForm() {
    const form = document.getElementById('messagingTaglineEditForm');
    if (!form) return;
    form.reset();
    form.classList.add('hidden');
  }

  function getFilteredSortedTaglines() {
    const textFilter = String(taglineTableState.filters.tagline || '').trim().toLowerCase();
    const categoryFilter = String(taglineTableState.filters.category || '').trim();

    const filtered = currentTaglines.filter((item) => {
      const text = String(item.tagline || '').toLowerCase();
      const category = String(item.category || '').trim();
      if (textFilter && !text.includes(textFilter)) return false;
      if (categoryFilter && category !== categoryFilter) return false;
      return true;
    });

    filtered.sort((a, b) => {
      const key = taglineTableState.sort.key;
      let left = a?.[key];
      let right = b?.[key];
      if (key === 'created_at' || key === 'updated_at') {
        left = new Date(left || 0).getTime();
        right = new Date(right || 0).getTime();
      } else {
        left = String(left || '').toLowerCase();
        right = String(right || '').toLowerCase();
      }
      if (left === right) return 0;
      const result = left < right ? -1 : 1;
      return taglineTableState.sort.dir === 'asc' ? result : -result;
    });

    return filtered;
  }

  function syncTaglineSortLabels() {
    const config = [
      ['messagingTaglinesSortTextBtn', 'tagline', 'Tagline'],
      ['messagingTaglinesSortCategoryBtn', 'category', 'Format'],
      ['messagingTaglinesSortCreatedBtn', 'created_at', 'Created'],
      ['messagingTaglinesSortUpdatedBtn', 'updated_at', 'Updated'],
    ];
    config.forEach(([id, key, label]) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      const marker = taglineTableState.sort.key === key
        ? (taglineTableState.sort.dir === 'asc' ? ' ▲' : ' ▼')
        : '';
      btn.textContent = `${label}${marker}`;
    });
  }

  function syncTaglineBulkUi() {
    const selectAll = document.getElementById('messagingTaglinesSelectAllVisible');
    const bulkBtn = document.getElementById('messagingTaglinesBulkEditBtn');
    const visibleIds = getFilteredSortedTaglines().map((item) => Number(item.id || 0)).filter(Boolean);
    const selectedVisible = visibleIds.filter((id) => selectedTaglineIds.has(id));

    if (selectAll) {
      selectAll.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
      selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
    }
    if (bulkBtn) bulkBtn.disabled = selectedTaglineIds.size === 0;
  }

  function renderTaglinesTable(taglines) {
    const tbody = document.getElementById('messagingTaglinesTable');
    if (!tbody) return;
    currentTaglines = Array.isArray(taglines) ? taglines.slice() : [];
    tbody.innerHTML = '';
    syncTaglineSortLabels();
    syncHeadlineCategorySelects();

    const validIds = new Set(currentTaglines.map((item) => Number(item.id || 0)).filter(Boolean));
    Array.from(selectedTaglineIds).forEach((id) => {
      if (!validIds.has(id)) selectedTaglineIds.delete(id);
    });

    const rows = getFilteredSortedTaglines();
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.textContent = 'No taglines match current filters.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      syncTaglineBulkUi();
      return;
    }

    rows.forEach((item) => {
      const tr = document.createElement('tr');

      const selectTd = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedTaglineIds.has(item.id);
      checkbox.addEventListener('change', function () {
        if (checkbox.checked) selectedTaglineIds.add(item.id);
        else selectedTaglineIds.delete(item.id);
        syncTaglineBulkUi();
      });
      selectTd.appendChild(checkbox);
      tr.appendChild(selectTd);

      [
        String(item.tagline || '').trim() || '-',
        String(item.category || '').trim() || '-',
        item.created_at ? new Date(item.created_at).toLocaleString() : '-',
        item.updated_at ? new Date(item.updated_at).toLocaleString() : '-',
      ].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });

      const actionsTd = document.createElement('td');
      const editBtn = App.makeIconButton('edit', 'Edit Tagline', function () {
        openTaglineEditForm(item);
      });
      const deleteBtn = App.makeIconButton('delete', 'Delete Tagline', async function () {
        if (!confirm(`Delete tagline "${item.tagline}"?`)) return;
        try {
          await api(`/api/messaging/taglines/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
          notify('Tagline deleted');
          await refreshTaglines();
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });

    syncTaglineBulkUi();
  }

  async function refreshTaglines() {
    const tbody = document.getElementById('messagingTaglinesTable');
    if (!tbody) return;
    try {
      const res = await api('/api/messaging/taglines?limit=5000');
      renderTaglinesTable(Array.isArray(res.taglines) ? res.taglines : []);
    } catch (err) {
      notify(`Could not load taglines: ${err.message}`, true);
    }
  }

  function parsePitchTextarea(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((line) => String(line || '').trim())
      .filter(Boolean);
  }

  function fillPitchFormFromItem(form, item) {
    if (!form || !item) return;
    form.elements.id.value = String(item.id || '');
    form.elements.pitch.value = String(item.pitch || '');
    if (form.elements.topic) form.elements.topic.value = String(item.topic || item.category || '');
  }

  function openPitchEditForm(item) {
    const form = document.getElementById('messagingPitchEditForm');
    const createWrap = document.getElementById('messagingPitchesCreateWrap');
    const toggleBtn = document.getElementById('messagingPitchesToggleFormBtn');
    if (!form || !item) return;
    syncHeadlineCategorySelects();
    fillPitchFormFromItem(form, item);
    form.classList.remove('hidden');
    if (createWrap) createWrap.classList.add('hidden');
    if (toggleBtn) toggleBtn.textContent = 'Create Pitches';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closePitchEditForm() {
    const form = document.getElementById('messagingPitchEditForm');
    if (!form) return;
    form.reset();
    form.classList.add('hidden');
  }

  function getFilteredSortedPitches() {
    const textFilter = String(pitchTableState.filters.pitch || '').trim().toLowerCase();
    const categoryFilter = String(pitchTableState.filters.category || '').trim();

    const filtered = currentPitches.filter((item) => {
      const text = String(item.pitch || '').toLowerCase();
      const category = String(item.category || '').trim();
      if (textFilter && !text.includes(textFilter)) return false;
      if (categoryFilter && category !== categoryFilter) return false;
      return true;
    });

    filtered.sort((a, b) => {
      const key = pitchTableState.sort.key;
      let left = a?.[key];
      let right = b?.[key];
      if (key === 'created_at' || key === 'updated_at') {
        left = new Date(left || 0).getTime();
        right = new Date(right || 0).getTime();
      } else {
        left = String(left || '').toLowerCase();
        right = String(right || '').toLowerCase();
      }
      if (left === right) return 0;
      const result = left < right ? -1 : 1;
      return pitchTableState.sort.dir === 'asc' ? result : -result;
    });

    return filtered;
  }

  function syncPitchSortLabels() {
    const config = [
      ['messagingPitchesSortTextBtn', 'pitch', 'Pitch'],
      ['messagingPitchesSortCategoryBtn', 'category', 'Format'],
      ['messagingPitchesSortCreatedBtn', 'created_at', 'Created'],
      ['messagingPitchesSortUpdatedBtn', 'updated_at', 'Updated'],
    ];
    config.forEach(([id, key, label]) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      const marker = pitchTableState.sort.key === key
        ? (pitchTableState.sort.dir === 'asc' ? ' ▲' : ' ▼')
        : '';
      btn.textContent = `${label}${marker}`;
    });
  }

  function syncPitchBulkUi() {
    const selectAll = document.getElementById('messagingPitchesSelectAllVisible');
    const bulkBtn = document.getElementById('messagingPitchesBulkEditBtn');
    const visibleIds = getFilteredSortedPitches().map((item) => Number(item.id || 0)).filter(Boolean);
    const selectedVisible = visibleIds.filter((id) => selectedPitchIds.has(id));

    if (selectAll) {
      selectAll.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
      selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
    }
    if (bulkBtn) bulkBtn.disabled = selectedPitchIds.size === 0;
  }

  function renderPitchesTable(pitches) {
    const tbody = document.getElementById('messagingPitchesTable');
    if (!tbody) return;
    currentPitches = Array.isArray(pitches) ? pitches.slice() : [];
    tbody.innerHTML = '';
    syncPitchSortLabels();
    syncHeadlineCategorySelects();

    const validIds = new Set(currentPitches.map((item) => Number(item.id || 0)).filter(Boolean));
    Array.from(selectedPitchIds).forEach((id) => {
      if (!validIds.has(id)) selectedPitchIds.delete(id);
    });

    const rows = getFilteredSortedPitches();
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.textContent = 'No pitches match current filters.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      syncPitchBulkUi();
      return;
    }

    rows.forEach((item) => {
      const tr = document.createElement('tr');

      const selectTd = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedPitchIds.has(item.id);
      checkbox.addEventListener('change', function () {
        if (checkbox.checked) selectedPitchIds.add(item.id);
        else selectedPitchIds.delete(item.id);
        syncPitchBulkUi();
      });
      selectTd.appendChild(checkbox);
      tr.appendChild(selectTd);

      [
        String(item.pitch || '').trim() || '-',
        String(item.category || '').trim() || '-',
        item.created_at ? new Date(item.created_at).toLocaleString() : '-',
        item.updated_at ? new Date(item.updated_at).toLocaleString() : '-',
      ].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });

      const actionsTd = document.createElement('td');
      const editBtn = App.makeIconButton('edit', 'Edit Pitch', function () {
        openPitchEditForm(item);
      });
      const deleteBtn = App.makeIconButton('delete', 'Delete Pitch', async function () {
        if (!confirm(`Delete pitch "${item.pitch}"?`)) return;
        try {
          await api(`/api/messaging/pitches/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
          notify('Pitch deleted');
          await refreshPitches();
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });

    syncPitchBulkUi();
  }

  async function refreshPitches() {
    const tbody = document.getElementById('messagingPitchesTable');
    if (!tbody) return;
    try {
      const res = await api('/api/messaging/pitches?limit=5000');
      renderPitchesTable(Array.isArray(res.pitches) ? res.pitches : []);
    } catch (err) {
      notify(`Could not load pitches: ${err.message}`, true);
    }
  }

  function parseSimpleContentTextarea(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((line) => String(line || '').trim())
      .filter(Boolean);
  }

  function getSimpleContentConfig(key) {
    return simpleContentConfigs.find((config) => config.key === key) || null;
  }

  function updateMessagingContentFilterBar() {
    const bar = document.getElementById('messagingContentFilterBar');
    const label = document.getElementById('messagingContentFilterLabel');
    const clearBtn = document.getElementById('messagingContentClearFilterBtn');
    if (!bar || !label) return;
    if (!activeMessagingContentCategory) {
      label.textContent = 'Format Filter: All Formats';
      bar.classList.remove('hidden');
      if (clearBtn) clearBtn.disabled = true;
      return;
    }
    label.textContent = `Format Filter: ${activeMessagingContentCategory}`;
    bar.classList.remove('hidden');
    if (clearBtn) clearBtn.disabled = false;
  }

  function applyMessagingCategoryFilterToTarget(targetPageId, category) {
    const normalizedCategory = String(category || '').trim();
    if (!normalizedCategory) return;

    const pageToFilterId = {
      messagingHeadlinesPage: 'messagingHeadlinesCategoryFilter',
      messagingSubheadingsPage: 'messagingSubheadingsCategoryFilter',
      messagingTaglinesPage: 'messagingTaglinesCategoryFilter',
      messagingPitchesPage: 'messagingPitchesCategoryFilter',
    }[targetPageId];

    if (pageToFilterId) {
      const select = document.getElementById(pageToFilterId);
      if (select) select.value = normalizedCategory;
      if (targetPageId === 'messagingHeadlinesPage') headlineTableState.filters.category = normalizedCategory;
      if (targetPageId === 'messagingSubheadingsPage') subheadingTableState.filters.category = normalizedCategory;
      if (targetPageId === 'messagingTaglinesPage') taglineTableState.filters.category = normalizedCategory;
      if (targetPageId === 'messagingPitchesPage') pitchTableState.filters.category = normalizedCategory;
      return;
    }

    const simpleConfig = simpleContentConfigs.find((config) => config.pageId === targetPageId);
    if (!simpleConfig) return;
    const ids = getSimpleContentIds(simpleConfig);
    const stateForType = simpleContentState[simpleConfig.key];
    if (stateForType && stateForType.filters) {
      stateForType.filters.category = normalizedCategory;
    }
    const select = document.getElementById(ids.categoryFilterId);
    if (select) select.value = normalizedCategory;
  }

  function openContentLanding() {
    activeMessagingContentCategory = '';
    updateMessagingContentFilterBar();
    App.setActivePage('messagingContentPage');
    renderMessagingContentLibraryTable();
    return false;
  }

  function setTopicsCreateVisible(visible) {
    const panel = document.getElementById('messagingTopicCreatePanel');
    if (!panel) return;
    panel.classList.toggle('hidden', !visible);
  }

  function openTopicsPage() {
    setTopicsCreateVisible(false);
    clearMessagingTopicSuggestions();
    App.setActivePage('messagingCategoriesPage');
    refreshMessagingCategories().catch(function (err) {
      notify(`Could not load messaging topics: ${err.message}`, true);
    });
    window.setTimeout(function () {
      refreshMessagingCategories().catch(function () {});
    }, 250);
    return false;
  }

  function clearMessagingTopicSuggestions() {
    currentMessagingTopicSuggestions = [];
    const wrap = document.getElementById('messagingTopicsSuggestionsWrap');
    const columns = document.getElementById('messagingTopicsSuggestionsColumns');
    const meta = document.getElementById('messagingTopicsSuggestionsMeta');
    const selectAll = document.getElementById('messagingTopicsSelectAllSuggestions');
    if (wrap) wrap.classList.add('hidden');
    if (columns) columns.innerHTML = '';
    if (meta) meta.textContent = '';
    if (selectAll) selectAll.checked = false;
  }

  function startMessagingTopicsProgress() {
    const wrap = document.getElementById('messagingTopicsProgressWrap');
    const bar = document.getElementById('messagingTopicsProgressBar');
    const text = document.getElementById('messagingTopicsProgressText');
    const button = document.getElementById('messagingTopicsGenerateBtn');
    if (wrap) wrap.classList.remove('hidden');
    if (bar) bar.value = 10;
    if (text) text.textContent = 'Reviewing website data and training context...';
    if (button) button.disabled = true;
    if (messagingTopicsProgressTimer) clearInterval(messagingTopicsProgressTimer);
    messagingTopicsProgressTimer = setInterval(function () {
      if (!bar) return;
      const current = Number(bar.value || 0);
      if (current < 82) bar.value = current + 4;
    }, 700);
  }

  function finishMessagingTopicsProgress(success, message) {
    const wrap = document.getElementById('messagingTopicsProgressWrap');
    const bar = document.getElementById('messagingTopicsProgressBar');
    const text = document.getElementById('messagingTopicsProgressText');
    const button = document.getElementById('messagingTopicsGenerateBtn');
    if (messagingTopicsProgressTimer) {
      clearInterval(messagingTopicsProgressTimer);
      messagingTopicsProgressTimer = null;
    }
    if (bar) bar.value = success ? 100 : 0;
    if (text && message) text.textContent = message;
    if (button) button.disabled = false;
    window.setTimeout(function () {
      if (wrap) wrap.classList.add('hidden');
    }, success ? 900 : 1800);
  }

  function renderMessagingTopicSuggestions(groups, sourceUrl) {
    const wrap = document.getElementById('messagingTopicsSuggestionsWrap');
    const columns = document.getElementById('messagingTopicsSuggestionsColumns');
    const meta = document.getElementById('messagingTopicsSuggestionsMeta');
    const selectAll = document.getElementById('messagingTopicsSelectAllSuggestions');
    if (!columns || !wrap) return;
    currentMessagingTopicSuggestions = Array.isArray(groups)
      ? groups.map((group, groupIndex) => ({
          label: cleanText(group?.label || `Group ${groupIndex + 1}`),
          topics: Array.isArray(group?.topics)
            ? group.topics.map((topic, topicIndex) => ({
                id: `topic-suggestion-${groupIndex}-${topicIndex}`,
                topic: cleanText(topic),
              })).filter((row) => row.topic)
            : [],
        })).filter((group) => group.topics.length)
      : [];
    columns.innerHTML = '';
    if (!currentMessagingTopicSuggestions.length) {
      clearMessagingTopicSuggestions();
      return;
    }
    currentMessagingTopicSuggestions.forEach(function (group, groupIndex) {
      const card = document.createElement('div');
      card.className = 'messaging-topics-suggestion-card';
      const title = document.createElement('h4');
      title.textContent = group.label || `Group ${groupIndex + 1}`;
      card.appendChild(title);
      const list = document.createElement('div');
      list.className = 'messaging-topics-suggestion-list';
      group.topics.forEach(function (topicItem, topicIndex) {
        const label = document.createElement('label');
        label.className = 'checkbox-row';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.setAttribute('data-topic-suggestion-group', String(groupIndex));
        checkbox.setAttribute('data-topic-suggestion-index', String(topicIndex));
        const text = document.createElement('span');
        text.textContent = topicItem.topic;
        label.appendChild(checkbox);
        label.appendChild(text);
        list.appendChild(label);
      });
      card.appendChild(list);
      columns.appendChild(card);
    });
    if (meta) {
      const groupCount = currentMessagingTopicSuggestions.length;
      const topicCount = currentMessagingTopicSuggestions.reduce(function (sum, group) {
        return sum + group.topics.length;
      }, 0);
      meta.textContent = `${topicCount} suggested topics in ${groupCount} groups${sourceUrl ? ` from ${sourceUrl}` : ''}.`;
    }
    if (selectAll) selectAll.checked = true;
    wrap.classList.remove('hidden');
  }

  async function generateMessagingTopicSuggestions() {
    startMessagingTopicsProgress();
    try {
      const result = await api('/api/messaging/topic-suggestions', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const groups = Array.isArray(result?.groups)
        ? result.groups
        : Array.isArray(result?.data?.groups)
          ? result.data.groups
          : [];
      renderMessagingTopicSuggestions(groups, cleanText(result?.source_url || result?.data?.source_url));
      const total = groups.reduce(function (sum, group) {
        return sum + (Array.isArray(group?.topics) ? group.topics.length : 0);
      }, 0);
      finishMessagingTopicsProgress(true, `Generated ${total} topic suggestion${total === 1 ? '' : 's'}.`);
      notify(total ? `Generated ${total} topic suggestion${total === 1 ? '' : 's'}` : 'No topic suggestions returned', !total);
    } catch (err) {
      finishMessagingTopicsProgress(false, err.message || 'Topic suggestion generation failed.');
      notify(err.message, true);
    }
  }

  async function saveSelectedMessagingTopicSuggestions() {
    const selected = Array.from(document.querySelectorAll('#messagingTopicsSuggestionsColumns input[type="checkbox"][data-topic-suggestion-group]:checked'))
      .map(function (input) {
        const groupIndex = Number(input.getAttribute('data-topic-suggestion-group'));
        const topicIndex = Number(input.getAttribute('data-topic-suggestion-index'));
        const group = currentMessagingTopicSuggestions[groupIndex];
        const item = group && Array.isArray(group.topics) ? group.topics[topicIndex] : null;
        return cleanText(item?.topic);
      })
      .filter(Boolean);
    if (!selected.length) {
      notify('Select at least one suggested topic', true);
      return false;
    }
    const existing = new Set(
      (Array.isArray(currentMessagingTopics) ? currentMessagingTopics : [])
        .map((item) => cleanText(item?.topic || item?.category).toLowerCase())
        .filter(Boolean)
    );
    let created = 0;
    let skipped = 0;
    for (const topic of selected) {
      const key = topic.toLowerCase();
      if (existing.has(key)) {
        skipped += 1;
        continue;
      }
      await api('/api/messaging/topics', {
        method: 'POST',
        body: JSON.stringify({ topic }),
      });
      existing.add(key);
      created += 1;
    }
    await refreshMessagingCategories();
    notify(
      created
        ? `Saved ${created} topic${created === 1 ? '' : 's'}${skipped ? ` (${skipped} already existed)` : ''}`
        : `No new topics saved${skipped ? ` (${skipped} already existed)` : ''}`
    );
    return true;
  }

  function openTopicsCreate() {
    const form = document.getElementById('messagingCategoryForm');
    if (form) form.reset();
    setTopicsCreateVisible(true);
    App.setActivePage('messagingCategoriesPage');
    const panel = document.getElementById('messagingTopicCreatePanel');
    if (panel && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return false;
  }

  function openCategoriesLanding() {
    return openTopicsPage();
  }

  function openTopicsLanding() {
    return openTopicsPage();
  }

  function setTagsCreateVisible(visible) {
    const panel = document.getElementById('messagingTagCreatePanel');
    if (!panel) return;
    panel.classList.toggle('hidden', !visible);
  }

  function openTagsPage() {
    setTagsCreateVisible(false);
    App.setActivePage('messagingTagsPage');
    refreshMessagingTags().catch(function (err) {
      notify(`Could not load messaging tags: ${err.message}`, true);
    });
    window.setTimeout(function () {
      refreshMessagingTags().catch(function () {});
    }, 250);
    return false;
  }

  function openTagsCreate() {
    const form = document.getElementById('messagingTagForm');
    if (form) form.reset();
    setTagsCreateVisible(true);
    App.setActivePage('messagingTagsPage');
    const panel = document.getElementById('messagingTagCreatePanel');
    if (panel && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return false;
  }

  function openManageContentLanding() {
    activeMessagingContentCategory = '';
    updateMessagingContentFilterBar();
    App.setActivePage('messagingManageContentPage');
    refreshMessagingFormats().catch(function (err) {
      notify(`Could not load messaging formats: ${err.message}`, true);
    });
  }

  function openManageContentCategory(category) {
    activeMessagingContentCategory = String(category || '').trim();
    updateMessagingContentFilterBar();
    App.setActivePage('messagingManageContentPage');
    refreshMessagingFormats().catch(function (err) {
      notify(`Could not load messaging formats: ${err.message}`, true);
    });
  }

  function openContentTarget(targetPageId) {
    const target = String(targetPageId || '').trim();
    if (!target) return;
    applyMessagingCategoryFilterToTarget(target, activeMessagingContentCategory);
    App.setActivePage(target);
  }

  async function openCreateContent() {
    App.setActivePage('messagingCreateContentPage');
    await refreshMessagingFormats().catch(function () {});
    await refreshMessagingCategories();
    await loadThumbnailOptions();
    renderCreateContentFormatOptions();
    await renderCreateContentTopicOptions();
    renderCreateContentAssetOptions();
    const activeFormat = String(document.getElementById('messagingContentFormatFilter')?.value || '').trim();
    const formatSelect = document.getElementById('messagingCreateContentFormat');
    if (formatSelect && activeFormat && Array.from(formatSelect.options).some((option) => option.value === activeFormat)) {
      formatSelect.value = activeFormat;
    }
    renderCreateContentDynamicFields();
    clearCreateContentSuggestions();
    return false;
  }

  function createContentSchema(format) {
    return createContentFormatSchemas[String(format || '').trim()] || null;
  }

  function setCreateContentFieldVisible(id, visible) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('hidden', !visible);
  }

  function availableCreateContentFormats() {
    const source = currentMessagingFormats.length
      ? currentMessagingFormats.filter((entry) => Boolean(entry && entry.enabled))
      : defaultMessagingFormatEntries;
    return source
      .map((entry) => String(entry.format || entry.type || '').trim())
      .filter((value, index, arr) => value && arr.indexOf(value) === index)
      .filter((value) => Boolean(createContentSchema(value)))
      .sort((a, b) => a.localeCompare(b));
  }

  function renderCreateContentFormatOptions() {
    const select = document.getElementById('messagingCreateContentFormat');
    if (!select) return;
    const currentValue = String(select.value || '').trim();
    const formats = availableCreateContentFormats();
    select.innerHTML = '<option value="">Select Format</option>';
    formats.forEach((format) => {
      const option = document.createElement('option');
      option.value = format;
      option.textContent = format;
      select.appendChild(option);
    });
    if (currentValue && formats.includes(currentValue)) select.value = currentValue;
  }

  async function ensureMessagingTopicsLoaded() {
    if (Array.isArray(currentMessagingTopics) && currentMessagingTopics.length) return currentMessagingTopics;
    try {
      const res = await api('/api/messaging/topics?limit=5000');
      const topics = Array.isArray(res?.topics)
        ? res.topics
        : Array.isArray(res?.categories)
          ? res.categories
        : Array.isArray(res?.data)
          ? res.data
          : Array.isArray(res)
            ? res
            : [];
      currentMessagingTopics = topics.slice();
      return currentMessagingTopics;
    } catch {
      return Array.isArray(currentMessagingTopics) ? currentMessagingTopics : [];
    }
  }

  async function renderCreateContentTopicOptions() {
    const select = document.getElementById('messagingCreateContentTopic');
    if (!select) return;
    const currentValue = String(select.value || '').trim();
    const source = await ensureMessagingTopicsLoaded();
    const topics = source
      .map((item) => String(item?.topic || item?.category || '').trim())
      .filter(Boolean)
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b));
    select.innerHTML = '<option value="">No Topic</option>';
    topics.forEach((topic) => {
      const option = document.createElement('option');
      option.value = topic;
      option.textContent = topic;
      select.appendChild(option);
    });
    if (currentValue && topics.includes(currentValue)) select.value = currentValue;
  }

  function renderCreateContentAssetOptions() {
    renderImageOptions(document.getElementById('messagingCreateContentImage'));
    renderThumbnailOptions(document.getElementById('messagingCreateContentThumbnail'));
  }

  function renderCreateContentDynamicFields() {
    const format = String(document.getElementById('messagingCreateContentFormat')?.value || '').trim();
    const schema = createContentSchema(format);
    const primaryLabel = document.getElementById('messagingCreateContentPrimaryLabel');
    const primaryInput = document.getElementById('messagingCreateContentPrimaryInput');
    const bodyLabel = document.getElementById('messagingCreateContentBodyLabel');
    const bodyInput = document.getElementById('messagingCreateContentBody');
    const thumbnailLabel = document.getElementById('messagingCreateContentThumbnailLabel');
    const topicRow = document.getElementById('messagingCreateContentTopicRow');
    const submitBtn = document.getElementById('messagingCreateContentSubmitBtn');
    const actionsRow = document.getElementById('messagingCreateContentActionsRow');
    const feedbackWrap = document.getElementById('messagingCreateContentFeedbackWrap');
    if (!schema) {
      if (topicRow) topicRow.classList.add('hidden');
      if (feedbackWrap) feedbackWrap.classList.add('hidden');
      setCreateContentFieldVisible('messagingCreateContentPrimaryRow', false);
      setCreateContentFieldVisible('messagingCreateContentAuthorRow', false);
      setCreateContentFieldVisible('messagingCreateContentSubjectRow', false);
      setCreateContentFieldVisible('messagingCreateContentTitleRow', false);
      setCreateContentFieldVisible('messagingCreateContentSubtitleRow', false);
      setCreateContentFieldVisible('messagingCreateContentUrlRow', false);
      setCreateContentFieldVisible('messagingCreateContentHashtagsRow', false);
      setCreateContentFieldVisible('messagingCreateContentImageRow', false);
      setCreateContentFieldVisible('messagingCreateContentThumbnailRow', false);
      setCreateContentFieldVisible('messagingCreateContentBodyRow', false);
      setCreateContentFieldVisible('messagingCreateContentPdfRow', false);
      if (submitBtn) submitBtn.classList.add('hidden');
      if (actionsRow) actionsRow.classList.add('hidden');
      clearCreateContentSuggestions();
      return;
    }
    const visibleFields = Array.isArray(schema?.fields) ? schema.fields : [];
    const hasField = (name) => visibleFields.includes(name);
    const isLongform = schema?.kind === 'longform' || schema?.kind === 'pdfLongform';
    if (feedbackWrap && format !== 'Articles') feedbackWrap.classList.add('hidden');

    // Reset irrelevant values when switching formats so the visible form stays truthful.
    [
      'messagingCreateContentAuthor',
      'messagingCreateContentSubject',
      'messagingCreateContentTitle',
      'messagingCreateContentSubtitle',
      'messagingCreateContentUrl',
      'messagingCreateContentHashtags',
      'messagingCreateContentImage',
      'messagingCreateContentThumbnail',
      'messagingCreateContentBody',
      'messagingCreateContentPrimaryInput',
      'messagingCreateContentPdf',
    ].forEach((id) => {
      const field = document.getElementById(id);
      if (!field) return;
      if (field.tagName === 'SELECT') return;
      if (field.type === 'file') {
        field.value = '';
        return;
      }
    });

    if (topicRow) topicRow.classList.remove('hidden');
    setCreateContentFieldVisible('messagingCreateContentPrimaryRow', hasField('primary'));
    setCreateContentFieldVisible('messagingCreateContentAuthorRow', hasField('author'));
    setCreateContentFieldVisible('messagingCreateContentSubjectRow', hasField('subject'));
    setCreateContentFieldVisible('messagingCreateContentTitleRow', hasField('title'));
    setCreateContentFieldVisible('messagingCreateContentSubtitleRow', hasField('subtitle'));
    setCreateContentFieldVisible('messagingCreateContentUrlRow', hasField('url'));
    setCreateContentFieldVisible('messagingCreateContentHashtagsRow', hasField('hashtags'));
    setCreateContentFieldVisible('messagingCreateContentImageRow', hasField('image'));
    setCreateContentFieldVisible('messagingCreateContentThumbnailRow', hasField('thumbnail'));
    setCreateContentFieldVisible('messagingCreateContentBodyRow', hasField('body'));
    setCreateContentFieldVisible('messagingCreateContentPdfRow', hasField('pdf'));

    if (primaryLabel) primaryLabel.textContent = `${schema?.primaryLabel || 'Content'}:`;
    if (primaryInput) {
      primaryInput.placeholder = schema?.primaryLabel ? `Enter ${schema.primaryLabel.toLowerCase()}` : 'Enter content';
      primaryInput.rows = Number(schema?.primaryRows || 5);
    }
    if (bodyLabel) bodyLabel.textContent = isLongform ? `${schema?.bodyLabel || 'Body'}:` : 'Body:';
    if (bodyInput) {
      bodyInput.placeholder = isLongform ? String(schema?.bodyLabel || 'Body') : 'Body';
      bodyInput.rows = isLongform ? 10 : 6;
    }
    if (thumbnailLabel) thumbnailLabel.textContent = 'Image:';
    if (submitBtn) submitBtn.classList.remove('hidden');
    if (actionsRow) actionsRow.classList.remove('hidden');
  }

  function buildCreateContentPayload(formData, schema, overrides = {}) {
    if (!schema) throw new Error('Select a format');
    const payload = {};
    const topic = cleanText(formData.get('topic'));
    if (schema.kind === 'simple') {
      const value = cleanText(overrides.primary != null ? overrides.primary : formData.get('primary'));
      if (!value) throw new Error(`${schema.primaryLabel} is required`);
      payload[schema.primaryKey] = value;
      payload.topic = topic;
      payload.feedback = cleanText(overrides.feedback != null ? overrides.feedback : formData.get('feedback'));
      if (schema.fields.includes('author')) payload.author = cleanText(formData.get('author'));
      if (schema.fields.includes('subject')) payload.subject = cleanText(overrides.subject != null ? overrides.subject : formData.get('subject'));
      if (schema.fields.includes('url')) payload.url = cleanText(formData.get('url'));
      if (schema.fields.includes('image')) payload.image_asset_id = cleanText(formData.get('image_asset_id'));
      return payload;
    }
    if (schema.kind === 'tweet') {
      const content = cleanText(overrides.primary != null ? overrides.primary : formData.get('primary'));
      if (!content) throw new Error('Tweet is required');
      payload.content = content;
      payload.author = cleanText(formData.get('author'));
      payload.url = cleanText(formData.get('url'));
      payload.hashtags = cleanText(overrides.hashtags != null ? overrides.hashtags : formData.get('hashtags'));
      payload.image_asset_id = cleanText(formData.get('image_asset_id'));
      payload.topic = topic;
      payload.feedback = cleanText(overrides.feedback != null ? overrides.feedback : formData.get('feedback'));
      return payload;
    }
    if (schema.kind === 'longform' || schema.kind === 'pdfLongform') {
      payload.topic = topic;
      payload.author = cleanText(formData.get('author'));
      payload.title = cleanText(overrides.title != null ? overrides.title : formData.get('title'));
      payload.subtitle = cleanText(overrides.subtitle != null ? overrides.subtitle : formData.get('subtitle'));
      payload.url = cleanText(formData.get('url'));
      payload.content = cleanText(overrides.body != null ? overrides.body : formData.get('content'));
      payload.feedback = cleanText(overrides.feedback != null ? overrides.feedback : formData.get('feedback'));
      payload.thumbnail_asset_id = cleanText(formData.get('thumbnail_asset_id'));
      if (!payload.title || !payload.content) throw new Error('Title and content are required');
      return payload;
    }
    throw new Error('Unsupported format');
  }

  function clearCreateContentSuggestions() {
    currentCreateContentSuggestions = [];
    const empty = document.getElementById('messagingCreateContentSuggestionsEmpty');
    const shortWrap = document.getElementById('messagingCreateContentShortSuggestions');
    const longWrap = document.getElementById('messagingCreateContentLongSuggestions');
    const tbody = document.getElementById('messagingCreateContentSuggestionsTable');
    const checkAll = document.getElementById('messagingCreateContentSelectAllSuggestions');
    const generatedTitle = document.getElementById('messagingCreateContentGeneratedTitle');
    const generatedSubtitle = document.getElementById('messagingCreateContentGeneratedSubtitle');
    const generatedBody = document.getElementById('messagingCreateContentGeneratedBodyEditor');
    const feedbackWrap = document.getElementById('messagingCreateContentFeedbackWrap');
    const feedback = document.getElementById('messagingCreateContentFeedback');
    if (empty) empty.classList.remove('hidden');
    if (shortWrap) shortWrap.classList.add('hidden');
    if (longWrap) longWrap.classList.add('hidden');
    if (feedbackWrap) feedbackWrap.classList.add('hidden');
    if (tbody) tbody.innerHTML = '';
    if (checkAll) checkAll.checked = false;
    if (generatedTitle) generatedTitle.value = '';
    if (generatedSubtitle) generatedSubtitle.value = '';
    if (generatedBody) generatedBody.innerHTML = '';
    if (feedback) feedback.value = '';
  }

  function renderCreateContentShortSuggestions(options) {
    const empty = document.getElementById('messagingCreateContentSuggestionsEmpty');
    const shortWrap = document.getElementById('messagingCreateContentShortSuggestions');
    const longWrap = document.getElementById('messagingCreateContentLongSuggestions');
    const tbody = document.getElementById('messagingCreateContentSuggestionsTable');
    const checkAll = document.getElementById('messagingCreateContentSelectAllSuggestions');
    if (!wrap || !shortWrap || !longWrap || !tbody) return;
    currentCreateContentSuggestions = Array.isArray(options) ? options.slice() : [];
    tbody.innerHTML = '';
    currentCreateContentSuggestions.forEach((option, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="checkbox" data-create-content-suggestion-index="${index}" /></td>
        <td>${escapeHtml(String(option || ''))}</td>
      `;
      tbody.appendChild(tr);
    });
    if (checkAll) checkAll.checked = false;
    if (empty) empty.classList.add('hidden');
    shortWrap.classList.remove('hidden');
    longWrap.classList.add('hidden');
  }

  function applyCreateContentLongDraft(draft) {
    const title = document.getElementById('messagingCreateContentGeneratedTitle');
    const subtitle = document.getElementById('messagingCreateContentGeneratedSubtitle');
    const body = document.getElementById('messagingCreateContentGeneratedBodyEditor');
    const empty = document.getElementById('messagingCreateContentSuggestionsEmpty');
    const shortWrap = document.getElementById('messagingCreateContentShortSuggestions');
    const longWrap = document.getElementById('messagingCreateContentLongSuggestions');
    const feedbackWrap = document.getElementById('messagingCreateContentFeedbackWrap');
    const format = cleanText(document.getElementById('messagingCreateContentFormat')?.value);
    currentCreateContentSuggestions = [];
    if (title && typeof draft?.title === 'string') title.value = draft.title;
    if (subtitle && typeof draft?.subtitle === 'string') subtitle.value = draft.subtitle;
    if (typeof draft?.body === 'string') setGeneratedBodyEditorHtml(draft.body);
    if (empty) empty.classList.add('hidden');
    if (shortWrap) shortWrap.classList.add('hidden');
    if (longWrap) longWrap.classList.remove('hidden');
    if (feedbackWrap) feedbackWrap.classList.toggle('hidden', format !== 'Articles');
  }

  async function saveGeneratedCreateContentDraft() {
    const form = document.getElementById('messagingCreateContentForm');
    if (!form) return false;
    const formData = new FormData(form);
    const format = cleanText(formData.get('format'));
    const schema = createContentSchema(format);
    if (!schema || (schema.kind !== 'longform' && schema.kind !== 'pdfLongform')) {
      notify('Select a long-form format first', true);
      return false;
    }
    let payload;
    try {
      payload = buildCreateContentPayload(formData, schema, {
        title: cleanText(document.getElementById('messagingCreateContentGeneratedTitle')?.value),
        subtitle: cleanText(document.getElementById('messagingCreateContentGeneratedSubtitle')?.value),
        body: getGeneratedBodyEditorHtml(),
        feedback: cleanText(document.getElementById('messagingCreateContentFeedback')?.value),
      });
    } catch (err) {
      notify(err.message, true);
      return false;
    }
    if (schema.kind === 'pdfLongform') {
      const pdfFields = await getWhitePaperPdfFields(document.getElementById('messagingCreateContentPdf'));
      payload.pdf_name = pdfFields.pdf_name;
      payload.pdf_mime_type = pdfFields.pdf_mime_type;
      payload.pdf_data_url = pdfFields.pdf_data_url;
      if (!payload.url && !payload.pdf_data_url) {
        notify('Provide a URL or upload a PDF', true);
        return false;
      }
    }
    try {
      await api(schema.endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      notify(`${format} saved`);
      clearCreateContentSuggestions();
      await Promise.all([
        refreshArticles(),
        refreshReports(),
        refreshWhitePapers(),
        refreshEbooks(),
      ]);
      renderMessagingContentLibraryTable();
    } catch (err) {
      notify(err.message, true);
    }
    return false;
  }

  async function reviseCreateContentDraftWithFeedback() {
    const form = document.getElementById('messagingCreateContentForm');
    const feedbackEl = document.getElementById('messagingCreateContentFeedback');
    const button = document.getElementById('messagingCreateContentReviseBtn');
    if (!form || !feedbackEl || !button) return false;
    const formData = new FormData(form);
    const format = cleanText(formData.get('format'));
    if (format !== 'Articles') {
      notify('Feedback revision is currently set up for Articles', true);
      return false;
    }
    const feedback = cleanText(feedbackEl.value);
    if (!feedback) {
      notify('Add feedback before requesting a revision', true);
      return false;
    }
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Revising...';
    try {
      await saveCreateContentFeedbackToTraining(feedback);
      const thumbSelect = document.getElementById('messagingCreateContentThumbnail');
      const result = await api('/api/messaging/content-suggestions', {
        method: 'POST',
        body: JSON.stringify({
          format,
          topic: cleanText(formData.get('topic')),
          author: cleanText(formData.get('author')),
          title: cleanText(document.getElementById('messagingCreateContentGeneratedTitle')?.value || formData.get('title')),
          subtitle: cleanText(document.getElementById('messagingCreateContentGeneratedSubtitle')?.value || formData.get('subtitle')),
          url: cleanText(formData.get('url')),
          body: getGeneratedBodyEditorText() || cleanText(formData.get('content')),
          image_label: cleanText(thumbSelect?.selectedOptions?.[0]?.textContent),
          feedback,
        }),
      });
      applyCreateContentLongDraft(result.draft || {});
      notify('Article revised with training feedback');
    } catch (err) {
      notify(err.message, true);
    } finally {
      button.disabled = false;
      button.textContent = originalText || 'Revise with Feedback';
    }
    return false;
  }

  async function generateCreateContentSuggestions() {
    const form = document.getElementById('messagingCreateContentForm');
    if (!form) return false;
    const formData = new FormData(form);
    const format = cleanText(formData.get('format'));
    const schema = createContentSchema(format);
    if (!schema) {
      notify('Select a format', true);
      return false;
    }
    const button = document.getElementById('messagingCreateContentGenerateBtn');
    const originalText = button ? button.textContent : '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Generating...';
    }
    try {
      const imageSelect = document.getElementById('messagingCreateContentImage');
      const thumbSelect = document.getElementById('messagingCreateContentThumbnail');
      const pdfInput = document.getElementById('messagingCreateContentPdf');
      const result = await api('/api/messaging/content-suggestions', {
        method: 'POST',
        body: JSON.stringify({
          format,
          topic: cleanText(formData.get('topic')),
          author: cleanText(formData.get('author')),
          subject: cleanText(formData.get('subject')),
          title: cleanText(formData.get('title')),
          subtitle: cleanText(formData.get('subtitle')),
          url: cleanText(formData.get('url')),
          hashtags: cleanText(formData.get('hashtags')),
          body: cleanText(formData.get('content') || formData.get('primary')),
          image_label: cleanText(imageSelect?.selectedOptions?.[0]?.textContent || thumbSelect?.selectedOptions?.[0]?.textContent),
          pdf_name: cleanText(pdfInput?.files?.[0]?.name),
        }),
      });
      if (result.kind === 'long') {
        applyCreateContentLongDraft(result.draft || {});
        notify('Generated draft loaded into form');
      } else {
        renderCreateContentShortSuggestions(Array.isArray(result.options) ? result.options : []);
        notify(`Generated ${(Array.isArray(result.options) ? result.options.length : 0)} option(s)`);
      }
    } catch (err) {
      notify(err.message, true);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText || 'Generate with AI';
      }
    }
    return false;
  }

  async function saveSelectedCreateContentSuggestions() {
    const form = document.getElementById('messagingCreateContentForm');
    if (!form) return false;
    const formData = new FormData(form);
    const format = cleanText(formData.get('format'));
    const schema = createContentSchema(format);
    if (!schema) {
      notify('Select a format', true);
      return false;
    }
    const selectedIndices = Array.from(document.querySelectorAll('[data-create-content-suggestion-index]:checked'))
      .map((input) => Number(input.getAttribute('data-create-content-suggestion-index')))
      .filter((value) => Number.isFinite(value) && currentCreateContentSuggestions[value]);
    if (!selectedIndices.length) {
      notify('Select at least one option', true);
      return false;
    }
    try {
      for (const index of selectedIndices) {
        const payload = buildCreateContentPayload(formData, schema, {
          primary: currentCreateContentSuggestions[index],
        });
        await api(schema.endpoint, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      notify(`Saved ${selectedIndices.length} content item${selectedIndices.length === 1 ? '' : 's'}`);
      clearCreateContentSuggestions();
      await Promise.all([
        refreshHeadlines(),
        refreshSubheadings(),
        refreshTaglines(),
        refreshPitches(),
        refreshArticles(),
        refreshReports(),
        refreshWhitePapers(),
        refreshEbooks(),
        refreshAllSimpleContentPages(),
      ]);
      renderMessagingContentLibraryTable();
    } catch (err) {
      notify(err.message, true);
    }
    return false;
  }

  async function submitCreateContentForm(event) {
    if (event) event.preventDefault();
    const form = document.getElementById('messagingCreateContentForm');
    if (!form) return false;
    const formData = new FormData(form);
    const format = String(formData.get('format') || '').trim();
    const topic = String(formData.get('topic') || '').trim();
    const schema = createContentSchema(format);
    if (!schema) {
      notify('Select a format', true);
      return false;
    }

    let payload;
    try {
      payload = buildCreateContentPayload(formData, schema);
    } catch (err) {
      notify(err.message, true);
      return false;
    }
    if (schema.kind === 'pdfLongform') {
      const pdfFields = await getWhitePaperPdfFields(document.getElementById('messagingCreateContentPdf'));
      payload.pdf_name = pdfFields.pdf_name;
      payload.pdf_mime_type = pdfFields.pdf_mime_type;
      payload.pdf_data_url = pdfFields.pdf_data_url;
      if (!payload.url && !payload.pdf_data_url) {
        notify('Provide a URL or upload a PDF', true);
        return false;
      }
    }

    try {
      await api(schema.endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      notify(`${format} saved`);
      const keepFormat = format;
      const keepTopic = topic;
      form.reset();
      renderCreateContentFormatOptions();
      await renderCreateContentTopicOptions();
      syncHeadlineCategorySelects();
      renderCreateContentAssetOptions();
      const formatSelect = document.getElementById('messagingCreateContentFormat');
      const topicSelect = document.getElementById('messagingCreateContentTopic');
      if (formatSelect) formatSelect.value = keepFormat;
      if (topicSelect && keepTopic) topicSelect.value = keepTopic;
      renderCreateContentDynamicFields();
      clearCreateContentSuggestions();
      await Promise.all([
        refreshHeadlines(),
        refreshSubheadings(),
        refreshTaglines(),
        refreshPitches(),
        refreshArticles(),
        refreshReports(),
        refreshWhitePapers(),
        refreshEbooks(),
        refreshAllSimpleContentPages(),
      ]);
      renderMessagingContentLibraryTable();
    } catch (err) {
      notify(err.message, true);
    }
    return false;
  }

  function renderMessagingContentFormatFilter() {
    const select = document.getElementById('messagingContentFormatFilter');
    if (!select) return;
    const currentValue = String(select.value || '').trim();
    const source = currentMessagingFormats.length
      ? currentMessagingFormats.filter((entry) => Boolean(entry && entry.enabled))
      : defaultMessagingFormatEntries;
    const formats = source
      .map((entry) => String(entry.format || entry.type || '').trim())
      .filter(Boolean)
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b));
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'All Formats';
    select.appendChild(placeholder);
    formats.forEach((format) => {
      const option = document.createElement('option');
      option.value = format;
      option.textContent = format;
      select.appendChild(option);
    });
    if (currentValue && formats.includes(currentValue)) {
      select.value = currentValue;
    }
  }

  function renderMessagingContentTopicFilter() {
    const select = document.getElementById('messagingContentTopicFilter');
    if (!select) return;
    const currentValue = String(select.value || '').trim();
    const topics = currentMessagingTopics
      .map((item) => String(item?.topic || item?.category || '').trim())
      .filter(Boolean)
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b));
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'All Topics';
    select.appendChild(placeholder);
    topics.forEach((topic) => {
      const option = document.createElement('option');
      option.value = topic;
      option.textContent = topic;
      select.appendChild(option);
    });
    if (currentValue && topics.includes(currentValue)) {
      select.value = currentValue;
    }
  }

  function getMessagingContentLibraryRows() {
    return messagingContentRegistry.flatMap((entry) => {
      const items = Array.isArray(entry.source()) ? entry.source() : [];
      return items.map((item) => ({
        id: item.id,
        content: String(item?.[entry.field] || '').trim(),
        topic: String(item?.topic || item?.category || '').trim(),
        feedback: String(item?.feedback || '').trim(),
        format: entry.format,
        pageId: entry.pageId,
        item,
      }));
    });
  }

  function cloneMessagingLibraryEntryPayload(entry) {
    const format = String(entry?.format || '').trim();
    const schema = createContentSchema(format);
    const item = entry?.item || {};
    if (!schema) throw new Error('Unsupported content format');
    if (schema.kind === 'simple') {
      return {
        [schema.primaryKey]: `${String(item?.[schema.primaryKey] || '').trim() || 'Untitled'} (Clone)`,
        topic: String(item?.topic || item?.category || '').trim(),
        feedback: String(item?.feedback || '').trim(),
      };
    }
    if (schema.kind === 'tweet') {
      return {
        content: `${String(item?.content || '').trim() || 'Untitled'} (Clone)`,
        url: String(item?.url || '').trim(),
        hashtags: String(item?.hashtags || '').trim(),
        image_asset_id: Number(item?.image_asset_id || 0) || null,
        topic: String(item?.topic || item?.category || '').trim(),
        feedback: String(item?.feedback || '').trim(),
      };
    }
    if (schema.kind === 'longform' || schema.kind === 'pdfLongform') {
      return {
        platform: String(item?.platform || '').trim(),
        author: String(item?.author || '').trim(),
        title: `${String(item?.title || '').trim() || 'Untitled'} (Clone)`,
        subtitle: String(item?.subtitle || '').trim(),
        url: String(item?.url || '').trim(),
        content: String(item?.content || '').trim(),
        feedback: String(item?.feedback || '').trim(),
        publish_date: item?.publish_date || null,
        thumbnail_asset_id: Number(item?.thumbnail_asset_id || 0) || null,
        pdf_name: String(item?.pdf_name || '').trim(),
        pdf_mime_type: String(item?.pdf_mime_type || '').trim(),
        pdf_data_url: String(item?.pdf_data_url || '').trim(),
      };
    }
    throw new Error('Unsupported content format');
  }

  function openMessagingContentEntryView(entry) {
    const format = String(entry?.format || '').trim();
    const item = entry?.item || {};
    const pairs = [
      ['Format', format || '-'],
      ['Topic', String(entry?.topic || '').trim() || '-'],
    ];
    if (format === 'Articles' || format === 'Reports' || format === 'White Papers' || format === 'eBooks') {
      pairs.push(
        ['Title', String(item?.title || '').trim() || '-'],
        ['Subtitle', String(item?.subtitle || '').trim() || '-'],
        ['Author', String(item?.author || '').trim() || '-'],
        ['Platform', String(item?.platform || '').trim() || '-'],
        ['URL', String(item?.url || '').trim() || '-'],
        ['Content', String(item?.content || '').trim() || '-'],
        ['Feedback', String(item?.feedback || '').trim() || '-'],
      );
    } else if (format === 'Tweets') {
      pairs.push(
        ['Content', String(item?.content || '').trim() || '-'],
        ['URL', String(item?.url || '').trim() || '-'],
        ['Hashtags', String(item?.hashtags || '').trim() || '-'],
        ['Feedback', String(item?.feedback || '').trim() || '-'],
      );
    } else {
      pairs.push(
        ['Content', String(entry?.content || '').trim() || '-'],
        ['Feedback', String(item?.feedback || '').trim() || '-']
      );
    }
    openMessagingDetailModal(`View ${format}`, pairs);
  }

  function openMessagingContentEntryEditor(entry) {
    const format = String(entry?.format || '').trim();
    const item = entry?.item || {};
    const simpleConfig = simpleContentConfigs.find((config) => config.pluralLabel === format);
    if (simpleConfig) {
      App.setActivePage(simpleConfig.pageId);
      openSimpleContentEditForm(simpleConfig, item);
      return;
    }
    if (format === 'Articles') {
      App.setActivePage('messagingArticlesPage');
      openEditForm(item);
      return;
    }
    if (format === 'Reports') {
      App.setActivePage('messagingReportsPage');
      openReportEditForm(item);
      return;
    }
    if (format === 'White Papers') {
      App.setActivePage('messagingWhitePapersPage');
      openWhitePaperEditForm(item);
      return;
    }
    if (format === 'eBooks') {
      App.setActivePage('messagingEbooksPage');
      openEbookEditForm(item);
      return;
    }
    if (format === 'Tweets') {
      App.setActivePage('messagingTweetsPage');
      openTweetEditForm(item);
      return;
    }
    openContentTarget(entry.pageId);
  }

  async function cloneMessagingContentEntry(entry) {
    const format = String(entry?.format || '').trim();
    const schema = createContentSchema(format);
    if (!schema) throw new Error('Unsupported content format');
    const payload = cloneMessagingLibraryEntryPayload(entry);
    await api(schema.endpoint, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async function deleteMessagingContentEntry(entry) {
    const format = String(entry?.format || '').trim();
    const schema = createContentSchema(format);
    if (!schema) throw new Error('Unsupported content format');
    await api(`${schema.endpoint}/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
  }

  function getFilteredMessagingContentLibraryRows() {
    const textInput = document.getElementById('messagingContentTextFilter');
    const formatSelect = document.getElementById('messagingContentFormatFilter');
    const topicSelect = document.getElementById('messagingContentTopicFilter');
    const text = String(textInput && textInput.value ? textInput.value : '').trim().toLowerCase();
    const format = String(formatSelect && formatSelect.value ? formatSelect.value : '').trim();
    const topic = String(topicSelect && topicSelect.value ? topicSelect.value : '').trim();
    return getMessagingContentLibraryRows()
      .filter((entry) => {
        if (text && !String(entry.content || '').toLowerCase().includes(text)) return false;
        if (format && String(entry.format || '') !== format) return false;
        if (topic && String(entry.topic || '') !== topic) return false;
        return true;
      })
      .sort((a, b) => {
        const left = String(a.content || '').toLowerCase();
        const right = String(b.content || '').toLowerCase();
        return left.localeCompare(right);
      });
  }

  function renderMessagingContentLibraryTable() {
    const tbody = document.getElementById('messagingContentLibraryTable');
    if (!tbody) return;
    renderMessagingContentFormatFilter();
    renderMessagingContentTopicFilter();
    const rows = getFilteredMessagingContentLibraryRows();
    tbody.innerHTML = '';
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.textContent = 'No content matches current filters.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    rows.forEach((entry) => {
      const tr = document.createElement('tr');
      [
        entry.content || '-',
        entry.format || '-',
        entry.topic || '-',
      ].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });
      const actionsTd = document.createElement('td');
      actionsTd.className = 'messaging-content-actions-cell';
      const viewBtn = App.makeIconButton('view', `View ${entry.format}`, function () {
        openMessagingContentEntryView(entry);
      });
      const editBtn = App.makeIconButton('edit', `Edit ${entry.format}`, function () {
        openMessagingContentEntryEditor(entry);
      }, { marginLeft: '8px' });
      const cloneBtn = App.makeIconButton('clone', `Clone ${entry.format}`, async function () {
        try {
          await cloneMessagingContentEntry(entry);
          notify(`${entry.format} cloned`);
          await Promise.all([
            refreshHeadlines(),
            refreshSubheadings(),
            refreshTaglines(),
            refreshPitches(),
            refreshArticles(),
            refreshReports(),
            refreshWhitePapers(),
            refreshEbooks(),
            refreshAllSimpleContentPages(),
          ]);
          renderMessagingContentLibraryTable();
        } catch (err) {
          notify(err.message, true);
        }
      }, { marginLeft: '8px' });
      const deleteBtn = App.makeIconButton('delete', `Delete ${entry.format}`, async function () {
        if (!confirm(`Delete this ${String(entry.format || 'content').toLowerCase()} item?`)) return;
        try {
          await deleteMessagingContentEntry(entry);
          notify(`${entry.format} deleted`);
          await Promise.all([
            refreshHeadlines(),
            refreshSubheadings(),
            refreshTaglines(),
            refreshPitches(),
            refreshArticles(),
            refreshReports(),
            refreshWhitePapers(),
            refreshEbooks(),
            refreshAllSimpleContentPages(),
          ]);
          renderMessagingContentLibraryTable();
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actionsTd.appendChild(viewBtn);
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(cloneBtn);
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
  }

  function renderMessagingFormatsTable() {
    const tbody = document.getElementById('messagingFormatsLibraryTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    const rows = (currentMessagingFormats.length ? currentMessagingFormats : defaultMessagingFormatEntries).slice().sort((a, b) => {
      const left = String(a.format || a.type || '').toLowerCase();
      const right = String(b.format || b.type || '').toLowerCase();
      return left.localeCompare(right);
    });
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.textContent = 'No content formats available.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    rows.forEach((entry) => {
      const tr = document.createElement('tr');
      [entry.format || entry.type, entry.family, entry.destination || (entry.pageId ? 'Editor' : '')].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });
      const actionsTd = document.createElement('td');
      actionsTd.className = 'messaging-content-actions-cell';
      const targetPage = String(entry.pageId || '').trim();
      if (targetPage) {
        const openBtn = App.makeIconButton('edit', `Open ${entry.format || entry.type}`, function () {
          openContentTarget(targetPage);
        });
        actionsTd.appendChild(openBtn);
      } else {
        const manageBtn = App.makeIconButton('edit', `Edit ${entry.format || entry.type}`, function () {
          openMessagingFormatEdit(entry);
        });
        actionsTd.appendChild(manageBtn);
      }
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
  }

  function renderMessagingContentTypesTable() {
    const tbody = document.getElementById('messagingContentTypesTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    const rows = currentMessagingFormats.slice().sort((a, b) => {
      const sortKey = messagingFormatTableState.sort.key;
      const dir = messagingFormatTableState.sort.dir === 'desc' ? -1 : 1;
      const left = sortKey === 'updatedAt'
        ? String(a.updatedAt || '')
        : String(sortKey === 'family' ? a.family : a.format || '').toLowerCase();
      const right = sortKey === 'updatedAt'
        ? String(b.updatedAt || '')
        : String(sortKey === 'family' ? b.family : b.format || '').toLowerCase();
      return left.localeCompare(right) * dir;
    });
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'No content formats available.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    rows.forEach((entry) => {
      const tr = document.createElement('tr');
      [entry.format, entry.family, entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : ''].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });
      const enabledTd = document.createElement('td');
      enabledTd.textContent = entry.enabled ? 'Yes' : 'No';
      tr.appendChild(enabledTd);
      const actionsTd = document.createElement('td');
      actionsTd.className = 'messaging-content-actions-cell';
      const editBtn = App.makeIconButton('edit', `Edit ${entry.format}`, function () {
        openMessagingFormatEdit(entry);
      });
      const cloneBtn = App.makeIconButton('clone', `Clone ${entry.format}`, function () {
        const form = document.getElementById('messagingContentTypeForm');
        const saveBtn = document.getElementById('messagingContentTypeSaveBtn');
        const cancelBtn = document.getElementById('messagingContentTypeCancelEditBtn');
        if (!form) return;
        form.reset();
        form.elements.id.value = '';
        form.elements.content_type_name.value = `${entry.format} Copy`;
        form.elements.family.value = entry.family || '';
        form.elements.enabled.checked = Boolean(entry.enabled);
        if (saveBtn) saveBtn.textContent = 'Create Content Format';
        if (cancelBtn) cancelBtn.classList.remove('hidden');
      });
      const deleteBtn = App.makeIconButton('trash', `Delete ${entry.format}`, async function () {
        if (!window.confirm(`Delete format "${entry.format}"?`)) return;
        try {
          await api(`/api/messaging/formats/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
          notify('Content format deleted');
          await refreshMessagingFormats();
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true });
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(cloneBtn);
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
  }

  function openMessagingFormatEdit(entry) {
    const form = document.getElementById('messagingContentTypeForm');
    const saveBtn = document.getElementById('messagingContentTypeSaveBtn');
    const cancelBtn = document.getElementById('messagingContentTypeCancelEditBtn');
    if (!form || !entry) return;
    App.setActivePage('messagingContentTypesPage');
    form.elements.id.value = String(entry.id || '');
    form.elements.content_type_name.value = String(entry.format || '');
    form.elements.family.value = String(entry.family || '');
    form.elements.enabled.checked = Boolean(entry.enabled);
    if (saveBtn) saveBtn.textContent = 'Update Content Format';
    if (cancelBtn) cancelBtn.classList.remove('hidden');
  }

  function resetMessagingFormatForm() {
    const form = document.getElementById('messagingContentTypeForm');
    const saveBtn = document.getElementById('messagingContentTypeSaveBtn');
    const cancelBtn = document.getElementById('messagingContentTypeCancelEditBtn');
    if (!form) return;
    form.reset();
    form.elements.id.value = '';
    if (saveBtn) saveBtn.textContent = 'Create Content Format';
    if (cancelBtn) cancelBtn.classList.add('hidden');
  }

  async function refreshMessagingFormats() {
    const res = await api('/api/messaging/formats?limit=5000');
    const formats = Array.isArray(res?.formats)
      ? res.formats
      : Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res)
          ? res
          : [];
    currentMessagingFormats = formats.slice();
    renderMessagingFormatsTable();
    renderMessagingContentTypesTable();
    renderMessagingContentFormatFilter();
    renderCreateContentFormatOptions();
    return currentMessagingFormats;
  }

  function renderMessagingCategoriesMap(categories) {
    const container = document.getElementById('messagingCategoriesMap');
    if (!container) return;
    container.innerHTML = '';
    container.style.gridTemplateColumns = '';
    const rows = Array.isArray(categories) ? categories : [];
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'messaging-content-node messaging-category-node';
      empty.innerHTML = '<span class="messaging-content-node-kicker">Messaging</span><span class="messaging-content-node-title">No Topics Yet</span>';
      container.appendChild(empty);
      return;
    }

    const count = rows.filter((item) => String(item && item.category ? item.category : '').trim()).length;
    const dimensions = (function getCategoryGridDimensions(total) {
      const safeTotal = Math.max(1, Number(total) || 1);
      let bestPair = null;

      for (let divisor = 2; divisor <= Math.min(6, safeTotal); divisor += 1) {
        if (safeTotal % divisor !== 0) continue;
        const a = divisor;
        const b = safeTotal / divisor;
        const pair = {
          rows: Math.min(a, b),
          cols: Math.max(a, b),
        };
        const diff = Math.abs(pair.cols - pair.rows);
        if (!bestPair || diff < bestPair.diff || (diff === bestPair.diff && pair.cols < bestPair.cols)) {
          bestPair = { ...pair, diff };
        }
      }

      if (bestPair) {
        return { rows: bestPair.rows, cols: bestPair.cols };
      }

      let fallback = { cols: Math.min(4, safeTotal), rows: Math.ceil(safeTotal / Math.min(4, safeTotal)), score: Number.POSITIVE_INFINITY };
      for (let cols = 2; cols <= Math.min(6, safeTotal); cols += 1) {
        const rowsNeeded = Math.ceil(safeTotal / cols);
        const ratioScore = Math.abs((cols / rowsNeeded) - (4 / 3));
        const emptySlots = (cols * rowsNeeded) - safeTotal;
        const score = ratioScore + (emptySlots * 0.01);
        if (score < fallback.score) {
          fallback = { cols, rows: rowsNeeded, score };
        }
      }
      return { rows: fallback.rows, cols: fallback.cols };
    })(count);

    container.style.gridTemplateColumns = `repeat(${Math.max(1, dimensions.cols)}, minmax(0, 1fr))`;

    rows.forEach((item) => {
      const category = String(item.category || '').trim();
      if (!category) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'messaging-content-node messaging-category-node';
      button.innerHTML = `<span class="messaging-content-node-kicker">Topic</span><span class="messaging-content-node-title">${category}</span>`;
      button.addEventListener('click', function () {
        if (App.messaging && typeof App.messaging.openManageContentCategory === 'function') {
          App.messaging.openManageContentCategory(category);
          return;
        }
        openManageContentCategory(category);
      });
      container.appendChild(button);
    });
  }

  function fillSimpleContentForm(config, form, item) {
    if (!config || !form || !item) return;
    form.elements.id.value = String(item.id || '');
    form.elements[config.field].value = String(item[config.field] || '');
    if (form.elements.topic) {
      form.elements.topic.value = String(item.topic || item.category || '');
    }
    if (form.elements.feedback) {
      form.elements.feedback.value = String(item.feedback || '');
    }
  }

  function openSimpleContentEditForm(config, item) {
    const ids = getSimpleContentIds(config);
    const form = document.getElementById(ids.editFormId);
    const createWrap = document.getElementById(ids.createWrapId);
    const toggleBtn = document.getElementById(ids.toggleBtnId);
    if (!form || !item) return;
    syncHeadlineCategorySelects();
    fillSimpleContentForm(config, form, item);
    form.classList.remove('hidden');
    if (createWrap) createWrap.classList.add('hidden');
    if (toggleBtn) toggleBtn.textContent = `Create ${config.pluralLabel}`;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeSimpleContentEditForm(config) {
    const ids = getSimpleContentIds(config);
    const form = document.getElementById(ids.editFormId);
    if (!form) return;
    form.reset();
    form.classList.add('hidden');
  }

  function getFilteredSortedSimpleContent(config) {
    const stateForType = simpleContentState[config.key];
    const textFilter = String(stateForType.filters.text || '').trim().toLowerCase();
    const categoryFilter = String(stateForType.filters.category || '').trim();
    const formatFilter = String(document.getElementById(getSimpleContentIds(config).formatFilterId)?.value || '').trim();
    const items = Array.isArray(stateForType.items) ? stateForType.items : [];

    const filtered = items.filter((item) => {
      const text = String(item[config.field] || '').toLowerCase();
      const category = String(item.category || '').trim();
      if (textFilter && !text.includes(textFilter)) return false;
      if (categoryFilter && category !== categoryFilter) return false;
      if (formatFilter && formatFilter !== config.pluralLabel) return false;
      return true;
    });

    filtered.sort((a, b) => {
      const key = stateForType.sort.key;
      let left = a?.[key];
      let right = b?.[key];
      if (key === 'created_at' || key === 'updated_at') {
        left = new Date(left || 0).getTime();
        right = new Date(right || 0).getTime();
      } else {
        left = String(left || '').toLowerCase();
        right = String(right || '').toLowerCase();
      }
      if (left === right) return 0;
      const result = left < right ? -1 : 1;
      return stateForType.sort.dir === 'asc' ? result : -result;
    });

    return filtered;
  }

  function syncSimpleContentSortLabels(config) {
    const ids = getSimpleContentIds(config);
    const stateForType = simpleContentState[config.key];
    [
      [ids.sortTextBtnId, config.field, config.singularLabel],
      [ids.sortCategoryBtnId, 'category', 'Topic'],
      [ids.sortCreatedBtnId, 'created_at', 'Created'],
      [ids.sortUpdatedBtnId, 'updated_at', 'Updated'],
    ].forEach(([id, key, label]) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      const marker = stateForType.sort.key === key
        ? (stateForType.sort.dir === 'asc' ? ' ▲' : ' ▼')
        : '';
      btn.textContent = `${label}${marker}`;
    });
  }

  function syncSimpleContentBulkUi(config) {
    const ids = getSimpleContentIds(config);
    const selectAll = document.getElementById(ids.selectAllId);
    const bulkBtn = document.getElementById(ids.bulkEditBtnId);
    const stateForType = simpleContentState[config.key];
    const visibleIds = getFilteredSortedSimpleContent(config).map((item) => Number(item.id || 0)).filter(Boolean);
    const selectedVisible = visibleIds.filter((id) => stateForType.selected.has(id));

    if (selectAll) {
      selectAll.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
      selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
    }
    if (bulkBtn) bulkBtn.disabled = stateForType.selected.size === 0;
  }

  function renderSimpleContentTable(config, items) {
    const ids = getSimpleContentIds(config);
    const tbody = document.getElementById(ids.tableId);
    if (!tbody) return;
    const stateForType = simpleContentState[config.key];
    stateForType.items = Array.isArray(items) ? items.slice() : [];
    tbody.innerHTML = '';
    syncSimpleContentSortLabels(config);
    syncHeadlineCategorySelects();

    const validIds = new Set(stateForType.items.map((item) => Number(item.id || 0)).filter(Boolean));
    Array.from(stateForType.selected).forEach((id) => {
      if (!validIds.has(id)) stateForType.selected.delete(id);
    });

    const rows = getFilteredSortedSimpleContent(config);
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = `No ${config.pluralLower} match current filters.`;
      tr.appendChild(td);
      tbody.appendChild(tr);
      syncSimpleContentBulkUi(config);
      return;
    }

    rows.forEach((item) => {
      const tr = document.createElement('tr');
      const selectTd = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = stateForType.selected.has(item.id);
      checkbox.addEventListener('change', function () {
        if (checkbox.checked) stateForType.selected.add(item.id);
        else stateForType.selected.delete(item.id);
        syncSimpleContentBulkUi(config);
      });
      selectTd.appendChild(checkbox);
      tr.appendChild(selectTd);

      [
        String(item[config.field] || '').trim() || '-',
        String(item.category || '').trim() || '-',
        config.pluralLabel,
        item.created_at ? new Date(item.created_at).toLocaleString() : '-',
        item.updated_at ? new Date(item.updated_at).toLocaleString() : '-',
      ].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });

      const actionsTd = document.createElement('td');
      const editBtn = App.makeIconButton('edit', `Edit ${config.singularLabel}`, function () {
        openSimpleContentEditForm(config, item);
      });
      const deleteBtn = App.makeIconButton('delete', `Delete ${config.singularLabel}`, async function () {
        if (!confirm(`Delete ${config.singularLower} "${item[config.field]}"?`)) return;
        try {
          await api(`${config.endpoint}/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
          notify(`${config.singularLabel} deleted`);
          await refreshSimpleContent(config);
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });

    syncSimpleContentBulkUi(config);
  }

  async function refreshSimpleContent(config) {
    const ids = getSimpleContentIds(config);
    const tbody = document.getElementById(ids.tableId);
    if (!tbody) return;
    try {
      const res = await api(`${config.endpoint}?limit=5000`);
      renderSimpleContentTable(config, Array.isArray(res[config.responseKey]) ? res[config.responseKey] : []);
    } catch (err) {
      notify(`Could not load ${config.pluralLower}: ${err.message}`, true);
    }
  }

  function bindSimpleContentType(config) {
    const ids = getSimpleContentIds(config);
    const createWrap = document.getElementById(ids.createWrapId);
    const toggleBtn = document.getElementById(ids.toggleBtnId);
    const form = document.getElementById(ids.formId);
    const bulkCreateForm = document.getElementById(ids.bulkCreateFormId);
    const editForm = document.getElementById(ids.editFormId);
    const cancelEditBtn = document.getElementById(ids.cancelEditBtnId);
    const selectAll = document.getElementById(ids.selectAllId);
    const bulkBtn = document.getElementById(ids.bulkEditBtnId);
    const bulkEditForm = document.getElementById(ids.bulkEditFormId);
    const backFromBulkBtn = document.getElementById(ids.bulkBackBtnId);
    const filterInput = document.getElementById(ids.textFilterId);
    const categoryFilter = document.getElementById(ids.categoryFilterId);
    const formatFilter = document.getElementById(ids.formatFilterId);
    const bulkSummary = document.getElementById(ids.bulkSummaryId);
    const categoriesBtn = document.getElementById(ids.categoryBtnId);
    const stateForType = simpleContentState[config.key];

    if (toggleBtn && createWrap) {
      toggleBtn.addEventListener('click', function () {
        const isHidden = createWrap.classList.contains('hidden');
        closeSimpleContentEditForm(config);
        syncHeadlineCategorySelects();
        createWrap.classList.toggle('hidden', !isHidden);
        toggleBtn.textContent = isHidden ? 'Hide Create' : `Create ${config.pluralLabel}`;
      });
    }

    if (categoriesBtn) {
      categoriesBtn.addEventListener('click', async function () {
        try {
          await refreshMessagingCategories();
        } catch (_) {}
        App.setActivePage('messagingManageCategoriesPage');
      });
    }

    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(form);
        const payload = {
          [config.field]: String(formData.get(config.field) || '').trim(),
          topic: String(formData.get('topic') || '').trim(),
          feedback: String(formData.get('feedback') || '').trim(),
        };
        if (!payload[config.field]) {
          notify(`${config.singularLabel} is required`, true);
          return;
        }
        try {
          await api(config.endpoint, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          notify(`${config.singularLabel} saved`);
          form.reset();
          syncHeadlineCategorySelects();
          await refreshSimpleContent(config);
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (bulkCreateForm) {
      bulkCreateForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(bulkCreateForm);
        const category = String(formData.get('topic') || '').trim();
        const values = Array.from(new Set(
          parseSimpleContentTextarea(formData.get(`${config.field}_text`))
            .map((item) => String(item || '').trim())
            .filter(Boolean)
        ));
        if (!values.length) {
          notify(`Add at least one ${config.singularLower} in the textarea`, true);
          return;
        }
        try {
          await Promise.all(values.map((value) => api(config.endpoint, {
            method: 'POST',
            body: JSON.stringify({ [config.field]: value, topic: category, feedback: '' }),
          })));
          notify(`Saved ${values.length} ${config.singularLower}${values.length === 1 ? '' : 's'}`);
          bulkCreateForm.reset();
          syncHeadlineCategorySelects();
          await refreshSimpleContent(config);
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (cancelEditBtn) {
      cancelEditBtn.addEventListener('click', function () {
        closeSimpleContentEditForm(config);
      });
    }

    if (editForm) {
      editForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(editForm);
        const id = Number(formData.get('id') || 0) || 0;
        const payload = {
          [config.field]: String(formData.get(config.field) || '').trim(),
          topic: String(formData.get('topic') || '').trim(),
          feedback: String(formData.get('feedback') || '').trim(),
        };
        if (!id) {
          notify(`${config.singularLabel} id is required`, true);
          return;
        }
        if (!payload[config.field]) {
          notify(`${config.singularLabel} is required`, true);
          return;
        }
        try {
          await api(`${config.endpoint}/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          });
          notify(`${config.singularLabel} updated`);
          closeSimpleContentEditForm(config);
          await refreshSimpleContent(config);
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (selectAll) {
      selectAll.addEventListener('change', function () {
        getFilteredSortedSimpleContent(config).forEach((item) => {
          if (selectAll.checked) stateForType.selected.add(item.id);
          else stateForType.selected.delete(item.id);
        });
        renderSimpleContentTable(config, stateForType.items);
      });
    }

    if (bulkBtn) {
      bulkBtn.addEventListener('click', function () {
        if (!stateForType.selected.size) {
          notify(`Select at least one ${config.singularLower} first`, true);
          return;
        }
        if (bulkSummary) {
          bulkSummary.textContent = `${stateForType.selected.size} ${config.singularLower}${stateForType.selected.size === 1 ? '' : 's'} selected.`;
        }
        syncHeadlineCategorySelects();
        const bulkSelect = document.getElementById(ids.bulkEditCategorySelectId);
        if (bulkSelect) bulkSelect.value = '';
        App.setActivePage(config.bulkPageId);
      });
    }

    if (backFromBulkBtn) {
      backFromBulkBtn.addEventListener('click', function () {
        App.setActivePage(config.pageId);
      });
    }

    if (bulkEditForm) {
      bulkEditForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(bulkEditForm);
        const category = String(formData.get('topic') || '').trim();
        const idsToUpdate = Array.from(stateForType.selected);
        if (!idsToUpdate.length) {
          notify(`Select at least one ${config.singularLower} first`, true);
          return;
        }
        try {
          await Promise.all(idsToUpdate.map((id) => {
            const item = stateForType.items.find((entry) => entry.id === id);
            if (!item) return Promise.resolve();
            return api(`${config.endpoint}/${encodeURIComponent(id)}`, {
              method: 'PATCH',
              body: JSON.stringify({
                [config.field]: String(item[config.field] || '').trim(),
                topic: category,
              }),
            });
          }));
          notify(`${config.pluralLabel} updated`);
          await refreshSimpleContent(config);
          App.setActivePage(config.pageId);
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (filterInput) {
      filterInput.addEventListener('input', function () {
        stateForType.filters.text = String(filterInput.value || '');
        renderSimpleContentTable(config, stateForType.items);
      });
    }

    if (categoryFilter) {
      categoryFilter.addEventListener('change', function () {
        stateForType.filters.category = String(categoryFilter.value || '');
        renderSimpleContentTable(config, stateForType.items);
      });
    }

    if (formatFilter) {
      formatFilter.addEventListener('change', function () {
        renderSimpleContentTable(config, stateForType.items);
      });
    }

    [
      [ids.sortTextBtnId, config.field],
      [ids.sortCategoryBtnId, 'category'],
      [ids.sortCreatedBtnId, 'created_at'],
      [ids.sortUpdatedBtnId, 'updated_at'],
    ].forEach(([id, key]) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', function () {
        if (stateForType.sort.key === key) {
          stateForType.sort.dir = stateForType.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          stateForType.sort.key = key;
          stateForType.sort.dir = key === config.field || key === 'category' ? 'asc' : 'desc';
        }
        renderSimpleContentTable(config, stateForType.items);
      });
    });
  }

  function bindSimpleContentPages() {
    simpleContentConfigs.forEach((config) => {
      bindSimpleContentType(config);
    });
  }

  function refreshAllSimpleContentPages() {
    return Promise.all(simpleContentConfigs.map((config) => refreshSimpleContent(config)));
  }

  function getSortedMessagingCategories() {
    const rows = Array.isArray(currentMessagingTopics) ? currentMessagingTopics.slice() : [];
    rows.sort(function (a, b) {
      const left = String(a?.category || '').toLowerCase();
      const right = String(b?.category || '').toLowerCase();
      if (left === right) return 0;
      const result = left < right ? -1 : 1;
      return messagingTopicTableState.dir === 'asc' ? result : -result;
    });
    return rows;
  }

  function openMessagingCategoryEditForm(item) {
    const form = document.getElementById('messagingCategoryEditForm');
    const idInput = document.getElementById('messagingCategoryEditId');
    if (!form || !idInput || !item) return;
    form.reset();
    idInput.value = String(item.id || '');
    if (form.elements.topic) {
      form.elements.topic.value = String(item.topic || item.category || '');
    }
    App.setActivePage('editMessagingCategoryPage');
  }

  function renderMessagingCategoriesTable(categories) {
    const tbody = document.getElementById('messagingCategoriesTable');
    const sortBtn = document.getElementById('messagingCategoriesSortBtn');
    currentMessagingTopics = Array.isArray(categories) ? categories.slice() : [];
    renderMessagingCategoriesMap(currentMessagingTopics);
    syncHeadlineCategorySelects();
    if (!tbody) return;
    tbody.innerHTML = '';
    if (sortBtn) {
      sortBtn.textContent = `Topic${messagingTopicTableState.dir === 'asc' ? ' ▲' : ' ▼'}`;
    }

    const rows = getSortedMessagingCategories();
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 2;
      td.textContent = 'No messaging topics yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    rows.forEach((item) => {
      const tr = document.createElement('tr');
      const categoryTd = document.createElement('td');
      categoryTd.textContent = String(item.topic || item.category || '').trim() || '-';
      tr.appendChild(categoryTd);

      const actionsTd = document.createElement('td');
      actionsTd.className = 'messaging-topics-actions-cell';
      const editBtn = App.makeIconButton('edit', 'Edit Topic', function () {
        openMessagingCategoryEditForm(item);
      });
      const deleteBtn = App.makeIconButton('delete', 'Delete Topic', async function () {
        if (!confirm(`Delete messaging topic "${String(item.topic || item.category || '').trim()}"?`)) return;
        try {
          await api(`/api/messaging/topics/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
          notify('Messaging topic deleted');
          await refreshMessagingCategories();
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);

      tbody.appendChild(tr);
    });
  }

  async function refreshMessagingCategories() {
    try {
      const res = await api('/api/messaging/topics?limit=5000');
      const categories = Array.isArray(res?.topics)
        ? res.topics
        : Array.isArray(res?.categories)
          ? res.categories
        : Array.isArray(res?.data)
          ? res.data
          : Array.isArray(res)
            ? res
            : [];
      renderMessagingCategoriesTable(categories);
    } catch (err) {
      notify(`Could not load messaging topics: ${err.message}`, true);
    }
  }

  async function submitTopicCreate(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const form = document.getElementById('messagingCategoryForm');
    if (!form) return false;
    const formData = new FormData(form);
    const topic = String(formData.get('topic') || formData.get('category') || '').trim();
    if (!topic) {
      notify('Topic is required', true);
      return false;
    }
    try {
      await api('/api/messaging/topics', {
        method: 'POST',
        body: JSON.stringify({ topic }),
      });
      notify('Messaging topic saved');
      form.reset();
      await refreshMessagingCategories();
      setTopicsCreateVisible(true);
      App.setActivePage('messagingCategoriesPage');
    } catch (err) {
      notify(err.message, true);
    }
    return false;
  }

  async function submitTopicEdit(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const form = document.getElementById('messagingCategoryEditForm');
    if (!form) return false;
    const formData = new FormData(form);
    const id = Number(formData.get('id') || 0) || 0;
    const topic = String(formData.get('topic') || formData.get('category') || '').trim();
    if (!id) {
      notify('Topic id is required', true);
      return false;
    }
    if (!topic) {
      notify('Topic is required', true);
      return false;
    }
    try {
      await api(`/api/messaging/topics/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ topic }),
      });
      notify('Messaging topic updated');
      form.reset();
      await refreshMessagingCategories();
      openTopicsPage();
    } catch (err) {
      notify(err.message, true);
    }
    return false;
  }

  function getSortedMessagingTags() {
    const rows = Array.isArray(currentMessagingTags) ? currentMessagingTags.slice() : [];
    rows.sort(function (a, b) {
      const left = String(a?.tag || '').toLowerCase();
      const right = String(b?.tag || '').toLowerCase();
      if (left === right) return 0;
      const result = left < right ? -1 : 1;
      return messagingTagTableState.dir === 'asc' ? result : -result;
    });
    return rows;
  }

  function openMessagingTagEditForm(item) {
    const form = document.getElementById('messagingTagEditForm');
    const idInput = document.getElementById('messagingTagEditId');
    if (!form || !idInput || !item) return;
    form.reset();
    idInput.value = String(item.id || '');
    form.elements.tag.value = String(item.tag || '');
    App.setActivePage('editMessagingTagPage');
  }

  function renderMessagingTagsTable(tags) {
    const tbody = document.getElementById('messagingTagsTable');
    const sortBtn = document.getElementById('messagingTagsSortBtn');
    currentMessagingTags = Array.isArray(tags) ? tags.slice() : [];
    if (!tbody) return;
    tbody.innerHTML = '';
    if (sortBtn) {
      sortBtn.textContent = `Tag${messagingTagTableState.dir === 'asc' ? ' ▲' : ' ▼'}`;
    }
    const rows = getSortedMessagingTags();
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 2;
      td.textContent = 'No messaging tags yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    rows.forEach((item) => {
      const tr = document.createElement('tr');
      const tagTd = document.createElement('td');
      tagTd.textContent = String(item.tag || '').trim() || '-';
      tr.appendChild(tagTd);

      const actionsTd = document.createElement('td');
      actionsTd.className = 'messaging-topics-actions-cell';
      const editBtn = App.makeIconButton('edit', 'Edit Tag', function () {
        openMessagingTagEditForm(item);
      });
      const deleteBtn = App.makeIconButton('delete', 'Delete Tag', async function () {
        if (!confirm(`Delete messaging tag "${item.tag}"?`)) return;
        try {
          await api(`/api/messaging/tags/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
          notify('Messaging tag deleted');
          await refreshMessagingTags();
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
  }

  async function refreshMessagingTags() {
    try {
      const res = await api('/api/messaging/tags?limit=5000');
      const tags = Array.isArray(res?.tags)
        ? res.tags
        : Array.isArray(res?.data)
          ? res.data
          : Array.isArray(res)
            ? res
            : [];
      renderMessagingTagsTable(tags);
    } catch (err) {
      notify(`Could not load messaging tags: ${err.message}`, true);
    }
  }

  async function submitTagCreate(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const form = document.getElementById('messagingTagForm');
    if (!form) return false;
    const formData = new FormData(form);
    const tag = String(formData.get('tag') || '').trim();
    if (!tag) {
      notify('Tag is required', true);
      return false;
    }
    try {
      await api('/api/messaging/tags', {
        method: 'POST',
        body: JSON.stringify({ tag }),
      });
      notify('Messaging tag saved');
      form.reset();
      await refreshMessagingTags();
      setTagsCreateVisible(true);
      App.setActivePage('messagingTagsPage');
    } catch (err) {
      notify(err.message, true);
    }
    return false;
  }

  async function submitTagEdit(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const form = document.getElementById('messagingTagEditForm');
    if (!form) return false;
    const formData = new FormData(form);
    const id = Number(formData.get('id') || 0) || 0;
    const tag = String(formData.get('tag') || '').trim();
    if (!id) {
      notify('Tag id is required', true);
      return false;
    }
    if (!tag) {
      notify('Tag is required', true);
      return false;
    }
    try {
      await api(`/api/messaging/tags/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ tag }),
      });
      notify('Messaging tag updated');
      form.reset();
      await refreshMessagingTags();
      openTagsPage();
    } catch (err) {
      notify(err.message, true);
    }
    return false;
  }

  async function saveArticleFromForm(form) {
    const formData = new FormData(form);
    const payload = {
      platform: String(formData.get('platform') || '').trim(),
      author: String(formData.get('author') || '').trim(),
      title: String(formData.get('title') || '').trim(),
      subtitle: String(formData.get('subtitle') || '').trim(),
      url: String(formData.get('url') || '').trim(),
      content: String(formData.get('content') || '').trim(),
      feedback: String(formData.get('feedback') || '').trim(),
      publish_date: String(formData.get('publish_date') || '').trim(),
      thumbnail_asset_id: Number(formData.get('thumbnail_asset_id') || 0) || null,
    };
    await api('/api/messaging/articles', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async function updateArticleFromForm(form) {
    const formData = new FormData(form);
    const id = Number(formData.get('id') || 0) || 0;
    const payload = {
      platform: String(formData.get('platform') || '').trim(),
      author: String(formData.get('author') || '').trim(),
      title: String(formData.get('title') || '').trim(),
      subtitle: String(formData.get('subtitle') || '').trim(),
      url: String(formData.get('url') || '').trim(),
      content: String(formData.get('content') || '').trim(),
      feedback: String(formData.get('feedback') || '').trim(),
      publish_date: String(formData.get('publish_date') || '').trim(),
      thumbnail_asset_id: Number(formData.get('thumbnail_asset_id') || 0) || null,
    };
    await api(`/api/messaging/articles/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  async function saveReportFromForm(form) {
    const formData = new FormData(form);
    const payload = {
      platform: String(formData.get('platform') || '').trim(),
      author: String(formData.get('author') || '').trim(),
      title: String(formData.get('title') || '').trim(),
      subtitle: String(formData.get('subtitle') || '').trim(),
      url: String(formData.get('url') || '').trim(),
      content: String(formData.get('content') || '').trim(),
      feedback: String(formData.get('feedback') || '').trim(),
      publish_date: String(formData.get('publish_date') || '').trim(),
      thumbnail_asset_id: Number(formData.get('thumbnail_asset_id') || 0) || null,
    };
    Object.assign(payload, await getWhitePaperPdfFields(form.elements.pdf_file));
    await api('/api/messaging/reports', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async function updateReportFromForm(form) {
    const formData = new FormData(form);
    const id = Number(formData.get('id') || 0) || 0;
    const existing = currentReports.find((item) => item.id === id) || null;
    const payload = {
      platform: String(formData.get('platform') || '').trim(),
      author: String(formData.get('author') || '').trim(),
      title: String(formData.get('title') || '').trim(),
      subtitle: String(formData.get('subtitle') || '').trim(),
      url: String(formData.get('url') || '').trim(),
      content: String(formData.get('content') || '').trim(),
      feedback: String(formData.get('feedback') || '').trim(),
      publish_date: String(formData.get('publish_date') || '').trim(),
      thumbnail_asset_id: Number(formData.get('thumbnail_asset_id') || 0) || null,
    };
    Object.assign(payload, await getWhitePaperPdfFields(form.elements.pdf_file, existing));
    await api(`/api/messaging/reports/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  async function saveWhitePaperFromForm(form) {
    const formData = new FormData(form);
    const payload = {
      platform: String(formData.get('platform') || '').trim(),
      author: String(formData.get('author') || '').trim(),
      title: String(formData.get('title') || '').trim(),
      subtitle: String(formData.get('subtitle') || '').trim(),
      url: String(formData.get('url') || '').trim(),
      content: String(formData.get('content') || '').trim(),
      feedback: String(formData.get('feedback') || '').trim(),
      publish_date: String(formData.get('publish_date') || '').trim(),
      thumbnail_asset_id: Number(formData.get('thumbnail_asset_id') || 0) || null,
    };
    Object.assign(payload, await getWhitePaperPdfFields(form.elements.pdf_file));
    await api('/api/messaging/white-papers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async function updateWhitePaperFromForm(form) {
    const formData = new FormData(form);
    const id = Number(formData.get('id') || 0) || 0;
    const existing = currentWhitePapers.find((item) => item.id === id) || null;
    const payload = {
      platform: String(formData.get('platform') || '').trim(),
      author: String(formData.get('author') || '').trim(),
      title: String(formData.get('title') || '').trim(),
      subtitle: String(formData.get('subtitle') || '').trim(),
      url: String(formData.get('url') || '').trim(),
      content: String(formData.get('content') || '').trim(),
      feedback: String(formData.get('feedback') || '').trim(),
      publish_date: String(formData.get('publish_date') || '').trim(),
      thumbnail_asset_id: Number(formData.get('thumbnail_asset_id') || 0) || null,
    };
    Object.assign(payload, await getWhitePaperPdfFields(form.elements.pdf_file, existing));
    await api(`/api/messaging/white-papers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  async function saveEbookFromForm(form) {
    const formData = new FormData(form);
    const payload = {
      platform: String(formData.get('platform') || '').trim(),
      author: String(formData.get('author') || '').trim(),
      title: String(formData.get('title') || '').trim(),
      subtitle: String(formData.get('subtitle') || '').trim(),
      url: String(formData.get('url') || '').trim(),
      content: String(formData.get('content') || '').trim(),
      feedback: String(formData.get('feedback') || '').trim(),
      publish_date: String(formData.get('publish_date') || '').trim(),
      thumbnail_asset_id: Number(formData.get('thumbnail_asset_id') || 0) || null,
    };
    Object.assign(payload, await getWhitePaperPdfFields(form.elements.pdf_file));
    await api('/api/messaging/ebooks', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async function updateEbookFromForm(form) {
    const formData = new FormData(form);
    const id = Number(formData.get('id') || 0) || 0;
    const existing = currentEbooks.find((item) => item.id === id) || null;
    const payload = {
      platform: String(formData.get('platform') || '').trim(),
      author: String(formData.get('author') || '').trim(),
      title: String(formData.get('title') || '').trim(),
      subtitle: String(formData.get('subtitle') || '').trim(),
      url: String(formData.get('url') || '').trim(),
      content: String(formData.get('content') || '').trim(),
      feedback: String(formData.get('feedback') || '').trim(),
      publish_date: String(formData.get('publish_date') || '').trim(),
      thumbnail_asset_id: Number(formData.get('thumbnail_asset_id') || 0) || null,
    };
    Object.assign(payload, await getWhitePaperPdfFields(form.elements.pdf_file, existing));
    await api(`/api/messaging/ebooks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  async function saveTweetFromForm(form) {
    const formData = new FormData(form);
    const payload = {
      topic: String(formData.get('topic') || formData.get('category') || '').trim(),
      content: String(formData.get('content') || '').trim(),
      url: String(formData.get('url') || '').trim(),
      hashtags: String(formData.get('hashtags') || '').trim(),
      feedback: String(formData.get('feedback') || '').trim(),
      image_asset_id: Number(formData.get('image_asset_id') || 0) || null,
    };
    await api('/api/messaging/tweets', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async function updateTweetFromForm(form) {
    const formData = new FormData(form);
    const id = Number(formData.get('id') || 0) || 0;
    const payload = {
      topic: String(formData.get('topic') || formData.get('category') || '').trim(),
      content: String(formData.get('content') || '').trim(),
      url: String(formData.get('url') || '').trim(),
      hashtags: String(formData.get('hashtags') || '').trim(),
      feedback: String(formData.get('feedback') || '').trim(),
      image_asset_id: Number(formData.get('image_asset_id') || 0) || null,
    };
    await api(`/api/messaging/tweets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  function init() {
    ensureSimpleContentPages();
    const messagingContentTextFilter = document.getElementById('messagingContentTextFilter');
    const messagingContentFormatFilter = document.getElementById('messagingContentFormatFilter');
    const messagingContentTopicFilter = document.getElementById('messagingContentTopicFilter');
    const messagingContentFiltersGoBtn = document.getElementById('messagingContentFiltersGoBtn');
    const headlinesCreateWrap = document.getElementById('messagingHeadlinesCreateWrap');
    const headlinesToggleBtn = document.getElementById('messagingHeadlinesToggleFormBtn');
    const headlineForm = document.getElementById('messagingHeadlineForm');
    const headlinesBulkCreateForm = document.getElementById('messagingHeadlinesBulkCreateForm');
    const headlineEditForm = document.getElementById('messagingHeadlineEditForm');
    const headlineCancelEditBtn = document.getElementById('messagingHeadlineCancelEditBtn');
    const headlineSelectAllVisible = document.getElementById('messagingHeadlinesSelectAllVisible');
    const headlinesBulkEditBtn = document.getElementById('messagingHeadlinesBulkEditBtn');
    const headlinesBulkEditForm = document.getElementById('messagingHeadlinesBulkEditForm');
    const headlinesBackFromBulkEditBtn = document.getElementById('messagingHeadlinesBackFromBulkEditBtn');
    const headlineFilterInput = document.getElementById('messagingHeadlinesHeadlineFilter');
    const headlineCategoryFilter = document.getElementById('messagingHeadlinesCategoryFilter');
    const headlineFormatFilter = document.getElementById('messagingHeadlinesFormatFilter');
    const headlineBulkEditSummary = document.getElementById('messagingHeadlinesBulkEditSummary');
    const subheadingsCreateWrap = document.getElementById('messagingSubheadingsCreateWrap');
    const subheadingsToggleBtn = document.getElementById('messagingSubheadingsToggleFormBtn');
    const subheadingForm = document.getElementById('messagingSubheadingForm');
    const subheadingsBulkCreateForm = document.getElementById('messagingSubheadingsBulkCreateForm');
    const subheadingEditForm = document.getElementById('messagingSubheadingEditForm');
    const subheadingCancelEditBtn = document.getElementById('messagingSubheadingCancelEditBtn');
    const subheadingSelectAllVisible = document.getElementById('messagingSubheadingsSelectAllVisible');
    const subheadingsBulkEditBtn = document.getElementById('messagingSubheadingsBulkEditBtn');
    const subheadingsBulkEditForm = document.getElementById('messagingSubheadingsBulkEditForm');
    const subheadingsBackFromBulkEditBtn = document.getElementById('messagingSubheadingsBackFromBulkEditBtn');
    const subheadingFilterInput = document.getElementById('messagingSubheadingsTextFilter');
    const subheadingCategoryFilter = document.getElementById('messagingSubheadingsCategoryFilter');
    const subheadingBulkEditSummary = document.getElementById('messagingSubheadingsBulkEditSummary');
    const openMessagingCategoriesFromSubheadingsBtn = document.getElementById('openMessagingCategoriesFromSubheadingsBtn');
    const taglinesCreateWrap = document.getElementById('messagingTaglinesCreateWrap');
    const taglinesToggleBtn = document.getElementById('messagingTaglinesToggleFormBtn');
    const taglineForm = document.getElementById('messagingTaglineForm');
    const taglinesBulkCreateForm = document.getElementById('messagingTaglinesBulkCreateForm');
    const taglineEditForm = document.getElementById('messagingTaglineEditForm');
    const taglineCancelEditBtn = document.getElementById('messagingTaglineCancelEditBtn');
    const taglineSelectAllVisible = document.getElementById('messagingTaglinesSelectAllVisible');
    const taglinesBulkEditBtn = document.getElementById('messagingTaglinesBulkEditBtn');
    const taglinesBulkEditForm = document.getElementById('messagingTaglinesBulkEditForm');
    const taglinesBackFromBulkEditBtn = document.getElementById('messagingTaglinesBackFromBulkEditBtn');
    const taglineFilterInput = document.getElementById('messagingTaglinesTextFilter');
    const taglineCategoryFilter = document.getElementById('messagingTaglinesCategoryFilter');
    const taglineBulkEditSummary = document.getElementById('messagingTaglinesBulkEditSummary');
    const openMessagingCategoriesFromTaglinesBtn = document.getElementById('openMessagingCategoriesFromTaglinesBtn');
    const pitchesCreateWrap = document.getElementById('messagingPitchesCreateWrap');
    const pitchesToggleBtn = document.getElementById('messagingPitchesToggleFormBtn');
    const pitchForm = document.getElementById('messagingPitchForm');
    const pitchesBulkCreateForm = document.getElementById('messagingPitchesBulkCreateForm');
    const pitchEditForm = document.getElementById('messagingPitchEditForm');
    const pitchCancelEditBtn = document.getElementById('messagingPitchCancelEditBtn');
    const pitchSelectAllVisible = document.getElementById('messagingPitchesSelectAllVisible');
    const pitchesBulkEditBtn = document.getElementById('messagingPitchesBulkEditBtn');
    const pitchesBulkEditForm = document.getElementById('messagingPitchesBulkEditForm');
    const pitchesBackFromBulkEditBtn = document.getElementById('messagingPitchesBackFromBulkEditBtn');
    const pitchFilterInput = document.getElementById('messagingPitchesTextFilter');
    const pitchCategoryFilter = document.getElementById('messagingPitchesCategoryFilter');
    const pitchBulkEditSummary = document.getElementById('messagingPitchesBulkEditSummary');
    const openMessagingCategoriesFromPitchesBtn = document.getElementById('openMessagingCategoriesFromPitchesBtn');
    const form = document.getElementById('messagingArticlesForm');
    const editForm = document.getElementById('messagingArticlesEditForm');
    const cancelEditBtn = document.getElementById('messagingArticlesCancelEditBtn');
    const toggleBtn = document.getElementById('messagingArticlesToggleFormBtn');
    const reportsForm = document.getElementById('messagingReportsForm');
    const reportsEditForm = document.getElementById('messagingReportsEditForm');
    const reportsCancelEditBtn = document.getElementById('messagingReportsCancelEditBtn');
    const reportsToggleBtn = document.getElementById('messagingReportsToggleFormBtn');
    const whitePapersForm = document.getElementById('messagingWhitePapersForm');
    const whitePapersEditForm = document.getElementById('messagingWhitePapersEditForm');
    const whitePapersCancelEditBtn = document.getElementById('messagingWhitePapersCancelEditBtn');
    const whitePapersToggleBtn = document.getElementById('messagingWhitePapersToggleFormBtn');
    const ebooksForm = document.getElementById('messagingEbooksForm');
    const ebooksEditForm = document.getElementById('messagingEbooksEditForm');
    const ebooksCancelEditBtn = document.getElementById('messagingEbooksCancelEditBtn');
    const ebooksToggleBtn = document.getElementById('messagingEbooksToggleFormBtn');
    const tweetsWorkspace = document.getElementById('messagingTweetsWorkspace');
    const tweetsForm = document.getElementById('messagingTweetsForm');
    const tweetEditForm = document.getElementById('messagingTweetsEditForm');
    const tweetToggleBtn = document.getElementById('messagingTweetsToggleFormBtn');
    const tweetCancelEditBtn = document.getElementById('messagingTweetsCancelEditBtn');
    const tweetGenerateBtn = document.getElementById('messagingTweetsGenerateBtn');
    const tweetClearSuggestionsBtn = document.getElementById('messagingTweetsClearSuggestionsBtn');
    const tweetSaveSelectedBtn = document.getElementById('messagingTweetsSaveSelectedBtn');
    const tweetSelectAllSuggestions = document.getElementById('messagingTweetsSelectAllSuggestions');
    const hashtagsForm = document.getElementById('messagingHashtagsForm');
    const hashtagsToggleBtn = document.getElementById('messagingHashtagsToggleFormBtn');
    const openMessagingCategoriesBtn = document.getElementById('openMessagingCategoriesPageBtn');
    const openCreateMessagingCategoryBtn = document.getElementById('openCreateMessagingCategoryPageBtn');
    const backToMessagingCategoriesBtn = document.getElementById('backToMessagingCategoriesBtn');
    const backFromMessagingCategoryEditBtn = document.getElementById('backFromEditMessagingCategoryBtn');
    const contentClearFilterBtn = document.getElementById('messagingContentClearFilterBtn');
    const messagingCategoryForm = document.getElementById('messagingCategoryForm');
    const messagingCategoryEditForm = document.getElementById('messagingCategoryEditForm');
    const messagingCategorySortBtn = document.getElementById('messagingCategoriesSortBtn');

    if (messagingContentTextFilter) {
      messagingContentTextFilter.addEventListener('input', function () {
        renderMessagingContentLibraryTable();
      });
    }
    if (messagingContentFormatFilter) {
      messagingContentFormatFilter.addEventListener('change', function () {
        renderMessagingContentLibraryTable();
      });
    }
    if (messagingContentTopicFilter) {
      messagingContentTopicFilter.addEventListener('change', function () {
        renderMessagingContentLibraryTable();
      });
    }
    if (messagingContentFiltersGoBtn) {
      messagingContentFiltersGoBtn.addEventListener('click', function () {
        renderMessagingContentLibraryTable();
      });
    }

    bindSortableTableButtons([
      { id: 'messagingArticlesSortPublishBtn', key: 'publish_date', defaultDir: 'desc' },
      { id: 'messagingArticlesSortTitleBtn', key: 'title', defaultDir: 'asc' },
      { id: 'messagingArticlesSortPlatformBtn', key: 'platform', defaultDir: 'asc' },
      { id: 'messagingArticlesSortAuthorBtn', key: 'author', defaultDir: 'asc' },
      { id: 'messagingArticlesSortThumbnailBtn', key: 'thumbnail_asset_id', defaultDir: 'desc' },
    ], articleTableState, function () {
      renderArticlesTable(currentArticles);
    });

    bindSortableTableButtons([
      { id: 'messagingReportsSortPublishBtn', key: 'publish_date', defaultDir: 'desc' },
      { id: 'messagingReportsSortTitleBtn', key: 'title', defaultDir: 'asc' },
      { id: 'messagingReportsSortPlatformBtn', key: 'platform', defaultDir: 'asc' },
      { id: 'messagingReportsSortAuthorBtn', key: 'author', defaultDir: 'asc' },
      { id: 'messagingReportsSortThumbnailBtn', key: 'thumbnail_asset_id', defaultDir: 'desc' },
      { id: 'messagingReportsSortPdfBtn', key: 'pdf_name', defaultDir: 'asc' },
    ], reportTableState, function () {
      renderReportsTable(currentReports);
    });

    bindSortableTableButtons([
      { id: 'messagingWhitePapersSortPublishBtn', key: 'publish_date', defaultDir: 'desc' },
      { id: 'messagingWhitePapersSortTitleBtn', key: 'title', defaultDir: 'asc' },
      { id: 'messagingWhitePapersSortPlatformBtn', key: 'platform', defaultDir: 'asc' },
      { id: 'messagingWhitePapersSortAuthorBtn', key: 'author', defaultDir: 'asc' },
      { id: 'messagingWhitePapersSortThumbnailBtn', key: 'thumbnail_asset_id', defaultDir: 'desc' },
      { id: 'messagingWhitePapersSortPdfBtn', key: 'pdf_name', defaultDir: 'asc' },
    ], whitePaperTableState, function () {
      renderWhitePapersTable(currentWhitePapers);
    });

    bindSortableTableButtons([
      { id: 'messagingEbooksSortPublishBtn', key: 'publish_date', defaultDir: 'desc' },
      { id: 'messagingEbooksSortTitleBtn', key: 'title', defaultDir: 'asc' },
      { id: 'messagingEbooksSortPlatformBtn', key: 'platform', defaultDir: 'asc' },
      { id: 'messagingEbooksSortAuthorBtn', key: 'author', defaultDir: 'asc' },
      { id: 'messagingEbooksSortThumbnailBtn', key: 'thumbnail_asset_id', defaultDir: 'desc' },
      { id: 'messagingEbooksSortPdfBtn', key: 'pdf_name', defaultDir: 'asc' },
    ], ebookTableState, function () {
      renderEbooksTable(currentEbooks);
    });

    bindSortableTableButtons([
      { id: 'messagingTweetsSortCreatedBtn', key: 'created_at', defaultDir: 'desc' },
      { id: 'messagingTweetsSortContentBtn', key: 'content', defaultDir: 'asc' },
      { id: 'messagingTweetsSortUrlBtn', key: 'url', defaultDir: 'asc' },
      { id: 'messagingTweetsSortHashtagsBtn', key: 'hashtags', defaultDir: 'asc' },
      { id: 'messagingTweetsSortImageBtn', key: 'image_asset_id', defaultDir: 'desc' },
    ], tweetTableState, function () {
      renderTweetsTable(currentTweets);
    });

    if (headlinesToggleBtn && headlinesCreateWrap) {
      headlinesToggleBtn.addEventListener('click', function () {
        const isHidden = headlinesCreateWrap.classList.contains('hidden');
        closeHeadlineEditForm();
        syncHeadlineCategorySelects();
        headlinesCreateWrap.classList.toggle('hidden', !isHidden);
        headlinesToggleBtn.textContent = isHidden ? 'Hide Create' : 'Create Headlines';
      });
    }

    if (subheadingsToggleBtn && subheadingsCreateWrap) {
      subheadingsToggleBtn.addEventListener('click', function () {
        const isHidden = subheadingsCreateWrap.classList.contains('hidden');
        closeSubheadingEditForm();
        syncHeadlineCategorySelects();
        subheadingsCreateWrap.classList.toggle('hidden', !isHidden);
        subheadingsToggleBtn.textContent = isHidden ? 'Hide Create' : 'Create Sub-headings';
      });
    }

    if (openMessagingCategoriesFromSubheadingsBtn) {
      openMessagingCategoriesFromSubheadingsBtn.addEventListener('click', async function () {
        try {
          await refreshMessagingCategories();
        } catch (_) {}
        App.setActivePage('messagingManageCategoriesPage');
      });
    }

    if (taglinesToggleBtn && taglinesCreateWrap) {
      taglinesToggleBtn.addEventListener('click', function () {
        const isHidden = taglinesCreateWrap.classList.contains('hidden');
        closeTaglineEditForm();
        syncHeadlineCategorySelects();
        taglinesCreateWrap.classList.toggle('hidden', !isHidden);
        taglinesToggleBtn.textContent = isHidden ? 'Hide Create' : 'Create Taglines';
      });
    }

    if (openMessagingCategoriesFromTaglinesBtn) {
      openMessagingCategoriesFromTaglinesBtn.addEventListener('click', async function () {
        try {
          await refreshMessagingCategories();
        } catch (_) {}
        App.setActivePage('messagingManageCategoriesPage');
      });
    }

    if (pitchesToggleBtn && pitchesCreateWrap) {
      pitchesToggleBtn.addEventListener('click', function () {
        const isHidden = pitchesCreateWrap.classList.contains('hidden');
        closePitchEditForm();
        syncHeadlineCategorySelects();
        pitchesCreateWrap.classList.toggle('hidden', !isHidden);
        pitchesToggleBtn.textContent = isHidden ? 'Hide Create' : 'Create Pitches';
      });
    }

    if (openMessagingCategoriesFromPitchesBtn) {
      openMessagingCategoriesFromPitchesBtn.addEventListener('click', async function () {
        try {
          await refreshMessagingCategories();
        } catch (_) {}
        App.setActivePage('messagingManageCategoriesPage');
      });
    }

    if (headlineForm) {
      headlineForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(headlineForm);
        const payload = {
          headline: String(formData.get('headline') || '').trim(),
          topic: String(formData.get('topic') || formData.get('category') || '').trim(),
        };
        if (!payload.headline) {
          notify('Headline is required', true);
          return;
        }
        try {
          await api('/api/messaging/headlines', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          notify('Headline saved');
          headlineForm.reset();
          syncHeadlineCategorySelects();
          await refreshHeadlines();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (subheadingForm) {
      subheadingForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(subheadingForm);
        const payload = {
          subheading: String(formData.get('subheading') || '').trim(),
          topic: String(formData.get('topic') || formData.get('category') || '').trim(),
        };
        if (!payload.subheading) {
          notify('Sub-heading is required', true);
          return;
        }
        try {
          await api('/api/messaging/subheadings', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          notify('Sub-heading saved');
          subheadingForm.reset();
          syncHeadlineCategorySelects();
          await refreshSubheadings();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (taglineForm) {
      taglineForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(taglineForm);
        const payload = {
          tagline: String(formData.get('tagline') || '').trim(),
          topic: String(formData.get('topic') || formData.get('category') || '').trim(),
        };
        if (!payload.tagline) {
          notify('Tagline is required', true);
          return;
        }
        try {
          await api('/api/messaging/taglines', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          notify('Tagline saved');
          taglineForm.reset();
          syncHeadlineCategorySelects();
          await refreshTaglines();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (pitchForm) {
      pitchForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(pitchForm);
        const payload = {
          pitch: String(formData.get('pitch') || '').trim(),
          topic: String(formData.get('topic') || formData.get('category') || '').trim(),
        };
        if (!payload.pitch) {
          notify('Pitch is required', true);
          return;
        }
        try {
          await api('/api/messaging/pitches', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          notify('Pitch saved');
          pitchForm.reset();
          syncHeadlineCategorySelects();
          await refreshPitches();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (headlinesBulkCreateForm) {
      headlinesBulkCreateForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(headlinesBulkCreateForm);
        const topic = String(formData.get('topic') || formData.get('category') || '').trim();
        const textHeadlines = parseHeadlineTextarea(formData.get('headlines_text'));
        const headlines = Array.from(new Set(textHeadlines.map((item) => String(item || '').trim()).filter(Boolean)));
        if (!headlines.length) {
          notify('Add at least one headline in the textarea', true);
          return;
        }
        try {
          await Promise.all(headlines.map((headline) => api('/api/messaging/headlines', {
            method: 'POST',
            body: JSON.stringify({ headline, topic }),
          })));
          notify(`Saved ${headlines.length} headline${headlines.length === 1 ? '' : 's'}`);
          headlinesBulkCreateForm.reset();
          syncHeadlineCategorySelects();
          await refreshHeadlines();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (subheadingsBulkCreateForm) {
      subheadingsBulkCreateForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(subheadingsBulkCreateForm);
        const topic = String(formData.get('topic') || formData.get('category') || '').trim();
        const textSubheadings = parseSubheadingTextarea(formData.get('subheadings_text'));
        const subheadings = Array.from(new Set(textSubheadings.map((item) => String(item || '').trim()).filter(Boolean)));
        if (!subheadings.length) {
          notify('Add at least one sub-heading in the textarea', true);
          return;
        }
        try {
          await Promise.all(subheadings.map((subheading) => api('/api/messaging/subheadings', {
            method: 'POST',
            body: JSON.stringify({ subheading, topic }),
          })));
          notify(`Saved ${subheadings.length} sub-heading${subheadings.length === 1 ? '' : 's'}`);
          subheadingsBulkCreateForm.reset();
          syncHeadlineCategorySelects();
          await refreshSubheadings();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (taglinesBulkCreateForm) {
      taglinesBulkCreateForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(taglinesBulkCreateForm);
        const topic = String(formData.get('topic') || formData.get('category') || '').trim();
        const textTaglines = parseTaglineTextarea(formData.get('taglines_text'));
        const taglines = Array.from(new Set(textTaglines.map((item) => String(item || '').trim()).filter(Boolean)));
        if (!taglines.length) {
          notify('Add at least one tagline in the textarea', true);
          return;
        }
        try {
          await Promise.all(taglines.map((tagline) => api('/api/messaging/taglines', {
            method: 'POST',
            body: JSON.stringify({ tagline, topic }),
          })));
          notify(`Saved ${taglines.length} tagline${taglines.length === 1 ? '' : 's'}`);
          taglinesBulkCreateForm.reset();
          syncHeadlineCategorySelects();
          await refreshTaglines();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (pitchesBulkCreateForm) {
      pitchesBulkCreateForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(pitchesBulkCreateForm);
        const topic = String(formData.get('topic') || formData.get('category') || '').trim();
        const textPitches = parsePitchTextarea(formData.get('pitches_text'));
        const pitches = Array.from(new Set(textPitches.map((item) => String(item || '').trim()).filter(Boolean)));
        if (!pitches.length) {
          notify('Add at least one pitch in the textarea', true);
          return;
        }
        try {
          await Promise.all(pitches.map((pitch) => api('/api/messaging/pitches', {
            method: 'POST',
            body: JSON.stringify({ pitch, topic }),
          })));
          notify(`Saved ${pitches.length} pitch${pitches.length === 1 ? '' : 'es'}`);
          pitchesBulkCreateForm.reset();
          syncHeadlineCategorySelects();
          await refreshPitches();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (headlineCancelEditBtn) {
      headlineCancelEditBtn.addEventListener('click', function () {
        closeHeadlineEditForm();
      });
    }

    if (subheadingCancelEditBtn) {
      subheadingCancelEditBtn.addEventListener('click', function () {
        closeSubheadingEditForm();
      });
    }

    if (taglineCancelEditBtn) {
      taglineCancelEditBtn.addEventListener('click', function () {
        closeTaglineEditForm();
      });
    }

    if (pitchCancelEditBtn) {
      pitchCancelEditBtn.addEventListener('click', function () {
        closePitchEditForm();
      });
    }

    if (headlineEditForm) {
      headlineEditForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(headlineEditForm);
        const id = Number(formData.get('id') || 0) || 0;
        const payload = {
          headline: String(formData.get('headline') || '').trim(),
          topic: String(formData.get('topic') || formData.get('category') || '').trim(),
        };
        if (!id) {
          notify('Headline id is required', true);
          return;
        }
        if (!payload.headline) {
          notify('Headline is required', true);
          return;
        }
        try {
          await api(`/api/messaging/headlines/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          });
          notify('Headline updated');
          closeHeadlineEditForm();
          await refreshHeadlines();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (subheadingEditForm) {
      subheadingEditForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(subheadingEditForm);
        const id = Number(formData.get('id') || 0) || 0;
        const payload = {
          subheading: String(formData.get('subheading') || '').trim(),
          topic: String(formData.get('topic') || formData.get('category') || '').trim(),
        };
        if (!id) {
          notify('Sub-heading id is required', true);
          return;
        }
        if (!payload.subheading) {
          notify('Sub-heading is required', true);
          return;
        }
        try {
          await api(`/api/messaging/subheadings/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          });
          notify('Sub-heading updated');
          closeSubheadingEditForm();
          await refreshSubheadings();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (taglineEditForm) {
      taglineEditForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(taglineEditForm);
        const id = Number(formData.get('id') || 0) || 0;
        const payload = {
          tagline: String(formData.get('tagline') || '').trim(),
          topic: String(formData.get('topic') || formData.get('category') || '').trim(),
        };
        if (!id) {
          notify('Tagline id is required', true);
          return;
        }
        if (!payload.tagline) {
          notify('Tagline is required', true);
          return;
        }
        try {
          await api(`/api/messaging/taglines/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          });
          notify('Tagline updated');
          closeTaglineEditForm();
          await refreshTaglines();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (pitchEditForm) {
      pitchEditForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(pitchEditForm);
        const id = Number(formData.get('id') || 0) || 0;
        const payload = {
          pitch: String(formData.get('pitch') || '').trim(),
          topic: String(formData.get('topic') || formData.get('category') || '').trim(),
        };
        if (!id) {
          notify('Pitch id is required', true);
          return;
        }
        if (!payload.pitch) {
          notify('Pitch is required', true);
          return;
        }
        try {
          await api(`/api/messaging/pitches/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          });
          notify('Pitch updated');
          closePitchEditForm();
          await refreshPitches();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (headlineSelectAllVisible) {
      headlineSelectAllVisible.addEventListener('change', function () {
        getFilteredSortedHeadlines().forEach((item) => {
          if (headlineSelectAllVisible.checked) selectedHeadlineIds.add(item.id);
          else selectedHeadlineIds.delete(item.id);
        });
        renderHeadlinesTable(currentHeadlines);
      });
    }

    if (subheadingSelectAllVisible) {
      subheadingSelectAllVisible.addEventListener('change', function () {
        getFilteredSortedSubheadings().forEach((item) => {
          if (subheadingSelectAllVisible.checked) selectedSubheadingIds.add(item.id);
          else selectedSubheadingIds.delete(item.id);
        });
        renderSubheadingsTable(currentSubheadings);
      });
    }

    if (taglineSelectAllVisible) {
      taglineSelectAllVisible.addEventListener('change', function () {
        getFilteredSortedTaglines().forEach((item) => {
          if (taglineSelectAllVisible.checked) selectedTaglineIds.add(item.id);
          else selectedTaglineIds.delete(item.id);
        });
        renderTaglinesTable(currentTaglines);
      });
    }

    if (pitchSelectAllVisible) {
      pitchSelectAllVisible.addEventListener('change', function () {
        getFilteredSortedPitches().forEach((item) => {
          if (pitchSelectAllVisible.checked) selectedPitchIds.add(item.id);
          else selectedPitchIds.delete(item.id);
        });
        renderPitchesTable(currentPitches);
      });
    }

    if (headlinesBulkEditBtn) {
      headlinesBulkEditBtn.addEventListener('click', function () {
        if (!selectedHeadlineIds.size) {
          notify('Select at least one headline first', true);
          return;
        }
        if (headlineBulkEditSummary) {
          headlineBulkEditSummary.textContent = `${selectedHeadlineIds.size} headline${selectedHeadlineIds.size === 1 ? '' : 's'} selected.`;
        }
        syncHeadlineCategorySelects();
        const bulkSelect = document.getElementById('messagingHeadlinesBulkEditCategorySelect');
        if (bulkSelect) bulkSelect.value = '';
        App.setActivePage('messagingHeadlinesBulkEditPage');
      });
    }

    if (subheadingsBulkEditBtn) {
      subheadingsBulkEditBtn.addEventListener('click', function () {
        if (!selectedSubheadingIds.size) {
          notify('Select at least one sub-heading first', true);
          return;
        }
        if (subheadingBulkEditSummary) {
          subheadingBulkEditSummary.textContent = `${selectedSubheadingIds.size} sub-heading${selectedSubheadingIds.size === 1 ? '' : 's'} selected.`;
        }
        syncHeadlineCategorySelects();
        const bulkSelect = document.getElementById('messagingSubheadingsBulkEditCategorySelect');
        if (bulkSelect) bulkSelect.value = '';
        App.setActivePage('messagingSubheadingsBulkEditPage');
      });
    }

    if (taglinesBulkEditBtn) {
      taglinesBulkEditBtn.addEventListener('click', function () {
        if (!selectedTaglineIds.size) {
          notify('Select at least one tagline first', true);
          return;
        }
        if (taglineBulkEditSummary) {
          taglineBulkEditSummary.textContent = `${selectedTaglineIds.size} tagline${selectedTaglineIds.size === 1 ? '' : 's'} selected.`;
        }
        syncHeadlineCategorySelects();
        const bulkSelect = document.getElementById('messagingTaglinesBulkEditCategorySelect');
        if (bulkSelect) bulkSelect.value = '';
        App.setActivePage('messagingTaglinesBulkEditPage');
      });
    }

    if (pitchesBulkEditBtn) {
      pitchesBulkEditBtn.addEventListener('click', function () {
        if (!selectedPitchIds.size) {
          notify('Select at least one pitch first', true);
          return;
        }
        if (pitchBulkEditSummary) {
          pitchBulkEditSummary.textContent = `${selectedPitchIds.size} pitch${selectedPitchIds.size === 1 ? '' : 'es'} selected.`;
        }
        syncHeadlineCategorySelects();
        const bulkSelect = document.getElementById('messagingPitchesBulkEditCategorySelect');
        if (bulkSelect) bulkSelect.value = '';
        App.setActivePage('messagingPitchesBulkEditPage');
      });
    }

    if (headlinesBackFromBulkEditBtn) {
      headlinesBackFromBulkEditBtn.addEventListener('click', function () {
        App.setActivePage('messagingHeadlinesPage');
      });
    }

    if (subheadingsBackFromBulkEditBtn) {
      subheadingsBackFromBulkEditBtn.addEventListener('click', function () {
        App.setActivePage('messagingSubheadingsPage');
      });
    }

    if (taglinesBackFromBulkEditBtn) {
      taglinesBackFromBulkEditBtn.addEventListener('click', function () {
        App.setActivePage('messagingTaglinesPage');
      });
    }

    if (pitchesBackFromBulkEditBtn) {
      pitchesBackFromBulkEditBtn.addEventListener('click', function () {
        App.setActivePage('messagingPitchesPage');
      });
    }

    if (headlinesBulkEditForm) {
      headlinesBulkEditForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(headlinesBulkEditForm);
        const topic = String(formData.get('topic') || formData.get('category') || '').trim();
        const ids = Array.from(selectedHeadlineIds);
        if (!ids.length) {
          notify('Select at least one headline first', true);
          return;
        }
        try {
          await Promise.all(ids.map((id) => {
            const item = currentHeadlines.find((headline) => headline.id === id);
            if (!item) return Promise.resolve();
            return api(`/api/messaging/headlines/${encodeURIComponent(id)}`, {
              method: 'PATCH',
              body: JSON.stringify({
                headline: String(item.headline || '').trim(),
                topic,
              }),
            });
          }));
          notify('Headlines updated');
          await refreshHeadlines();
          App.setActivePage('messagingHeadlinesPage');
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (subheadingsBulkEditForm) {
      subheadingsBulkEditForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(subheadingsBulkEditForm);
        const topic = String(formData.get('topic') || formData.get('category') || '').trim();
        const ids = Array.from(selectedSubheadingIds);
        if (!ids.length) {
          notify('Select at least one sub-heading first', true);
          return;
        }
        try {
          await Promise.all(ids.map((id) => {
            const item = currentSubheadings.find((subheading) => subheading.id === id);
            if (!item) return Promise.resolve();
            return api(`/api/messaging/subheadings/${encodeURIComponent(id)}`, {
              method: 'PATCH',
              body: JSON.stringify({
                subheading: String(item.subheading || '').trim(),
                topic,
              }),
            });
          }));
          notify('Sub-headings updated');
          await refreshSubheadings();
          App.setActivePage('messagingSubheadingsPage');
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (taglinesBulkEditForm) {
      taglinesBulkEditForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(taglinesBulkEditForm);
        const topic = String(formData.get('topic') || formData.get('category') || '').trim();
        const ids = Array.from(selectedTaglineIds);
        if (!ids.length) {
          notify('Select at least one tagline first', true);
          return;
        }
        try {
          await Promise.all(ids.map((id) => {
            const item = currentTaglines.find((tagline) => tagline.id === id);
            if (!item) return Promise.resolve();
            return api(`/api/messaging/taglines/${encodeURIComponent(id)}`, {
              method: 'PATCH',
              body: JSON.stringify({
                tagline: String(item.tagline || '').trim(),
                topic,
              }),
            });
          }));
          notify('Taglines updated');
          await refreshTaglines();
          App.setActivePage('messagingTaglinesPage');
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (pitchesBulkEditForm) {
      pitchesBulkEditForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(pitchesBulkEditForm);
        const topic = String(formData.get('topic') || formData.get('category') || '').trim();
        const ids = Array.from(selectedPitchIds);
        if (!ids.length) {
          notify('Select at least one pitch first', true);
          return;
        }
        try {
          await Promise.all(ids.map((id) => {
            const item = currentPitches.find((pitch) => pitch.id === id);
            if (!item) return Promise.resolve();
            return api(`/api/messaging/pitches/${encodeURIComponent(id)}`, {
              method: 'PATCH',
              body: JSON.stringify({
                pitch: String(item.pitch || '').trim(),
                topic,
              }),
            });
          }));
          notify('Pitches updated');
          await refreshPitches();
          App.setActivePage('messagingPitchesPage');
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (headlineFilterInput) {
      headlineFilterInput.addEventListener('input', function () {
        headlineTableState.filters.headline = String(headlineFilterInput.value || '');
        renderHeadlinesTable(currentHeadlines);
      });
    }

    if (subheadingFilterInput) {
      subheadingFilterInput.addEventListener('input', function () {
        subheadingTableState.filters.subheading = String(subheadingFilterInput.value || '');
        renderSubheadingsTable(currentSubheadings);
      });
    }

    if (taglineFilterInput) {
      taglineFilterInput.addEventListener('input', function () {
        taglineTableState.filters.tagline = String(taglineFilterInput.value || '');
        renderTaglinesTable(currentTaglines);
      });
    }

    if (pitchFilterInput) {
      pitchFilterInput.addEventListener('input', function () {
        pitchTableState.filters.pitch = String(pitchFilterInput.value || '');
        renderPitchesTable(currentPitches);
      });
    }

    if (headlineCategoryFilter) {
      headlineCategoryFilter.addEventListener('change', function () {
        headlineTableState.filters.category = String(headlineCategoryFilter.value || '');
        renderHeadlinesTable(currentHeadlines);
      });
    }

    if (headlineFormatFilter) {
      headlineFormatFilter.addEventListener('change', function () {
        renderHeadlinesTable(currentHeadlines);
      });
    }

    if (subheadingCategoryFilter) {
      subheadingCategoryFilter.addEventListener('change', function () {
        subheadingTableState.filters.category = String(subheadingCategoryFilter.value || '');
        renderSubheadingsTable(currentSubheadings);
      });
    }

    if (taglineCategoryFilter) {
      taglineCategoryFilter.addEventListener('change', function () {
        taglineTableState.filters.category = String(taglineCategoryFilter.value || '');
        renderTaglinesTable(currentTaglines);
      });
    }

    if (pitchCategoryFilter) {
      pitchCategoryFilter.addEventListener('change', function () {
        pitchTableState.filters.category = String(pitchCategoryFilter.value || '');
        renderPitchesTable(currentPitches);
      });
    }

    [
      ['messagingHeadlinesSortHeadlineBtn', 'headline'],
      ['messagingHeadlinesSortCategoryBtn', 'category'],
      ['messagingHeadlinesSortCreatedBtn', 'created_at'],
      ['messagingHeadlinesSortUpdatedBtn', 'updated_at'],
    ].forEach(function ([id, key]) {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', function () {
        if (headlineTableState.sort.key === key) {
          headlineTableState.sort.dir = headlineTableState.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          headlineTableState.sort.key = key;
          headlineTableState.sort.dir = key === 'headline' || key === 'category' ? 'asc' : 'desc';
        }
        renderHeadlinesTable(currentHeadlines);
      });
    });

    [
      ['messagingSubheadingsSortTextBtn', 'subheading'],
      ['messagingSubheadingsSortCategoryBtn', 'category'],
      ['messagingSubheadingsSortCreatedBtn', 'created_at'],
      ['messagingSubheadingsSortUpdatedBtn', 'updated_at'],
    ].forEach(function ([id, key]) {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', function () {
        if (subheadingTableState.sort.key === key) {
          subheadingTableState.sort.dir = subheadingTableState.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          subheadingTableState.sort.key = key;
          subheadingTableState.sort.dir = key === 'subheading' || key === 'category' ? 'asc' : 'desc';
        }
        renderSubheadingsTable(currentSubheadings);
      });
    });

    [
      ['messagingTaglinesSortTextBtn', 'tagline'],
      ['messagingTaglinesSortCategoryBtn', 'category'],
      ['messagingTaglinesSortCreatedBtn', 'created_at'],
      ['messagingTaglinesSortUpdatedBtn', 'updated_at'],
    ].forEach(function ([id, key]) {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', function () {
        if (taglineTableState.sort.key === key) {
          taglineTableState.sort.dir = taglineTableState.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          taglineTableState.sort.key = key;
          taglineTableState.sort.dir = key === 'tagline' || key === 'category' ? 'asc' : 'desc';
        }
        renderTaglinesTable(currentTaglines);
      });
    });

    [
      ['messagingPitchesSortTextBtn', 'pitch'],
      ['messagingPitchesSortCategoryBtn', 'category'],
      ['messagingPitchesSortCreatedBtn', 'created_at'],
      ['messagingPitchesSortUpdatedBtn', 'updated_at'],
    ].forEach(function ([id, key]) {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', function () {
        if (pitchTableState.sort.key === key) {
          pitchTableState.sort.dir = pitchTableState.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          pitchTableState.sort.key = key;
          pitchTableState.sort.dir = key === 'pitch' || key === 'category' ? 'asc' : 'desc';
        }
        renderPitchesTable(currentPitches);
      });
    });

    if (openMessagingCategoriesBtn) {
      openMessagingCategoriesBtn.addEventListener('click', function () {
        openTopicsPage();
      });
    }

    if (openCreateMessagingCategoryBtn) {
      openCreateMessagingCategoryBtn.addEventListener('click', function () {
        openTopicsCreate();
      });
    }

    if (backToMessagingCategoriesBtn) {
      backToMessagingCategoriesBtn.addEventListener('click', function () {
        openTopicsPage();
      });
    }

    if (backFromMessagingCategoryEditBtn) {
      backFromMessagingCategoryEditBtn.addEventListener('click', function () {
        openTopicsPage();
      });
    }

    if (contentClearFilterBtn) {
      contentClearFilterBtn.addEventListener('click', function () {
        openManageContentLanding();
      });
    }

    if (messagingCategorySortBtn) {
      messagingCategorySortBtn.addEventListener('click', function () {
        messagingTopicTableState.dir = messagingTopicTableState.dir === 'asc' ? 'desc' : 'asc';
        renderMessagingCategoriesTable(currentMessagingTopics);
      });
    }

    const messagingTopicsGenerateBtn = document.getElementById('messagingTopicsGenerateBtn');
    const messagingTopicsSelectAllSuggestions = document.getElementById('messagingTopicsSelectAllSuggestions');
    const messagingTopicsSaveSelectedBtn = document.getElementById('messagingTopicsSaveSelectedBtn');

    if (messagingTopicsGenerateBtn) {
      messagingTopicsGenerateBtn.addEventListener('click', function () {
        generateMessagingTopicSuggestions().catch(function (err) {
          notify(err.message, true);
        });
      });
    }

    if (messagingTopicsSelectAllSuggestions) {
      messagingTopicsSelectAllSuggestions.addEventListener('change', function () {
        document.querySelectorAll('#messagingTopicsSuggestionsColumns input[type="checkbox"][data-topic-suggestion-group]').forEach(function (checkbox) {
          checkbox.checked = messagingTopicsSelectAllSuggestions.checked;
        });
      });
    }

    if (messagingTopicsSaveSelectedBtn) {
      messagingTopicsSaveSelectedBtn.addEventListener('click', function () {
        saveSelectedMessagingTopicSuggestions().catch(function (err) {
          notify(err.message, true);
        });
      });
    }

    const messagingTagSortBtn = document.getElementById('messagingTagsSortBtn');
    const messagingTagForm = document.getElementById('messagingTagForm');
    const messagingTagEditForm = document.getElementById('messagingTagEditForm');
    const messagingContentTypeForm = document.getElementById('messagingContentTypeForm');
    const messagingContentTypeCancelEditBtn = document.getElementById('messagingContentTypeCancelEditBtn');
    const messagingContentTypesSortLabelBtn = document.getElementById('messagingContentTypesSortLabelBtn');
    const messagingContentTypesSortFamilyBtn = document.getElementById('messagingContentTypesSortFamilyBtn');
    const messagingContentTypesSortUpdatedBtn = document.getElementById('messagingContentTypesSortUpdatedBtn');

    if (messagingTagSortBtn) {
      messagingTagSortBtn.addEventListener('click', function () {
        messagingTagTableState.dir = messagingTagTableState.dir === 'asc' ? 'desc' : 'asc';
        renderMessagingTagsTable(currentMessagingTags);
      });
    }

    if (messagingContentTypeForm) {
      messagingContentTypeForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(messagingContentTypeForm);
        const id = Number(formData.get('id') || 0) || 0;
        const payload = {
          format: String(formData.get('content_type_name') || '').trim(),
          family: String(formData.get('family') || '').trim(),
          enabled: formData.get('enabled') === 'on',
        };
        if (!payload.format) return notify('Content format name is required', true);
        if (!payload.family) return notify('Family is required', true);
        try {
          if (id) {
            await api(`/api/messaging/formats/${encodeURIComponent(id)}`, {
              method: 'PATCH',
              body: JSON.stringify(payload),
            });
            notify('Content format updated');
          } else {
            await api('/api/messaging/formats', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
            notify('Content format created');
          }
          resetMessagingFormatForm();
          await refreshMessagingFormats();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (messagingContentTypeCancelEditBtn) {
      messagingContentTypeCancelEditBtn.addEventListener('click', function () {
        resetMessagingFormatForm();
      });
    }

    [
      [messagingContentTypesSortLabelBtn, 'format'],
      [messagingContentTypesSortFamilyBtn, 'family'],
      [messagingContentTypesSortUpdatedBtn, 'updatedAt'],
    ].forEach(function ([btn, key]) {
      if (!btn) return;
      btn.addEventListener('click', function () {
        if (messagingFormatTableState.sort.key === key) {
          messagingFormatTableState.sort.dir = messagingFormatTableState.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          messagingFormatTableState.sort.key = key;
          messagingFormatTableState.sort.dir = key === 'updatedAt' ? 'desc' : 'asc';
        }
        renderMessagingContentTypesTable();
      });
    });

    const createContentFormat = document.getElementById('messagingCreateContentFormat');
    const createContentForm = document.getElementById('messagingCreateContentForm');
    const createContentGenerateBtn = document.getElementById('messagingCreateContentGenerateBtn');
    const createContentClearSuggestionsBtn = document.getElementById('messagingCreateContentClearSuggestionsBtn');
    const createContentSaveSelectedBtn = document.getElementById('messagingCreateContentSaveSelectedBtn');
    const createContentSaveGeneratedBtn = document.getElementById('messagingCreateContentSaveGeneratedBtn');
    const createContentReviseBtn = document.getElementById('messagingCreateContentReviseBtn');
    const createContentSelectAllSuggestions = document.getElementById('messagingCreateContentSelectAllSuggestions');
    const createContentRichtextToolbar = document.querySelector('.messaging-richtext-toolbar');
    if (createContentFormat) {
      createContentFormat.addEventListener('change', renderCreateContentDynamicFields);
    }
    if (createContentForm) {
      createContentForm.addEventListener('submit', submitCreateContentForm);
    }
    if (createContentGenerateBtn) {
      createContentGenerateBtn.addEventListener('click', generateCreateContentSuggestions);
    }
    if (createContentClearSuggestionsBtn) {
      createContentClearSuggestionsBtn.addEventListener('click', clearCreateContentSuggestions);
    }
    if (createContentSaveSelectedBtn) {
      createContentSaveSelectedBtn.addEventListener('click', saveSelectedCreateContentSuggestions);
    }
    if (createContentSaveGeneratedBtn) {
      createContentSaveGeneratedBtn.addEventListener('click', saveGeneratedCreateContentDraft);
    }
    if (createContentReviseBtn) {
      createContentReviseBtn.addEventListener('click', reviseCreateContentDraftWithFeedback);
    }
    if (createContentSelectAllSuggestions) {
      createContentSelectAllSuggestions.addEventListener('change', function () {
        const checked = Boolean(createContentSelectAllSuggestions.checked);
        document.querySelectorAll('[data-create-content-suggestion-index]').forEach((input) => {
          input.checked = checked;
        });
      });
    }
    if (createContentRichtextToolbar) {
      createContentRichtextToolbar.addEventListener('click', function (event) {
        const btn = event.target.closest('[data-richtext-command]');
        if (!btn) return;
        const command = String(btn.getAttribute('data-richtext-command') || '').trim();
        const value = String(btn.getAttribute('data-richtext-value') || '').trim() || null;
        const editor = document.getElementById('messagingCreateContentGeneratedBodyEditor');
        if (!command || !editor) return;
        editor.focus();
        document.execCommand(command, false, value);
      });
    }

    if (toggleBtn && form) {
      toggleBtn.addEventListener('click', function () {
        const isHidden = form.classList.contains('hidden');
        form.classList.toggle('hidden', !isHidden);
        toggleBtn.textContent = isHidden ? 'Hide Form' : 'Add Article';
      });
    }

    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        try {
          await saveArticleFromForm(form);
          notify('Article saved');
          form.reset();
          if (toggleBtn) toggleBtn.textContent = 'Add Article';
          form.classList.add('hidden');
          await refreshArticles();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (cancelEditBtn) {
      cancelEditBtn.addEventListener('click', function () {
        closeEditForm();
      });
    }

    if (editForm) {
      editForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        try {
          await updateArticleFromForm(editForm);
          notify('Article updated');
          closeEditForm();
          await refreshArticles();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (reportsToggleBtn && reportsForm) {
      reportsToggleBtn.addEventListener('click', function () {
        const isHidden = reportsForm.classList.contains('hidden');
        closeReportEditForm();
        reportsForm.classList.toggle('hidden', !isHidden);
        reportsToggleBtn.textContent = isHidden ? 'Hide Form' : 'Add Report';
      });
    }

    if (reportsForm) {
      reportsForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        try {
          await saveReportFromForm(reportsForm);
          notify('Report saved');
          reportsForm.reset();
          if (reportsToggleBtn) reportsToggleBtn.textContent = 'Add Report';
          reportsForm.classList.add('hidden');
          await refreshReports();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (reportsCancelEditBtn) {
      reportsCancelEditBtn.addEventListener('click', function () {
        closeReportEditForm();
      });
    }

    if (reportsEditForm) {
      reportsEditForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        try {
          await updateReportFromForm(reportsEditForm);
          notify('Report updated');
          closeReportEditForm();
          await refreshReports();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (whitePapersToggleBtn && whitePapersForm) {
      whitePapersToggleBtn.addEventListener('click', function () {
        const isHidden = whitePapersForm.classList.contains('hidden');
        closeWhitePaperEditForm();
        whitePapersForm.classList.toggle('hidden', !isHidden);
        whitePapersToggleBtn.textContent = isHidden ? 'Hide Form' : 'Add White Paper';
      });
    }

    if (whitePapersForm) {
      whitePapersForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        try {
          await saveWhitePaperFromForm(whitePapersForm);
          notify('White paper saved');
          whitePapersForm.reset();
          if (whitePapersToggleBtn) whitePapersToggleBtn.textContent = 'Add White Paper';
          whitePapersForm.classList.add('hidden');
          await refreshWhitePapers();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (whitePapersCancelEditBtn) {
      whitePapersCancelEditBtn.addEventListener('click', function () {
        closeWhitePaperEditForm();
      });
    }

    if (whitePapersEditForm) {
      whitePapersEditForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        try {
          await updateWhitePaperFromForm(whitePapersEditForm);
          notify('White paper updated');
          closeWhitePaperEditForm();
          await refreshWhitePapers();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (ebooksToggleBtn && ebooksForm) {
      ebooksToggleBtn.addEventListener('click', function () {
        const isHidden = ebooksForm.classList.contains('hidden');
        closeEbookEditForm();
        ebooksForm.classList.toggle('hidden', !isHidden);
        ebooksToggleBtn.textContent = isHidden ? 'Hide Form' : 'Add eBook';
      });
    }

    if (ebooksForm) {
      ebooksForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        try {
          await saveEbookFromForm(ebooksForm);
          notify('eBook saved');
          ebooksForm.reset();
          if (ebooksToggleBtn) ebooksToggleBtn.textContent = 'Add eBook';
          ebooksForm.classList.add('hidden');
          await refreshEbooks();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (ebooksCancelEditBtn) {
      ebooksCancelEditBtn.addEventListener('click', function () {
        closeEbookEditForm();
      });
    }

    if (ebooksEditForm) {
      ebooksEditForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        try {
          await updateEbookFromForm(ebooksEditForm);
          notify('eBook updated');
          closeEbookEditForm();
          await refreshEbooks();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (tweetToggleBtn && tweetsWorkspace) {
      tweetToggleBtn.addEventListener('click', function () {
        const isHidden = tweetsWorkspace.classList.contains('hidden');
        closeTweetEditForm();
        tweetsWorkspace.classList.toggle('hidden', !isHidden);
        if (isHidden) {
          clearTweetSuggestions();
        }
        tweetToggleBtn.textContent = isHidden ? 'Hide Form' : 'Add Tweet';
      });
    }

    if (tweetsForm) {
      tweetsForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        try {
          await saveTweetFromForm(tweetsForm);
          notify('Tweet saved');
          tweetsForm.reset();
          clearTweetSuggestions();
          renderMessagingCategorySelects();
          renderImageOptions(document.getElementById('messagingTweetImageSelect'));
          if (tweetToggleBtn) tweetToggleBtn.textContent = 'Add Tweet';
          if (tweetsWorkspace) tweetsWorkspace.classList.add('hidden');
          await refreshTweets();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (tweetCancelEditBtn) {
      tweetCancelEditBtn.addEventListener('click', function () {
        closeTweetEditForm();
      });
    }

    if (tweetGenerateBtn) {
      tweetGenerateBtn.addEventListener('click', function () {
        generateTweetSuggestions();
      });
    }

    if (tweetClearSuggestionsBtn) {
      tweetClearSuggestionsBtn.addEventListener('click', function () {
        clearTweetSuggestions();
      });
    }

    if (tweetSaveSelectedBtn) {
      tweetSaveSelectedBtn.addEventListener('click', function () {
        saveSelectedTweetSuggestions();
      });
    }

    if (tweetSelectAllSuggestions) {
      tweetSelectAllSuggestions.addEventListener('change', function () {
        document.querySelectorAll('#messagingTweetsSuggestionsTable input[type="checkbox"][data-index]').forEach((checkbox) => {
          checkbox.checked = tweetSelectAllSuggestions.checked;
        });
      });
    }

    if (tweetEditForm) {
      tweetEditForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        try {
          await updateTweetFromForm(tweetEditForm);
          notify('Tweet updated');
          closeTweetEditForm();
          await refreshTweets();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (hashtagsToggleBtn && hashtagsForm) {
      hashtagsToggleBtn.addEventListener('click', function () {
        const isHidden = hashtagsForm.classList.contains('hidden');
        hashtagsForm.classList.toggle('hidden', !isHidden);
        hashtagsToggleBtn.textContent = isHidden ? 'Hide Form' : 'Add Hashtags';
        if (isHidden) renderHashtagCampaignOptions();
      });
    }

    if (hashtagsForm) {
      hashtagsForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(hashtagsForm);
        const tags = parseBulkHashtags(formData.get('hashtags'));
        const campaignId = Number(formData.get('campaign_id') || 0) || 0;
        if (!tags.length) {
          notify('Enter at least one hashtag', true);
          return;
        }
        if (!campaignId) {
          notify('Select a campaign', true);
          return;
        }
        try {
          await api('/api/messaging/hashtags', {
            method: 'POST',
            body: JSON.stringify({ hashtags: tags, campaign_id: campaignId }),
          });
          notify(`Saved ${tags.length} hashtag${tags.length === 1 ? '' : 's'}`);
          hashtagsForm.reset();
          renderHashtagCampaignOptions();
          hashtagsForm.classList.add('hidden');
          if (hashtagsToggleBtn) hashtagsToggleBtn.textContent = 'Add Hashtags';
          await refreshHashtags();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    bindSimpleContentPages();
  }

  return {
    manifest: { id: 'messaging', label: 'Messaging', pageId: 'messagingContentPage', pagePrefixes: ['messaging'] },
    init,
    openCategoriesLanding,
    openTopicsLanding,
    openTopicsPage,
    openTopicsCreate,
    openTagsPage,
    openTagsCreate,
    openContentLanding,
    openCreateContent,
    openManageContentLanding,
    openManageContentCategory,
    openContentTarget,
    submitCreateContentForm,
    generateCreateContentSuggestions,
    submitTopicCreate,
    submitTopicEdit,
    submitTagCreate,
    submitTagEdit,
    refresh: function () {
      return loadThumbnailOptions().then(function () {
        return Promise.all([refreshHeadlines(), refreshSubheadings(), refreshTaglines(), refreshPitches(), refreshArticles(), refreshReports(), refreshWhitePapers(), refreshEbooks(), refreshAllSimpleContentPages(), refreshMessagingCategories(), refreshMessagingFormats(), refreshMessagingTags()]).then(function () {
          renderMessagingContentLibraryTable();
        });
      });
    },
    onPageActivated: function () {
      return loadThumbnailOptions().then(function () {
        return Promise.all([refreshHeadlines(), refreshSubheadings(), refreshTaglines(), refreshPitches(), refreshArticles(), refreshReports(), refreshWhitePapers(), refreshEbooks(), refreshAllSimpleContentPages(), refreshMessagingCategories(), refreshMessagingFormats(), refreshMessagingTags()]).then(function () {
          renderMessagingContentLibraryTable();
        });
      });
    }
  };
})();
