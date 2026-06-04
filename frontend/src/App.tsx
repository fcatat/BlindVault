import { useState, useCallback, useEffect } from 'react';
import { Sidebar, SessionInfo } from './components/Sidebar';
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { Chat } from './components/Chat';
import { RulesConfig } from './components/RulesConfig';
import { AgentConfig } from './components/AgentConfig';
import { AddCredentialModal } from './components/AddCredentialModal';
import { ViewState } from './types';

function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createSession(index: number): SessionInfo {
  return {
    id: generateSessionId(),
    title: `Session ${index}`,
    createdAt: new Date(),
  };
}

export default function App() {
  const [activeView, setActiveView] = useState<ViewState>('chat');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Session management
  const [sessions, setSessions] = useState<SessionInfo[]>(() => {
    try {
      const cached = localStorage.getItem('bv_sessions');
      if (cached) return JSON.parse(cached);
    } catch (e) {
      console.error('加载 sessions 缓存失败:', e);
    }
    return [createSession(1)];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    try {
      const cachedActive = localStorage.getItem('bv_active_session_id');
      if (cachedActive) return cachedActive;
    } catch (e) {}
    return sessions[0]?.id || '';
  });

  const [sessionCounter, setSessionCounter] = useState<number>(() => {
    try {
      const cached = localStorage.getItem('bv_session_counter');
      if (cached) return parseInt(cached, 10);
    } catch (e) {}
    return sessions.length + 1;
  });

  // 同步 sessions 数据到 localStorage
  useEffect(() => {
    localStorage.setItem('bv_sessions', JSON.stringify(sessions));
    localStorage.setItem('bv_session_counter', sessionCounter.toString());
  }, [sessions, sessionCounter]);

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
    const newSession = createSession(sessionCounter);
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setSessionCounter(prev => prev + 1);
    setActiveView('chat');
  }, [sessionCounter]);

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
        const newSession = createSession(sessionCounter);
        setActiveSessionId(newSession.id);
        setSessionCounter(c => c + 1);
        return [newSession];
      }
      if (activeSessionId === id) {
        setActiveSessionId(filtered[0].id);
      }
      return filtered;
    });
  }, [activeSessionId, sessionCounter]);

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
        </main>
      </div>

      <AddCredentialModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onCreated={handleSecretCreated}
      />
    </div>
  );
}
