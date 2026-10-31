const { prompt, persona } = require('./config.cjs');
const { validateMotives } = require('./motivation.cjs');
function evidenceFor(items, rows) {
  if (!Array.isArray(items) || !items.length || items.length > 12) throw new Error('缺少有效的用户原文依据');
  return items.map(item => {
    const row = rows.find(r => r.id === item?.message_id && r.role === 'user');
    if (!row || typeof item.quote !== 'string' || item.quote.trim().length < 2 || item.quote.length > 2000 || !row.content.includes(item.quote)) throw new Error('用户原文依据不匹配');
    return { message_id: row.id, quote: item.quote };
  });
}
class Relationship {
  constructor(store, provider, settings) { this.store = store; this.provider = provider; this.settings = settings; }
  async compose({ rows, facts, mode = 'batch', evidence = [], reason = '' }, signal) {
    const value = await this.provider.object(prompt('relationship', this.settings.prompt_directory), { mode, persona: persona(this.settings.prompt_directory),
      previous: this.store.relationship()?.narrative, memories: this.store.factContext(),
      new_facts: facts || [], dialogue: rows, significant_event_evidence: evidence, proposed_reason: reason }, signal);
    if (typeof value.should_update !== 'boolean') throw new Error('感情更新格式无效');
    if (!value.should_update) return null;
    if (mode === 'significant' && value.significant !== true) return null;
    if (typeof value.narrative !== 'string' || value.narrative.trim().length < 40 || value.narrative.length > this.settings.relationship_max_characters || typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 1500) throw new Error('感情与看法文字格式无效');
    return { narrative: value.narrative.trim(), reason: value.reason.trim(),
      motives: mode === 'batch' ? validateMotives(value.motives) : null };
  }
}
module.exports = { Relationship, evidenceFor };
