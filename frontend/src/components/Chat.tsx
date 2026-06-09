import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Bot, Key, Lock, ShieldAlert, Send, CheckCircle2, 
  XCircle, Wrench, Loader2, Terminal, Sparkles,
  CalendarClock, Play, Pause, FileText, RefreshCw
} from 'lucide-react';
import { 
  runAgent, listSecrets, runPlanStep, healPlanStep,
  type AgentRunResponse, type SecretMetadata 
} from '../api';
import { useI18n } from '../i18n';

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
  plan?: AgentRunResponse['plan'];
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

  // 步骤执行计划相关的 State
  const [editingStepIndex, setEditingStepIndex] = useState<{ msgId: number; stepIndex: number } | null>(null);
  const [editedCommandText, setEditedCommandText] = useState('');

  const executePlanStep = async (
    msgId: number, 
    stepIndex: number, 
    customCommand?: string, 
    autoNext: boolean = false,
    currentRetryCount: number = 0
  ) => {
    // 1. 设置当前步骤状态为 running
    setMessages(prev => prev.map(m => {
      if (m.id === msgId && m.plan) {
        return {
          ...m,
          plan: {
            ...m.plan,
            steps: m.plan.steps.map(s => s.index === stepIndex ? { ...s, status: 'running', stdout: null, stderr: null } : s)
          }
        };
      }
      return m;
    }));

    // 2. 找到该步骤
    const currentMsg = messages.find(m => m.id === msgId);
    if (!currentMsg || !currentMsg.plan) return;
    const step = (currentMsg.plan.steps || []).find(s => s.index === stepIndex);
    if (!step) return;

    const cmdToRun = customCommand !== undefined ? customCommand : step.command;

    try {
      const res = await runPlanStep(sessionId, {
        command: cmdToRun,
        secret_ref: step.secret_ref || undefined,
        session_id: sessionId,
      });

      const isSuccess = res.status === 'success' && res.exit_code === 0;

      // 如果执行失败，且未超出重试限制，触发自主纠错与自愈执行
      if (!isSuccess && currentRetryCount < 1) {
        setMessages(prev => prev.map(m => {
          if (m.id === msgId && m.plan) {
            return {
              ...m,
              plan: {
                ...m.plan,
                steps: m.plan.steps.map(s => s.index === stepIndex ? { 
                  ...s, 
                  status: 'running', 
                  stdout: `🔍 正在智能分析步骤执行报错，尝试自主修复...\n[错误输出]：\n${res.stderr || 'Command failed'}`,
                  stderr: null
                } : s)
              }
            };
          }
          return m;
        }));

        try {
          const healRes = await healPlanStep(sessionId, {
            command: cmdToRun,
            stderr: res.stderr || (res.exit_code !== 0 ? `Exit code: ${res.exit_code}` : 'Command failed'),
            session_id: sessionId
          });

          const healLog = `💡 [自愈分析]：${healRes.analysis}\n🔄 [自愈尝试]：正在使用修正后的命令重新执行：\n$ ${healRes.suggested_command}`;
          setMessages(prev => prev.map(m => {
            if (m.id === msgId && m.plan) {
              return {
                ...m,
                plan: {
                  ...m.plan,
                  steps: m.plan.steps.map(s => s.index === stepIndex ? { 
                    ...s, 
                    command: healRes.suggested_command,
                    stdout: healLog
                  } : s)
                }
              };
            }
            return m;
          }));

          setTimeout(() => {
            executePlanStep(msgId, stepIndex, healRes.suggested_command, autoNext, currentRetryCount + 1);
          }, 2500);
          return;
        } catch (healErr) {
          console.error("Heal failed", healErr);
        }
      }

      // 3. 更新该步骤状态与输出
      setMessages(prev => {
        const nextMsgs = prev.map(m => {
          if (m.id === msgId && m.plan) {
            return {
              ...m,
              plan: {
                ...m.plan,
                steps: m.plan.steps.map(s => s.index === stepIndex ? { 
                  ...s, 
                  status: (isSuccess ? 'success' : 'failed') as any, 
                  command: cmdToRun,
                  stdout: res.stdout,
                  stderr: res.stderr || (res.exit_code !== 0 ? `Exit code: ${res.exit_code}` : '')
                } : s)
              }
            };
          }
          return m;
        });

        // 4. 处理自动执行下一步
        if (autoNext && isSuccess) {
          const updatedMsg = nextMsgs.find(m => m.id === msgId);
          if (updatedMsg && updatedMsg.plan) {
            const nextPendingStep = (updatedMsg.plan.steps || []).find(s => s.status === 'pending');
            if (nextPendingStep) {
              setTimeout(() => {
                executePlanStep(msgId, nextPendingStep.index, undefined, true);
              }, 600);
            } else {
              showToast('🎉 执行计划中的所有步骤均已成功完成！');
            }
          }
        }

        return nextMsgs;
      });

    } catch (err: any) {
      if (currentRetryCount < 1) {
        setMessages(prev => prev.map(m => {
          if (m.id === msgId && m.plan) {
            return {
              ...m,
              plan: {
                ...m.plan,
                steps: m.plan.steps.map(s => s.index === stepIndex ? { 
                  ...s, 
                  status: 'running', 
                  stdout: `🔍 正在智能分析前置网络异常，尝试自主修复...\n[网络错误]：${err.message || '连接异常'}`,
                  stderr: null
                } : s)
              }
            };
          }
          return m;
        }));

        try {
          const healRes = await healPlanStep(sessionId, {
            command: cmdToRun,
            stderr: err.message || 'Network connection failed',
            session_id: sessionId
          });

          const healLog = `💡 [自愈分析]：${healRes.analysis}\n🔄 [自愈尝试]：正在使用修正后的命令重新执行：\n$ ${healRes.suggested_command}`;
          setMessages(prev => prev.map(m => {
            if (m.id === msgId && m.plan) {
              return {
                ...m,
                plan: {
                  ...m.plan,
                  steps: m.plan.steps.map(s => s.index === stepIndex ? { 
                    ...s, 
                    command: healRes.suggested_command,
                    stdout: healLog
                  } : s)
                }
              };
            }
            return m;
          }));

          setTimeout(() => {
            executePlanStep(msgId, stepIndex, healRes.suggested_command, autoNext, currentRetryCount + 1);
          }, 2500);
          return;
        } catch (healErr) {
          console.error("Heal failed", healErr);
        }
      }

      setMessages(prev => prev.map(m => {
        if (m.id === msgId && m.plan) {
          return {
            ...m,
            plan: {
              ...m.plan,
              steps: m.plan.steps.map(s => s.index === stepIndex ? { 
                ...s, 
                status: 'failed' as any, 
                stderr: err.message || '网络连接异常，单步执行失败。' 
              } : s)
            }
          };
        }
        return m;
      }));
    }
  };

  const handleSkipStep = (msgId: number, stepIndex: number, autoNext: boolean) => {
    setMessages(prev => {
      const nextMsgs = prev.map(m => {
        if (m.id === msgId && m.plan) {
          return {
            ...m,
            plan: {
              ...m.plan,
              steps: m.plan.steps.map(s => s.index === stepIndex ? { ...s, status: 'skipped' as any } : s)
            }
          };
        }
        return m;
      });

      if (autoNext) {
        const updatedMsg = nextMsgs.find(m => m.id === msgId);
        if (updatedMsg && updatedMsg.plan) {
          const nextPendingStep = updatedMsg.plan.steps.find(s => s.status === 'pending');
          if (nextPendingStep) {
            setTimeout(() => {
              executePlanStep(msgId, nextPendingStep.index, undefined, true);
            }, 600);
          } else {
            showToast('🎉 执行计划已结束（部分步骤被跳过）。');
          }
        }
      }

      return nextMsgs;
    });
  };

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

  // 切换 session 时重置和加载对应的历史消息与选中的工具日志
  useEffect(() => {
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

    fetchSecretsMetadata();

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
  }, [sessionId, fetchSecretsMetadata]);

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
    const loadingMsg: Message = { id: Date.now() + 1, type: 'loading', text: '' };
    
    if (isConfirmed) {
      setMessages(prev => [...prev, loadingMsg]);
    } else {
      setMessages(prev => [...prev, userMsg, loadingMsg]);
      setInputVal('');
    }
    setIsLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const history = messages
        .filter(m => m.type === 'user' || m.type === 'agent')
        .filter(m => m.id !== 0)
        .map(m => ({
          role: (m.type === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.sanitizedText || m.text,
        }));

      const resp = await runAgent({ 
        user_message: text, 
        session_id: sessionId, 
        history,
        confirmed: isConfirmed || false
      }, controller.signal);
      
      // 检测是否需要审批
      if (resp.requires_approval && resp.pending_command) {
        const approvalMsg: Message = {
          id: Date.now(),
          type: 'approval',
          text: '安全审批挂起',
          approvalStatus: 'pending',
          pendingCommand: resp.pending_command,
          triggeredRule: resp.triggered_rule || '',
        };
        setLastUserMessage(text);
        
        // 移除 loading 状态并追加审批消息
        setMessages(prev => [...prev.filter(m => m.type !== 'loading'), approvalMsg]);
        setIsLoading(false);
        abortControllerRef.current = null;
        return;
      }

      setMessages(prev => {
        const filtered = prev.filter(m => m.type !== 'loading');
        return filtered.map(m =>
          m.id === userMsg.id && resp.sanitized_input
            ? { ...m, sanitizedText: resp.sanitized_input }
            : m
        );
      });

      const agentMsgId = Date.now() + 2;
      const fullReply = resp.reply || '';
      
      const emptyAgentMsg: Message = {
        id: agentMsgId,
        type: 'agent',
        text: '',
        toolCalls: resp.tool_calls,
        secretRefs: resp.secret_refs_used,
        leakDetected: resp.leak_detected,
        leakedValue: resp.leaked_value,
        plan: resp.plan,
      };

      setMessages(prev => [...prev, emptyAgentMsg]);

      let currentLength = 0;
      const speed = 10; // 毫秒
      const charsPerTick = 4; // 每次4个字符

      const timer = setInterval(() => {
        currentLength += charsPerTick;
        const textSlice = fullReply.slice(0, currentLength);

        setMessages(prev => 
          prev.map(m => m.id === agentMsgId ? { ...m, text: textSlice } : m)
        );

        if (currentLength >= fullReply.length) {
          clearInterval(timer);
          streamTimerRef.current = null;
          setIsLoading(false);

          if (resp.tool_calls && resp.tool_calls.length > 0) {
            setActiveTraceMsgId(agentMsgId);
          }

          fetchSecretsMetadata();

          setMessages(prev => {
            const actualMsgCount = prev.filter(m => m.type === 'user' || m.type === 'agent').length;
            if (actualMsgCount <= 3 && onFirstMessage) {
              onFirstMessage(text);
            }
            return prev;
          });
        }
      }, speed);

      streamTimerRef.current = timer;

    } catch (e: any) {
      setIsLoading(false);
      if (e.name === 'AbortError') {
        // 用户主动停止，移除 loading 消息并恢复状态
        setMessages(prev => prev.filter(m => m.type !== 'loading'));
        return;
      }
      setMessages(prev => {
        const filtered = prev.filter(m => m.type !== 'loading');
        const isBlocked = e.message && (e.message.includes('阻断') || e.message.includes('拦截') || e.message.includes('外泄'));
        return [...filtered, {
          id: Date.now() + 2,
          type: 'agent',
          text: e.message || 'Request failed',
          isBlocked: isBlocked,
        }];
      });
    } finally {
      abortControllerRef.current = null;
      inputRef.current?.focus();
    }
  };

  const handleApprove = (approvalMsgId: number) => {
    // 1. 将该消息状态置为 approved
    setMessages(prev => prev.map(m => m.id === approvalMsgId ? { ...m, approvalStatus: 'approved' } : m));
    
    // 2. 找到用于重新发送的文本
    let textToSend = lastUserMessage;
    if (!textToSend) {
      const idx = messages.findIndex(m => m.id === approvalMsgId);
      if (idx > 0) {
        for (let i = idx - 1; i >= 0; i--) {
          if (messages[i].type === 'user') {
            textToSend = messages[i].text;
            break;
          }
        }
      }
    }
    
    // 3. 发送
    if (textToSend) {
      handleSend(textToSend, true);
    } else {
      showToast('⚠️ 未找到前置指令，请尝试重新输入。');
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

                      {/* 多步骤交互式执行计划 */}
                      {msg.plan && msg.plan.steps && Array.isArray(msg.plan.steps) && (
                        <div className="mt-4 p-4 rounded-xl border border-outline-variant/60 bg-surface-container-low text-on-surface shadow-sm space-y-4 text-left" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-between border-b border-outline-variant/30 pb-2.5">
                            <div className="flex items-center gap-2">
                              <CalendarClock className="w-4 h-4 text-primary" />
                              <span className="font-bold text-xs">{isZh ? '复合运维任务步骤执行计划' : 'Composite Operations Task Execution Plan'}</span>
                            </div>
                            <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded font-mono font-bold">
                              {isZh ? '步骤数: ' : 'Steps: '}
                              {msg.plan.steps.filter(s => s && (s.status === 'success' || s.status === 'skipped')).length} / {msg.plan.steps.length}
                            </span>
                          </div>

                          {/* 一键/逐步执行按钮组 */}
                          {msg.plan.steps.every(s => s && s.status === 'pending') && (
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => {
                                  const firstStep = msg.plan?.steps?.[0];
                                  if (firstStep) executePlanStep(msg.id, firstStep.index, undefined, true);
                                }}
                                className="px-3 py-1.5 rounded bg-primary hover:bg-primary/95 text-on-primary text-xs font-semibold shadow-sm flex items-center gap-1 active:scale-95 transition-all"
                              >
                                <Play className="w-3.5 h-3.5 fill-current" />
                                {isZh ? '一键顺序执行' : 'Execute All'}
                              </button>
                              <button
                                onClick={() => {
                                  const firstStep = msg.plan?.steps?.[0];
                                  if (firstStep) executePlanStep(msg.id, firstStep.index, undefined, false);
                                }}
                                className="px-3 py-1.5 rounded border border-outline-variant hover:bg-surface-container-high text-on-surface text-xs font-semibold active:scale-95 transition-all"
                              >
                                {isZh ? '单步依次执行' : 'Execute step-by-step'}
                              </button>
                            </div>
                          )}

                          {/* 进度步骤列表 */}
                          <div className="space-y-3">
                            {msg.plan.steps.map(step => {
                              const isEditing = editingStepIndex?.msgId === msg.id && editingStepIndex?.stepIndex === step.index;
                              const isRunning = step.status === 'running';
                              const isSuccess = step.status === 'success';
                              const isFailed = step.status === 'failed';
                              const isSkipped = step.status === 'skipped';
                              const hasLog = step.stdout || step.stderr;

                              return (
                                <div 
                                  key={step.index} 
                                  className={`rounded-xl border p-3 transition-all ${
                                    isRunning 
                                      ? 'border-primary/40 bg-primary/5' 
                                      : isSuccess 
                                        ? 'border-green-200 bg-green-500/5' 
                                        : isFailed 
                                          ? 'border-red-200 bg-red-500/5' 
                                          : 'border-outline-variant/30 bg-surface'
                                  }`}
                                >
                                  {/* Step Header */}
                                  <div className="flex items-center justify-between gap-3 mb-2">
                                    <div className="flex items-center gap-2">
                                      {/* Status Circle Icon */}
                                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                                        isRunning 
                                          ? 'bg-primary text-on-primary' 
                                          : isSuccess 
                                            ? 'bg-green-600 text-white' 
                                            : isFailed 
                                              ? 'bg-red-600 text-white' 
                                              : 'bg-surface-container-high text-on-surface-variant'
                                      }`}>
                                        {isRunning && <Loader2 className="w-3 h-3 animate-spin" />}
                                        {isSuccess && '✓'}
                                        {isFailed && '✗'}
                                        {isSkipped && '—'}
                                        {step.status === 'pending' && step.index}
                                      </div>
                                      <span className="text-xs font-bold text-on-surface">{step.title}</span>
                                    </div>
                                    
                                    {/* Action items inside step */}
                                    {step.status === 'pending' && !(msg.plan?.steps || []).some(s => s && s.status === 'running') && (
                                      <button
                                        onClick={() => executePlanStep(msg.id, step.index, undefined, false)}
                                        className="text-[10px] px-2 py-0.5 rounded border border-outline hover:bg-surface-container-high text-on-surface font-semibold"
                                      >
                                        {isZh ? '运行此步' : 'Run'}
                                      </button>
                                    )}
                                  </div>

                                  {/* Command Box */}
                                  <div className="mb-2">
                                    {isEditing ? (
                                      <div className="space-y-1.5">
                                        <textarea
                                          className="w-full font-mono text-xs bg-zinc-950 text-zinc-100 p-2.5 rounded-lg border border-primary focus:outline-none resize-none min-h-[64px]"
                                          value={editedCommandText}
                                          onChange={(e) => setEditedCommandText(e.target.value)}
                                        />
                                        <div className="flex items-center gap-2 justify-end">
                                          <button
                                            onClick={() => {
                                              setEditingStepIndex(null);
                                              executePlanStep(msg.id, step.index, editedCommandText, false);
                                            }}
                                            className="px-2 py-1 rounded bg-primary text-on-primary text-[10px] font-semibold"
                                          >
                                            {isZh ? '保存并运行' : 'Save & Run'}
                                          </button>
                                          <button
                                            onClick={() => setEditingStepIndex(null)}
                                            className="px-2 py-1 rounded border border-outline text-[10px]"
                                          >
                                            {isZh ? '取消' : 'Cancel'}
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="relative group/cmd">
                                        <pre className="font-mono text-[11px] bg-zinc-950 text-zinc-100 p-2.5 rounded-lg break-all select-all leading-relaxed whitespace-pre-wrap max-h-24 overflow-y-auto">
                                          <code>{step.command}</code>
                                        </pre>
                                        {!isRunning && step.status !== 'success' && (
                                          <button
                                            onClick={() => {
                                              setEditingStepIndex({ msgId: msg.id, stepIndex: step.index });
                                              setEditedCommandText(step.command);
                                            }}
                                            className="absolute right-2 top-2 p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 opacity-0 group-hover/cmd:opacity-100 text-[9px] font-bold"
                                            title={isZh ? '修改命令' : 'Edit Command'}
                                          >
                                            ✏️
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  {/* Output Console Logs */}
                                  {hasLog && (
                                    <details className="mt-2 bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden select-text text-left">
                                      <summary className="px-3 py-1 cursor-pointer bg-zinc-900 border-b border-zinc-800 text-[9px] font-mono text-zinc-400 select-none flex items-center justify-between">
                                        <span>{isZh ? '▶ 展开终端输出日志' : '▶ Expand Terminal Log'}</span>
                                        <span className={`text-[8px] font-bold uppercase ${isSuccess ? 'text-green-500' : 'text-red-500'}`}>
                                          {isSuccess ? 'Exit 0' : 'Error'}
                                        </span>
                                      </summary>
                                      <pre className="p-3 font-mono text-[10px] text-zinc-200 leading-normal max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
                                        {step.stdout && <span className="text-zinc-100">{step.stdout}\n</span>}
                                        {step.stderr && <span className="text-red-400">{step.stderr}\n</span>}
                                      </pre>
                                    </details>
                                  )}

                                  {/* Error Interaction Options */}
                                  {isFailed && (
                                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-outline-variant/20">
                                      <button
                                        onClick={() => executePlanStep(msg.id, step.index, step.command, false)}
                                        className="px-2.5 py-1 rounded bg-red-100 hover:bg-red-200 text-red-700 text-[10px] font-semibold flex items-center gap-1 active:scale-95 transition-all"
                                      >
                                        <RefreshCw className="w-3.5 h-3.5" />
                                        {isZh ? '重新尝试' : 'Retry'}
                                      </button>
                                      <button
                                        onClick={() => {
                                          setEditingStepIndex({ msgId: msg.id, stepIndex: step.index });
                                          setEditedCommandText(step.command);
                                        }}
                                        className="px-2.5 py-1 rounded border border-outline text-[10px] font-semibold active:scale-95 transition-all"
                                      >
                                        ✏️ {isZh ? '编辑命令' : 'Edit'}
                                      </button>
                                      <button
                                        onClick={() => handleSkipStep(msg.id, step.index, false)}
                                        className="px-2.5 py-1 rounded border border-outline text-[10px] text-on-surface-variant hover:bg-surface-container-high font-semibold active:scale-95 transition-all"
                                      >
                                        ⏭️ {isZh ? '跳过步骤' : 'Skip'}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
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
                          <p className="text-[10px] text-red-700/80 mt-1.5 font-medium">
                            💡 建议您立即在凭证库中创建该密码的安全引用并轮换密钥。升级至 <strong>企业版</strong> 可获得本地网关提供的全自动智能语义脱敏服务。
                          </p>
                        </div>
                      </div>
                    )}

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
          const secretRef = msg.secretRefs && msg.secretRefs.length > 0 
            ? msg.secretRefs[0] 
            : 'sec_live_default_ref';

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
          } else if (toolCall.tool === 'browser_login_mock' && toolCall.args.url) {
            try {
              host = new URL(toolCall.args.url).hostname;
            } catch {
              host = toolCall.args.url;
            }
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
                      {toolCall.tool === 'browser_login_mock' ? (
                        <>
                          <p className="text-on-surface-variant font-bold">&gt; Initializing headless browser...</p>
                          <p className="text-on-surface-variant font-bold">&gt; Navigating to {toolCall.args.url || 'https://admin.example.com'}</p>
                          <p className="text-on-surface-variant font-bold">&gt; Locating DOM elements... Found.</p>
                          <p className="text-primary font-bold">&gt; Injecting payload via {secretRef.substring(0, 8)}...</p>
                        </>
                      ) : (
                        <>
                          <p className="text-on-surface-variant font-bold">&gt; Active security context: user_id=validated</p>
                          <p className="text-primary font-bold">&gt; Resolve secret ref: {secretRef.substring(0, 10)}...</p>
                          <p className="text-green-600 font-bold">&gt; Executing secure sandbox command:</p>
                          <p className="text-on-surface bg-surface-container-low p-1 rounded break-all whitespace-pre-wrap">
                            {toolCall.args.command || 'secure_shell'}
                          </p>
                        </>
                      )}
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
