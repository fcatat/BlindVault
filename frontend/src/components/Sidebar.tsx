import React from 'react';
import { ViewState } from '../types';
import { useI18n } from '../i18n';
import { 
  ShieldAlert, Plus, MessageSquare, Key, SquareTerminal, 
  Bot, FileText, FileBadge, PlusCircle, Trash2,
  Lock, Cpu, ClipboardList, Users, Layers, Server, ShieldCheck, Image, EyeOff
} from 'lucide-react';


export interface SessionInfo {
  id: string;
  title: string;
  createdAt: Date;
}

interface SidebarProps {
  activeView: ViewState;
  onNavigate: (view: ViewState) => void;
  onOpenModal: () => void;
  sessions: SessionInfo[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
}

export function Sidebar({ 
  activeView, onNavigate, onOpenModal,
  sessions, activeSessionId, onSelectSession, onNewSession, onDeleteSession,
}: SidebarProps) {
  const { t, locale } = useI18n();
  const isZh = locale === 'zh';

  return (
    <nav className="hidden md:flex flex-col pt-16 z-40 bg-surface border-r border-outline-variant h-screen w-64 fixed left-0 top-0 overflow-y-auto">

      <div className="px-6 pb-6 border-b border-outline-variant mb-4">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded bg-primary-fixed border border-primary-fixed-dim flex items-center justify-center">
            <ShieldAlert className="text-on-primary-fixed w-5 h-5" />
          </div>
          <div>
            <div className="text-lg font-headline font-bold text-on-surface">BlindVault</div>
            <div className="text-xs text-primary font-mono tracking-wider uppercase flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
              {t('sidebar.systemOnline')}
            </div>
          </div>
        </div>
        <button 
          onClick={onOpenModal}
          className="w-full btn-primary rounded py-2 px-4 flex items-center justify-center gap-2 text-sm font-semibold"
        >
          <Plus className="w-4 h-4" />
          {t('sidebar.addSecret')}
        </button>
      </div>

      {/* Sessions */}
      <div className="px-4 mb-4">
        <div className="flex items-center justify-between mb-2 px-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">{t('sidebar.sessions')}</span>
          <button
            onClick={onNewSession}
            className="p-1 rounded hover:bg-primary/10 text-primary transition-colors"
            title={t('sidebar.newSession')}
          >
            <PlusCircle className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-0.5 max-h-48 overflow-y-auto">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`group flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-all duration-200 ${
                s.id === activeSessionId && activeView === 'chat'
                  ? 'bg-secondary-container text-on-secondary-container font-semibold'
                  : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
              }`}
              onClick={() => {
                onSelectSession(s.id);
                onNavigate('chat');
              }}
            >
              <MessageSquare className="w-3.5 h-3.5 shrink-0" />
              <span className="text-sm truncate flex-1">{s.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteSession(s.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-100 text-red-400 hover:text-red-600 transition-all"
                title={t('sidebar.deleteSession')}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Core Features */}
      <div className="flex-1 px-4 space-y-1">
        <NavItem 
          icon={<Key className="w-4 h-4" />} 
          label={t('sidebar.credentialVault')} 
          isActive={activeView === 'dashboard'} 
          onClick={() => onNavigate('dashboard')} 
        />
        <NavItem 
          icon={<EyeOff className="w-4 h-4" />} 
          label={t('sidebar.sanitizationRules')} 
          isActive={activeView === 'rules'} 
          onClick={() => onNavigate('rules')} 
        />
        <NavItem 
          icon={<Bot className="w-4 h-4" />} 
          label={t('sidebar.agentConfig')} 
          isActive={activeView === 'config'} 
          onClick={() => onNavigate('config')} 
        />
        <NavItem 
          icon={<ClipboardList className="w-4 h-4" />} 
          label={t('sidebar.auditLog')}
          isActive={activeView === 'audit'}
          onClick={() => onNavigate('audit')}
        />
        <NavItem 
          icon={<Cpu className="w-4 h-4" />} 
          label={t('sidebar.localModelGateway')}
          isActive={activeView === 'local_model'}
          onClick={() => onNavigate('local_model')}
        />


        {/* Roadmap Section (not yet available) */}
        <div className="pt-5 pb-1 px-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">{t('sidebar.roadmap')}</span>
        </div>

        <RoadmapNavItem icon={<Users className="w-4 h-4" />} label={t('sidebar.userManagement')} sublabel="SSO / LDAP / OIDC" />
        <RoadmapNavItem icon={<Layers className="w-4 h-4" />} label={t('sidebar.multiModel')} />
        <RoadmapNavItem icon={<ShieldCheck className="w-4 h-4" />} label={t('sidebar.policyEngine')} />
        <RoadmapNavItem icon={<Server className="w-4 h-4" />} label={t('sidebar.hardwareAppliance')} />
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-outline-variant space-y-1 mt-auto">
        <a href="#" className="flex items-center gap-3 text-on-surface-variant px-4 py-2 hover:bg-surface-container-highest hover:text-on-surface transition-all duration-200 cursor-pointer active:opacity-80 rounded">
          <FileText className="w-4 h-4" />
          <span className="text-xs">{t('sidebar.docs')}</span>
        </a>
        <a href="#" className="flex items-center gap-3 text-on-surface-variant px-4 py-2 hover:bg-surface-container-highest hover:text-on-surface transition-all duration-200 cursor-pointer active:opacity-80 rounded">
          <FileBadge className="w-4 h-4" />
          <span className="text-xs">{t('sidebar.securityPolicy')}</span>
        </a>
      </div>
    </nav>
  );
}

function NavItem({ icon, label, isActive, onClick }: { icon: React.ReactNode, label: string, isActive: boolean, onClick: () => void }) {
  if (isActive) {
    return (
      <div className="flex items-center gap-3 bg-secondary-container text-on-secondary-container rounded px-4 py-2 cursor-pointer active:opacity-80 transition-all duration-200 font-semibold" onClick={onClick}>
        {icon}
        <span className="text-sm">{label}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 text-on-surface-variant px-4 py-2 hover:bg-surface-container-highest hover:text-on-surface transition-all duration-200 cursor-pointer active:opacity-80 rounded" onClick={onClick}>
      {icon}
      <span className="text-sm">{label}</span>
    </div>
  );
}

function RoadmapNavItem({ 
  icon, label, sublabel
}: { 
  icon: React.ReactNode, 
  label: string, 
  sublabel?: string,
}) {
  const { t } = useI18n();

  return (
    <div 
      className="relative flex items-center gap-3 text-on-surface-variant/50 px-4 py-2 rounded cursor-not-allowed select-none"
      title={t('sidebar.comingSoon')}
    >
      <span className="opacity-40">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm opacity-60 truncate">{label}</span>
          <Lock className="w-3 h-3 opacity-30 shrink-0" />
        </div>
        {sublabel && (
          <span className="text-[10px] opacity-40 font-mono">{sublabel}</span>
        )}
      </div>
    </div>
  );
}
