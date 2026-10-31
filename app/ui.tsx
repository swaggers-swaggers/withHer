import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Plus, X, Circle, Smile, Meh, Frown, Cloud, Sun, Settings2, BookOpen } from './icons';
import type { Daily, Mood, Snapshot, Tag } from './types';
import { dayKey, formatDuration } from './analytics';
export type Action = (action: string, payload?: Record<string, unknown>) => Promise<Snapshot | null>;
export const colors = ['#5976e8', '#a180cc', '#59a797', '#d79362', '#d57589', '#7a99ba', '#b6a052', '#8b95a3'];
export const moods: { id: Mood; name: string; color: string; Icon: typeof Smile }[] = [
  { id: 'bad', name: '很差', color: '#c67b8a', Icon: Frown },
  { id: 'low', name: '较差', color: '#b19782', Icon: Cloud },
  { id: 'normal', name: '一般', color: '#939dac', Icon: Meh },
  { id: 'good', name: '不错', color: '#70a994', Icon: Smile },
  { id: 'great', name: '很好', color: '#d2a34e', Icon: Sun },
];
export const Dot = ({ color }: { color: string }) => <span className="color-dot" style={{ background: color }} />;
export function Empty({ title, text, icon: Icon = Circle }: { title: string; text: string; icon?: typeof Circle }) {
  return <div className="empty"><span className="empty-icon"><Icon size={24} strokeWidth={1.4} /></span><strong>{title}</strong>{text && <p>{text}</p>}</div>;
}
export function TagPicker({ tags, id, onSelect, onManage, className = '' }: { tags: Tag[]; id: string; onSelect: (id: string) => void; onManage: () => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const tag = tags.find(t => t.id === id) || tags[0];
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
  }, [open]);
  return <div ref={ref} className={`tag-picker ${className}`}>
    <button type="button" className="tag-choice" aria-label="选择学习标签" aria-expanded={open} onClick={() => { setOpen(!open); setSearch(''); }}><Dot color={tag?.color || '#939dac'} /><span>{tag?.name || '未分类'}</span><ChevronDown size={14} /></button>
    {open && <div className="popover tag-popover"><input autoFocus aria-label="搜索标签" placeholder="搜索学习标签…" value={search} onChange={e => setSearch(e.target.value)} /><div className="tag-options">
      {tags.filter(t => !t.archived && t.name.toLowerCase().includes(search.toLowerCase())).map(t => <button key={t.id} type="button" onClick={() => { onSelect(t.id); setOpen(false); }}><Dot color={t.color} /><span>{t.name}</span>{t.id === id && <Check size={15} />}</button>)}
      {!tags.some(t => !t.archived && t.name.toLowerCase().includes(search.toLowerCase())) && <p className="muted small pad">没有找到这个标签</p>}
    </div><button className="popover-footer" type="button" onClick={() => { setOpen(false); onManage(); }}><Plus size={15} /> 新建 / 管理标签</button></div>}
  </div>;
}
export function DailyCard({ day, entry, action, compact = false }: { day: string; entry?: Daily; action: Action; compact?: boolean }) {
  const [mood, setMood] = useState<Mood>(entry?.mood || 'normal');
  const [review, setReview] = useState(entry?.review || '');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveId = useRef(0);
  useEffect(() => { setMood(entry?.mood || 'normal'); setReview(entry?.review || ''); setSaveState('idle'); }, [day]);
  const save = async (nextMood: Mood, nextReview: string) => {
    const id = ++saveId.current;
    setSaveState('saving');
    const result = await action('daily.save', { day, mood: nextMood, review: nextReview });
    if (id === saveId.current) setSaveState(result ? 'saved' : 'error');
  };
  const future = day > dayKey(Date.now());
  return <section className={`daily-card ${compact ? 'compact' : ''}`}>
    <div className="section-heading"><div className="heading-with-icon"><span className="module-icon daily-icon"><BookOpen size={21} /></span><h2>{day === dayKey(Date.now()) ? '今天的状态' : '当天的状态'}</h2></div></div>
    <div className="mood-options">{moods.map(m => <button type="button" key={m.id} disabled={future} aria-label={`状态：${m.name}`} aria-pressed={mood === m.id} className={mood === m.id ? 'selected' : ''} style={{ '--mood-color': m.color } as React.CSSProperties} onClick={() => { setMood(m.id); void save(m.id, review); }}><m.Icon size={22} strokeWidth={1.65} /><span>{m.name}</span></button>)}</div>
    <textarea disabled={future} aria-label="当日评价" value={review} maxLength={5000} onChange={e => { setReview(e.target.value); void save(mood, e.target.value); }} placeholder={future ? '不能填写未来日期' : '当日评价（可留空）'} rows={2} />
    <div className="daily-foot"><span>{future ? '尚未到来' : saveState === 'saving' ? '正在保存…' : saveState === 'error' ? '保存失败，输入仍保留' : review ? '评价已自动保存' : '未选择时，默认为「一般」'}</span>{saveState === 'error' ? <button className="text-button" onClick={() => void save(mood, review)}>重试</button> : review && saveState !== 'saving' && <Check size={12} />}</div>
  </section>;
}
export function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const nodes = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, [tabindex="0"]');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  // 毛玻璃会创建独立叠层，弹窗挂到 body 以确保始终覆盖所有卡片。
  return createPortal(<div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="modal"><div className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={20} /></button></div>{children}</div></div>, document.body);
}
export function TagsModal({ data, action, onClose }: { data: Snapshot; action: Action; onClose: () => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(colors[0]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(colors[0]);
  const [busy, setBusy] = useState(false);
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); if (!name.trim() || busy) return;
    setBusy(true); const next = await action('tag.create', { name, color }); setBusy(false);
    if (next) setName('');
  };
  return <Modal title="学习标签" onClose={onClose}>
    <form className="tag-new" onSubmit={add}><div className="input-with-action"><input autoFocus placeholder="新标签，例如 Flow Matching" aria-label="新标签名称" value={name} maxLength={64} onChange={e => setName(e.target.value)} /><button className="primary" disabled={!name.trim() || busy}><Plus size={16} />添加</button></div><div className="color-options">{colors.map(c => <button key={c} type="button" title={c} aria-label={`标签颜色 ${c}`} aria-pressed={c === color} style={{ background: c }} onClick={() => setColor(c)}>{c === color && <Check size={12} />}</button>)}</div></form>
    <div className="tag-manager-list">{data.tags.map(t => <div key={t.id} className={`tag-manager-row ${t.archived ? 'archived' : ''}`}>
      {editing === t.id ? <div className="tag-edit-form"><div className="input-with-action"><input aria-label="修改标签名称" maxLength={64} value={editName} onChange={e => setEditName(e.target.value)} /><button className="primary" onClick={async () => { if (await action('tag.edit', { id: t.id, name: editName, color: editColor })) setEditing(null); }}>保存</button><button className="text-button" onClick={() => setEditing(null)}>取消</button></div><div className="color-options">{colors.map(c => <button key={c} aria-label={`修改颜色 ${c}`} style={{ background: c }} onClick={() => setEditColor(c)}>{c === editColor && <Check size={12} />}</button>)}</div></div> : <><Dot color={t.color} /><div className="tag-manager-name"><strong>{t.name}</strong><span>{formatDuration(data.segments.filter(s => s.tag_id === t.id).reduce((n, s) => n + s.duration_ms, 0))}{t.archived ? ' · 已归档' : ' · 累计投入'}</span></div>{t.id !== 'uncategorized' && <><button className="icon-button" title="编辑标签" aria-label={`编辑 ${t.name}`} onClick={() => { setEditing(t.id); setEditName(t.name); setEditColor(t.color); }}><Settings2 size={16} /></button><button className="text-button" onClick={() => void action('tag.archive', { id: t.id, archived: !t.archived })}>{t.archived ? '恢复' : '归档'}</button></>}</>}
    </div>)}</div><p className="modal-note">切换标签会分段记录；归档不删除历史。</p>
  </Modal>;
}
