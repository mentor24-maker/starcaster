'use strict';

window.App = window.App || {};

App.messagingFormatImport = (function () {
  const { api, notify, parseCsv, byId } = App;

  let activeSlug = '';
  let activeLabel = '';
  let parsedCsvData = null;
  let onImportedCallback = null;

  function csvMatrixToObjects(matrix) {
    if (!Array.isArray(matrix) || matrix.length < 2) return [];
    const headers = matrix[0].map((h) => String(h || '').trim());
    return matrix.slice(1).map((cells) => {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = cells[index] == null ? '' : String(cells[index]).trim();
      });
      return row;
    });
  }

  function normalizeHeader(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/-/g, '_');
  }

  function rowHasImportHeaders(slug, row) {
    const specs = {
      tweets: { primary: ['tweet', 'content', 'question', 'one_line_question'], topic: true },
      headlines: { primary: ['headline', 'headline_text', 'question', 'one_line_question'], topic: false },
      subheadings: { primary: ['subheading', 'sub_heading', 'question', 'one_line_question'], topic: false },
      taglines: { primary: ['tagline', 'tagline_text', 'question', 'one_line_question'], topic: false },
      pitches: { primary: ['pitch', 'pitch_text', 'question', 'one_line_question'], topic: false },
      emails: { primary: ['email', 'email_body', 'body', 'content', 'question'], topic: false },
      posts: { primary: ['post', 'post_text', 'content', 'question'], topic: false },
      descriptions: { primary: ['description', 'description_text', 'content', 'question'], topic: false },
      transcripts: { primary: ['transcript', 'transcript_text', 'content', 'question'], topic: false },
      comments: { primary: ['comment', 'comment_text', 'content', 'question'], topic: false },
      keywords: { primary: ['keyword', 'keywords', 'content', 'question'], topic: false },
      hashtags: { primary: ['hashtag', 'hashtags', 'tag', 'content', 'question'], topic: false },
      ctas: { primary: ['cta', 'call_to_action', 'content', 'question'], topic: false },
      articles: { primary: ['title', 'article_title', 'headline', 'question'], topic: false },
      reports: { primary: ['title', 'report_title', 'headline', 'question'], topic: false },
      'white-papers': { primary: ['title', 'white_paper_title', 'headline', 'question'], topic: false },
      ebooks: { primary: ['title', 'ebook_title', 'headline', 'question'], topic: false },
    };
    const spec = specs[String(slug || '').trim().toLowerCase()];
    if (!spec) return false;
    const keys = new Set(Object.keys(row || {}).map(normalizeHeader));
    const hasPrimary = spec.primary.some((key) => keys.has(key));
    if (!hasPrimary) return false;
    if (!spec.topic) return true;
    return keys.has('topic') || keys.has('category');
  }

  function setModalCopy() {
    const title = byId('messagingFormatImportTitle');
    const hint = byId('messagingFormatImportHint');
    if (title) title.textContent = `Import ${activeLabel}`;
    if (hint) {
      if (activeSlug === 'tweets') {
        hint.innerHTML = 'Upload a CSV with <strong>One-Line Question</strong> (or <strong>Tweet</strong> / <strong>Content</strong>) plus <strong>Category</strong> and/or <strong>Topic</strong>.';
      } else {
        hint.innerHTML = `Upload a CSV with a primary text column for <strong>${activeLabel}</strong>, plus optional <strong>Topic</strong> and <strong>Category</strong>.`;
      }
    }
  }

  function openModal(slug, label, onImported) {
    activeSlug = String(slug || '').trim().toLowerCase();
    activeLabel = String(label || slug || 'Content').trim();
    onImportedCallback = typeof onImported === 'function' ? onImported : null;
    parsedCsvData = null;
    setModalCopy();

    const modal = byId('messagingFormatImportModal');
    const form = byId('messagingFormatImportForm');
    const preview = byId('messagingFormatImportPreview');
    if (form) form.reset();
    if (preview) {
      preview.textContent = '';
      preview.classList.add('hidden');
    }
    if (modal && typeof modal.showModal === 'function') modal.showModal();
  }

  function closeModal() {
    const modal = byId('messagingFormatImportModal');
    if (modal && typeof modal.close === 'function') modal.close();
  }

  async function handleCsvSelect(e) {
    const file = e.target.files?.[0];
    const preview = byId('messagingFormatImportPreview');
    if (!file) {
      parsedCsvData = null;
      if (preview) preview.classList.add('hidden');
      return;
    }
    const text = await file.text();
    const parsed = csvMatrixToObjects(parseCsv(text));
    if (!parsed.length) {
      parsedCsvData = null;
      if (preview) {
        preview.textContent = 'No valid rows found in CSV.';
        preview.classList.remove('hidden');
      }
      return;
    }
    if (!rowHasImportHeaders(activeSlug, parsed[0])) {
      parsedCsvData = null;
      if (preview) {
        preview.textContent = activeSlug === 'tweets'
          ? 'CSV must include Tweet/Content/Question and Topic or Category columns.'
          : `CSV must include a ${activeLabel} text column (and Topic or Category when required).`;
        preview.classList.remove('hidden');
      }
      return;
    }
    parsedCsvData = parsed;
    const sample = Object.values(parsed[0]).find((value) => String(value || '').trim()) || '?';
    if (preview) {
      preview.textContent = `Found ${parsed.length} row${parsed.length === 1 ? '' : 's'} to import. First value: "${sample}"`;
      preview.classList.remove('hidden');
    }
  }

  async function handleImportSubmit(e) {
    e.preventDefault();
    if (!activeSlug) return;
    if (!parsedCsvData?.length) {
      notify('Select a valid CSV file first', true);
      return;
    }
    const btn = byId('messagingFormatImportSubmitBtn');
    const original = btn?.textContent || 'Import';
    if (btn) {
      btn.textContent = 'Importing...';
      btn.disabled = true;
    }
    try {
      const res = await api(`/api/messaging/${encodeURIComponent(activeSlug)}/import`, {
        method: 'POST',
        body: JSON.stringify({ rows: parsedCsvData }),
      });
      const count = Number(res.count ?? res.data?.imported ?? 0);
      const errorCount = Array.isArray(res.data?.errors) ? res.data.errors.length : 0;
      const label = activeLabel || 'row';
      notify(errorCount
        ? `Imported ${count} ${label}${count === 1 ? '' : 's'} (${errorCount} failed)`
        : `Imported ${count} ${label}${count === 1 ? '' : 's'}`);
      closeModal();
      document.dispatchEvent(new CustomEvent('messaging:formatImported', { detail: { slug: activeSlug } }));
      if (onImportedCallback) await onImportedCallback();
    } catch (err) {
      notify(err.message, true);
    } finally {
      if (btn) {
        btn.textContent = original;
        btn.disabled = false;
      }
    }
  }

  const wiredButtons = new WeakSet();

  function wireButton(button, slug, label, onImported) {
    if (!button || wiredButtons.has(button)) return;
    wiredButtons.add(button);
    button.addEventListener('click', () => openModal(slug, label, onImported));
  }

  function ensureImportButton(pageId, slug, label, onImported) {
    const page = document.getElementById(pageId);
    const actions = page?.querySelector('.page-heading-actions');
    if (!actions) return null;
    const existing = actions.querySelector(`[data-messaging-import-slug="${slug}"]`);
    if (existing) {
      wireButton(existing, slug, label, onImported);
      return existing;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = 'Import CSV';
    btn.dataset.messagingImportSlug = slug;
    actions.insertBefore(btn, actions.firstChild);
    wireButton(btn, slug, label, onImported);
    return btn;
  }

  function init() {
    const form = byId('messagingFormatImportForm');
    const closeBtn = byId('messagingFormatImportCloseBtn');
    const fileInput = byId('messagingFormatImportCsvFile');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (fileInput) fileInput.addEventListener('change', handleCsvSelect);
    if (form) form.addEventListener('submit', handleImportSubmit);
  }

  return {
    init,
    openModal,
    closeModal,
    ensureImportButton,
    wireButton,
  };
})();
