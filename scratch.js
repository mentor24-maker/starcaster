const { listAssets } = require('./lib/assetsStore');
const scope = { projectId: '', userId: '', projectIds: [] };
(async () => {
  const read = await listAssets(scope);
  if (!read.ok) {
    console.error('Failed to read assets:', read.error);
    process.exit(1);
  }
  const assets = read.data || [];
  const generated = assets.filter(a => a.category === 'Generated' || a.generation_status === 'failed')
                          .sort((a,b) => Number(b.id) - Number(a.id));
  console.log(JSON.stringify(generated.slice(0, 3), null, 2));
  process.exit(0);
})();
