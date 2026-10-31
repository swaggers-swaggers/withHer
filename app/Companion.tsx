import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Settings2, ArrowUpRight, Square, X, Check, Maximize, Minimize } from './icons';
import { Modal } from './ui';
import { CompanionAvatar } from './CompanionAvatar';
import type { CompanionResult, CompanionState } from './companion-types';

type Command = (action: string, input?: Record<string, unknown>) => Promise<CompanionResult | null>;
function MessageText({ value, kind }: { value: string; kind?: 'text' | 'code' }) {
  return kind === 'code' ? <pre><code>{value}</code></pre> : <span>{value}</span>;
}
function ChatSettings({ state, command }: { state: CompanionState; command: Command }) {
  const [model, setModel] = useState(state.config.model), [key, setKey] = useState('');
  const [status, setStatus] = useState(''), [saving, setSaving] = useState(false);
  const save = async () => {
    if (!await command('config.save', { model })) return false;
    if (key.trim()) { if (!await command('credentials.save', { key })) return false; setKey(''); }
    return true;
  };
  const ready = state.engine.status === 'ready';
  return <form className="chat-form" onSubmit={async e => { e.preventDefault(); setSaving(true); setStatus(''); try { if (await save()) setStatus('设置已保存'); } finally { setSaving(false); } }}>
    <p className="chat-explainer">聊天会参考你的学习记录。记录保存在这台电脑上；生成回复时，相关内容会发送给 DeepSeek。</p>
    <label>DeepSeek API 密钥<input type="password" aria-label="DeepSeek API 密钥" autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} placeholder={state.credentials.configured ? '已配置；留空保留现有密钥' : '在此粘贴你的 API 密钥'} maxLength={512} /></label>
    <p className="chat-small-note">{state.credentials.storage === 'encrypted' ? '密钥由系统钥匙环加密保存。' : '系统钥匙环不可用，密钥仅本次运行有效。'}{state.credentials.error}</p>
    <label>模型<input aria-label="DeepSeek 模型" value={model} maxLength={80} onChange={e => setModel(e.target.value)} /></label>
    <p className="chat-small-note">专注、锁屏和电脑闲置时安静。夜间电脑仍在使用时可以聊天。</p>
    {state.engine.studyMemoryError && <p className="chat-error">{state.engine.studyMemoryError}</p>}
    {state.engine.error && <p className="chat-error">{state.engine.error}</p>}
    {status && <p className="chat-save-status" role="status"><Check size={14} />{status}</p>}
    <div className="chat-settings-actions"><button type="button" className="text-button" disabled={saving || state.engine.status === 'starting'} onClick={async () => { if (await command('credentials.clear')) setStatus('密钥已移除'); }}>移除密钥</button><button type="submit" className="secondary" disabled={saving || state.engine.status === 'starting'}>保存设置</button><button type="button" className="primary" disabled={saving || state.engine.status === 'starting'} onClick={async () => { setSaving(true); try { if (ready) await command('engine.stop'); else if (await save()) await command('engine.start'); } finally { setSaving(false); } }}>{state.engine.status === 'starting' ? '正在准备…' : ready ? '暂停聊天' : '启用聊天'}</button></div>
  </form>;
}
export function Companion() {
  const [expanded, setExpanded] = useState(false);
  const scrollPosition = useRef(0), expandButton = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<CompanionState | null>(null), [error, setError] = useState('');
  const [draft, setDraft] = useState(''), [settingsOpen, setSettingsOpen] = useState(false), [sending, setSending] = useState(false), [older, setOlder] = useState(false);
  const view = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null), mounted = useRef(true), request = useRef(0), follow = useRef(true), conversationRef = useRef<string | null>(null), expandedHistory = useRef(false);
  const toggleExpanded = useCallback(() => {
    scrollPosition.current = view.current?.scrollTop || 0;
    setExpanded(value => !value);
  }, []);
  useLayoutEffect(() => {
    if (view.current) view.current.scrollTop = follow.current ? view.current.scrollHeight : scrollPosition.current;
    expandButton.current?.focus({ preventScroll: true });
  }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !settingsOpen) { event.preventDefault(); toggleExpanded(); } };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [expanded, settingsOpen, toggleExpanded]);
  const accept = useCallback((next: CompanionState) => {
    if (conversationRef.current !== next.conversation.id) {
      conversationRef.current = next.conversation.id;
      setDraft(localStorage.getItem('studydesk-chat-draft:' + next.conversation.id) || '');
      setOlder(false); follow.current = true; expandedHistory.current = false;
    }
    setState(previous => previous && expandedHistory.current && next.messages.length ? { ...next, messages: [...previous.messages.filter(m => m.seq < next.messages[0].seq), ...next.messages] } : next);
  }, []);
  const refresh = useCallback(async () => {
    const id = ++request.current;
    try { const next = await window.studyDesk.companionLoad(); if (mounted.current && id === request.current) accept(next); }
    catch { if (mounted.current) setError('暂时无法打开聊天记录。'); }
  }, [accept]);
  const command: Command = useCallback(async (action, payload) => {
    setError('');
    try {
      const result = await window.studyDesk.companionCommand(action, payload);
      if (!result.ok) { setError(result.error || '操作失败，请重试'); return null; }
      if (result.state) { ++request.current; accept(result.state); }
      return result;
    } catch { setError('聊天服务暂时不可用，请重试'); return null; }
  }, [accept]);
  useEffect(() => {
    mounted.current = true; void refresh();
    const off = window.studyDesk.onCompanion(event => { if (event.type === 'error') setError(event.message || '回复失败'); else void refresh(); });
    return () => { mounted.current = false; off(); };
  }, [refresh]);
  useEffect(() => { if (follow.current && view.current) view.current.scrollTop = view.current.scrollHeight; }, [state?.messages]);
  const send = async () => {
    if (!state || sending || !draft.trim()) return;
    if (!state.credentials.configured || state.engine.status !== 'ready') { setSettingsOpen(true); return; }
    setSending(true); follow.current = true;
    try { if (await command('chat.send', { content: draft })) { localStorage.removeItem('studydesk-chat-draft:' + state.conversation.id); setDraft(''); input.current?.focus(); } }
    finally { setSending(false); }
  };
  const typingAt = useRef(0);
  const ready = state?.engine.status === 'ready';
  const chat = <section id="companion-chat" className={`companion-card${expanded ? ' companion-expanded' : ''}`} aria-label="学习伙伴聊天" data-expanded={expanded}>
    <div className="companion-heading"><CompanionAvatar /><div><h2>大肥鱼</h2><p>{state?.engine.status === 'starting' ? '正在准备…' : ready ? state.engine.paused ? '暂时安静一会儿' : '在线' : '聊天已暂停'}</p></div><div className="companion-tools"><button ref={expandButton} className="icon-button" aria-label={expanded ? '还原聊天' : '放大聊天'} title={expanded ? '还原聊天（Esc）' : '放大聊天'} aria-expanded={expanded} onClick={toggleExpanded}>{expanded ? <Minimize size={17} /> : <Maximize size={17} />}</button><button className="icon-button" aria-label="聊天设置" title="聊天设置" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button></div></div>
    {state && !ready && <button className="chat-key-prompt" onClick={() => setSettingsOpen(true)}><Settings2 size={15} /><span>{state.credentials.configured ? '聊天尚未启用' : '输入 DeepSeek API 密钥'}</span><ArrowUpRight size={15} /></button>}
    <div ref={view} className="chat-messages" role="log" aria-label="聊天记录" onScroll={e => { const el = e.currentTarget; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70; }}>
      {state && state.messages.length >= 100 && !older && <button className="chat-load-older" onClick={async () => { const result = await command('messages.older', { id: state.conversation.id, before: state.messages[0].seq }); if (result?.messages) { expandedHistory.current = true; setState(current => current ? { ...current, messages: [...result.messages!, ...current.messages] } : current); setOlder(result.messages.length < 100); } }}>加载更早的聊天</button>}
      {state?.messages.map(m => <article key={m.id} className={`chat-message ${m.role}`} data-message-id={m.id}><span className="chat-speaker">{m.role === 'assistant' && <CompanionAvatar small />}{m.role === 'user' ? '你' : '大肥鱼'}</span>{(m.displayParts || [m.displayContent ?? m.content]).map((part, partIndex) => <div className="chat-bubble" key={partIndex}>{partIndex === 0 && m.quotes?.map((quote, index) => <blockquote className="chat-quote" aria-label="引用消息" key={`${quote.messageId}:${index}`}><strong>引用 · {quote.author}</strong><p>{quote.content.replace(/\r\n|[\r\n\u2028\u2029]/g, ' ') || '原消息暂不可用'}</p></blockquote>)}<div className="chat-message-body"><MessageText value={part} kind={m.displayKinds?.[partIndex]} /></div></div>)}</article>)}
      {state?.busy && !state.waiting && <div className="chat-typing" role="status">正在输入<span>…</span></div>}
      {!state && !error && <p className="chat-small-note">正在打开聊天记录…</p>}
    </div>
    {error && <div className="chat-error" role="alert"><span>{error}</span><button className="icon-button" aria-label="关闭聊天错误" onClick={() => setError('')}><X size={13} /></button></div>}
    <form className="chat-composer" onSubmit={e => { e.preventDefault(); void send(); }}><textarea ref={input} aria-label="发送给学习伙伴的消息" placeholder="和大肥鱼说点什么…" rows={2} maxLength={6000} value={draft} disabled={!state} onChange={e => { setDraft(e.target.value); if (Date.now() - typingAt.current > 5000) { typingAt.current = Date.now(); void window.studyDesk.companionCommand('chat.typing').catch(() => {}); } if (state) localStorage.setItem('studydesk-chat-draft:' + state.conversation.id, e.target.value); }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} /><div className="chat-composer-footer"><span>Enter 发送 · Shift + Enter 换行</span><div className="chat-send-actions">{state?.busy && <button type="button" className="chat-stop" onClick={() => void command('chat.stop')}><Square size={13} />暂停聊天</button>}<button className="chat-send" aria-label="发送聊天消息" disabled={!state || !draft.trim() || sending}><ArrowUpRight size={19} /></button></div></div></form>
    {settingsOpen && state && <Modal title="聊天设置" onClose={() => setSettingsOpen(false)}><ChatSettings state={state} command={command} />{error && <p className="chat-error" role="alert">{error}</p>}</Modal>}
  </section>;
  return expanded ? createPortal(chat, document.body) : chat;
}
