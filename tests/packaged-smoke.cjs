const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchEnvironment } = require('../scripts/launch-env.cjs');

// Always use an empty temporary profile. Never read a real user's key or history.
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'studydesk-smoke-'));
const executable = process.platform === 'win32' ? path.join(root, 'release/win-unpacked/StudyDesk.exe') : path.join(root, 'release/linux-unpacked/studydesk');
let application;
(async () => {
  try {
    application = await electron.launch({ executablePath: executable,
      env: { ...launchEnvironment(executable), STUDYDESK_DATA_DIR: profile, DEEPSEEK_API_KEY: '' }, timeout: 60000 });
    const page = await application.firstWindow();
    await page.locator('.home-page').waitFor({ timeout: 30000 });
    const state = await page.evaluate(async () => ({ study: await window.studyDesk.load(), companion: await window.studyDesk.companionLoad(), runtime: window.studyDesk.runtime }));
    assert.equal(state.study.todos.length, 0); assert.equal(state.study.notes.length, 0);
    assert.equal(state.companion.messages.length, 0); assert.equal(state.companion.credentials.configured, false);
    assert.equal(state.runtime.sandboxed, true); assert.equal(state.runtime.contextIsolated, true);
    const saved = await page.evaluate(() => window.studyDesk.dispatch('todo.create', { title: 'Synthetic smoke test' }));
    assert.equal(saved.ok, true); assert.equal(saved.data.todos.length, 1);
    const dataDir = await application.evaluate(({ app }) => app.getPath('userData'));
    assert.equal(path.resolve(dataDir), path.resolve(profile));
    await application.evaluate(({ app }) => { setImmediate(() => app.quit()); });
    await application.close(); application = null;
    console.log('Packaged startup, empty profile, isolated renderer, todo write and clean exit passed.');
  } finally {
    if (application) await application.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
