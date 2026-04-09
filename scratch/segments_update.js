  // newly added code for segments:
  async function loadSegmentTypes() {
    try {
      const res = await api('/api/settings/contacts/segment_types?active=true');
      const select = document.getElementById('segmentEditorType');
      if (!select) return;
      select.innerHTML = '<option value="">-- Choose Type --</option>';
      (res.options || []).forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.key;
        option.textContent = opt.label;
        select.appendChild(option);
      });
    } catch (e) {
      console.error('Failed to load segment types');
    }
  }

  function handleSegmentTypeChange() {
    const type = els.segmentEditorType?.value;
    els.segmentBuilder_email_list?.classList.toggle('hidden', type !== 'email_list');
    els.segmentBuilder_youtube_comments?.classList.toggle('hidden', type !== 'youtube_comments');
    
    // Move the Explore filters into place if email_list
    if (type === 'email_list' && els.exploreContactsFilters) {
      document.getElementById('segmentEditorContactRulesContainer')?.appendChild(els.exploreContactsFilters);
    }
  }

  function openSegmentEditor() {
    App.setActivePage('segmentEditorPage');
    if (els.segmentEditorForm) els.segmentEditorForm.reset();
    if (els.segmentEditorYoutubeRulesForm) els.segmentEditorYoutubeRulesForm.reset();
    handleSegmentTypeChange();
    if (typeof App.contacts?.applyExploreFilters === 'function') {
      // maybe reset filters?
    }
  }

  async function saveSegment() {
    const name = String(els.segmentEditorName?.value || '').trim();
    const type = els.segmentEditorType?.value;
    if (!name || !type) {
      return notify('Name and Segment Type are required.', true);
    }

    let rules = [];
    let definition = null;

    if (type === 'email_list') {
      if (typeof App.contacts?.activeExploreFilterRules !== 'function') {
        return notify('Failed to read contact explore rules', true);
      }
      rules = App.contacts.activeExploreFilterRules();
      definition = App.contacts.exploreFilterDefinition();
      if (!rules.length) {
        return notify('Define at least one rule for the email list segment', true);
      }
    } else if (type === 'youtube_comments') {
      const campaign = String(els.segmentEditorYtCampaign?.value || '').trim();
      const topic = String(els.segmentEditorYtTopic?.value || '').trim();
      const score = String(els.segmentEditorYtScore?.value || '').trim();
      const keyword = String(els.segmentEditorYtKeyword?.value || '').trim();
      
      if (campaign) rules.push({ field: 'comments_campaign', operator: 'equals', value: campaign });
      if (topic) rules.push({ field: 'comments_topic', operator: 'equals', value: topic });
      if (score) rules.push({ field: 'comments_score', operator: 'greater_than_or_equal', value: score });
      if (keyword) rules.push({ field: 'comments_text', operator: 'contains', value: keyword });
      
      if (!rules.length) {
        return notify('Define at least one parameter for the YouTube subset segment', true);
      }
    }

    try {
      const rawRes = await api('/api/segments', {
        method: 'POST',
        body: JSON.stringify({ name, rules, definition, segment_type: type })
      });
      notify(`Segment created: ${name}`);
      await App.refresh();
      App.setActivePage('segmentsPage');
    } catch (e) {
      notify(e.message, true);
    }
  }
