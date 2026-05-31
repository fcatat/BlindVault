import { useState, useCallback } from 'react';
import { Sidebar, SessionInfo } from './components/Sidebar';
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { Chat } from './components/Chat';
import { ExecutionTrace } from './components/ExecutionTrace';
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
  const [sessions, setSessions] = useState<SessionInfo[]>([createSession(1)]);
  const [activeSessionId, setActiveSessionId] = useState(sessions[0].id);
  const [sessionCounter, setSessionCounter] = useState(2);

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
    <div className="flex min-h-screen bg-background text-on-surface">
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
      
      <div className="flex-1 flex flex-col md:ml-64 relative bg-background">
        <Header />
        
        <main className="flex-1 flex flex-col relative w-full h-full overflow-y-auto">
          {activeView === 'dashboard' && <Dashboard key={refreshKey} />}
          {activeView === 'chat' && (
            <Chat 
              key={activeSessionId}
              sessionId={activeSessionId} 
              onFirstMessage={(msg) => handleUpdateSessionTitle(activeSessionId, msg)}
            />
          )}
          {activeView === 'trace' && <ExecutionTrace />}
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
