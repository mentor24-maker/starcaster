// agBridgeClient.js - Client-Side SDK for the AG App Local API Bridge

// --- CONFIGURATION ---
const API_KEY = 'your-secret-api-key-here'; // Match this with your server.js key
const API_BASE_URL = 'http://localhost:31337';

// --- HELPER FUNCTIONS ---

function encodeBase64(textString) {
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    // Browser environment
    return window.btoa(textString);
  } else if (typeof Buffer !== 'undefined') {
    // Node.js environment
    return Buffer.from(textString, 'utf-8').toString('base64');
  } else {
    throw new Error('Unable to encode to base64: No supported environment found.');
  }
}

function decodeBase64(base64String) {
  if (typeof window !== 'undefined' && typeof window.atob === 'function') {
    return window.atob(base64String);
  } else if (typeof Buffer !== 'undefined') {
    return Buffer.from(base64String, 'base64').toString('utf-8');
  } else {
    throw new Error('Unable to decode base64 string: No supported environment found.');
  }
}

// --- API FUNCTIONS ---

async function readFile(filePath) {
  const url = new URL(`${API_BASE_URL}/files`);
  url.searchParams.append('path', filePath);
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'X-API-Key': API_KEY },
    });
    const responseData = await response.json();
    if (!response.ok) throw new Error(`API Error: ${response.status} - ${responseData.message}`);
    return decodeBase64(responseData.content);
  } catch (error) {
    console.error('Failed to read file via AG Bridge:', error);
    throw error;
  }
}

async function listDirectory(dirPath) {
  const url = new URL(`${API_BASE_URL}/directory`);
  url.searchParams.append('path', dirPath);
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'X-API-Key': API_KEY },
    });
    const responseData = await response.json();
    if (!response.ok) throw new Error(`API Error: ${response.status} - ${responseData.message}`);
    return responseData;
  } catch (error) {
    console.error('Failed to list directory via AG Bridge:', error);
    throw error;
  }
}



// --- EXPORTS ---
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { readFile, listDirectory };
}
