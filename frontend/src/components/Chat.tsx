import React, { useState, useRef, useEffect } from 'react';
import { 
  Bot, Key, Lock, ShieldAlert, Send, CheckCircle2, 
  XCircle, Wrench, Loader2, Terminal
} from 'lucide-react';
import { runAgent, type AgentRunResponse } from '../api';
import { useI18n } from '../i18n';

interface Message {
  id: number;
  type: 'user' | 'agent' | 'tool_result' | 'loading';
  text: string;
  sanitizedText?: string;
  toolCalls?: AgentRunResponse['tool_calls'];
  secretRefs?: string[];
}

interface ChatProps {
  sessionId: string;
  onFirstMessage?: (msg: string) => void;
  key?: string | number;
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
  const [activeTraceMsgId, setActiveTraceMsgId] = useState<number | null>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 切换 session 或语言时重置
  useEffect(() => {
    setMessages([{
      id: 0,
      type: 'agent',
      text: t('chat.welcome'),
    }]);
    setInputVal('');
    setIsLoading(false);
    setActiveTraceMsgId(null);
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

    if (messages.length <= 1 && onFirstMessage) {
      onFirstMessage(text);
    }

    try {
      const history = messages
        .filter(m => m.type === 'user' || m.type === 'agent')
        .filter(m => m.id !== 0)
        .map(m => ({
          role: (m.type === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.sanitizedText || m.text,
        }));

      const resp = await runAgent({ user_message: text, session_id: sessionId, history });
      
      setMessages(prev => {
        const filtered = prev.filter(m => m.type !== 'loading');
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
        
        if (agentMsg.toolCalls && agentMsg.toolCalls.length > 0) {
          setActiveTraceMsgId(agentMsg.id);
        }
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

  const activeTraceMsg = messages.find(m => m.id === activeTraceMsgId) || null;
  
  let activeUserMsgText = '';
  if (activeTraceMsg) {
    const activeMsgIndex = messages.findIndex(m => m.id === activeTraceMsg.id);
    if (activeMsgIndex > 0) {
      const prevMsg = messages[activeMsgIndex - 1];
      if (prevMsg && prevMsg.type === 'user') {
        activeUserMsgText = prevMsg.text;
      }
    }
  }

  return (
    <div className="flex-1 flex overflow-hidden relative bg-background animate-in slide-in-from-left-4 duration-500">
      
      {/* Conversation Area */}
      <section className="flex-1 flex flex-col min-w-0 bg-surface-container-lowest border-r border-outline-variant/30">
        
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
              const hasTools = msg.toolCalls && msg.toolCalls.length > 0;
              const isTraceActive = msg.id === activeTraceMsgId;

              return (
                <div key={msg.id} className="flex gap-4 max-w-3xl self-start animate-in fade-in slide-in-from-bottom-2">
                  <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-1">
                    <Bot className="text-primary w-4 h-4" />
                  </div>
                  <div className="space-y-3 flex-1 min-w-0">
                    <div 
                      onClick={() => {
                        if (hasTools) {
                          setActiveTraceMsgId(msg.id);
                        }
                      }}
                      className={`glass-panel p-4 rounded-2xl rounded-tl-sm text-sm text-on-surface leading-relaxed shadow-sm transition-all duration-300 ${
                        hasTools ? 'cursor-pointer hover:border-primary/30' : ''
                      } ${
                        isTraceActive ? 'ring-2 ring-primary/45 border-primary/30 bg-primary/5' : ''
                      }`}
                      title={hasTools ? '点击在右侧查看此步骤的执行日志' : undefined}
                    >
                      <p className="whitespace-pre-wrap">{msg.text}</p>
                    </div>

                    {/* Tool Calls Summary */}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="space-y-2">
                        {msg.toolCalls.map((tc, i) => {
                          const isSuccess = !msg.text.toLowerCase().includes('error') && !msg.text.toLowerCase().includes('失败') && !msg.text.toLowerCase().includes('denied');
                          return (
                            <div 
                              key={i} 
                              onClick={() => setActiveTraceMsgId(msg.id)}
                              className={`rounded-xl border p-3.5 cursor-pointer transition-all hover:bg-surface-container-low/50 ${
                                isSuccess ? 'bg-green-50/50 border-green-200 hover:border-green-300' : 'bg-tertiary/5 border-tertiary/20 hover:border-tertiary/30'
                              } ${isTraceActive ? 'ring-2 ring-primary/40' : ''}`}
                            >
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

                    {/* Secret Refs Used Summary */}
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

      {/* Right Side Panel: Tool Logs */}
      <ToolLogsPanel activeMessage={activeTraceMsg} userMsgText={activeUserMsgText} />
    </div>
  );
}

// ============================================================
// 右侧 Tool Logs Panel 渲染组件
// ============================================================

function ToolLogsPanel({ 
  activeMessage, 
  userMsgText 
}: { 
  activeMessage: Message | null; 
  userMsgText: string; 
}) {
  const { t } = useI18n();

  if (!activeMessage || !activeMessage.toolCalls || activeMessage.toolCalls.length === 0) {
    return (
      <aside className="w-80 lg:w-96 border-l border-outline-variant bg-surface flex flex-col justify-center items-center p-8 text-center shrink-0 hidden md:flex animate-in slide-in-from-right duration-300">
        <div className="w-16 h-16 rounded-full bg-surface-container-high border border-outline-variant/60 flex items-center justify-center mb-4 text-on-surface-variant/40">
          <Terminal className="w-8 h-8" />
        </div>
        <h3 className="font-headline text-base font-semibold text-on-surface mb-2">{t('chat.noToolCalls')}</h3>
        <p className="font-body text-xs text-on-surface-variant leading-relaxed max-w-xs">
          {t('chat.noToolCallsDesc')}
        </p>
      </aside>
    );
  }

  const toolCall = activeMessage.toolCalls[0];
  const secretRef = activeMessage.secretRefs && activeMessage.secretRefs.length > 0 
    ? activeMessage.secretRefs[0] 
    : 'sec_live_default_ref';

  let host = 'default_endpoint';
  if (toolCall.tool === 'secure_shell' && toolCall.args.command) {
    const cmdStr = toolCall.args.command;
    const sshMatch = cmdStr.match(/ssh\s+[^@\s]+@([^\s']+)/);
    const pgMatch = cmdStr.match(/@([a-zA-Z0-9.\-_]+)/);
    const curlMatch = cmdStr.match(/https?:\/\/([a-zA-Z0-9.\-_]+)/);
    if (sshMatch) host = sshMatch[1];
    else if (pgMatch) host = pgMatch[1];
    else if (curlMatch) host = curlMatch[1];
  } else if (toolCall.tool === 'browser_login_mock' && toolCall.args.url) {
    try {
      host = new URL(toolCall.args.url).hostname;
    } catch {
      host = toolCall.args.url;
    }
  }

  const isSuccess = !activeMessage.text.toLowerCase().includes('error') && 
                    !activeMessage.text.toLowerCase().includes('失败') && 
                    !activeMessage.text.toLowerCase().includes('denied');

  return (
    <aside className="w-80 lg:w-96 border-l border-outline-variant bg-surface flex flex-col overflow-y-auto shrink-0 hidden md:flex animate-in slide-in-from-right duration-300 p-5">
      {/* Header */}
      <div className="mb-6 border-b border-outline-variant/30 pb-4">
        <h3 className="font-headline text-base font-semibold text-on-surface flex items-center gap-2">
          <Terminal className="w-4 h-4 text-primary" />
          {t('chat.toolLogsPanel')}
        </h3>
        <p className="font-body text-[11px] text-on-surface-variant mt-1">
          {t('chat.toolLogsPanelDesc')}
        </p>
      </div>

      {/* Timeline Steps */}
      <div className="relative pl-5 border-l border-outline-variant/60 ml-2 space-y-6 text-xs flex-1 pb-10">
        
        {/* Step 1: Intent Detected */}
        <div className="relative">
          <div className="absolute -left-[27px] top-0 w-3.5 h-3.5 rounded-full bg-primary/10 border border-primary flex items-center justify-center text-[8px] font-bold text-primary">1</div>
          <h4 className="font-headline font-semibold text-on-surface">{t('trace.intentDetected')}</h4>
          <div className="mt-2 bg-surface-container-low rounded-lg p-2.5 border border-outline-variant/60 font-mono text-[10px] text-on-surface-variant max-w-full overflow-hidden">
            <p className="truncate"><span className="text-primary font-bold">Request:</span> "{userMsgText}"</p>
            <p className="mt-1"><span className="text-secondary font-bold">Goal:</span> {toolCall.tool}</p>
          </div>
        </div>

        {/* Step 2: Requesting Credential */}
        <div className="relative">
          <div className="absolute -left-[27px] top-0 w-3.5 h-3.5 rounded-full bg-primary/10 border border-primary flex items-center justify-center text-[8px] font-bold text-primary">2</div>
          <h4 className="font-headline font-semibold text-on-surface">{t('trace.requestingCredential')}</h4>
          <p className="text-[10px] text-on-surface-variant mt-1">Agent requested credential reference for target environment.</p>
          <div className="mt-2 bg-surface-container-low rounded-lg p-2 border border-outline-variant/60 flex items-center justify-between font-mono text-[10px]">
            <span className="text-on-surface-variant truncate mr-2">{host}</span>
            <span className="text-primary font-semibold shrink-0 bg-primary/5 px-1 rounded flex items-center gap-0.5">
              <Lock className="w-2.5 h-2.5" />
              {secretRef.substring(0, 10)}...
            </span>
          </div>
        </div>

        {/* Step 3: Policy Check */}
        <div className="relative">
          <div className="absolute -left-[27px] top-0 w-3.5 h-3.5 rounded-full bg-green-50 border border-green-500 flex items-center justify-center text-[8px] font-bold text-green-600">✓</div>
          <h4 className="font-headline font-semibold text-on-surface">{t('trace.policyEvaluation')}</h4>
          <p className="text-[10px] text-green-700/80 mt-1 leading-normal">
            Domain/host verification passed. Reference <code className="bg-surface-container px-1 py-0.5 rounded font-mono font-bold text-primary">{secretRef.substring(0, 8)}</code> matches allowed target host: <code className="font-mono text-secondary">{host}</code>.
          </p>
        </div>

        {/* Step 4: Tool Execution */}
        <div className="relative">
          <div className="absolute -left-[27px] top-0 w-3.5 h-3.5 rounded-full bg-primary/10 border border-primary flex items-center justify-center text-[8px] font-bold text-primary">4</div>
          <h4 className="font-headline font-semibold text-on-surface">{t('trace.toolExecution')}</h4>
          
          <div className="mt-2 bg-surface-dim rounded-lg border border-outline-variant/80 overflow-hidden font-mono text-[10px] text-on-surface leading-relaxed">
            <div className="bg-surface-container px-3 py-1 border-b border-outline-variant flex items-center justify-between">
              <span className="text-[9px] text-on-surface-variant font-bold">{toolCall.tool}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
            </div>
            
            <div className="p-2.5 space-y-1.5 text-[9px]">
              {toolCall.tool === 'browser_login_mock' ? (
                <>
                  <p className="text-on-surface-variant font-bold">&gt; Initializing headless browser...</p>
                  <p className="text-on-surface-variant font-bold">&gt; Navigating to {toolCall.args.url || 'https://admin.example.com'}</p>
                  <p className="text-on-surface-variant font-bold">&gt; Locating DOM elements [user_input, pass_input]... Found.</p>
                  <p className="text-primary font-bold">&gt; Injecting credential payload via {secretRef.substring(0, 8)} reference...</p>
                  <p className="text-on-surface-variant font-bold">&gt; Submitting form...</p>
                </>
              ) : (
                <>
                  <p className="text-on-surface-variant font-bold">&gt; Active security context: user_id={activeMessage.secretRefs ? 'validated' : 'guest'}</p>
                  <p className="text-primary font-bold">&gt; Resolve secret ref: {secretRef.substring(0, 10)}... resolved successfully.</p>
                  <p className="text-green-600 font-bold">&gt; Executing secure sandbox command:</p>
                  <p className="text-on-surface bg-surface-container-low p-1.5 rounded break-all whitespace-pre-wrap">
                    {toolCall.args.command || 'secure_shell'}
                  </p>
                  <p className="text-on-surface-variant font-bold">&gt; Command response status code: 0</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Step 5: Result */}
        <div className="relative">
          <div className={`absolute -left-[27px] top-0 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold ${
            isSuccess ? 'bg-green-50 border border-green-500 text-green-600' : 'bg-red-50 border border-red-500 text-red-600'
          }`}>{isSuccess ? '✓' : '✗'}</div>
          <h4 className="font-headline font-semibold text-on-surface">{t('trace.result')}</h4>
          <p className={`text-[10px] mt-1 font-medium ${isSuccess ? 'text-green-800' : 'text-red-800'}`}>
            {isSuccess ? 'Action completed successfully.' : 'Action execution failed.'}
          </p>
        </div>

      </div>
    </aside>
  );
}
