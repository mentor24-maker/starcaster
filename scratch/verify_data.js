const { sbQuery } = require('../lib/supabase');
async function run() {
  const result = await sbQuery({ 
      method: 'GET', 
      table: 'contacts', 
      query: 'select=id,custom_fields&limit=100' 
  });
  if (!result.ok) { console.error(result); return; }
  const data = result.data;
  const matching = data.filter(r => r.custom_fields && r.custom_fields.comments_topic);
  console.log("Total contacts:", data.length);
  console.log("Found contacts with comments_topic:", matching.length);
  if (matching.length > 0) {
    console.log("Sample custom_fields:", JSON.stringify(matching[0].custom_fields, null, 2));
  }
}
run().catch(console.error);
