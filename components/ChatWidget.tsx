import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { Icon } from './Icon';
import { db } from '../firebase';

type ChatMessage = {
  role: 'user' | 'model';
  parts: string;
};

type ProxyCandidate = {
  id: string;
  name: string;
  position?: string;
  company?: string;
};

type ConnectionDoc = {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  company?: string | null;
  position?: string | null;
};

const PROXY_CHAT_URL = 'http://localhost:8787/gemini/chat';

function buildCandidates(rows: ConnectionDoc[], fallbackName: string): ProxyCandidate[] {
  const mapped = rows
    .slice(0, 120)
    .map((row, index) => {
      const joinedName = `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim();
      const name = (row.fullName || joinedName || `Connection ${index + 1}`).trim();
      const position = (row.position || '').trim();
      const company = (row.company || '').trim();

      return {
        id: `c${index}`,
        name,
        position: position || undefined,
        company: company || undefined,
      };
    });

  if (mapped.length > 0) return mapped;

  return [
    {
      id: 'c0',
      name: fallbackName,
      position: 'General Network Contact',
      company: 'Your Network',
    },
  ];
}

function toProxyMessages(messages: ChatMessage[]) {
  return messages.map((m) => ({
    role: m.role === 'model' ? 'assistant' : 'user',
    text: m.parts,
  }));
}

function formatAssistantReply(data: any): string {
  const answer = typeof data?.answer === 'string' ? data.answer.trim() : '';
  const recommendations = Array.isArray(data?.recommendations) ? data.recommendations : [];

  if (!recommendations.length) {
    return answer || 'I could not generate recommendations yet. Please try again.';
  }

  const lines = recommendations
    .slice(0, 8)
    .map((r: any, idx: number) => {
      const id = String(r?.id ?? '').trim();
      const reason = String(r?.reason ?? '').trim();
      return `${idx + 1}. ${id || 'candidate'}${reason ? ` - ${reason}` : ''}`;
    })
    .join('\n');

  if (!answer) {
    return `Top intros from your network:\n${lines}`;
  }

  return `${answer}\n\nTop intros:\n${lines}`;
}

const ChatWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [candidates, setCandidates] = useState<ProxyCandidate[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'model',
      parts:
        'Hi, I am your network copilot. Ask me for intro targets, outreach strategy, or who best fits a founder profile.',
    },
  ]);

  const loadedCandidatesRef = useRef(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const canSend = useMemo(() => input.trim().length > 0 && !isSending, [input, isSending]);

  useEffect(() => {
    if (!isOpen || loadedCandidatesRef.current) return;

    const loadCandidates = async () => {
      try {
        const user = getAuth().currentUser;
        const fallbackName = user?.displayName || 'Network Contact';

        if (!user) {
          setCandidates(buildCandidates([], fallbackName));
          loadedCandidatesRef.current = true;
          return;
        }

        const col = collection(db, 'users', user.uid, 'connections');
        const snap = await getDocs(col);
        const rows = snap.docs.map((d) => d.data() as ConnectionDoc);

        setCandidates(buildCandidates(rows, fallbackName));
      } catch {
        setCandidates(buildCandidates([], 'Network Contact'));
      } finally {
        loadedCandidatesRef.current = true;
      }
    };

    void loadCandidates();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!viewportRef.current) return;
    viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
  }, [messages, isSending, isOpen]);

  const sendMessage = async () => {
    const query = input.trim();
    if (!query || isSending) return;

    const userMessage: ChatMessage = { role: 'user', parts: query };
    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
    setInput('');
    setIsSending(true);

    const fallbackName = getAuth().currentUser?.displayName || 'Network Contact';
    const safeCandidates = candidates.length ? candidates : buildCandidates([], fallbackName);

    try {
      const response = await fetch(PROXY_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          messages: toProxyMessages(nextMessages),
          candidates: safeCandidates,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || `Chat request failed with ${response.status}`);
      }

      const data = await response.json();
      const assistantText = formatAssistantReply(data);

      setMessages((prev) => [...prev, { role: 'model', parts: assistantText }]);

      // Future work-doing hook:
      // Parse `data.recommendations` here and dispatch actions that can update
      // shared app state (selected connections, draft outreach, saved tasks, etc.).
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'model',
          parts: 'I could not reach the Gemini proxy right now. Check that http://localhost:8787 is running and try again.',
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed bottom-3 right-3 sm:bottom-6 sm:right-6 z-50 flex flex-col items-end pointer-events-none">
      {isOpen && (
        <section
          className="pointer-events-auto mb-3 glass-panel rounded-2xl border border-white/10 shadow-2xl overflow-hidden animate-fade-in-up w-[min(24rem,calc(100vw-1rem))] h-[min(30rem,62vh)]"
          aria-label="AI chat widget"
        >
          <div className="h-full flex flex-col bg-background-dark/70">
            <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-primary/20 text-primary flex items-center justify-center">
                  <Icon name="smart_toy" className="text-base" />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-white">Network AI Assistant</h3>
                  <p className="text-[11px] text-slate-400">Gemini proxy connected</p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="w-8 h-8 rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition-all"
                aria-label="Close chat"
              >
                <Icon name="close" className="text-base" />
              </button>
            </header>

            <div ref={viewportRef} className="flex-1 overflow-y-auto custom-scrollbar px-3 py-3 space-y-3">
              {messages.map((message, index) => {
                const isModel = message.role === 'model';
                return (
                  <div key={`${message.role}-${index}`} className={`flex ${isModel ? 'justify-start' : 'justify-end'}`}>
                    <div
                      className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap border ${
                        isModel
                          ? 'bg-white/5 border-white/10 text-slate-200'
                          : 'bg-primary/20 border-primary/30 text-slate-50'
                      }`}
                    >
                      {message.parts}
                    </div>
                  </div>
                );
              })}

              {isSending && (
                <div className="flex justify-start">
                  <div className="rounded-2xl px-3 py-2 text-sm border bg-white/5 border-white/10 text-slate-300 inline-flex items-center gap-2">
                    <span className="animate-pulse">Typing</span>
                    <span className="inline-flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse"></span>
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse [animation-delay:120ms]"></span>
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse [animation-delay:240ms]"></span>
                    </span>
                  </div>
                </div>
              )}
            </div>

            <form
              className="p-3 border-t border-white/10 bg-black/20"
              onSubmit={(e) => {
                e.preventDefault();
                void sendMessage();
              }}
            >
              <div className="flex items-center gap-2 bg-slate-900/70 border border-white/10 rounded-xl px-3 py-2 focus-within:border-primary/50">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about your network..."
                  className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 outline-none"
                />
                <button
                  type="submit"
                  disabled={!canSend}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
                    canSend
                      ? 'bg-primary text-white hover:bg-primary/90 active:scale-95'
                      : 'bg-white/10 text-slate-500 cursor-not-allowed'
                  }`}
                  aria-label="Send message"
                >
                  <Icon name="send" className="text-base" />
                </button>
              </div>
            </form>
          </div>
        </section>
      )}

      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="pointer-events-auto w-14 h-14 rounded-full bg-primary text-white shadow-[0_12px_36px_rgba(19,91,236,0.45)] hover:bg-primary/90 transition-all active:scale-95 flex items-center justify-center"
        aria-label={isOpen ? 'Hide AI chat' : 'Open AI chat'}
      >
        <Icon name={isOpen ? 'close' : 'smart_toy'} className="text-[26px]" />
      </button>
    </div>
  );
};

export default ChatWidget;