// pages/api/agent/report.js

export default function handler(req, res) {
  // Reject non-POST requests
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { filePath, content } = req.body;

    // Reject malformed payloads
    if (!filePath || !content) {
      return res.status(400).json({ error: 'Missing required payload parameters: filePath or content' });
    }

    // Verify connectivity by logging structural ingress to Node console
    console.log(`[Next.js API] Received IPC structural report for: ${filePath}`);
    // Note: Logging 'content' length here can be helpful for debugging later
    console.log(`[Next.js API] Payload size: ${content.length} characters`);

    // Acknowledge receipt natively
    return res.status(200).json({ status: 'Report received successfully.' });

  } catch (error) {
    console.error(`[Next.js API] Internal server error handling IPC report:`, error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
