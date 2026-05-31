import React from 'react';
import { Bot, Key, Lock, Terminal, Brain, Link, ShieldAlert, CheckCircle2, UserCheck, CheckCheck, Wrench } from 'lucide-react';
import { useI18n } from '../i18n';

export function ExecutionTrace() {
  const { t } = useI18n();

  return (
    <div className="flex-1 p-6 lg:p-10 max-w-4xl mx-auto w-full animate-in slide-in-from-right-4 duration-500">
      
      {/* Header Section */}
      <div className="mb-10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-headline font-semibold text-on-surface tracking-tight">{t('trace.title')}</h2>
            <p className="text-on-surface-variant mt-2 text-sm max-w-xl font-body">
              {t('trace.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="px-3 py-1.5 text-xs font-mono bg-surface-container-low rounded border border-outline-variant text-on-surface-variant shadow-sm flex gap-2">
              <span className="opacity-70">{t('trace.sessionId')}:</span> <span className="text-primary font-medium">txn_8842af9c</span>
            </span>
            <span className="px-3 py-1.5 text-xs font-mono bg-surface-container-low rounded border border-outline-variant text-on-surface-variant shadow-sm flex gap-2">
              <span className="opacity-70">{t('trace.agent')}:</span> <span className="text-tertiary font-medium">AdminBot-Alpha</span>
            </span>
          </div>
        </div>
      </div>

      {/* Timeline Container */}
      <div className="relative pb-10 mt-8">
        {/* Main Timeline Connecting Line */}
        <div className="absolute left-6 top-8 bottom-4 w-px bg-outline-variant z-0"></div>

        <div className="space-y-8">
          
          {/* Step 1: Intent Detected */}
          <TimelineNode 
            icon={<Brain className="w-5 h-5 text-primary" />}
            title={t('trace.intentDetected')}
            badge={t('trace.parsing')}
            badgeColor="bg-surface-container text-secondary"
            time="14:02:05.122 UTC"
            isHoverPrimary
          >
            <div className="bg-surface-container-low rounded-lg p-3.5 border border-outline-variant font-mono text-sm text-on-surface-variant">
              <p><span className="text-primary opacity-90">{t('trace.userRequest')}:</span> "{t('trace.mockRequest')}"</p>
              <p className="mt-1.5"><span className="text-tertiary opacity-90">{t('trace.parsedGoal')}:</span> <span className="text-on-surface font-semibold bg-surface-container px-1 rounded">{t('trace.loginToAdmin')}</span></p>
            </div>
          </TimelineNode>

          {/* Step 2: Requesting Credential Ref */}
          <TimelineNode 
            icon={<Key className="w-5 h-5 text-tertiary" />}
            title={t('trace.requestingCredential')}
            badge={t('trace.vaultAccess')}
            badgeColor="bg-tertiary/10 text-tertiary border border-tertiary/20"
            time="14:02:05.340 UTC"
            borderColor="border-l-tertiary border-l-2"
          >
            <p className="text-sm text-on-surface-variant mb-4">{t('trace.agentRequestedRef')}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-surface-container-low rounded-lg p-3 border border-outline-variant flex flex-col gap-1.5">
                <span className="text-[10px] text-on-surface-variant uppercase tracking-wider font-bold">{t('trace.targetDomain')}</span>
                <span className="text-sm font-mono text-on-surface font-medium selection:bg-primary/20">admin.example.com</span>
              </div>
              <div className="bg-tertiary/5 rounded-lg p-3 border border-tertiary/30 flex flex-col gap-1.5 relative overflow-hidden group">
                <div className="absolute inset-0 bg-tertiary/5 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                <span className="text-[10px] text-tertiary uppercase tracking-wider font-bold relative z-10">{t('trace.secretRefIssued')}</span>
                <div className="flex items-center gap-2 relative z-10">
                  <Lock className="w-3.5 h-3.5 text-tertiary" />
                  <span className="text-sm font-mono text-on-surface font-semibold bg-surface-container-lowest px-1.5 py-0.5 rounded border border-outline-variant/50">sec_123_***</span>
                </div>
              </div>
            </div>
          </TimelineNode>

          {/* Step 3: Policy Check */}
          <TimelineNode 
            icon={<ShieldAlert className="w-5 h-5 text-primary" />}
            title={t('trace.policyEvaluation')}
            badge={<><CheckCircle2 className="w-3.5 h-3.5 mr-1 inline-block" /> {t('trace.success')}</>}
            badgeColor="bg-green-100 text-green-700 border border-green-200"
            time="14:02:05.451 UTC"
            isHoverPrimary
          >
            <div className="flex items-start gap-4 bg-surface-container-low rounded-lg p-4 border border-outline-variant">
              <UserCheck className="text-green-600 mt-0.5 w-6 h-6 shrink-0" />
              <div>
                <p className="text-sm text-on-surface font-semibold">{t('trace.domainVerified')}</p>
                <p className="text-xs text-on-surface-variant mt-1.5 font-mono leading-relaxed">
                  {t('trace.domainMatchDesc')
                    .replace('{domain}', '')}
                  <span className="text-secondary font-semibold bg-surface-container px-1 py-0.5 rounded">admin.example.com</span>
                  {' → '}
                  <span className="text-tertiary font-semibold bg-tertiary/10 px-1 py-0.5 rounded">sec_123</span>
                </p>
              </div>
            </div>
          </TimelineNode>

          {/* Step 4: Tool Execution */}
          <TimelineNode 
            icon={<Wrench className="w-5 h-5 text-primary animate-pulse" />}
            iconBg="bg-primary/10 border-primary border-2"
            title={t('trace.toolExecution')}
            badge={t('trace.running')}
            titleColor="text-primary"
            badgeColor="bg-primary/10 text-primary border border-primary/20 animate-pulse"
            time="14:02:05.600 UTC"
            containerClass="glass-elevated border-primary/40 group-hover:border-primary"
          >
            <div className="bg-surface-dim rounded-lg border border-outline-variant overflow-hidden font-mono text-sm shadow-inner mt-2">
              {/* Terminal Header */}
              <div className="bg-surface-container px-4 py-2 border-b border-outline-variant flex items-center justify-between">
                <span className="text-xs text-on-surface-variant flex items-center gap-2 font-semibold">
                  <Terminal className="w-3.5 h-3.5" />
                  browser_login
                </span>
                <div className="flex gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-400"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-400"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-green-400"></div>
                </div>
              </div>
              
              {/* Terminal Output */}
              <div className="p-4 text-on-surface space-y-2.5 text-xs">
                <TermLine>{t('trace.initBrowser')}</TermLine>
                <TermLine>{t('trace.navigating')} <span className="text-secondary">https://admin.example.com/login</span></TermLine>
                <TermLine>{t('trace.locatingDom')}</TermLine>
                <div className="flex gap-3 bg-tertiary/5 -mx-4 px-4 py-1.5 border-l-2 border-tertiary">
                  <span className="text-tertiary font-bold shrink-0">{'>'}</span> 
                  <span className="text-tertiary break-all">
                    {t('trace.injectingCredential').replace('{ref}', '')}<span className="font-bold border-b border-tertiary border-dashed pb-0.5 mr-1">sec_123</span>
                  </span>
                </div>
                <TermLine>{t('trace.submittingForm')}</TermLine>
                <div className="flex gap-3">
                  <span className="text-primary font-bold shrink-0">{'>'}</span> 
                  <span className="text-on-surface-variant italic animate-pulse flex items-center gap-1.5">
                    {t('trace.waitingNetwork')} <span className="flex gap-0.5"><span className="w-1 h-1 bg-on-surface-variant rounded-full animate-bounce"></span><span className="w-1 h-1 bg-on-surface-variant rounded-full animate-bounce" style={{ animationDelay: '0.2s'}}></span><span className="w-1 h-1 bg-on-surface-variant rounded-full animate-bounce" style={{ animationDelay: '0.4s'}}></span></span>
                  </span>
                </div>
              </div>
            </div>
          </TimelineNode>

          {/* Step 5: Result */}
          <TimelineNode 
            icon={<CheckCheck className="w-5 h-5 text-green-600" />}
            title={t('trace.result')}
            badge={t('trace.complete')}
            badgeColor="bg-surface-container text-secondary border border-outline-variant"
            time="14:02:07.892 UTC"
            borderColor="border-l-green-500 border-l-2"
          >
            <div className="flex items-center gap-3.5 bg-green-50 rounded-lg p-4 border border-green-100/50 shadow-sm">
              <div className="bg-green-100 rounded-full p-1.5 shrink-0">
                <CheckCheck className="text-green-600 w-5 h-5" />
              </div>
              <div>
                <p className="text-sm text-green-800 font-semibold mb-0.5">{t('trace.loginSuccess')}</p>
                <p className="text-xs text-green-700/80 font-medium">{t('trace.loginSuccessDesc')}</p>
              </div>
            </div>
          </TimelineNode>

        </div>
      </div>
    </div>
  );
}

function TermLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="text-primary font-bold shrink-0">{'>'}</span> 
      <span>{children}</span>
    </div>
  );
}

function TimelineNode({ 
  icon, iconBg = "bg-surface border-outline-variant", 
  title, titleColor = "text-on-surface", 
  badge, badgeColor, time, 
  borderColor = "", containerClass = "", isHoverPrimary = false,
  children 
}: any) {
  return (
    <div className="relative flex gap-6 group z-10">
      <div className="flex-none flex flex-col items-center">
        <div className={`w-12 h-12 rounded-full border flex items-center justify-center transition-colors z-10 relative ${iconBg} ${isHoverPrimary ? 'group-hover:border-primary' : ''}`}>
          {icon}
        </div>
      </div>
      <div className="flex-1 mt-1">
        <div className={`glass-panel p-5 rounded-xl transition-all duration-300 ${borderColor} ${containerClass} ${isHoverPrimary ? 'group-hover:border-primary/50 group-hover:shadow-sm' : ''}`}>
          <div className="flex flex-wrap justify-between items-start mb-4 gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h3 className={`text-lg font-headline font-semibold ${titleColor}`}>{title}</h3>
              <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${badgeColor}`}>
                {badge}
              </span>
            </div>
            <span className="text-[11px] font-mono text-on-surface-variant font-medium opacity-80 mt-1">{time}</span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
