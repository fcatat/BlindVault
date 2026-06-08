import { useState, useCallback, useEffect } from 'react';
import { useI18n } from './i18n';
import { Sidebar, SessionInfo } from './components/Sidebar';
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { Chat } from './components/Chat';
import { RulesConfig } from './components/RulesConfig';
import { AgentConfig } from './components/AgentConfig';
import { LocalModelConfig } from './components/LocalModelConfig';
import { EnterprisePlaceholder } from './components/EnterprisePlaceholder';
import { AddCredentialModal } from './components/AddCredentialModal';
import { ViewState } from './types';
import { checkEEStatus, type EEStatus } from './api';

function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createSession(title: string): SessionInfo {
  return {
    id: generateSessionId(),
    title,
    createdAt: new Date(),
  };
}

export default function App() {
  const [activeView, setActiveView] = useState<ViewState>('chat');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [eeStatus, setEeStatus] = useState<EEStatus | null>(null);

  // 加载企业版 License 状态
  useEffect(() => {
    async function loadEE() {
      try {
        const status = await checkEEStatus();
        setEeStatus(status);
      } catch (e) {
        console.error('加载企业版 License 失败:', e);
      }
    }
    loadEE();
  }, []);

  // Session management
  const [sessions, setSessions] = useState<SessionInfo[]>(() => {
    try {
      const cached = localStorage.getItem('bv_sessions');
      if (cached) return JSON.parse(cached);
    } catch (e) {
      console.error('加载 sessions 缓存失败:', e);
    }
    return [createSession('你好')];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    try {
      const cachedActive = localStorage.getItem('bv_active_session_id');
      if (cachedActive) return cachedActive;
    } catch (e) {}
    return sessions[0]?.id || '';
  });

  const { t } = useI18n();

  // 同步 sessions 数据到 localStorage
  useEffect(() => {
    localStorage.setItem('bv_sessions', JSON.stringify(sessions));
  }, [sessions]);

  // 同步 activeSessionId 到 localStorage
  useEffect(() => {
    if (activeSessionId) {
      localStorage.setItem('bv_active_session_id', activeSessionId);
    }
  }, [activeSessionId]);

  const handleSecretCreated = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  const handleNewSession = useCallback(() => {
    const newSession = createSession(t('sidebar.newSession'));
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setActiveView('chat');
  }, [t]);

  const handleDeleteSession = useCallback((id: string) => {
    try {
      localStorage.removeItem(`bv_chat_${id}`);
      localStorage.removeItem(`bv_chat_active_trace_${id}`);
    } catch (e) {
      console.error('清除会话缓存失败:', e);
    }
    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (filtered.length === 0) {
        const newSession = createSession(t('sidebar.newSession'));
        setActiveSessionId(newSession.id);
        return [newSession];
      }
      if (activeSessionId === id) {
        setActiveSessionId(filtered[0].id);
      }
      return filtered;
    });
  }, [activeSessionId, t]);

  const handleUpdateSessionTitle = useCallback((sessionId: string, firstMessage: string) => {
    const title = firstMessage.slice(0, 24) + (firstMessage.length > 24 ? '…' : '');
    setSessions(prev =>
      prev.map(s => s.id === sessionId ? { ...s, title } : s)
    );
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-on-surface">
      <Sidebar 
        activeView={activeView} 
        onNavigate={(view) => setActiveView(view)} 
        onOpenModal={() => setIsModalOpen(true)}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={setActiveSessionId}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        eeStatus={eeStatus}
      />
      
      <div className="flex-1 flex flex-col md:ml-64 relative bg-background h-screen overflow-hidden">
        <Header />
        
        <main className={`flex-1 flex flex-col relative w-full h-full min-h-0 ${activeView === 'chat' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          {activeView === 'dashboard' && (
            <Dashboard 
              key={`${refreshKey}_${activeSessionId}`} 
              sessionId={activeSessionId} 
            />
          )}
          {activeView === 'chat' && (
            <Chat 
              key={activeSessionId}
              sessionId={activeSessionId} 
              onFirstMessage={(msg) => handleUpdateSessionTitle(activeSessionId, msg)}
            />
          )}
          {activeView === 'rules' && <RulesConfig />}
          {activeView === 'config' && <AgentConfig />}

          {/* 企业版独立路由页面 */}
          {activeView === 'local_model' && <LocalModelConfig />}
          {activeView === 'sso' && <EnterprisePlaceholder viewType="sso" />}
          {activeView === 'audit' && <EnterprisePlaceholder viewType="audit" />}
          {activeView === 'multi_model' && <EnterprisePlaceholder viewType="multi_model" />}
          {activeView === 'policy' && <EnterprisePlaceholder viewType="policy" />}
          {activeView === 'hardware' && <EnterprisePlaceholder viewType="hardware" />}
        </main>
      </div>

      <AddCredentialModal 
        key={activeSessionId}
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        sessionId={activeSessionId}
        onCreated={handleSecretCreated}
      />
    </div>
  );
}
