const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FOCUS_MS = 45 * 60 * 1000;
const BREAK_MS = 15 * 60 * 1000;
const MOODS = ['bad', 'low', 'normal', 'good', 'great'];
const COLORS = ['#5976e8', '#a180cc', '#59a797', '#d79362', '#d57589', '#7a99ba', '#b6a052', '#8b95a3'];
const dayKey = (at) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function clean(value, max, required = false) {
  if (typeof value !== 'string') throw new Error('请输入有效文字');
  const text = value.trim();
  if (text.length > max) throw new Error(`内容最多 ${max} 个字`);
  if (required && !text) throw new Error('内容不能为空');
  return text;
}
function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || dayKey(new Date(`${value}T12:00:00`).getTime()) !== value) {
    throw new Error('日期无效');
  }
  return value;
}

class StudyStore {
  constructor(filename, { now = Date.now, maxGapMs = 30000 } = {}) {
    this.now = now;
    this.maxGapMs = maxGapMs;
    this.revision = 0;
    this.filename = filename;
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        color TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, tag_id TEXT REFERENCES tags(id),
        created_at INTEGER NOT NULL, completed_at INTEGER, deleted_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS todo_events (
        id TEXT PRIMARY KEY, todo_id TEXT NOT NULL REFERENCES todos(id),
        kind TEXT NOT NULL, title TEXT NOT NULL, at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL, deleted_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS daily_entries (
        day TEXT PRIMARY KEY, mood TEXT NOT NULL DEFAULT 'normal', review TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, mode TEXT NOT NULL, started_at INTEGER NOT NULL,
        ended_at INTEGER, elapsed_ms INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS segments (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
        tag_id TEXT NOT NULL REFERENCES tags(id), todo_id TEXT REFERENCES todos(id),
        start_at INTEGER NOT NULL, end_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0)
      );
      CREATE INDEX IF NOT EXISTS segments_time ON segments(start_at, end_at);
      CREATE INDEX IF NOT EXISTS events_time ON todo_events(at);
    `);
    const todoColumns = new Set(this.db.prepare('PRAGMA table_info(todos)').all().map(column => column.name));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!todoColumns.has('remind_at')) this.db.exec('ALTER TABLE todos ADD COLUMN remind_at INTEGER');
      if (!todoColumns.has('reminded_at')) this.db.exec('ALTER TABLE todos ADD COLUMN reminded_at INTEGER');
      this.db.exec('CREATE INDEX IF NOT EXISTS todo_reminders ON todos(remind_at) WHERE remind_at IS NOT NULL AND reminded_at IS NULL');
      this.db.exec('PRAGMA user_version=2; COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    this.db.prepare('INSERT OR IGNORE INTO tags VALUES (?, ?, ?, 0, ?)').run('uncategorized', '未分类', '#8b95a3', now());
    const saved = this.db.prepare("SELECT value FROM meta WHERE key='timer'").get();
    this.timer = saved ? JSON.parse(saved.value) : this.emptyTimer();
    // 关闭期间与崩溃后的间隔不记为学习；最多损失最后一个心跳（1 秒）。
    if (this.timer.status === 'running') {
      this.timer.status = 'paused';
      this.timer.message = '已恢复上次进度，点击继续学习';
      this.timer.segmentId = null;
      this.db.prepare('UPDATE sessions SET status=? WHERE id=?').run('paused', this.timer.sessionId);
    }
    this.saveTimer();
  }
  emptyTimer(mode = 'focus', tagId = 'uncategorized', todoId = null) {
    return { mode, status: 'idle', plannedMs: mode === 'focus' ? FOCUS_MS : BREAK_MS,
      elapsedMs: 0, sessionId: null, tagId, todoId, segmentId: null, lastAt: this.now(), message: '' };
  }
  saveTimer() {
    this.db.prepare("INSERT OR REPLACE INTO meta VALUES ('timer', ?)").run(JSON.stringify(this.timer));
  }
  transaction(fn) {
    const before = { ...this.timer };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.saveTimer();
      this.db.exec('COMMIT');
      this.revision++;
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      this.timer = before;
      throw e;
    }
  }
  getTag(id, allowArchived = false) {
    const tag = this.db.prepare('SELECT * FROM tags WHERE id=?').get(id);
    if (!tag || (tag.archived && !allowArchived)) throw new Error('这个标签已归档或不存在');
    return tag;
  }
  event(todo, kind, at) {
    this.db.prepare('INSERT INTO todo_events VALUES (?, ?, ?, ?, ?)').run(randomUUID(), todo.id, kind, todo.title, at);
  }
  advance(at) {
    const t = this.timer;
    if (t.status !== 'running') return null;
    const gap = at - t.lastAt;
    if (gap < 0 || gap > this.maxGapMs) {
      t.status = 'paused';
      t.segmentId = null;
      t.lastAt = at;
      t.message = '检测到休眠或时钟变化，计时已暂停';
      this.db.prepare('UPDATE sessions SET status=? WHERE id=?').run('paused', t.sessionId);
      return null;
    }
    const delta = Math.min(gap, Math.max(0, t.plannedMs - t.elapsedMs));
    let changed = null;
    if (delta > 0 && t.mode === 'focus') {
      if (t.segmentId) {
        this.db.prepare('UPDATE segments SET end_at=?, duration_ms=duration_ms+? WHERE id=?').run(t.lastAt + delta, delta, t.segmentId);
      } else {
        t.segmentId = randomUUID();
        this.db.prepare('INSERT INTO segments VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(t.segmentId, t.sessionId, t.tagId, t.todoId, t.lastAt, t.lastAt + delta, delta);
      }
      changed = this.db.prepare('SELECT * FROM segments WHERE id=?').get(t.segmentId);
    }
    t.elapsedMs += delta;
    const endedAt = t.lastAt + delta;
    t.lastAt = at;
    if (t.elapsedMs >= t.plannedMs) {
      t.status = 'completed';
      t.segmentId = null;
      t.message = t.mode === 'focus' ? '45 分钟学习已完成' : '15 分钟休息已结束';
      this.db.prepare('UPDATE sessions SET ended_at=?, elapsed_ms=?, status=? WHERE id=?')
        .run(endedAt, t.elapsedMs, 'completed', t.sessionId);
    } else {
      this.db.prepare('UPDATE sessions SET elapsed_ms=? WHERE id=?').run(t.elapsedMs, t.sessionId);
    }
    return changed;
  }
  tick() {
    if (this.timer.status !== 'running') return null;
    const segment = this.transaction(() => this.advance(this.now()));
    return { timer: { ...this.timer }, segment, revision: this.revision };
  }
  start(at) {
    const t = this.timer;
    if (t.status === 'running') return;
    if (t.status === 'paused') {
      t.status = 'running'; t.lastAt = at; t.segmentId = null; t.message = '';
      this.db.prepare('UPDATE sessions SET status=? WHERE id=?').run('running', t.sessionId);
      return;
    }
    const next = this.emptyTimer(t.mode, t.tagId, t.todoId);
    next.sessionId = randomUUID(); next.status = 'running'; next.lastAt = at;
    this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?, NULL, 0, ?)').run(next.sessionId, next.mode, at, 'running');
    this.timer = next;
  }
  pause(at, message = '') {
    this.advance(at);
    if (this.timer.status === 'running') {
      this.timer.status = 'paused'; this.timer.segmentId = null; this.timer.message = message;
      this.db.prepare('UPDATE sessions SET status=? WHERE id=?').run('paused', this.timer.sessionId);
    }
  }
  dispatch(action, payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('无效操作');
    return this.transaction(() => {
      const at = this.now();
      if (action === 'timer.start') this.start(at);
      else if (action === 'timer.pause') this.pause(at, payload.message || '');
      else if (action === 'timer.stop') {
        this.advance(at);
        const t = this.timer;
        if (t.sessionId && t.status !== 'completed') {
          this.db.prepare('UPDATE sessions SET ended_at=?, elapsed_ms=?, status=? WHERE id=?').run(at, t.elapsedMs, 'stopped', t.sessionId);
        }
        this.timer = this.emptyTimer(t.mode, t.tagId, t.todoId);
      } else if (action === 'timer.mode') {
        if (!['focus', 'break'].includes(payload.mode)) throw new Error('无效计时模式');
        if (['running', 'paused'].includes(this.timer.status)) throw new Error('请先结束当前计时');
        this.timer = this.emptyTimer(payload.mode, this.timer.tagId, this.timer.todoId);
      } else if (action === 'timer.tag') {
        this.getTag(payload.id);
        this.advance(at);
        if (this.timer.tagId !== payload.id) this.timer.segmentId = null;
        this.timer.tagId = payload.id;
      } else if (action === 'timer.task') {
        const todo = payload.id ? this.db.prepare('SELECT * FROM todos WHERE id=? AND deleted_at IS NULL').get(payload.id) : null;
        if (payload.id && !todo) throw new Error('事项不存在');
        this.advance(at);
        this.timer.todoId = todo?.id || null;
        if (todo?.tag_id && !this.getTag(todo.tag_id, true).archived) this.timer.tagId = todo.tag_id;
        this.timer.segmentId = null;
        if (payload.start) {
          if (this.timer.mode === 'break') {
            if (['running', 'paused'].includes(this.timer.status)) throw new Error('请先结束休息，再开始学习此事项');
            this.timer = this.emptyTimer('focus', this.timer.tagId, this.timer.todoId);
          }
          this.start(at);
        }
      } else if (action === 'study.manual') {
        // 补录也保存为真实时间段，复用日历、小时趋势、标签及备份的统计口径。
        if (validDay(payload.day) !== dayKey(at)) throw new Error('只能补录今天的学习时间，请重新打开补录窗口');
        const minutes = payload.minutes, endAt = payload.endAt;
        if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error('学习时长须为 1 到 1440 分钟');
        const startAt = endAt - minutes * 60000;
        if (!Number.isSafeInteger(endAt) || endAt > at || dayKey(startAt) !== payload.day || dayKey(endAt - 1) !== payload.day) throw new Error('请选择今天已经结束的时间段，不能跨天或填写未来时间');
        this.getTag(payload.tagId);
        this.advance(at);
        if (this.db.prepare('SELECT id FROM segments WHERE start_at < ? AND end_at > ? LIMIT 1').get(endAt, startAt)) throw new Error('这段时间已有学习记录，请调整时间，避免重复计入');
        const id = randomUUID();
        this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?)').run(id, 'focus', startAt, endAt, minutes * 60000, 'manual');
        this.db.prepare('INSERT INTO segments VALUES (?, ?, ?, NULL, ?, ?, ?)').run(randomUUID(), id, payload.tagId, startAt, endAt, minutes * 60000);
      } else if (action === 'study.removeManual') {
        const session = this.db.prepare("SELECT id FROM sessions WHERE id=? AND status='manual'").get(payload.id);
        if (!session) throw new Error('补录记录不存在');
        this.db.prepare('DELETE FROM segments WHERE session_id=?').run(session.id);
        this.db.prepare('DELETE FROM sessions WHERE id=?').run(session.id);
      } else if (action === 'tag.create') {
        const name = clean(payload.name, 64, true);
        if (this.db.prepare('SELECT id FROM tags WHERE name=? COLLATE NOCASE').get(name)) throw new Error('已有同名标签，请使用或恢复它');
        const color = COLORS.includes(payload.color) ? payload.color : COLORS[this.db.prepare('SELECT COUNT(*) AS n FROM tags').get().n % COLORS.length];
        this.db.prepare('INSERT INTO tags VALUES (?, ?, ?, 0, ?)').run(randomUUID(), name, color, at);
      } else if (action === 'tag.edit') {
        this.getTag(payload.id, true);
        if (payload.id === 'uncategorized') throw new Error('未分类标签会一直保留');
        const name = clean(payload.name, 64, true);
        const duplicate = this.db.prepare('SELECT id FROM tags WHERE name=? COLLATE NOCASE AND id<>?').get(name, payload.id);
        if (duplicate) throw new Error('已有同名标签');
        if (!COLORS.includes(payload.color)) throw new Error('请选择标签颜色');
        this.db.prepare('UPDATE tags SET name=?, color=? WHERE id=?').run(name, payload.color, payload.id);
      } else if (action === 'tag.archive') {
        this.getTag(payload.id, true);
        if (payload.id === 'uncategorized') throw new Error('未分类标签会一直保留');
        if (payload.archived && this.timer.tagId === payload.id && ['running', 'paused'].includes(this.timer.status)) throw new Error('请先切换当前学习标签，再归档');
        this.db.prepare('UPDATE tags SET archived=? WHERE id=?').run(payload.archived ? 1 : 0, payload.id);
        if (payload.archived && this.timer.tagId === payload.id) this.timer.tagId = 'uncategorized';
      } else if (action === 'todo.create') {
        const title = clean(payload.title, 500, true);
        if (payload.tagId) this.getTag(payload.tagId);
        const todo = { id: randomUUID(), title };
        const remindAt = this.validateReminder(payload.remindAt, at);
        this.db.prepare('INSERT INTO todos (id, title, tag_id, created_at, completed_at, deleted_at, remind_at, reminded_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL)').run(todo.id, title, payload.tagId || null, at, remindAt);
        this.event(todo, 'created', at);
      } else if (['todo.toggle', 'todo.edit', 'todo.delete', 'todo.restore', 'todo.reminder'].includes(action)) {
        const todo = this.db.prepare('SELECT * FROM todos WHERE id=?').get(payload.id);
        if (!todo || (todo.deleted_at && action !== 'todo.restore')) throw new Error('事项已删除');
        if (action === 'todo.reminder') {
          const remindAt = this.validateReminder(payload.remindAt, at);
          if (todo.completed_at && remindAt !== null) throw new Error('已完成事项不能设置提醒');
          this.db.prepare('UPDATE todos SET remind_at=?, reminded_at=NULL WHERE id=?').run(remindAt, todo.id);
        } else if (action === 'todo.toggle') {
          this.db.prepare('UPDATE todos SET completed_at=? WHERE id=?').run(todo.completed_at ? null : at, todo.id);
          this.event(todo, todo.completed_at ? 'reopened' : 'completed', at);
        } else if (action === 'todo.edit') {
          const title = clean(payload.title, 500, true);
          if (payload.tagId) this.getTag(payload.tagId, true);
          this.db.prepare('UPDATE todos SET title=?, tag_id=? WHERE id=?').run(title, payload.tagId || null, todo.id);
        } else if (action === 'todo.delete') {
          this.db.prepare('UPDATE todos SET deleted_at=? WHERE id=?').run(at, todo.id);
          this.event(todo, 'deleted', at);
        } else {
          this.db.prepare('UPDATE todos SET deleted_at=NULL WHERE id=?').run(todo.id);
          this.event(todo, 'restored', at);
        }
      } else if (action === 'note.create') {
        const body = clean(payload.body, 100000, true);
        this.db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, NULL)').run(randomUUID(), body, at, at);
      } else if (action === 'note.edit') {
        const note = this.db.prepare('SELECT * FROM notes WHERE id=? AND deleted_at IS NULL').get(payload.id);
        if (!note) throw new Error('记录不存在');
        this.db.prepare('UPDATE notes SET body=?, updated_at=? WHERE id=?').run(clean(payload.body, 100000), at, payload.id);
      } else if (action === 'note.delete' || action === 'note.restore') {
        this.db.prepare('UPDATE notes SET deleted_at=? WHERE id=?').run(action === 'note.delete' ? at : null, payload.id);
      } else if (action === 'daily.save') {
        const day = validDay(payload.day);
        if (day > dayKey(at)) throw new Error('不能填写未来日期');
        if (!MOODS.includes(payload.mood)) throw new Error('无效状态');
        this.db.prepare('INSERT OR REPLACE INTO daily_entries VALUES (?, ?, ?)').run(day, payload.mood, clean(payload.review || '', 5000));
      } else throw new Error('暂不支持这个操作');
    });
  }
  validateReminder(value, at = this.now()) {
    if (value === undefined || value === null || value === '') return null;
    if (!Number.isSafeInteger(value) || value <= at || value > 8640000000000000) throw new Error('提醒时间必须晚于当前时间');
    return value;
  }
  dueReminders(at = this.now()) {
    return this.db.prepare('SELECT * FROM todos WHERE remind_at IS NOT NULL AND remind_at<=? AND reminded_at IS NULL AND completed_at IS NULL AND deleted_at IS NULL ORDER BY remind_at').all(at);
  }
  markReminded(id, scheduledAt, at = this.now()) {
    return this.db.prepare('UPDATE todos SET reminded_at=? WHERE id=? AND remind_at=? AND reminded_at IS NULL AND completed_at IS NULL AND deleted_at IS NULL').run(at, id, scheduledAt).changes > 0;
  }
  companionSnapshot() {
    const at = this.now(), midnight = new Date(at).setHours(0, 0, 0, 0);
    const learning = this.db.prepare(`SELECT
      COALESCE(SUM(MAX(0, MIN(end_at, ?) - MAX(start_at, ?))), 0) AS todayMs,
      COALESCE(MAX(MIN(end_at, ?)), 0) AS lastStudyAt FROM segments`).get(at, midnight, at);
    return {
      todos: this.db.prepare(`SELECT t.*, tags.name AS tag FROM todos t LEFT JOIN tags ON tags.id=t.tag_id
        ORDER BY t.completed_at IS NOT NULL, t.created_at DESC, t.id`).all(),
      notes: this.db.prepare(`SELECT id, CASE WHEN deleted_at IS NULL THEN body ELSE '' END AS body,
        created_at, updated_at, deleted_at FROM notes ORDER BY updated_at DESC, id`).all(),
      timer: { mode: this.timer.mode, status: this.timer.status, todoId: this.timer.todoId,
        elapsedMs: this.timer.elapsedMs, plannedMs: this.timer.plannedMs }, learning,
    };
  }
  snapshot() {
    return { version: 1, revision: this.revision, timer: { ...this.timer },
      tags: this.db.prepare('SELECT * FROM tags ORDER BY created_at, rowid').all(),
      todos: this.db.prepare('SELECT * FROM todos ORDER BY created_at DESC, rowid DESC').all(),
      todoEvents: this.db.prepare('SELECT * FROM todo_events ORDER BY at, rowid').all(),
      notes: this.db.prepare('SELECT * FROM notes ORDER BY updated_at DESC, rowid DESC').all(),
      daily: this.db.prepare('SELECT * FROM daily_entries ORDER BY day').all(),
      sessions: this.db.prepare('SELECT * FROM sessions ORDER BY started_at').all(),
      segments: this.db.prepare('SELECT * FROM segments ORDER BY start_at').all() };
  }
  exportData() { return { exportedAt: new Date(this.now()).toISOString(), ...this.snapshot() }; }
  close() {
    if (this.timer.status === 'running') this.dispatch('timer.pause');
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    this.db.close();
  }
}
module.exports = { StudyStore, FOCUS_MS, BREAK_MS, MOODS, COLORS, dayKey };
