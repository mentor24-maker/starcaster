'use strict';

/**
 * The real CRM stores must say when a read FAILED, not just return the same
 * empty answer as "nothing there" (task 86bcynjx2, round 2). Site Import's
 * form step creates a CRM on an empty list and re-creates a form on a null,
 * so a failed read that looks empty makes a second CRM and a twin form —
 * landmine 15. Supabase is replaced with a stub whose answer each test sets.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const supabasePath = require.resolve(path.join(__dirname, '../../lib/supabase.js'));
const answer = { next: null };
require.cache[supabasePath] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: {
    isConfigured: () => true,
    tableConfig: () => ({ crmConfigs: 'crm_configs', crmForms: 'crm_forms' }),
    async sbQuery({ query }) {
      // The support probe ("select=id&limit=1") always says the table exists.
      if (query === 'select=id&limit=1') return { ok: true, data: [] };
      return answer.next;
    },
  },
};

const configStore = require('../../lib/crmConfigStore.js');
const formsStore = require('../../lib/crmFormsStore.js');

const DOWN = { ok: false, status: 0, error: 'Could not reach Supabase: timeout' };

test('listConfigs: a failed read records why; a clean empty one does not', async () => {
  answer.next = DOWN;
  assert.deepEqual(await configStore.listConfigs(), []);
  assert.match(configStore.getLastConfigStoreError(), /Could not reach Supabase/);

  answer.next = { ok: true, data: [] };
  assert.deepEqual(await configStore.listConfigs(), []);
  assert.equal(configStore.getLastConfigStoreError(), '', 'a clean "no CRM" clears the reason');
});

test('getForm: a failed read records why; a clean "no such form" does not', async () => {
  answer.next = DOWN;
  assert.equal(await formsStore.getForm('crmf_orig'), null);
  assert.match(formsStore.getLastFormStoreError(), /Could not reach Supabase/);

  answer.next = { ok: true, data: [] };
  assert.equal(await formsStore.getForm('crmf_orig'), null);
  assert.equal(formsStore.getLastFormStoreError(), '', 'a clean "gone" clears the reason');
});
