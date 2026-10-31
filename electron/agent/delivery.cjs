const { randomUUID } = require('node:crypto');

class DeliveryOutbox {
  constructor(store, settings, now = Date.now) {
    Object.assign(this, { store, settings, now });
    // Previous releases queued whole replies. Never reinterpret those old drafts
    // as model-authored bubble plans; preserve history, cancel only unsent work.
    for (const row of this.store.db.prepare("SELECT id FROM delivery_outbox WHERE status='pending' AND NOT EXISTS (SELECT 1 FROM delivery_bubbles WHERE outbox_id=delivery_outbox.id)").all()) this.cancel(row.id);
  }
  pending() { return this.store.db.prepare("SELECT * FROM delivery_outbox WHERE status='pending' ORDER BY due_at,created_at").all().map(r => this.decode(r)); }
  hasPending() { return !!this.store.db.prepare("SELECT 1 FROM delivery_outbox WHERE status='pending' LIMIT 1").get(); }
  get(id) { return this.decode(this.store.db.prepare('SELECT * FROM delivery_outbox WHERE id=?').get(id)); }
  decode(row) { return row ? { ...row, payload: JSON.parse(row.payload_json) } : null; }
  next(id) { return this.store.db.prepare("SELECT * FROM delivery_bubbles WHERE outbox_id=? AND status='pending' ORDER BY position LIMIT 1").get(id) || null; }
  bubbles(id) { return this.store.db.prepare('SELECT * FROM delivery_bubbles WHERE outbox_id=? ORDER BY position').all(id); }
  stage(job, plan, payload) {
    const id = randomUUID(), now = this.now(), end = now + plan.bubbles.reduce((n, b) => n + b.after_ms, 0);
    const expires = Math.min(Math.max(now + this.settings.delivery_max_age_ms, end + this.settings.delivery_send_grace_ms), job.plan?.expires_at ?? Infinity);
    if (end >= expires) throw new Error('消息时间超出当前计划有效期，请改期或缩短间隔');
    const firstDue = now + plan.bubbles[0].after_ms;
    this.store.db.prepare(`INSERT INTO delivery_outbox(id,source_message_id,source_seq,baseline_seq,kind,plan_id,content,payload_json,due_at,expires_at,status,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, job.message?.id || null, job.message?.seq || null, job.baseline ?? null, job.kind,
        job.plan?.id || null, plan.bubbles.map(b => b.text).join('\n\n'), JSON.stringify({ protocol: 2, ...payload }), firstDue, expires, 'pending', now);
    let due = now;
    for (const [index, bubble] of plan.bubbles.entries()) {
      due += bubble.after_ms;
      this.store.db.prepare('INSERT INTO delivery_bubbles(outbox_id,position,content,kind,gap_ms,due_at,status) VALUES(?,?,?,?,?,?,?)')
        .run(id, index, bubble.text, bubble.kind, bubble.after_ms, due, 'pending');
    }
    return this.get(id);
  }
  cancel(id, status = 'cancelled') {
    const row = this.get(id); if (!row || row.status !== 'pending') return;
    this.store.transaction(() => {
      this.store.db.prepare("UPDATE delivery_bubbles SET status=? WHERE outbox_id=? AND status='pending'").run(status, id);
      this.store.db.prepare("UPDATE delivery_outbox SET status=? WHERE id=? AND status='pending'").run(status, id);
      if (row.source_message_id) this.store.db.prepare("UPDATE messages SET status='interrupted' WHERE id=? AND status='pending'").run(row.source_message_id);
    });
  }
  advance(id, position, message) {
    const changed = this.store.db.prepare("UPDATE delivery_bubbles SET status='sent',message_id=?,sent_at=? WHERE outbox_id=? AND position=? AND status='pending'")
      .run(message.id, this.now(), id, position).changes;
    if (!changed) throw new Error('气泡已经处理');
    const next = this.next(id);
    if (next) {
      // Resume the selected gap from actual delivery, never dump an overdue tail.
      const due = this.now() + next.gap_ms;
      this.store.db.prepare('UPDATE delivery_bubbles SET due_at=? WHERE outbox_id=? AND position=?').run(due, id, next.position);
      this.store.db.prepare('UPDATE delivery_outbox SET due_at=?,baseline_seq=? WHERE id=?').run(due, message.seq, id);
      return false;
    }
    this.store.db.prepare("UPDATE delivery_outbox SET status='sent',sent_at=?,baseline_seq=? WHERE id=? AND status='pending'").run(this.now(), message.seq, id);
    return true;
  }
}
module.exports = { DeliveryOutbox };
