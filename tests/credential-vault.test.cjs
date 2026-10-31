const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CredentialVault } = require('../electron/credential-vault.cjs');

const fake = 'synthetic-test-credential-only';
function profile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studydesk-vault-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'companion-key.enc');
}
test('Windows-style safeStorage persists and reloads without a Linux backend API', t => {
  const file = profile(t);
  // Test double only; actual encryption is provided by Electron and the OS.
  const safe = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s.split('').reverse().join('')), decryptString: b => b.toString().split('').reverse().join('') };
  const vault = new CredentialVault(file, safe, {});
  vault.save(fake);
  assert.equal(fs.readFileSync(file).includes(fake), false);
  assert.equal(new CredentialVault(file, safe, {}).get(), fake);
  assert.deepEqual(vault.status(), { configured: true, storage: 'encrypted', error: '' });
  vault.clear(); assert.equal(vault.get(), ''); assert.equal(fs.existsSync(file), false);
});
test('unavailable encryption and Linux basic_text keep credentials in memory', t => {
  for (const backend of [null, 'basic_text']) {
    const file = profile(t);
    const safe = { isEncryptionAvailable: () => backend !== null, getSelectedStorageBackend: () => backend,
      encryptString: () => { throw new Error('must not write'); } };
    const vault = new CredentialVault(file, safe, {}); vault.save(fake);
    assert.equal(vault.get(), fake); assert.equal(vault.status().storage, 'session');
    assert.equal(fs.existsSync(file), false); assert.equal(new CredentialVault(file, safe, {}).get(), '');
  }
});
