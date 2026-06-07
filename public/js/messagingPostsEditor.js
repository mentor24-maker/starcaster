'use strict';

(function initMessagingPostsEditor() {
  const POST_CHARACTER_LIMIT = 10000;

  const postTableState = { sortColumn: 'created_at', sortDirection: 'desc' };
  let currentPosts = [];
  let currentPostSuggestions = [];
  let postEditAssocFilter = '';
  let postEditAssocChecked = new Set();
  let postEditAssocAssets = [];
  let postEditAssocBound = false;
  let postPreviewAccount = { name: 'Your account', handle: '@account' };
  let taggingContacts = [];
  let taggingContactsLoaded = false;

  const POST_EDIT_ASSOC_TYPE_ORDER = ['Image', 'Video', 'Audio', 'Lead Magnet', 'File'];

  function api(path, options) {
    return App.api(path, options);
  }

  function notify(text, isError) {
    App.notify(text, isError);
  }

  function cleanText(value) {
    return String(value || '').trim();
  }

  function isValidHttpUrl(value) {
    const text = cleanText(value);
    if (!text) return false;
    try {
      const parsed = new URL(text);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function thumbnailUrlFromAsset(asset) {
    if (App.messaging?.thumbnailUrlFromAsset) return App.messaging.thumbnailUrlFromAsset(asset);
    const location = cleanText(asset?.thumbnailLocation || asset?.thumbnailUrl || asset?.location);
    return location && isValidHttpUrl(location) ? location : '';
  }

  function postCharacterCount(value) {
    return Array.from(String(value || '')).length;
  }

  function formatHashtagsForPreview(raw) {
    return String(raw || '')
      .split(/[,\s]+/)
      .map((tag) => cleanText(tag))
      .filter(Boolean)
      .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
      .join(' ');
  }

  function buildPostEditPreviewText(form) {
    if (!form) return '';
    const content = cleanText(form.elements.post?.value);
    const url = cleanText(form.elements.url?.value);
    const hashtags = formatHashtagsForPreview(form.elements.hashtags?.value);
    return [content, url, hashtags].filter(Boolean).join('\n\n');
  }

  function postEditPreviewImageAsset(form) {
    if (!form) return null;
    const imageId = Number(form.elements.image_asset_id?.value || 0) || 0;
    if (!imageId) return null;
    if (App.messaging?.imageAssetById) return App.messaging.imageAssetById(imageId);
    return null;
  }

  function postEditPanelEl() {
    return document.getElementById('messagingPostsEditPanel');
  }

  function clonePostPayload(post) {
    return {
      post: `${cleanText(post?.post) || 'Untitled'} (Clone)`,
      url: cleanText(post?.url),
      hashtags: cleanText(post?.hashtags),
      image_asset_id: Number(post?.image_asset_id || 0) || null,
      tagged_contact_id: cleanText(post?.tagged_contact_id),
      topic: cleanText(post?.topic || post?.category),
      feedback: cleanText(post?.feedback),
    };
  }

  function contactField(contact, key) {
    if (!contact || typeof contact !== 'object') return '';
    const camel = key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
    return cleanText(contact[key] ?? contact[camel]);
  }

  function contactDisplayName(contact) {
    const name = [
      contactField(contact, 'first_name'),
      contactField(contact, 'middle_name'),
      contactField(contact, 'last_name'),
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (name) return name;
    return contactField(contact, 'email') || contactField(contact, 'company') || contactField(contact, 'id');
  }

  function contactFacebookHandle(contact) {
    const raw = contactField(contact, 'facebook');
    if (!raw) return '';
    let text = raw;
    try {
      if (/^https?:\/\//i.test(text)) {
        const parsed = new URL(text);
        text = cleanText(parsed.pathname).replace(/^\/+|\/+$/g, '');
        if (text.startsWith('profile.php')) return cleanText(parsed.searchParams.get('id'));
      }
    } catch {
      // Keep raw handle below.
    }
    text = text.replace(/^@+/, '');
    text = text.replace(/^facebook\.com\//i, '');
    text = text.split(/[/?#]/)[0] || '';
    return cleanText(text);
  }

  function contactTagOptionLabel(contact) {
    const name = contactDisplayName(contact);
    const handle = contactFacebookHandle(contact);
    if (handle) return `${name} (@${handle.replace(/^@+/, '')})`;
    return `${name} (no Facebook username)`;
  }

  function taggedContactById(contactId) {
    const desired = cleanText(contactId);
    if (!desired) return null;
    return taggingContacts.find((contact) => cleanText(contact?.id) === desired) || null;
  }

  function taggedContactLabel(contactId) {
    const contact = taggedContactById(contactId);
    if (!contact) return contactId ? cleanText(contactId) : '-';
    return contactTagOptionLabel(contact);
  }

  function sortTaggingContacts(contacts) {
    return (Array.isArray(contacts) ? contacts.slice() : []).sort((left, right) => {
      const leftHasFacebook = contactFacebookHandle(left) ? 1 : 0;
      const rightHasFacebook = contactFacebookHandle(right) ? 1 : 0;
      if (leftHasFacebook !== rightHasFacebook) return rightHasFacebook - leftHasFacebook;
      return contactDisplayName(left).localeCompare(contactDisplayName(right), undefined, { sensitivity: 'base' });
    });
  }

  function renderTaggedContactOptions(selectId, selectedId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const desired = cleanText(selectedId);
    select.innerHTML = '<option value="">No one tagged</option>';
    sortTaggingContacts(taggingContacts).forEach((contact) => {
      const option = document.createElement('option');
      option.value = cleanText(contact.id);
      option.textContent = contactTagOptionLabel(contact);
      select.appendChild(option);
    });
    if (desired && Array.from(select.options).some((option) => option.value === desired)) {
      select.value = desired;
    } else {
      select.value = '';
    }
  }

  async function ensureTaggingContactsLoaded() {
    if (taggingContactsLoaded) return;
    try {
      const res = await api('/api/contacts');
      const contacts = Array.isArray(res?.contacts)
        ? res.contacts
        : (Array.isArray(res?.data) ? res.data : []);
      taggingContacts = contacts;
      taggingContactsLoaded = true;
    } catch {
      taggingContacts = [];
      taggingContactsLoaded = true;
    }
    renderTaggedContactOptions('messagingPostTaggedContact');
    renderTaggedContactOptions('messagingPostEditTaggedContact');
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
      const aTime = Date.parse(String(left || '').trim());
      const bTime = Date.parse(String(right || '').trim());
      const aValid = Number.isFinite(aTime);
      const bValid = Number.isFinite(bTime);
      const aValue = aValid ? aTime : -Infinity;
      const bValue = bValid ? bTime : -Infinity;
      if (aValue === bValue) return 0;
      return aValue < bValue ? -1 : 1;
    }
    const a = normalizeSortText(left);
    const b = normalizeSortText(right);
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }

  function sortTableRows(rows, state, columns) {
    const list = Array.isArray(rows) ? rows.slice() : [];
    const col = (columns || []).find((entry) => entry.key === state.sortColumn);
    if (!col) return list;
    const dir = state.sortDirection === 'asc' ? 1 : -1;
    return list.sort((left, right) => compareSortValues(left[col.key], right[col.key], col.type) * dir);
  }

  function updateSortButtonLabels(buttons, state) {
    (buttons || []).forEach((entry) => {
      const btn = document.getElementById(entry.id);
      if (!btn) return;
      const arrow = state.sortColumn === entry.key ? (state.sortDirection === 'asc' ? ' ▲' : ' ▼') : '';
      btn.textContent = `${entry.label}${arrow}`;
    });
  }

  function bindSortableTableButtons(buttons, state, rerender) {
    (buttons || []).forEach((entry) => {
      const btn = document.getElementById(entry.id);
      if (!btn || btn.dataset.sortBound === '1') return;
      btn.dataset.sortBound = '1';
      btn.addEventListener('click', function () {
        if (state.sortColumn === entry.key) {
          state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortColumn = entry.key;
          state.sortDirection = entry.defaultDir || 'asc';
        }
        rerender();
      });
    });
  }

  function renderPostEditPreview(form) {
    const mount = document.getElementById('messagingPostEditPreviewMount');
    if (!mount) return;

    const text = buildPostEditPreviewText(form);
    const count = postCharacterCount(text);
    const delta = POST_CHARACTER_LIMIT - count;
    const imageAsset = postEditPreviewImageAsset(form);
    const imageUrl = thumbnailUrlFromAsset(imageAsset);
    const accountName = cleanText(postPreviewAccount.name) || 'Your account';
    const accountHandle = cleanText(postPreviewAccount.handle) || '@account';
    const avatarLetter = accountName.replace(/^@/, '').charAt(0).toUpperCase() || 'P';

    mount.innerHTML = '';

    const shell = document.createElement('div');
    shell.className = 'campaign-preview-tweet-shell';

    const header = document.createElement('div');
    header.className = 'campaign-preview-tweet-header';
    const avatar = document.createElement('div');
    avatar.className = 'campaign-preview-tweet-avatar';
    avatar.textContent = avatarLetter;
    const account = document.createElement('div');
    const nameEl = document.createElement('div');
    nameEl.className = 'campaign-preview-tweet-name';
    nameEl.textContent = accountName;
    const handleEl = document.createElement('div');
    handleEl.className = 'campaign-preview-tweet-handle';
    handleEl.textContent = accountHandle;
    account.appendChild(nameEl);
    account.appendChild(handleEl);
    header.appendChild(avatar);
    header.appendChild(account);
    shell.appendChild(header);

    const textEl = document.createElement('div');
    textEl.className = text ? 'campaign-preview-tweet-text' : 'campaign-preview-empty';
    textEl.textContent = text || 'Enter post text to preview your social post.';
    shell.appendChild(textEl);

    if (imageUrl) {
      const mediaWrap = document.createElement('div');
      mediaWrap.className = 'campaign-preview-tweet-media';
      const img = document.createElement('img');
      img.src = imageUrl;
      img.alt = cleanText(imageAsset?.assetName) || 'Post image';
      mediaWrap.appendChild(img);
      shell.appendChild(mediaWrap);
    }

    const taggedContactId = cleanText(form?.elements?.tagged_contact_id?.value);
    const taggedContact = taggedContactById(taggedContactId);
    if (taggedContact) {
      const tagEl = document.createElement('div');
      tagEl.className = 'campaign-preview-tweet-meta';
      tagEl.style.marginTop = '12px';
      tagEl.textContent = `Tagging ${contactDisplayName(taggedContact)}${contactFacebookHandle(taggedContact) ? ` (@${contactFacebookHandle(taggedContact)})` : ''}`;
      shell.appendChild(tagEl);
    }

    const countEl = document.createElement('div');
    countEl.className = `campaign-preview-tweet-count ${delta < 0 ? 'is-over' : 'is-under'}`;
    const statusText = delta >= 0 ? `${delta} under limit` : `${Math.abs(delta)} over limit`;
    countEl.textContent = `${count}/${POST_CHARACTER_LIMIT} characters · ${statusText}`;
    shell.appendChild(countEl);

    const note = document.createElement('div');
    note.className = 'messaging-tweet-edit-preview-note';
    note.style.marginTop = '8px';
    note.textContent = 'Publish limits vary: Bluesky ~300 · LinkedIn 3,000 · Facebook 63,000.';
    shell.appendChild(note);

    mount.appendChild(shell);
  }

  function bindPostEditPreview(form) {
    if (!form || form.dataset.previewBound === '1') return;
    form.dataset.previewBound = '1';
    const rerender = () => renderPostEditPreview(form);
    ['post', 'url', 'hashtags', 'image_asset_id', 'tagged_contact_id'].forEach((fieldName) => {
      const field = form.elements[fieldName];
      if (!field) return;
      field.addEventListener('input', rerender);
      field.addEventListener('change', rerender);
    });
  }

  function resetPostEditAssociationsUi() {
    postEditAssocFilter = '';
    postEditAssocChecked.clear();
    const search = document.getElementById('messagingPostEditAssocSearch');
    const list = document.getElementById('messagingPostEditAssocList');
    if (search) search.value = '';
    if (list) list.innerHTML = '';
  }

  function filteredPostEditAssocAssets() {
    const query = cleanText(postEditAssocFilter).toLowerCase();
    const list = Array.isArray(postEditAssocAssets) ? postEditAssocAssets : [];
    if (!query) return list;
    return list.filter((asset) => String(asset.assetName || '').toLowerCase().includes(query));
  }

  function renderPostEditAssociationList() {
    const mount = document.getElementById('messagingPostEditAssocList');
    if (!mount) return;
    mount.innerHTML = '';
    const assets = filteredPostEditAssocAssets();
    if (!assets.length) {
      mount.textContent = 'No assets found.';
      return;
    }
    const grouped = new Map();
    assets.forEach((asset) => {
      const type = cleanText(asset.assetType) || 'Other';
      if (!grouped.has(type)) grouped.set(type, []);
      grouped.get(type).push(asset);
    });
    POST_EDIT_ASSOC_TYPE_ORDER.concat(Array.from(grouped.keys())).filter((type, index, arr) => arr.indexOf(type) === index).forEach((type) => {
      const items = grouped.get(type) || [];
      if (!items.length) return;
      const section = document.createElement('section');
      section.className = 'messaging-tweet-edit-assoc-group';
      const title = document.createElement('h4');
      title.textContent = type;
      section.appendChild(title);
      const ul = document.createElement('ul');
      ul.className = 'messaging-tweet-edit-assoc-items';
      items.forEach((asset) => {
        const assetId = Number(asset.id || 0) || 0;
        if (!assetId) return;
        const li = document.createElement('li');
        const label = document.createElement('label');
        label.className = 'messaging-tweet-edit-assoc-row';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = postEditAssocChecked.has(assetId);
        checkbox.addEventListener('change', function () {
          if (checkbox.checked) postEditAssocChecked.add(assetId);
          else postEditAssocChecked.delete(assetId);
        });
        label.appendChild(checkbox);
        label.append(` ${cleanText(asset.assetName) || `Asset ${assetId}`}`);
        li.appendChild(label);
        ul.appendChild(li);
      });
      section.appendChild(ul);
      mount.appendChild(section);
    });
  }

  async function loadPostEditAssociationAssets() {
    try {
      const res = await api('/api/assets?limit=5000');
      postEditAssocAssets = Array.isArray(res.assets) ? res.assets : (Array.isArray(res.data) ? res.data : []);
    } catch {
      postEditAssocAssets = [];
    }
    renderPostEditAssociationList();
  }

  function bindPostEditAssociations() {
    if (postEditAssocBound) return;
    postEditAssocBound = true;
    const search = document.getElementById('messagingPostEditAssocSearch');
    const applyBtn = document.getElementById('messagingPostEditAssocApplyBtn');
    if (search) {
      search.addEventListener('input', function () {
        postEditAssocFilter = search.value;
        renderPostEditAssociationList();
      });
    }
    if (applyBtn) {
      applyBtn.addEventListener('click', async function () {
        const editForm = document.getElementById('messagingPostsEditForm');
        const postId = cleanText(editForm?.elements?.id?.value);
        if (!postId) {
          notify('Post id is missing. Reload the post and try again.', true);
          return;
        }
        const assetIds = Array.from(postEditAssocChecked);
        if (!assetIds.length) {
          notify('Select at least one asset to associate.', true);
          return;
        }
        const postLabel = cleanText(editForm?.elements?.post?.value).slice(0, 100) || 'Post';
        for (const assetId of assetIds) {
          await api(`/api/assets/${encodeURIComponent(assetId)}/associations`, {
            method: 'POST',
            body: JSON.stringify({
              targetType: 'messaging_posts',
              targetId: postId,
              targetLabel: `Post: ${postLabel}`,
            }),
          });
        }
        notify(assetIds.length === 1 ? 'Asset associated' : `${assetIds.length} assets associated`);
        postEditAssocChecked.clear();
        renderPostEditAssociationList();
      });
    }
  }

  function openPostEditForm(post) {
    const editForm = document.getElementById('messagingPostsEditForm');
    const panel = postEditPanelEl();
    const workspace = document.getElementById('messagingPostsWorkspace');
    const addBtn = document.getElementById('messagingPostsToggleFormBtn');
    if (!editForm || !post) return;
    ensureTaggingContactsLoaded().then(function () {
      renderTaggedContactOptions('messagingPostEditTaggedContact', post.tagged_contact_id);
      if (editForm.elements.tagged_contact_id) {
        editForm.elements.tagged_contact_id.value = cleanText(post.tagged_contact_id);
      }
    });
    if (panel) panel.classList.remove('hidden');
    App.pageHeadingNav?.setParentHeadingVisible?.(document.getElementById('messagingPostsPageHeading'), false);
    editForm.elements.id.value = String(post.id || '');
    if (editForm.elements.topic) editForm.elements.topic.value = cleanText(post.topic || post.category);
    editForm.elements.post.value = cleanText(post.post);
    editForm.elements.url.value = cleanText(post.url);
    editForm.elements.hashtags.value = cleanText(post.hashtags);
    if (editForm.elements.quality_score) editForm.elements.quality_score.value = post.quality_score ? String(post.quality_score) : '';
    if (editForm.elements.feedback) editForm.elements.feedback.value = cleanText(post.feedback);
    editForm.elements.image_asset_id.value = post.image_asset_id ? String(post.image_asset_id) : '';
    App.messaging?.renderImageAssetPickerDisplay?.('messagingPostEditImageSelect');
    if (workspace) workspace.classList.add('hidden');
    if (addBtn) addBtn.textContent = 'Add Post';
    bindPostEditPreview(editForm);
    bindPostEditAssociations();
    App.pageHeadingNav?.bindBackLinks?.(panel || editForm);
    renderPostEditPreview(editForm);
    loadPostEditAssociationAssets();
    (panel || editForm).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closePostEditForm() {
    const editForm = document.getElementById('messagingPostsEditForm');
    const panel = postEditPanelEl();
    if (editForm) editForm.reset();
    App.messaging?.renderImageAssetPickerDisplay?.('messagingPostEditImageSelect');
    resetPostEditAssociationsUi();
    if (panel) panel.classList.add('hidden');
    App.pageHeadingNav?.setParentHeadingVisible?.(document.getElementById('messagingPostsPageHeading'), true);
  }

  function renderPostsTable(posts) {
    const tbody = document.getElementById('messagingPostsTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    const rows = Array.isArray(posts) ? posts : [];
    const sortedRows = sortTableRows(rows, postTableState, [
      { key: 'created_at', type: 'date' },
      { key: 'post', type: 'text' },
      { key: 'url', type: 'text' },
      { key: 'hashtags', type: 'text' },
      { key: 'image_asset_id', type: 'number' },
      { key: 'tagged_contact_id', type: 'text' },
    ]);
    currentPosts = rows.slice();
    if (App.messaging?.setPostsLibraryItems) App.messaging.setPostsLibraryItems(currentPosts);
    updateSortButtonLabels([
      { id: 'messagingPostsSortCreatedBtn', key: 'created_at', label: 'Created' },
      { id: 'messagingPostsSortContentBtn', key: 'post', label: 'Content' },
      { id: 'messagingPostsSortUrlBtn', key: 'url', label: 'URL' },
      { id: 'messagingPostsSortHashtagsBtn', key: 'hashtags', label: 'Hashtags' },
      { id: 'messagingPostsSortImageBtn', key: 'image_asset_id', label: 'Image' },
      { id: 'messagingPostsSortTaggedBtn', key: 'tagged_contact_id', label: 'Tagged' },
    ], postTableState);

    if (!sortedRows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 8;
      td.textContent = 'No posts yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    sortedRows.forEach((post) => {
      const tr = document.createElement('tr');
      const created = post.created_at ? new Date(post.created_at).toLocaleString() : '-';
      const content = cleanText(post.post) || '-';
      const url = cleanText(post.url);
      const hashtags = cleanText(post.hashtags) || '-';
      const imageId = Number(post.image_asset_id || 0) || 0;

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
      if (imageId && App.messaging?.imageAssetById) {
        const asset = App.messaging.imageAssetById(imageId);
        const imageUrl = thumbnailUrlFromAsset(asset);
        if (imageUrl) {
          const img = document.createElement('img');
          img.src = imageUrl;
          img.alt = cleanText(asset?.assetName) || 'post image';
          img.style.height = '50px';
          img.style.width = 'auto';
          img.style.display = 'block';
          imageTd.appendChild(img);
        } else {
          imageTd.textContent = '-';
        }
      } else {
        imageTd.textContent = imageId ? String(imageId) : '-';
      }
      tr.appendChild(imageTd);

      const taggedTd = document.createElement('td');
      taggedTd.textContent = taggedContactLabel(post.tagged_contact_id);
      tr.appendChild(taggedTd);

      const qualityTd = document.createElement('td');
      const quality = Math.max(0, Math.min(Number(post.quality_score || 0) || 0, 5));
      qualityTd.textContent = quality ? String(quality) : '-';
      tr.appendChild(qualityTd);

      const actionsTd = document.createElement('td');
      const editBtn = App.makeIconButton('edit', 'Edit Post', function () {
        openPostEditForm(post);
      });
      const cloneBtn = App.makeIconButton('clone', 'Clone Post', async function () {
        try {
          await api('/api/messaging/posts', { method: 'POST', body: JSON.stringify(clonePostPayload(post)) });
          notify('Post cloned');
          await refreshPosts();
        } catch (err) {
          notify(err.message, true);
        }
      });
      const deleteBtn = App.makeIconButton('delete', 'Delete Post', async function () {
        if (!confirm('Delete this post?')) return;
        try {
          await api(`/api/messaging/posts/${encodeURIComponent(post.id)}`, { method: 'DELETE' });
          notify('Post deleted');
          await refreshPosts();
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true });
      App.finishTableActionsCell(actionsTd, editBtn, cloneBtn, deleteBtn);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
  }

  async function refreshPosts() {
    const tbody = document.getElementById('messagingPostsTable');
    if (!tbody) return;
    try {
      await ensureTaggingContactsLoaded();
      const res = await api('/api/messaging/posts?limit=200');
      const posts = Array.isArray(res.posts) ? res.posts : (Array.isArray(res.data) ? res.data : []);
      renderPostsTable(posts);
    } catch (err) {
      notify(`Could not load posts: ${err.message}`, true);
    }
  }

  async function savePostFromForm(form) {
    const formData = new FormData(form);
    await api('/api/messaging/posts', {
      method: 'POST',
      body: JSON.stringify({
        topic: cleanText(formData.get('topic')),
        post: cleanText(formData.get('post')),
        url: cleanText(formData.get('url')),
        hashtags: cleanText(formData.get('hashtags')),
        feedback: cleanText(formData.get('feedback')),
        image_asset_id: Number(formData.get('image_asset_id') || 0) || null,
        tagged_contact_id: cleanText(formData.get('tagged_contact_id')),
        prompt_id: Number(formData.get('prompt_id') || 0) || null,
        quality_score: Number(formData.get('quality_score') || 0) || 0,
      }),
    });
  }

  async function updatePostFromForm(form) {
    const formData = new FormData(form);
    const id = Number(formData.get('id') || 0) || 0;
    await api(`/api/messaging/posts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        topic: cleanText(formData.get('topic')),
        post: cleanText(formData.get('post')),
        url: cleanText(formData.get('url')),
        hashtags: cleanText(formData.get('hashtags')),
        feedback: cleanText(formData.get('feedback')),
        image_asset_id: Number(formData.get('image_asset_id') || 0) || null,
        tagged_contact_id: cleanText(formData.get('tagged_contact_id')),
        prompt_id: Number(formData.get('prompt_id') || 0) || null,
        quality_score: Number(formData.get('quality_score') || 0) || 0,
      }),
    });
  }

  function getMessagingPrompts() {
    return App.messaging?.getMessagingPrompts?.() || [];
  }

  function renderPostSavedPromptOptions(selectedId = null) {
    const select = document.getElementById('messagingPostSavedPrompt');
    if (!select) return;
    const topic = cleanText(document.getElementById('messagingPostTopic')?.value);
    const currentValue = cleanText(selectedId || select.value);
    const prompts = getMessagingPrompts().filter((item) => {
      if (cleanText(item?.format) !== 'Posts') return false;
      const itemTopic = cleanText(item?.topic);
      if (topic && itemTopic && itemTopic !== topic) return false;
      return true;
    });
    select.innerHTML = '<option value="">Select Saved Prompt (optional)</option>';
    prompts.forEach((prompt) => {
      const option = document.createElement('option');
      option.value = String(prompt.id || '');
      const topicLabel = cleanText(prompt.topic);
      const preview = cleanText(prompt.prompt_text).replace(/\s+/g, ' ').slice(0, 90);
      option.textContent = `${topicLabel ? `${topicLabel}: ` : ''}${preview}${preview.length >= 90 ? '...' : ''}`;
      select.appendChild(option);
    });
    select.value = currentValue && Array.from(select.options).some((option) => option.value === currentValue) ? currentValue : '';
  }

  function clearPostSuggestions() {
    currentPostSuggestions = [];
    const empty = document.getElementById('messagingPostsSuggestionsEmpty');
    const shortWrap = document.getElementById('messagingPostsShortSuggestions');
    const tbody = document.getElementById('messagingPostsSuggestionsTable');
    const checkAll = document.getElementById('messagingPostsSelectAllSuggestions');
    if (empty) empty.classList.remove('hidden');
    if (shortWrap) shortWrap.classList.add('hidden');
    if (tbody) tbody.innerHTML = '';
    if (checkAll) checkAll.checked = false;
    const bulkQuality = document.getElementById('messagingPostsBulkQuality');
    if (bulkQuality) bulkQuality.value = '';
  }

  function renderPostSuggestions(options) {
    const empty = document.getElementById('messagingPostsSuggestionsEmpty');
    const shortWrap = document.getElementById('messagingPostsShortSuggestions');
    const tbody = document.getElementById('messagingPostsSuggestionsTable');
    const checkAll = document.getElementById('messagingPostsSelectAllSuggestions');
    if (!tbody) return;
    currentPostSuggestions = Array.isArray(options) ? options.slice() : [];
    tbody.innerHTML = '';
    if (!currentPostSuggestions.length) {
      clearPostSuggestions();
      return;
    }
    if (checkAll) checkAll.checked = true;
    currentPostSuggestions.forEach((option, index) => {
      const tr = document.createElement('tr');
      const checkTd = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.dataset.index = String(index);
      checkTd.appendChild(checkbox);
      tr.appendChild(checkTd);
      const textTd = document.createElement('td');
      textTd.textContent = typeof option === 'object' && option ? cleanText(option.content || option.text || option.post) : cleanText(option);
      tr.appendChild(textTd);
      const qualityTd = document.createElement('td');
      const select = document.createElement('select');
      select.dataset.postQualityIndex = String(index);
      ['', '1', '2', '3', '4', '5'].forEach((val) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = val || 'Score';
        select.appendChild(opt);
      });
      qualityTd.appendChild(select);
      tr.appendChild(qualityTd);
      tbody.appendChild(tr);
    });
    if (empty) empty.classList.add('hidden');
    if (shortWrap) shortWrap.classList.remove('hidden');
  }

  async function generatePostSuggestions() {
    const form = document.getElementById('messagingPostsForm');
    const button = document.getElementById('messagingPostsGenerateBtn');
    if (!form || !button) return;
    const formData = new FormData(form);
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Generating...';
    try {
      const imageLabel = App.messaging?.imageAssetLabel?.(formData.get('image_asset_id')) || '';
      const result = await api('/api/messaging/content-suggestions', {
        method: 'POST',
        body: JSON.stringify({
          format: 'Posts',
          topic: cleanText(formData.get('topic')),
          primary: cleanText(formData.get('post')),
          url: cleanText(formData.get('url')),
          hashtags: cleanText(formData.get('hashtags')),
          image_label: imageLabel,
        }),
      });
      const options = Array.isArray(result?.options) ? result.options : (Array.isArray(result?.data?.options) ? result.data.options : []);
      renderPostSuggestions(options);
      notify(options.length ? 'Post options generated' : 'No post options returned', !options.length);
    } catch (err) {
      notify(err.message, true);
    } finally {
      button.disabled = false;
      button.textContent = originalText || 'Generate with AI';
    }
  }

  async function saveSelectedPostSuggestions() {
    const form = document.getElementById('messagingPostsForm');
    const tbody = document.getElementById('messagingPostsSuggestionsTable');
    if (!form || !tbody) return;
    const formData = new FormData(form);
    const selectedIndexes = Array.from(tbody.querySelectorAll('input[type="checkbox"][data-index]:checked'))
      .map((checkbox) => Number(checkbox.dataset.index || '-1'))
      .filter((index) => index >= 0 && index < currentPostSuggestions.length);
    if (!selectedIndexes.length) {
      notify('Select at least one post option', true);
      return;
    }
    const basePayload = {
      topic: cleanText(formData.get('topic')),
      url: cleanText(formData.get('url')),
      hashtags: cleanText(formData.get('hashtags')),
      image_asset_id: Number(formData.get('image_asset_id') || 0) || null,
      prompt_id: Number(formData.get('prompt_id') || 0) || null,
    };
    for (const index of selectedIndexes) {
      const option = currentPostSuggestions[index];
      await api('/api/messaging/posts', {
        method: 'POST',
        body: JSON.stringify({
          ...basePayload,
          post: typeof option === 'object' && option ? cleanText(option.content || option.text || option.post) : cleanText(option),
          quality_score: Math.max(0, Math.min(Number(document.querySelector(`[data-post-quality-index="${index}"]`)?.value || 0) || 0, 5)),
        }),
      });
    }
    notify(selectedIndexes.length === 1 ? 'Post saved' : `${selectedIndexes.length} posts saved`);
    form.reset();
    clearPostSuggestions();
    App.messaging?.syncTopicSelects?.();
    App.messaging?.renderImageAssetPickerDisplay?.('messagingPostImageSelect');
    const workspace = document.getElementById('messagingPostsWorkspace');
    const toggleBtn = document.getElementById('messagingPostsToggleFormBtn');
    if (workspace) workspace.classList.add('hidden');
    if (toggleBtn) toggleBtn.textContent = 'Add Post';
    await refreshPosts();
  }

  function bindPostsEditor() {
    bindSortableTableButtons([
      { id: 'messagingPostsSortCreatedBtn', key: 'created_at', defaultDir: 'desc' },
      { id: 'messagingPostsSortContentBtn', key: 'post', defaultDir: 'asc' },
      { id: 'messagingPostsSortUrlBtn', key: 'url', defaultDir: 'asc' },
      { id: 'messagingPostsSortHashtagsBtn', key: 'hashtags', defaultDir: 'asc' },
      { id: 'messagingPostsSortImageBtn', key: 'image_asset_id', defaultDir: 'desc' },
      { id: 'messagingPostsSortTaggedBtn', key: 'tagged_contact_id', defaultDir: 'asc' },
    ], postTableState, function () {
      renderPostsTable(currentPosts);
    });

    const workspace = document.getElementById('messagingPostsWorkspace');
    const toggleBtn = document.getElementById('messagingPostsToggleFormBtn');
    const form = document.getElementById('messagingPostsForm');
    const editForm = document.getElementById('messagingPostsEditForm');
    const cancelEditBtn = document.getElementById('messagingPostsCancelEditBtn');
    const topic = document.getElementById('messagingPostTopic');
    const savedPrompt = document.getElementById('messagingPostSavedPrompt');
    const imagePickerBtn = document.getElementById('messagingPostImagePickerBtn');
    const editImagePickerBtn = document.getElementById('messagingPostEditImagePickerBtn');

    if (toggleBtn && workspace) {
      toggleBtn.addEventListener('click', function () {
        const isHidden = workspace.classList.contains('hidden');
        closePostEditForm();
        workspace.classList.toggle('hidden', !isHidden);
        if (isHidden) {
          ensureTaggingContactsLoaded();
          App.messaging?.refreshMessagingPrompts?.().catch(function () { }).finally(renderPostSavedPromptOptions);
          clearPostSuggestions();
        }
        toggleBtn.textContent = isHidden ? 'Hide Form' : 'Add Post';
      });
    }

    if (topic) topic.addEventListener('change', renderPostSavedPromptOptions);

    if (savedPrompt) {
      savedPrompt.addEventListener('change', function () {
        const selectedId = cleanText(savedPrompt.value);
        const promptIdInput = document.getElementById('messagingPostPromptId');
        const primaryInput = document.getElementById('messagingPostContent');
        const selected = getMessagingPrompts().find((item) => String(item?.id || '') === selectedId);
        if (promptIdInput) promptIdInput.value = selected ? selectedId : '';
        if (primaryInput && selected) primaryInput.value = cleanText(selected.prompt_text);
      });
    }

    if (imagePickerBtn && imagePickerBtn.dataset.assetPickerBound !== 'true') {
      imagePickerBtn.dataset.assetPickerBound = 'true';
      imagePickerBtn.addEventListener('click', function () {
        App.messaging?.openImageAssetPicker?.('messagingPostImageSelect');
      });
    }

    if (editImagePickerBtn && editImagePickerBtn.dataset.assetPickerBound !== 'true') {
      editImagePickerBtn.dataset.assetPickerBound = 'true';
      editImagePickerBtn.addEventListener('click', function () {
        App.messaging?.openImageAssetPicker?.('messagingPostEditImageSelect');
      });
    }

    bindPostEditAssociations();

    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        try {
          await savePostFromForm(form);
          notify('Post saved');
          form.reset();
          const promptIdInput = document.getElementById('messagingPostPromptId');
          if (promptIdInput) promptIdInput.value = '';
          App.messaging?.renderImageAssetPickerDisplay?.('messagingPostImageSelect');
          clearPostSuggestions();
          App.messaging?.syncTopicSelects?.();
          renderPostSavedPromptOptions();
          if (toggleBtn) toggleBtn.textContent = 'Add Post';
          if (workspace) workspace.classList.add('hidden');
          await refreshPosts();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (editForm) {
      editForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        try {
          await updatePostFromForm(editForm);
          notify('Post updated');
          closePostEditForm();
          await refreshPosts();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (cancelEditBtn) cancelEditBtn.addEventListener('click', closePostEditForm);

    const generateBtn = document.getElementById('messagingPostsGenerateBtn');
    if (generateBtn) generateBtn.addEventListener('click', generatePostSuggestions);

    const savePromptBtn = document.getElementById('messagingPostsSavePromptBtn');
    if (savePromptBtn) {
      savePromptBtn.addEventListener('click', function () {
        notify('Save Prompt for Posts uses the same flow as Create Content prompts.', false);
      });
    }

    const clearBtn = document.getElementById('messagingPostsClearSuggestionsBtn');
    if (clearBtn) clearBtn.addEventListener('click', clearPostSuggestions);

    const saveSelectedBtn = document.getElementById('messagingPostsSaveSelectedBtn');
    if (saveSelectedBtn) saveSelectedBtn.addEventListener('click', saveSelectedPostSuggestions);

    const selectAll = document.getElementById('messagingPostsSelectAllSuggestions');
    if (selectAll) {
      selectAll.addEventListener('change', function () {
        document.querySelectorAll('#messagingPostsSuggestionsTable input[type="checkbox"][data-index]').forEach((checkbox) => {
          checkbox.checked = selectAll.checked;
        });
      });
    }

    const bulkQuality = document.getElementById('messagingPostsBulkQuality');
    if (bulkQuality) {
      bulkQuality.addEventListener('change', function () {
        const value = cleanText(bulkQuality.value);
        if (!value) return;
        document.querySelectorAll('#messagingPostsSuggestionsTable input[type="checkbox"][data-index]:checked').forEach((checkbox) => {
          const index = cleanText(checkbox.dataset.index);
          const select = document.querySelector(`[data-post-quality-index="${index}"]`);
          if (select) select.value = value;
        });
      });
    }
  }

  App.messagingPostsEditor = {
    init: function () {
      bindPostsEditor();
      return refreshPosts();
    },
    refreshPosts,
    openPostEditForm,
    closePostEditForm,
    getPosts: function () { return currentPosts.slice(); },
    POST_CHARACTER_LIMIT,
  };
})();
