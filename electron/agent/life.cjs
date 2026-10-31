const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { prompt, persona } = require('./config.cjs');
const { ProviderError } = require('./deepseek.cjs');

const text = (value, limit, required = false) => {
  if (typeof value !== 'string' || value.length > limit || required && !value.trim()) throw new ProviderError('模拟生活记录格式无效');
  return value.trim();
};
class OwnLife {
  constructor(store, provider, web, settings, now = Date.now) {
    this.store = store; this.provider = provider; this.web = web; this.settings = settings; this.now = now;
    this.journalFile = path.join(path.dirname(store.file), '大肥鱼生活日记.md');
    this.publish();
  }
  current() { return this.store.db.prepare("SELECT * FROM life_activities WHERE status='running' ORDER BY started_at DESC LIMIT 1").get() || null; }
  decode(row) { return row ? { ...row, fictional: true, sources: JSON.parse(row.sources_json) } : null; }
  read({ offset = 0, limit = 3 } = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new ProviderError('生活日记读取范围无效');
    const rows = this.store.db.prepare('SELECT * FROM life_activities ORDER BY started_at DESC,rowid DESC LIMIT ? OFFSET ?').all(limit + 1, offset);
    return { fictional: true, current: this.decode(this.current()), interests: this.store.meta('life_interests', []),
      items: rows.slice(0, limit).map(r => this.decode(r)), next_offset: rows.length > limit ? offset + limit : null };
  }
  context() {
    const unshared = this.store.db.prepare("SELECT id,title,record,feeling,share_hook,finished_at,sources_json FROM life_activities WHERE status='complete' AND shared_at IS NULL ORDER BY finished_at DESC LIMIT 4").all();
    return { fictional: true, current: this.decode(this.current()), interests: this.store.meta('life_interests', []),
      recent: this.read({ limit: 4 }).items.map(r => ({ id: r.id, title: r.title, status: r.status,
        record: r.record.slice(0, 350), feeling: r.feeling, shared_at: r.shared_at, fictional: true })),
      unshared: unshared.slice(0, 2).map(r => this.decode(r)),
      note: '自己的模拟生活；不是用户现实事实，不补造双方共同经历。' };
  }
  due() {
    if (!this.settings.life_enabled || this.now() - this.store.meta('life_attempt_at', 0) < this.settings.life_retry_ms) return false;
    const current = this.current();
    return current ? this.now() >= current.due_at : this.now() >= this.store.meta('life_next_at', 0);
  }
  plan(args) {
    const title = text(args.title, 80, true), description = text(args.description, 500, true);
    const minutes = args.duration_minutes ?? 30;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) throw new ProviderError('模拟活动时长应为1至180分钟');
    if (args.replace_current !== undefined && typeof args.replace_current !== 'boolean') throw new ProviderError('生活计划参数无效');
    const current = this.current();
    if (current && !args.replace_current) throw new ProviderError('已经有正在进行的模拟活动；想换一件事时需明确替换当前计划');
    let interests = null;
    if (args.interests !== undefined) {
      if (!Array.isArray(args.interests) || !args.interests.length || args.interests.length > 6) throw new ProviderError('兴趣记录格式无效');
      interests = [...new Set(args.interests.map(s => text(s, 50, true)))];
    }
    return { title, description, minutes, search_query: text(args.search_query ?? '', 128), interests,
      expected_current: current?.id || null, replace_current: !!args.replace_current };
  }
  start(plan) {
    if ((this.current()?.id || null) !== plan.expected_current) throw new ProviderError('生活计划已变化，请重新查看');
    const now = this.now();
    if (plan.expected_current) this.store.db.prepare("UPDATE life_activities SET status='abandoned',finished_at=?,record=? WHERE id=?")
      .run(now, '这件事先搁下，还没有做完；决定换个念头继续。', plan.expected_current);
    const id = randomUUID();
    this.store.db.prepare(`INSERT INTO life_activities(id,title,description,started_at,due_at,status,search_query)
      VALUES(?,?,?,?,?,'running',?)`).run(id, plan.title, plan.description, now, now + plan.minutes * 60000, plan.search_query);
    if (plan.interests) this.store.setMeta('life_interests', plan.interests);
    this.store.setMeta('life_attempt_at', 0); this.store.setMeta('life_error', '');
    this.store.log('life.start', { id, title: plan.title, fictional: true }, now);
    return id;
  }
  validateShared(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 4) throw new ProviderError('分享记录编号无效');
    return [...new Set(ids.map(id => {
      if (typeof id !== 'string' || !this.store.db.prepare("SELECT id FROM life_activities WHERE id=? AND status='complete'").get(id)) throw new ProviderError('只能标记已经完成的生活记录');
      return id;
    }))];
  }
  markShared(ids) {
    for (const id of this.validateShared(ids)) this.store.db.prepare('UPDATE life_activities SET shared_at=COALESCE(shared_at,?) WHERE id=?').run(this.now(), id);
  }
  async advance(signal) {
    if (!this.due()) return;
    const activity = this.current(); this.store.setMeta('life_attempt_at', this.now());
    let online = null, sources = [];
    if (activity?.search_query) {
      try {
        const search = await this.web.search({ query: activity.search_query, count: 3 }, signal);
        if (search.results.length) {
          const selected = search.results[0];
          online = await this.web.read({ url: selected.url, max_chars: 3000 }, signal);
          sources = [{ title: selected.title, url: selected.url, fetched_at: online.fetched_at }];
        } else online = { status: 'no_results', note: '未查到资料，不能说已经读过。' };
      } catch (e) {
        if (signal.aborted) throw e;
        online = { status: 'unavailable', note: '本次网页未能读取，不能声称看完了内容。' };
      }
    }
    const directory = this.settings.prompt_directory;
    const result = await this.provider.object(prompt('life', directory), {
      task: activity ? 'finish_activity' : 'choose_activity', current_time: new Date(this.now()).toISOString(),
      timezone: this.settings.timezone, persona: persona(directory), own_life: this.context(),
      dialogue: this.store.recent(Number.MAX_SAFE_INTEGER, 200),
      public_news: activity ? [] : this.store.db.prepare('SELECT title,url,snippet,published_at,fetched_at FROM news WHERE fetched_at>? ORDER BY fetched_at DESC LIMIT 3').all(this.now() - this.settings.news_max_age_ms),
      online_material: online, note: '生活场景为模拟。对话只供理解当下，活动可以独立于用户。'
    }, signal);
    signal.throwIfAborted();
    if (!activity) {
      const plan = this.plan(result);
      this.store.transaction(() => this.start(plan));
    } else {
      const record = text(result.record, 1600, true), feeling = text(result.feeling ?? '', 240), hook = text(result.share_hook ?? '', 300);
      this.store.transaction(() => {
        if (this.current()?.id !== activity.id) throw new ProviderError('生活计划已变化，本次不覆盖');
        this.store.db.prepare("UPDATE life_activities SET status='complete',finished_at=?,record=?,feeling=?,share_hook=?,sources_json=? WHERE id=?")
          .run(this.now(), record, feeling, hook, JSON.stringify(sources), activity.id);
        this.store.setMeta('life_next_at', this.now() + this.settings.life_pause_ms);
        this.store.setMeta('life_attempt_at', 0); this.store.setMeta('life_error', '');
        this.store.log('life.complete', { id: activity.id, fictional: true, sources: sources.length }, this.now());
      });
    }
    this.publish();
  }
  publish() {
    try {
      const rows = this.read({ limit: 20 }).items;
      const date = n => new Intl.DateTimeFormat('zh-CN', { timeZone: this.settings.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(n);
      let body = '# 大肥鱼自己的生活\n\n这里记录她持续模拟的生活，不属于用户事实，也不代表没有工具回执的现实操作。\n\n';
      if (!rows.length) body += '生活日记刚刚开始，第一件事由她自己选择。\n';
      for (const row of rows.reverse()) {
        body += `## ${row.title}\n\n开始：${date(row.started_at)}；${row.status === 'running' ? '正在进行' : row.status === 'complete' ? '已记下' : '暂时搁下'}\n\n`;
        body += row.status === 'running' ? `打算：${row.description}\n\n` : `${row.record}\n\n`;
        if (row.feeling) body += `此刻感受：${row.feeling}\n\n`;
        if (row.share_hook) body += `想分享的小事：${row.share_hook}\n\n`;
        for (const source of row.sources) body += `资料：[${source.title}](${source.url})\n\n`;
      }
      fs.writeFileSync(this.journalFile + '.tmp', body, { mode: 0o600 }); fs.renameSync(this.journalFile + '.tmp', this.journalFile);
    } catch { this.store.log('life.journal_error', { note: 'SQLite记录仍保留，日记文件可重新生成' }, this.now()); }
  }
}
module.exports = { OwnLife };
