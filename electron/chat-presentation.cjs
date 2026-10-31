// Keep native evidence untouched. Only separate structured reply references
// from the visible body; never guess a quote from ordinary sentence text.
function splitDisplayBubbles(text) {
  const parts = []; let fence = null;
  for (const line of String(text || '').split(/\r\n|[\r\n\u2028\u2029]/)) {
    if (fence) {
      if (new RegExp('^ {0,3}' + fence.mark + '{' + fence.size + ',}\\s*$').test(line)) { fence = null; continue; }
      if (line.trim()) parts.push({ text: line, kind: 'code' });
      continue;
    }
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})([^`~]*)$/);
    if (opening) { fence = { mark: opening[1][0], size: opening[1].length }; continue; }
    if (line.trim()) parts.push({ text: line, kind: 'text' });
  }
  return parts.length ? parts : [{ text: '', kind: 'text' }];
}
const splitDisplayText = text => splitDisplayBubbles(text).map(p => p.text);
const display = text => {
  const parts = splitDisplayBubbles(text);
  return { displayParts: parts.map(p => p.text), displayKinds: parts.map(p => p.kind) };
};

function presentMessage(message) {
  const content = typeof message.content === 'string' ? message.content : '';
  let segments;
  try { segments = JSON.parse(message.segments_json || '[]'); }
  catch { segments = []; }
  if (!Array.isArray(segments)) segments = [];
  const references = segments.filter(part => part?.type === 'reply' && part.data && typeof part.data === 'object');
  if (!references.length) return { ...message, displayContent: content, ...display(content), quotes: [] };
  const string = value => typeof value === 'string' ? value : '';
  const quotes = references.map(({ data }) => ({
    messageId: string(data.target_message_id),
    author: data.target_message_sender_id === 'owner' ? '你' : data.target_message_sender_id === 'self' ? '大肥鱼' :
      string(data.target_message_sender_cardname) || string(data.target_message_sender_nickname) || '对方',
    content: string(data.target_message_content),
  }));
  const body = segments.filter(part => part?.type !== 'reply').map(part => {
    switch (part?.type) {
      case 'text': return string(part.data);
      case 'at': return '@' + (string(part.data?.target_user_cardname) || string(part.data?.target_user_nickname) || '对方');
      case 'image': return '[图片]';
      case 'emoji': return '[表情]';
      case 'voice': return '[语音]';
      case 'file': return '[文件：' + (string(part.data?.name) || string(part.data?.file_name) || '附件') + ']';
      case 'forward': return '[转发消息]';
      default: return '[附件]';
    }
  }).join('');
  return { ...message, displayContent: body, ...display(body), quotes };
}

module.exports = { presentMessage, splitDisplayText, splitDisplayBubbles };
