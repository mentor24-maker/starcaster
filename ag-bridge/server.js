// server.js - Local API Bridge for AG App

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 31337;

// --- CONFIGURATION ---
const API_KEY = 'your-secret-api-key-here'; // Match this with your client's key

// --- MIDDLEWARE ---

const apiKeyAuth = (req, res, next) => {
  const providedApiKey = req.get('X-API-Key');
  if (!providedApiKey || providedApiKey !== API_KEY) {
    return res.status(401).json({ message: 'Unauthorized: Missing or invalid API key.' });
  }
  next();
};

// Add middleware to parse JSON request bodies for POST/PATCH requests
app.use(express.json());
app.use(apiKeyAuth);

// --- ROUTES ---

// [GET] Reads the content of a specified file.
app.get('/files', (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !path.isAbsolute(filePath)) {
    return res.status(400).json({ message: 'Bad Request: An absolute file path is required.' });
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ message: `File not found at path ${filePath}` });
      if (err.code === 'EACCES') return res.status(500).json({ message: `Permission denied for file at path ${filePath}` });
      console.error('Error reading file:', err);
      return res.status(500).json({ message: 'An unexpected server error occurred.' });
    }
    res.status(200).json({ path: filePath, content: data.toString('base64') });
  });
});

// [GET] Reads the contents of a specified directory.
app.get('/directory', (req, res) => {
  const dirPath = req.query.path;
  if (!dirPath || !path.isAbsolute(dirPath)) {
    return res.status(400).json({ message: 'Bad Request: An absolute directory path is required.' });
  }

  fs.readdir(dirPath, { withFileTypes: true }, (err, dirents) => {
    if (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ message: `Directory not found at path ${dirPath}` });
      if (err.code === 'ENOTDIR') return res.status(400).json({ message: `Path is not a directory: ${dirPath}` });
      console.error('Error reading directory:', err);
      return res.status(500).json({ message: 'An unexpected server error occurred.' });
    }

    const files = dirents.filter(d => !d.isDirectory()).map(d => d.name);
    const directories = dirents.filter(d => d.isDirectory()).map(d => d.name);

    res.status(200).json({ path: dirPath, files, directories });
  });
});



// --- SERVER INITIALIZATION ---

app.listen(PORT, 'localhost', () => {
  console.log(`AG App Local API Bridge is running on http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  GET /files?path=<absolute_file_path>');
  console.log('  GET /directory?path=<absolute_directory_path>');
  console.log('Awaiting requests with a valid X-API-Key header...');
});
