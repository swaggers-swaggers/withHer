import type { Segment } from './types.ts';
export const dayKey = (value: Date | number) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const dateFromKey = (day: string) => new Date(`${day}T12:00:00`);
export const sameDay = (a: number, b: Date | number) => dayKey(a) === dayKey(b);
export const addDays = (date: Date, count: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + count, 12);
export type Period = 'day' | 'week' | 'month';
export function periodRange(period: Period, anchor: Date): [number, number] {
  const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  if (period === 'day') return [+d, +new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)];
  if (period === 'week') {
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    return [+d, +new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)];
  }
  return [+new Date(d.getFullYear(), d.getMonth(), 1), +new Date(d.getFullYear(), d.getMonth() + 1, 1)];
}
export function total(segments: Segment[], start = -Infinity, end = Infinity, tagId?: string) {
  return segments.reduce((sum, s) => {
    if (tagId && s.tag_id !== tagId) return sum;
    const overlap = Math.max(0, Math.min(s.end_at, end) - Math.max(s.start_at, start));
    return sum + (s.end_at > s.start_at ? overlap * s.duration_ms / (s.end_at - s.start_at) : 0);
  }, 0);
}
export const formatDuration = (ms: number) => {
  const mins = Math.floor(ms / 60000);
  if (ms > 0 && mins === 0) return '< 1 分钟';
  if (mins < 60) return `${mins} 分钟`;
  return `${Math.floor(mins / 60)} 小时${mins % 60 ? ` ${mins % 60} 分钟` : ''}`;
};
export const shortDuration = (ms: number) => {
  if (ms > 0 && ms < 60000) return '<1m';
  const mins = Math.floor(ms / 60000);
  return mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}` : `${mins}m`;
};
export const timeOfDay = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
export function buckets(period: Period, anchor: Date) {
  const [start, end] = periodRange(period, anchor);
  const result: { start: number; end: number; label: string; full: string }[] = [];
  if (period === 'day') {
    // 按真实小时递进，可正确覆盖夏令时的 23/25 小时日。
    for (let at = start; at < end; at += 3600000) result.push({ start: at, end: Math.min(at + 3600000, end), label: String(new Date(at).getHours()), full: `${timeOfDay(at)}–${timeOfDay(Math.min(at + 3600000, end))}` });
  } else {
    for (let at = new Date(start); +at < end; at = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1)) {
      const next = +new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1);
      result.push({ start: +at, end: next, label: period === 'week' ? ['日', '一', '二', '三', '四', '五', '六'][at.getDay()] : String(at.getDate()), full: `${at.getMonth() + 1} 月 ${at.getDate()} 日` });
    }
  }
  return result;
}
export function movePeriod(period: Period, anchor: Date, direction: number) {
  return period === 'month' ? new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1, 12) : addDays(anchor, direction * (period === 'week' ? 7 : 1));
}
