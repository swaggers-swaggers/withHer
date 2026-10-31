const fs = require('node:fs');
const path = require('node:path');

// Preserve the existing keyring-encrypted credential; never return it to UI.
class CredentialVault {
  constructor(filename, safeStorage, env = process.env) { this.filename = filename; this.safe = safeStorage; this.env = env; this.sessionKey = null; this.suppressed = false; }
  persistent() { return this.safe.isEncryptionAvailable() && (!this.safe.getSelectedStorageBackend || this.safe.getSelectedStorageBackend() !== 'basic_text'); }
  get() {
    if (this.suppressed) return '';
    if (this.sessionKey) return this.sessionKey;
    if (fs.existsSync(this.filename) && this.persistent()) {
      try { return this.safe.decryptString(fs.readFileSync(this.filename)); }
      catch { throw new Error('无法解锁已保存的 API 密钥，请重新输入'); }
    }
    return this.env.DEEPSEEK_API_KEY || '';
  }
  status() {
    let configured = false, error = '';
    try { configured = !!this.get(); } catch (e) { error = e.message; }
    return { configured, storage: this.persistent() ? 'encrypted' : 'session', error };
  }
  save(key) {
    if (typeof key !== 'string' || key.trim().length < 12 || key.length > 512 || /\s/.test(key.trim())) throw new Error('请输入有效的 DeepSeek API 密钥');
    this.sessionKey = key.trim(); this.suppressed = false;
    if (this.persistent()) {
      fs.mkdirSync(path.dirname(this.filename), { recursive: true, mode: 0o700 });
      fs.writeFileSync(this.filename + '.tmp', this.safe.encryptString(this.sessionKey), { mode: 0o600 });
      fs.renameSync(this.filename + '.tmp', this.filename);
    }
  }
  clear() { this.sessionKey = null; this.suppressed = true; fs.rmSync(this.filename, { force: true }); }
}
module.exports = { CredentialVault };
