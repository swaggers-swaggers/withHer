// Only external request/response protocol is exported. Internal reasoning and
// credentials are never included, even when echoed in a subsequent tool round.
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(reasoning_content|reasoning|thinking_content|analysis|authorization|api_key)$/i.test(key)) {
      result[key] = '[未导出]'; continue;
    }
    result[key] = redact(item);
  }
  return result;
}
module.exports = { redact };
