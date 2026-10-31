import { useRef, useState } from 'react';
import type { Snapshot } from './types';
import { dayKey, formatDuration, timeOfDay } from './analytics';
import { Clock3, Plus, Trash2 } from './icons';
import { Dot, Modal, type Action } from './ui';

export function ManualStudy({ data, action, onClose, notify }: { data: Snapshot; action: Action; onClose: () => void; notify: (text: string, error?: boolean, undo?: () => void) => void }) {
  const [day] = useState(() => dayKey(Date.now()));
  const [hours, setHours] = useState('0'), [minutes, setMinutes] = useState('30');
  const [endTime, setEndTime] = useState(() => timeOfDay(Date.now()));
  const [tagId, setTagId] = useState(data.timer.tagId);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submitting = useRef(false);
  const duration = Number(hours) * 60 + Number(minutes);
  const endAt = new Date(`${day}T${endTime}:00`).getTime();
  const startAt = endAt - duration * 60000;
  const valid = hours !== '' && minutes !== '' && Number.isInteger(Number(hours)) && Number.isInteger(Number(minutes)) && Number(hours) >= 0 && Number(minutes) >= 0 && Number(minutes) <= 59 && duration >= 1 && duration <= 1440 && Number.isFinite(endAt) && dayKey(startAt) === day;
  const records = data.sessions.filter(s => s.status === 'manual' && dayKey(s.started_at) === day).slice().reverse();
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || submitting.current) return;
    if (endAt > Date.now()) { setError('结束时间不能晚于现在。'); return; }
    if (day !== dayKey(Date.now())) { setError('日期已变化，请关闭后重新补录今天的时间。'); return; }
    submitting.current = true; setBusy(true); setError('');
    try {
      const next = await action('study.manual', { day, minutes: duration, endAt, tagId });
      if (next) {
        const added = next.sessions.find(s => s.status === 'manual' && !data.sessions.some(old => old.id === s.id));
        onClose(); notify(`已补录 ${formatDuration(duration * 60000)}`, false, added ? () => void action('study.removeManual', { id: added.id }) : undefined);
      } else setError('未保存。请检查时间是否与已有学习记录重叠。');
    } finally { submitting.current = false; setBusy(false); }
  };
  return <Modal title="补录今日学习" subtitle="把离线学习也记下来，计入学习时长与标签统计。" onClose={onClose}>
    <form className="manual-form" onSubmit={save}>
      <div className="manual-date"><Clock3 size={18} /><span>{day.replaceAll('-', ' / ')}</span><span>仅限今天</span></div>
      <fieldset className="manual-duration"><legend>学习时长</legend><label><input autoFocus type="number" min="0" max="24" step="1" aria-label="补录小时" value={hours} onChange={e => setHours(e.target.value)} /><span>小时</span></label><label><input type="number" min="0" max="59" step="1" aria-label="补录分钟" value={minutes} onChange={e => setMinutes(e.target.value)} /><span>分钟</span></label></fieldset>
      <div className="duration-presets">{[15, 30, 45, 60].map(n => <button type="button" key={n} aria-pressed={duration === n} className={duration === n ? 'selected' : ''} onClick={() => { setHours(String(Math.floor(n / 60))); setMinutes(String(n % 60)); }}>{n} 分钟</button>)}</div>
      <div className="manual-fields"><label>结束时间<input aria-label="补录结束时间" type="time" required value={endTime} onChange={e => { setEndTime(e.target.value); setError(''); }} /></label><label>学习标签<select aria-label="补录学习标签" value={tagId} onChange={e => setTagId(e.target.value)}>{data.tags.filter(t => !t.archived).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div>
      <p className="manual-preview">{valid ? `${timeOfDay(startAt)} — ${endTime} · ${formatDuration(duration * 60000)}` : '请输入今天内的有效学习时长。'}</p>
      <p className="modal-note">请选择已完成的时间段；与已有记录重叠的时间不能重复补录。</p>
      {error && <p role="alert" className="field-error">{error}</p>}
      <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={!valid || busy}><Plus size={16} />{busy ? '正在保存…' : '保存学习时间'}</button></div>
    </form>
    {records.length > 0 && <div className="manual-history"><h3>今日补录 <span>{records.length}</span></h3>{records.map(s => {
      const segment = data.segments.find(item => item.session_id === s.id), tag = data.tags.find(t => t.id === segment?.tag_id);
      return <div className="manual-record" key={s.id}><Dot color={tag?.color || '#8b95a3'} /><div><strong>{tag?.name || '未分类'} · {formatDuration(s.elapsed_ms)}</strong><span>{timeOfDay(s.started_at)} — {timeOfDay(s.ended_at!)}</span></div><button type="button" className="icon-button delete" disabled={busy} aria-label={`删除补录 ${timeOfDay(s.started_at)}`} onClick={async () => { if (await action('study.removeManual', { id: s.id })) notify('补录已删除'); }}><Trash2 size={16} /></button></div>;
    })}</div>}
  </Modal>;
}
