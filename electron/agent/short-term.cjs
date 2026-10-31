const { evidenceFor } = require('./relationship.cjs');

class ShortTermMemory {
  constructor(store, now = Date.now) { this.store = store; this.now = now; }
  read() {
    const state = this.store.meta('short_term', { revision: 0, notes: [] });
    return { revision: state.revision, notes: state.notes.filter(n => n.expires_at > this.now()) };
  }
  plan(operations, rows, previous) {
    if (!Array.isArray(operations) || !operations.length || operations.length > 6) throw new Error('短期记忆操作格式无效');
    const current = previous || this.read();
    const notes = new Map(current.notes.filter(n => n.expires_at > this.now()).map(n => [n.key, n]));
    for (const op of operations) {
      if (!op || typeof op.key !== 'string' || !/^[\w.\u4e00-\u9fff-]{1,80}$/.test(op.key)) throw new Error('短期记忆标识无效');
      if (op.action === 'remove') { notes.delete(op.key); continue; }
      if (op.action !== 'upsert' || typeof op.text !== 'string' || !op.text.trim() || op.text.length > 600) throw new Error('短期记忆内容无效');
      const hours = op.expires_hours ?? 24;
      if (!Number.isInteger(hours) || hours < 1 || hours > 72) throw new Error('短期记忆期限无效');
      const evidence = evidenceFor(op.evidence, rows);
      notes.set(op.key, { key: op.key, text: op.text.trim(), evidence, updated_at: this.now(), expires_at: this.now() + hours * 3600000 });
    }
    if (notes.size > 12) throw new Error('短期记忆最多保留12条，请先移除已完成事项');
    return { revision: current.revision, notes: [...notes.values()] };
  }
  commit(candidate) {
    const current = this.read();
    if (current.revision !== candidate.revision) throw new Error('短期记忆已更新，请重试');
    const next = { revision: current.revision + 1, notes: candidate.notes.filter(n => n.expires_at > this.now()) };
    this.store.setMeta('short_term', next);
    this.store.log('short_term.update', { revision: next.revision, count: next.notes.length }, this.now());
  }
}
module.exports = { ShortTermMemory };
