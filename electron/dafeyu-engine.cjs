const { AgentStore, CONVERSATION } = require('./agent/store.cjs');
const { loadConfig, writeJSON, prompt, persona, tokens } = require('./agent/config.cjs');
const { DeepSeek, ProviderError } = require('./agent/deepseek.cjs');
const { StudyReader } = require('./agent/study.cjs');
const { Relationship, evidenceFor } = require('./agent/relationship.cjs');
const { FactMemory } = require('./agent/memory.cjs');
const { Motivation } = require('./agent/motivation.cjs');
const { OnlineInfo } = require('./agent/news.cjs');
const { eligible } = require('./agent/scheduler.cjs');
const { TOOLS } = require('./agent/tools.cjs');
const { ShortTermMemory } = require('./agent/short-term.cjs');
const { WebResearch } = require('./agent/web.cjs');
const { OwnLife } = require('./agent/life.cjs');
const { Unsaid } = require('./agent/unsaid.cjs');
const { Imagination } = require('./agent/imagination.cjs');
const { ContactPlans } = require('./agent/contact-plans.cjs');
const { DeliveryOutbox } = require('./agent/delivery.cjs');
const { parseReplyPlan } = require('./agent/reply-plan.cjs');
const background = kind => kind === 'maintenance' || kind === 'life';
const autonomous = kind => kind === 'proactive' || kind === 'planned';
const generating = job => !!job && !background(job.kind) && !job.outboxId;

class DafeyuEngine {
  constructor(dataDir, vault, options) {
    this.vault = vault; this.emit = options.emit; this.presence = options.presence;
    this.now = options.now || Date.now; this.random = options.random || Math.random;
    const loaded = loadConfig(dataDir); this.config = { ...loaded.config, ...options.settings }; this.configFile = loaded.file;
    this.store = new AgentStore(dataDir);
    this.unsaid = new Unsaid(this.store, this.now);
    this.plans = new ContactPlans(this.store, this.config, this.now);
    this.outbox = new DeliveryOutbox(this.store, this.config, this.now);
    this.plans.recover(new Set(this.outbox.pending().map(r => r.plan_id).filter(Boolean)));
    this.shortTerm = new ShortTermMemory(this.store, this.now);
    this.provider = new DeepSeek(vault, options.remoteFetch, this.config);
    this.web = new WebResearch(this.provider, this.now);
    this.life = new OwnLife(this.store, this.provider, this.web, this.config, this.now);
    this.study = new StudyReader(this.store, options.studySnapshot, this.now);
    this.relationship = new Relationship(this.store, this.provider, this.config);
    this.memory = new FactMemory(this.store, this.provider, this.relationship, this.config, this.now);
    this.motivation = new Motivation(this.store, this.provider, this.random);
    this.imagination = new Imagination(this.store, this.provider, this.config, this.random);
    this.news = new OnlineInfo(this.store, this.provider, this.config, this.now);
    this.status = 'stopped'; this.error = ''; this.busy = false; this.closed = false;
    this.manualPause = false; this.typingUntil = 0; this.startedAt = this.now(); this.queue = []; this.active = null;
    this.publishStudy();
    writeJSON(this.configFile, this.config);
  }
  changed() { if (!this.closed) this.emit({ type: 'state' }); }
  report(error) {
    this.error = error instanceof ProviderError ? error.message : error?.name === 'TimeoutError' ? '回复等待超时，请稍后再试' : '聊天暂时遇到问题，请稍后再试';
    this.changed();
  }
  state() {
    return { conversation: { id: CONVERSATION, title: '大肥鱼' }, messages: this.store.messages(), config: { model: this.config.model },
      credentials: this.vault.status(), busy: this.busy, waiting: this.outbox.hasPending(),
      engine: { name: 'Dafeyu', status: this.status, error: this.error, paused: this.manualPause,
        studyMemoryError: this.study.error || this.store.meta('memory_error', ''),
        memoryCursor: this.store.meta('memory_cursor', 0), relationshipRevision: this.store.relationship()?.revision,
        newsUpdatedAt: this.store.meta('news_success_at', 0),
        lifeActivity: this.life.current()?.title || '', lifeError: this.store.meta('life_error', '') } };
  }
  publishStudy() { if (!this.closed) this.study.sync(); }
  async command(action, input = {}) {
    if (this.closed) throw new ProviderError('应用正在退出');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProviderError('输入格式无效');
    switch (action) {
      case 'chat.send': {
        if (typeof input.content !== 'string' || !input.content.trim() || input.content.length > 6000) throw new ProviderError('消息应为1到6000字');
        if (this.status !== 'ready') throw new ProviderError('请先启用聊天');
        if (!this.vault.status().configured) throw new ProviderError('请先填写DeepSeek API密钥');
        if (this.queue.filter(t => t.kind === 'user').length >= 8) throw new ProviderError('还有几条消息正在处理，请稍等');
        this.error = ''; this.manualPause = false;
        this.discardPending();
        this.active?.controller.abort();
        for (const job of this.queue) {
          if (job.plan) this.plans.release(job.plan.id);
          if (job.message) this.store.db.prepare("UPDATE messages SET status='interrupted' WHERE id=? AND status='pending'").run(job.message.id);
        }
        this.queue = []; this.store.setMeta('response_quiet_until', 0);
        const message = this.store.addMessage('user', input.content.trim(), this.now(), { status: 'pending' });
        this.enqueue({ kind: 'user', message });
        break;
      }
      case 'chat.typing':
        this.typingUntil = this.now() + 20000;
        if (autonomous(this.active?.kind)) this.active.controller.abort();
        return {};
      case 'chat.stop': this.manualPause = true; await this.cancel(); break;
      case 'messages.older':
        if (input.id !== CONVERSATION || !Number.isSafeInteger(input.before) || input.before < 1) throw new ProviderError('记录范围无效');
        return { messages: this.store.messages(input.before) };
      case 'credentials.save':
        await this.cancel(); this.vault.save(input.key); this.manualPause = false; break;
      case 'credentials.clear': await this.stop(); this.vault.clear(); this.config.enabled = false; this.save(); break;
      case 'config.save':
        if (typeof input.model !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(input.model)) throw new ProviderError('模型名称无效');
        if (this.config.model !== input.model) { await this.cancel(); this.config.model = input.model; this.save(); }
        break;
      case 'connection.check':
        if (this.active) throw new ProviderError('请等待当前回复结束');
        await this.provider.complete([{ role: 'user', content: '只回复“好”。' }]); break;
      case 'engine.start': await this.start(); this.config.enabled = true; this.save(); break;
      case 'engine.stop': this.config.enabled = false; this.save(); await this.stop(); break;
      default: throw new ProviderError('不支持的聊天操作');
    }
    this.changed(); return { state: this.state() };
  }
  save() { writeJSON(this.configFile, this.config); }
  async start() {
    if (this.closed) throw new ProviderError('应用正在退出');
    if (!this.vault.status().configured) throw new ProviderError('请先填写DeepSeek API密钥');
    if (this.status === 'ready') { this.manualPause = false; this.changed(); return; }
    this.status = 'ready'; this.error = ''; this.manualPause = false; this.publishStudy();
    // Start is local and immediate. No network is required to open existing records.
    this.timer = setInterval(() => { void this.tick().catch(e => this.report(e)); }, this.config.tick_ms);
    this.timer.unref?.(); this.changed();
    this.armDelivery();
  }
  armDelivery() {
    clearTimeout(this.deliveryTimer);
    if (this.closed || this.status !== 'ready' || this.manualPause) return;
    const row = this.outbox.pending()[0]; if (!row) return;
    if (this.active?.outboxId === row.id || this.queue.some(j => j.outboxId === row.id)) return;
    const due = Math.min(row.due_at, row.expires_at);
    this.deliveryTimer = setTimeout(() => {
      this.deliveryTimer = null;
      if (this.closed || this.status !== 'ready' || this.manualPause) return;
      if (this.active && background(this.active.kind)) this.active.controller.abort();
      this.queueDelivery(row.id);
    }, Math.max(0, due - this.now()));
    this.deliveryTimer.unref?.();
  }
  queueDelivery(id) {
    const row = this.outbox.get(id);
    if (!row || row.status !== 'pending' || this.active?.outboxId === id || this.queue.some(j => j.outboxId === id)) return;
    const message = row.source_message_id ? this.store.db.prepare('SELECT id,seq FROM messages WHERE id=?').get(row.source_message_id) : null;
    if (row.source_message_id && !message) { this.outbox.cancel(id); return; }
    this.enqueue({ kind: row.kind, message, baseline: row.baseline_seq, outboxId: row.id, plan: row.plan_id ? this.plans.get(row.plan_id) : null });
  }
  enqueue(job) {
    this.queue.push(job); this.busy = this.queue.some(generating) || generating(this.active); this.changed();
    if (!this.draining) this.draining = Promise.resolve().then(() => this.drain()).finally(() => { this.draining = null; if (this.queue.length) this.enqueueDrain(); });
  }
  enqueueDrain() { if (!this.draining) this.draining = this.drain().finally(() => { this.draining = null; if (this.queue.length) this.enqueueDrain(); }); }
  async drain() {
    while (!this.closed && this.status === 'ready' && !this.manualPause && this.queue.length) {
      const job = this.queue.shift(); job.controller = new AbortController(); this.active = job;
      try {
        if (job.kind === 'maintenance') await this.maintain(job.controller.signal);
        else if (job.kind === 'life') await this.life.advance(job.controller.signal);
        else if (job.outboxId) await this.deliver(job);
        else await this.reply(job);
      } catch (e) {
        if (this.closed) return;
        if (!job.preservePending) {
          if (job.outboxId) this.outbox.cancel(job.outboxId, job.controller.signal.aborted ? 'cancelled' : 'failed');
          if (job.message) this.store.db.prepare("UPDATE messages SET status=? WHERE id=?").run(job.controller.signal.aborted ? 'interrupted' : 'failed', job.message.id);
          if (job.plan) this.plans.release(job.plan.id);
        }
        if (!job.controller.signal.aborted) {
          if (job.kind === 'planned') this.store.log('contact.error', { id: job.plan.id, retry: true }, this.now());
          else if (background(job.kind)) {
            if (job.kind === 'life') this.store.setMeta('life_error', '生活记录暂未整理好，原计划保留，稍后继续');
            this.store.log(job.kind + '.error', { message: e instanceof ProviderError ? e.message : '内部整理失败，保留原状态重试' }, this.now());
          }
          else { this.report(e); this.emit({ type: 'error', message: this.error }); }
        }
      } finally { this.active = null; this.busy = this.queue.some(generating); this.changed(); }
    }
    this.busy = false; this.changed(); this.armDelivery();
  }
  discardPending() {
    clearTimeout(this.deliveryTimer);
    for (const row of this.outbox.pending()) {
      this.outbox.cancel(row.id);
      if (row.plan_id) this.plans.release(row.plan_id);
    }
  }
  async cancel({ preservePending = false } = {}) {
    clearTimeout(this.deliveryTimer);
    if (!preservePending) this.discardPending();
    for (const job of this.queue) if (job.message && !(preservePending && job.outboxId)) this.store.db.prepare("UPDATE messages SET status='interrupted' WHERE id=?").run(job.message.id);
    for (const job of this.queue) if (job.plan && !(preservePending && job.outboxId)) this.plans.release(job.plan.id);
    if (this.active) this.active.preservePending = preservePending && !!this.active.outboxId;
    this.queue = []; this.active?.controller.abort();
    if (this.draining) await this.draining;
    this.busy = false; this.changed();
  }
  async stop(options) { this.status = 'stopped'; clearInterval(this.timer); await this.cancel(options); this.changed(); }
  async syncPresence() {
    if (this.closed) return;
    const p = this.presence();
    if ((!p.available || p.focus || this.typingUntil > this.now()) && autonomous(this.active?.kind)) this.active.controller.abort();
  }
  async tick() {
    if (this.status !== 'ready' || this.closed || this.manualPause) return;
    this.publishStudy(); await this.syncPresence();
    if (this.active || this.queue.length) return;
    const pending = this.outbox.pending()[0];
    if (pending && Math.min(pending.due_at, pending.expires_at) <= this.now()) { this.queueDelivery(pending.id); return; }
    if (pending) {
      this.armDelivery();
      if (this.memory.due() || this.news.due()) this.enqueue({ kind: 'maintenance' });
      else if (this.life.due()) this.enqueue({ kind: 'life' });
      return;
    }
    if (this.store.meta('response_quiet_until', 0) > this.now()) {
      if (this.memory.due() || this.news.due()) this.enqueue({ kind: 'maintenance' });
      else if (this.life.due()) this.enqueue({ kind: 'life' });
      return;
    }
    const p = this.presence(), plan = this.plans.due();
    if (plan && p.available && !p.focus && this.typingUntil <= this.now() &&
        this.now() - this.store.lastEvent() >= this.config.contact_plan_min_gap_ms) {
      const claimed = this.plans.claim(plan.id);
      if (claimed) { this.enqueue({ kind: 'planned', plan: claimed, baseline: this.store.latestSeq(), trigger: 'contact-plan' }); return; }
    }
    const decision = eligible({ now: this.now(), presence: this.presence(), busy: this.busy, paused: this.manualPause,
      typingUntil: this.typingUntil, lastEvent: Math.max(this.store.lastEvent(), this.store.meta('response_decision_at', 0)), startedAt: this.startedAt,
      lastAttempt: this.store.meta('proactive_attempt_at', 0), settings: this.config, random: this.random });
    if (decision.trigger) {
      this.store.setMeta('proactive_attempt_at', this.now());
      this.enqueue({ kind: 'proactive', trigger: decision.reason, baseline: this.store.latestSeq() });
    } else if (this.memory.due() || this.news.due()) this.enqueue({ kind: 'maintenance' });
    else if (this.life.due()) this.enqueue({ kind: 'life' });
  }
  async maintain(signal) {
    if (this.memory.due()) {
      try { await this.memory.consolidate(signal); }
      catch (e) {
        if (signal.aborted) throw e;
        this.store.setMeta('memory_error', '上次记忆整理未完成，原记录已保留，稍后重试');
        this.store.log('memory.error', { preserved: true }, this.now());
      }
    }
    signal.throwIfAborted();
    if (this.news.due()) await this.news.refresh(signal);
  }
  async invokeTool(call, job, context) {
    if (!call || call.type !== 'function' || typeof call.id !== 'string' || typeof call.function?.name !== 'string') throw new Error('工具调用格式无效');
    if (typeof call.function.arguments !== 'string' || call.function.arguments.length > 12000) throw new Error('工具参数无效');
    const args = JSON.parse(call.function.arguments);
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数无效');
    const signal = job.controller.signal;
    switch (call.function.name) {
      case 'unsaid_read': return this.unsaid.read(args, job.unsaidCandidate);
      case 'unsaid_update':
        job.unsaidCandidate = this.unsaid.plan(args.operations, job.unsaidCandidate);
        return { pending: true, count: job.unsaidCandidate.notes.length, note: '只保存角色自主撰写的待说片段，不保存推理过程；本轮成功完成后生效。' };
      case 'contact_plan_read': return this.plans.read(args, job.planCandidate);
      case 'contact_plan_update':
        job.planCandidate = this.plans.plan(args.operations, job.planCandidate);
        return { pending: true, active_count: job.planCandidate.items.filter(p => ['scheduled', 'running'].includes(p.status)).length };
      case 'contact_plan_decide':
        if (job.kind !== 'planned') throw new ProviderError('只有到期计划可以使用此决定');
        job.planDecision = this.plans.validateDecision(args);
        return { action: job.planDecision.action, silent: job.planDecision.action !== 'send' };
      case 'life_read': return this.life.read(args);
      case 'life_plan':
        job.lifePlan = this.life.plan(args);
        return { pending: true, title: job.lifePlan.title, description: job.lifePlan.description,
          note: '有效回复完成后保存为正在进行的模拟活动，不能称为已完成。' };
      case 'life_mark_shared':
        if (!Array.isArray(args.ids)) throw new ProviderError('分享记录编号无效');
        job.lifeShared = this.life.validateShared([...(job.lifeShared || []), ...(Array.isArray(args.ids) ? args.ids : [])]);
        return { pending: true, ids: job.lifeShared };
      case 'web_search':
        job.webSearches ||= new Map();
        return this.web.search(args, signal, job.webSearches);
      case 'web_fetch':
        job.webPages ||= new Map();
        return this.web.read(args, signal, job.webPages);
      case 'short_term_update':
        job.shortTermCandidate = this.shortTerm.plan(args.operations, context.dialogue, job.shortTermCandidate);
        return { pending: true, ...job.shortTermCandidate, note: '完成本次有效回复后保存；取消或失败不保存。' };
      case 'memory_search': return this.store.search(args);
      case 'memory_read': return this.store.read(args.id, args.scope);
      case 'memory_wander':
        if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 5)) throw new Error('随机记忆数量无效');
        return this.store.wander(args.limit || 3, this.random);
      case 'study_read': return this.study.read(args.area, args.offset, args.limit);
      case 'relationship_reconsider': {
        if (job.kind !== 'user' || job.relationshipChecked) return { updated: false, reason: '本轮无需重复重写，普通变化在记忆整理时更新' };
        job.relationshipChecked = true;
        if (typeof args.reason !== 'string' || args.reason.trim().length < 10 || args.reason.length > 1500) throw new Error('重大影响原因无效');
        const evidence = evidenceFor(args.evidence, [job.message]);
        job.relationshipCandidate = await this.relationship.compose({ rows: context.dialogue, mode: 'significant', evidence, reason: args.reason }, signal);
        return { updated: !!job.relationshipCandidate, narrative: job.relationshipCandidate?.narrative || this.store.relationship().narrative };
      }
      default: throw new Error('没有这个工具');
    }
  }
  async reply(job) {
    const signal = job.controller.signal;
    if (autonomous(job.kind) && !this.autonomousAllowed(job)) { if (job.plan) this.plans.release(job.plan.id); return; }
    const currentSeq = job.message?.seq || job.baseline;
    const dialogue = this.store.recent(currentSeq, 200);
    const ownLife = this.life.context();
    const share = ownLife.unshared[0];
    const motive = share && job.kind === 'proactive' && this.random() < 0.65 ? { id: 'life_share', text: '想自然分享自己最近生活中的一个小细节', record_id: share.id } : this.motivation.choose();
    const context = { now: new Date(this.now()).toISOString(), timezone: this.config.timezone,
      trigger: job.kind === 'user' ? 'user' : job.kind === 'planned' ? 'planned' : 'proactive',
      scheduled_contact: job.plan ? { id: job.plan.id, key: job.plan.key, intent: job.plan.intent, due_at: job.plan.due_at, expires_at: job.plan.expires_at } : null,
      unsaid_available: this.unsaid.summary(), contact_plans_available: this.plans.summary(),
      delivery_contract: { max_bubbles: this.config.reply_max_bubbles, max_total_characters: this.config.reply_max_characters,
        max_total_wait_ms: this.config.reply_max_schedule_ms, first_after_ms_min: 0, subsequent_after_ms_min: 1,
        note: '这些只是资源上限，不是推荐数量。你自主决定沉默或发送，气泡边界和每个间隔。' },
      dialogue,
      dialogue_meta: { limit: 200, count: dialogue.length, content_truncated: false, token_budget_applied: false,
        first_message_id: dialogue[0]?.id || null, last_message_id: dialogue.at(-1)?.id || null },
      short_term_memory: this.shortTerm.read(),
      relationship: this.store.relationship()?.narrative,
      motive, own_life: ownLife, study: this.study.overview(), news: this.news.items(),
      news_note: '在线信息仅是可选素材，未知发布时间标为null；不必每次参考。' };
    try { job.fantasy = await this.imagination.sample(context, signal); }
    catch (e) {
      if (signal.aborted) throw e;
      this.store.log('imagination.error', { skipped: true }, this.now());
    }
    context.imagination = job.fantasy || null;
    // History is an attributed document with the latest 200 complete messages.
    // Only this turn's assistant
    // tool protocol enters API messages, preserving all its reasoning verbatim.
    const directory = this.config.prompt_directory;
    const messages = [{ role: 'system', content: persona(directory) + '\n\n' + prompt('reply', directory) + '\n\n' + prompt('short-term', directory) + '\n\n' + prompt('web', directory) + '\n\n' + prompt('life-context', directory) + '\n\n' + prompt('conversation-v23', directory) + '\n\n' + prompt('bubble-policy-v24', directory) }, { role: 'user', content: JSON.stringify(context) }];
    let response;
    for (let round = 0; round <= this.config.max_tool_rounds; round++) {
      signal.throwIfAborted();
      const finalRound = round === this.config.max_tool_rounds;
      const message = await this.provider.complete(messages, { tools: finalRound ? undefined : TOOLS, signal });
      if (!message.tool_calls?.length) { response = parseReplyPlan(message.content, this.config); break; }
      if (finalRound) throw new ProviderError('本轮查询较多，请换个说法再试');
      messages.push(message);
      for (const call of message.tool_calls) {
        let result;
        try { result = await this.invokeTool(call, job, context); }
        catch (e) {
          if (signal.aborted) throw e;
          result = { error: call.function?.name?.startsWith('web_')
            ? e instanceof ProviderError ? e.message : e?.name === 'TimeoutError' ? '联网查询超时，请稍后再试或换一个来源' : '联网查询未完成，请换一个来源或如实告知用户'
            : '工具未完成，请调整参数或直接自然回应；未更改事实和感情存档。' };
        }
        signal.throwIfAborted();
        let serialized = JSON.stringify(result ?? null);
        if (tokens(serialized) > 14000) serialized = JSON.stringify({ error: '结果较长，请缩小查询范围、减少limit或分次读取' });
        messages.push({ role: 'tool', tool_call_id: call.id, content: serialized });
        this.store.log('tool', { name: call.function.name, success: !result?.error }, this.now());
      }
      if (job.planDecision && job.planDecision.action !== 'send') {
        signal.throwIfAborted();
        if (!this.autonomousAllowed(job)) { this.plans.release(job.plan.id); return; }
        this.store.transaction(() => {
          // A silent decision may retain new private intentions, but nothing
          // has been shared: discard message-dependent life/memory effects.
          if (job.unsaidCandidate) this.unsaid.commit(job.unsaidCandidate);
          if (job.planCandidate) this.plans.commit(job.planCandidate);
          this.plans.resolve(job.plan.id, job.planDecision);
          this.store.setMeta('response_decision_at', this.now());
        });
        this.changed(); return;
      }
    }
    signal.throwIfAborted();
    if (!response) throw new ProviderError('这次没有生成完整的发送安排，请重试');
    if (autonomous(job.kind) && !this.autonomousAllowed(job)) { if (job.plan) this.plans.release(job.plan.id); return; }
    this.store.transaction(() => {
      // Private intentions are valid once the model has made a valid decision;
      // they do not mean any words have already reached the conversation.
      this.commitEffects({ ...job, lifeShared: undefined });
      this.store.setMeta('response_decision_at', this.now());
      if (response.decision === 'silent') {
        if (response.resume_after_ms !== undefined) this.store.setMeta('response_quiet_until', this.now() + response.resume_after_ms);
        if (job.message) this.store.db.prepare("UPDATE messages SET status='complete' WHERE id=?").run(job.message.id);
        if (job.plan) this.plans.finish(job.plan.id);
        this.store.log('response.silent', { sourceId: job.message?.id || null, resumeAfterMs: response.resume_after_ms ?? null }, this.now());
      } else {
        const row = this.outbox.stage(job, response, { lifeShared: job.lifeShared,
          motive: context.motive.text, fantasyUsed: !!job.fantasy, trigger: job.trigger || 'user' });
        job.outboxId = row.id;
        this.store.log('response.plan', { bubbles: response.bubbles.length, totalWaitMs: response.bubbles.reduce((n, b) => n + b.after_ms, 0) }, this.now());
      }
    });
    if (job.lifePlan) this.life.publish();
    this.error = ''; this.changed(); this.armDelivery();
  }
  autonomousAllowed(job) {
    const p = this.presence();
    return p.available && !p.focus && this.typingUntil <= this.now() && this.store.latestSeq() === job.baseline &&
      (!job.plan || this.plans.get(job.plan.id)?.status === 'running' && job.plan.expires_at > this.now());
  }
  commitEffects(effects) {
    if (effects.unsaidCandidate) this.unsaid.commit(effects.unsaidCandidate);
    if (effects.planCandidate) this.plans.commit(effects.planCandidate);
    if (effects.lifePlan) this.life.start(effects.lifePlan);
    if (effects.lifeShared?.length) this.life.markShared(effects.lifeShared);
    if (effects.shortTermCandidate) this.shortTerm.commit(effects.shortTermCandidate);
    if (effects.relationshipCandidate) this.store.saveRelationship(effects.relationshipCandidate, [effects.message.id], 'significant', this.now());
  }
  async deliver(job) {
    const row = this.outbox.get(job.outboxId);
    if (!row || row.status !== 'pending') return;
    job.controller.signal.throwIfAborted();
    if (!this.deliveryAllowed(row, job)) { this.outbox.cancel(row.id); if (job.plan) this.plans.release(job.plan.id); return; }
    const bubble = this.outbox.next(row.id);
    if (!bubble || bubble.due_at > this.now()) return;
    let complete;
    this.store.transaction(() => {
      const message = this.store.addMessage('assistant', bubble.content, this.now(), {
        origin: job.kind === 'planned' ? 'planned' : job.kind === 'proactive' ? 'proactive' : 'dafeyu',
        replyTo: job.message?.seq || null, segments: [{ type: 'model_bubble', data: { kind: bubble.kind, deliveryId: row.id, position: bubble.position } }],
      });
      complete = this.outbox.advance(row.id, bubble.position, message);
      if (complete) {
        if (row.payload.lifeShared?.length) this.life.markShared(row.payload.lifeShared);
        if (job.message) this.store.db.prepare("UPDATE messages SET status='complete' WHERE id=?").run(job.message.id);
        if (job.plan) this.plans.finish(job.plan.id);
      }
      this.store.log('bubble.sent', { deliveryId: row.id, position: bubble.position, afterMs: bubble.gap_ms, complete }, this.now());
    });
    if (complete && row.payload.lifeShared?.length) this.life.publish();
    this.error = ''; this.changed();
    this.emit({ type: 'delivered', conversationId: CONVERSATION, content: bubble.content, autonomous: autonomous(job.kind) });
  }
  deliveryAllowed(row, job) {
    const newerUser = job.message && this.store.db.prepare("SELECT 1 FROM messages WHERE role='user' AND seq>? LIMIT 1").get(job.message.seq);
    return row.expires_at > this.now() && (!autonomous(job.kind) || this.autonomousAllowed(job)) && !newerUser;
  }
  close() { this.closed = true; clearInterval(this.timer); clearTimeout(this.deliveryTimer); this.active?.controller.abort(); this.queue = []; this.store.close(); }
}
module.exports = { DafeyuEngine };
