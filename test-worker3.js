fetch('http://127.0.0.1:3000/api/develop/devAgent/worker', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'INSERT',
    record: {
      id: 697,
      session_id: 17,
      role: 'roger',
      project_id: null,
      status: 'processing'
    }
  })
}).then(r => r.text()).then(t => {
  console.log('Fetch response:', t);
}).catch(err => {
  console.error('Fetch error:', err.message);
});
