const { createHash } = require('node:crypto');
class StudyReader {
  constructor(store, snapshot, now = Date.now) { this.store = store; this.snapshot = snapshot; this.now = now; this.error = ''; }
  sync() {
    try {
      const value = this.snapshot();
      const fingerprint = createHash('sha256').update(JSON.stringify({ todos: value.todos, notes: value.notes })).digest('hex');
      if (this.fingerprint !== fingerprint) {
        const records = [];
        for (const todo of value.todos || []) {
          if (todo.deleted_at) continue;
          records.push({ id: 'todo:' + todo.id, kind: 'todo', text: JSON.stringify({ 来源: 'StudyDesk待办原文', ...todo }), at: todo.created_at || this.now() });
        }
        for (const note of value.notes || []) {
          if (note.deleted_at || !note.body?.trim()) continue;
          const chars = Array.from(note.body);
          for (let offset = 0; offset < chars.length; offset += 3000) records.push({
            id: `note:${note.id}:${offset / 3000 + 1}`, kind: 'note',
            text: JSON.stringify({ 来源: 'StudyDesk随手记原文', id: note.id, part: offset / 3000 + 1, body: chars.slice(offset, offset + 3000).join('') }), at: note.updated_at || this.now(),
          });
        }
        this.store.transaction(() => {
          const desired = new Set(records.map(r => r.id));
          for (const row of this.store.db.prepare('SELECT id FROM study_records').all()) if (!desired.has(row.id)) this.store.db.prepare('DELETE FROM study_records WHERE id=?').run(row.id);
          for (const row of records) this.store.db.prepare(`INSERT INTO study_records(id,kind,text,updated_at) VALUES(?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET text=excluded.text,updated_at=excluded.updated_at WHERE text<>excluded.text`).run(row.id, row.kind, row.text, row.at);
        });
        this.fingerprint = fingerprint;
      }
      this.current = value;
      this.error = '';
      return value;
    } catch (e) { this.error = '学习桌资料暂时未更新'; throw e; }
  }
  overview() {
    const s = this.sync();
    return { timer: s.timer, learning: s.learning,
      todos_count: (s.todos || []).filter(t => !t.deleted_at).length,
      notes_count: (s.notes || []).filter(n => !n.deleted_at).length,
      todos: (s.todos || []).filter(t => !t.deleted_at).slice(0, 15).map(t => ({ id: 'todo:' + t.id, title: t.title, completed_at: t.completed_at, tag: t.tag })),
      note_index: (s.notes || []).filter(n => !n.deleted_at).slice(0, 10).map(n => ({ id: 'note:' + n.id + ':1', preview: n.body.slice(0, 120) })),
      full_records: '使用memory_search(scope=study)分页查询任意记录，memory_read读取原文。' };
  }
  read(area = 'overview', offset = 0, limit = 10) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 30) throw new Error('读取范围无效');
    const s = this.sync();
    if (area === 'overview') return this.overview();
    if (['timer', 'learning'].includes(area)) return s[area];
    if (!['notes', 'todos'].includes(area)) throw new Error('学习桌范围无效');
    const rows = this.store.db.prepare('SELECT * FROM study_records WHERE kind=? ORDER BY updated_at DESC,id LIMIT ? OFFSET ?').all(area === 'notes' ? 'note' : 'todo', limit + 1, offset);
    return { items: rows.slice(0, limit), next_offset: rows.length > limit ? offset + limit : null };
  }
}
module.exports = { StudyReader };
