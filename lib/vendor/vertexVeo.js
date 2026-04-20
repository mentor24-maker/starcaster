const { GoogleAuth } = require('google-auth-library');

/**
 * Initializes the Vertex AI environment securely via REST.
 * Note: Requires VERTEX_PROJECT_ID and VERTEX_LOCATION environment variables to function in production.
 */
async function getAuthToken() {
  const authOpts = {
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  };
  
  // Intercept the raw JSON Service Account Key natively.
  // Explicitly handle unescaped newlines which dotenv inherently exposes.
  if (process.env.GOOGLE_CREDENTIALS) {
    try {
      let rawCreds = process.env.GOOGLE_CREDENTIALS;
      const keyMatch = rawCreds.match(/"private_key"\s*:\s*"([^"]+)"/s);
      if (keyMatch) {
         let keyStr = keyMatch[1].replace(/\r?\n/g, '\\n');
         rawCreds = rawCreds.replace(keyMatch[0], `"private_key": "${keyStr}"`);
      }
      rawCreds = rawCreds.replace(/\r?\n/g, '');
      authOpts.credentials = JSON.parse(rawCreds);
    } catch (err) {
       console.error("Failed to safely parse GOOGLE_CREDENTIALS JSON. Check Vercel key formatting.", err);
    }
  }

  const auth = new GoogleAuth(authOpts);
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  return accessToken.token;
}

/**
 * Fires a Generative Video request against Veo.
 * @param {string} promptText - The raw instruction from the Creation Studio
 * @param {Array} referenceAssets - Context objects loaded with instructions
 * @param {object} primaryImage - Physical Base64 stream { bytesBase64Encoded, mimeType }
 * @returns {object} API Response mapping the job queue tracker
 */
async function generateVideo(promptText, referenceAssets = [], primaryImage = null) {
  const project = process.env.VERTEX_PROJECT_ID;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  if (!project) throw new Error('VERTEX_PROJECT_ID securely required to authenticate Google Vertex environment.');

  let contextString = promptText;
  if (referenceAssets.length > 0) {
    contextString += '\n\n--- Contextual Assets Constraints ---\n';
    referenceAssets.forEach((ref, idx) => {
      contextString += `\nAsset [${idx + 1}] (${ref.assetType}): ${ref.assetName}\n`;
      contextString += `Instruction Logic: ${ref.instructions || 'Apply generally'}\n`;
    });
  }

  try {
    const token = await getAuthToken();
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/veo-3.1-generate-001:predictLongRunning`;

    const instancesBlock = { prompt: contextString };
    if (primaryImage && primaryImage.bytesBase64Encoded) {
       instancesBlock.image = {
          bytesBase64Encoded: primaryImage.bytesBase64Encoded,
          mimeType: primaryImage.mimeType || 'image/jpeg'
       };
    }

    const body = {
      instances: [ instancesBlock ],
      parameters: {
        aspectRatio: "16:9",
        sampleCount: 1,
        durationSeconds: 4 
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (!response.ok) {
       throw new Error(`Veo physical POST crashed: ${JSON.stringify(data)}`);
    }

    // Google physically returns { name: 'projects/.../operations/...', metadata: {...} }
    return {
      status: 'queued',
      jobId: data.name, 
      rawResponse: data 
    };
    
  } catch (error) {
    console.error('Google Vertex Veo API Error:', error);
    throw error;
  }
}

/**
 * Pings Google Cloud via POST request to physically map the LRO Completion State using fetchPredictOperation.
 */
async function getLROStatus(operationName) {
  if (!operationName) throw new Error("Missing physical operationName router!");
  const project = process.env.VERTEX_PROJECT_ID;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  if (!project) throw new Error('VERTEX_PROJECT_ID required for LRO tracker');
  
  const token = await getAuthToken();
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/veo-3.1-generate-001:fetchPredictOperation`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ operationName })
  });
  
  const data = await response.text();
  let json = {};
  try { json = JSON.parse(data); } catch (e) {}

  if (!response.ok) {
     throw new Error(`Google API fetchPredictOperation Error [${response.status}]: ${data}`);
  }
  
  return json;
}

/**
 * Fires a termination request against Google Server infrastructure to cancel physical quotas natively.
 */
async function cancelLRO(operationName) {
  if (!operationName) throw new Error("Missing physical operationName router!");
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const token = await getAuthToken();
  const url = `https://${location}-aiplatform.googleapis.com/v1/${operationName}:cancel`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  return await response.json();
}

module.exports = {
  generateVideo,
  getLROStatus,
  cancelLRO
};
