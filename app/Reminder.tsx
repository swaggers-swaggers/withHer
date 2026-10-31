import { useState } from 'react';
import { Bell } from './icons';
import { Modal } from './ui';
import { dayKey } from './analytics';

export function localDateTime(at: number) {
  const date = new Date(at);
  return `${dayKey(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
export function reminderLabel(at: number) {
  const date = new Date(at);
  const day = dayKey(date) === dayKey(Date.now()) ? '今天' : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  return `${day} ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}
export function ReminderDialog({ initialAt, onSave, onClose }: { initialAt: number | null; onSave: (at: number | null) => Promise<boolean>; onClose: () => void }) {
  const [value, setValue] = useState(initialAt ? localDateTime(initialAt) : '');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const save = async (at: number | null) => {
    if (busy) return;
    if (at !== null && (!Number.isFinite(at) || at <= Date.now())) { setError('请选择晚于当前时间的日期和时间'); return; }
    setBusy(true);
    if (await onSave(at)) onClose();
    else { setBusy(false); setError('保存失败，请重试'); }
  };
  return <Modal title="待办提醒" onClose={onClose}>
    <label className="reminder-field">日期和时间<input aria-label="提醒日期和时间" type="datetime-local" value={value} min={localDateTime(Date.now())} onChange={e => { setValue(e.target.value); setError(''); }} /></label>
    <div className="reminder-presets">{[10, 30, 60].map(minutes => <button type="button" key={minutes} className="secondary" onClick={() => { setValue(localDateTime(Math.ceil((Date.now() + minutes * 60000) / 60000) * 60000)); setError(''); }}>{minutes === 60 ? '1 小时后' : `${minutes} 分钟后`}</button>)}</div>
    {error && <p role="alert" className="field-error">{error}</p>}
    <p className="reminder-info">关闭窗口后仍会提醒。完成或删除事项后取消提醒。</p>
    <div className="modal-actions"><button className="text-button clear-reminder" disabled={busy} onClick={() => void save(null)}>取消提醒</button><button className="secondary" disabled={busy} onClick={onClose}>返回</button><button className="primary" disabled={busy || !value} onClick={() => void save(new Date(value).getTime())}><Bell size={14} />保存提醒</button></div>
  </Modal>;
}
