const { sbQuery } = require('./lib/supabase');
async function run() {
  const result = await sbQuery({ 
      method: 'GET', 
      table: 'contacts', 
      query: 'select=id,custom_fields&limit=10' 
  });
  console.log(result);
}
run().catch(console.error);
