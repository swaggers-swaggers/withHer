const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../companion');
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'engine-settings.json'), 'utf8'));
const prompt = (name, directory = root) => fs.readFileSync(path.join(directory, 'prompts-v2', name + '.md'), 'utf8');
const persona = (directory = root) => fs.readFileSync(path.join(directory, 'persona.md'), 'utf8');
function preparePrompts(directory) {
  fs.mkdirSync(path.join(directory, 'prompts-v2'), { recursive: true, mode: 0o700 });
  for (const file of ['persona.md', ...fs.readdirSync(path.join(root, 'prompts-v2')).filter(f => f.endsWith('.md')).map(f => path.join('prompts-v2', f))]) {
    const target = path.join(directory, file);
    if (!fs.existsSync(target)) fs.copyFileSync(path.join(root, file), target, fs.constants.COPYFILE_EXCL);
  }
}
function writeJSON(file, data) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
  fs.chmodSync(file, 0o600);
}
function loadConfig(dataDir) {
  const file = path.join(dataDir, 'dafeyu-config.json');
  let saved = {};
  if (fs.existsSync(file)) saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  else {
    // Import only the model and enable switch; no executable paths or tokens.
    const legacy = path.join(dataDir, 'maibot-bridge.json');
    if (fs.existsSync(legacy)) {
      const old = JSON.parse(fs.readFileSync(legacy, 'utf8'));
      saved = { model: old.model, enabled: !!old.enabled };
    }
  }
  const config = { ...defaults, ...saved, thinking: { type: 'enabled' } };
  config.timezone ||= Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  for (const key of ['fantasy_probability']) {
    if (!Number.isFinite(config[key]) || config[key] < 0 || config[key] > 1) config[key] = defaults[key];
  }
  for (const key of ['reply_max_schedule_ms', 'delivery_send_grace_ms', 'delivery_max_age_ms', 'contact_plan_retry_ms', 'contact_plan_min_gap_ms']) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 0 || config[key] > 86400000) config[key] = defaults[key];
  }
  for (const key of ['reply_max_bubbles', 'reply_max_characters']) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1 || config[key] > (key === 'reply_max_bubbles' ? 128 : 64000)) config[key] = defaults[key];
  }
  for (const key of ['reply_delay_probability', 'reply_delay_min_ms', 'reply_delay_max_ms']) delete config[key];
  config.chat_max_messages = 200;
  delete config.chat_input_token_budget;
  config.prompt_directory ||= path.join(dataDir, 'companion-prompts');
  preparePrompts(config.prompt_directory);
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(config.model)) config.model = defaults.model;
  return { config, file };
}
const tokens = value => Math.ceil(Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8') / 2) + 32;
module.exports = { defaults, prompt, persona, writeJSON, loadConfig, tokens };
