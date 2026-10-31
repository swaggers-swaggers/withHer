const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { AgentStore } = require('../electron/agent/store.cjs');
const { DafeyuEngine } = require('../electron/dafeyu-engine.cjs');
const { defaults } = require('../electron/agent/config.cjs');
const { DeepSeek, visibleReply } = require('../electron/agent/deepseek.cjs');
const { validateFacts, FactMemory } = require('../electron/agent/memory.cjs');
const { Relationship, evidenceFor } = require('../electron/agent/relationship.cjs');
const { Motivation, BASE, validateMotives } = require('../electron/agent/motivation.cjs');
const { StudyReader } = require('../electron/agent/study.cjs');
const { OnlineInfo } = require('../electron/agent/news.cjs');
const { eligible } = require('../electron/agent/scheduler.cjs');
const { ShortTermMemory } = require('../electron/agent/short-term.cjs');
const { WebResearch, publicURL } = require('../electron/agent/web.cjs');
const { waitForCondition } = require('./helpers.cjs');

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dafeyu-test-'));
const snapshot = () => ({ todos: [], notes: [], timer: { status: 'idle' }, learning: {} });
const vault = { get: () => 'fake-local-test-key', status: () => ({ configured: true, storage: 'session', error: '' }), save() {}, clear() {} };
const completion = (content = '嗯，今天我陪着你。', extra = {}, finish_reason = 'stop') => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content, reasoning_content: 'PRIVATE REASONING', ...extra }, finish_reason }] }), { headers: { 'Content-Type': 'application/json' } });
const call = (name, args, id = name) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const narrative = '我开始慢慢懂得他对安静的坚持。那不是疏远，只是他希望自己的节奏被认真对待。我愿意在旁边轻轻说话，偶尔逗他一下，也留一段不用回答的空白。';
function setup(t, options = {}) {
  const dir = folder(), events = [], wire = [];
  const engine = new DafeyuEngine(dir, vault, { emit: e => events.push(e), presence: () => ({ available: true, focus: false }), studySnapshot: snapshot,
    remoteFetch: async (url, input) => { wire.push({ url, request: JSON.parse(input.body) }); return completion(); }, ...options });
  t.after(async () => { await engine.stop(); engine.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { engine, dir, events, wire };
}
const idle = engine => waitForCondition(() => !engine.draining && !engine.active && !engine.queue.length, 5000);

test('legacy migration is transactional, idempotent and preserves exact message IDs, times and quotes', () => {
  const dir = folder(), old = new DatabaseSync(path.join(dir, 'maibot-view.sqlite'));
  old.exec(`CREATE TABLE messages(seq INTEGER PRIMARY KEY,id TEXT,role TEXT,content TEXT,created_at INTEGER,status TEXT,segments_json TEXT)`);
  old.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?)').run(7, 'old-id', 'user', '原文', 1234, 'complete', '[]'); old.close();
  let store = new AgentStore(dir); assert.equal(store.messages()[0].id, 'old-id'); assert.equal(store.messages()[0].seq, 7);
  assert.equal(store.meta('legacy_import').count, 1); assert.equal(store.factContext().length, 0); store.close();
  store = new AgentStore(dir); assert.equal(store.messages().length, 1); assert.equal(store.messages()[0].created_at, 1234); store.close(); fs.rmSync(dir, { recursive: true });
});
test('crash recovery does not automatically resend an unfinished user message', () => {
  const dir = folder(); let store = new AgentStore(dir); store.addMessage('user', '未完成', 1000, { status: 'pending' }); store.close();
  store = new AgentStore(dir); assert.equal(store.messages()[0].status, 'interrupted'); assert.equal(store.recent().length, 1); store.close(); fs.rmSync(dir, { recursive: true });
});
test('facts need verbatim user evidence; assistant fantasies cannot become facts', t => {
  const { engine } = setup(t); const u = engine.store.addMessage('user', '我喜欢不加糖的咖啡', 1000), a = engine.store.addMessage('assistant', '我们昨天去过月亮', 1001);
  const fact = { key: 'drink', text: '用户表示喜欢不加糖的咖啡', evidence: [{ message_id: u.id, quote: '不加糖的咖啡' }] };
  assert.equal(validateFacts({ facts: [fact] }, [u, a], engine.store).length, 1);
  assert.throws(() => validateFacts({ facts: [{ ...fact, evidence: [{ message_id: a.id, quote: '去过月亮' }] }] }, [u, a], engine.store));
  assert.throws(() => evidenceFor([{ message_id: u.id, quote: '喜欢奶茶' }], [u]));
  assert.throws(() => validateFacts({ facts: [fact, fact] }, [u], engine.store));
});
test('fact corrections retain old versions and cannot retract an unrelated topic', t => {
  const { engine } = setup(t), s = engine.store;
  s.commitFacts([{ key: 'drink', text: '用户表示喜欢咖啡', evidence: [] }, { key: 'hobby', text: '用户表示喜欢画画', evidence: [] }], 1000);
  const old = s.factContext().find(f => f.key === 'drink'), unrelated = s.factContext().find(f => f.key === 'hobby');
  const u = s.addMessage('user', '更正一下，我现在只喝茶', 2000);
  const f = { key: 'drink', text: '用户表示现在只喝茶', evidence: [{ message_id: u.id, quote: '现在只喝茶' }], replaces: [old.id] };
  s.transaction(() => s.commitFacts(validateFacts({ facts: [f] }, [u], s), 2000));
  assert.equal(s.fact(old.id).active, 0); assert.ok(s.fact(old.id).superseded_by);
  assert.equal(s.factContext().length, 2); assert.equal(s.search({ query: '咖啡' }).items.length, 0);
  assert.equal(s.search({ query: '咖啡', include_inactive: true }).items.length, 1);
  assert.throws(() => validateFacts({ facts: [{ ...f, replaces: [unrelated.id] }] }, [u], s));
});
test('indexed Chinese/English search, short keywords, literal wildcards, pagination, IDs and time boundaries work', t => {
  const { engine } = setup(t), s = engine.store;
  for (let i = 0; i < 25; i++) s.commitFacts([{ key: 'f' + i, text: '用户表示今天喜欢无糖咖啡和 transformer ' + i, evidence: [] }], 1000 + i);
  assert.equal(s.search({ query: '无糖咖啡', limit: 10 }).items.length, 10);
  assert.equal(s.search({ query: '咖啡', limit: 10 }).next_offset, 10);
  assert.equal(s.search({ query: 'transformer', offset: 20 }).items.length, 5);
  assert.equal(s.search({ query: '% _' }).items.length, 0);
  assert.equal(s.search({ after: 1020, before: 1024 }).items.length, 5);
  const item = s.search({ limit: 1 }).items[0]; assert.equal(s.read(item.id).text, item.text);
  assert.throws(() => s.search({ scope: 'facts; DROP TABLE facts' }));
  assert.throws(() => s.search({ offset: -1 }));
});
test('random recall uses only active facts and stays outside relationship prose', t => {
  const { engine } = setup(t); engine.store.commitFacts([{ key: 'x', text: '用户说自己养猫', evidence: [] }], 1000);
  const recalled = engine.store.wander(3, () => 0); assert.equal(recalled[0].text, '用户说自己养猫');
  assert.equal(recalled.some(r => r.text === engine.store.relationship().narrative), false);
});
test('StudyDesk full notes are chunked and retrievable; edits/deletions immediately remove stale search results', t => {
  const { engine } = setup(t); let s = { ...snapshot(), todos: [{ id: 't', title: '写论文', created_at: 1000 }], notes: [{ id: 'n', body: '甲'.repeat(6001) + '最后一段秘密', updated_at: 1000 }] };
  const reader = new StudyReader(engine.store, () => s); reader.sync();
  assert.equal(reader.read('notes', 0, 1).next_offset, 1);
  assert.equal(engine.store.search({ scope: 'study', query: '最后一段秘密' }).items.length, 1);
  assert.equal(reader.read('todos').items.length, 1);
  s.notes[0].body = '改成新的原文'; reader.sync();
  assert.equal(engine.store.search({ scope: 'study', query: '最后一段秘密' }).items.length, 0);
  s.notes[0].deleted_at = 2000; s.todos[0].deleted_at = 2000; reader.sync();
  assert.equal(engine.store.search({ scope: 'study' }).items.length, 0);
});
test('batch threshold collects new messages before extracting and never silently skips unprocessed messages', t => {
  const { engine } = setup(t); const settings = { ...defaults, memory_trigger_tokens: 500, memory_batch_max_messages: 3 };
  engine.store.addMessage('user', '短句', 1); assert.equal(engine.store.batch(settings).due, false);
  engine.store.addMessage('assistant', '答复', 2); engine.store.addMessage('user', '第三条', 3); assert.equal(engine.store.batch(settings).due, true);
  engine.store.setMeta('memory_cursor', 2); assert.deepEqual(engine.store.batch(settings).rows.map(r => r.seq), [3]);
});
test('successful consolidation atomically updates facts, literature, motives and cursor; rerun is idempotent', async t => {
  const { engine } = setup(t), s = engine.store, u = s.addMessage('user', '我现在只喝茶', 1000);
  const provider = { object: async system => system.includes('事实档案整理员') ? { facts: [{ key: 'drink', text: '用户表示现在只喝茶', evidence: [{ message_id: u.id, quote: '只喝茶' }] }] } :
    { should_update: true, narrative, reason: '用户表达了新的生活偏好', motives: [{ id: 'tea', text: '聊聊喝茶时的小心情', weight: 2 }] } };
  const settings = { ...defaults, memory_trigger_tokens: 1 };
  const memory = new FactMemory(s, provider, new Relationship(s, provider, settings), settings, () => 10000);
  assert.ok(await memory.consolidate(new AbortController().signal));
  assert.equal(s.meta('memory_cursor'), u.seq); assert.equal(s.factContext().length, 1); assert.equal(s.relationship().narrative, narrative);
  assert.equal(s.meta('custom_motives')[0].id, 'tea'); assert.equal(s.db.prepare('SELECT COUNT(*) n FROM batches').get().n, 1);
  assert.equal(await memory.consolidate(new AbortController().signal), false);
});
test('failed writer leaves facts, feelings, motives and cursor unchanged for retry', async t => {
  const { engine } = setup(t), s = engine.store, u = s.addMessage('user', '我现在只喝茶', 1000);
  const before = s.relationship().revision;
  const provider = { object: async () => ({ facts: [{ key: 'drink', text: '用户表示只喝茶', evidence: [{ message_id: u.id, quote: '只喝茶' }] }] }) };
  const memory = new FactMemory(s, provider, { compose: async () => { throw new Error('writer failed'); } }, { ...defaults, memory_trigger_tokens: 1 });
  await assert.rejects(memory.consolidate(new AbortController().signal));
  assert.equal(s.meta('memory_cursor', 0), 0); assert.equal(s.factContext().length, 0); assert.equal(s.relationship().revision, before);
});
test('cancellation between extraction and commit preserves the entire previous state', async t => {
  const { engine } = setup(t), s = engine.store; s.addMessage('user', '你好呀', 1000); const c = new AbortController();
  const memory = new FactMemory(s, { object: async () => ({ facts: [] }) }, { compose: async () => { c.abort(); return null; } }, { ...defaults, memory_trigger_tokens: 1 });
  await assert.rejects(memory.consolidate(c.signal)); assert.equal(s.meta('memory_cursor', 0), 0); assert.equal(s.relationship().revision, 1);
});
test('significant event must be confirmed by writer; ordinary events cannot override feelings', async t => {
  const { engine } = setup(t), s = engine.store;
  const r = new Relationship(s, { object: async () => ({ should_update: true, significant: false, narrative, reason: '普通交流' }) }, defaults);
  assert.equal(await r.compose({ rows: [], mode: 'significant' }), null); assert.equal(s.relationship().revision, 1);
});
test('base motives persist while custom motives can be added or removed during batch updates', t => {
  const { engine } = setup(t), m = new Motivation(engine.store, {}, () => 0.99);
  engine.store.setMeta('custom_motives', validateMotives([{ id: 'music', text: '想和他聊音乐', weight: 2 }]));
  assert.equal(m.presets().length, 4); assert.equal(m.choose().id, 'music');
  engine.store.setMeta('custom_motives', validateMotives([])); assert.deepEqual(m.presets(), BASE);
  assert.throws(() => validateMotives([{ id: 'bad', text: 'x', weight: 0 }]));
});
test('imagination returns both literary fantasy and motive without writing facts', async t => {
  const { engine } = setup(t); const m = new Motivation(engine.store, { object: async () => ({ fantasy: '如果云朵也有课表，今天就偷偷旷一节。', motive: '和他开一个云朵的玩笑' }) });
  const result = await m.imagine({ news: [] }); assert.ok(result.fictional); assert.ok(result.fantasy); assert.ok(result.motive); assert.equal(engine.store.factContext().length, 0);
});
const schedule = patch => eligible({ now: 20_000_000, startedAt: 1, lastEvent: 19_000_000, lastAttempt: 0, presence: { available: true, focus: false }, busy: false, paused: false, typingUntil: 0, settings: defaults, random: () => 1, ...patch });
test('proactive contact is guaranteed after three hours even when RNG rejects probability', () => {
  assert.deepEqual(schedule({ lastEvent: 20_000_000 - 10800000 }), { trigger: true, reason: 'three-hours' });
});
test('proactive contact remains silent during focus, lock, typing and manual pause even after three hours', () => {
  for (const patch of [{ presence: { available: false } }, { presence: { available: true, focus: true } }, { typingUntil: 21_000_000 }, { paused: true }, { busy: true }]) assert.equal(schedule({ lastEvent: 1, ...patch }).trigger, false);
});
test('proactive probabilistic trigger respects minimum interval, failures retry later, and resuming availability preserves overdue status', () => {
  assert.equal(schedule({ lastEvent: 19_000_000, random: () => 0 }).trigger, false);
  assert.equal(schedule({ lastEvent: 17_000_000, random: () => 0 }).trigger, true);
  assert.equal(schedule({ lastEvent: 1, lastAttempt: 19_999_999 }).trigger, false);
  assert.equal(schedule({ lastEvent: 1, lastAttempt: 19_000_000 }).trigger, true);
});
test('online refresh retains sources and timestamps, excludes stale items, never searches private dialogue', async t => {
  const { engine } = setup(t), s = engine.store; const now = Date.now(); let query;
  const news = new OnlineInfo(s, { search: async q => { query = q; return { results: [
    { title: '新消息', url: 'https://example.com/new', summary: '今天的科技消息', date: new Date(now).toISOString() },
    { title: '旧消息', url: 'https://example.com/old', summary: '旧闻', date: '2020-01-01' },
    { title: '未知时间', url: 'https://example.com/unknown', summary: '尚待核实发布时间' },
    { title: '无效地址', url: 'javascript:alert(1)' },
  ] }; } }, defaults, () => now);
  assert.ok(news.due()); assert.equal(await news.refresh(new AbortController().signal), 2); assert.equal(news.items().length, 2);
  assert.ok(query.includes('after:')); assert.ok(!query.includes('私密')); assert.equal(news.due(), false);
  assert.ok(news.items().every(x => x.url && x.fetched_at)); assert.equal(s.factContext().length, 0);
});
test('failed online refresh retains fresh cache and records retry cooldown', async t => {
  const { engine } = setup(t), s = engine.store; const now = Date.now();
  s.db.prepare('INSERT INTO news VALUES(?,?,?,?,?,?)').run('x', '仍然有效', 'https://example.com', '内容', now, now);
  const news = new OnlineInfo(s, { search: async () => { throw new Error('offline'); } }, defaults, () => now);
  await assert.rejects(news.refresh(new AbortController().signal)); assert.equal(news.items().length, 1); assert.equal(news.due(), false);
});
test('DeepSeek explicitly enables thinking and returns reasoning separately; no temperature is sent', async () => {
  let body; const d = new DeepSeek(vault, async (_, input) => { body = JSON.parse(input.body); return completion(); }, defaults);
  const result = await d.complete([{ role: 'user', content: '你好' }]); assert.deepEqual(body.thinking, { type: 'enabled' });
  assert.equal(body.stream, false); assert.equal(body.temperature, undefined); assert.equal(result.reasoning_content, 'PRIVATE REASONING');
});
test('provider errors do not expose remote bodies or credentials and 4xx is not blindly retried', async () => {
  let n = 0; const d = new DeepSeek(vault, async () => { n++; return new Response('secret fake-local-test-key', { status: 401 }); }, defaults);
  await assert.rejects(d.complete([{ role: 'user', content: '你好' }]), e => e.status === 401 && !e.message.includes('fake-local')); assert.equal(n, 1);
});
test('partial completions are rejected and never displayed as a complete reply', async () => {
  const d = new DeepSeek(vault, async () => completion('不完整', {}, 'length'), defaults);
  await assert.rejects(d.complete([{ role: 'user', content: '你好' }]));
});
test('output boundary rejects internal analysis and protocol wrappers while preserving ordinary prose and code', () => {
  assert.equal(visibleReply('<think>secret</think>晚安呀。'), '晚安呀。');
  for (const s of ['<think>unfinished', '分析步骤：先分析', '{"reply":"正文","analysis":"secret"}', '[analysis]secret']) assert.throws(() => visibleReply(s));
  assert.equal(visibleReply('这段代码可以这样写：\n```python\nprint("hello")\n```'), '这段代码可以这样写：\n```python\nprint("hello")\n```');
});
test('local start is immediate, preserves window contract and does not make network requests', async t => {
  const { engine, wire } = setup(t); await engine.start(); assert.equal(engine.state().engine.status, 'ready'); assert.deepEqual(wire, []);
  assert.equal(engine.state().conversation.title, '大肥鱼'); assert.equal(engine.state().engine.name, 'Dafeyu'); assert.ok(!JSON.stringify(engine.state()).includes(vault.get()));
});
test('real tool loop preserves thinking, reads StudyDesk and publishes only the final answer', async t => {
  const seen = [], notes = [{ id: 'n', body: '小猫今天学会开门了', updated_at: 1 }];
  const { engine, events } = setup(t, { studySnapshot: () => ({ ...snapshot(), notes }), remoteFetch: async (_, input) => {
    const b = JSON.parse(input.body); seen.push(b);
    if (seen.length === 1) return completion('让我分析和调用工具，这句不能展示', { tool_calls: [call('study_read', { area: 'notes' })] }, 'tool_calls');
    assert.equal(b.messages[2].reasoning_content, 'PRIVATE REASONING'); assert.ok(b.messages[3].content.includes('小猫今天学会开门了'));
    return completion('小猫这么聪明呀，我可要跟它较劲了。');
  } });
  await engine.start(); await engine.command('chat.send', { content: '看看我的随手记' }); await idle(engine);
  assert.equal(engine.store.messages().length, 2); assert.match(engine.store.messages()[1].content, /小猫/);
  assert.equal(events.filter(e => e.type === 'delivered').length, 1);
  assert.ok(!JSON.stringify(engine.state()).includes('PRIVATE REASONING')); assert.ok(!JSON.stringify(engine.state()).includes('让我分析'));
  const context = JSON.parse(seen[0].messages[1].content); assert.ok(context.relationship); assert.ok(context.motive.text);
});
test('imagination tool passes fantasy and temporary motive into the actual final reply request', async t => {
  let turn = 0; let received = false;
  const { engine } = setup(t, { remoteFetch: async (_, input) => {
    const b = JSON.parse(input.body);
    if (b.response_format) return completion(JSON.stringify({ fantasy: '云朵变成小鱼', motive: '分享一个小鱼梦' }));
    if (!turn++) return completion(null, { tool_calls: [call('imagine', { seed: '云朵' })] }, 'tool_calls');
    received = b.messages.some(m => m.role === 'tool' && m.content.includes('云朵变成小鱼') && m.content.includes('分享一个小鱼梦'));
    return completion('我刚刚在想，云朵要是小鱼就好了。');
  } });
  await engine.start(); await engine.command('chat.send', { content: '想点好玩的' }); await idle(engine);
  assert.ok(received); assert.equal(engine.store.factContext().length, 0);
});
test('significant relationship tool updates independent prose and does not write facts or manage presets', async t => {
  let turn = 0;
  const { engine } = setup(t, { remoteFetch: async (_, input) => {
    const b = JSON.parse(input.body);
    if (b.response_format) return completion(JSON.stringify({ should_update: true, significant: true, narrative, reason: '用户明确重新界定了双方的相处边界', motives: [{ id: 'ignored', text: '不在此时管理动机', weight: 1 }] }));
    const c = JSON.parse(b.messages[1].content);
    if (!turn++) return completion(null, { tool_calls: [call('relationship_reconsider', { reason: '用户认真表达的相处边界足以纠正过去的重要误解', evidence: [{ message_id: c.dialogue.at(-1).id, quote: '请认真尊重我的边界' }] })] }, 'tool_calls');
    return completion('好，这件事我会认真放在心上。');
  } });
  await engine.start(); await engine.command('chat.send', { content: '请认真尊重我的边界' }); await idle(engine);
  assert.equal(engine.store.relationship().mode, 'significant'); assert.equal(engine.store.relationship().narrative, narrative);
  assert.equal(engine.store.factContext().length, 0); assert.deepEqual(engine.store.meta('custom_motives', []), []);
});
test('multiple user sends are serialized, attributed and do not leak future messages into an earlier reply', async t => {
  const contexts = [];
  const { engine } = setup(t, { remoteFetch: async (_, input) => { contexts.push(JSON.parse(JSON.parse(input.body).messages[1].content)); await new Promise(r => setTimeout(r, 20)); return completion('收到啦。'); } });
  await engine.start(); await engine.command('chat.send', { content: '第一条' }); await engine.command('chat.send', { content: '第二条' }); await idle(engine);
  assert.equal(contexts.length, 2); assert.equal(contexts[0].dialogue.at(-1).content, '第一条'); assert.ok(!JSON.stringify(contexts[0]).includes('第二条'));
  assert.equal(contexts[1].dialogue.at(-1).content, '第二条'); assert.equal(contexts[1].dialogue[1].content, '收到啦。'); assert.equal(engine.store.messages().filter(m => m.role === 'assistant').length, 2);
});
test('stop cancels an in-flight reply, marks the pending message and prevents late delivery', async t => {
  let started = false;
  const { engine, events } = setup(t, { remoteFetch: async (_, input) => {
    started = true; await new Promise((resolve, reject) => { input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true }); });
  } });
  await engine.start(); await engine.command('chat.send', { content: '等一等' }); await waitForCondition(() => started);
  await engine.command('chat.stop'); assert.equal(engine.busy, false); assert.equal(engine.store.messages()[0].status, 'interrupted');
  assert.equal(events.filter(e => e.type === 'delivered').length, 0); assert.equal(engine.manualPause, true);
});
test('overdue proactive generation is canceled by typing, and old three-hour deadline remains due', async t => {
  let started = false; const now = 20_000_000;
  const { engine, events } = setup(t, { now: () => now, remoteFetch: async (_, input) => { started = true; await new Promise((_, reject) => input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true })); } });
  engine.store.addMessage('assistant', '旧消息', now - 4 * 3600000); await engine.start(); await engine.tick(); await waitForCondition(() => started);
  assert.equal(engine.active.kind, 'proactive'); await engine.command('chat.typing'); await idle(engine);
  assert.equal(engine.store.messages().length, 1); assert.equal(events.filter(e => e.type === 'delivered').length, 0);
});
test('an idle overdue trigger creates one durable proactive message and resets the deadline', async t => {
  const now = 20_000_000; const { engine, events } = setup(t, { now: () => now });
  engine.store.addMessage('user', '旧消息', now - 4 * 3600000); await engine.start(); await engine.tick(); await idle(engine);
  assert.equal(engine.store.lastEvent(), now); assert.equal(events.find(e => e.type === 'delivered').autonomous, true);
  assert.equal(schedule({ now, lastEvent: engine.store.lastEvent() }).trigger, false);
});
test('invalid final output is never stored or delivered and the user can send again', async t => {
  const { engine, events } = setup(t, { remoteFetch: async () => completion('分析步骤：这是内部分析') });
  await engine.start(); await engine.command('chat.send', { content: '你好' }); await idle(engine);
  assert.equal(engine.store.messages().length, 1); assert.equal(engine.store.messages()[0].status, 'failed'); assert.equal(events.filter(e => e.type === 'delivered').length, 0); assert.ok(engine.error);
});
test('facts, prose, presets, cursors, news and chat are all included in local export and survive restart', t => {
  const { engine, dir } = setup(t); engine.store.setMeta('custom_motives', [{ id: 'tea', text: '茶', weight: 1 }]); engine.store.setMeta('memory_cursor', 12);
  const exported = engine.store.exportData(); for (const name of ['facts', 'relationship_versions', 'metadata', 'news', 'messages', 'batches']) assert.ok(Array.isArray(exported[name]));
  // POSIX permission bits do not describe Windows ACLs. Persistence is tested on both.
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'dafeyu.sqlite')).mode & 0o777, 0o600);
  const reopened = new AgentStore(dir);
  assert.equal(reopened.meta('memory_cursor'), 12); assert.equal(reopened.meta('custom_motives')[0].id, 'tea');
  assert.equal(reopened.relationship().narrative, engine.store.relationship().narrative); reopened.close();
});
test('a large following message cannot prevent a smaller unprocessed batch from ever advancing', t => {
  const { engine } = setup(t), s = engine.store;
  s.addMessage('user', '很短', 1); s.addMessage('user', '大'.repeat(500), 2);
  const batch = s.batch({ ...defaults, memory_trigger_tokens: 500, memory_batch_max_tokens: 100 });
  assert.equal(batch.rows.length, 1); assert.equal(batch.due, true);
});
test('failed and canceled replies do not erase real user statements from future factual consolidation', t => {
  const { engine } = setup(t), s = engine.store;
  const u = s.addMessage('user', '我喜欢小猫', 1, { status: 'failed' });
  s.addMessage('assistant', '之后的回复', 2);
  assert.equal(s.batch(defaults).rows[0].id, u.id);
});
test('short-term notes require user evidence, merge by key, expire and never write long-term facts or feelings', t => {
  const { engine } = setup(t); let now = 10000; const m = new ShortTermMemory(engine.store, () => now);
  const u = engine.store.addMessage('user', '今晚不聊学习，想放松一下', now);
  const op = { action: 'upsert', key: 'tonight', text: '用户今晚想轻松聊天，不聊学习', evidence: [{ message_id: u.id, quote: '今晚不聊学习' }], expires_hours: 1 };
  assert.equal(m.read().notes.length, 0); const planned = m.plan([op], [u]); assert.equal(m.read().notes.length, 0);
  engine.store.transaction(() => m.commit(planned)); assert.equal(m.read().notes.length, 1);
  const updated = m.plan([{ ...op, text: '今晚保持轻松的氛围' }], [u]); m.commit(updated); assert.equal(m.read().notes.length, 1);
  assert.equal(engine.store.factContext().length, 0); assert.equal(engine.store.relationship().revision, 1);
  now += 3600001; assert.equal(m.read().notes.length, 0);
});
test('short-term updates reject invented quotes and assistant statements, support explicit removal and preserve changes on restart', t => {
  const { engine, dir } = setup(t), m = engine.shortTerm;
  const u = engine.store.addMessage('user', '明天记得一起讨论论文', Date.now()), a = engine.store.addMessage('assistant', '我们去了月球', Date.now());
  const op = { action: 'upsert', key: 'paper', text: '明天讨论论文', evidence: [{ message_id: u.id, quote: '讨论论文' }] };
  assert.throws(() => m.plan([{ ...op, evidence: [{ message_id: a.id, quote: '去了月球' }] }], [a]));
  assert.throws(() => m.plan([{ ...op, evidence: [{ message_id: u.id, quote: '游泳' }] }], [u]));
  assert.throws(() => m.plan([{ ...op, expires_hours: 1000 }], [u]));
  m.commit(m.plan([op], [u])); const reopened = new AgentStore(dir);
  assert.equal(new ShortTermMemory(reopened).read().notes[0].key, 'paper'); reopened.close();
  m.commit(m.plan([{ action: 'remove', key: 'paper' }], [])); assert.equal(m.read().notes.length, 0);
});
test('short-term tool saves important current content and injects it into the next real reply context', async t => {
  let turn = 0; const inputs = [];
  const { engine } = setup(t, { remoteFetch: async (_, input) => {
    const b = JSON.parse(input.body), c = JSON.parse(b.messages[1].content); inputs.push(c);
    if (turn++ === 0) return completion(null, { tool_calls: [call('short_term_update', { operations: [{ action: 'upsert', key: 'tonight', text: '今晚不催学习', expires_hours: 2, evidence: [{ message_id: c.dialogue.at(-1).id, quote: '今晚不催学习' }] }] })] }, 'tool_calls');
    return completion('好，今晚就轻松一点。');
  } });
  await engine.start(); await engine.command('chat.send', { content: '今晚不催学习' }); await idle(engine);
  assert.equal(engine.shortTerm.read().notes.length, 1); assert.equal(engine.store.factContext().length, 0);
  await engine.command('chat.send', { content: '还记得今晚的安排吗' }); await idle(engine);
  assert.equal(inputs.at(-1).short_term_memory.notes[0].text, '今晚不催学习');
});
test('a failed final reply cannot commit a pending short-term update', async t => {
  let turn = 0;
  const { engine } = setup(t, { remoteFetch: async (_, input) => {
    const b = JSON.parse(input.body), c = JSON.parse(b.messages[1].content);
    if (!turn++) return completion(null, { tool_calls: [call('short_term_update', { operations: [{ action: 'upsert', key: 'x', text: '今晚想安静', evidence: [{ message_id: c.dialogue.at(-1).id, quote: '今晚想安静' }] }] })] }, 'tool_calls');
    return completion('分析步骤：内部内容');
  } });
  await engine.start(); await engine.command('chat.send', { content: '今晚想安静' }); await idle(engine); assert.equal(engine.shortTerm.read().notes.length, 0);
});
test('all editable prompts are preserved during startup and reloaded on the next request without rebuilding', async t => {
  const seen = []; const { engine, dir } = setup(t, { remoteFetch: async (_, input) => { seen.push(JSON.parse(input.body).messages[0].content); return completion(); } });
  const file = path.join(engine.config.prompt_directory, 'persona.md'); fs.appendFileSync(file, '\n第一个可编辑标记');
  await engine.start(); await engine.command('chat.send', { content: '你好' }); await idle(engine);
  fs.appendFileSync(file, '\n第二个可编辑标记'); await engine.command('chat.send', { content: '再聊一句' }); await idle(engine);
  assert.ok(seen[0].includes('第一个可编辑标记')); assert.ok(!seen[0].includes('第二个可编辑标记')); assert.ok(seen[1].includes('第二个可编辑标记'));
  require('../electron/agent/config.cjs').loadConfig(dir); assert.ok(fs.readFileSync(file, 'utf8').includes('第二个可编辑标记'));
});
test('trace export removes reasoning and credentials recursively without changing the live protocol', () => {
  const { redact } = require('../scripts/trace-utils.cjs');
  const live = { messages: [{ reasoning_content: 'private-source', content: '公开回复' }], headers: { authorization: 'private-key' }, thinking: { type: 'enabled' } };
  const recorded = redact(live); assert.ok(!JSON.stringify(recorded).includes('private-')); assert.equal(live.messages[0].reasoning_content, 'private-source'); assert.equal(recorded.thinking.type, 'enabled'); assert.equal(recorded.messages[0].content, '公开回复');
});
test('on-demand web search submits only keywords, keeps sources and dates, and reuses results within one turn', async () => {
  let n = 0; const signal = new AbortController().signal;
  const web = new WebResearch({ search: async (query, s, options) => {
    n++; assert.equal(query, 'SQLite WAL 官方文档'); assert.equal(s, signal); assert.equal(options.count, 3);
    return { results: [{ title: '官方文档', url: 'https://sqlite.org/wal.html', summary: 'Write-Ahead Logging', date: '2026-10-30' },
      { title: 'bad', url: 'javascript:alert(1)' }, null] };
  } });
  const cache = new Map(); const result = await web.search({ query: ' SQLite WAL 官方文档 ', count: 3 }, signal, cache);
  assert.equal(result.results.length, 1); assert.equal(result.results[0].published_at, '2026-10-30T00:00:00.000Z');
  await web.search({ query: 'SQLite WAL 官方文档', count: 3 }, signal, cache); assert.equal(n, 1);
  await assert.rejects(web.search({ query: ' ' }, signal)); await assert.rejects(web.search({ query: 'x', count: 100 }, signal));
});
test('web reader reads full Unicode text in bounded pages, reuses the page and preserves the source', async () => {
  let n = 0; const signal = new AbortController().signal;
  const web = new WebResearch({ readPage: async (url, s) => { n++; assert.equal(s, signal); return { title: '网页标题', content: '😀'.repeat(550) + '结尾' }; } });
  const cache = new Map(); const first = await web.read({ url: 'https://example.org/page', max_chars: 500 }, signal, cache);
  assert.equal(Array.from(first.content).length, 500); assert.equal(first.next_offset, 500); assert.equal(first.total_characters, 552);
  const last = await web.read({ url: first.url, offset: first.next_offset, max_chars: 500 }, signal, cache);
  assert.equal(last.next_offset, null); assert.ok(last.content.endsWith('结尾')); assert.equal(n, 1);
  assert.throws(() => publicURL('file:///etc/passwd')); assert.throws(() => publicURL('https://user:pass@example.org'));
});
test('web search and fetch use the documented authenticated endpoints without chat context in payload', async () => {
  const requests = []; const provider = new DeepSeek(vault, async (url, input) => {
    requests.push({ url, body: JSON.parse(input.body) });
    return new Response(JSON.stringify(url.endsWith('/search') ? { results: [] } : { title: 'Page', content: 'Text' }));
  }, defaults);
  await provider.search('public keywords', undefined, { count: 2 }); await provider.readPage('https://example.org');
  assert.deepEqual(requests[0], { url: 'https://api.deepseek.com/v1/tools/search', body: { query: 'public keywords', count: 2, need_content: false } });
  assert.deepEqual(requests[1], { url: 'https://api.deepseek.com/v1/tools/fetch', body: { url: 'https://example.org' } });
});
test('real chat tool loop can search and read original web content even when periodic news is fresh', async t => {
  const requests = []; let stage = 0;
  const { engine, events } = setup(t, { remoteFetch: async (url, input) => {
    const b = JSON.parse(input.body); requests.push({ url, b });
    if (url.endsWith('/search')) return new Response(JSON.stringify({ results: [{ title: 'WAL', url: 'https://sqlite.org/wal.html', summary: 'SQLite WAL' }] }));
    if (url.endsWith('/fetch')) return new Response(JSON.stringify({ title: 'WAL', content: 'WAL means Write-Ahead Logging.' }));
    if (!stage++) return completion(null, { tool_calls: [call('web_search', { query: 'SQLite WAL 官方文档' })] }, 'tool_calls');
    if (stage === 2) {
      assert.ok(b.messages.at(-1).content.includes('https://sqlite.org/wal.html'));
      return completion(null, { tool_calls: [call('web_fetch', { url: 'https://sqlite.org/wal.html' })] }, 'tool_calls');
    }
    assert.ok(b.messages.at(-1).content.includes('Write-Ahead Logging')); assert.equal(b.messages[2].reasoning_content, 'PRIVATE REASONING');
    return completion('WAL 是 Write-Ahead Logging，来源：https://sqlite.org/wal.html');
  } });
  engine.store.setMeta('news_success_at', Date.now());
  await engine.start(); await engine.command('chat.send', { content: '查一下 SQLite 官网 WAL 文档' }); await idle(engine);
  assert.ok(requests.some(r => r.url.endsWith('/search'))); assert.ok(requests.some(r => r.url.endsWith('/fetch')));
  assert.equal(events.filter(e => e.type === 'delivered').length, 1); assert.equal(engine.store.factContext().length, 0);
});
test('web failures return useful sanitized errors to the model without falsely claiming success', async t => {
  let stage = 0;
  const { engine } = setup(t, { remoteFetch: async (url, input) => {
    if (url.endsWith('/fetch')) return new Response('secret fake-local-test-key', { status: 403 });
    if (!stage++) return completion(null, { tool_calls: [call('web_fetch', { url: 'https://example.org' })] }, 'tool_calls');
    const result = JSON.parse(JSON.parse(input.body).messages.at(-1).content); assert.ok(result.error); assert.ok(!result.error.includes('secret'));
    return completion('这个网页暂时读取失败，我换个来源再查。');
  } });
  await engine.start(); await engine.command('chat.send', { content: '看一下这个网页' }); await idle(engine);
  assert.match(engine.store.messages().at(-1).content, /读取失败/);
  const log = engine.store.db.prepare("SELECT detail FROM audit WHERE kind='tool'").get(); assert.equal(JSON.parse(log.detail).success, false);
});
test('stopping during a web request cancels the request and prevents a delayed reply', async t => {
  let fetching = false;
  const { engine, events } = setup(t, { remoteFetch: async (url, input) => {
    if (url.endsWith('/search')) {
      fetching = true; await new Promise((_, reject) => input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true }));
    }
    return completion(null, { tool_calls: [call('web_search', { query: '查询测试' })] }, 'tool_calls');
  } });
  await engine.start(); await engine.command('chat.send', { content: '帮我查资料' }); await waitForCondition(() => fetching);
  await engine.command('chat.stop'); assert.equal(events.filter(e => e.type === 'delivered').length, 0); assert.equal(engine.busy, false);
});
test('proactive chat has the same web tools and can use fresh sources on its own', async t => {
  let first = true; const now = 20_000_000;
  const { engine, events } = setup(t, { now: () => now, remoteFetch: async (url, input) => {
    if (url.endsWith('/search')) return new Response(JSON.stringify({ results: [{ title: '新鲜趣闻', url: 'https://example.org/news', summary: '有趣的小消息' }] }));
    const b = JSON.parse(input.body); assert.ok(b.tools.some(t => t.function.name === 'web_search'));
    if (first) { first = false; return completion(null, { tool_calls: [call('web_search', { query: '科学 趣闻' })] }, 'tool_calls'); }
    return completion('刚看到一条有趣的小消息，想拿来逗逗你。');
  } });
  engine.store.addMessage('user', '旧消息', now - 4 * 3600000); await engine.start(); await engine.tick(); await idle(engine);
  assert.ok(events.find(e => e.type === 'delivered')?.autonomous);
});
test('recent history retains the full latest 200 messages regardless of text length', t => {
  const { engine } = setup(t), s = engine.store; const rows = [];
  for (let i = 0; i < 205; i++) rows.push(s.addMessage(i % 2 ? 'assistant' : 'user', `第${i}条\n` + '完整原始内容'.repeat(100) + `结尾${i}`, i + 1));
  const result = s.recent(); assert.equal(result.length, 200);
  assert.deepEqual(result.map(m => m.id), rows.slice(-200).map(m => m.id));
  for (let i = 0; i < result.length; i++) assert.equal(result[i].content, rows[i + 5].content);
  assert.ok(result.reduce((n, m) => n + require('../electron/agent/config.cjs').tokens(m.content), 0) > 32000);
});
test('every request in the chat/tool loop includes the same 200 full original messages without a token budget', async t => {
  const contexts = []; let step = 0;
  const { engine } = setup(t, { settings: { chat_max_messages: 3, chat_input_token_budget: 1 }, remoteFetch: async (_, input) => {
    const b = JSON.parse(input.body); contexts.push(JSON.parse(b.messages[1].content));
    if (step++ === 0) return completion(null, { tool_calls: [call('study_read', { area: 'overview' })] }, 'tool_calls');
    return completion('完整历史已收到。');
  } });
  const rows = []; for (let i = 0; i < 205; i++) rows.push(engine.store.addMessage(i % 2 ? 'assistant' : 'user', `历史${i}：` + '不能截断的文字'.repeat(100), i + 1));
  await engine.start(); await engine.command('chat.send', { content: '当前这一条也应计入200条。' }); await idle(engine);
  assert.equal(contexts.length, 2);
  assert.deepEqual(contexts[0].dialogue, contexts[1].dialogue);
  for (const c of contexts) {
    assert.equal(c.dialogue.length, 200); assert.equal(c.dialogue_meta.count, 200); assert.equal(c.dialogue_meta.token_budget_applied, false);
    assert.equal(c.dialogue[0].id, rows[6].id); assert.equal(c.dialogue[0].content, rows[6].content);
    assert.equal(c.dialogue.at(-1).content, '当前这一条也应计入200条。');
  }
});
test('fewer than 200 messages are all included; obsolete saved limits cannot reduce the window', async t => {
  const { engine, dir, wire } = setup(t);
  engine.store.addMessage('user', '第一条', 1); engine.store.addMessage('assistant', '第二条', 2);
  await engine.start(); await engine.command('chat.send', { content: '第三条' }); await idle(engine);
  assert.equal(JSON.parse(wire[0].request.messages[1].content).dialogue.length, 3);
  const file = path.join(dir, 'dafeyu-config.json'); const saved = JSON.parse(fs.readFileSync(file));
  saved.chat_max_messages = 1; saved.chat_input_token_budget = 10; fs.writeFileSync(file, JSON.stringify(saved));
  const loaded = require('../electron/agent/config.cjs').loadConfig(dir).config;
  assert.equal(loaded.chat_max_messages, 200); assert.equal(loaded.chat_input_token_budget, undefined);
});
test('proactive replies also carry all latest 200 messages', async t => {
  const now = 20_000_000, seen = [];
  const { engine } = setup(t, { now: () => now, remoteFetch: async (_, input) => { seen.push(JSON.parse(JSON.parse(input.body).messages[1].content)); return completion('来和你说句话。'); } });
  for (let i = 0; i < 205; i++) engine.store.addMessage(i % 2 ? 'assistant' : 'user', '历史' + i, now - 4 * 3600000 + i);
  await engine.start(); await engine.tick(); await idle(engine);
  assert.equal(seen[0].dialogue.length, 200); assert.equal(seen[0].dialogue[0].content, '历史5'); assert.equal(seen[0].dialogue.at(-1).content, '历史204');
});
test('provider context overflow reports failure instead of silently shortening the 200-message history', async () => {
  const provider = new DeepSeek(vault, async () => new Response(JSON.stringify({ error: { code: 'context_length_exceeded', message: 'private-input maximum context length exceeded' } }), { status: 400 }), defaults);
  await assert.rejects(provider.complete([{ role: 'user', content: 'x' }]), e => e.status === 400 && e.message.includes('未删减') && !e.message.includes('private-input'));
});
