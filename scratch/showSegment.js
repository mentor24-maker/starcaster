  async function showSegmentContacts(segmentId) {
    const segment = (Array.isArray(state.segments) ? state.segments : []).find((item) => String(item.id) === String(segmentId));
    if (!segment || !els.segmentsTableBody) return;

    activeViewedSegmentId = String(segment.id);
    if (els.returnToSegmentsBtn) els.returnToSegmentsBtn.classList.remove('hidden');
    if (els.activeSegmentName) {
      els.activeSegmentName.textContent = segment.name || '';
      els.activeSegmentName.classList.toggle('hidden', !segment.name);
    }
    
    // Switch to loading state
    els.segmentsTableBody.innerHTML = '<tr><td colspan="100%">Loading audience...</td></tr>';
    
    try {
      const res = await api(`/api/segments/${encodeURIComponent(segment.id)}/audience`);
      const rows = Array.isArray(res.audience) ? res.audience : [];
      els.segmentsTableBody.innerHTML = '';
      
      const isYoutube = segment.segment_type === 'youtube_comments';
      
      // Temporary Header creation
      if (!els.segmentsPageTableHead) return;
      if (isYoutube) {
        els.segmentsPageTableHead.innerHTML = `<tr>
          <th>Author</th>
          <th>Comment Text</th>
          <th>Topic</th>
          <th>Origin Campaign</th>
          <th>Score</th>
        </tr>`;
      } else {
        renderSegmentHeader(segment); // standard CRM header
      }

      const cols = segmentContactColumns(segment);

      if (!rows.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = isYoutube ? 5 : (cols.length || 1);
        td.textContent = 'No audience members match this segment.';
        tr.appendChild(td);
        els.segmentsTableBody.appendChild(tr);
        return;
      }

      rows.forEach((row) => {
        const tr = document.createElement('tr');
        if (isYoutube) {
          const makeTd = (text) => {
            const td = document.createElement('td');
            td.textContent = text;
            return td;
          }
          tr.appendChild(makeTd(row.author_name || '-'));
          
          const textTd = document.createElement('td');
          textTd.textContent = String(row.text || '').substring(0, 80) + (row.text && row.text.length > 80 ? '...' : '');
          tr.appendChild(textTd);
          
          tr.appendChild(makeTd(row.topic || '-'));
          tr.appendChild(makeTd(row.campaign_id || '-'));
          tr.appendChild(makeTd(row.score || 0));
        } else {
          cols.forEach((field) => {
            const td = document.createElement('td');
            if (typeof App.contacts?.appendContactCell === 'function') {
              App.contacts.appendContactCell(td, field, App.contacts.contactValue(row, field));
            } else {
              td.textContent = App.contacts?.contactValue?.(row, field) || '-';
            }
            tr.appendChild(td);
          });
        }
        els.segmentsTableBody.appendChild(tr);
      });
      
    } catch (e) {
      els.segmentsTableBody.innerHTML = `<tr><td colspan="100%">Failed to load audience: ${e.message}</td></tr>`;
    }
  }
