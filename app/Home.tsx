import { useState, useEffect, useRef } from 'react';
import { Plus, Play, Pause, Square, Bell, ArrowUpRight, Check, Pencil, Trash2, StickyNote, ListTodo, ChevronDown, X, Volume2, VolumeX, Coffee, BookOpen } from './icons';
import type { Note, Snapshot, Todo } from './types';
import { formatDuration } from './analytics';
import { Dot, Empty, Modal, TagPicker, type Action } from './ui';
import { ManualStudy } from './ManualStudy';
import { ReminderDialog, reminderLabel } from './Reminder';
import { Companion } from './Companion';

function TodoRow({ todo, data, action, onTags, notify }: { todo: Todo; data: Snapshot; action: Action; onTags: () => void; notify: HomeProps['notify'] }) {
  const [editing, setEditing] = useState(false), [title, setTitle] = useState(todo.title), [tagId, setTagId] = useState(todo.tag_id || 'uncategorized');
  const [reminderOpen, setReminderOpen] = useState(false);
  const tag = data.tags.find(t => t.id === todo.tag_id);
  const active = data.timer.todoId === todo.id && data.timer.status === 'running' && data.timer.mode === 'focus';
  return <><div className={`todo-row ${todo.completed_at ? 'done' : ''} ${active ? 'is-studying' : ''}`}>
    <button className="todo-checkbox" aria-label={`${todo.completed_at ? '重新打开' : '完成'} ${todo.title}`} aria-pressed={!!todo.completed_at} onClick={() => void action('todo.toggle', { id: todo.id })}>{todo.completed_at && <Check size={13} strokeWidth={2.8} />}</button>
    <div className="todo-text">{editing ? <form className="todo-edit" onSubmit={async e => { e.preventDefault(); if (await action('todo.edit', { id: todo.id, title, tagId: tagId === 'uncategorized' ? null : tagId })) setEditing(false); }}><input autoFocus aria-label="编辑待办内容" value={title} maxLength={500} onChange={e => setTitle(e.target.value)} /><TagPicker tags={data.tags} id={tagId} onSelect={setTagId} onManage={onTags} /><button className="icon-button" aria-label="保存待办"><Check size={16} /></button><button type="button" className="icon-button" aria-label="取消编辑" onClick={() => setEditing(false)}><X size={15} /></button></form> : <><span className="todo-title" onDoubleClick={() => setEditing(true)}>{todo.title}</span><div className="todo-meta">{tag && <span className="todo-tag"><Dot color={tag.color} />{tag.name}</span>}{todo.remind_at && <button className={`reminder-badge ${todo.reminded_at ? 'sent' : ''}`} aria-label={`修改提醒 ${todo.title}`} onClick={() => setReminderOpen(true)} title={new Date(todo.remind_at).toLocaleString('zh-CN')}><Bell size={10} />{reminderLabel(todo.remind_at)}{todo.reminded_at ? ' · 已提醒' : ''}</button>}</div></>}</div>
    {!editing && <div className="row-actions">{!todo.completed_at && <><button className="icon-button" aria-label={`提醒 ${todo.title}`} title="设置提醒时间" onClick={() => setReminderOpen(true)}><Bell size={14} /></button><button className={`icon-button play-task ${active ? 'active' : ''}`} aria-label={`学习 ${todo.title}`} title="关联此事项并开始学习" onClick={() => void action('timer.task', { id: todo.id, start: true })}><Play size={14} /></button></>}<button className="icon-button" aria-label={`编辑待办 ${todo.title}`} onClick={() => { setTitle(todo.title); setTagId(todo.tag_id || 'uncategorized'); setEditing(true); }}><Pencil size={14} /></button><button className="icon-button delete" aria-label={`删除待办 ${todo.title}`} onClick={async () => { if (await action('todo.delete', { id: todo.id })) notify('事项已删除', false, () => void action('todo.restore', { id: todo.id })); }}><Trash2 size={14} /></button></div>}
  </div>{reminderOpen && <ReminderDialog initialAt={todo.remind_at} onClose={() => setReminderOpen(false)} onSave={async remindAt => !!(await action('todo.reminder', { id: todo.id, remindAt }))} />}</>;
}
function NoteCard({ note, action, notify }: { note: Note; action: Action; notify: HomeProps['notify'] }) {
  const [editing, setEditing] = useState(false), [body, setBody] = useState(note.body);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (editing && area.current) { area.current.style.height = 'auto'; area.current.style.height = `${Math.max(100, area.current.scrollHeight)}px`; } }, [body, editing]);
  return <article className="note-card"><div className="note-meta"><span>{new Date(note.created_at).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</span><div className="row-actions"><button className="icon-button" aria-label="编辑想法" onClick={() => { setEditing(!editing); setBody(note.body); }}><Pencil size={13} /></button><button className="icon-button delete" aria-label="删除想法" onClick={async () => { if (await action('note.delete', { id: note.id })) notify('想法已删除', false, () => void action('note.restore', { id: note.id })); }}><Trash2 size={13} /></button></div></div>{editing ? <><textarea ref={area} autoFocus aria-label="编辑想法内容" maxLength={100000} value={body} onChange={e => { setBody(e.target.value); void action('note.edit', { id: note.id, body: e.target.value }); }} /><button className="text-button note-finish" onClick={() => setEditing(false)}><Check size={12} />完成编辑</button></> : <p className="note-body" onDoubleClick={() => { setEditing(true); setBody(note.body); }}>{note.body || '空白想法，点击编辑继续记录。'}</p>}</article>;
}
type HomeProps = { data: Snapshot; action: Action; onTags: () => void; notify: (text: string, error?: boolean, undo?: () => void) => void; quickAdd: number; sound: boolean; setSound: (sound: boolean) => void };
export function Home({ data, action, onTags, notify, quickAdd, sound, setSound }: HomeProps) {
  const [todoText, setTodoText] = useState(() => localStorage.getItem('studydesk-todo-draft') || '');
  const [noteText, setNoteText] = useState(() => localStorage.getItem('studydesk-note-draft') || '');
  const [noteOpen, setNoteOpen] = useState(false), [showDone, setShowDone] = useState(false), [confirmStop, setConfirmStop] = useState(false), [busy, setBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [newReminder, setNewReminder] = useState<number | null>(null), [newReminderOpen, setNewReminderOpen] = useState(false);
  const todoInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (quickAdd > 0) todoInput.current?.focus(); }, [quickAdd]);
  const pending = data.todos.filter(t => !t.deleted_at && !t.completed_at), done = data.todos.filter(t => !t.deleted_at && t.completed_at);
  const timer = data.timer;
  const remaining = Math.max(0, Math.ceil((timer.plannedMs - timer.elapsedMs) / 1000));
  const displayTime = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  const progress = Math.min(1, timer.elapsedMs / timer.plannedMs);
  const inSession = ['running', 'paused'].includes(timer.status);
  const currentTodo = data.todos.find(t => t.id === timer.todoId);
  const addTodo = async (e: React.FormEvent) => {
    e.preventDefault(); if (!todoText.trim() || busy) return;
    setBusy(true); const next = await action('todo.create', { title: todoText, remindAt: newReminder }); setBusy(false);
    if (next) { setNewReminder(null); setTodoText(''); localStorage.removeItem('studydesk-todo-draft'); }
  };
  const addNote = async () => {
    if (!noteText.trim() || busy) return;
    setBusy(true); const next = await action('note.create', { body: noteText }); setBusy(false);
    if (next) { setNoteText(''); localStorage.removeItem('studydesk-note-draft'); setNoteOpen(false); }
  };
  return <div className="page home-page">
    <div className="desk-grid">
    <section className={`timer-card ${timer.mode === 'break' ? 'break-mode' : ''}`}><div className="timer-topline"><span className="module-icon timer-icon"><BookOpen size={21} /></span><h2>学习计时</h2><span className={`timer-state ${timer.status === 'running' ? 'running' : ''}`}><span />{timer.status === 'running' ? timer.mode === 'focus' ? '正在专注' : '正在休息' : timer.status === 'paused' ? '已暂停' : timer.status === 'completed' ? '本轮完成' : '准备开始'}</span><button className="icon-button" title={sound ? '关闭提示音' : '开启提示音'} aria-label={sound ? '关闭提示音' : '开启提示音'} onClick={() => setSound(!sound)}>{sound ? <Volume2 size={17} /> : <VolumeX size={17} />}</button></div>
      <TagPicker tags={data.tags} id={timer.tagId} onSelect={id => void action('timer.tag', { id })} onManage={onTags} className="timer-tag" />
      <div className="timer-task">{currentTodo ? <><span title={currentTodo.title}>{currentTodo.title}</span><button aria-label="取消事项关联" className="icon-button" onClick={() => void action('timer.task', { id: null })}><X size={12} /></button></> : '未关联待办'}</div>
      <div className="timer-dial"><svg viewBox="0 0 270 270" aria-hidden="true"><circle className="dial-track" cx="135" cy="135" r="105" />{Array.from({ length: 60 }, (_, i) => <line className={i % 5 === 0 ? 'dial-tick major' : 'dial-tick'} key={i} x1="135" y1={i % 5 === 0 ? '8' : '12'} x2="135" y2="17" transform={`rotate(${i * 6} 135 135)`} />)}<circle className="dial-progress" cx="135" cy="135" r="105" pathLength="100" strokeDasharray={`${progress * 100} 100`} transform="rotate(-90 135 135)" /><circle className="dial-end" cx={135 + 105 * Math.cos(progress * Math.PI * 2 - Math.PI / 2)} cy={135 + 105 * Math.sin(progress * Math.PI * 2 - Math.PI / 2)} r="5" /></svg><div className="timer-digits"><span>{displayTime}</span><small>{timer.mode === 'focus' ? '专注 45 分钟' : '休息 15 分钟'}</small></div></div>
      <div className="timer-mode segmented"><button disabled={inSession} className={timer.mode === 'focus' ? 'active' : ''} onClick={() => void action('timer.mode', { mode: 'focus' })}>学习 · 45</button><button disabled={inSession} className={timer.mode === 'break' ? 'active' : ''} onClick={() => void action('timer.mode', { mode: 'break' })}>休息 · 15</button></div>
      <div className="timer-actions">{timer.status === 'completed' && timer.mode === 'focus' ? <button className="primary timer-start" onClick={async () => { await action('timer.mode', { mode: 'break' }); await action('timer.start'); }}><Coffee size={17} />开始休息</button> : timer.status === 'completed' && timer.mode === 'break' ? <button className="primary timer-start" onClick={async () => { await action('timer.mode', { mode: 'focus' }); await action('timer.start'); }}><Play size={16} fill="currentColor" />开始下一轮</button> : <button className="primary timer-start" onClick={() => void action(timer.status === 'running' ? 'timer.pause' : 'timer.start')}>
        {timer.status === 'running' ? <Pause size={17} fill="currentColor" /> : <Play size={16} fill="currentColor" />}{timer.status === 'running' ? '暂停' : timer.status === 'paused' ? '继续' : timer.mode === 'focus' ? '开始学习' : '开始休息'}</button>}{inSession && <button className="timer-stop" aria-label="结束本轮" title="结束本轮并保留实际学习时间" onClick={() => setConfirmStop(true)}><Square size={15} /></button>}</div>
      {timer.message && <p className="timer-helper has-message">{timer.message}</p>}
    <button aria-label="手动补录" className="manual-entry" onClick={() => setManualOpen(true)}><Plus size={17} /><span>手动补录</span><span>记下离线学习</span></button>
    </section>
    <div className="desk-capture"><section className="tasks-section"><div className="section-heading"><div className="heading-with-count"><span className="module-icon tasks-icon"><ListTodo size={21} /></span><h2>待办事项</h2><span className="count-badge">{pending.length}</span></div></div><form className="todo-input input-with-action" onSubmit={addTodo}><Plus size={18} /><input ref={todoInput} aria-label="新增待办" maxLength={500} placeholder="新增待办（Enter 保存）" value={todoText} onChange={e => { setTodoText(e.target.value); localStorage.setItem('studydesk-todo-draft', e.target.value); }} /><button type="button" className={`new-reminder-button ${newReminder ? 'has-reminder' : ''}`} aria-label="新增待办提醒时间" title="设置提醒时间" onClick={() => setNewReminderOpen(true)}><Bell size={15} /></button><button type="submit" aria-label="添加待办" disabled={!todoText.trim() || busy}><ArrowUpRight size={17} /></button></form>
      {newReminder && <button className="draft-reminder" onClick={() => setNewReminderOpen(true)}><Bell size={12} />{reminderLabel(newReminder)}</button>}<div className="todo-list">{pending.map(todo => <TodoRow key={todo.id} todo={todo} data={data} action={action} onTags={onTags} notify={notify} />)}{pending.length === 0 && <Empty icon={ListTodo} title="暂无待办" text="" />}</div>
      {done.length > 0 && <><button className="completed-toggle" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}><ChevronDown size={14} style={{ transform: showDone ? 'rotate(0)' : 'rotate(-90deg)' }} /><span>已完成</span><span>{done.length}</span></button>{showDone && <div className="completed-list">{done.map(todo => <TodoRow key={todo.id} todo={todo} data={data} action={action} onTags={onTags} notify={notify} />)}</div>}</>}
    </section>
    <section className="notes-section"><div className="section-heading"><div className="heading-with-icon"><span className="module-icon notes-icon"><StickyNote size={21} /></span><h2>随手记</h2></div><button className="text-button" onClick={() => setNoteOpen(!noteOpen)}><Plus size={15} />写个想法</button></div>
      {(noteOpen || noteText) && <div className="note-composer"><textarea autoFocus aria-label="新想法内容" rows={4} maxLength={100000} placeholder="输入想法（支持换行）" value={noteText} onChange={e => { setNoteText(e.target.value); localStorage.setItem('studydesk-note-draft', e.target.value); }} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void addNote(); }} /><div><span>Ctrl + Enter 保存</span><button className="primary small-button" disabled={!noteText.trim() || busy} onClick={() => void addNote()}>保存想法</button></div></div>}
      <div className="notes-grid">{data.notes.filter(n => !n.deleted_at).map(note => <NoteCard key={note.id} note={note} action={action} notify={notify} />)}</div>{!data.notes.some(n => !n.deleted_at) && !noteOpen && !noteText && <button className="note-empty" onClick={() => setNoteOpen(true)}><Pencil size={18} /><span>添加想法</span><Plus size={16} /></button>}
    </section>
    </div>
    </div>
    <Companion />
    {manualOpen && <ManualStudy data={data} action={action} notify={notify} onClose={() => setManualOpen(false)} />}
    {newReminderOpen && <ReminderDialog initialAt={newReminder} onClose={() => setNewReminderOpen(false)} onSave={async at => { setNewReminder(at); return true; }} />}
    {confirmStop && <Modal title="结束这一轮？" subtitle="已经学习的时间会完整保留，休息时间不会计入统计。" onClose={() => setConfirmStop(false)}><div className="confirm-summary">本轮已{timer.mode === 'focus' ? '学习' : '休息'} <strong>{formatDuration(timer.elapsedMs)}</strong></div><div className="modal-actions"><button className="secondary" onClick={() => setConfirmStop(false)}>返回计时</button><button className="primary" onClick={async () => { if (await action('timer.stop')) setConfirmStop(false); }}>结束并保存</button></div></Modal>}
  </div>;
}
