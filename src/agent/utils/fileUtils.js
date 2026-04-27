const fs = require('fs').promises; // Use promise-based fs
const path = require('path');

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// A utility function to read a file, which was previously causing blocking issues.
async function readFileContent(filePath) { 
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_FILE_SIZE_BYTES) {
      console.warn(`[fileUtils] Skipping large file: ${filePath}`);
      return null; // Skip files that are too large
    }

    const content = await fs.readFile(filePath, 'utf-8');
    return content;
  } catch (error) {
    console.error(`[fileUtils] Error reading file ${filePath}:`, error);
    // In case of error (e.g., binary file), return null to prevent crash
    return null; 
  }
}
