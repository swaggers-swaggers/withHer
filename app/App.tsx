import { useState, useEffect, useRef, useCallback } from 'react';
import { BookOpen, ChartNoAxesCombined, CalendarDays, Check, HardDrive, Download, ChevronRight, X, Clock3, Power } from './icons';
import type { Snapshot, Tick } from './types';
import { Home } from './Home';
import { CompanionAvatar } from './CompanionAvatar';
import { Statistics } from './Statistics';
import { CalendarView } from './Calendar';
import { TagsModal, type Action } from './ui';
import { dayKey } from './analytics';

type Page = 'home' | 'statistics' | 'calendar';
function chime() {
  try {
    const context = new AudioContext();
    [660, 880, 1108].forEach((hz, i) => {
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.connect(gain); gain.connect(context.destination); oscillator.frequency.value = hz;
      const start = context.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(0.12, start + 0.02); gain.gain.exponentialRampToValueAtTime(0.001, start + 0.65);
      oscillator.start(start); oscillator.stop(start + 0.7);
    });
    setTimeout(() => void context.close(), 1600);
  } catch { /* 系统通知仍会显示。 */ }
}
export default function App() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [page, setPage] = useState<Page>('home');
  const [tagsOpen, setTagsOpen] = useState(false);
  const [dataMenu, setDataMenu] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean; undo?: () => void } | null>(null);
  const [chatPopup, setChatPopup] = useState<string | null>(null);
  const [chatJump, setChatJump] = useState(0);
  const [fatal, setFatal] = useState('');
  const [quickAdd, setQuickAdd] = useState(0);
  const [sound, setSound] = useState(() => localStorage.getItem('studydesk-sound') !== 'off');
  const [, setCurrentDay] = useState(() => dayKey(Date.now()));
  useEffect(() => {
    const midnightRefresh = setInterval(() => setCurrentDay(dayKey(Date.now())), 1000);
    return () => clearInterval(midnightRefresh);
  }, []);
  const soundRef = useRef(sound); soundRef.current = sound;
  const lastStatus = useRef('');
  const notify = useCallback((text: string, error = false, undo?: () => void) => setToast({ text, error, undo }), []);
  const accept = useCallback((next: Snapshot) => setData(previous => !previous || next.revision >= previous.revision ? next : previous), []);
  const action: Action = useCallback(async (name, payload) => {
    try {
      const result = await window.studyDesk.dispatch(name, payload);
      if (!result.ok || !result.data) { notify(result.error || '保存失败，请重试', true); return null; }
      accept(result.data); return result.data;
    } catch { notify('保存遇到问题，你的输入仍保留在界面中', true); return null; }
  }, [accept, notify]);
  useEffect(() => {
    if (!window.studyDesk) { setFatal('请从 StudyDesk 桌面入口打开应用。'); return; }
    void window.studyDesk.load().then(next => { lastStatus.current = next.timer.status; accept(next); }).catch(e => setFatal(String(e)));
    const off = window.studyDesk.onTick((tick: Tick) => {
      if (lastStatus.current === 'running' && tick.timer.status === 'completed' && soundRef.current) chime();
      lastStatus.current = tick.timer.status;
      if (tick.reload) { void window.studyDesk.load().then(accept); return; }
      setData(previous => {
        if (!previous || tick.revision < previous.revision) return previous;
        const segments = tick.segment ? previous.segments.some(s => s.id === tick.segment!.id) ? previous.segments.map(s => s.id === tick.segment!.id ? tick.segment! : s) : [...previous.segments, tick.segment] : previous.segments;
        return { ...previous, timer: tick.timer, segments, revision: tick.revision };
      });
    });
    const offQuick = window.studyDesk.onQuickAdd(() => { setPage('home'); setQuickAdd(n => n + 1); });
    const offReminder = window.studyDesk.onReminder(todo => notify(`待办提醒：${todo.title}`));
    return () => { off(); offQuick(); offReminder(); };
  }, [accept]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), toast.undo ? 8000 : 4500); return () => clearTimeout(timer); }, [toast]);
  const openChat = useCallback(() => { setPage('home'); setChatPopup(null); setChatJump(value => value + 1); }, []);
  useEffect(() => {
    if (!window.studyDesk) return;
    return window.studyDesk.onCompanion(event => {
      if (event.type === 'open-chat') openChat();
      if (event.type === 'delivered' && event.autonomous && event.popup !== false && document.hasFocus())
        setChatPopup(event.content || '发来一条消息');
    });
  }, [openChat]);
  useEffect(() => {
    if (!chatJump || page !== 'home' || !data) return;
    document.querySelector('#companion-chat')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.querySelector<HTMLTextAreaElement>('#companion-chat textarea')?.focus({ preventScroll: true });
  }, [chatJump, page, !!data]);
  useEffect(() => { if (!chatPopup) return; const timer = setTimeout(() => setChatPopup(null), 15000); return () => clearTimeout(timer); }, [chatPopup]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); setPage('home'); setQuickAdd(n => n + 1); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  const exportData = async () => {
    setDataMenu(false); const result = await window.studyDesk.exportData();
    if (!result.canceled) notify(result.message || result.error || '导出失败', !result.ok);
  };
  const backup = async () => {
    setDataMenu(false); const result = await window.studyDesk.backup(); notify(result.message || result.error || '备份失败', !result.ok);
  };
  if (fatal) return <div className="fatal"><Clock3 size={40} /><h1>暂时无法打开学习桌</h1><p>{fatal}</p><button className="primary" onClick={() => window.location.reload()}>重新打开</button></div>;
  if (!data) return <div className="loading"><Clock3 size={32} /><span>正在打开你的学习桌…</span></div>;
  return <div className="app-shell">
    <div className={`sidebar-rail ${sidebarOpen || dataMenu ? 'expanded' : ''}`}><aside className={`sidebar ${sidebarOpen || dataMenu ? 'expanded' : ''}`} aria-label="导航侧栏" onMouseEnter={() => setSidebarOpen(true)} onMouseLeave={() => setSidebarOpen(false)} onFocusCapture={() => setSidebarOpen(true)} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSidebarOpen(false); }}>
      <div className="brand"><img className="brand-mark" src="./studydesk-icon.png" alt="" /><strong className="sidebar-text">StudyDesk</strong></div>
      <nav>{([{ id: 'home', label: '学习桌', Icon: BookOpen }, { id: 'statistics', label: '学习统计', Icon: ChartNoAxesCombined }, { id: 'calendar', label: '学习日历', Icon: CalendarDays }] as const).map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} aria-label={item.label} title={item.label} aria-current={page === item.id ? 'page' : undefined} onClick={() => { setPage(item.id); setDataMenu(false); setSidebarOpen(false); }}><item.Icon size={19} strokeWidth={1.75} /><span className="sidebar-text">{item.label}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="data-menu-wrap">{dataMenu && <><button className="menu-dismiss" tabIndex={-1} aria-label="关闭数据菜单" onClick={() => setDataMenu(false)} /><div className="popover data-menu"><button onClick={() => void backup()}><HardDrive size={16} />立即备份</button><button onClick={() => void exportData()}><Download size={16} />导出完整记录</button></div></>}<button className="sidebar-data" aria-label="备份与导出" title="备份与导出" onClick={() => setDataMenu(!dataMenu)}><HardDrive size={18} /><span className="sidebar-text">备份与导出</span><ChevronRight className="sidebar-text" size={13} /></button></div>
      <button className="sidebar-data quit-button" aria-label="退出应用" title="退出应用（停止后台提醒）" onClick={() => void window.studyDesk.quit()}><Power size={18} /><span className="sidebar-text">退出应用</span></button></div>
    </aside></div>
    <main className="main-area">{page === 'home' && <Home data={data} action={action} onTags={() => setTagsOpen(true)} notify={notify} quickAdd={quickAdd} sound={sound} setSound={value => { setSound(value); localStorage.setItem('studydesk-sound', value ? 'on' : 'off'); }} />}
      {page === 'statistics' && <Statistics data={data} onTags={() => setTagsOpen(true)} />}
      {page === 'calendar' && <CalendarView data={data} action={action} />}
    </main>
    {tagsOpen && <TagsModal data={data} action={action} onClose={() => setTagsOpen(false)} />}
    {chatPopup && <aside className="chat-popup" role="status" aria-label="大肥鱼的新消息"><button className="chat-popup-message" onClick={openChat}><CompanionAvatar /><span><strong>大肥鱼</strong><span>{chatPopup}</span></span></button><button className="icon-button" aria-label="关闭消息提示" onClick={() => setChatPopup(null)}><X size={15} /></button></aside>}
    {toast && <div role="status" className={`toast ${toast.error ? 'error' : ''}`}><Check size={16} /><span>{toast.text}</span>{toast.undo && <button onClick={() => { toast.undo?.(); setToast(null); }}>撤销</button>}<button aria-label="关闭提示" className="icon-button" onClick={() => setToast(null)}><X size={14} /></button></div>}
  </div>;
}
