import React, { useState, useEffect } from 'react';
import { 
  Bot, Server, Key, Eye, EyeOff, Save, CheckCircle2, AlertTriangle, 
  Loader2, Radio, Cpu, Globe, ShieldCheck, Zap, Info, Terminal, RefreshCw, Check, BrainCircuit, Clock
} from 'lucide-react';
import { getConfig, updateConfig, getSandboxStatus, upgradeSandbox, checkLlmConnection, checkLocalModel, type LLMConfig, type SandboxStatus, type LocalModelStatus } from '../api';
import { useI18n } from '../i18n';

export function AgentConfig() {
  const { t } = useI18n();
  const [config, setConfig] = useState<LLMConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // 连通性检测状态
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'auth_error' | 'network_error' | 'mock' | 'unchecked'>('unchecked');
  const [connectionDetail, setConnectionDetail] = useState('');

  const validateLlmConnection = async (currentProvider: string, currentHasKey: boolean) => {
    if (currentProvider === 'mock') {
      setConnectionStatus('mock');
      setConnectionDetail('');
      return;
    }
    
    if (!currentHasKey) {
      setConnectionStatus('unchecked');
      setConnectionDetail('');
      return;
    }

    setConnectionStatus('checking');
    setConnectionDetail('');
    try {
      const res = await checkLlmConnection();
      if (res.success) {
        setConnectionStatus('connected');
      } else {
        setConnectionStatus(res.status as any);
        setConnectionDetail(res.detail);
      }
    } catch (e: any) {
      setConnectionStatus('network_error');
      setConnectionDetail(e.message || '连接检测异常');
    }
  };


  // 诊断沙箱状态
  const [sandbox, setSandbox] = useState<SandboxStatus | null>(null);
  const [sandboxLoading, setSandboxLoading] = useState(true);
  const [sandboxUpgrading, setSandboxUpgrading] = useState(false);
  const [sandboxUpgraded, setSandboxUpgraded] = useState(false);

  // 表单状态
  const [provider, setProvider] = useState('mock');
  const [model, setModel] = useState('gpt-4o');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [safetyPolicyMode, setSafetyPolicyMode] = useState('lax');
  const [showPrompt, setShowPrompt] = useState(false);

  // 企业版：本地模型网关状态
  const [localModelUrl, setLocalModelUrl] = useState('');
  const [localModelName, setLocalModelName] = useState('qwen3:0.6b');
  const [localModelTimeout, setLocalModelTimeout] = useState(2.0);
  const [localModelStatus, setLocalModelStatus] = useState<LocalModelStatus | null>(null);
  const [localModelChecking, setLocalModelChecking] = useState(false);

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
      const cfg = await getConfig();
      setConfig(cfg);
      setProvider(cfg.llm_provider);
      setModel(cfg.llm_model);
      setBaseUrl(cfg.llm_base_url);
      setSafetyPolicyMode(cfg.safety_policy_mode || 'lax');
      setApiKey(''); // API Key 不回传
      setLocalModelUrl(cfg.local_model_url || '');
      setLocalModelName(cfg.local_model_name || 'qwen3:0.6b');
      setLocalModelTimeout(cfg.local_model_timeout || 2.0);
      validateLlmConnection(cfg.llm_provider, cfg.has_api_key);

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

  const handleSave = async () => {
    setError('');
    setSaved(false);

    // 基本校验
    if (provider === 'openai') {
      if (!apiKey && !config?.has_api_key) {
        setError(t('config.needApiKeyForOpenai'));
        return;
      }
      if (!model.trim()) {
        setError(t('config.modelRequired'));
        return;
      }
    }

    setSaving(true);
    try {
      const result = await updateConfig({
        llm_provider: provider,
        llm_model: model.trim(),
        llm_base_url: baseUrl.trim(),
        llm_api_key: apiKey, // 空串 = 不更新
        safety_policy_mode: safetyPolicyMode,
        local_model_url: localModelUrl.trim(),
        local_model_name: localModelName.trim(),
        local_model_timeout: localModelTimeout,
      });
      setConfig(result);
      setApiKey('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      validateLlmConnection(result.llm_provider, result.has_api_key);

    } catch (e: any) {
      setError(e.message || t('config.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-10">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  const isOpenAI = provider === 'openai';

  return (
    <div className="p-6 lg:p-10 max-w-4xl mx-auto w-full animate-in fade-in duration-500">
      
      {/* Page Header */}
      <div className="mb-10">
        <div className="flex items-center gap-4 mb-3">
          <div className="h-12 w-12 rounded-xl bg-primary-fixed border border-primary-fixed-dim flex items-center justify-center">
            <Bot className="text-on-primary-fixed w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-headline font-bold text-on-surface tracking-tight">{t('config.title')}</h1>
            <p className="text-on-surface-variant text-sm mt-1">{t('config.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Status Banner */}
      {(() => {
        let borderColor = 'border-l-4 border-l-primary';
        let iconBg = 'bg-primary/10 text-primary';
        let icon = <Cpu className="w-5 h-5" />;
        let title = t('config.mockRunning');
        let desc = t('config.mockRunningDesc');
        let pulseColor = 'bg-primary';

        if (connectionStatus === 'checking') {
          borderColor = 'border-l-4 border-l-amber-500';
          iconBg = 'bg-amber-100 text-amber-700';
          icon = <Loader2 className="w-5 h-5 animate-spin" />;
          title = t('config.checkingConnection');
          desc = '正在测试大模型网关连通性，请稍候...';
          pulseColor = 'bg-amber-500';
        } else if (connectionStatus === 'connected') {
          borderColor = 'border-l-4 border-l-green-500';
          iconBg = 'bg-green-100 text-green-700';
          icon = <Zap className="w-5 h-5" />;
          title = t('config.connected');
          desc = `${t('config.modelLabel')}: ${config?.llm_model}${config?.llm_base_url ? ' | ' + t('config.gatewayLabel') + ': ' + config.llm_base_url : ''}`;
          pulseColor = 'bg-green-500';
        } else if (connectionStatus === 'auth_error') {
          borderColor = 'border-l-4 border-l-red-500';
          iconBg = 'bg-red-100 text-red-700';
          icon = <AlertTriangle className="w-5 h-5" />;
          title = t('config.authError');
          desc = connectionDetail || 'API Key 校验未通过，请检查 Key 或网关账户余额';
          pulseColor = 'bg-red-500';
        } else if (connectionStatus === 'network_error') {
          borderColor = 'border-l-4 border-l-red-500';
          iconBg = 'bg-red-100 text-red-700';
          icon = <AlertTriangle className="w-5 h-5" />;
          title = t('config.networkError');
          desc = connectionDetail || '无法建立与 AI 网关的连接，请检查网关 Base URL 格式';
          pulseColor = 'bg-red-500';
        } else if (connectionStatus === 'unchecked') {
          borderColor = 'border-l-4 border-l-tertiary';
          iconBg = 'bg-tertiary/10 text-tertiary';
          icon = <AlertTriangle className="w-5 h-5" />;
          title = t('config.needApiKey');
          desc = t('config.needApiKeyDesc');
          pulseColor = 'bg-tertiary';
        }

        return (
          <div className={`panel rounded-xl p-5 mb-8 flex items-center gap-4 ${borderColor} transition-colors duration-300`}>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${iconBg}`}>
              {icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-on-surface">
                {title}
              </div>
              <div className={`text-xs mt-0.5 whitespace-pre-wrap break-all ${connectionStatus.endsWith('error') ? 'text-red-600 font-medium' : 'text-on-surface-variant'}`}>
                {desc}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${pulseColor} animate-pulse`}></span>
              <span className="text-xs font-mono text-on-surface-variant">
                {provider === 'mock' ? 'MOCK' : 'LLM'}
              </span>
            </div>
          </div>
        );
      })()}


      {/* Provider Toggle */}
      <div className="mb-8">
        <label className="block text-sm font-label text-on-surface-variant font-medium mb-3">{t('config.runMode')}</label>
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => {
              setProvider('mock');
              setConnectionStatus('mock');
            }}
            className={`panel rounded-xl p-5 text-left transition-all duration-200 active:scale-[0.99] ${
              !isOpenAI ? 'ring-2 ring-primary border-primary shadow-md' : 'hover:border-outline'
            }`}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${!isOpenAI ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant'}`}>
                <Cpu className="w-4 h-4" />
              </div>
              <span className={`text-sm font-semibold ${!isOpenAI ? 'text-primary' : 'text-on-surface'}`}>{t('config.mockMode')}</span>
            </div>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              {t('config.mockDesc')}
            </p>
          </button>
          <button
            onClick={() => {
              setProvider('openai');
              validateLlmConnection('openai', config?.has_api_key || false);
            }}
            className={`panel rounded-xl p-5 text-left transition-all duration-200 active:scale-[0.99] ${
              isOpenAI ? 'ring-2 ring-primary border-primary shadow-md' : 'hover:border-outline'
            }`}
          >

            <div className="flex items-center gap-3 mb-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isOpenAI ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant'}`}>
                <Zap className="w-4 h-4" />
              </div>
              <span className={`text-sm font-semibold ${isOpenAI ? 'text-primary' : 'text-on-surface'}`}>{t('config.openaiMode')}</span>
            </div>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              {t('config.openaiDesc')}
            </p>
          </button>
        </div>
      </div>

      {/* Safety Policy Mode Toggle */}
      <div className="mb-8">
        <label className="block text-sm font-label text-on-surface-variant font-medium mb-3">{t('config.safetyPolicyMode')}</label>
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => setSafetyPolicyMode('lax')}
            className={`panel rounded-xl p-5 text-left transition-all duration-200 active:scale-[0.99] ${
              safetyPolicyMode === 'lax' ? 'ring-2 ring-primary border-primary shadow-md' : 'hover:border-outline'
            }`}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${safetyPolicyMode === 'lax' ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant'}`}>
                <Info className="w-4 h-4" />
              </div>
              <span className={`text-sm font-semibold ${safetyPolicyMode === 'lax' ? 'text-primary' : 'text-on-surface'}`}>{t('config.laxMode')}</span>
            </div>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              {t('config.laxModeDesc')}
            </p>
          </button>
          <button
            onClick={() => setSafetyPolicyMode('strict')}
            className={`panel rounded-xl p-5 text-left transition-all duration-200 active:scale-[0.99] ${
              safetyPolicyMode === 'strict' ? 'ring-2 ring-primary border-primary shadow-md' : 'hover:border-outline'
            }`}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${safetyPolicyMode === 'strict' ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant'}`}>
                <ShieldCheck className="w-4 h-4" />
              </div>
              <span className={`text-sm font-semibold ${safetyPolicyMode === 'strict' ? 'text-primary' : 'text-on-surface'}`}>{t('config.strictMode')}</span>
            </div>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              {t('config.strictModeDesc')}
            </p>
          </button>
        </div>
      </div>

      {/* OpenAI Config Form */}
      <div className={`space-y-6 transition-all duration-300 ${isOpenAI ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
        
        {/* AI Gateway Section */}
        <div className="panel rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant bg-surface-container-low flex items-center gap-3">
            <Globe className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-on-surface">{t('config.llmConfig')}</span>
          </div>
          
          <div className="p-6 space-y-5">
            {/* Base URL */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <label className="block text-sm font-label text-on-surface-variant font-medium">{t('config.baseUrl')}</label>
                <span className="text-[10px] px-1.5 py-0.5 bg-surface-container rounded text-on-surface-variant font-medium">{t('config.optional')}</span>
              </div>
              <div className="relative bg-surface-container border border-outline-variant focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all rounded-lg flex items-center px-4 py-3">
                <Server className="text-on-surface-variant mr-3 w-5 h-5 opacity-70 shrink-0" />
                <input
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="w-full bg-transparent border-none text-sm text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:ring-0 p-0 font-mono"
                  placeholder="https://your-gateway.example.com/v1"
                />
              </div>
              <p className="text-xs text-on-surface-variant flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 opacity-60" />
                {t('config.baseUrlHint')}
              </p>
            </div>

            {/* API Key */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-label text-on-surface-variant font-medium">{t('config.apiKey')}</label>
                <div className="flex items-center gap-3">
                  {config?.has_api_key && !apiKey && (
                    <span className="text-[10px] flex items-center gap-1 text-green-700 bg-green-50 px-2 py-0.5 rounded-full font-medium border border-green-200">
                      <CheckCircle2 className="w-3 h-3" /> {t('config.configured')}
                    </span>
                  )}
                  <button
                    onClick={() => setShowKey(!showKey)}
                    type="button"
                    className="text-xs text-primary hover:text-primary-container transition-colors flex items-center gap-1 font-semibold"
                  >
                    {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{showKey ? t('config.hideKey') : t('config.showKey')}</span>
                  </button>
                </div>
              </div>
              <div className="relative bg-surface-container border border-outline-variant focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all rounded-lg flex items-center px-4 py-3">
                <Key className="text-on-surface-variant mr-3 w-5 h-5 opacity-70 shrink-0" />
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full bg-transparent border-none text-sm text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:ring-0 p-0 font-mono"
                  placeholder={config?.has_api_key ? t('config.apiKeyPlaceholderExisting') : 'sk-...'}
                />
              </div>
              <p className="text-xs text-on-surface-variant flex items-start gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 opacity-60" />
                {t('config.apiKeyHint')}
              </p>
            </div>

            {/* Model */}
            <div className="space-y-2">
              <label className="block text-sm font-label text-on-surface-variant font-medium">{t('config.model')}</label>
              <div className="relative bg-surface-container border border-outline-variant focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all rounded-lg flex items-center px-4 py-3">
                <Cpu className="text-on-surface-variant mr-3 w-5 h-5 opacity-70 shrink-0" />
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full bg-transparent border-none text-sm text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:ring-0 p-0 font-mono"
                  placeholder="gpt-4o"
                />
              </div>
              <p className="text-xs text-on-surface-variant">
                {t('config.modelHint')} <code className="bg-surface-container-high px-1 py-0.5 rounded text-primary text-[11px]">gpt-4o</code>、<code className="bg-surface-container-high px-1 py-0.5 rounded text-primary text-[11px]">qwen-plus</code>、<code className="bg-surface-container-high px-1 py-0.5 rounded text-primary text-[11px]">claude-sonnet-4-20250514</code>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-6 bg-error-container text-on-error-container rounded-lg px-5 py-3.5 text-sm font-medium flex items-center gap-3 animate-in fade-in">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Save Button */}
      <div className="mt-8 flex items-center justify-end gap-4">
        {saved && (
          <span className="flex items-center gap-2 text-sm text-green-700 font-medium animate-in fade-in">
            <CheckCircle2 className="w-4 h-4" />
            {t('config.savedMsg')}
          </span>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-8 py-3 rounded-xl font-label font-semibold text-sm bg-primary text-on-primary hover:bg-primary/90 shadow-sm transition-all active:scale-[0.98] flex items-center gap-2 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? t('config.saving') : t('config.saveBtn')}
        </button>
      </div>

      {/* ====== Enterprise: Local Model Gateway ====== */}
      <div className="mt-8 panel rounded-xl overflow-hidden animate-in fade-in duration-300 border border-amber-500/20">
        <div className="px-6 py-4 border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrainCircuit className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-semibold text-on-surface">{t('config.localModelTitle')}</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/30">
              {t('config.localModelEEBadge')}
            </span>
          </div>
          {localModelChecking ? (
            <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />
          ) : localModelStatus ? (
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${localModelStatus.available ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></span>
              <span className="text-xs font-semibold text-on-surface-variant">
                {localModelStatus.available ? t('config.localModelOnline') : (localModelUrl ? t('config.localModelOffline') : t('config.localModelNotConfigured'))}
              </span>
            </div>
          ) : (
            <span className="text-xs text-on-surface-variant/50">{localModelUrl ? '—' : t('config.localModelNotConfigured')}</span>
          )}
        </div>

        <div className="p-6 space-y-6">
          <p className="text-xs text-on-surface-variant leading-relaxed">
            {t('config.localModelDesc')}
          </p>

          {/* Model URL */}
          <div className="space-y-2">
            <label className="block text-sm font-label text-on-surface-variant font-medium">{t('config.localModelUrl')}</label>
            <div className="relative bg-surface-container border border-outline-variant focus-within:border-amber-500 focus-within:ring-1 focus-within:ring-amber-500 transition-all rounded-lg flex items-center px-4 py-3">
              <Globe className="text-on-surface-variant mr-3 w-5 h-5 opacity-70 shrink-0" />
              <input
                type="text"
                value={localModelUrl}
                onChange={(e) => setLocalModelUrl(e.target.value)}
                className="w-full bg-transparent border-none text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-0 p-0 font-mono"
                placeholder={t('config.localModelUrlPlaceholder')}
              />
            </div>
            <p className="text-xs text-on-surface-variant">{t('config.localModelUrlHint')}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Model Name */}
            <div className="space-y-2">
              <label className="block text-sm font-label text-on-surface-variant font-medium">{t('config.localModelName')}</label>
              <div className="relative bg-surface-container border border-outline-variant focus-within:border-amber-500 focus-within:ring-1 focus-within:ring-amber-500 transition-all rounded-lg flex items-center px-4 py-3">
                <Cpu className="text-on-surface-variant mr-3 w-5 h-5 opacity-70 shrink-0" />
                <input
                  type="text"
                  value={localModelName}
                  onChange={(e) => setLocalModelName(e.target.value)}
                  className="w-full bg-transparent border-none text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-0 p-0 font-mono"
                  placeholder="qwen3:0.6b"
                />
              </div>
              <p className="text-xs text-on-surface-variant">{t('config.localModelNameHint')}</p>
            </div>

            {/* Timeout */}
            <div className="space-y-2">
              <label className="block text-sm font-label text-on-surface-variant font-medium">{t('config.localModelTimeout')}</label>
              <div className="relative bg-surface-container border border-outline-variant focus-within:border-amber-500 focus-within:ring-1 focus-within:ring-amber-500 transition-all rounded-lg flex items-center px-4 py-3">
                <Clock className="text-on-surface-variant mr-3 w-5 h-5 opacity-70 shrink-0" />
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="10"
                  value={localModelTimeout}
                  onChange={(e) => setLocalModelTimeout(parseFloat(e.target.value) || 2.0)}
                  className="w-full bg-transparent border-none text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-0 p-0 font-mono"
                />
              </div>
              <p className="text-xs text-on-surface-variant">{t('config.localModelTimeoutHint')}</p>
            </div>
          </div>

          {/* Test Connection + Available Models */}
          <div className="flex items-center gap-4">
            <button
              onClick={async () => {
                setLocalModelChecking(true);
                try {
                  const res = await checkLocalModel();
                  setLocalModelStatus(res);
                } catch {
                  setLocalModelStatus({ available: false, models: [], error: 'Request failed' });
                } finally {
                  setLocalModelChecking(false);
                }
              }}
              disabled={localModelChecking || !localModelUrl.trim()}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500/10 text-amber-600 border border-amber-500/30 hover:bg-amber-500/20 disabled:opacity-40 disabled:pointer-events-none transition-all flex items-center gap-1.5"
            >
              {localModelChecking ? (
                <><Loader2 className="w-3 h-3 animate-spin" /> {t('config.localModelChecking')}</>
              ) : (
                <><RefreshCw className="w-3 h-3" /> {t('config.localModelCheck')}</>
              )}
            </button>

            {localModelStatus?.available && localModelStatus.models.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-on-surface-variant font-medium">{t('config.localModelAvailableModels')}:</span>
                {localModelStatus.models.map((m) => (
                  <span key={m} className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 border border-amber-500/20">
                    {m}
                  </span>
                ))}
              </div>
            )}

            {localModelStatus && !localModelStatus.available && localModelStatus.error && (
              <span className="text-xs text-red-500">{localModelStatus.error}</span>
            )}
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
            {/* Version Information */}
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

            {/* Supported Tools */}
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

      {/* Info */}
      <div className="mt-8 panel rounded-xl p-5">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <div className="text-xs text-on-surface-variant leading-relaxed space-y-2">
            <p><strong className="text-on-surface">{t('config.securityNote')}:</strong> {t('config.securityNoteText')}</p>
            <p><strong className="text-on-surface">{t('config.compatNote')}:</strong> {t('config.compatNoteText')}</p>
          </div>
        </div>
      </div>

      {/* System Prompt Read-Only Audit Panel */}
      {provider !== 'mock' && config?.system_prompt && (
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
