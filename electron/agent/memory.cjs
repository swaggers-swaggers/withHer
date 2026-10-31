const { randomUUID } = require('node:crypto');
const { prompt } = require('./config.cjs');
const { evidenceFor } = require('./relationship.cjs');
function validateFacts(value, rows, store) {
  if (!Array.isArray(value.facts) || value.facts.length > 40) throw new Error('事实整理格式无效');
  const keys = new Set();
  return value.facts.map(item => {
    if (!item || typeof item.key !== 'string' || !/^[\w.\u4e00-\u9fff-]{1,100}$/.test(item.key) || keys.has(item.key) || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 1200) throw new Error('事实条目格式无效');
    keys.add(item.key);
    const evidence = evidenceFor(item.evidence, rows);
    if (item.replaces !== undefined && (!Array.isArray(item.replaces) || item.replaces.length > 5)) throw new Error('事实更正规则无效');
    for (const id of item.replaces || []) {
      const prior = store.fact(id);
      if (!prior || prior.fact_key !== item.key) throw new Error('不能撤回无关事实');
    }
    return { key: item.key, text: item.text.trim(), evidence, replaces: item.replaces || [] };
  });
}
class FactMemory {
  constructor(store, provider, relationship, settings, now = Date.now) {
    this.store = store; this.provider = provider; this.relationship = relationship; this.settings = settings; this.now = now;
  }
  due() { return this.now() - this.store.meta('memory_attempt_at', 0) >= this.settings.memory_retry_ms && this.store.batch(this.settings).due; }
  async consolidate(signal, force = false) {
    const batch = this.store.batch(this.settings);
    if (!batch.rows.length || !batch.due && !force) return false;
    this.store.setMeta('memory_attempt_at', this.now());
    const previous = this.store.relationship()?.revision;
    const data = await this.provider.object(prompt('memory', this.settings.prompt_directory), { messages: batch.rows, previous_facts: this.store.factContext(100) }, signal);
    const facts = validateFacts(data, batch.rows, this.store);
    const feelings = await this.relationship.compose({ rows: batch.rows, facts, mode: 'batch' }, signal);
    signal?.throwIfAborted();
    // Both modules and the cursor move together. Failure or cancellation replays the same batch.
    this.store.transaction(() => {
      if (this.store.meta('memory_cursor', 0) !== batch.cursor || this.store.relationship()?.revision !== previous) throw new Error('整理期间状态已更新，将重新整理');
      this.store.commitFacts(facts, this.now());
      let revision = previous;
      if (feelings) {
        revision = this.store.saveRelationship(feelings, batch.rows.map(r => r.id), 'batch', this.now());
        if (feelings.motives !== null) this.store.setMeta('custom_motives', feelings.motives);
      }
      this.store.db.prepare('INSERT INTO batches(id,from_seq,through_seq,created_at,facts_count,relationship_revision) VALUES(?,?,?,?,?,?)')
        .run(randomUUID(), batch.cursor + 1, batch.throughSeq, this.now(), facts.length, revision);
      this.store.setMeta('memory_cursor', batch.throughSeq);
      this.store.setMeta('memory_error', '');
      this.store.log('memory.batch', { through: batch.throughSeq, facts: facts.length, relationshipRevision: revision }, this.now());
    });
    return true;
  }
}
module.exports = { FactMemory, validateFacts };
