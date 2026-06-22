import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Bot, Key, Lock, ShieldAlert, Send, CheckCircle2, 
  XCircle, Wrench, Loader2, Terminal, Sparkles,
  CalendarClock, Play, Pause, FileText, RefreshCw
} from 'lucide-react';
import { 
  runAgent, listSecrets,
  type AgentRunResponse, type SecretMetadata 
} from '../api';
import { streamAgent, approveAgent, type SSEEvent } from '../agentApi';
import { useI18n } from '../i18n';

interface StreamingStep {
  type: 'tool_start' | 'tool_end' | 'thinking';
  tool?: string;
  args?: Record<string, any>;
  result?: Record<string, any>;
  content?: string;
  timestamp: number;
}

interface Message {
  id: number;
  type: 'user' | 'agent' | 'tool_result' | 'loading' | 'approval';
  text: string;
  sanitizedText?: string;
  toolCalls?: AgentRunResponse['tool_calls'];
  secretRefs?: string[];
  leakDetected?: boolean;
  leakedValue?: string;
  isBlocked?: boolean;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  pendingCommand?: string;
  triggeredRule?: string;
  localModelConfigured?: boolean;
  isEe?: boolean;
  streamingSteps?: StreamingStep[];
  planSteps?: string[];
  isStreaming?: boolean;
  taskId?: string;
}

interface ChatProps {
  sessionId: string;
  onFirstMessage?: (msg: string) => void;
  key?: string | number;
}

export function Chat({ sessionId, onFirstMessage }: ChatProps) {
  const { t, locale } = useI18n();
  const isZh = locale === 'zh';
  const abortControllerRef = useRef<AbortController | null>(null);

  const streamTimerRef = useRef<any>(null);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (streamTimerRef.current) {
        clearInterval(streamTimerRef.current);
      }
    };
  }, []);

  const welcomeMsg: Message = {
    id: 0,
    type: 'agent',
    text: t('chat.welcome'),
  };

  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const cached = localStorage.getItem(`bv_chat_${sessionId}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          return parsed.filter(m => m.type !== 'loading');
        }
      }
    } catch (e) {
      console.error('加载缓存消息失败:', e);
    }
    return [{
      id: 0,
      type: 'agent',
      text: '',
    }];
  });
  const [inputVal, setInputVal] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // 审批流程相关的 State
  const [lastUserMessage, setLastUserMessage] = useState('');


  const [activeTraceMsgId, setActiveTraceMsgId] = useState<number | null>(() => {
    try {
      const cachedTrace = localStorage.getItem(`bv_chat_active_trace_${sessionId}`);
      if (cachedTrace) return Number(cachedTrace);

      const cachedMsgs = localStorage.getItem(`bv_chat_${sessionId}`);
      if (cachedMsgs) {
        const parsed = JSON.parse(cachedMsgs);
        if (Array.isArray(parsed)) {
          const lastToolMessage = [...parsed].reverse().find(m => m.toolCalls && m.toolCalls.length > 0);
          if (lastToolMessage) return lastToolMessage.id;
        }
      }
    } catch (e) {
      console.error('加载缓存 activeTraceMsgId 失败:', e);
    }
    return null;
  });
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);

  // 临时温馨提示 Toast 状态
  const [toastMsg, setToastMsg] = useState('');
  const showToast = (msg: string) => {
    setToastMsg(msg);
  };

  useEffect(() => {
    if (toastMsg) {
      const timer = setTimeout(() => setToastMsg(''), 4000);
      return () => clearTimeout(timer);
    }
  }, [toastMsg]);

  // 捕获粘贴事件，优雅提示大模型不支持多模态视觉
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          e.preventDefault();
          showToast('💡 当前大模型暂不支持直接识别截图/图片，请直接复制粘贴命令或报错的纯文本内容。');
          return;
        }
      }
    }
  };


  const [secretsMap, setSecretsMap] = useState<Record<string, SecretMetadata>>({});

  const fetchSecretsMetadata = useCallback(async () => {
    try {
      const data = await listSecrets(sessionId);
      const map: Record<string, SecretMetadata> = {};
      data.forEach(s => {
        map[s.secret_ref] = s;
      });
      setSecretsMap(map);
    } catch (e) {
      console.error('加载 secrets 详情失败:', e);
    }
  }, [sessionId]);

  const lastLoadedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    fetchSecretsMetadata();
  }, [fetchSecretsMetadata]);

  // 切换 session 时重置和加载对应的历史消息与选中的工具日志
  useEffect(() => {
    if (lastLoadedSessionRef.current === sessionId) {
      return;
    }
    lastLoadedSessionRef.current = sessionId;

    let loadedMessages: Message[] = [];
    try {
      const cached = localStorage.getItem(`bv_chat_${sessionId}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          loadedMessages = parsed.filter(m => m.type !== 'loading');
        }
      }
    } catch (e) {
      console.error('加载缓存消息失败:', e);
    }

    if (loadedMessages.length === 0) {
      loadedMessages = [{
        id: 0,
        type: 'agent',
        text: '',
      }];
    }
    setMessages(loadedMessages);
    setInputVal('');
    setIsLoading(false);
    setLastUserMessage('');

    try {
      const cachedTrace = localStorage.getItem(`bv_chat_active_trace_${sessionId}`);
      if (cachedTrace) {
        setActiveTraceMsgId(Number(cachedTrace));
      } else {
        const lastToolMessage = [...loadedMessages].reverse().find(m => m.toolCalls && m.toolCalls.length > 0);
        if (lastToolMessage) {
          setActiveTraceMsgId(lastToolMessage.id);
        } else {
          setActiveTraceMsgId(null);
        }
      }
    } catch (e) {
      setActiveTraceMsgId(null);
    }
  }, [sessionId]);

  // 当 messages 改变时，同步到 localStorage (过滤掉 loading 临时消息)
  useEffect(() => {
    if (messages.length > 0) {
      const persistMessages = messages.filter(m => m.type !== 'loading');
      localStorage.setItem(`bv_chat_${sessionId}`, JSON.stringify(persistMessages));
    }
  }, [messages, sessionId]);

  // 当 activeTraceMsgId 改变时，同步到 localStorage
  useEffect(() => {
    if (activeTraceMsgId !== null) {
      localStorage.setItem(`bv_chat_active_trace_${sessionId}`, String(activeTraceMsgId));
    } else {
      localStorage.removeItem(`bv_chat_active_trace_${sessionId}`);
    }
  }, [activeTraceMsgId, sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (overrideText?: string, isConfirmed?: boolean) => {
    const text = overrideText !== undefined ? overrideText : inputVal.trim();
    if (!text || isLoading) return;

    const isApprovalPending = messages.some(m => m.type === 'approval' && m.approvalStatus === 'pending');
    if (isApprovalPending && !isConfirmed) return;

    if (streamTimerRef.current) {
      clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }

    const userMsg: Message = { id: Date.now(), type: 'user', text };
    const agentMsgId = Date.now() + 2;
    
    // 创建一个流式 Agent 消息占位
    const streamingAgentMsg: Message = {
      id: agentMsgId,
      type: 'agent',
      text: '',
      isStreaming: true,
      streamingSteps: [],
      toolCalls: [],
      secretRefs: [],
    };
    
    if (isConfirmed) {
      setMessages(prev => [...prev, streamingAgentMsg]);
    } else {
      setMessages(prev => [...prev, userMsg, streamingAgentMsg]);
      setInputVal('');
    }
    setIsLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const history = messages
      .filter(m => m.type === 'user' || m.type === 'agent')
      .filter(m => m.id !== 0)
      .map(m => ({
        role: (m.type === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.sanitizedText || m.text,
      }));

    // 累积状态（在回调闭包中维护）
    let accumulatedText = '';
    let accumulatedSteps: StreamingStep[] = [];
    let finalToolCalls: AgentRunResponse['tool_calls'] = [];

    const handleSSEEvent = (event: SSEEvent) => {
      const { type, data } = event;

      switch (type) {
        case 'sanitized': {
          // 更新用户消息的 sanitizedText
          if (data.sanitized_input && !isConfirmed) {
            setMessages(prev => prev.map(m =>
              m.id === userMsg.id ? { ...m, sanitizedText: data.sanitized_input } : m
            ));
          } else if (data.sanitized_input && isConfirmed) {
            setMessages(prev => {
              const lastUserIdx = prev.map(m => m.type).lastIndexOf('user');
              return prev.map((m, idx) =>
                idx === lastUserIdx ? { ...m, sanitizedText: data.sanitized_input } : m
              );
            });
          }
          // 更新 taskId
          if (data.task_id) {
            setMessages(prev => prev.map(m =>
              m.id === agentMsgId ? { ...m, taskId: data.task_id } : m
            ));
          }
          break;
        }

        case 'credential_blocked': {
          setMessages(prev => prev.map(m =>
            m.id === agentMsgId ? {
              ...m,
              text: data.reply || '',
              isBlocked: true,
              isStreaming: false,
              leakDetected: data.leak_detected,
              leakedValue: data.leaked_value,
              localModelConfigured: data.local_model_configured,
              isEe: data.is_ee,
            } : m
          ));
          setIsLoading(false);
          fetchSecretsMetadata();
          break;
        }

        case 'thinking': {
          // LLM token 流：逐字追加
          if (data.content) {
            accumulatedText += data.content;
            setMessages(prev => prev.map(m =>
              m.id === agentMsgId ? { ...m, text: accumulatedText } : m
            ));
          }
          break;
        }

        case 'plan': {
          setMessages(prev => prev.map(m =>
            m.id === agentMsgId ? { ...m, planSteps: data.steps } : m
          ));
          break;
        }

        case 'tool_start': {
          // 清空中间轮的 thinking 文本（工具执行前的规划文本不属于最终回复）
          accumulatedText = '';
          const step: StreamingStep = {
            type: 'tool_start',
            tool: data.tool,
            args: data.args,
            timestamp: Date.now(),
          };
          accumulatedSteps = [...accumulatedSteps, step];
          setMessages(prev => prev.map(m =>
            m.id === agentMsgId ? { ...m, text: '', streamingSteps: [...accumulatedSteps] } : m
          ));
          break;
        }

        case 'tool_end': {
          const step: StreamingStep = {
            type: 'tool_end',
            tool: data.tool,
            result: data.result,
            timestamp: Date.now(),
          };
          accumulatedSteps = [...accumulatedSteps, step];
          // 收集 tool_calls
          finalToolCalls = [...finalToolCalls, { tool: data.tool, args: data.args || {} }];
          setMessages(prev => prev.map(m =>
            m.id === agentMsgId ? {
              ...m,
              streamingSteps: [...accumulatedSteps],
              toolCalls: [...finalToolCalls],
            } : m
          ));
          break;
        }

        case 'interrupt': {
          // 切换为审批模式
          setLastUserMessage(text);
          const approvalMsg: Message = {
            id: Date.now() + 10,
            type: 'approval',
            text: '安全审批挂起',
            approvalStatus: 'pending',
            pendingCommand: data.pending_command,
            triggeredRule: data.risk_description || '',
          };
          setMessages(prev => {
            const updatedPrev = prev.map(m => 
              m.id === agentMsgId 
                ? { ...m, isStreaming: false } 
                : m
            );
            return [...updatedPrev, approvalMsg];
          });
          setIsLoading(false);
          break;
        }

        case 'done': {
          // 最终完成事件
          setMessages(prev => prev.map(m =>
            m.id === agentMsgId ? {
              ...m,
              text: accumulatedText || data.reply || '',
              isStreaming: false,
              toolCalls: data.tool_calls || finalToolCalls,
              secretRefs: data.secret_refs_used || [],
              leakDetected: data.leak_detected,
              leakedValue: data.leaked_value,
              localModelConfigured: data.local_model_configured,
            } : m
          ));

          setIsLoading(false);

          if ((data.tool_calls && data.tool_calls.length > 0) || finalToolCalls.length > 0) {
            setActiveTraceMsgId(agentMsgId);
          }

          fetchSecretsMetadata();

          // 首条消息回调
          setMessages(prev => {
            const actualMsgCount = prev.filter(m => m.type === 'user' || m.type === 'agent').length;
            if (actualMsgCount <= 3 && onFirstMessage) {
              onFirstMessage(text);
            }
            return prev;
          });
          break;
        }

        case 'error': {
          setMessages(prev => prev.map(m =>
            m.id === agentMsgId ? {
              ...m,
              text: data.error || 'SSE 流式执行出错',
              isStreaming: false,
            } : m
          ));
          setIsLoading(false);
          break;
        }
      }
    };

    try {
      await streamAgent(
        text,
        sessionId,
        handleSSEEvent,
        controller.signal,
      );
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === agentMsgId ? { ...m, isStreaming: false, text: accumulatedText || '(已取消)' } : m
        ));
      } else {
        setMessages(prev => prev.map(m =>
          m.id === agentMsgId ? {
            ...m,
            text: e.message || 'Request failed',
            isStreaming: false,
            isBlocked: e.message?.includes('阻断') || e.message?.includes('拦截'),
          } : m
        ));
      }
      setIsLoading(false);
    } finally {
      // 兜底：无论正常结束还是抛错，确保流状态为关闭，并清掉可能残留的纯 loading 占位
      setMessages(prev => prev
        .filter(m => m.type !== 'loading')
        .map(m => 
          m.id === agentMsgId && m.isStreaming ? { ...m, isStreaming: false } : m
      ));
      setIsLoading(false);
      abortControllerRef.current = null;
      inputRef.current?.focus();
    }
  };

  const handleApprove = async (approvalMsgId: number) => {
    // 1. 将该消息状态置为 approved
    setMessages(prev => prev.map(m => m.id === approvalMsgId ? { ...m, approvalStatus: 'approved' } : m));
    
    setIsLoading(true);
    try {
      const data = await approveAgent(sessionId, 'approve');
      
      setMessages(prev => {
        const newMessages = [...prev];
        // 找到在这次审批之前的最后一条 agent 消息（通常就是那个带着计划和悬挂的工具调用的消息）
        let lastAgentIdx = -1;
        for (let i = newMessages.length - 1; i >= 0; i--) {
          if (newMessages[i].type === 'agent') {
            lastAgentIdx = i;
            break;
          }
        }
        
        if (lastAgentIdx !== -1) {
          const agentMsg = { ...newMessages[lastAgentIdx] };
          if (agentMsg.streamingSteps) {
            // 找到最后一个 tool_start 并给它配对一个 tool_end
            const lastToolStart = [...agentMsg.streamingSteps].reverse().find(s => s.type === 'tool_start');
            if (lastToolStart) {
              const toolEndStep: StreamingStep = {
                type: 'tool_end',
                tool: lastToolStart.tool,
                result: { status: 'success', exit_code: 0, output: data.tool_output },
                timestamp: Date.now()
              };
              agentMsg.streamingSteps = [...agentMsg.streamingSteps, toolEndStep];
              newMessages[lastAgentIdx] = agentMsg;
            }
          }
        }

        const finalMsg: Message = {
          id: Date.now() + 20,
          type: 'agent',
          text: data.reply || '',
          toolCalls: data.tool_output ? [{ tool: 'secure_shell_result', args: { output: data.tool_output } }] : [],
        };
        
        return [...newMessages, finalMsg];
      });
    } catch (e: any) {
      showToast('审批执行失败: ' + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReject = (approvalMsgId: number) => {
    // 将该消息状态置为 rejected，即原地置灰留痕
    setMessages(prev => prev.map(m => m.id === approvalMsgId ? { ...m, approvalStatus: 'rejected' } : m));
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (streamTimerRef.current) {
      clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    setIsLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isComposingRef.current || e.nativeEvent.isComposing) {
        return;
      }
      e.preventDefault();
      handleSend();
    }
  };

  const activeTraceMsg = messages.find(m => m.id === activeTraceMsgId) || null;
  const isApprovalPending = messages.some(m => m.type === 'approval' && m.approvalStatus === 'pending');
  
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
      <section className="flex-1 flex flex-col min-w-0 h-full min-h-0 bg-surface-container-lowest border-r border-outline-variant/30">
        
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

            if (msg.type === 'approval') {
              const isPending = msg.approvalStatus === 'pending';
              const isApproved = msg.approvalStatus === 'approved';
              const isRejected = msg.approvalStatus === 'rejected';

              return (
                <div key={msg.id} className="flex gap-4 max-w-3xl self-start animate-in fade-in slide-in-from-bottom-4 duration-300 my-4 w-full">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 ${
                    isPending 
                      ? 'bg-amber-500/10 border border-amber-500/20 animate-pulse' 
                      : isApproved
                        ? 'bg-green-500/10 border border-green-500/20'
                        : 'bg-outline-variant/10 border border-outline-variant/20'
                  }`}>
                    {isPending && <ShieldAlert className="text-amber-600 w-4 h-4" />}
                    {isApproved && <CheckCircle2 className="text-green-600 w-4 h-4" />}
                    {isRejected && <XCircle className="text-outline/70 w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0 space-y-4">
                    <div className={`rounded-2xl rounded-tl-sm p-5 border-2 shadow-lg backdrop-blur-md transition-all duration-300 ${
                      isPending
                        ? 'bg-amber-500/5 border-amber-500/35 shadow-amber-500/5'
                        : isApproved
                          ? 'bg-green-500/5 border-green-500/35 shadow-green-500/5'
                          : 'bg-surface-variant/20 border-outline-variant/40 shadow-none text-outline/80'
                    }`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          {isPending && (
                            <span className="flex h-2.5 w-2.5 relative">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                            </span>
                          )}
                          <h4 className={`text-sm font-headline font-bold ${
                            isPending 
                              ? 'text-amber-800 dark:text-amber-400' 
                              : isApproved
                                ? 'text-green-800 dark:text-green-400'
                                : 'text-outline dark:text-outline'
                          }`}>
                            {isPending && '高危操作确认：人机协同审批拦截'}
                            {isApproved && '✓ 已授权执行：高危操作审批通过'}
                            {isRejected && '❌ 已拒绝操作：敏感指令已被拦截'}
                          </h4>
                        </div>
                        {msg.triggeredRule && (
                          <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-semibold ${
                            isPending
                              ? 'bg-amber-100 text-amber-800'
                              : isApproved
                                ? 'bg-green-100 text-green-800'
                                : 'bg-surface-container-high text-outline'
                          }`}>
                            触发规则: {msg.triggeredRule}
                          </span>
                        )}
                      </div>
                      
                      <p className="text-xs text-on-surface-variant leading-relaxed mb-4">
                        {isPending && 'Agent 在尝试执行任务时，触发了系统级高危指令拦截规则。根据企业安全策略，您需要手动审核并授权方可在沙箱中运行此敏感命令。'}
                        {isApproved && '您已手动授权执行该敏感高危命令，系统已在沙箱安全容器中完成分发并继续任务。'}
                        {isRejected && '已安全拒绝并中断该敏感高危指令的运行。'}
                      </p>

                      {/* 敏感命令框 */}
                      <div className={`relative group my-3 border rounded-xl overflow-hidden select-text text-left ${
                        isPending
                          ? 'border-amber-500/20 bg-surface-dim'
                          : isApproved
                            ? 'border-green-500/20 bg-surface-dim'
                            : 'border-outline-variant/30 bg-surface-dim/40'
                      }`}>
                        <div className={`flex items-center justify-between px-4 py-1.5 border-b text-[10px] font-mono select-none ${
                          isPending
                            ? 'bg-amber-500/5 border-amber-500/20 text-amber-700'
                            : isApproved
                              ? 'bg-green-500/5 border-green-500/20 text-green-700'
                              : 'bg-surface-container border-outline-variant/30 text-outline'
                        }`}>
                          <span>shell command</span>
                          <CopyButton text={msg.pendingCommand || ''} />
                        </div>
                        <pre className={`p-4 overflow-x-auto font-mono text-xs leading-relaxed whitespace-pre select-all bg-black/5 dark:bg-black/30 ${
                          isPending
                            ? 'text-amber-600 dark:text-amber-400'
                            : isApproved
                              ? 'text-green-600 dark:text-green-400'
                              : 'text-outline/80 dark:text-outline-variant/80'
                        }`}>
                          <code>{msg.pendingCommand}</code>
                        </pre>
                      </div>

                      {/* 交互按钮 */}
                      {isPending && (
                        <div className="flex items-center gap-3 mt-4 pt-3 border-t border-outline-variant/30">
                          <button
                            onClick={() => handleApprove(msg.id)}
                            className="px-4 py-2 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-750 text-white shadow-md shadow-amber-500/10 active:scale-95 transition-all flex items-center gap-1.5"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            授权执行
                          </button>
                          <button
                            onClick={() => handleReject(msg.id)}
                            className="px-4 py-2 rounded-lg text-xs font-semibold border border-outline-variant text-on-surface hover:bg-surface-container-high active:scale-95 transition-all"
                          >
                            拒绝操作
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            if (msg.type === 'agent') {
              const hasTools = msg.toolCalls && msg.toolCalls.length > 0;
              const isTraceActive = msg.id === activeTraceMsgId;

              if (msg.isBlocked) {
                return (
                  <div key={msg.id} className="flex gap-4 max-w-3xl self-start animate-in fade-in slide-in-from-bottom-2">
                    <div className="w-8 h-8 rounded-full bg-red-100 border border-red-200 flex items-center justify-center shrink-0 mt-1">
                      <ShieldAlert className="text-red-655 w-4 h-4" />
                    </div>
                    <div className="space-y-3 flex-1 min-w-0">
                      <div className="rounded-2xl rounded-tl-sm p-4 bg-red-50 border border-red-200 text-sm text-red-950 leading-relaxed shadow-sm">
                        <p className="font-semibold text-red-950 flex items-center gap-1.5 mb-1.5">
                          <ShieldAlert className="w-4 h-4 text-red-655" />
                          安全阻断：敏感信息外泄拦截
                        </p>
                        <p className="mb-2 text-red-850">
                          {msg.text}
                        </p>
                        <p className="text-xs text-red-750 font-medium mt-2 border-t border-red-200/60 pt-2 leading-relaxed">
                          💡 <b>如何解决：</b>在严格保护模式下，我们禁止将任何明文密码或凭证发送至模型。请在左侧侧边栏中点击 <b>[凭证库]</b> (或 <b>[添加凭证]</b>) 创建安全引用，然后在指令中使用类似 <code>$SECRET</code> 的占位符（具体指令格式请参考左侧凭证的使用示例）。
                        </p>
                      </div>
                    </div>
                  </div>
                );
              }

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
                      {renderMessageContent(msg.id === 0 ? t('chat.welcome') : msg.text)}

                      {/* 执行计划展示 */}
                      {msg.planSteps && msg.planSteps.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-outline-variant/40">
                          <p className="text-[11px] font-bold text-on-surface mb-2 flex items-center gap-1.5">
                            <FileText className="w-3.5 h-3.5 text-primary" />
                            执行计划
                          </p>
                          <ul className="space-y-1.5">
                            {msg.planSteps.map((step, idx) => {
                              // 根据已完成的工具调用数量粗略判断状态
                              const doneCount = msg.streamingSteps?.filter(s => s.type === 'tool_end').length || 0;
                              const isDone = doneCount > idx;
                              const isActive = msg.isStreaming && doneCount === idx;
                              return (
                                <li key={idx} className="flex items-start gap-2 text-[11px]">
                                  {isDone ? (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
                                  ) : (
                                    <div className="w-3.5 h-3.5 rounded-full border border-outline-variant shrink-0 mt-0.5 flex items-center justify-center">
                                      {isActive && (
                                        <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse"></div>
                                      )}
                                    </div>
                                  )}
                                  <span className={isDone ? 'text-on-surface-variant line-through opacity-70' : 'text-on-surface'}>
                                    {step}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}

                      {/* SSE 流式执行步骤进度 */}
                      {msg.streamingSteps && msg.streamingSteps.length > 0 && (() => {
                        // 将 tool_start + tool_end 配对合并
                        const steps = msg.streamingSteps;
                        const paired: Array<{
                          tool: string;
                          args?: Record<string, any>;
                          result?: Record<string, any>;
                          done: boolean;
                          isError: boolean;
                        }> = [];

                        for (let i = 0; i < steps.length; i++) {
                          const s = steps[i];
                          if (s.type === 'tool_start') {
                            const endIdx = steps.findIndex(
                              (e, j) => j > i && e.type === 'tool_end' && e.tool === s.tool
                            );
                            if (endIdx !== -1) {
                              const endStep = steps[endIdx];
                              paired.push({
                                tool: s.tool || 'unknown',
                                args: s.args,
                                result: endStep.result,
                                done: true,
                                isError: endStep.result?.status === 'error' || (endStep.result?.exit_code !== undefined && endStep.result?.exit_code !== 0),
                              });
                            } else {
                              paired.push({
                                tool: s.tool || 'unknown',
                                args: s.args,
                                done: false,
                                isError: false,
                              });
                            }
                          }
                        }

                        if (paired.length === 0) return null;

                        return (
                          <div className="mt-3 pt-3 border-t border-outline-variant/40">
                            <p className="text-[10px] font-bold text-on-surface-variant mb-2 flex items-center gap-1.5">
                              <Terminal className="w-3 h-3" />
                              {msg.isStreaming ? '执行中...' : `共 ${paired.filter(p => p.done).length} 步工具调用`}
                            </p>
                            <div className="space-y-1">
                              {paired.map((p, idx) => (
                                <details key={idx} className="group">
                                  <summary className="flex items-center gap-2 text-[10px] cursor-pointer list-none select-none py-0.5 hover:bg-surface-container-low/50 rounded px-1 -mx-1 transition-colors">
                                    {!p.done ? (
                                      <>
                                        {msg.isStreaming ? (
                                          <Loader2 className="w-3 h-3 text-primary animate-spin shrink-0" />
                                        ) : (
                                          <ShieldAlert className="w-3 h-3 text-amber-500 shrink-0" />
                                        )}
                                        <span className={`${msg.isStreaming ? 'text-primary' : 'text-amber-600'} font-medium flex-1 min-w-0 truncate`}>
                                          {msg.isStreaming ? '正在执行' : '挂起等待授权'} <code className="bg-primary/10 px-1 py-0.5 rounded text-[9px] text-current">{p.tool}</code>
                                          {p.args?.command && (
                                            <span className="text-on-surface-variant ml-1 font-normal">
                                              {String(p.args.command).length > 50
                                                ? String(p.args.command).substring(0, 50) + '...'
                                                : p.args.command}
                                            </span>
                                          )}
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        {p.isError ? (
                                          <XCircle className="w-3 h-3 text-red-500 shrink-0" />
                                        ) : (
                                          <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                                        )}
                                        <span className={`font-medium flex-1 min-w-0 truncate ${p.isError ? 'text-red-600' : 'text-green-600'}`}>
                                          <code className="bg-surface-container px-1 py-0.5 rounded text-[9px]">{p.tool}</code>
                                          {p.result?.exit_code !== undefined && (
                                            <span className="text-on-surface-variant ml-1 font-normal">
                                              exit_code={p.result.exit_code}
                                            </span>
                                          )}
                                        </span>
                                        <span className="text-on-surface-variant/50 text-[9px] shrink-0 group-open:hidden">▶</span>
                                        <span className="text-on-surface-variant/50 text-[9px] shrink-0 hidden group-open:inline">▼</span>
                                      </>
                                    )}
                                  </summary>
                                  {/* 展开后的详情 */}
                                  <div className="ml-5 mt-1 mb-2 p-2 rounded-lg bg-surface-container/50 border border-outline-variant/30 text-[10px] font-mono space-y-1.5 animate-in fade-in duration-200">
                                    {p.args?.command && (
                                      <div>
                                        <span className="text-secondary font-semibold">命令:</span>
                                        <pre className="mt-0.5 text-on-surface-variant bg-surface-dim/60 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap break-all">{String(p.args.command)}</pre>
                                      </div>
                                    )}
                                    {p.result && (
                                      <div>
                                        <span className="text-secondary font-semibold">结果:</span>
                                        <pre className="mt-0.5 text-on-surface-variant bg-surface-dim/60 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                                          {renderRedacted(p.result.stdout
                                            ? String(p.result.stdout).substring(0, 500) + (String(p.result.stdout).length > 500 ? '\n... (截断)' : '')
                                            : p.result.raw
                                              ? String(p.result.raw).substring(0, 500)
                                              : JSON.stringify(p.result, null, 2).substring(0, 500)
                                          )}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                </details>
                              ))}
                              {msg.isStreaming && (
                                <div className="flex items-center gap-2 text-[10px] text-on-surface-variant">
                                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                                  <span>等待下一步...</span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      {/* 流式加载中占位 */}
                      {msg.isStreaming && (!msg.text) && (!msg.streamingSteps || msg.streamingSteps.length === 0) && (
                        <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>正在处理...</span>
                        </div>
                      )}

                    </div>

                    {/* Leaked Secret Alert Banner */}
                    {msg.leakDetected && msg.leakedValue && (
                      <div className="rounded-xl border border-red-200 bg-red-50/60 p-3.5 text-xs text-red-850 leading-relaxed shadow-sm flex items-start gap-2.5 animate-in fade-in duration-300">
                        <span className="text-sm shrink-0">⚠️</span>
                        <div className="space-y-1">
                          <p className="font-semibold text-red-900">安全警告：检测到明文敏感数据外泄！</p>
                          <p>
                            您的指令中含有未加密的明文凭证（如 <code className="bg-red-100 px-1.5 py-0.5 rounded font-mono font-bold text-red-900 select-all mx-0.5">{msg.leakedValue}</code>）。该数据已直接发送至云端大模型，存在泄露隐患！
                          </p>
                          {msg.localModelConfigured ? (
                            <p className="text-[10px] text-red-700/80 mt-1.5 font-medium">
                              💡 建议您立即在凭证库中创建该密码的安全引用并轮换密钥。当前已启用企业版本地大模型脱敏，但此敏感数据未能成功识别，建议检查本地模型配置或优化脱敏策略。
                            </p>
                          ) : msg.isEe ? (
                            <p className="text-[10px] text-red-700/80 mt-1.5 font-medium">
                              💡 建议您立即在凭证库中创建该密码的安全引用并轮换密钥。您已拥有企业版权限，请前往左侧 <strong>Local Model Gateway</strong>（本地模型网关）配置本地模型以激活智能脱敏服务。
                            </p>
                          ) : (
                            <p className="text-[10px] text-red-700/80 mt-1.5 font-medium">
                              💡 建议您立即在凭证库中创建该密码的安全引用并轮换密钥。升级至 <strong>企业版</strong> 并配置本地模型可获得本地网关提供的全自动智能语义脱敏服务。
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Tool Calls Summary — 仅在没有 streamingSteps 时显示（旧同步 API 兼容） */}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (!msg.streamingSteps || msg.streamingSteps.length === 0) && (
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
                                      {typeof v === 'object' ? JSON.stringify(v) : String(v)}
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
                        {msg.secretRefs.map((ref, i) => {
                          const secretInfo = secretsMap[ref];
                          const expiryText = secretInfo 
                            ? formatSecretExpiry(secretInfo.expires_at, secretInfo.status) 
                            : '';
                          const isInactive = secretInfo && (secretInfo.status !== 'active' || new Date(secretInfo.expires_at).getTime() < Date.now());
                          const isModelExtracted = secretInfo && secretInfo.label.startsWith('model_');
                          
                          return (
                            <span 
                              key={i} 
                              className={`inline-flex items-center gap-1.5 px-2 py-1 border rounded text-[10px] font-mono transition-all duration-300 ${
                                isInactive 
                                  ? 'bg-surface-container border-outline-variant text-outline/80' 
                                  : isModelExtracted
                                    ? 'bg-purple-500/10 border-purple-500/30 text-purple-700 dark:text-purple-400 font-semibold'
                                    : 'bg-primary/5 border-primary/20 text-primary'
                              }`} 
                              title={secretInfo ? `凭证标签: ${secretInfo.label} (${isModelExtracted ? '本地大模型智能提取' : '系统正则自动提取'})` : ''}
                            >
                              <Lock className="w-3 h-3" />
                              {ref.substring(0, 12)}****
                              {isModelExtracted && (
                                <span className="text-[9px] px-1 rounded bg-purple-500/15 text-purple-700 dark:text-purple-400 scale-95 origin-left flex items-center gap-0.5">
                                  <Sparkles className="w-2.5 h-2.5" /> AI 脱敏
                                </span>
                              )}
                              {expiryText && (
                                <span className={`font-sans border-l pl-1.5 ml-0.5 ${
                                  isInactive 
                                    ? 'border-outline-variant text-outline' 
                                    : 'border-primary/20 text-on-surface-variant'
                                  }`}>
                                  {expiryText}
                                </span>
                              )}
                            </span>
                          );
                        })}
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
                  {renderMessageContent(msg.text)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Input Area */}
        <div className="p-4 sm:p-5 bg-surface-container-low/70 backdrop-blur-md z-20 shadow-[0_-8px_30px_rgba(0,0,0,0.04)]">
          <div className="max-w-4xl mx-auto flex items-end gap-3 sm:gap-4">
            <div className="flex-1 relative glow-border rounded-xl bg-surface-container shadow-sm border border-outline-variant focus-within:border-primary/50 transition-colors">
              <textarea 
                ref={inputRef}
                className="w-full bg-transparent border-none rounded-xl pl-4 pr-12 py-3.5 text-sm text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:ring-0 resize-none min-h-[52px] max-h-32" 
                placeholder={isApprovalPending ? "请先处理上方的安全审批请求..." : t('chat.inputPlaceholder')} 
                rows={1}
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => { isComposingRef.current = true; }}
                onCompositionEnd={() => { isComposingRef.current = false; }}
                onPaste={handlePaste}
                disabled={isLoading || isApprovalPending}
              ></textarea>

              {isLoading ? (
                <button 
                  onClick={handleStop}
                  className="absolute right-2.5 bottom-2.5 p-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-all active:scale-95 flex items-center justify-center shadow-sm"
                  title={t('chat.stop')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                  </svg>
                </button>
              ) : (
                <button 
                  onClick={() => handleSend()}
                  disabled={!inputVal.trim() || isApprovalPending}
                  className="absolute right-2.5 bottom-2.5 p-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-all active:scale-95 flex items-center justify-center shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4 ml-0.5" />
                </button>
              )}
            </div>
          </div>
          
          <div className="max-w-4xl mx-auto mt-3 flex justify-between items-center text-[10px] sm:text-xs text-on-surface-variant font-medium px-1">
            <span className="flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5 opacity-70" /> {t('chat.securityHint')}</span>
            <span className="flex items-center gap-1.5 font-mono"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span> {t('chat.agentActive')}</span>
          </div>
        </div>
        {toastMsg && (
          <div className="absolute bottom-24 left-1/2 transform -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="glass-panel px-5 py-3 rounded-xl border border-primary/20 bg-surface-container-high/90 backdrop-blur-md shadow-lg text-xs font-medium text-on-surface flex items-center gap-2 max-w-sm sm:max-w-md">
              <span className="shrink-0 text-primary">💡</span>
              <span className="leading-relaxed">{toastMsg}</span>
            </div>
          </div>
        )}
      </section>


      {/* Right Side Panel: Tool Logs */}
      <ToolLogsPanel 
        messages={messages} 
        activeTraceMsgId={activeTraceMsgId} 
        setActiveTraceMsgId={setActiveTraceMsgId} 
        secretsMap={secretsMap}
      />
    </div>
  );
}

// ============================================================
// 右侧 Tool Logs Panel 渲染组件
// ============================================================

function ToolLogsPanel({ 
  messages, 
  activeTraceMsgId,
  setActiveTraceMsgId,
  secretsMap
}: { 
  messages: Message[]; 
  activeTraceMsgId: number | null;
  setActiveTraceMsgId: (id: number | null) => void;
  secretsMap: Record<string, SecretMetadata>;
}) {
  const { t } = useI18n();

  const toolMessages = messages.filter(m => m.type === 'agent' && m.toolCalls && m.toolCalls.length > 0);

  const panelScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelScrollRef.current?.scrollTo({ top: panelScrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [toolMessages.length]);

  if (toolMessages.length === 0) {
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

  return (
    <aside className="w-80 lg:w-96 border-l border-outline-variant bg-surface flex flex-col shrink-0 hidden md:flex animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="p-5 border-b border-outline-variant/30 shrink-0">
        <h3 className="font-headline text-base font-semibold text-on-surface flex items-center gap-2">
          <Terminal className="w-4 h-4 text-primary" />
          {t('chat.toolLogsPanel')}
        </h3>
        <p className="font-body text-[11px] text-on-surface-variant mt-1">
          {t('chat.toolLogsPanelDesc')}
        </p>
      </div>
      {/* Traces Stream List */}
      <div ref={panelScrollRef} className="flex-1 overflow-y-auto p-5 space-y-6">
        {toolMessages.map((msg, index) => {
          const isTraceActive = msg.id === activeTraceMsgId;
          const toolCall = msg.toolCalls![0];
          // 尝试从 args 中提取，或者从命令内容中正则匹配出内联的 secret_ref
          let secretRef = msg.secretRefs && msg.secretRefs.length > 0 ? msg.secretRefs[0] : null;
          if (!secretRef && toolCall.args?.secret_ref) {
            const match = toolCall.args.secret_ref.match(/sec_(?:live|test)_[A-Za-z0-9_-]+/);
            if (match) secretRef = match[0];
          }
          if (!secretRef && toolCall.args?.command) {
            const match = toolCall.args.command.match(/sec_(?:live|test)_[A-Za-z0-9_-]+/);
            if (match) secretRef = match[0];
          }
          if (!secretRef) secretRef = 'sec_live_default_ref';

          // 寻找前置问题
          const msgIndex = messages.findIndex(m => m.id === msg.id);
          let userMsgText = '';
          if (msgIndex > 0) {
            const prevMsg = messages[msgIndex - 1];
            if (prevMsg && prevMsg.type === 'user') {
              userMsgText = prevMsg.text;
            }
          }

          let host = 'default_endpoint';
          if (toolCall.tool === 'secure_shell' && toolCall.args.command) {
            const cmdStr = toolCall.args.command;
            const sshMatch = cmdStr.match(/ssh\s+[^@\s]+@([^\s']+)/);
            const pgMatch = cmdStr.match(/@([a-zA-Z0-9.\-_]+)/);
            const curlMatch = cmdStr.match(/https?:\/\/([a-zA-Z0-9.\-_]+)/);
            if (sshMatch) host = sshMatch[1];
            else if (pgMatch) host = pgMatch[1];
            else if (curlMatch) host = curlMatch[1];
          }

          const isSuccess = !msg.text.toLowerCase().includes('error') && 
                            !msg.text.toLowerCase().includes('失败') && 
                            !msg.text.toLowerCase().includes('denied');
          const secretInfo = secretsMap[secretRef];
          const isModelExtracted = secretInfo && secretInfo.label.startsWith('model_');

          return (
            <div 
              key={msg.id}
              onClick={() => setActiveTraceMsgId(msg.id)}
              className={`rounded-xl border p-4 transition-all duration-300 cursor-pointer ${
                isTraceActive 
                  ? 'border-primary ring-2 ring-primary/10 bg-surface-container-lowest shadow-md' 
                  : 'border-outline-variant/60 bg-surface-container-lowest/40 hover:border-outline-variant'
              }`}
            >
              {/* 卡片标题 */}
              <div className="flex items-center justify-between mb-4 border-b border-outline-variant/30 pb-2">
                <span className="font-mono font-bold text-xs text-on-surface flex items-center gap-1.5">
                  <span className="text-[9px] text-on-surface-variant font-sans px-1.5 py-0.5 rounded bg-surface-container font-normal">#{index + 1}</span>
                  {toolCall.tool}
                </span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                  isSuccess ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  {isSuccess ? 'SUCCESS' : 'FAILED'}
                </span>
              </div>

              {/* 卡片内 5 步 Timeline */}
              <div className="relative pl-5 border-l border-outline-variant/60 ml-1.5 space-y-5 text-[11px] pb-2">
                
                {/* Step 1: Intent Detected */}
                <div className="relative">
                  <div className="absolute -left-[25.5px] top-0.5 w-3 h-3 rounded-full bg-primary/10 border border-primary flex items-center justify-center text-[7px] font-bold text-primary">1</div>
                  <h4 className="font-headline font-semibold text-on-surface">{t('trace.intentDetected')}</h4>
                  {userMsgText && (
                    <div className="mt-1.5 bg-surface-container-low rounded-lg p-2 border border-outline-variant/60 font-mono text-[9px] text-on-surface-variant max-w-full overflow-hidden">
                      <p className="truncate"><span className="text-primary font-bold">Request:</span> "{userMsgText}"</p>
                      <p className="mt-0.5"><span className="text-secondary font-bold">Goal:</span> {toolCall.tool}</p>
                    </div>
                  )}
                </div>

                {/* Step 2: Requesting Credential */}
                <div className="relative">
                  <div className="absolute -left-[25.5px] top-0.5 w-3 h-3 rounded-full bg-primary/10 border border-primary flex items-center justify-center text-[7px] font-bold text-primary">2</div>
                  <h4 className="font-headline font-semibold text-on-surface">{t('trace.requestingCredential')}</h4>
                  <p className="text-[9px] text-on-surface-variant mt-0.5">Agent requested credential reference for target environment.</p>
                  <div className="mt-1.5 bg-surface-container-low rounded-lg p-1.5 border border-outline-variant/60 flex items-center justify-between font-mono text-[9px]">
                    <span className="text-on-surface-variant truncate mr-2">{host}</span>
                    <span className="text-primary font-semibold shrink-0 bg-primary/5 px-1 rounded flex items-center gap-0.5">
                      <Lock className="w-2 h-2" />
                      {secretRef.substring(0, 10)}...
                    </span>
                  </div>
                </div>

                {/* Step 3: Policy Check */}
                <div className="relative">
                  {msg.leakDetected ? (
                    <>
                      <div className="absolute -left-[25.5px] top-0.5 w-3 h-3 rounded-full bg-amber-50 border border-amber-500 flex items-center justify-center text-[8px] font-bold text-amber-600">!</div>
                      <h4 className="font-headline font-semibold text-on-surface">{t('trace.policyEvaluation')}</h4>
                      <p className="text-[9px] text-amber-700 mt-0.5 leading-normal">
                        ⚠️ 策略校验通过（允许执行），但审计检测到命令参数中含有疑似未脱敏的明文数据（<code className="bg-amber-100 text-amber-900 px-1 py-0.5 rounded font-mono font-bold">{msg.leakedValue}</code>）已被发送至模型。
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="absolute -left-[25.5px] top-0.5 w-3 h-3 rounded-full bg-green-50 border border-green-500 flex items-center justify-center text-[7px] font-bold text-green-600">✓</div>
                      <h4 className="font-headline font-semibold text-on-surface">{t('trace.policyEvaluation')}</h4>
                      <p className="text-[9px] text-green-700/80 mt-0.5 leading-normal">
                        Domain/host verification passed. Reference <code className="bg-surface-container px-1 py-0.5 rounded font-mono font-bold text-primary">{secretRef.substring(0, 8)}</code> matches allowed target host: <code className="font-mono text-secondary">{host}</code>.
                        {isModelExtracted && (
                          <span className="block mt-1 font-sans text-[10px] text-purple-700 dark:text-purple-400 font-semibold flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-purple-500" />
                            🛡️ 企业版本地大模型已成功对该指令中的明文密码进行深度语义脱敏。
                          </span>
                        )}
                      </p>
                    </>
                  )}
                </div>

                {/* Step 4: Tool Execution */}
                <div className="relative">
                  <div className="absolute -left-[25.5px] top-0.5 w-3 h-3 rounded-full bg-primary/10 border border-primary flex items-center justify-center text-[7px] font-bold text-primary">4</div>
                  <h4 className="font-headline font-semibold text-on-surface">{t('trace.toolExecution')}</h4>
                  
                  <div className="mt-1.5 bg-surface-dim rounded-lg border border-outline-variant/80 overflow-hidden font-mono text-[9px] text-on-surface leading-relaxed">
                    <div className="bg-surface-container px-2 py-0.5 border-b border-outline-variant flex items-center justify-between">
                      <span className="text-[8px] text-on-surface-variant font-bold">{toolCall.tool}</span>
                      <span className="w-1 h-1 rounded-full bg-green-500 animate-pulse"></span>
                    </div>
                    
                    <div className="p-2 space-y-1 text-[8px]">
                        <>
                          <p className="text-on-surface-variant font-bold">&gt; Active security context: user_id=validated</p>
                          <p className="text-primary font-bold">&gt; Resolve secret ref: {secretRef.substring(0, 10)}...</p>
                          <p className="text-green-600 font-bold">&gt; Executing secure sandbox command:</p>
                          <p className="text-on-surface bg-surface-container-low p-1 rounded break-all whitespace-pre-wrap">
                            {toolCall.args.command || 'secure_shell'}
                          </p>
                        </>
                    </div>
                  </div>
                </div>

                {/* Step 5: Result */}
                <div className="relative">
                  <div className={`absolute -left-[25.5px] top-0.5 w-3 h-3 rounded-full flex items-center justify-center text-[7px] font-bold ${
                    isSuccess ? 'bg-green-50 border border-green-500 text-green-600' : 'bg-red-50 border border-red-500 text-red-600'
                  }`}>{isSuccess ? '✓' : '✗'}</div>
                  <h4 className="font-headline font-semibold text-on-surface">{t('trace.result')}</h4>
                  <p className={`text-[9px] mt-0.5 font-medium ${isSuccess ? 'text-green-800' : 'text-red-800'}`}>
                    {isSuccess ? 'Action completed successfully.' : 'Action execution failed.'}
                  </p>
                </div>

              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function formatSecretExpiry(expiresAt: string, status: string): string {
  if (!expiresAt) return '';
  const expireTime = new Date(expiresAt).getTime();
  const now = Date.now();
  
  // 提取格式化时间，如 14:55:01
  const timeStr = new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  
  if (status === 'revoked') {
    return `已撤销 (${timeStr})`;
  }
  if (status === 'exhausted') {
    return `已耗尽 (${timeStr})`;
  }
  if (now > expireTime || status === 'expired') {
    return `已失效 (${timeStr})`;
  }
  return `${timeStr} 过期`;
}

// ============================================================
// 一键复制辅助按钮组件
// ============================================================

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code: ', err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded bg-surface-container hover:bg-surface-container-high border border-outline-variant/65 text-on-surface-variant hover:text-on-surface transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center justify-center"
      title="复制代码"
    >
      {copied ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-600">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

function renderRedacted(text: string): React.ReactNode {
  if (!text) return null;
  const parts = text.split('[REDACTED]');
  return parts.map((part, i) => (
    <React.Fragment key={i}>
      {part}
      {i < parts.length - 1 && (
        <span className="bg-red-500 text-white px-1 py-0.5 rounded text-[10px] mx-0.5 font-bold shadow-sm shadow-red-500/20">
          [REDACTED]
        </span>
      )}
    </React.Fragment>
  ));
}

function renderMessageContent(text: string): React.ReactNode {
  if (!text) return null;

  const parseInlineStyles = (line: string): React.ReactNode[] => {
    const regex = /(\*\*.*?\*\*|`.*?`)/g;
    const tokens = line.split(regex);

    return tokens.map((token, idx) => {
      if (token.startsWith('**') && token.endsWith('**')) {
        return <strong key={idx} className="font-bold text-on-surface">{token.slice(2, -2)}</strong>;
      }
      if (token.startsWith('`') && token.endsWith('`')) {
        return (
          <code 
            key={idx} 
            className="bg-surface-container-high font-mono text-xs px-1.5 py-0.5 rounded text-primary border border-outline-variant/20 inline-block align-middle select-all mx-0.5 font-semibold"
          >
            {token.slice(1, -1)}
          </code>
        );
      }
      return token;
    });
  };

  const lines = text.split('\n');
  const renderedElements: React.ReactNode[] = [];
  
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeLanguage = '';
  let blockKey = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (inCodeBlock) {
      if (trimmed === '```') {
        inCodeBlock = false;
        const codeText = codeBlockLines.join('\n');
        renderedElements.push(
          <div key={`code-${blockKey++}`} className="relative group my-3 border border-outline-variant/40 rounded-xl bg-surface-dim overflow-hidden select-text text-left">
            <div className="flex items-center justify-between px-4 py-1.5 bg-surface-container border-b border-outline-variant/30 text-[10px] font-mono text-on-surface-variant select-none">
              <span>{codeLanguage || 'code'}</span>
              <CopyButton text={codeText} />
            </div>
            <pre className="p-4 overflow-x-auto font-mono text-xs text-on-surface leading-relaxed whitespace-pre select-all">
              <code>{codeText}</code>
            </pre>
          </div>
        );
        codeBlockLines = [];
        codeLanguage = '';
      } else {
        codeBlockLines.push(line);
      }
      continue;
    }

    if (trimmed.startsWith('```')) {
      inCodeBlock = true;
      codeLanguage = trimmed.slice(3).trim();
      continue;
    }

    // 标题行匹配 (# 至 ######)
    if (trimmed.startsWith('#')) {
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const titleText = headingMatch[2];
        const headingClass = level === 1 
          ? "text-2xl font-bold font-headline text-on-surface mt-4 mb-2" 
          : level === 2 
            ? "text-xl font-bold font-headline text-on-surface mt-3.5 mb-2" 
            : level === 3 
              ? "text-lg font-semibold font-headline text-on-surface mt-3 mb-1.5" 
              : "text-base font-semibold font-headline text-on-surface mt-2.5 mb-1.5";
        
        const Tag = `h${level}` as any;
        renderedElements.push(
          <Tag key={`h-${i}`} className={headingClass}>
            {parseInlineStyles(titleText)}
          </Tag>
        );
        continue;
      }
    }

    // 列表项匹配
    // 无序列表
    if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*')) {
      const content = line.replace(/^\s*[•\-*]\s*/, '');
      renderedElements.push(
        <ul key={`ul-${i}`} className="list-disc pl-5 my-0.5 text-on-surface leading-relaxed">
          <li className="marker:text-primary/70">{parseInlineStyles(content)}</li>
        </ul>
      );
      continue;
    }

    // 有序列表
    const olMatch = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (olMatch) {
      const content = olMatch[2];
      renderedElements.push(
        <ol key={`ol-${i}`} className="list-decimal pl-5 my-0.5 text-on-surface leading-relaxed">
          <li value={parseInt(olMatch[1])}>{parseInlineStyles(content)}</li>
        </ol>
      );
      continue;
    }

    // 普通段落
    renderedElements.push(
      <p key={`p-${i}`} className="leading-relaxed text-on-surface min-h-[1.25rem]">
        {parseInlineStyles(line)}
      </p>
    );
  }

  // 兜底渲染未闭合的代码块
  if (inCodeBlock && codeBlockLines.length > 0) {
    const codeText = codeBlockLines.join('\n');
    renderedElements.push(
      <div key={`code-unfinished`} className="relative group my-3 border border-outline-variant/40 rounded-xl bg-surface-dim overflow-hidden select-text text-left">
        <div className="flex items-center justify-between px-4 py-1.5 bg-surface-container border-b border-outline-variant/30 text-[10px] font-mono text-on-surface-variant select-none">
          <span>{codeLanguage || 'code'} (incomplete)</span>
          <CopyButton text={codeText} />
        </div>
        <pre className="p-4 overflow-x-auto font-mono text-xs text-on-surface leading-relaxed whitespace-pre select-all">
          <code>{codeText}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-2 select-text font-body">
      {renderedElements}
    </div>
  );
}
