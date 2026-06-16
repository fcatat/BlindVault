import React, { useState, useEffect } from 'react';
import { 
  Bot, Server, Eye, EyeOff, Loader2, Cpu, Globe, ShieldCheck, Terminal, RefreshCw, Check, Activity, Save, KeyRound, Clock, Database, CheckCircle2, XCircle, Info
} from 'lucide-react';
import { getAgentConfig, updateAgentConfig, getAgentHealth, getSandboxStatus, upgradeSandbox, type AgentConfigData, type AgentHealth, type SandboxStatus } from '../api';
import { useI18n } from '../i18n';

export function AgentConfig() {
  const { t } = useI18n();
  const [config, setConfig] = useState<AgentConfigData | null>(null);
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Editable state
  const [editingModel, setEditingModel] = useState('');
  const [editingIterations, setEditingIterations] = useState(15);
  const [isSaving, setIsSaving] = useState(false);

  // 诊断沙箱状态
  const [sandbox, setSandbox] = useState<SandboxStatus | null>(null);
  const [sandboxLoading, setSandboxLoading] = useState(true);
  const [sandboxUpgrading, setSandboxUpgrading] = useState(false);
  const [sandboxUpgraded, setSandboxUpgraded] = useState(false);

  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    fetchConfig();
    fetchSandbox();
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchHealth = async () => {
    try {
      const h = await getAgentHealth();
      setHealth(h);
    } catch (e) {
      console.error('获取健康状态失败:', e);
    }
  };

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
      setEditingModel(cfg.editable.default_model);
      setEditingIterations(cfg.editable.max_iterations);
    } catch (e: any) {
      setError(e.message || t('config.fetchFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    try {
      setIsSaving(true);
      setError('');
      const payload: any = {
        default_model: editingModel,
        max_iterations: editingIterations,
      };
      
      const updated = await updateAgentConfig(payload);
      setConfig(updated);
      setEditingModel(updated.editable.default_model);
      setEditingIterations(updated.editable.max_iterations);
      
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      
    } catch (e: any) {
      setError(e.message || t('config.saveFailed'));
    } finally {
      setIsSaving(false);
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
      setError(e.message || t('config.sandboxUpgradeFailed'));
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

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  return (
    <div className="p-6 lg:p-10 max-w-4xl mx-auto w-full animate-in fade-in duration-500 overflow-y-auto pb-24">
      
      {/* Page Header */}
      <div className="mb-10">
        <div className="flex items-center gap-4 mb-3">
          <div className="h-12 w-12 rounded-xl bg-primary-fixed border border-primary-fixed-dim flex items-center justify-center shadow-sm">
            <Bot className="text-on-primary-fixed w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-headline font-bold text-on-surface tracking-tight">{t('config.headerTitle')}</h1>
            <p className="text-on-surface-variant text-sm mt-1">{t('config.headerSubtitle')}</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-600 px-4 py-3 rounded-lg text-sm flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <XCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
      
      {saveSuccess && (
        <div className="mb-6 bg-green-500/10 border border-green-500/30 text-green-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          {t('config.saveSuccess')}
        </div>
      )}

      {/* Health Panel */}
      <div className="mb-8 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-surface border border-outline-variant/60 rounded-xl p-4 shadow-sm">
          <div className="text-xs text-on-surface-variant font-medium mb-1 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            {t('config.healthUptime')}
          </div>
          <div className="text-xl font-semibold text-on-surface">
            {health ? formatUptime(health.uptime) : '...'}
          </div>
        </div>

        <div className="bg-surface border border-outline-variant/60 rounded-xl p-4 shadow-sm">
          <div className="text-xs text-on-surface-variant font-medium mb-1 flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5" />
            {t('config.healthRedis')}
          </div>
          <div className="text-xl font-semibold flex items-center gap-2">
            {health ? (
              health.redis_ok ? (
                <><CheckCircle2 className="w-5 h-5 text-green-500" /> <span className="text-green-600 text-sm">{t('config.healthHealthy')}</span></>
              ) : (
                <><XCircle className="w-5 h-5 text-red-500" /> <span className="text-red-600 text-sm">{t('config.healthError')}</span></>
              )
            ) : '...'}
          </div>
        </div>

        <div className="bg-surface border border-outline-variant/60 rounded-xl p-4 shadow-sm">
          <div className="text-xs text-on-surface-variant font-medium mb-1 flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5" />
            {t('config.healthLiteLLM')}
          </div>
          <div className="text-xl font-semibold flex items-center gap-2">
            {health ? (
              health.litellm_ok ? (
                <><CheckCircle2 className="w-5 h-5 text-green-500" /> <span className="text-green-600 text-sm">{t('config.healthHealthy')}</span></>
              ) : (
                <><XCircle className="w-5 h-5 text-amber-500" /> <span className="text-amber-600 text-sm">{t('config.healthError')}</span></>
              )
            ) : '...'}
          </div>
        </div>

        <div className="bg-surface border border-outline-variant/60 rounded-xl p-4 shadow-sm">
          <div className="text-xs text-on-surface-variant font-medium mb-1 flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5" />
            {t('config.healthActiveSecrets')}
          </div>
          <div className="text-xl font-semibold text-primary">
            {health ? health.active_secrets : '...'}
          </div>
        </div>
      </div>

      {/* Editable Config */}
      <div className="panel rounded-xl overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-on-surface">{t('config.editableConfig')}</span>
          </div>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="block text-xs font-label text-on-surface-variant font-medium">Default Model</label>
              <input 
                type="text"
                className="w-full bg-surface-container border border-outline-variant/50 rounded-lg p-2.5 font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-shadow"
                value={editingModel}
                onChange={e => setEditingModel(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-label text-on-surface-variant font-medium">Max Iterations (5-30)</label>
              <input 
                type="number"
                min="5" max="30"
                className="w-full bg-surface-container border border-outline-variant/50 rounded-lg p-2.5 font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-shadow"
                value={editingIterations}
                onChange={e => setEditingIterations(parseInt(e.target.value) || 15)}
              />
            </div>
          </div>
          <div className="pt-2 flex justify-end">
            <button 
              onClick={handleSaveConfig}
              disabled={isSaving}
              className="btn-primary px-5 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {t('config.saveChanges')}
            </button>
          </div>
        </div>
      </div>

      {/* Readonly Config */}
      <div className="panel rounded-xl overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Server className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-on-surface">{t('config.readonlyConfig')}</span>
          </div>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Gateway URL</label>
              <div className="font-mono text-sm text-on-surface bg-surface-container px-3 py-2 rounded border border-outline-variant/50 break-all text-on-surface-variant">
                {config?.readonly.litellm_base_url || t('config.notConfigured')}
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">API Key Status</label>
              <div className="pt-1">
                {config?.readonly.has_api_key ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-green-500/10 border border-green-500/20 text-green-700 font-medium text-xs">
                    <Check className="w-3.5 h-3.5" />
                    {t('config.virtualKeyConfigured')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-700 font-medium text-xs">
                    <Info className="w-3.5 h-3.5" />
                    {t('config.virtualKeyNotConfigured')}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>


      {/* Diagnostics Sandbox Section */}
      <div className="mb-8 panel rounded-xl overflow-hidden animate-in fade-in duration-300">
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
      {config?.readonly.system_prompt && (
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
                <code>{config.readonly.system_prompt}</code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
