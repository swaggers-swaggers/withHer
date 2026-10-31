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
const { parseReplyPlan } = require('../electron/agent/reply-plan.cjs');
const { defaults } = require('../electron/agent/config.cjs');
const { waitForCondition } = require('./helpers.cjs');
const vault = { get: () => 'synthetic-local-credential', status: () => ({ configured: true, storage: 'session', error: '' }) };
const send = (...bubbles) => ({ decision: 'send', bubbles: bubbles.map(b => typeof b === 'string' ? { text: b, after_ms: 0 } : b) });
const completion = (plan = send('合成的回复'), calls) => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: calls ? null : JSON.stringify(plan), reasoning_content: 'PRIVATE_REASONING', ...(calls ? { tool_calls: calls } : {}) }, finish_reason: calls ? 'tool_calls' : 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
const call = (name, args) => ({ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const drained = e => waitForCondition(() => !e.draining && !e.active && !e.queue.length, 5000);
const settled = e => waitForCondition(() => !e.draining && !e.active && !e.queue.length && !e.outbox.hasPending(), 5000);
function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-contract-test-')), events = [], engines = [];
  let at = 100_000_000;
  const make = overrides => {
    const engine = new DafeyuEngine(dir, vault, { now: () => at, random: () => .5, emit: e => events.push(e),
      presence: () => ({ available: true, focus: false }), studySnapshot: () => ({ todos: [], notes: [], timer: { status: 'idle' }, learning: {} }),
      remoteFetch: async () => completion(), ...options, ...overrides,
      settings: { fantasy_probability: 0, life_enabled: false, tick_ms: 3600000, ...options.settings, ...overrides?.settings } });
    engines.push(engine); return engine;
  };
  const engine = make();
  t.after(async () => { for (const e of engines) if (!e.closed) { await e.stop(); e.close(); } fs.rmSync(dir, { recursive: true, force: true }); });
  return { engine, dir, events, make, now: () => at, advance: ms => { at += ms; } };
}
const planOp = (key = 'story', extra = {}) => ({ action: 'upsert', key, intent: '到时候分享一个合成的小故事', after_minutes: 1, ...extra });
const installPlan = (e, op = planOp()) => { e.plans.commit(e.plans.plan([op])); return e.plans.read().items[0]; };
const assistant = e => e.store.messages().filter(m => m.role === 'assistant');
async function turn(c, text = '合成输入') { await c.engine.start(); await c.engine.command('chat.send', { content: text }); await drained(c.engine); }
async function step(c, ms) { c.advance(ms); await c.engine.tick(); await drained(c.engine); }

test('the model chooses silence, one bubble or many, without a text/random fallback', () => {
  assert.deepEqual(parseReplyPlan(JSON.stringify({ decision: 'silent', bubbles: [] }), defaults), { decision: 'silent', bubbles: [] });
  assert.equal(parseReplyPlan(JSON.stringify(send('整句放在同一气泡')), defaults).bubbles.length, 1);
  const many = Array.from({ length: 20 }, (_, i) => ({ text: `兴奋的第${i}句！`, after_ms: i ? 10 : 0 }));
  assert.equal(parseReplyPlan(JSON.stringify(send(...many)), defaults).bubbles.length, 20);
  for (const raw of ['普通正文', '```json\n{}\n```', JSON.stringify({ reply: '旧协议' })]) assert.throws(() => parseReplyPlan(raw, defaults));
});
test('model-selected newlines and punctuation stay in one bubble; code indentation survives', () => {
  const p = parseReplyPlan(JSON.stringify(send({ text: '先说一句。\n还有一段！', after_ms: 0 }, { text: '  x = 1\n  print(x)', kind: 'code', after_ms: 300 })), defaults);
  assert.equal(p.bubbles[0].text, '先说一句。\n还有一段！'); assert.equal(p.bubbles[1].text, '  x = 1\n  print(x)');
});
test('every later bubble needs an explicit positive interval; invalid decisions or hidden analysis never display', () => {
  for (const p of [send({ text: 'a', after_ms: 0 }, { text: 'b', after_ms: 0 }), send({ text: 'a', after_ms: -1 }), send({ text: 'a', after_ms: 1.5 }),
    { decision: 'silent', bubbles: [{ text: '不能假装沉默', after_ms: 0 }] }, send({ text: '分析步骤：不可显示', after_ms: 0 }),
    { decision: 'send', bubbles: [{ text: 'a', after_ms: 0 }], analysis: 'hidden' }]) assert.throws(() => parseReplyPlan(JSON.stringify(p), defaults));
  assert.throws(() => parseReplyPlan(JSON.stringify(send(...Array.from({ length: 65 }, () => ({ text: 'x', after_ms: 1 })))), defaults));
  assert.throws(() => parseReplyPlan(JSON.stringify(send({ text: 'x', after_ms: 86400001 })), defaults));
});
test('bubbles enter storage and visible state one by one at exactly the model-selected intervals', async t => {
  const c = setup(t, { remoteFetch: async () => completion(send({ text: '第一条\n仍是一个气泡。', after_ms: 1000 }, { text: '第二条', after_ms: 4000 }, { text: '第三条', after_ms: 15000 })) });
  await turn(c); assert.equal(c.engine.busy, false); assert.equal(c.engine.state().waiting, true); assert.equal(assistant(c.engine).length, 0);
  await step(c, 999); assert.equal(assistant(c.engine).length, 0);
  await step(c, 1); assert.equal(assistant(c.engine).length, 1); assert.deepEqual(assistant(c.engine)[0].displayParts, ['第一条\n仍是一个气泡。']);
  await step(c, 3999); assert.equal(assistant(c.engine).length, 1);
  await step(c, 1); assert.equal(assistant(c.engine).length, 2);
  await step(c, 15000); assert.equal(assistant(c.engine).length, 3);
  const times = assistant(c.engine).map(m => m.created_at); assert.equal(times[1]-times[0], 4000); assert.equal(times[2]-times[1], 15000);
  assert.equal(c.events.filter(e => e.type === 'delivered').length, 3); assert.equal(c.engine.state().waiting, false);
});
test('a rapid burst is permitted and is never replaced with a fixed count or fixed 15-second wait', async t => {
  const c = setup(t, { remoteFetch: async () => completion(send(...Array.from({ length: 12 }, (_, i) => ({ text: `连发${i}`, after_ms: i ? 25 : 0 })))) });
  await turn(c); await step(c, 0);
  for (let i=1;i<12;i++) await step(c, 25);
  assert.equal(assistant(c.engine).length, 12); assert.equal(assistant(c.engine)[11].created_at-assistant(c.engine)[0].created_at, 275);
});
test('a long single model bubble is not split at newlines or character thresholds', async t => {
  const text = '同一条长气泡。\n'.repeat(300);
  const c = setup(t, { remoteFetch: async () => completion(send({ text, after_ms: 0 })) }); await turn(c); await settled(c.engine);
  assert.equal(assistant(c.engine).length, 1); assert.deepEqual(assistant(c.engine)[0].displayParts, [text]);
});
test('silence is a successful choice, stores internal unsaid intentions, and inserts no fake/empty assistant message', async t => {
  let n=0;
  const c=setup(t,{remoteFetch:async()=>n++?completion({decision:'silent',bubbles:[],resume_after_ms:600000}):completion(null,[call('unsaid_update',{operations:[{action:'upsert',key:'quiet',text:'这会儿想安静，晚点再说。'}]})])});
  await turn(c); await settled(c.engine); assert.equal(assistant(c.engine).length,0); assert.equal(c.engine.error,'');
  assert.equal(c.engine.store.messages()[0].status,'complete'); assert.equal(c.engine.unsaid.summary().count,1); assert.equal(c.engine.store.meta('response_quiet_until'),c.now()+600000);
  assert.ok(!JSON.stringify(c.engine.state()).includes('这会儿想安静'));
});
test('model-selected quiet time suppresses autonomous triggers and new user input reopens the decision', async t=>{
  const c=setup(t,{remoteFetch:async()=>completion({decision:'silent',bubbles:[],resume_after_ms:600000})});
  await turn(c); const p=installPlan(c.engine); await step(c,60000); assert.equal(c.engine.plans.get(p.id).status,'scheduled');
  c.engine.provider.fetch=async()=>completion(send('现在想说一句。'));
  await c.engine.command('chat.send',{content:'新话题'}); await settled(c.engine); assert.equal(c.engine.store.meta('response_quiet_until'),0);assert.equal(assistant(c.engine).length,1);
});
test('a model-selected multi-minute first wait is honored without holding the generation queue',async t=>{
  const c=setup(t,{remoteFetch:async()=>completion(send({text:'晚点才发的第一句',after_ms:180000}))});
  await turn(c); assert.equal(c.engine.active,null);assert.equal(c.engine.busy,false);
  await step(c,179999);assert.equal(assistant(c.engine).length,0);await step(c,1);assert.equal(assistant(c.engine).length,1);
});
test('new user input keeps already sent bubbles, cancels the unseen tail, and replans from actual history',async t=>{
  let n=0;const seen=[];
  const c=setup(t,{remoteFetch:async(_,input)=>{const context=JSON.parse(JSON.parse(input.body).messages[1].content);seen.push(context);return completion(n++?send('接住你的新话题'):send({text:'已经说出的半句',after_ms:0},{text:'不该补发的旧尾巴',after_ms:60000}));}});
  await turn(c,'旧话题');await step(c,0);assert.equal(assistant(c.engine).length,1);
  await c.engine.command('chat.send',{content:'换个话题'});await settled(c.engine);
  assert.deepEqual(assistant(c.engine).map(m=>m.content),['已经说出的半句','接住你的新话题']);
  assert.ok(seen.at(-1).dialogue.some(m=>m.content==='已经说出的半句'));assert.ok(!JSON.stringify(seen.at(-1).dialogue).includes('不该补发的旧尾巴'));
  await step(c,60000);assert.equal(assistant(c.engine).length,2);
});
test('manual pause cancels future bubbles without retracting the sent prefix',async t=>{
  const c=setup(t,{remoteFetch:async()=>completion(send({text:'前一条',after_ms:0},{text:'取消的后一条',after_ms:60000}))});await turn(c);await step(c,0);
  await c.engine.command('chat.stop');await step(c,60000);assert.deepEqual(assistant(c.engine).map(m=>m.content),['前一条']);assert.equal(c.engine.outbox.hasPending(),false);
});
test('restart resumes only unsent bubbles, once each, and does not generate again',async t=>{
  const c=setup(t,{remoteFetch:async()=>completion(send({text:'重启前',after_ms:0},{text:'重启后',after_ms:60000},{text:'再隔一会儿',after_ms:7000}))});await turn(c);await step(c,0);
  const id=c.engine.outbox.pending()[0].id;await c.engine.stop({preservePending:true});c.engine.close();c.advance(60000);
  const second=c.make({remoteFetch:async()=>{throw Error('must not regenerate');}});await second.start();await second.tick();await drained(second);
  assert.deepEqual(assistant(second).map(m=>m.content),['重启前','重启后']);c.advance(7000);await second.tick();await drained(second);
  assert.equal(assistant(second).length,3);assert.equal(second.outbox.get(id).status,'sent');
  await second.stop({preservePending:true});second.close();const third=c.make();await third.start();await settled(third);assert.equal(assistant(third).length,3);
});
test('late restart preserves the model-selected inter-bubble gap instead of dumping an overdue burst',async t=>{
  const c=setup(t,{remoteFetch:async()=>completion(send({text:'一',after_ms:1000},{text:'二',after_ms:5000},{text:'三',after_ms:7000}))});await turn(c);
  await c.engine.stop({preservePending:true});c.engine.close();c.advance(60000);const second=c.make();await second.start();await second.tick();await drained(second);
  assert.equal(assistant(second).length,1);await second.tick();await drained(second);assert.equal(assistant(second).length,1);
  c.advance(5000);await second.tick();await drained(second);assert.equal(assistant(second).length,2);
});
test('a crash after a bubble receipt commits cannot replay it after reopening',async t=>{
  const c=setup(t,{remoteFetch:async()=>completion(send({text:'持久化的第一条',after_ms:0},{text:'下一条',after_ms:1000}))});await turn(c);await step(c,0);c.engine.close();
  const second=c.make();await second.start();c.advance(1000);await second.tick();await drained(second);assert.equal(assistant(second).length,2);
  const rows=second.outbox.bubbles(second.store.db.prepare('SELECT id FROM delivery_outbox').get().id);assert.equal(new Set(rows.map(r=>r.message_id)).size,2);
});
test('expired pending replies cancel, retaining already sent messages only',async t=>{
  const c=setup(t,{settings:{delivery_max_age_ms:10,delivery_send_grace_ms:10},remoteFetch:async()=>completion(send({text:'只保存这一句',after_ms:0},{text:'已经过期的尾巴',after_ms:1000}))});await turn(c);await step(c,0);
  await c.engine.stop({preservePending:true});c.engine.close();c.advance(2000);const second=c.make();await second.start();await second.tick();await drained(second);
  assert.deepEqual(assistant(second).map(m=>m.content),['只保存这一句']);assert.equal(second.outbox.hasPending(),false);
});
test('legacy whole-reply outbox entries cancel on upgrade without changing historical messages',t=>{
  const c=setup(t);c.engine.store.addMessage('assistant','旧历史保持原样',c.now());const u=c.engine.store.addMessage('user','旧输入',c.now(),{status:'pending'});
  c.engine.store.db.prepare("INSERT INTO delivery_outbox(id,source_message_id,source_seq,kind,content,payload_json,due_at,expires_at,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run('legacy',u.id,u.seq,'user','旧式整段等待','{}',c.now()+1000,c.now()+60000,'pending',c.now());c.engine.close();
  const second=c.make();assert.equal(second.outbox.get('legacy').status,'cancelled');assert.equal(assistant(second)[0].content,'旧历史保持原样');assert.equal(second.store.messages().find(m=>m.id===u.id).status,'interrupted');
});
test('unsaid uses stable keys and remains separate from facts and public UI state',t=>{
  const c=setup(t),u=c.engine.unsaid;u.commit(u.plan([{action:'upsert',key:'x',text:'没说出口的内容'}]));u.commit(u.plan([{action:'upsert',key:'x',text:'改过的内容'}]));
  assert.equal(u.summary().count,1);assert.equal(u.read().items[0].text,'改过的内容');assert.equal(c.engine.store.factContext().length,0);assert.ok(!JSON.stringify(c.engine.state()).includes('改过的内容'));
  const second=new AgentStore(c.dir);assert.equal(new Unsaid(second).summary().count,1);second.close();u.commit(u.plan([{action:'remove',key:'x'}]));assert.equal(u.summary().count,0);
});
test('failed/invalid response plans cannot commit tool edits or partial outgoing bubbles',async t=>{
  let n=0;const c=setup(t,{remoteFetch:async()=>n++?completion({decision:'send',bubbles:[{text:'bad',after_ms:-1}]}):completion(null,[call('unsaid_update',{operations:[{action:'upsert',key:'invalid',text:'不应保存'}]}),call('contact_plan_update',{operations:[planOp()]})])});
  await turn(c);assert.equal(c.engine.unsaid.summary().count,0);assert.equal(c.engine.plans.summary().active_count,0);assert.equal(c.engine.outbox.hasPending(),false);assert.equal(assistant(c.engine).length,0);
});
test('valid intentions persist even if the model schedules speech later, without pretending it was sent',async t=>{
  let n=0;const c=setup(t,{remoteFetch:async()=>n++?completion(send({text:'之后才说',after_ms:60000})):completion(null,[call('unsaid_update',{operations:[{action:'upsert',key:'later',text:'先记下，尚未说出'}]})])});
  await turn(c);assert.equal(c.engine.unsaid.summary().count,1);assert.equal(assistant(c.engine).length,0);await c.engine.command('chat.stop');assert.equal(c.engine.unsaid.summary().count,1);
});
test('fantasy stays probabilistic optional context and never requires a temporary motive',async t=>{
  const c=setup(t);let calls=0;const i=new Imagination(c.engine.store,{object:async()=>{calls++;return{fantasy:'虚构的漂浮小岛'};}},{...defaults,fantasy_probability:.25},()=>.9);
  assert.equal(await i.sample({}),null);assert.equal(calls,0);i.random=()=>0;assert.equal((await i.sample({})).motive,undefined);assert.equal(c.engine.store.factContext().length,0);
});
test('contact plans validate times, reuse keys, cancel and survive reopening',t=>{
  const c=setup(t),p=c.engine.plans;installPlan(c.engine);p.commit(p.plan([planOp('story',{after_minutes:2})]));assert.equal(p.summary().active_count,1);
  for(const op of [planOp('x',{after_minutes:0}),planOp('x',{after_minutes:10081}),planOp('x',{after_minutes:undefined,due_at:'2026-10-31T12:00:00'})])assert.throws(()=>p.plan([op]));
  const second=new AgentStore(c.dir);assert.equal(new ContactPlans(second,defaults,c.now).summary().active_count,1);second.close();p.commit(p.plan([{action:'cancel',key:'story'}]));assert.equal(p.summary().active_count,0);
});
test('a due contact can send a model-chosen timed sequence using fresh dialogue',async t=>{
  let context;const c=setup(t,{settings:{contact_plan_min_gap_ms:0},remoteFetch:async(_,input)=>{context=JSON.parse(JSON.parse(input.body).messages[1].content);return completion(send({text:'现在第一条',after_ms:0},{text:'接着第二条',after_ms:2000}));}});
  const p=installPlan(c.engine);c.engine.store.addMessage('user','最新消息',c.now());c.advance(60000);await c.engine.start();await c.engine.tick();await drained(c.engine);await step(c,0);
  assert.equal(context.trigger,'planned');assert.equal(context.dialogue.at(-1).content,'最新消息');assert.equal(assistant(c.engine).length,1);assert.equal(c.engine.plans.get(p.id).status,'running');
  await step(c,2000);assert.equal(assistant(c.engine).length,2);assert.equal(c.engine.plans.get(p.id).status,'completed');assert.equal(c.events.filter(e=>e.type==='delivered').length,2);
});
test('autonomous bursts update their own baseline instead of canceling after the first bubble',async t=>{
  const c=setup(t,{remoteFetch:async()=>completion(send({text:'主动一',after_ms:0},{text:'主动二',after_ms:200},{text:'主动三',after_ms:300}))});
  c.engine.store.addMessage('user','很久以前',c.now()-4*3600000);await c.engine.start();await c.engine.tick();await drained(c.engine);await step(c,0);await step(c,200);await step(c,300);assert.equal(assistant(c.engine).length,3);
});
test('focus, lock, typing and manual pause defer scheduled contacts',async t=>{
  let presence={available:false,focus:false};const c=setup(t,{presence:()=>presence,settings:{contact_plan_min_gap_ms:0}});installPlan(c.engine);c.advance(60000);await c.engine.start();await c.engine.tick();await drained(c.engine);assert.equal(assistant(c.engine).length,0);
  presence={available:true,focus:true};await c.engine.tick();await drained(c.engine);assert.equal(assistant(c.engine).length,0);
  presence.focus=false;c.engine.typingUntil=c.now()+1000;await c.engine.tick();await drained(c.engine);assert.equal(assistant(c.engine).length,0);
  c.advance(1000);c.engine.manualPause=true;await c.engine.tick();assert.equal(assistant(c.engine).length,0);c.engine.manualPause=false;await c.engine.tick();await settled(c.engine);assert.equal(assistant(c.engine).length,1);
});
test('lock or typing between autonomous bubbles cancels the unseen tail while keeping the sent prefix',async t=>{
  let p={available:true,focus:false};const c=setup(t,{presence:()=>p,settings:{contact_plan_min_gap_ms:0},remoteFetch:async()=>completion(send({text:'主动前缀',after_ms:0},{text:'不应在锁屏后送达',after_ms:1000}))});
  installPlan(c.engine);c.advance(60000);await c.engine.start();await c.engine.tick();await drained(c.engine);await step(c,0);p={available:false,focus:false};await step(c,1000);assert.equal(assistant(c.engine).length,1);assert.equal(c.engine.outbox.hasPending(),false);
});
test('a scheduled contact can choose silence, reschedule or skip without fake visible messages',async t=>{
  const c=setup(t,{settings:{contact_plan_min_gap_ms:0},remoteFetch:async()=>completion(null,[call('contact_plan_decide',{action:'reschedule',after_minutes:10})])});const p=installPlan(c.engine);c.advance(60000);await c.engine.start();await c.engine.tick();await drained(c.engine);assert.equal(assistant(c.engine).length,0);assert.equal(c.engine.plans.get(p.id).due_at,c.now()+600000);
  c.engine.provider.fetch=async()=>completion({decision:'silent',bubbles:[]});c.advance(600000);await c.engine.tick();await settled(c.engine);assert.equal(c.engine.plans.get(p.id).status,'completed');assert.equal(assistant(c.engine).length,0);
});
test('plan failures retry after cooldown and expire rather than repeatedly sending',async t=>{
  let broken=true;const c=setup(t,{settings:{contact_plan_min_gap_ms:0},remoteFetch:async()=>broken?completion({decision:'bad',bubbles:[]}):completion(send('重试后的一条'))});const p=installPlan(c.engine);c.advance(60000);await c.engine.start();await c.engine.tick();await drained(c.engine);assert.equal(c.engine.plans.get(p.id).status,'scheduled');assert.equal(c.engine.plans.due(),null);
  broken=false;c.advance(300000);await c.engine.tick();await settled(c.engine);assert.equal(c.engine.plans.get(p.id).status,'completed');assert.equal(assistant(c.engine).length,1);
});
test('silent decisions never mark an unspoken life story as shared',async t=>{
  let n=0;const c=setup(t,{remoteFetch:async()=>n++?completion({decision:'silent',bubbles:[]}):completion(null,[call('life_mark_shared',{ids:['life']})])});c.engine.store.db.prepare("INSERT INTO life_activities(id,title,description,started_at,due_at,finished_at,status,record) VALUES(?,?,?,?,?,?,?,?)").run('life','合成生活','合成活动',c.now()-1000,c.now(),c.now(),'complete','合成故事');
  await turn(c);assert.equal(c.engine.store.db.prepare('SELECT shared_at FROM life_activities WHERE id=?').get('life').shared_at,null);
});
test('life sharing is not committed by a partly delivered burst that is later interrupted',async t=>{
  let n=0;const c=setup(t,{remoteFetch:async()=>n++?completion(send({text:'一个开头',after_ms:0},{text:'完整故事还没发',after_ms:60000})):completion(null,[call('life_mark_shared',{ids:['life']})])});c.engine.store.db.prepare("INSERT INTO life_activities(id,title,description,started_at,due_at,finished_at,status,record) VALUES(?,?,?,?,?,?,?,?)").run('life','合成生活','合成活动',c.now()-1000,c.now(),c.now(),'complete','合成故事');
  await turn(c);await step(c,0);await c.engine.command('chat.stop');assert.equal(c.engine.store.db.prepare('SELECT shared_at FROM life_activities WHERE id=?').get('life').shared_at,null);
});
test('schema upgrade preserves historical data and includes private bubble receipts only in full local export',t=>{
  const c=setup(t);c.engine.store.addMessage('user','合成旧记录',c.now());const before=c.engine.store.messages();c.engine.store.db.exec('DROP TABLE delivery_bubbles');c.engine.close();const second=c.make();assert.deepEqual(second.store.messages(),before);assert.equal(second.store.exportData().schema,3);assert.ok(Array.isArray(second.store.exportData().delivery_bubbles));
});


test('choosing quiet does not suspend the companion own-life or internal maintenance', async t => {
  const c = setup(t); c.engine.store.setMeta('response_quiet_until', c.now()+600000);
  let maintained=0; c.engine.memory.due=()=>true; c.engine.news.due=()=>false;
  c.engine.maintain=async()=>{maintained++;}; await c.engine.start(); await c.engine.tick(); await drained(c.engine);
  assert.equal(maintained,1); assert.equal(assistant(c.engine).length,0);
});
