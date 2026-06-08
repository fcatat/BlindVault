import React, { useState, useEffect } from 'react';
import { 
  Cpu, Globe, Clock, RefreshCw, Loader2, Save, CheckCircle2, AlertTriangle, BrainCircuit, ChevronDown, ChevronUp, Sliders, ToggleLeft, ToggleRight, FileText
} from 'lucide-react';
import { getConfig, updateConfig, checkLocalModel, type LocalModelStatus } from '../api';
import { useI18n } from '../i18n';

const DEFAULT_LOCAL_PROMPT = `你是一个安全信息提取器。分析用户输入，精确识别其中的敏感凭证信息。

敏感信息类型包括：
- password: 登录密码、口令、passphrase
- api_key: API 密钥（sk-xxx, token, bearer 等）
- private_key: SSH 私钥、证书密钥
- connection_string: 包含凭证的数据库连接串（postgresql://user:PASS@host）

规则：
1. 仅提取真正的凭证值，不要提取用户名、IP 地址、端口号等非密码信息
2. 如果无法确定是否为敏感信息，不要提取（宁可漏过，不可误判）
3. 仅返回 JSON 数组，不要输出任何其他文字
4. 不要用 markdown 代码块包裹，直接返回 JSON

输出格式：
[{"value": "实际的敏感值", "type": "password|api_key|private_key|connection_string", "label": "简短描述"}]

如果没有敏感信息，返回：[]`;

export function LocalModelConfig() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // 展开折叠状态
  const [showAdvanced, setShowAdvanced] = useState(false);

  // 配置状态
  const [localModelUrl, setLocalModelUrl] = useState('');
  const [localModelName, setLocalModelName] = useState('qwen3:0.6b');
  const [localModelTimeout, setLocalModelTimeout] = useState(2.0);
  const [localModelApiType, setLocalModelApiType] = useState('ollama');
  const [localModelPrompt, setLocalModelPrompt] = useState('');
  const [localModelDisableCot, setLocalModelDisableCot] = useState(true);

  // 连通性测试状态
  const [localModelStatus, setLocalModelStatus] = useState<LocalModelStatus | null>(null);
  const [localModelChecking, setLocalModelChecking] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const cfg = await getConfig();
      const url = cfg.local_model_url || '';
      const name = cfg.local_model_name || 'qwen3:0.6b';
      const apiType = cfg.local_model_api_type || 'ollama';

      setLocalModelUrl(url);
      setLocalModelName(name);
      setLocalModelTimeout(cfg.local_model_timeout || 2.0);
      setLocalModelApiType(apiType);
      setLocalModelPrompt(cfg.local_model_prompt || DEFAULT_LOCAL_PROMPT);
      setLocalModelDisableCot(cfg.local_model_disable_cot !== undefined ? cfg.local_model_disable_cot : true);

      // 如果已配置模型服务地址，在挂载或切回页面时自动触发后台测活，避免挂起在“正在验证连接...”
      if (url.trim()) {
        checkLocalModel(url.trim(), apiType, name.trim())
          .then((res) => setLocalModelStatus(res))
          .catch(() => setLocalModelStatus({ available: false, models: [], error: t('config.networkError') }));
      }
    } catch (e: any) {
      setError(e.message || t('config.fetchFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const current = await getConfig();
      const result = await updateConfig({
        llm_provider: current.llm_provider,
        llm_model: current.llm_model,
        llm_base_url: current.llm_base_url,
        llm_api_key: '', // 空串表示不修改 API Key
        safety_policy_mode: current.safety_policy_mode,
        local_model_url: localModelUrl.trim(),
        local_model_name: localModelName.trim(),
        local_model_timeout: localModelTimeout,
        local_model_api_type: localModelApiType,
        local_model_prompt: localModelPrompt.trim(),
        local_model_disable_cot: localModelDisableCot,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);

      // 保存配置后立即触发连通性刷新
      if (localModelUrl.trim()) {
        checkLocalModel(localModelUrl.trim(), localModelApiType, localModelName.trim())
          .then((res) => setLocalModelStatus(res))
          .catch(() => setLocalModelStatus({ available: false, models: [], error: t('config.networkError') }));
      } else {
        setLocalModelStatus(null);
      }
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

  return (
    <div className="p-6 lg:p-10 max-w-4xl mx-auto w-full animate-in fade-in duration-500">
      
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-3">
          <div className="h-12 w-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
            <BrainCircuit className="text-amber-500 w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-headline font-bold text-on-surface tracking-tight">
              {t('config.localModelTitle')}
            </h1>
            <p className="text-on-surface-variant text-sm mt-1">
              {t('config.localModelDesc')}
            </p>
          </div>
        </div>
      </div>

      {/* Connection Status Panel */}
      {(() => {
        let borderColor = 'border-l-4 border-l-gray-300';
        let iconBg = 'bg-gray-100 text-gray-500';
        let title = t('config.localModelNotConfigured');
        let desc = t('config.localModelUrlHint');

        if (localModelStatus) {
          if (localModelStatus.available) {
            borderColor = 'border-l-4 border-l-green-500';
            iconBg = 'bg-green-500/10 text-green-700';
            title = t('config.localModelOnline');
            desc = `${t('config.modelLabel')}: ${localModelName}`;
          } else {
            borderColor = 'border-l-4 border-l-red-500';
            iconBg = 'bg-red-500/10 text-red-700';
            title = t('config.localModelOffline');
            desc = localModelStatus.error || t('config.networkError');
          }
        } else if (localModelUrl) {
          borderColor = 'border-l-4 border-l-amber-500';
          iconBg = 'bg-amber-500/10 text-amber-700';
          title = t('config.configured');
          desc = t('config.checkingConnection');
        }

        return (
          <div className={`panel rounded-xl p-5 mb-8 flex items-center gap-4 ${borderColor} transition-colors duration-300`}>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${iconBg}`}>
              <Cpu className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-on-surface">
                {title}
              </div>
              <div className="text-xs mt-0.5 text-on-surface-variant">
                {desc}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Main Configuration Card */}
      <div className="panel rounded-xl overflow-hidden border border-amber-500/20">
        <div className="px-6 py-4 border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrainCircuit className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-semibold text-on-surface">{t('config.localModelSettings')}</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/30">
              {t('config.localModelEEBadge')}
            </span>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <p className="text-xs text-on-surface-variant leading-relaxed">
            {t('config.localModelSettingsDesc')}
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

          {/* ====== 折叠的高级选项折叠面板 ====== */}
          <div className="border border-outline-variant/60 rounded-lg overflow-hidden bg-surface-container/10">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full px-5 py-3.5 flex items-center justify-between text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high transition-all"
            >
              <div className="flex items-center gap-2">
                <Sliders className="w-3.5 h-3.5 text-amber-500" />
                <span>{t('config.localModelAdvanced')}</span>
              </div>
              {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showAdvanced && (
              <div className="p-5 border-t border-outline-variant/60 space-y-5 bg-surface-container-low/40 animate-in slide-in-from-top-2 duration-200">
                
                {/* 1. API 协议类型 */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-on-surface-variant">{t('config.localModelApiType')}</label>
                  <select
                    value={localModelApiType}
                    onChange={(e) => setLocalModelApiType(e.target.value)}
                    className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2.5 text-xs text-on-surface font-sans focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all"
                  >
                    <option value="ollama">Ollama Chat (/api/chat)</option>
                    <option value="openai">OpenAI 兼容 (/v1/chat/completions)</option>
                    <option value="custom_fastapi">FastAPI 独立格式 (/api/v1/chat)</option>
                  </select>
                </div>

                {/* 2. 禁用思考 CoT 开关 */}
                <div className="flex items-start justify-between gap-4 p-3.5 bg-amber-500/[0.03] border border-amber-500/10 rounded-lg">
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-on-surface">{t('config.localModelDisableCot')}</label>
                    <span className="block text-[11px] text-on-surface-variant leading-relaxed">
                      {t('config.localModelDisableCotHint')}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLocalModelDisableCot(!localModelDisableCot)}
                    className="text-amber-500 focus:outline-none"
                  >
                    {localModelDisableCot ? (
                      <ToggleRight className="w-10 h-6 shrink-0" />
                    ) : (
                      <ToggleLeft className="w-10 h-6 shrink-0 text-on-surface-variant/40" />
                    )}
                  </button>
                </div>

                {/* 3. 自定义 System Prompt */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-on-surface-variant">{t('config.localModelPromptLabel')}</label>
                    {localModelPrompt !== DEFAULT_LOCAL_PROMPT && (
                      <button
                        type="button"
                        onClick={() => setLocalModelPrompt(DEFAULT_LOCAL_PROMPT)}
                        className="text-[10px] text-amber-600 hover:underline font-medium"
                      >
                        重置默认 Prompt
                      </button>
                    )}
                  </div>
                  <textarea
                    rows={6}
                    value={localModelPrompt}
                    onChange={(e) => setLocalModelPrompt(e.target.value)}
                    className="w-full bg-surface-container border border-outline-variant rounded-lg p-3 text-xs font-mono text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all leading-relaxed"
                    placeholder="你是一个安全信息提取器。分析用户输入，精确识别其中的敏感凭证信息..."
                  />
                  <p className="text-[10px] text-on-surface-variant leading-normal">
                    {t('config.localModelPromptHint')}
                  </p>
                </div>

              </div>
            )}
          </div>

          {/* Test Connection + Available Models */}
          <div className="flex items-center gap-4 pt-2">
            <button
              onClick={async () => {
                setLocalModelChecking(true);
                try {
                  // 在不保存配置的情况下，直接把当前输入的 url、api_type 和 model_name 传给测试接口
                  const res = await checkLocalModel(localModelUrl, localModelApiType, localModelName);
                  setLocalModelStatus(res);
                } catch {
                  setLocalModelStatus({ available: false, models: [], error: t('config.networkError') });
                } finally {
                  setLocalModelChecking(false);
                }
              }}
              disabled={localModelChecking || !localModelUrl.trim()}
              className="px-4 py-2.5 rounded-lg text-xs font-semibold bg-amber-500/10 text-amber-600 border border-amber-500/30 hover:bg-amber-500/20 disabled:opacity-40 disabled:pointer-events-none transition-all flex items-center gap-1.5"
            >
              {localModelChecking ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('config.localModelChecking')}</>
              ) : (
                <><RefreshCw className="w-3.5 h-3.5" /> {t('config.localModelCheck')}</>
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
          </div>
        </div>
      </div>

      {/* Error Alert */}
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
            {t('config.localModelSaveSuccess')}
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
    </div>
  );
}
