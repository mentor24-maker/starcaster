module.exports = {
  manifest: { id: 'ping', label: 'Ping', prefixes: ['/api/ping'] },
  handle: async (req, res) => {
    res.statusCode = 200;
    res.end('PONG');
  }
};
