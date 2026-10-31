const { visibleReply } = require('./deepseek.cjs');

// Character-authored drafts only. Never capture model reasoning or user facts.
class Unsaid {
  constructor(store, now = Date.now) { this.store = store; this.now = now; }
  state() { return this.store.meta('unsaid', { revision: 0, notes: [] }); }
  summary() { const s = this.state(); return { count: s.notes.length, revision: s.revision }; }
  read({ offset = 0, limit = 5 } = {}, candidate) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('待说片段读取范围无效');
    const s = candidate || this.state();
    return { kind: 'character_unsaid', revision: s.revision, items: s.notes.slice(offset, offset + limit), next_offset: s.notes.length > offset + limit ? offset + limit : null };
  }
  plan(operations, previous) {
    if (!Array.isArray(operations) || !operations.length || operations.length > 6) throw new Error('待说片段操作无效');
    const s = previous || this.state(), notes = new Map(s.notes.map(n => [n.key, n]));
    for (const op of operations) {
      if (!op || typeof op.key !== 'string' || !/^[\w.\u4e00-\u9fff-]{1,80}$/.test(op.key)) throw new Error('待说片段标识无效');
      if (op.action === 'remove') { notes.delete(op.key); continue; }
      if (op.action !== 'upsert' || typeof op.text !== 'string' || !op.text.trim() || op.text.length > 2000) throw new Error('待说片段内容无效');
      const text = visibleReply(op.text);
      notes.set(op.key, { key: op.key, text, kind: 'character_unsaid', updated_at: this.now() });
    }
    if (notes.size > 24) throw new Error('最多保留24条待说片段，请先整理旧内容');
    return { revision: s.revision, notes: [...notes.values()] };
  }
  commit(candidate) {
    if (this.state().revision !== candidate.revision) throw new Error('待说片段已更新，请重新查阅');
    this.store.setMeta('unsaid', { revision: candidate.revision + 1, notes: candidate.notes });
  }
}
module.exports = { Unsaid };
