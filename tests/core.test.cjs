const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StudyStore, FOCUS_MS, BREAK_MS } = require('../electron/store.cjs');

function setup(start = new Date(2026, 9, 28, 10).getTime(), extra = {}) {
  let at = start;
  const store = new StudyStore(':memory:', { now: () => at, maxGapMs: Infinity, ...extra });
  const move = ms => { at += ms; return store.tick(); };
  return { store, move, get now() { return at; } };
}
function tag(store, name) {
  store.dispatch('tag.create', { name, color: '#5976e8' });
  return store.snapshot().tags.find(t => t.name === name).id;
}
const sum = (store, id) => store.snapshot().segments.filter(s => !id || s.tag_id === id).reduce((n, s) => n + s.duration_ms, 0);

test('manual learning feeds day, week, month, hour buckets and tag totals without changing the timer', () => {
  const { total, buckets, periodRange } = require('../app/analytics.ts');
  const { store, now } = setup(); const id = tag(store, '离线阅读');
  const timer = { ...store.timer };
  store.dispatch('study.manual', { day: '2026-10-28', minutes: 90, endAt: now, tagId: id });
  const state = store.snapshot();
  assert.deepEqual(state.timer, timer); assert.equal(state.sessions[0].status, 'manual');
  for (const period of ['day', 'week', 'month']) assert.equal(total(state.segments, ...periodRange(period, new Date(now)), id), 90 * 60000);
  const hourly = buckets('day', new Date(now)).map(b => total(state.segments, b.start, b.end));
  assert.equal(hourly[8], 30 * 60000); assert.equal(hourly[9], 60 * 60000);
  store.close();
});
test('invalid manual durations, dates, future times and archived labels roll back completely', () => {
  const { store, now } = setup(); const base = { day: '2026-10-28', minutes: 30, endAt: now, tagId: 'uncategorized' };
  for (const minutes of [0, -1, 1.5, 1441, NaN, Infinity, '30', null]) assert.throws(() => store.dispatch('study.manual', { ...base, minutes }));
  for (const patch of [{ day: '2026-10-27' }, { day: '2026-10-29' }, { endAt: now + 60000 }, { endAt: NaN }, { endAt: 'now' }, { minutes: 601 }, { tagId: 'missing' }]) assert.throws(() => store.dispatch('study.manual', { ...base, ...patch }));
  const id = tag(store, '归档'); store.dispatch('tag.archive', { id, archived: true });
  assert.throws(() => store.dispatch('study.manual', { ...base, tagId: id }), /归档/);
  assert.equal(sum(store), 0); assert.equal(store.snapshot().sessions.length, 0); store.close();
});
test('manual overlap is rejected, adjacent ranges are allowed, and only manual entries can be removed', () => {
  const { store, now, move } = setup(); const base = { day: '2026-10-28', minutes: 30, endAt: now, tagId: 'uncategorized' };
  store.dispatch('study.manual', base);
  assert.throws(() => store.dispatch('study.manual', base), /已有学习记录/);
  assert.throws(() => store.dispatch('study.manual', { ...base, endAt: now - 15 * 60000 }), /已有学习记录/);
  store.dispatch('study.manual', { ...base, endAt: now - 30 * 60000 });
  store.dispatch('timer.start'); move(60000); store.dispatch('timer.stop');
  const state = store.snapshot(), manual = state.sessions.find(s => s.status === 'manual');
  assert.throws(() => store.dispatch('study.removeManual', { id: state.sessions.find(s => s.status !== 'manual').id }), /不存在/);
  store.dispatch('study.removeManual', { id: manual.id });
  assert.equal(sum(store), 31 * 60000); assert.equal(store.snapshot().segments.some(s => s.session_id === manual.id), false); store.close();
});
test('manual additions during focus preserve elapsed time and cannot overlap its current heartbeat', () => {
  const { store, now } = setup(); store.dispatch('timer.start');
  store.now = () => now + 1000;
  const base = { day: '2026-10-28', minutes: 1, endAt: now + 1000, tagId: 'uncategorized' };
  assert.throws(() => store.dispatch('study.manual', base), /已有学习记录/);
  assert.equal(sum(store), 0); assert.equal(store.timer.elapsedMs, 0);
  store.dispatch('study.manual', { ...base, endAt: now });
  assert.equal(sum(store), 61000); assert.equal(store.timer.elapsedMs, 1000); assert.equal(store.timer.status, 'running'); store.close();
});
test('manual learning persists after reopening and old-day dialogs cannot add to yesterday', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studydesk-manual-'));
  const filename = path.join(directory, 'test.sqlite'); let at = +new Date(2026, 9, 28, 23, 59);
  let store = new StudyStore(filename, { now: () => at });
  const payload = { day: '2026-10-28', minutes: 25, endAt: at, tagId: 'uncategorized' };
  store.dispatch('study.manual', payload); store.close(); at += 120000;
  store = new StudyStore(filename, { now: () => at });
  assert.equal(sum(store), 25 * 60000); assert.equal(store.exportData().sessions[0].status, 'manual');
  assert.throws(() => store.dispatch('study.manual', payload), /只能补录今天/);
  store.dispatch('study.removeManual', { id: store.snapshot().sessions[0].id });
  assert.equal(sum(store), 0); store.close(); fs.rmSync(directory, { recursive: true });
});

test('a 45 minute session splits exactly into 20 and 25 minutes by tag', () => {
  const { store, move } = setup();
  const a = tag(store, 'Flow Matching'), b = tag(store, '强化学习');
  store.dispatch('timer.tag', { id: a }); store.dispatch('timer.start');
  move(20 * 60000); store.dispatch('timer.tag', { id: b }); move(25 * 60000);
  assert.equal(sum(store, a), 20 * 60000); assert.equal(sum(store, b), 25 * 60000);
  assert.equal(store.timer.status, 'completed'); assert.equal(store.timer.elapsedMs, FOCUS_MS);
  move(10 * 60000); assert.equal(sum(store), FOCUS_MS);
  store.close();
});
test('pause, resume and stop preserve partial actual study, excluding paused time', () => {
  const { store, move } = setup();
  store.dispatch('timer.start'); move(12345); store.dispatch('timer.pause');
  move(300000); assert.equal(sum(store), 12345);
  store.dispatch('timer.start'); move(9876); store.dispatch('timer.stop');
  assert.equal(sum(store), 22221); assert.equal(store.timer.status, 'idle');
  assert.equal(store.snapshot().segments.length, 2); store.close();
});
test('break has a fixed 15 minute duration and adds no learning segments', () => {
  const { store, move } = setup(); store.dispatch('timer.mode', { mode: 'break' }); store.dispatch('timer.start');
  move(5000000); assert.equal(store.timer.elapsedMs, BREAK_MS); assert.equal(sum(store), 0);
  assert.equal(store.timer.status, 'completed'); store.close();
});
test('tag switches while paused do not move historical learning to another tag', () => {
  const { store, move } = setup(); const a = tag(store, 'A'), b = tag(store, 'B');
  store.dispatch('timer.tag', { id: a }); store.dispatch('timer.start'); move(60000);
  store.dispatch('timer.pause'); store.dispatch('timer.tag', { id: b }); move(120000);
  store.dispatch('timer.start'); move(90000);
  assert.equal(sum(store, a), 60000); assert.equal(sum(store, b), 90000); store.close();
});
test('long unexpected heartbeat gap and backward clock change pause without counting the gap', () => {
  const { store, move } = setup(undefined, { maxGapMs: 30000 });
  store.dispatch('timer.start'); move(1000); move(600000);
  assert.equal(sum(store), 1000); assert.equal(store.timer.status, 'paused');
  store.dispatch('timer.start'); move(-5000); assert.equal(sum(store), 1000); assert.equal(store.timer.status, 'paused'); store.close();
});
test('reopening after an unclean exit pauses at the last committed second', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studydesk-recovery-'));
  const filename = path.join(directory, 'test.sqlite'); let now = 1000000;
  const one = new StudyStore(filename, { now: () => now }); one.dispatch('timer.start'); now += 1000; one.tick();
  one.db.close(); now += 24 * 3600000;
  const two = new StudyStore(filename, { now: () => now });
  assert.equal(two.timer.status, 'paused'); assert.equal(two.timer.elapsedMs, 1000); assert.equal(sum(two), 1000);
  two.dispatch('timer.start'); now += 1000; two.tick(); assert.equal(sum(two), 2000);
  two.close(); fs.rmSync(directory, { recursive: true });
});
test('tag edits, archival and restoration preserve all-time totals', () => {
  const { store, move } = setup(); const id = tag(store, '旧名字');
  store.dispatch('timer.tag', { id }); store.dispatch('timer.start'); move(120000);
  assert.throws(() => store.dispatch('tag.archive', { id, archived: true }), /切换/);
  store.dispatch('timer.tag', { id: 'uncategorized' });
  store.dispatch('tag.edit', { id, name: '新名字', color: '#a180cc' }); store.dispatch('tag.archive', { id, archived: true });
  assert.equal(sum(store, id), 120000); assert.equal(store.snapshot().tags.find(t => t.id === id).name, '新名字');
  assert.throws(() => store.dispatch('timer.tag', { id }), /归档/);
  store.dispatch('tag.archive', { id, archived: false }); store.dispatch('timer.tag', { id });
  assert.equal(store.timer.tagId, id); store.close();
});
test('todo history retains title snapshots after edits, reopening, deletion and restoration', () => {
  const { store, move } = setup(); store.dispatch('todo.create', { title: '读第一篇论文' });
  const id = store.snapshot().todos[0].id;
  move(1000); store.dispatch('todo.toggle', { id }); move(1000);
  store.dispatch('todo.edit', { id, title: '读第二篇论文' }); store.dispatch('todo.toggle', { id });
  store.dispatch('todo.delete', { id }); store.dispatch('todo.restore', { id });
  const events = store.snapshot().todoEvents;
  assert.deepEqual(events.map(e => e.kind), ['created', 'completed', 'reopened', 'deleted', 'restored']);
  assert.equal(events[0].title, '读第一篇论文'); assert.equal(events[1].title, '读第一篇论文'); assert.equal(events[3].title, '读第二篇论文'); store.close();
});
test('task association inherits its tag and mid-session change stays in the same session', () => {
  const { store, move } = setup(); const id = tag(store, '强化学习');
  store.dispatch('todo.create', { title: '学习 PPO', tagId: id }); const todoId = store.snapshot().todos[0].id;
  store.dispatch('timer.task', { id: todoId, start: true }); const session = store.timer.sessionId; move(60000);
  store.dispatch('timer.task', { id: null }); move(30000);
  assert.equal(store.timer.sessionId, session); assert.equal(store.timer.tagId, id);
  assert.equal(store.snapshot().segments[0].todo_id, todoId); assert.equal(store.snapshot().segments[1].todo_id, null); store.close();
});
test('daily mood defaults to normal and review may be empty; future/invalid entries rejected', () => {
  const { store } = setup(); assert.equal(store.snapshot().daily.length, 0);
  store.dispatch('daily.save', { day: '2026-10-28', mood: 'normal', review: '' });
  assert.deepEqual({ ...store.snapshot().daily[0] }, { day: '2026-10-28', mood: 'normal', review: '' });
  store.dispatch('daily.save', { day: '2026-10-28', mood: 'great', review: '今天看懂了一个推导' });
  assert.equal(store.snapshot().daily[0].mood, 'great');
  assert.throws(() => store.dispatch('daily.save', { day: '2026-11-01', mood: 'normal' }), /未来/);
  assert.throws(() => store.dispatch('daily.save', { day: '2026-02-31', mood: 'normal' }), /日期/); store.close();
});
test('notes persist newlines and are recoverable after soft deletion', () => {
  const { store } = setup(); store.dispatch('note.create', { body: '第一行\n第二行' }); const id = store.snapshot().notes[0].id;
  store.dispatch('note.edit', { id, body: '' }); assert.equal(store.snapshot().notes[0].body, '');
  store.dispatch('note.edit', { id, body: "思考 'flow' <script>text</script>\n新想法" });
  store.dispatch('note.delete', { id }); assert.ok(store.snapshot().notes[0].deleted_at);
  store.dispatch('note.restore', { id }); assert.equal(store.snapshot().notes[0].deleted_at, null); assert.ok(store.snapshot().notes[0].body.includes('\n')); store.close();
});
test('failed validation rolls back both timer attribution and database mutations', () => {
  const { store, move } = setup(); const id = tag(store, 'FLOW');
  assert.throws(() => tag(store, 'flow'), /同名/);
  assert.throws(() => store.dispatch('tag.edit', { id: 'uncategorized', name: 'X', color: '#5976e8' }), /保留/);
  assert.throws(() => store.dispatch('todo.create', { title: 'x'.repeat(501) }), /最多/);
  store.dispatch('todo.create', { title: '读书', tagId: id }); const todoId = store.snapshot().todos[0].id;
  store.dispatch('timer.mode', { mode: 'break' }); store.dispatch('timer.start'); move(1000);
  assert.throws(() => store.dispatch('timer.task', { id: todoId, start: true }), /休息/);
  assert.equal(store.timer.todoId, null); assert.equal(store.timer.mode, 'break'); store.close();
});
test('cross-midnight, month and week aggregation clips intervals without losing any duration', async () => {
  const { total, periodRange, buckets } = await import('../app/analytics.ts');
  const at = new Date(2026, 9, 31, 23, 45).getTime(); const { store, move } = setup(at);
  store.dispatch('timer.start'); move(45 * 60000); const segments = store.snapshot().segments;
  assert.equal(total(segments, ...periodRange('month', new Date(2026, 9, 31))), 15 * 60000);
  assert.equal(total(segments, ...periodRange('month', new Date(2026, 10, 1))), 30 * 60000);
  assert.equal(total(segments, ...periodRange('day', new Date(2026, 10, 1))), 30 * 60000);
  const weekStart = new Date(periodRange('week', new Date(2026, 10, 1))[0]); assert.equal(weekStart.getDay(), 1); assert.equal(weekStart.getDate(), 26);
  assert.equal(buckets('month', new Date(2026, 10, 1)).length, 30); assert.equal(buckets('week', new Date(2026, 10, 1)).length, 7);
  assert.equal(buckets('day', new Date(2026, 10, 1)).reduce((n, b) => n + total(segments, b.start, b.end), 0), 30 * 60000);
  store.close();
});

test('reminders become due at their scheduled time and are delivered only once', () => {
  const { store, move, now } = setup();
  store.dispatch('todo.create', { title: '提醒任务', remindAt: now + 60000 });
  const id = store.snapshot().todos[0].id;
  assert.equal(store.dueReminders().length, 0); move(60000);
  assert.equal(store.dueReminders().length, 1);
  assert.equal(store.markReminded(id, now + 60000), true);
  assert.equal(store.dueReminders().length, 0);
  assert.equal(store.markReminded(id, now + 60000), false); store.close();
});
test('completed and deleted todos are excluded from reminder delivery', () => {
  const { store, move, now } = setup();
  for (const title of ['完成事项', '删除事项', '待提醒']) store.dispatch('todo.create', { title, remindAt: now + 1000 });
  const tasks = store.snapshot().todos;
  store.dispatch('todo.toggle', { id: tasks.find(t => t.title === '完成事项').id });
  store.dispatch('todo.delete', { id: tasks.find(t => t.title === '删除事项').id });
  move(2000); assert.deepEqual(store.dueReminders().map(t => t.title), ['待提醒']); store.close();
});
test('editing and clearing reminders reset delivery status and reject stale acknowledgements', () => {
  const { store, move, now } = setup(); store.dispatch('todo.create', { title: '提醒任务', remindAt: now + 1000 });
  const id = store.snapshot().todos[0].id;
  store.dispatch('todo.reminder', { id, remindAt: now + 5000 });
  assert.equal(store.markReminded(id, now + 1000), false);
  move(6000); const task = store.dueReminders()[0]; store.markReminded(id, task.remind_at);
  store.dispatch('todo.reminder', { id, remindAt: now + 10000 });
  assert.equal(store.snapshot().todos[0].reminded_at, null);
  store.dispatch('todo.reminder', { id, remindAt: null });
  move(20000); assert.equal(store.dueReminders().length, 0); store.close();
});
test('reminder input validation rolls back new todos and their history', () => {
  const { store, now } = setup();
  for (const remindAt of [now, now - 1, NaN, Infinity, 'tomorrow']) assert.throws(() => store.dispatch('todo.create', { title: '失败', remindAt }), /提醒时间/);
  assert.equal(store.snapshot().todos.length, 0); assert.equal(store.snapshot().todoEvents.length, 0); store.close();
});
test('version 1 databases migrate without changing existing records', () => {
  const { DatabaseSync } = require('node:sqlite');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studydesk-migration-'));
  const filename = path.join(directory, 'test.sqlite'); const old = new DatabaseSync(filename);
  old.exec('CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, tag_id TEXT, created_at INTEGER NOT NULL, completed_at INTEGER, deleted_at INTEGER); PRAGMA user_version=1;');
  old.prepare('INSERT INTO todos VALUES (?, ?, NULL, ?, NULL, NULL)').run('old-id', '旧待办', 12345); old.close();
  const store = new StudyStore(filename); const task = store.snapshot().todos[0];
  assert.equal(task.id, 'old-id'); assert.equal(task.title, '旧待办'); assert.equal(task.remind_at, null);
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 2); store.close(); fs.rmSync(directory, { recursive: true });
});
test('overdue reminders survive process restarts and keep their delivered status', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studydesk-reminder-persist-'));
  const filename = path.join(directory, 'test.sqlite'); let now = Date.now();
  const first = new StudyStore(filename, { now: () => now }); first.dispatch('todo.create', { title: '重启提醒', remindAt: now + 1000 }); first.close();
  now += 5000; const second = new StudyStore(filename, { now: () => now }); const due = second.dueReminders(); assert.equal(due.length, 1);
  second.markReminded(due[0].id, due[0].remind_at); second.close();
  const third = new StudyStore(filename, { now: () => now }); assert.equal(third.dueReminders().length, 0); third.close(); fs.rmSync(directory, { recursive: true });
});
