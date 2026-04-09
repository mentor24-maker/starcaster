  const audienceMatch = pathname.match(/^\/api\/segments\/([^/]+)\/audience$/);
  if (audienceMatch && method === 'GET') {
    const segmentId = audienceMatch[1];
    const segRes = await listSegments(requestScope(req));
    if (!segRes.ok) return sendErr(res, segRes.status || 500, segRes.error), true;
    const segment = (Array.isArray(segRes.data) ? segRes.data : []).find(s => s.id === segmentId);
    if (!segment) return sendErr(res, 404, 'Segment not found', { code: 'NOT_FOUND' }), true;

    if (segment.segment_type === 'youtube_comments') {
      let queryStr = '';
      if (Array.isArray(segment.rules)) {
        const parts = [];
        for (const rule of segment.rules) {
          if (rule.field === 'comments_campaign' && rule.value) parts.push(`campaign_id=eq.${encodeURIComponent(rule.value)}`);
          if (rule.field === 'comments_topic' && rule.value) parts.push(`topic=eq.${encodeURIComponent(rule.value)}`);
          if (rule.field === 'comments_score' && rule.value) parts.push(`score=gte.${encodeURIComponent(rule.value)}`);
          if (rule.field === 'comments_text' && rule.value) parts.push(`text=ilike.*${encodeURIComponent(rule.value)}*`);
        }
        queryStr = parts.join('&');
      }
      
      const commentsStore = require('../lib/acquire/YoutubeCommentsStore');
      const audienceRes = await commentsStore.listContactableComments(queryStr);
      if (!audienceRes.ok) return sendErr(res, audienceRes.status || 500, audienceRes.error), true;
      const audience = Array.isArray(audienceRes.data) ? audienceRes.data : [];
      return sendOk(res, 200, audience, { audience }, { total: audience.length }), true;
    } else {
      // standard email list contacts
      const scope = requestScope(req);
      const conRes = await listContacts({ scope });
      if (!conRes.ok) return sendErr(res, conRes.status || 500, conRes.error), true;
      const contacts = conRes.ok && Array.isArray(conRes.data) ? conRes.data.map(rowToContact) : [];
      const audience = contacts.filter(c => contactMatchesSegment(c, segment));
      return sendOk(res, 200, audience, { audience }, { total: audience.length }), true;
    }
  }
