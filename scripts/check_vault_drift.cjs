#!/usr/bin/env node
'use strict';

/**
 * npm run check:vault-drift [-- --vault <dir>]
 *
 * Reports vault publication drift (uncommitted/unpushed canon) and dangling
 * doctrine citations. READ-ONLY on the vault; NEVER a build/CI gate — it
 * informs a human and always exits 0 (a missing vault is CANNOT TELL, not a
 * failure). Also called by `npm run doctor`.
 */

const os = require('os');
const path = require('path');
const { checkVaultDrift } = require(path.join(__dirname, 'builder', 'vaultDrift.js'));

function argVault() {
  const i = process.argv.indexOf('--vault');
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return path.join(os.homedir(), 'vault');
}

const vaultDir = argVault();
const { findings, cannotTell, ok, checked } = checkVaultDrift(vaultDir);

if (findings.length) {
  console.log('Vault drift — worth a look:');
  findings.forEach((f) => console.log(`  ✗ ${f}`));
}
if (cannotTell.length) {
  console.log('Could NOT check (not the same as clean):');
  cannotTell.forEach((c) => console.log(`  ? ${c}`));
}
if (checked && ok) {
  console.log(`Vault checks OK — ${vaultDir} is committed, pushed, and its doctrine citations all resolve.`);
}
// Never fail: this is guidance, not a gate.
process.exit(0);
