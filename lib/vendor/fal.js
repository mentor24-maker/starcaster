require('dotenv').config();

const FAL_BASE = 'https://queue.fal.run/fal-ai/kling-video/v1.6/pro';

async function generateVideo(promptText, referenceAssets = [], primaryMedia = null, durationSeconds = 5) {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error('FAL_KEY securely required to authenticate Fal environment.');

  let contextString = promptText;
  if (referenceAssets.length > 0) {
    contextString += '\n\n--- Contextual Assets Constraints ---\n';
    referenceAssets.forEach((ref, idx) => {
      contextString += `\nAsset [${idx + 1}] (${ref.assetType}): ${ref.assetName}\n`;
      contextString += `Instruction Logic: ${ref.instructions || 'Apply generally'}\n`;
    });
  }

  // Kling uses "5" or "10" for duration in v1 standard.
  const duration = durationSeconds > 5 ? "10" : "5";
  
  let endpoint = `${FAL_BASE}/text-to-video`;
  const body = {
    prompt: contextString,
    duration: duration,
    aspect_ratio: "16:9"
  };

  if (primaryMedia && primaryMedia.bytesBase64Encoded) {
    const mime = primaryMedia.mimeType || 'image/jpeg';
    if (!mime.startsWith('video/')) {
       endpoint = `${FAL_BASE}/image-to-video`;
       body.image_url = `data:${mime};base64,${primaryMedia.bytesBase64Encoded}`;
    } else {
       // If it's a video-to-video extension request (from our looping logic), use the Kling O1 v2v endpoint
       endpoint = 'https://queue.fal.run/fal-ai/kling-video/o1/video-to-video/edit';
       body.video_url = `data:${mime};base64,${primaryMedia.bytesBase64Encoded}`;
    }
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const textRes = await response.text();
    let data;
    try {
      data = JSON.parse(textRes);
    } catch (e) {
      throw new Error(`Fal API returned non-JSON (${response.status}): ${textRes}`);
    }

    if (!response.ok) {
       throw new Error(`Fal POST crashed: ${JSON.stringify(data)}`);
    }

    // Embed the native fal polling URLs so we don't have to guess the status endpoint
    return {
      status: 'queued',
      jobId: JSON.stringify({
        request_id: data.request_id,
        status_url: data.status_url,
        response_url: data.response_url
      }), 
      rawResponse: data 
    };
    
  } catch (error) {
    console.error('Fal API Error:', error);
    throw error;
  }
}

async function getLROStatus(compositeJobId) {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error('FAL_KEY securely required to authenticate Fal environment.');

  let statusUrl = '';
  let responseUrl = '';

  try {
    const parsed = JSON.parse(compositeJobId);
    statusUrl = parsed.status_url;
    responseUrl = parsed.response_url;
  } catch (e) {
    const [endpoint, requestId] = compositeJobId.split('|');
    if (!requestId) throw new Error('Invalid Fal composite Job ID.');
    statusUrl = `https://queue.fal.run/fal-ai/kling-video/requests/${requestId}/status`;
    responseUrl = `https://queue.fal.run/fal-ai/kling-video/requests/${requestId}`;
  }

  try {
    const response = await fetch(statusUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Key ${apiKey}`
      }
    });

    const textRes = await response.text();
    let data;
    try {
      data = JSON.parse(textRes);
    } catch (e) {
      throw new Error(`Fal API returned non-JSON (${response.status}): ${textRes}`);
    }

    if (!response.ok) {
       throw new Error(`Fal GET crashed: ${JSON.stringify(data)}`);
    }

    if (data.status === 'IN_QUEUE' || data.status === 'IN_PROGRESS') {
       return { done: false, error: null };
    } else if (data.status === 'COMPLETED') {
       
       // Pull final video payload from response_url
       const rRes = await fetch(responseUrl, {
           method: 'GET',
           headers: { 'Authorization': `Key ${apiKey}` }
       });
       const rData = await rRes.json();
       
       let base64Video = null;
       const videoUrl = rData.video?.url || data.video?.url;
       
       if (videoUrl) {
           try {
               const vidRes = await fetch(videoUrl);
               const arr = await vidRes.arrayBuffer();
               base64Video = Buffer.from(arr).toString('base64');
           } catch (e) {
               console.error("Failed to buffer Fal video URL to base64:", e);
           }
       }

       return {
           done: true,
           response: {
               videos: base64Video ? [{ bytesBase64Encoded: base64Video }] : []
           },
           error: null
       };
    } else {
       return { done: true, error: data.error || 'Unknown failure in Fal queue' };
    }
  } catch (error) {
    console.error('Fal LRO Status Error:', error);
    throw error;
  }
}

module.exports = {
  generateVideo,
  getLROStatus
};
