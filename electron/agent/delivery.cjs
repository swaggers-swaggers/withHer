const { randomUUID } = require('node:crypto');

function replyDelay(settings, random = Math.random) {
  if (random() >= settings.reply_delay_probability) return 0;
  const unit = Math.max(0, Math.min(1, random()));
  return Math.round(settings.reply_delay_min_ms + unit * (settings.reply_delay_max_ms - settings.reply_delay_min_ms));
}
class DeliveryOutbox {
  constructor(store, settings, now = Date.now) { Object.assign(this, { store, settings, now }); }
  pending() { return this.store.db.prepare("SELECT * FROM delivery_outbox WHERE status='pending' ORDER BY due_at,created_at").all().map(r => this.decode(r)); }
  get(id) { return this.decode(this.store.db.prepare('SELECT * FROM delivery_outbox WHERE id=?').get(id)); }
  decode(row) { return row ? { ...row, payload: JSON.parse(row.payload_json) } : null; }
  stage(job, content, payload, delay) {
    const id = randomUUID(), now = this.now(), expires = Math.min(now + this.settings.delivery_max_age_ms, job.plan?.expires_at ?? Infinity);
    this.store.db.prepare(`INSERT INTO delivery_outbox(id,source_message_id,source_seq,baseline_seq,kind,plan_id,content,payload_json,due_at,expires_at,status,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, job.message?.id || null, job.message?.seq || null, job.baseline || null, job.kind,
        job.plan?.id || null, content, JSON.stringify(payload), now + delay, expires, 'pending', now);
    this.store.db.prepare("DELETE FROM delivery_outbox WHERE status<>'pending' AND rowid NOT IN (SELECT rowid FROM delivery_outbox ORDER BY rowid DESC LIMIT 500)").run();
    return this.get(id);
  }
  cancel(id, status = 'cancelled') {
    const row = this.get(id); if (!row || row.status !== 'pending') return;
    this.store.db.prepare("UPDATE delivery_outbox SET status=? WHERE id=? AND status='pending'").run(status, id);
    if (row.source_message_id) this.store.db.prepare("UPDATE messages SET status='interrupted' WHERE id=? AND status='pending'").run(row.source_message_id);
  }
  sent(id) { return this.store.db.prepare("UPDATE delivery_outbox SET status='sent',sent_at=? WHERE id=? AND status='pending'").run(this.now(), id).changes; }
}
module.exports = { DeliveryOutbox, replyDelay };
