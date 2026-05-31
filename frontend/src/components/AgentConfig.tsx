import React, { useState, useEffect } from 'react';
import { 
  Bot, Server, Key, Eye, EyeOff, Save, CheckCircle2, AlertTriangle, 
  Loader2, Radio, Cpu, Globe, ShieldCheck, Zap, Info
} from 'lucide-react';
import { getConfig, updateConfig, type LLMConfig } from '../api';
import { useI18n } from '../i18n';

export function AgentConfig() {
  const { t } = useI18n();
  const [config, setConfig] = useState<LLMConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // 表单状态
  const [provider, setProvider] = useState('mock');
  const [model, setModel] = useState('gpt-4o');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const cfg = await getConfig();
      setConfig(cfg);
      setProvider(cfg.llm_provider);
      setModel(cfg.llm_model);
      setBaseUrl(cfg.llm_base_url);
      setApiKey(''); // API Key 不回传
    } catch (e: any) {
      setError(e.message || t('config.fetchFailed'));
    } finally {
      setLoading(false);
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
      });
      setConfig(result);
      setApiKey('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
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
      <div className={`panel rounded-xl p-5 mb-8 flex items-center gap-4 ${
        isOpenAI && config?.has_api_key 
          ? 'border-l-4 border-l-green-500' 
          : isOpenAI 
          ? 'border-l-4 border-l-tertiary' 
          : 'border-l-4 border-l-primary'
      }`}>
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
          isOpenAI && config?.has_api_key 
            ? 'bg-green-100 text-green-700' 
            : isOpenAI 
            ? 'bg-tertiary/10 text-tertiary' 
            : 'bg-primary/10 text-primary'
        }`}>
          {isOpenAI && config?.has_api_key ? <Zap className="w-5 h-5" /> : isOpenAI ? <AlertTriangle className="w-5 h-5" /> : <Cpu className="w-5 h-5" />}
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-on-surface">
            {isOpenAI && config?.has_api_key ? t('config.connected') : isOpenAI ? t('config.needApiKey') : t('config.mockRunning')}
          </div>
          <div className="text-xs text-on-surface-variant mt-0.5">
            {isOpenAI && config?.has_api_key 
              ? `${t('config.modelLabel')}: ${config.llm_model}${config.llm_base_url ? ' | ' + t('config.gatewayLabel') + ': ' + config.llm_base_url : ''}` 
              : isOpenAI 
              ? t('config.needApiKeyDesc')
              : t('config.mockRunningDesc')}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isOpenAI && config?.has_api_key ? 'bg-green-500' : isOpenAI ? 'bg-tertiary' : 'bg-primary'} animate-pulse`}></span>
          <span className="text-xs font-mono text-on-surface-variant">
            {provider === 'mock' ? 'MOCK' : 'LLM'}
          </span>
        </div>
      </div>

      {/* Provider Toggle */}
      <div className="mb-8">
        <label className="block text-sm font-label text-on-surface-variant font-medium mb-3">{t('config.runMode')}</label>
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => setProvider('mock')}
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
            onClick={() => setProvider('openai')}
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
    </div>
  );
}
