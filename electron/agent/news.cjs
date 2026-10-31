const { createHash } = require('node:crypto');
class OnlineInfo {
  constructor(store, provider, settings, now = Date.now) { this.store = store; this.provider = provider; this.settings = settings; this.now = now; }
  due() {
    const now = this.now(), success = this.store.meta('news_success_at', 0), attempt = this.store.meta('news_attempt_at', 0);
    return now - success >= this.settings.news_refresh_ms && now - attempt >= this.settings.news_retry_ms;
  }
  items() {
    return this.store.db.prepare('SELECT title,url,snippet,published_at,fetched_at FROM news WHERE fetched_at>=? AND (published_at IS NULL OR published_at>=?) ORDER BY fetched_at DESC LIMIT 8')
      .all(this.now() - this.settings.news_max_age_ms, this.now() - this.settings.news_max_age_ms);
  }
  async refresh(signal) {
    const now = this.now(); this.store.setMeta('news_attempt_at', now);
    const date = new Date(now - this.settings.news_max_age_ms).toISOString().slice(0, 10);
    const index = this.store.meta('news_topic_index', 0), topics = this.settings.news_topics;
    // Only public topic keywords leave the app, never dialogue or personal records.
    const response = await this.provider.search((topics[index % topics.length] + ' after:' + date).slice(0, 128), signal);
    if (!Array.isArray(response.results)) throw new Error('在线信息格式无效');
    signal?.throwIfAborted();
    const items = [];
    for (const row of response.results.slice(0, 10)) {
      let url;
      try { url = new URL(row.url); } catch { continue; }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || typeof row.title !== 'string' || !row.title.trim()) continue;
      const published = Date.parse(row.date);
      if (Number.isFinite(published) && (published < now - this.settings.news_max_age_ms || published > now + 3600000)) continue;
      const text = typeof row.summary === 'string' ? row.summary : typeof row.snippet === 'string' ? row.snippet : '';
      items.push({ id: createHash('sha256').update(url.href).digest('hex'), title: row.title.slice(0, 200), url: url.href, snippet: text.slice(0, 1000), published: Number.isFinite(published) ? published : null });
    }
    this.store.transaction(() => {
      for (const row of items) this.store.db.prepare('INSERT OR REPLACE INTO news(id,title,url,snippet,published_at,fetched_at) VALUES(?,?,?,?,?,?)').run(row.id, row.title, row.url, row.snippet, row.published, now);
      this.store.db.prepare('DELETE FROM news WHERE fetched_at<?').run(now - this.settings.news_max_age_ms);
      this.store.setMeta('news_success_at', now); this.store.setMeta('news_topic_index', index + 1);
      this.store.log('news.refresh', { count: items.length, at: now }, now);
    });
    return items.length;
  }
}
module.exports = { OnlineInfo };
