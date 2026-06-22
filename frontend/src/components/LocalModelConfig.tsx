import React, { useState, useEffect } from 'react';
import { 
  Cpu, Globe, Clock, RefreshCw, Loader2, Save, CheckCircle2, AlertTriangle, BrainCircuit, ChevronDown, ChevronUp, Sliders, ToggleLeft, ToggleRight, Lock, Sparkles
} from 'lucide-react';
import { getLocalModelConfig, updateLocalModelConfig, checkLocalModel } from '../agentApi';
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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // 展开折叠状态
  const [showAdvanced, setShowAdvanced] = useState(false);

  // 配置状态
  const [isEE, setIsEE] = useState(false);
  const [localModelUrl, setLocalModelUrl] = useState('');
  const [localModelName, setLocalModelName] = useState('qwen3:0.6b');
  const [localModelTimeout, setLocalModelTimeout] = useState(2.0);
  const [localModelApiType, setLocalModelApiType] = useState('ollama');
  const [localModelPrompt, setLocalModelPrompt] = useState(DEFAULT_LOCAL_PROMPT);
  const [localModelDisableCot, setLocalModelDisableCot] = useState(true);

  // 连通性测试状态
  const [localModelStatus, setLocalModelStatus] = useState<any>(null);
  const [localModelChecking, setLocalModelChecking] = useState(false);

  useEffect(() => {
    setLoading(true);
    getLocalModelConfig().then((data) => {
      setIsEE(data.is_ee);
      if (data.url) setLocalModelUrl(data.url);
      if (data.model_name) setLocalModelName(data.model_name);
      if (data.api_type) setLocalModelApiType(data.api_type);
      if (data.timeout) setLocalModelTimeout(data.timeout);
      if (data.prompt) setLocalModelPrompt(data.prompt);
      if (data.disable_cot !== undefined) setLocalModelDisableCot(data.disable_cot);
      setLoading(false);

      // 页面加载后自动检测连通性
      if (data.url) {
        setLocalModelChecking(true);
        checkLocalModel({
          url: data.url,
          api_type: data.api_type || 'ollama',
          model_name: data.model_name || '',
          timeout: data.timeout || 2.0,
        })
          .then((res: any) => setLocalModelStatus(res))
          .catch(() => setLocalModelStatus({ available: false, models: [], error: t('config.networkError') }))
          .finally(() => setLocalModelChecking(false));
      }
    }).catch((e) => {
      setError(e.message || 'Failed to load config');
      setLoading(false);
    });
  }, []);


  const handleSave = async () => {
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      await updateLocalModelConfig({
        local_model_url: localModelUrl.trim(),
        local_model_name: localModelName.trim(),
        local_model_api_type: localModelApiType,
        local_model_timeout: localModelTimeout,
        local_model_prompt: localModelPrompt,
        local_model_disable_cot: localModelDisableCot,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);

      if (localModelUrl.trim()) {
        checkLocalModel({
          url: localModelUrl.trim(),
          api_type: localModelApiType,
          model_name: localModelName.trim(),
          timeout: localModelTimeout
        })
          .then((res: any) => setLocalModelStatus(res))
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

      {/* 升级提示 (如果没有 EE) */}
      {!isEE ? (
        <div className="panel rounded-xl p-8 mb-8 text-center flex flex-col items-center justify-center border border-amber-500/20 bg-amber-500/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>
          <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-4 border border-amber-500/20">
            <Lock className="w-8 h-8 text-amber-500" />
          </div>
          <h2 className="text-xl font-bold text-on-surface mb-2">{t('config.localModelLockedTitle') || '升级 EE 解锁本地模型语义脱敏'}</h2>
          <p className="text-sm text-on-surface-variant max-w-lg mx-auto mb-6">
            {t('config.localModelLockedDesc') || '基础版仅支持正则表达式脱敏。启用企业版 (EE) License 后，您可接入本地部署的大语言模型（如 Ollama + Qwen），实现基于上下文的高级语义脱敏，在零数据泄露的情况下识别变体凭证。'}
          </p>
          <button className="px-6 py-2.5 rounded-lg bg-amber-500 text-white font-semibold shadow-sm hover:bg-amber-600 transition-colors pointer-events-none opacity-80">
            {t('config.contactSales') || '联系获取 License'}
          </button>
        </div>
      ) : (
        <>
          {/* License Active Banner */}
          <div className="bg-[#FAF6F0] dark:bg-amber-900/10 border border-amber-500/20 rounded-xl p-5 mb-8 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-[#E8F5E9] dark:bg-green-900/20 flex items-center justify-center text-green-600 border border-transparent">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <div className="text-base font-bold text-gray-900 dark:text-white">企业许可生效中</div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">商业特许 License 状态：正常校验</div>
              </div>
            </div>
            <div className="px-3 py-1.5 bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/30 rounded-lg flex items-center gap-1.5 text-xs font-bold tracking-wide">
              <Sparkles className="w-4 h-4" />
              ENTERPRISE PRO
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
                      const res = await checkLocalModel({
                        url: localModelUrl, 
                        api_type: localModelApiType, 
                        model_name: localModelName,
                        timeout: localModelTimeout
                      });
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

                {localModelStatus?.available && localModelStatus.models?.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-on-surface-variant font-medium">{t('config.localModelAvailableModels')}:</span>
                    {localModelStatus.models.map((m: string) => (
                      <span key={m} className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 border border-amber-500/20">
                        {m}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

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
