import type { CompanionBridge } from './companion-types';
export type Mode = 'focus' | 'break';
export type Mood = 'bad' | 'low' | 'normal' | 'good' | 'great';
export type Tag = { id: string; name: string; color: string; archived: number; created_at: number };
export type Todo = { id: string; title: string; tag_id: string | null; created_at: number; completed_at: number | null; deleted_at: number | null; remind_at: number | null; reminded_at: number | null };
export type TodoEvent = { id: string; todo_id: string; kind: string; title: string; at: number };
export type Note = { id: string; body: string; created_at: number; updated_at: number; deleted_at: number | null };
export type Daily = { day: string; mood: Mood; review: string };
export type Segment = { id: string; session_id: string; tag_id: string; todo_id: string | null; start_at: number; end_at: number; duration_ms: number };
export type Session = { id: string; mode: Mode; started_at: number; ended_at: number | null; elapsed_ms: number; status: string };
export type Timer = { mode: Mode; status: 'idle' | 'running' | 'paused' | 'completed'; plannedMs: number; elapsedMs: number; sessionId: string | null; tagId: string; todoId: string | null; segmentId: string | null; lastAt: number; message: string };
export type Snapshot = { version: number; revision: number; timer: Timer; tags: Tag[]; todos: Todo[]; todoEvents: TodoEvent[]; notes: Note[]; daily: Daily[]; sessions: Session[]; segments: Segment[] };
export type Tick = { revision: number; timer: Timer; segment?: Segment; reload?: boolean };
export type Result = { ok: boolean; data?: Snapshot; error?: string; message?: string; canceled?: boolean };
export type Bridge = { runtime: { sandboxed: boolean; contextIsolated: boolean }; load: () => Promise<Snapshot>; dispatch: (action: string, payload?: Record<string, unknown>) => Promise<Result>; exportData: () => Promise<Result>; backup: () => Promise<Result>; quit: () => Promise<void>; onReminder: (fn: (todo: Todo) => void) => () => void; onTick: (fn: (tick: Tick) => void) => () => void; onQuickAdd: (fn: () => void) => () => void };
declare global { interface Window { studyDesk: Bridge & CompanionBridge; } }
