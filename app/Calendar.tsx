import { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Check, Trash2, RotateCcw, Clock3, MessageSquare } from './icons';
import type { Snapshot } from './types';
import { addDays, dateFromKey, dayKey, formatDuration, periodRange, shortDuration, timeOfDay, total } from './analytics';
import { DailyCard, Dot, moods, type Action } from './ui';

export function CalendarView({ data, action }: { data: Snapshot; action: Action }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12));
  const [selected, setSelected] = useState(dayKey(new Date()));
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const rows = Math.ceil((offset + daysInMonth) / 7);
  const cells = Array.from({ length: rows * 7 }, (_, i) => addDays(first, i - offset));
  const today = dayKey(new Date());
  const selectedDate = dateFromKey(selected), [start, end] = periodRange('day', selectedDate);
  const events = data.todoEvents.filter(e => e.at >= start && e.at < end);
  const created = events.filter(e => e.kind === 'created'), completed = events.filter(e => e.kind === 'completed');
  const studyMs = total(data.segments, start, end);
  const tags = data.tags.map(t => ({ ...t, ms: total(data.segments, start, end, t.id) })).filter(t => t.ms > 0).sort((a, b) => b.ms - a.ms);
  const selectedEntry = data.daily.find(d => d.day === selected);
  const monthMs = total(data.segments, ...periodRange('month', month));
  const monthStudyDays = Array.from({ length: daysInMonth }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)).filter(d => total(data.segments, ...periodRange('day', d)) > 0).length;
  const move = (direction: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + direction, 1, 12));
  const returnToday = () => { setSelected(today); setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12)); };
  const eventText: Record<string, string> = { created: '创建', completed: '完成', reopened: '重新打开', deleted: '删除', restored: '恢复' };
  return <div className="page calendar-page"><header className="page-header"><div><h1><CalendarDays size={29} strokeWidth={1.7} />学习日历</h1></div><button className="secondary" onClick={returnToday}>回到今天</button></header>
    <div className="calendar-layout"><section className="calendar-main panel"><div className="calendar-toolbar"><div><h2>{month.getFullYear()} 年 <strong>{month.getMonth() + 1}</strong> 月</h2><p>学习 {monthStudyDays} 天 <span>·</span> 累计 {formatDuration(monthMs)}</p></div><div><button className="icon-button" aria-label="上个月" onClick={() => move(-1)}><ChevronLeft size={19} /></button><button className="icon-button" aria-label="下个月" onClick={() => move(1)}><ChevronRight size={19} /></button></div></div>
      <div className="calendar-weekdays">{['一', '二', '三', '四', '五', '六', '日'].map(d => <span key={d}>{d}</span>)}</div><div className="calendar-grid">{cells.map(date => {
        const key = dayKey(date), [a, b] = periodRange('day', date);
        const ms = total(data.segments, a, b), hours = ms / 3600000;
        const dayEvents = data.todoEvents.filter(e => e.at >= a && e.at < b), added = dayEvents.filter(e => e.kind === 'created').length, checked = dayEvents.filter(e => e.kind === 'completed').length, removed = dayEvents.filter(e => e.kind === 'deleted').length;
        const entry = data.daily.find(d => d.day === key), mood = moods.find(m => m.id === (entry?.mood || 'normal'))!;
        const hasActivity = ms > 0 || dayEvents.length > 0 || !!entry;
        const level = ms === 0 ? 0 : hours < 1 ? 1 : hours < 2 ? 2 : hours < 4 ? 3 : 4;
        const inMonth = date.getMonth() === month.getMonth();
        return <button key={key} className={`calendar-cell heat-${level} ${!inMonth ? 'outside' : ''} ${key === selected ? 'selected' : ''} ${key === today ? 'is-today' : ''}`} aria-label={`${key}，学习${formatDuration(ms)}，创建${added}项，完成${checked}项，状态${mood.name}`} aria-pressed={key === selected} onClick={() => { setSelected(key); if (!inMonth) setMonth(new Date(date.getFullYear(), date.getMonth(), 1, 12)); }}><div className="cell-top"><span className="cell-day">{date.getDate()}</span>{hasActivity && <mood.Icon className="cell-mood" size={14} style={{ color: mood.color }} />}</div><strong className="cell-duration">{ms > 0 ? shortDuration(ms) : key === today ? '今天' : ''}</strong><div className="cell-symbols">{added > 0 && <span title={`创建 ${added} 项`}><Plus size={10} />{added}</span>}{checked > 0 && <span title={`完成 ${checked} 项`}><Check size={10} />{checked}</span>}{removed > 0 && <span title={`删除 ${removed} 项`}><Trash2 size={9} />{removed}</span>}{entry?.review && <MessageSquare className="review-symbol" size={10} />}</div></button>;
      })}</div><div className="calendar-legend"><div><span>学习时间</span><span>少</span>{[0, 1, 2, 3, 4].map(n => <i key={n} className={`heat-${n}`} />)}<span>多</span></div><div><Plus size={12} />创建<Check size={12} />完成<MessageSquare size={11} />评价</div></div><p className="calendar-tip">底色表示学习时长，表情表示当天状态。点击日期，展开这一天。</p></section>
    <aside className="day-detail"><div className="day-detail-heading"><div><span>{selectedDate.toLocaleDateString('zh-CN', { year: 'numeric', weekday: 'long' })}</span><h2>{selectedDate.getMonth() + 1} 月 {selectedDate.getDate()} 日{selected === today && <small>今天</small>}</h2></div><span className="day-detail-icon"><CalendarDays size={23} /></span></div><section className="day-study"><div className="day-study-total"><Clock3 size={17} /><span>学习时长</span><strong>{formatDuration(studyMs)}</strong></div>{tags.length > 0 ? <div className="day-tag-list">{tags.map(t => <div key={t.id}><Dot color={t.color} /><span>{t.name}</span><strong>{formatDuration(t.ms)}</strong></div>)}</div> : <p className="no-day-study">这一天还没有学习记录</p>}</section>
      <div className="day-task-counts"><div><span><Plus size={13} />创建事项</span><strong>{created.length}<small> 项</small></strong></div><div><span><Check size={13} />完成事项</span><strong>{completed.length}<small> 项</small></strong></div></div>
      <DailyCard key={selected} day={selected} entry={selectedEntry} action={action} compact />
      <section className="day-events"><div className="section-heading"><h2>待办变动</h2><span className="muted small">{events.length} 条</span></div>{events.length > 0 ? events.map(e => <div className={`day-event ${e.kind}`} key={e.id}><span className="event-icon">{e.kind === 'created' ? <Plus size={13} /> : e.kind === 'completed' ? <Check size={13} /> : e.kind === 'deleted' ? <Trash2 size={12} /> : <RotateCcw size={12} />}</span><div><strong>{e.title}</strong><span>{eventText[e.kind] || e.kind} · {timeOfDay(e.at)}</span></div></div>) : <p className="muted day-events-empty">暂无待办变动</p>}</section>
    </aside></div>
  </div>;
}
