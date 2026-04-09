const { sbQuery } = require('../lib/supabase');
async function run() {
  const result = await sbQuery({ 
      method: 'GET', 
      table: 'contacts', 
      query: 'select=id,custom_fields&limit=10' 
  });
  console.log(JSON.stringify(result, null, 2));
}
run().catch(console.error);
