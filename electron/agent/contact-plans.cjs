const { randomUUID } = require('node:crypto');
const ACTIVE = new Set(['scheduled', 'running']);
const MINUTE = 60000;

class ContactPlans {
  constructor(store, settings, now = Date.now) { Object.assign(this, { store, settings, now }); }
  state() { return this.store.meta('contact_plans', { revision: 0, items: [] }); }
  write(s) {
    const active = s.items.filter(p => ACTIVE.has(p.status));
    const history = s.items.filter(p => !ACTIVE.has(p.status)).sort((a, b) => b.updated_at - a.updated_at).slice(0, 100);
    this.store.setMeta('contact_plans', { revision: s.revision + 1, items: [...active, ...history] });
  }
  summary() {
    const active = this.state().items.filter(p => ACTIVE.has(p.status) && p.expires_at > this.now());
    return { active_count: active.length, next_due_at: active.length ? Math.min(...active.map(p => p.due_at)) : null };
  }
  get(id) { return this.state().items.find(p => p.id === id) || null; }
  read({ include_finished = false, offset = 0, limit = 12 } = {}, candidate) {
    if (typeof include_finished !== 'boolean' || !Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('计划读取参数无效');
    const items = (candidate || this.state()).items.filter(p => include_finished || ACTIVE.has(p.status));
    return { items: items.slice(offset, offset + limit), next_offset: items.length > offset + limit ? offset + limit : null,
      note: '这是未来联系意图，不是已经发送的消息；应用退出时不执行。' };
  }
  timing(op) {
    let due;
    if (op.after_minutes !== undefined) {
      if (op.due_at !== undefined || !Number.isInteger(op.after_minutes) || op.after_minutes < 1 || op.after_minutes > 10080) throw new Error('计划时间无效');
      due = this.now() + op.after_minutes * MINUTE;
    } else {
      if (typeof op.due_at !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(op.due_at)) throw new Error('请提供带时区的ISO计划时间');
      due = Date.parse(op.due_at);
      if (!Number.isFinite(due) || due < this.now() + MINUTE || due > this.now() + 7 * 86400000) throw new Error('计划应在未来1分钟至7天内');
    }
    const grace = op.expire_after_minutes ?? 180;
    if (!Number.isInteger(grace) || grace < 1 || grace > 1440) throw new Error('计划有效期无效');
    return { due_at: due, expires_at: due + grace * MINUTE };
  }
  plan(operations, previous) {
    if (!Array.isArray(operations) || !operations.length || operations.length > 6) throw new Error('联系计划操作无效');
    const s = previous ? structuredClone(previous) : this.state();
    for (const op of operations) {
      if (!op || typeof op.key !== 'string' || !/^[\w.\u4e00-\u9fff-]{1,80}$/.test(op.key)) throw new Error('计划标识无效');
      const old = s.items.find(p => p.key === op.key && ACTIVE.has(p.status));
      if (old?.status === 'running') throw new Error('当前到期任务请使用contact_plan_decide决定发送、改期或取消');
      if (op.action === 'cancel') { if (old) Object.assign(old, { status: 'cancelled', updated_at: this.now() }); continue; }
      if (op.action !== 'upsert' || typeof op.intent !== 'string' || !op.intent.trim() || op.intent.length > 600) throw new Error('联系意图无效');
      const item = { id: old?.id || randomUUID(), key: op.key, intent: op.intent.trim(), ...this.timing(op),
        status: 'scheduled', created_at: old?.created_at || this.now(), updated_at: this.now(), last_attempt_at: 0 };
      if (old) Object.assign(old, item); else s.items.push(item);
    }
    if (s.items.filter(p => ACTIVE.has(p.status)).length > 12) throw new Error('最多保留12个有效联系计划');
    return s;
  }
  commit(candidate) {
    if (this.state().revision !== candidate.revision) throw new Error('联系计划已更新，请重新查阅');
    this.write(candidate);
  }
  expire() {
    const s = this.state(); let changed = false;
    for (const p of s.items) if (ACTIVE.has(p.status) && p.expires_at <= this.now()) { p.status = 'expired'; p.updated_at = this.now(); changed = true; }
    if (changed) this.write(s);
  }
  due() {
    this.expire();
    return this.state().items.filter(p => p.status === 'scheduled' && p.due_at <= this.now() &&
      (!p.last_attempt_at || this.now() - p.last_attempt_at >= this.settings.contact_plan_retry_ms))
      .sort((a, b) => a.due_at - b.due_at)[0] || null;
  }
  claim(id) {
    const s = this.state(), p = s.items.find(x => x.id === id);
    if (!p || p.status !== 'scheduled' || p.due_at > this.now() || p.expires_at <= this.now() ||
        p.last_attempt_at && this.now() - p.last_attempt_at < this.settings.contact_plan_retry_ms) return null;
    Object.assign(p, { status: 'running', last_attempt_at: this.now(), updated_at: this.now() }); this.write(s); return p;
  }
  finish(id) { this.changeRunning(id, p => { p.status = 'completed'; p.finished_at = this.now(); }); }
  release(id) { this.changeRunning(id, p => { p.status = p.expires_at <= this.now() ? 'expired' : 'scheduled'; }); }
  validateDecision(args) {
    if (!['send', 'skip', 'reschedule'].includes(args.action)) throw new Error('计划决定无效');
    return args.action === 'reschedule' ? { action: args.action, ...this.timing({ after_minutes: args.after_minutes, expire_after_minutes: args.expire_after_minutes }) } : { action: args.action };
  }
  resolve(id, decision) {
    this.changeRunning(id, p => {
      if (decision.action === 'skip') p.status = 'cancelled';
      else if (decision.action === 'reschedule') Object.assign(p, { status: 'scheduled', due_at: decision.due_at, expires_at: decision.expires_at, last_attempt_at: 0 });
    });
  }
  changeRunning(id, apply) {
    const s = this.state(), p = s.items.find(x => x.id === id);
    if (!p || p.status !== 'running') return;
    apply(p); p.updated_at = this.now(); this.write(s);
  }
  recover(pendingIds) {
    const s = this.state(); let changed = false;
    for (const p of s.items) if (p.status === 'running' && !pendingIds.has(p.id)) { p.status = 'scheduled'; p.updated_at = this.now(); changed = true; }
    if (changed) this.write(s);
  }
}
module.exports = { ContactPlans };
