fetch('http://localhost:3000/api/develop/devAgent/worker', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'INSERT', record: { id: 999, status: 'processing' } })
}).then(r => r.text()).then(t => {
  console.log('Fetch response:', t);
}).catch(err => {
  console.error('Fetch error:', err.message);
});
