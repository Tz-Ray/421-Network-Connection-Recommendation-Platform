import type { CompactConnection } from './connectionsStore';

export type AssistantMessage = {
  role: 'user' | 'assistant';
  text: string;
  answer?: string;
  people?: { person: CompactConnection; reason: string; personId: string; chip?: string }[];
};
export type AssistantThread = { id: string; title: string; messages: AssistantMessage[]; draft?: string };
let owner: string | null = null;
let sequence = 0;
let threads: AssistantThread[] = [];
let active: string | null = null;

export function setConversationOwner(uid: string | null) {
  if (owner === uid) return;
  owner = uid;
  threads = [];
  active = null;
}
export function visitConversations(uid: string) {
  setConversationOwner(uid);
  return { threads, active };
}
export function saveConversation(uid: string, id: string, messages: AssistantMessage[], draft = '') {
  if (owner !== uid) return;
  const title = messages.find((m) => m.role === 'user')?.text || draft || 'New conversation';
  const thread = { id, title, messages, draft };
  threads = threads.some((t) => t.id === id)
    ? threads.map((t) => (t.id === id ? thread : t))
    : messages.length || draft
      ? [...threads, thread]
      : threads;
  active = id;
}
export function conversationId() {
  return `conversation-${++sequence}`;
}
if (typeof window !== 'undefined') window.addEventListener('ncrp-sign-out', () => setConversationOwner(null));
