export type ChatQuote = { messageId: string; author: string; content: string };
export type ChatMessage = { seq: number; id: string; conversation_id: string; role: 'user' | 'assistant'; content: string; displayContent?: string; displayParts?: string[]; displayKinds?: ('text' | 'code')[]; quotes?: ChatQuote[]; status: string; created_at: number };
export type CompanionState = {
  conversation: { id: string; title: string };
  messages: ChatMessage[];
  config: { model: string };
  credentials: { configured: boolean; storage: 'encrypted' | 'session'; error: string };
  busy: boolean;
  engine: { status: string; error: string; paused: boolean; studyMemoryError: string };
};
export type CompanionEvent = { type: 'state' | 'error' | 'delivered' | 'open-chat'; conversationId?: string; content?: string; message?: string; autonomous?: boolean; popup?: boolean };
export type CompanionResult = { ok: boolean; error?: string; state?: CompanionState; messages?: ChatMessage[] };
export type CompanionBridge = {
  companionLoad: () => Promise<CompanionState>;
  companionCommand: (action: string, payload?: Record<string, unknown>) => Promise<CompanionResult>;
  onCompanion: (fn: (event: CompanionEvent) => void) => () => void;
};
