import type { SVGProps, ReactNode } from 'react';

// StudyDesk「折页」图标：切角轮廓、半透明纸面和一枚折角，24px 光学网格。
type Props = SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number };
const sheet = <path d="M5 3.5h10l4 4v13H5Z" fill="currentColor" opacity=".12" stroke="none" />;
function icon(name: string, drawing: ReactNode) {
  return function StudyIcon({ size = 24, strokeWidth = 1.65, ...props }: Props) {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`study-icon icon-${name}`} {...props}>{drawing}</svg>;
  };
}
export const BookOpen = icon('desk', <><path d="m3 5 7 2v14l-7-3Zm18-2-8 4v14l8-5Z" fill="currentColor" opacity=".16" stroke="none" /><path d="m3 5 7 2v14l-7-3Zm18-2-8 4v14l8-5ZM7 10v5m10-7v5" /><path d="m9 3 3 1.5L15 3" opacity=".5" /></>);
export const ChartNoAxesCombined = icon('growth', <><path d="M4 15h4v6H4Zm6-5h4v11h-4Zm6-7h4v18h-4Z" fill="currentColor" opacity=".15" stroke="none" /><path d="M4 17v4h16V5m-10 16V11m6 10v-7M3 10l5-3 4 1 7-5m-4 0h4v4" /></>);
export const CalendarDays = icon('calendar', <>{sheet}<path d="M5 3.5h10l4 4v13H5Zm10 0V8h4M8 2v4M5 10h14m-10 4h1m4 0h1m-6 3h1m4 0h1" /><path d="m18 15 3 2-3 2" fill="currentColor" opacity=".3" /></>);
export const ListTodo = icon('tasks', <>{sheet}<path d="M5 3.5h10l4 4v13H5Zm10 0V8h4m-11 4 1 1 2-2m-3 6 1 1 2-2m2-4h3m-3 5h3" /></>);
export const StickyNote = icon('note', <><path d="M4 4h16v10l-7 6H4Z" fill="currentColor" opacity=".13" stroke="none" /><path d="M4 4h16v10l-7 6H4Zm9 16v-6h7M8 8h8m-8 3h5" /><path d="m13 20 1-5 6-1" opacity=".45" /></>);
export const Clock3 = icon('time', <><path d="m12 2 9 5v10l-9 5-9-5V7Z" fill="currentColor" opacity=".1" stroke="none" /><path d="m12 2 9 5v10l-9 5-9-5V7Zm0 5v5l4 2" /><path d="M7 6 5 8m12 10 2-2" opacity=".4" /></>);
export const Pencil = icon('write', <><path d="m5 14-1 6 6-1L21 8l-5-5Z" fill="currentColor" opacity=".13" stroke="none" /><path d="m5 14-1 6 6-1L21 8l-5-5Zm8-8 5 5M5 14l5 5m-6 1h15" /></>);
export const Bell = icon('reminder', <><path d="m12 3 6 4v8l3 3H3l3-3V7Z" fill="currentColor" opacity=".12" stroke="none" /><path d="m12 3 6 4v8l3 3H3l3-3V7Zm-2 18h4m-2-18V1" /><path d="m15 8 1 1v4" opacity=".5" /></>);
export const HardDrive = icon('archive', <><path d="m3 7 9-4 9 4-9 4Z" fill="currentColor" opacity=".16" stroke="none" /><path d="m3 7 9-4 9 4v13H3Zm0 0 9 4 9-4M3 14h18m-6 3h3" /><path d="m12 3 4 4-4 4" opacity=".4" /></>);
export const Download = icon('export', <><path d="m3 16 9 5 9-5-9-4Z" fill="currentColor" opacity=".13" stroke="none" /><path d="M12 2v12m-4-4 4 4 4-4M3 15v3l9 4 9-4v-3" /></>);
export const Tags = icon('tags', <><path d="M3 3h8l10 10-8 8L3 11Z" fill="currentColor" opacity=".13" stroke="none" /><path d="M3 3h8l10 10-8 8L3 11Zm13 4 6 6-8 9" /><circle cx="7.5" cy="7.5" r="1" /></>);
export const Settings2 = icon('adjust', <><path d="M4 7h16M4 17h16" /><path d="m8 4 3 3-3 3-3-3Zm8 10 3 3-3 3-3-3Z" fill="currentColor" opacity=".4" /></>);
export const Flame = icon('peak', <><path d="m12 2 8 11-3 8H7l-3-8 5-6 1 5Z" fill="currentColor" opacity=".13" stroke="none" /><path d="m12 2 8 11-3 8H7l-3-8 5-6 1 5Zm0 12-3 5h6Z" /></>);
export const CalendarCheck2 = icon('days', <>{sheet}<path d="M5 3.5h10l4 4v13H5Zm10 0V8h4M8 2v4m0 9 3 3 5-6" /></>);
export const ListFilter = icon('filter', <><path d="M3 4h18l-7 9v6l-4 2v-8Z" fill="currentColor" opacity=".13" stroke="none" /><path d="M3 4h18l-7 9v6l-4 2v-8ZM7 8h10" /></>);
export const MessageSquare = icon('thought', <><path d="M3 4h13l5 5v9h-9l-5 4v-4H3Z" fill="currentColor" opacity=".12" stroke="none" /><path d="M3 4h13l5 5v9h-9l-5 4v-4H3Zm13 0v5h5M7 9h5m-5 4h10" /></>);
export const Coffee = icon('rest', <><path d="M4 9h12v9l-3 3H7l-3-3Z" fill="currentColor" opacity=".13" stroke="none" /><path d="M4 9h12v9l-3 3H7l-3-3Zm12 1h5v5h-5M7 2l2 2-2 2m5-4 2 2-2 2" /></>);
export const Trash2 = icon('remove', <><path d="m6 7 1 14h10l1-14" fill="currentColor" opacity=".1" /><path d="M3 6h18M9 6V3h6v3m-5 4v7m4-7v7" /></>);
export const Power = icon('power', <><path d="m7 4-4 4v10l9 4 9-4V8l-4-4M12 2v10" /></>);
export const Play = icon('play', <><path d="m6 3 15 9-15 9Z" fill="currentColor" opacity=".16" /><path d="m6 3 15 9-15 9Zm0 0 4 9-4 9" /></>);
export const Pause = icon('pause', <><path d="m5 4 4-1v17l-4 1Zm10 0 4-1v17l-4 1Z" fill="currentColor" opacity=".5" /></>);
export const Square = icon('stop', <><path d="M5 4h11l4 4v12H5Z" fill="currentColor" opacity=".15" /><path d="M16 4v4h4" /></>);
export const Check = icon('check', <path d="m4 12 5 6L21 5m-12 13 1-7" />);
export const Plus = icon('plus', <><path d="M12 4v16M4 12h16" /><path d="m12 4 2 2m6 6-2 2" opacity=".5" /></>);
export const X = icon('close', <path d="m6 6 12 12M18 6 6 18" />);
export const ArrowUpRight = icon('open', <path d="M5 19 19 5M9 5h10v10m-14-1v5h5" />);
export const Maximize = icon('expand', <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />);
export const Minimize = icon('restore-size', <path d="M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5" />);
export const ChevronRight = icon('right', <path d="m8 5 8 7-8 7m0-14v4" />);
export const ChevronLeft = icon('left', <path d="m16 5-8 7 8 7m0-14v4" />);
export const ChevronDown = icon('down', <path d="m5 8 7 8 7-8M5 8h4" />);
export const RotateCcw = icon('restore', <path d="M4 10a8 8 0 1 1 1 8M4 3v7h7" />);
export const Volume2 = icon('sound', <><path d="M3 9h4l6-5v16l-6-5H3Z" fill="currentColor" opacity=".15" /><path d="m17 8 3 4-3 4m2-12 4 8-4 8" /></>);
export const VolumeX = icon('silent', <><path d="M3 9h4l6-5v16l-6-5H3Z" fill="currentColor" opacity=".15" /><path d="m17 9 5 6m0-6-5 6" /></>);
export const Circle = icon('seed', <><path d="M12 2 21 8v10l-9 4-9-4V8Z" fill="currentColor" opacity=".12" /><path d="m8 13 4 3 5-7" /></>);
export const Smile = icon('good', <><path d="m12 2 9 6-3 13H6L3 8Z" fill="currentColor" opacity=".12" /><path d="M8 9v1m8-1v1m-8 4q4 5 8 0" /></>);
export const Meh = icon('normal', <><path d="m12 2 9 6-3 13H6L3 8Z" fill="currentColor" opacity=".12" /><path d="M8 9v1m8-1v1m-8 5h8" /></>);
export const Frown = icon('bad', <><path d="m12 2 9 6-3 13H6L3 8Z" fill="currentColor" opacity=".12" /><path d="M8 9v1m8-1v1m-8 7q4-5 8 0" /></>);
export const Cloud = icon('low', <><path d="m3 12 5-6h8l5 6-3 6H6Z" fill="currentColor" opacity=".14" /><path d="m3 12 5-6h8l5 6-3 6H6Zm5 1h1m6 0h1m-6 2h4M8 21l1-1m6 1 1-1" /></>);
export const Sun = icon('great', <><path d="m12 4 7 4v8l-7 4-7-4V8Z" fill="currentColor" opacity=".15" /><path d="m12 4 7 4v8l-7 4-7-4V8ZM9 9v1m6-1v1m-6 3q3 4 6 0M12 0v1m0 22v1M0 12h1m22 0h1M3 3l1 1m16 16 1 1M3 21l1-1M20 4l1-1" /></>);
