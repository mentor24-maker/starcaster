const { GoogleAuth } = require('google-auth-library');

/**
 * Initializes the Vertex AI environment securely via REST.
 * Note: Requires VERTEX_PROJECT_ID and VERTEX_LOCATION environment variables to function in production.
 */
async function getAuthToken() {
  const authOpts = {
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  };
  
  // If deployed dynamically on Vercel, intercept the raw JSON Service Account Key natively.
  if (process.env.GOOGLE_CREDENTIALS) {
    try {
      authOpts.credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    } catch (err) {
       console.error("Failed to parse GOOGLE_CREDENTIALS JSON. Check Vercel key formatting.", err);
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
 * @returns {object} API Response mapping the job queue tracker
 */
async function generateVideo(promptText, referenceAssets = []) {
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

    const body = {
      instances: [
        { prompt: contextString }
      ],
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
 * Pings Google Cloud via GET request to physically map the LRO Completion State.
 */
async function getLROStatus(operationName) {
  if (!operationName) throw new Error("Missing physical operationName router!");
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const token = await getAuthToken();
  const url = `https://${location}-aiplatform.googleapis.com/v1/${operationName}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const data = await response.json();
  if (!response.ok) throw new Error(`Google API GET LRO Error: ${JSON.stringify(data)}`);
  
  return data;
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
