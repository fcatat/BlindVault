import React, { useState, useEffect } from 'react';
import { 
  Bot, Server, Eye, EyeOff, Loader2, Cpu, Globe, ShieldCheck, Zap, Info, Terminal, RefreshCw, Check
} from 'lucide-react';
import { getAgentConfig, getSandboxStatus, upgradeSandbox, type AgentConfigData, type SandboxStatus } from '../api';
import { useI18n } from '../i18n';

export function AgentConfig() {
  const { t } = useI18n();
  const [config, setConfig] = useState<AgentConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 诊断沙箱状态
  const [sandbox, setSandbox] = useState<SandboxStatus | null>(null);
  const [sandboxLoading, setSandboxLoading] = useState(true);
  const [sandboxUpgrading, setSandboxUpgrading] = useState(false);
  const [sandboxUpgraded, setSandboxUpgraded] = useState(false);

  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    fetchConfig();
    fetchSandbox();
  }, []);

  const fetchSandbox = async () => {
    try {
      setSandboxLoading(true);
      const sb = await getSandboxStatus();
      setSandbox(sb);
    } catch (e: any) {
      console.error('获取沙箱状态失败:', e);
    } finally {
      setSandboxLoading(false);
    }
  };

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const cfg = await getAgentConfig();
      setConfig(cfg);
    } catch (e: any) {
      setError(e.message || t('config.fetchFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleUpgrade = async () => {
    try {
      setSandboxUpgrading(true);
      setSandboxUpgraded(false);
      const res = await upgradeSandbox();
      setSandbox(res);
      setSandboxUpgraded(true);
      setTimeout(() => setSandboxUpgraded(false), 3000);
    } catch (e: any) {
      setError(e.message || '升级沙箱失败');
    } finally {
      setSandboxUpgrading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-10">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-10 max-w-4xl mx-auto w-full animate-in fade-in duration-500 overflow-y-auto pb-24">
      
      {/* Page Header */}
      <div className="mb-10">
        <div className="flex items-center gap-4 mb-3">
          <div className="h-12 w-12 rounded-xl bg-primary-fixed border border-primary-fixed-dim flex items-center justify-center">
            <Bot className="text-on-primary-fixed w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-headline font-bold text-on-surface tracking-tight">Agent 模型与策略配置</h1>
            <p className="text-on-surface-variant text-sm mt-1">只读展示后端环境变量加载的核心配置参数。</p>
          </div>
        </div>
      </div>

      {/* API Configuration */}
      <div className={`space-y-6 transition-all duration-300`}>
        <div className="panel rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant bg-surface-container-low flex items-center gap-3">
            <Globe className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-on-surface">LiteLLM 网关配置</span>
          </div>
          
          <div className="p-6 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Gateway URL</label>
                <div className="font-mono text-sm text-on-surface bg-surface-container px-3 py-2 rounded border border-outline-variant/50 break-all">
                  {config?.litellm_base_url || '未配置'}
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Default Model</label>
                <div className="font-mono text-sm text-on-surface bg-surface-container px-3 py-2 rounded border border-outline-variant/50 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-primary" />
                  {config?.default_model || '未配置'}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">API Key Status</label>
              <div>
                {config?.has_api_key ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-green-500/10 border border-green-500/20 text-green-700 font-medium text-xs">
                    <Check className="w-3.5 h-3.5" />
                    已配置 Virtual Key
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-700 font-medium text-xs">
                    <Info className="w-3.5 h-3.5" />
                    未配置 Virtual Key
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Agent Strategy */}
      <div className="mt-8 panel rounded-xl overflow-hidden animate-in fade-in duration-300">
        <div className="px-6 py-4 border-b border-outline-variant bg-surface-container-low flex items-center gap-3">
          <ShieldCheck className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-on-surface">Agent 执行策略</span>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
                Max Iterations
              </label>
              <div className="font-mono text-sm text-on-surface bg-surface-container px-3 py-2 rounded border border-outline-variant/50">
                {config?.max_iterations || 15}
              </div>
              <p className="text-xs text-on-surface-variant">最大循环思考次数。</p>
            </div>
          </div>
        </div>
      </div>

      {/* Diagnostics Sandbox Section */}
      <div className="mt-8 panel rounded-xl overflow-hidden animate-in fade-in duration-300">
        <div className="px-6 py-4 border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Terminal className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-on-surface">{t('config.sandboxTitle')}</span>
          </div>
          {sandboxLoading ? (
            <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
          ) : (
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${sandbox?.status === 'healthy' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
              <span className="text-xs font-semibold text-on-surface-variant">
                {sandbox?.status === 'healthy' ? t('config.sandboxOnline') : t('config.sandboxOffline')}
              </span>
            </div>
          )}
        </div>

        <div className="p-6 space-y-6">
          <p className="text-xs text-on-surface-variant leading-relaxed">
            {t('config.sandboxDesc')}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="block text-xs font-label text-on-surface-variant font-medium">{t('config.sandboxVersion')}</label>
              <div className="bg-surface-container border border-outline-variant rounded-lg px-4 py-3 flex items-center justify-between">
                <span className="text-sm font-mono text-on-surface">{sandboxLoading ? '...' : (sandbox?.version || 'unknown')}</span>
                <button
                  onClick={handleUpgrade}
                  disabled={sandboxLoading || sandboxUpgrading || sandbox?.status !== 'healthy'}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-on-primary hover:bg-primary/95 disabled:opacity-50 disabled:pointer-events-none transition-all flex items-center gap-1.5"
                >
                  {sandboxUpgrading ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {t('config.sandboxUpgrading')}
                    </>
                  ) : sandboxUpgraded ? (
                    <>
                      <Check className="w-3 h-3" />
                      {t('config.sandboxUpgraded')}
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3 h-3" />
                      {t('config.sandboxUpgradeBtn')}
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-label text-on-surface-variant font-medium">{t('config.sandboxTools')}</label>
              <div className="bg-surface-container border border-outline-variant rounded-lg p-3 min-h-[46px] flex flex-wrap gap-1.5 items-center">
                {sandboxLoading ? (
                  <span className="text-xs text-on-surface-variant font-mono animate-pulse">Loading clients...</span>
                ) : sandbox?.tools && sandbox.tools.length > 0 ? (
                  sandbox.tools.map((tool) => (
                    <span
                      key={tool}
                      className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-surface-container-high text-primary border border-outline-variant"
                    >
                      {tool}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-on-surface-variant/60 font-mono">No tools available</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* System Prompt Read-Only Panel */}
      {config?.system_prompt && (
        <div className="mt-8 panel rounded-xl overflow-hidden animate-in fade-in duration-300">
          <div className="px-6 py-4 border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-on-surface">{t('config.promptPreviewTitle')}</span>
            </div>
            <button
              onClick={() => setShowPrompt(!showPrompt)}
              className="text-xs text-primary hover:text-primary-container font-semibold transition-colors flex items-center gap-1"
            >
              {showPrompt ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              <span>{showPrompt ? t('config.promptHide') : t('config.promptShow')}</span>
            </button>
          </div>
          
          {showPrompt && (
            <div className="p-6 bg-surface-container-low/30 border-t border-outline-variant/30 animate-in slide-in-from-top-2 duration-300">
              <p className="text-xs text-on-surface-variant/80 mb-4 leading-relaxed bg-surface-container p-3.5 rounded-lg border border-outline-variant/50">
                {t('config.promptPreviewDesc')}
              </p>
              <pre className="p-4 rounded-xl border border-outline-variant bg-surface-dim overflow-x-auto text-[11px] font-mono text-on-surface leading-relaxed whitespace-pre select-all max-h-[350px] overflow-y-auto">
                <code>{config.system_prompt}</code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

