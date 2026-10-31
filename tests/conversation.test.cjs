const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AgentStore } = require('../electron/agent/store.cjs');
const { DafeyuEngine } = require('../electron/dafeyu-engine.cjs');
const { ContactPlans } = require('../electron/agent/contact-plans.cjs');
const { Unsaid } = require('../electron/agent/unsaid.cjs');
const { Imagination } = require('../electron/agent/imagination.cjs');
const { replyDelay } = require('../electron/agent/delivery.cjs');
const { defaults } = require('../electron/agent/config.cjs');
const { waitForCondition } = require('./helpers.cjs');
const vault = { get: () => 'synthetic-local-credential', status: () => ({ configured: true, storage: 'session', error: '' }) };
const completion = (content = '一会儿再聊这个小故事。', calls) => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content, reasoning_content: 'PRIVATE_REASONING', ...(calls ? { tool_calls: calls } : {}) }, finish_reason: calls ? 'tool_calls' : 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
const call = (name, args) => ({ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const idle = e => waitForCondition(() => !e.draining && !e.active && !e.queue.length, 5000);
function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-test-')), events = [], engines = [];
  let at = 100_000_000;
  const make = overrides => {
    const engine = new DafeyuEngine(dir, vault, { now: () => at, random: () => 0.5,
      emit: e => events.push(e), presence: () => ({ available: true, focus: false }),
      studySnapshot: () => ({ todos: [], notes: [], timer: { status: 'idle' }, learning: {} }), remoteFetch: async () => completion(),
      ...options, ...overrides, settings: { reply_delay_probability: 0, fantasy_probability: 0, life_enabled: false, ...options.settings, ...overrides?.settings } });
    engines.push(engine); return engine;
  };
  const engine = make();
  t.after(async () => { for (const e of engines) if (!e.closed) { await e.stop(); e.close(); } fs.rmSync(dir, { recursive: true, force: true }); });
  return { engine, dir, events, make, now: () => at, advance: ms => { at += ms; } };
}
const planOp = (key = 'story', extra = {}) => ({ action: 'upsert', key, intent: '到时候分享一个虚构的小故事', after_minutes: 1, ...extra });
const installPlan = (e, op = planOp()) => { e.plans.commit(e.plans.plan([op])); return e.plans.read().items[0]; };
function gate() {
  let release;
  const promise = new Promise(r => { release = r; });
  return { release, wait: (ms, signal) => new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    promise.then(() => { signal.removeEventListener('abort', abort); resolve(); });
  }) };
}

test('unsaid uses stable keys, supports read/edit/remove and persists independently of facts and messages', t => {
  const { engine, dir } = setup(t), u = engine.unsaid;
  u.commit(u.plan([{ action: 'upsert', key: 'cloud', text: '下次想讲一朵云的小故事。' }]));
  u.commit(u.plan([{ action: 'upsert', key: 'cloud', text: '改成一朵迷路的云。' }], undefined));
  assert.equal(u.summary().count, 1); assert.equal(u.read().items[0].text, '改成一朵迷路的云。');
  assert.equal(engine.store.messages().length, 0); assert.equal(engine.store.factContext().length, 0);
  const second = new AgentStore(dir); assert.equal(new Unsaid(second).read().items.length, 1); second.close();
  assert.throws(() => u.plan([{ action: 'upsert', key: 'bad', text: '分析步骤：隐藏的推理' }]));
  const stale = u.plan([{ action: 'remove', key: 'cloud' }]); u.commit(u.plan([{ action: 'upsert', key: 'second', text: '另一个片段' }]));
  assert.throws(() => u.commit(stale));
  u.commit(u.plan([{ action: 'remove', key: 'cloud' }])); assert.equal(u.read().items[0].key, 'second');
});
test('unsaid remains opt-in: initial context contains counts, tools read and edit prospective state, UI never gets draft text', async t => {
  let step = 0; const seen = [];
  const { engine } = setup(t, { remoteFetch: async (_, input) => {
    const b = JSON.parse(input.body); seen.push(b);
    if (step++ === 0) {
      const c = JSON.parse(b.messages[1].content); assert.equal(c.unsaid_available.count, 1); assert.ok(!b.messages[1].content.includes('SYNTHETIC_PRIVATE_DRAFT'));
      return completion(null, [call('unsaid_read', {}), call('unsaid_update', { operations: [{ action: 'upsert', key: 'draft', text: '新的角色待说片段' }] })]);
    }
    assert.ok(b.messages.find(m => m.role === 'tool' && m.tool_call_id === 'unsaid_read').content.includes('SYNTHETIC_PRIVATE_DRAFT'));
    return completion('今天先和你聊聊云。');
  } });
  engine.unsaid.commit(engine.unsaid.plan([{ action: 'upsert', key: 'draft', text: 'SYNTHETIC_PRIVATE_DRAFT' }]));
  await engine.start(); await engine.command('chat.send', { content: '嗨' }); await idle(engine);
  assert.equal(engine.unsaid.read().items[0].text, '新的角色待说片段');
  assert.ok(!JSON.stringify(engine.state()).includes('新的角色待说片段')); assert.ok(!JSON.stringify(engine.state()).includes('PRIVATE_REASONING'));
});
test('failed final reply rolls back unsaid edits and contact plans together', async t => {
  let step = 0;
  const { engine } = setup(t, { remoteFetch: async () => step++ === 0 ? completion(null, [call('unsaid_update', { operations: [{ action: 'upsert', key: 'x', text: '先不说的内容' }] }), call('contact_plan_update', { operations: [planOp()] })]) : completion('分析步骤：无效正文') });
  await engine.start(); await engine.command('chat.send', { content: '嗨' }); await idle(engine);
  assert.equal(engine.unsaid.summary().count, 0); assert.equal(engine.plans.summary().active_count, 0); assert.equal(engine.outbox.pending().length, 0);
});
test('fantasy RNG can skip the provider entirely and needs no temporary motive', async t => {
  const { engine } = setup(t); let calls = 0;
  const i = new Imagination(engine.store, { object: async () => { calls++; return { fantasy: '漂浮的虚构小岛', motive: 'unused legacy value' }; } }, { ...defaults, fantasy_probability: 0.25 }, () => 0.9);
  assert.equal(await i.sample({}), null); assert.equal(calls, 0);
  i.random = () => 0;
  const r = await i.sample({}); assert.equal(calls, 1); assert.equal(r.motive, undefined); assert.equal(r.fantasy, '漂浮的虚构小岛');
  assert.equal(engine.store.factContext().length, 0);
});
test('fantasy provider failures do not prevent an ordinary reply', async t => {
  const { engine, events } = setup(t, { settings: { fantasy_probability: 1 }, remoteFetch: async (_, input) => {
    const b = JSON.parse(input.body); if (b.response_format) throw new Error('synthetic unavailable');
    assert.equal(JSON.parse(b.messages[1].content).imagination, null); return completion('普通回复仍然有效。');
  } });
  await engine.start(); await engine.command('chat.send', { content: '你好' }); await idle(engine);
  assert.equal(events.filter(e => e.type === 'delivered').length, 1); assert.equal(engine.error, '');
});
test('reply delay has a normal-send branch and a bounded slower branch', () => {
  assert.equal(replyDelay(defaults, () => 0.99), 0);
  assert.equal(replyDelay(defaults, () => 0), 15000);
  let n = 0; assert.equal(replyDelay(defaults, () => n++ ? 1 : 0), 180000);
});
test('delayed replies are invisible until their due time, with no minutes-long typing indicator state', async t => {
  const g = gate(); const c = setup(t, { settings: { reply_delay_probability: 1, reply_delay_min_ms: 120000, reply_delay_max_ms: 120000 }, wait: g.wait });
  const { engine, events } = c;
  await engine.start(); await engine.command('chat.send', { content: '慢慢说' });
  await waitForCondition(() => engine.state().waiting);
  assert.equal(engine.store.messages().filter(m => m.role === 'assistant').length, 0); assert.equal(events.filter(e => e.type === 'delivered').length, 0);
  assert.equal(engine.outbox.pending()[0].due_at, c.now() + 120000);
  c.advance(120000); g.release(); await idle(engine);
  assert.equal(events.filter(e => e.type === 'delivered').length, 1); assert.equal(engine.outbox.pending().length, 0);
  assert.equal(engine.state().waiting, false);
});
test('a new user message cancels a waiting stale draft and its effects, then replies using current dialogue', async t => {
  const g = gate(); let step = 0; const contexts = [];
  const c = setup(t, { settings: { reply_delay_probability: 1, reply_delay_min_ms: 60000, reply_delay_max_ms: 60000 }, wait: g.wait, remoteFetch: async (_, input) => {
    const b = JSON.parse(input.body); contexts.push(JSON.parse(b.messages[1].content));
    if (step++ === 0) return completion(null, [call('unsaid_update', { operations: [{ action: 'upsert', key: 'stale', text: '不应保存的旧片段' }] })]);
    return completion(step === 2 ? '过时的回复' : '回应新话题');
  } });
  const { engine, events } = c; await engine.start(); await engine.command('chat.send', { content: '旧话题' });
  await waitForCondition(() => engine.state().waiting);
  engine.config.reply_delay_probability = 0;
  await engine.command('chat.send', { content: '改聊新话题' }); await idle(engine);
  const delivered = events.filter(e => e.type === 'delivered'); assert.equal(delivered.length, 1); assert.equal(delivered[0].content, '回应新话题');
  assert.equal(engine.unsaid.summary().count, 0); assert.equal(contexts.at(-1).dialogue.at(-1).content, '改聊新话题');
});
test('manual pause cancels a waiting reply without committing effects or late delivery', async t => {
  const g = gate(); const { engine, events } = setup(t, { settings: { reply_delay_probability: 1, reply_delay_min_ms: 60000, reply_delay_max_ms: 60000 }, wait: g.wait });
  await engine.start(); await engine.command('chat.send', { content: '先等一下' }); await waitForCondition(() => engine.state().waiting);
  await engine.command('chat.stop'); g.release();
  assert.equal(engine.outbox.pending().length, 0); assert.equal(events.filter(e => e.type === 'delivered').length, 0); assert.equal(engine.busy, false);
});
test('clean shutdown preserves pending delivery, restart sends once without another model call', async t => {
  const g = gate(); const c = setup(t, { settings: { reply_delay_probability: 1, reply_delay_min_ms: 120000, reply_delay_max_ms: 120000 }, wait: g.wait });
  const first = c.engine; await first.start(); await first.command('chat.send', { content: '等一会儿回复' }); await waitForCondition(() => first.state().waiting);
  const id = first.outbox.pending()[0].id;
  await first.stop({ preservePending: true }); first.close(); c.advance(120000);
  const second = c.make({ remoteFetch: async () => { throw new Error('must not regenerate'); } });
  await second.start(); await idle(second);
  assert.equal(second.outbox.get(id).status, 'sent'); assert.equal(second.store.messages().filter(m => m.role === 'assistant').length, 1);
  await second.stop({ preservePending: true }); second.close();
  const third = c.make(); await third.start(); await idle(third); assert.equal(third.store.messages().filter(m => m.role === 'assistant').length, 1);
});
test('overdue drafts expire on restart and never become chat history', async t => {
  const g = gate(); const c = setup(t, { settings: { reply_delay_probability: 1, reply_delay_min_ms: 60000, reply_delay_max_ms: 60000, delivery_max_age_ms: 120000 }, wait: g.wait });
  await c.engine.start(); await c.engine.command('chat.send', { content: '稍后再说' }); await waitForCondition(() => c.engine.state().waiting);
  await c.engine.stop({ preservePending: true }); c.engine.close(); c.advance(180000);
  const second = c.make(); await second.start(); await idle(second);
  assert.equal(second.outbox.pending().length, 0); assert.equal(second.store.messages().filter(m => m.role === 'assistant').length, 0);
});
test('contact plans validate dates and bounds, reuse active keys, cancel and survive reopening', t => {
  const c = setup(t), p = c.engine.plans;
  installPlan(c.engine); p.commit(p.plan([planOp('story', { after_minutes: 2 })]));
  assert.equal(p.summary().active_count, 1); assert.equal(p.read().items[0].due_at, c.now() + 120000);
  for (const op of [planOp('x', { after_minutes: 0 }), planOp('x', { after_minutes: 10081 }), planOp('x', { after_minutes: undefined, due_at: '2026-10-31T12:00:00' }), planOp('x', { expire_after_minutes: 0 })]) assert.throws(() => p.plan([op]));
  const second = new AgentStore(c.dir); assert.equal(new ContactPlans(second, defaults, c.now).summary().active_count, 1); second.close();
  p.commit(p.plan([{ action: 'cancel', key: 'story' }])); assert.equal(p.summary().active_count, 0);
});
test('successful dialogue atomically saves a plan and an unsaid fragment', async t => {
  let step = 0;
  const { engine } = setup(t, { remoteFetch: async () => step++ ? completion('到时有空再聊。') : completion(null, [call('contact_plan_update', { operations: [planOp()] }), call('unsaid_update', { operations: [{ action: 'upsert', key: 'wish', text: '留一个小故事等下次再讲' }] })]) });
  await engine.start(); await engine.command('chat.send', { content: '晚点见' }); await idle(engine);
  assert.equal(engine.plans.summary().active_count, 1); assert.equal(engine.unsaid.summary().count, 1);
});
test('a due plan generates with fresh dialogue and sends exactly once, independently of random proactive chance', async t => {
  let context;
  const c = setup(t, { settings: { contact_plan_min_gap_ms: 0 }, remoteFetch: async (_, input) => { context = JSON.parse(JSON.parse(input.body).messages[1].content); return completion('现在有个小故事。'); } });
  installPlan(c.engine); c.engine.store.addMessage('user', '这是最近的新消息', c.now()); c.advance(60000);
  await c.engine.start(); await c.engine.tick(); await idle(c.engine);
  assert.equal(context.trigger, 'planned'); assert.equal(context.dialogue.at(-1).content, '这是最近的新消息'); assert.ok(context.scheduled_contact.intent);
  assert.equal(c.events.filter(e => e.type === 'delivered').length, 1); assert.equal(c.engine.plans.summary().active_count, 0);
  await c.engine.tick(); await idle(c.engine); assert.equal(c.events.filter(e => e.type === 'delivered').length, 1);
});
test('focus, lock/unavailability, typing and manual pause defer plans, then availability resumes them', async t => {
  let presence = { available: true, focus: true };
  const c = setup(t, { presence: () => presence, settings: { contact_plan_min_gap_ms: 0 } });
  installPlan(c.engine); c.advance(60000); await c.engine.start();
  for (const p of [{ available: true, focus: true }, { available: false, focus: false }]) { presence = p; await c.engine.tick(); await idle(c.engine); assert.equal(c.events.filter(e => e.type === 'delivered').length, 0); }
  presence = { available: true, focus: false }; c.engine.typingUntil = c.now() + 1000; await c.engine.tick(); await idle(c.engine);
  c.advance(1000); c.engine.manualPause = true; await c.engine.tick(); assert.equal(c.events.filter(e => e.type === 'delivered').length, 0);
  c.engine.manualPause = false; await c.engine.tick(); await idle(c.engine); assert.equal(c.events.filter(e => e.type === 'delivered').length, 1);
});
test('due plan can silently skip or reschedule without a final model message, and may retain an unsaid fragment', async t => {
  const c = setup(t, { settings: { contact_plan_min_gap_ms: 0 }, remoteFetch: async () => completion(null, [
    call('unsaid_update', { operations: [{ action: 'upsert', key: 'later', text: '这个故事换个时候讲' }] }),
    call('contact_plan_decide', { action: 'reschedule', after_minutes: 10 }),
  ]) });
  const p = installPlan(c.engine); c.advance(60000); await c.engine.start(); await c.engine.tick(); await idle(c.engine);
  assert.equal(c.events.filter(e => e.type === 'delivered').length, 0); assert.equal(c.engine.plans.get(p.id).due_at, c.now() + 600000); assert.equal(c.engine.unsaid.summary().count, 1);
  c.engine.provider.fetch = async () => completion(null, [call('contact_plan_decide', { action: 'skip' })]);
  c.advance(600000); await c.engine.tick(); await idle(c.engine);
  assert.equal(c.engine.plans.get(p.id).status, 'cancelled'); assert.equal(c.events.filter(e => e.type === 'delivered').length, 0);
});
test('plan failures retry after cooldown, without duplicates or consuming the plan', async t => {
  let broken = true;
  const c = setup(t, { settings: { contact_plan_min_gap_ms: 0 }, remoteFetch: async () => broken ? completion('分析步骤：坏正文') : completion('重试后的有效消息') });
  const p = installPlan(c.engine); c.advance(60000); await c.engine.start(); await c.engine.tick(); await idle(c.engine);
  assert.equal(c.engine.plans.get(p.id).status, 'scheduled'); assert.equal(c.engine.plans.due(), null);
  c.advance(300000); broken = false; await c.engine.tick(); await idle(c.engine); assert.equal(c.engine.plans.get(p.id).status, 'completed');
  assert.equal(c.events.filter(e => e.type === 'delivered').length, 1);
});
test('missed plans expire after their grace window rather than bursting after a long offline period', async t => {
  const c = setup(t, { settings: { contact_plan_min_gap_ms: 0 } }); const p = installPlan(c.engine, planOp('old', { expire_after_minutes: 2 }));
  await c.engine.stop({ preservePending: true }); c.engine.close(); c.advance(4 * 60000);
  const second = c.make(); await second.start(); assert.equal(second.plans.due(), null); assert.equal(second.plans.get(p.id).status, 'expired');
  assert.equal(c.events.filter(e => e.type === 'delivered').length, 0);
});
test('crashed running plans recover and pending drafts and plan intent are included only in full local exports', t => {
  const c = setup(t, { settings: { contact_plan_min_gap_ms: 0 } }); const p = installPlan(c.engine); c.advance(60000); c.engine.plans.claim(p.id); c.engine.close();
  const second = c.make(); assert.equal(second.plans.get(p.id).status, 'scheduled');
  const data = second.store.exportData(); assert.equal(data.schema, 2); assert.ok(Array.isArray(data.delivery_outbox)); assert.ok(data.metadata.find(m => m.key === 'contact_plans'));
  assert.ok(!JSON.stringify(second.state()).includes(p.intent));
});

test('new input arriving during generation does not wait behind an obsolete delayed reply', async t => {
  let release; let generation = 0, sleeps = 0;
  const blocked = new Promise(r => { release = r; });
  const c = setup(t, { settings: { reply_delay_probability: 1, reply_delay_min_ms: 60000, reply_delay_max_ms: 60000 },
    wait: async ms => { sleeps++; c.advance(ms); }, remoteFetch: async () => { if (!generation++) await blocked; return completion('回复' + generation); } });
  await c.engine.start(); await c.engine.command('chat.send', { content: '第一件事' }); await waitForCondition(() => c.engine.active);
  await c.engine.command('chat.send', { content: '改聊第二件事' }); release(); await idle(c.engine);
  assert.equal(sleeps, 1); assert.equal(c.events.filter(e => e.type === 'delivered').length, 1);
});
test('due plans are still suppressed when a new user message arrives during their generation', async t => {
  let release;
  const blocked = new Promise(r => { release = r; }); let n = 0;
  const c = setup(t, { settings: { contact_plan_min_gap_ms: 0 }, remoteFetch: async () => { if (!n++) await blocked; return completion(n === 1 ? '不该发出的计划消息' : '回应新消息'); } });
  const p = installPlan(c.engine); c.advance(60000); await c.engine.start(); await c.engine.tick(); await waitForCondition(() => c.engine.active?.kind === 'planned');
  await c.engine.command('chat.send', { content: '我现在来聊天' }); release(); await idle(c.engine);
  assert.equal(c.events.filter(e => e.type === 'delivered' && e.autonomous).length, 0); assert.equal(c.engine.plans.get(p.id).status, 'scheduled');
});
test('an interrupted queued plan is released even if no generation has started', async t => {
  const c = setup(t); const p = installPlan(c.engine); c.advance(60000); await c.engine.start();
  const claimed = c.engine.plans.claim(p.id);
  // Hold the drain until chat.send has replaced the queued autonomous task.
  c.engine.draining = Promise.resolve(); c.engine.enqueue({ kind: 'planned', plan: claimed, baseline: 0 });
  await c.engine.command('chat.send', { content: '先和我聊' });
  c.engine.draining = null; c.engine.enqueueDrain(); await idle(c.engine);
  assert.equal(c.engine.plans.get(p.id).status, 'scheduled');
});
test('upgrading a pre-outbox database preserves synthetic messages, facts and relationship prose', t => {
  const c = setup(t), s = c.engine.store;
  s.addMessage('user', '合成的旧消息', c.now()); s.commitFacts([{ key: 'synthetic', text: '合成事实', evidence: [] }], c.now());
  const before = { messages: s.messages(), facts: s.factContext(), prose: s.relationship() };
  s.db.exec('DROP TABLE delivery_outbox'); c.engine.close();
  const second = c.make();
  assert.deepEqual(second.store.messages(), before.messages); assert.deepEqual(second.store.factContext(), before.facts); assert.deepEqual(second.store.relationship(), before.prose);
  assert.equal(second.outbox.pending().length, 0);
});
test('delayed tool effects commit once after restart, never before delivery', async t => {
  const g = gate(); let step = 0;
  const c = setup(t, { settings: { reply_delay_probability: 1, reply_delay_min_ms: 60000, reply_delay_max_ms: 60000 }, wait: g.wait,
    remoteFetch: async () => step++ ? completion('这次发送后才保存') : completion(null, [call('unsaid_update', { operations: [{ action: 'upsert', key: 'persisted', text: '成功发送后保留的待说片段' }] })]) });
  await c.engine.start(); await c.engine.command('chat.send', { content: '稍后' }); await waitForCondition(() => c.engine.state().waiting);
  assert.equal(c.engine.unsaid.summary().count, 0);
  await c.engine.stop({ preservePending: true }); c.engine.close(); c.advance(60000);
  const second = c.make(); await second.start(); await idle(second);
  assert.equal(second.unsaid.summary().count, 1); assert.equal(second.unsaid.state().revision, 1);
  await second.stop({ preservePending: true }); second.close(); const third = c.make(); await third.start(); await idle(third); assert.equal(third.unsaid.state().revision, 1);
});
