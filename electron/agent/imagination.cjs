const { prompt, persona } = require('./config.cjs');
const { visibleReply } = require('./deepseek.cjs');

class Imagination {
  constructor(store, provider, settings, random = Math.random) { Object.assign(this, { store, provider, settings, random }); }
  async sample(context, signal) {
    if (this.random() >= this.settings.fantasy_probability) return null;
    const directory = this.settings.prompt_directory;
    const value = await this.provider.object(prompt('imagination-context', directory), {
      persona: persona(directory), relationship: this.store.relationship()?.narrative,
      current: context, memories: this.store.wander(3, this.random),
    }, signal);
    if (typeof value.fantasy !== 'string' || !value.fantasy.trim() || value.fantasy.length > 1800) throw new Error('幻想内容格式无效');
    return { fantasy: visibleReply(value.fantasy), fictional: true, ephemeral: true };
  }
}
module.exports = { Imagination };
