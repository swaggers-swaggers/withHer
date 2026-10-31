const { setTimeout: delay } = require('node:timers/promises');
class ProviderError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}
function parseObject(text) {
  if (typeof text !== 'string') throw new ProviderError('内部整理没有返回有效内容');
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let value;
  try { value = JSON.parse(clean); } catch { throw new ProviderError('内部整理格式不完整，稍后会重新整理'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProviderError('内部整理格式无效');
  return value;
}
function visibleReply(text) {
  if (typeof text !== 'string') throw new ProviderError('这次没有生成完整回复，请再试一次');
  let output = text.replace(/<(think|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1>/gi, '').trim();
  if (!output || /<\/?(?:think|analysis|reasoning)\b|\[\/?(?:analysis|thinking)\]|<\|(?:analysis|channel|tool)[^>]*\|>/i.test(output) ||
      /^(?:#{1,3}\s*)?(?:分析步骤|思考过程|内部动机|候选开场|工具调用|Analysis|Chain of thought)\s*[:：\n]/im.test(output) ||
      /^\s*(?:```json\s*)?\{\s*"(?:reply|content|analysis|motivation|narrative|tool_calls)"\s*:/.test(output))
    throw new ProviderError('这次回复格式不合适，请再试一次');
  return output;
}
class DeepSeek {
  constructor(vault, remoteFetch, settings) { this.vault = vault; this.fetch = remoteFetch; this.settings = settings; }
  async request(route, body, signal, timeout = this.settings.request_timeout_ms) {
    const key = this.vault.get();
    if (!key) throw new ProviderError('请先填写 DeepSeek API 密钥', 401);
    const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeout)]);
    for (let attempt = 0; attempt < 2; attempt++) {
      bounded.throwIfAborted();
      let response;
      try {
        response = await this.fetch('https://api.deepseek.com' + route, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify(body), redirect: 'error', signal: bounded,
        });
      } catch (e) {
        if (bounded.aborted) throw bounded.reason;
        if (!attempt) { await delay(500, null, { signal: bounded }); continue; }
        throw new ProviderError('暂时连不上 DeepSeek，请检查网络后再试');
      }
      if (!response.ok) {
        let contextExceeded = false;
        if (response.status === 400) {
          try {
            const detail = await response.clone().json();
            contextExceeded = /context[_ ]length|maximum context|context.*(?:limit|exceed)|上下文.{0,20}(?:超|长)/i.test(String(detail.error?.code || '') + ' ' + String(detail.error?.message || ''));
          } catch { /* Invalid remote error bodies are never shown. */ }
        }
        // Never echo remote payloads; they may contain request material or credentials.
        await response.body?.cancel().catch(() => {});
        if (!attempt && (response.status === 429 || response.status >= 500)) { await delay(1000, null, { signal: bounded }); continue; }
        const messages = { 400: 'DeepSeek 未接受当前模型或请求设置', 401: 'DeepSeek 密钥无效，请重新填写', 402: 'DeepSeek 余额不足', 429: 'DeepSeek 暂时繁忙，请稍后再试' };
        throw new ProviderError(contextExceeded ? '最近200条完整消息超过当前模型的上下文限制，本次未删减历史，请选择支持更长上下文的模型后重试' : messages[response.status] || `DeepSeek 请求未完成（${response.status}）`, response.status);
      }
      let json;
      try { json = await response.json(); } catch { throw new ProviderError('DeepSeek 返回内容不完整，请稍后重试'); }
      bounded.throwIfAborted();
      return json;
    }
  }
  async complete(messages, { tools, json = false, signal, maxTokens, thinking = true, temperature } = {}) {
    const body = { model: this.settings.model, messages, stream: false,
      thinking: { type: thinking ? 'enabled' : 'disabled' },
      max_tokens: maxTokens || this.settings.reply_max_tokens };
    if (thinking) body.reasoning_effort = this.settings.reasoning_effort;
    if (temperature !== undefined) body.temperature = temperature;
    if (tools?.length) body.tools = tools;
    if (json) body.response_format = { type: 'json_object' };
    const result = await this.request('/chat/completions', body, signal);
    const choice = result?.choices?.[0];
    if (!choice?.message || !['stop', 'tool_calls'].includes(choice.finish_reason)) throw new ProviderError('这次回复没有完整生成，请重试');
    const raw = choice.message;
    if (raw.role && raw.role !== 'assistant') throw new ProviderError('回复格式无效');
    // This object stays within the tool loop. Only validated final content leaves it.
    const message = { role: 'assistant', content: raw.content ?? null };
    if (thinking) message.reasoning_content = raw.reasoning_content || '';
    if (raw.tool_calls?.length) {
      if (!Array.isArray(raw.tool_calls) || raw.tool_calls.length > this.settings.max_tools_per_round) throw new ProviderError('本轮工具调用过多');
      message.tool_calls = raw.tool_calls;
    }
    return message;
  }
  async object(system, data, signal) {
    const message = await this.complete([{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(data) }],
      { json: true, signal, maxTokens: this.settings.internal_max_tokens });
    return parseObject(message.content);
  }
  search(query, signal, { count = 6 } = {}) { return this.request('/v1/tools/search', { query, count, need_content: false }, signal, 25000); }
  readPage(url, signal) { return this.request('/v1/tools/fetch', { url }, signal, 30000); }
}
module.exports = { DeepSeek, ProviderError, parseObject, visibleReply };
