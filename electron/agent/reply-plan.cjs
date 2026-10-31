const { ProviderError, visibleReply } = require('./deepseek.cjs');

// The model alone selects bubble boundaries and cadence. No random fallback.
function parseReplyPlan(content, settings) {
  let plan;
  try { plan = JSON.parse(content); } catch { throw new ProviderError('这次没有返回有效的消息安排，请重试'); }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) ||
      Object.keys(plan).some(k => !['decision', 'bubbles', 'resume_after_ms'].includes(k)) ||
      !['send', 'silent'].includes(plan.decision) || !Array.isArray(plan.bubbles)) throw new ProviderError('消息安排格式无效，请重试');
  if (plan.decision === 'silent') {
    if (plan.bubbles.length || plan.resume_after_ms !== undefined && (!Number.isSafeInteger(plan.resume_after_ms) || plan.resume_after_ms < 0 || plan.resume_after_ms > 7 * 86400000)) throw new ProviderError('沉默安排格式无效');
    return { decision: 'silent', bubbles: [], ...(plan.resume_after_ms === undefined ? {} : { resume_after_ms: plan.resume_after_ms }) };
  }
  if (plan.resume_after_ms !== undefined || !plan.bubbles.length || plan.bubbles.length > settings.reply_max_bubbles) throw new ProviderError('消息数量无效');
  let duration = 0, characters = 0;
  const bubbles = plan.bubbles.map((b, index) => {
    if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => !['text', 'after_ms', 'kind'].includes(k)) ||
        typeof b.text !== 'string' || !b.text.trim() || !Number.isSafeInteger(b.after_ms) || b.after_ms < (index ? 1 : 0) ||
        b.kind !== undefined && !['text', 'code'].includes(b.kind)) throw new ProviderError('气泡内容或时间间隔无效');
    duration += b.after_ms; characters += b.text.length;
    if (duration > settings.reply_max_schedule_ms || characters > settings.reply_max_characters) throw new ProviderError('本轮消息安排超过支持范围');
    // Keep the model's newlines and code indentation inside this one bubble.
    const clean = visibleReply(b.text);
    if (clean !== b.text.trim()) throw new ProviderError('气泡中包含内部过程，请重试');
    const text = b.text;
    return { text, after_ms: b.after_ms, kind: b.kind || 'text' };
  });
  return { decision: 'send', bubbles };
}
module.exports = { parseReplyPlan };
