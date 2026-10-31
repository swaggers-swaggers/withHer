const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchEnvironment } = require('../scripts/launch-env.cjs');
const { waitForCondition } = require('./helpers.cjs');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'studydesk-conversation-ui-'));
const executable = process.env.STUDYDESK_TEST_EXECUTABLE || (process.platform === 'win32' ? path.join(root, 'release/win-unpacked/StudyDesk.exe') : path.join(root, 'release/linux-unpacked/studydesk'));
fs.writeFileSync(path.join(profile, 'dafeyu-config.json'), JSON.stringify({ fantasy_probability: 0, reply_delay_probability: 1,
  reply_delay_min_ms: 1200, reply_delay_max_ms: 1200, tick_ms: 50, contact_plan_min_gap_ms: 0, life_enabled: false }));
let application;
(async () => {
  try {
    application = await electron.launch({ executablePath: executable,
      env: { ...launchEnvironment(executable), STUDYDESK_DATA_DIR: profile, DEEPSEEK_API_KEY: '' }, timeout: 60000 });
    await application.evaluate(({ net }) => {
      const original = net.fetch.bind(net);
      globalThis.syntheticRequests = [];
      net.fetch = async (url, input = {}) => {
        if (String(url).startsWith('file:')) return original(url, input);
        if (!String(url).startsWith('https://api.deepseek.com/')) throw new Error('Unexpected external request blocked');
        if (String(url).endsWith('/search')) return new Response(JSON.stringify({ results: [] }));
        const b = JSON.parse(input.body), c = JSON.parse(b.messages[1].content); globalThis.syntheticRequests.push(c.trigger);
        const tool = (name, args) => ({ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } });
        const first = !b.messages.some(m => m.role === 'tool');
        let calls, content;
        if (c.trigger === 'planned') {
          if (first) calls = [tool('unsaid_read', {}), tool('contact_plan_read', {})];
          else content = '那个小故事，现在想讲给你听。';
        } else if (c.dialogue.at(-1)?.content === '取消这次等待') content = '这句应该被取消';
        else if (first) calls = [
          tool('unsaid_update', { operations: [{ action: 'upsert', key: 'story', text: 'SYNTHETIC_UNSAID_STORY' }] }),
          tool('contact_plan_update', { operations: [{ action: 'upsert', key: 'story', intent: '晚点分享一个虚构故事', after_minutes: 1 }] }),
        ];
        else content = '我等一会儿，再和你讲故事。';
        return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: content ?? null,
          reasoning_content: 'SYNTHETIC_REASONING_NOT_VISIBLE', ...(calls ? { tool_calls: calls } : {}) }, finish_reason: calls ? 'tool_calls' : 'stop' }] }), { headers: { 'content-type': 'application/json' } });
      };
    });
    const page = await application.firstWindow(); await page.locator('.home-page').waitFor();
    await page.evaluate(async () => {
      await window.studyDesk.companionCommand('credentials.save', { key: 'synthetic-offline-credential' });
      await window.studyDesk.companionCommand('engine.start');
      const r = await window.studyDesk.companionCommand('chat.send', { content: '稍后给我讲一个小故事' }); if (!r.ok) throw new Error(r.error);
    });
    await waitForCondition(async () => (await page.evaluate(() => window.studyDesk.companionLoad())).waiting, 15000);
    assert.equal((await page.evaluate(() => window.studyDesk.companionLoad())).messages.filter(m => m.role === 'assistant').length, 0);
    await waitForCondition(async () => await page.locator('.chat-typing').count() === 0);
    await waitForCondition(async () => (await page.evaluate(() => window.studyDesk.companionLoad())).messages.filter(m => m.role === 'assistant').length === 1, 15000);
    // Advance only this synthetic profile's persisted schedule; no debug API ships in the app.
    const db = new (require('node:sqlite').DatabaseSync)(path.join(profile, 'dafeyu.sqlite'));
    db.exec('PRAGMA busy_timeout=5000');
    const stored = db.prepare("SELECT value FROM metadata WHERE key='contact_plans'").get();
    const plans = JSON.parse(stored.value); plans.items[0].due_at = Date.now() - 100; plans.revision++;
    db.prepare("UPDATE metadata SET value=? WHERE key='contact_plans'").run(JSON.stringify(plans)); db.close();
    await waitForCondition(async () => (await page.evaluate(() => window.studyDesk.companionLoad())).messages.filter(m => m.role === 'assistant').length === 2, 15000);
    assert.ok(await page.locator('#companion-chat').innerText().then(s => s.includes('那个小故事，现在想讲给你听。')));
    const ui = await page.locator('#companion-chat').innerText();
    assert.ok(!ui.includes('SYNTHETIC_UNSAID_STORY')); assert.ok(!ui.includes('SYNTHETIC_REASONING_NOT_VISIBLE'));
    await page.evaluate(() => window.studyDesk.companionCommand('chat.send', { content: '取消这次等待' }));
    await waitForCondition(async () => (await page.evaluate(() => window.studyDesk.companionLoad())).waiting);
    await page.evaluate(() => window.studyDesk.companionCommand('chat.stop'));
    await page.waitForTimeout(1400);
    const final = await page.evaluate(() => window.studyDesk.companionLoad());
    assert.equal(final.messages.filter(m => m.role === 'assistant').length, 2); assert.ok(!JSON.stringify(final).includes('这句应该被取消'));
    const triggers = await application.evaluate(() => globalThis.syntheticRequests); assert.ok(triggers.includes('planned'));
    console.log('Packaged chat passed: delayed IPC delivery, opt-in unsaid tools, planned contact, hidden internal content and cancellation. All provider responses were synthetic.');
  } finally {
    if (application) { await application.evaluate(({ app }) => { setImmediate(() => app.quit()); }).catch(() => {}); await application.close(); }
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
