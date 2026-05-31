import React, { useState, useRef, useEffect } from 'react';
import { Bot, Key, Lock, ShieldAlert, Send, CheckCircle2, XCircle, Wrench, Loader2 } from 'lucide-react';
import { runAgent, type AgentRunResponse } from '../api';
import { useI18n } from '../i18n';

interface Message {
  id: number;
  type: 'user' | 'agent' | 'tool_result' | 'loading';
  text: string;
  sanitizedText?: string; // Sanitized version for history (secrets replaced with refs)
  toolCalls?: AgentRunResponse['tool_calls'];
  secretRefs?: string[];
}

interface ChatProps {
  sessionId: string;
  onFirstMessage?: (msg: string) => void;
}


export function Chat({ sessionId, onFirstMessage }: ChatProps) {
  const { t } = useI18n();

  const welcomeMsg: Message = {
    id: 0,
    type: 'agent',
    text: t('chat.welcome'),
  };

  const [messages, setMessages] = useState<Message[]>([welcomeMsg]);
  const [inputVal, setInputVal] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 切换 session 或语言时重置消息
  useEffect(() => {
    setMessages([{
      id: 0,
      type: 'agent',
      text: t('chat.welcome'),
    }]);
    setInputVal('');
    setIsLoading(false);
   }, [sessionId, t]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = inputVal.trim();
    if (!text || isLoading) return;

    const userMsg: Message = { id: Date.now(), type: 'user', text };
    const loadingMsg: Message = { id: Date.now() + 1, type: 'loading', text: '' };
    
    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setInputVal('');
    setIsLoading(true);

    // 第一条用户消息时更新 session 标题
    if (messages.length <= 1 && onFirstMessage) {
      onFirstMessage(text);
    }

    try {
      // Build conversation history using SANITIZED text (never send raw passwords to LLM)
      const history = messages
        .filter(m => m.type === 'user' || m.type === 'agent')
        .filter(m => m.id !== 0) // exclude welcome
        .map(m => ({
          role: (m.type === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.sanitizedText || m.text, // Use sanitized version if available
        }));

      const resp = await runAgent({ user_message: text, session_id: sessionId, history });
      
      setMessages(prev => {
        const filtered = prev.filter(m => m.type !== 'loading');
        // Backfill sanitizedText on the user message we just sent
        const updated = filtered.map(m =>
          m.id === userMsg.id && resp.sanitized_input
            ? { ...m, sanitizedText: resp.sanitized_input }
            : m
        );
        const agentMsg: Message = {
          id: Date.now() + 2,
          type: 'agent',
          text: resp.reply,
          toolCalls: resp.tool_calls,
          secretRefs: resp.secret_refs_used,
        };
        return [...updated, agentMsg];
      });
    } catch (e: any) {
      setMessages(prev => {
        const filtered = prev.filter(m => m.type !== 'loading');
        return [...filtered, {
          id: Date.now() + 2,
          type: 'agent',
          text: `${t('chat.error')}: ${e.message || 'Request failed'}`,
        }];
      });
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden relative bg-background animate-in slide-in-from-left-4 duration-500">
      
      {/* Conversation Area */}
      <section className="flex-1 flex flex-col min-w-0 bg-surface-container-lowest">
        
        {/* Chat History */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 flex flex-col bg-[url('data:image/svg+xml,%3Csvg width=\'20\' height=\'20\' viewBox=\'0 0 20 20\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23d8d0c8\' fill-opacity=\'0.2\' fill-rule=\'evenodd\'%3E%3Ccircle cx=\'3\' cy=\'3\' r=\'1\'/%3E%3Ccircle cx=\'13\' cy=\'13\' r=\'1\'/%3E%3C/g%3E%3C/svg%3E')]"
        >
          {messages.map(msg => {
            if (msg.type === 'loading') {
              return (
                <div key={msg.id} className="flex gap-4 max-w-3xl self-start">
                  <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0" style={{ animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}>
                    <Bot className="text-primary w-4 h-4" />
                  </div>
                  <div className="glass-panel px-4 py-3.5 rounded-2xl rounded-tl-sm text-sm shadow-sm flex items-center gap-2.5 border-primary/20">
                    <Loader2 className="w-4 h-4 text-primary animate-spin" />
                    <span className="text-xs text-primary font-medium tracking-wide">{t('chat.processing')}</span>
                  </div>
                </div>
              );
            }

            if (msg.type === 'agent') {
              return (
                <div key={msg.id} className="flex gap-4 max-w-3xl self-start animate-in fade-in slide-in-from-bottom-2">
                  <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-1">
                    <Bot className="text-primary w-4 h-4" />
                  </div>
                  <div className="space-y-3 flex-1 min-w-0">
                    <div className="glass-panel p-4 rounded-2xl rounded-tl-sm text-sm text-on-surface leading-relaxed shadow-sm">
                      <p className="whitespace-pre-wrap">{msg.text}</p>
                    </div>

                    {/* Tool Calls */}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="space-y-2">
                        {msg.toolCalls.map((tc, i) => {
                          const isSuccess = !msg.text.toLowerCase().includes('error') && !msg.text.toLowerCase().includes('失败') && !msg.text.toLowerCase().includes('denied');
                          return (
                            <div key={i} className={`rounded-xl border p-3.5 ${isSuccess ? 'bg-green-50 border-green-200' : 'bg-tertiary/5 border-tertiary/20'}`}>
                              <div className="flex items-center gap-2 mb-2">
                                <Wrench className={`w-3.5 h-3.5 ${isSuccess ? 'text-green-600' : 'text-tertiary'}`} />
                                <span className="text-xs font-mono font-semibold text-on-surface">{tc.tool}</span>
                                {isSuccess ? (
                                  <span className="ml-auto flex items-center gap-1 text-[10px] text-green-700 font-bold uppercase">
                                    <CheckCircle2 className="w-3 h-3" /> {t('chat.success')}
                                  </span>
                                ) : (
                                  <span className="ml-auto flex items-center gap-1 text-[10px] text-tertiary font-bold uppercase">
                                    <XCircle className="w-3 h-3" /> {t('chat.failed')}
                                  </span>
                                )}
                              </div>
                              <div className="font-mono text-[11px] text-on-surface-variant space-y-1">
                                {Object.entries(tc.args).map(([k, v]) => (
                                  <div key={k} className="flex gap-2">
                                    <span className="text-secondary shrink-0">{k}:</span>
                                    <span className={`break-all ${v === '[REDACTED]' ? 'text-tertiary font-semibold flex items-center gap-1' : ''}`}>
                                      {v === '[REDACTED]' && <Lock className="w-3 h-3 inline" />}
                                      {v}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Secret Refs Used */}
                    {msg.secretRefs && msg.secretRefs.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {msg.secretRefs.map((ref, i) => (
                          <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-primary/5 border border-primary/20 rounded text-[10px] font-mono text-primary">
                            <Lock className="w-3 h-3" />
                            {ref.substring(0, 12)}****
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            // User message
            return (
              <div key={msg.id} className="flex gap-4 max-w-3xl self-end flex-row-reverse animate-in fade-in slide-in-from-bottom-2">
                <div className="w-8 h-8 rounded-full bg-surface-container border border-outline-variant flex items-center justify-center shrink-0 overflow-hidden mt-1 text-on-surface-variant font-bold text-xs">
                  U
                </div>
                <div className="bg-surface-container p-4 rounded-2xl rounded-tr-sm text-sm text-on-surface leading-relaxed border border-outline-variant shadow-sm">
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Input Area */}
        <div className="p-4 sm:p-5 bg-surface-container-lowest border-t border-outline-variant z-20 shadow-[0_-4px_15px_-3px_rgba(0,0,0,0.02)]">
          <div className="max-w-4xl mx-auto flex items-end gap-3 sm:gap-4">
            <div className="flex-1 relative glow-border rounded-xl bg-surface-container shadow-sm border border-outline-variant focus-within:border-primary/50 transition-colors">
              <textarea 
                ref={inputRef}
                className="w-full bg-transparent border-none rounded-xl pl-4 pr-12 py-3.5 text-sm text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:ring-0 resize-none min-h-[52px] max-h-32" 
                placeholder={t('chat.inputPlaceholder')} 
                rows={1}
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
              ></textarea>
              <button 
                onClick={handleSend}
                disabled={isLoading || !inputVal.trim()}
                className="absolute right-2.5 bottom-2.5 p-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-all active:scale-95 flex items-center justify-center shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
              </button>
            </div>
          </div>
          
          <div className="max-w-4xl mx-auto mt-3 flex justify-between items-center text-[10px] sm:text-xs text-on-surface-variant font-medium px-1">
            <span className="flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5 opacity-70" /> {t('chat.securityHint')}</span>
            <span className="flex items-center gap-1.5 font-mono"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span> {t('chat.agentActive')}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
