import React, { useState, useEffect } from 'react';
import { 
  EyeOff, Plus, Trash2, Save, Play, RefreshCw, 
  HelpCircle, CheckCircle, Sparkles, X, AlertCircle, Check
} from 'lucide-react';
import { useI18n } from '../i18n';

interface PatternItem {
  pattern: string;
  secret_type: string;
  label: string;
}

export function RulesConfig() {
  const { t } = useI18n();
  const [patterns, setPatterns] = useState<PatternItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'failed'>('idle');
  
  // 匹配测试工具状态
  const [testText, setTestText] = useState('');
  const [testResult, setTestResult] = useState('');
  const [testMatchedCount, setTestMatchedCount] = useState(0);
  const [matchedIndices, setMatchedIndices] = useState<Set<number>>(new Set());
  const [matchedLabels, setMatchedLabels] = useState<string[]>([]);

  // AI 弹窗状态
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiDescription, setAiDescription] = useState('');
  const [aiSample, setAiSample] = useState('');
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiResult, setAiResult] = useState<PatternItem | null>(null);

  // 1. 获取正则规则
  const fetchPatterns = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/config/patterns');
      if (response.ok) {
        const data = await response.json();
        setPatterns(data);
      }
    } catch (error) {
      console.error('Failed to fetch patterns', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPatterns();
  }, []);

  // 2. 规则增删改
  const handleAddRule = () => {
    const newItem: PatternItem = {
      pattern: '',
      secret_type: 'password',
      label: 'new_rule'
    };
    setPatterns([...patterns, newItem]);
  };

  const handleRemoveRule = (index: number) => {
    const next = [...patterns];
    next.splice(index, 1);
    setPatterns(next);
  };

  const handleFieldChange = (index: number, field: keyof PatternItem, value: string) => {
    const next = [...patterns];
    next[index] = { ...next[index], [field]: value };
    setPatterns(next);
  };

  // 3. 保存正则规则
  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus('idle');
    try {
      const response = await fetch('/api/config/patterns', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patterns)
      });
      if (response.ok) {
        setSaveStatus('success');
        setTimeout(() => setSaveStatus('idle'), 3000);
      } else {
        const errData = await response.json();
        alert(errData.detail || t('rules.saveFailed'));
        setSaveStatus('failed');
      }
    } catch (error) {
      console.error('Save failed', error);
      setSaveStatus('failed');
    } finally {
      setIsSaving(false);
    }
  };

  // 4. 调用 AI 辅助生成接口
  const handleAiGenerate = async () => {
    if (!aiDescription.trim()) return;
    setIsAiGenerating(true);
    setAiError('');
    setAiResult(null);
    try {
      const response = await fetch('/api/config/patterns/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_description: aiDescription,
          sample_text: aiSample
        })
      });
      if (response.ok) {
        const data = await response.json();
        setAiResult(data);
      } else {
        const err = await response.json();
        setAiError(err.detail || 'AI generation failed.');
      }
    } catch (error: any) {
      setAiError(error.message || 'AI generation request failed.');
    } finally {
      setIsAiGenerating(false);
    }
  };

  // 采纳 AI 生成的规则
  const handleAdoptRule = () => {
    if (aiResult) {
      setPatterns([...patterns, { ...aiResult }]);
      setIsAiModalOpen(false);
      // 清空弹窗临时状态
      setAiDescription('');
      setAiSample('');
      setAiResult(null);
      setAiError('');
    }
  };

  // 5. 实时测试与联动高亮功能 (主面板)
  useEffect(() => {
    if (!testText.trim()) {
      setTestResult('');
      setTestMatchedCount(0);
      setMatchedIndices(new Set());
      setMatchedLabels([]);
      return;
    }

    let result = testText;
    let matchedCount = 0;
    const newMatchedIndices = new Set<number>();
    const newMatchedLabels: string[] = [];

    interface TempMatch {
      start: number;
      end: number;
      valueStart: number;
      valueEnd: number;
      value: string;
      label: string;
      ruleIndex: number;
    }

    const matches: TempMatch[] = [];

    patterns.forEach((p, idx) => {
      if (!p.pattern.trim()) return;
      try {
        const regex = new RegExp(p.pattern, 'gi');
        let match;
        while ((match = regex.exec(testText)) !== null) {
          const fullMatch = match[0];
          let val = fullMatch;
          let valStart = match.index;
          let valEnd = match.index + fullMatch.length;

          if (match.length > 1 && match[1] !== undefined) {
            val = match[1];
            const groupOffset = fullMatch.indexOf(val);
            if (groupOffset !== -1) {
              valStart = match.index + groupOffset;
              valEnd = valStart + val.length;
            }
          }

          if (val.trim().length >= 3) {
            const isOverlap = matches.some(m => 
              (valStart >= m.valueStart && valStart < m.valueEnd) ||
              (valEnd > m.valueStart && valEnd <= m.valueEnd)
            );
            if (!isOverlap) {
              matches.push({
                start: match.index,
                end: match.index + fullMatch.length,
                valueStart: valStart,
                valueEnd: valEnd,
                value: val,
                label: p.label,
                ruleIndex: idx
              });
              newMatchedIndices.add(idx);
              if (!newMatchedLabels.includes(p.label)) {
                newMatchedLabels.push(p.label);
              }
            }
          }
        }
      } catch (e) {
        // 忽略测试中无效正则
      }
    });

    matches.sort((a, b) => b.valueStart - a.valueStart);

    matches.forEach(m => {
      const placeholder = `{{secret:sec_live_${m.label || 'secret'}_***}}`;
      result = result.substring(0, m.valueStart) + placeholder + result.substring(m.valueEnd);
      matchedCount++;
    });

    setTestResult(result);
    setTestMatchedCount(matchedCount);
    setMatchedIndices(newMatchedIndices);
    setMatchedLabels(newMatchedLabels);
  }, [testText, patterns]);

  // AI 预览样本高亮渲染
  const renderAiSampleHighlight = () => {
    if (!aiSample || !aiResult || !aiResult.pattern) return aiSample;
    try {
      const regex = new RegExp(aiResult.pattern, 'gi');
      const matches: { start: number; end: number }[] = [];
      let match;
      while ((match = regex.exec(aiSample)) !== null) {
        const fullMatch = match[0];
        let valStart = match.index;
        let valEnd = match.index + fullMatch.length;

        if (match.length > 1 && match[1] !== undefined) {
          const groupOffset = fullMatch.indexOf(match[1]);
          if (groupOffset !== -1) {
            valStart = match.index + groupOffset;
            valEnd = valStart + match[1].length;
          }
        }
        matches.push({ start: valStart, end: valEnd });
      }

      if (matches.length === 0) return null;

      matches.sort((a, b) => b.start - a.start);
      const parts: React.ReactNode[] = [];
      let lastIndex = aiSample.length;

      matches.forEach((m, idx) => {
        if (lastIndex > m.end) {
          parts.push(aiSample.substring(m.end, lastIndex));
        }
        parts.push(
          <span 
            key={idx} 
            className="bg-amber-400/35 text-amber-900 border border-amber-400/50 rounded px-1 py-0.5 font-bold font-mono inline-block shrink-0"
          >
            {aiSample.substring(m.start, m.end)}
          </span>
        );
        lastIndex = m.start;
      });

      if (lastIndex > 0) {
        parts.push(aiSample.substring(0, lastIndex));
      }

      return parts.reverse();
    } catch {
      return aiSample;
    }
  };

  const hasAiMatch = () => {
    if (!aiSample || !aiResult || !aiResult.pattern) return false;
    try {
      const regex = new RegExp(aiResult.pattern, 'gi');
      return regex.test(aiSample);
    } catch {
      return false;
    }
  };

  const isTesting = testText.trim().length > 0;

  return (
    <div className="flex-1 p-6 lg:p-10 max-w-5xl mx-auto w-full animate-in slide-in-from-right-4 duration-500 overflow-y-auto pb-24">
      {/* Header */}
      <div className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-outline-variant/30 pb-6">
        <div>
          <h2 className="text-3xl font-headline font-semibold text-on-surface tracking-tight flex items-center gap-3">
            <EyeOff className="text-primary w-8 h-8" />
            {t('rules.title')}
          </h2>
          <p className="text-on-surface-variant mt-2 text-sm max-w-2xl font-body">
            {t('rules.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button 
            onClick={() => setIsAiModalOpen(true)}
            className="btn-secondary rounded-lg py-2 px-3.5 flex items-center gap-2 text-sm font-semibold cursor-pointer shadow-sm hover:scale-105 active:scale-95 transition-all bg-gradient-to-r from-violet-600/10 to-indigo-600/10 border border-indigo-500/20 text-indigo-700"
          >
            <Sparkles className="w-4 h-4 text-indigo-600" />
            {t('rules.aiBtn')}
          </button>

          <button 
            onClick={handleAddRule}
            className="btn-primary-tonal rounded-lg py-2 px-4 flex items-center gap-2 text-sm font-semibold cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            {t('rules.addRule')}
          </button>
          
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className={`btn-primary rounded-lg py-2 px-4 flex items-center gap-2 text-sm font-semibold cursor-pointer disabled:opacity-50 ${
              saveStatus === 'success' ? 'bg-green-600 hover:bg-green-700 text-white' : ''
            }`}
          >
            {isSaving ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : saveStatus === 'success' ? (
              <CheckCircle className="w-4 h-4" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {isSaving ? t('rules.saving') : saveStatus === 'success' ? t('rules.saved') : t('rules.save')}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <RefreshCw className="w-8 h-8 text-primary animate-spin" />
          <span className="text-sm text-on-surface-variant font-medium">{t('dashboard.loading')}</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          
          {/* Rules List (Left 2 columns) */}
          <div className="xl:col-span-2 space-y-4">
            <div className="glass-panel overflow-hidden border border-outline-variant/60 rounded-2xl shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="bg-surface-container-low text-on-surface font-semibold border-b border-outline-variant/40">
                      <th className="py-4 px-4 font-headline w-7/12">{t('rules.regex')}</th>
                      <th className="py-4 px-3 font-headline w-2/12">{t('rules.type')}</th>
                      <th className="py-4 px-3 font-headline w-2/12">{t('rules.label')}</th>
                      <th className="py-4 px-4 font-headline w-1/12 text-center">{t('rules.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/20">
                    {patterns.map((item, index) => {
                      const isMatched = matchedIndices.has(index);
                      return (
                        <tr 
                          key={index} 
                          className={`transition-all duration-300 ${
                            isTesting
                              ? isMatched
                                ? 'bg-green-50/50 hover:bg-green-50/80 border-l-4 border-l-green-500 shadow-sm'
                                : 'opacity-40 hover:opacity-75'
                              : 'hover:bg-surface-container-lowest/40'
                          }`}
                        >
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2 w-full">
                              {isTesting && isMatched && (
                                <span className="relative flex h-2 w-2 shrink-0">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                </span>
                              )}
                              <input
                                type="text"
                                value={item.pattern}
                                onChange={(e) => handleFieldChange(index, 'pattern', e.target.value)}
                                placeholder="e.g. (?::password|pwd)=([A-Za-z0-9]+)"
                                className="w-full bg-surface-container-low border border-outline-variant/50 focus:border-primary rounded px-3 py-1.5 font-mono text-xs text-on-surface outline-none transition-colors"
                              />
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <select
                              value={item.secret_type}
                              onChange={(e) => handleFieldChange(index, 'secret_type', e.target.value)}
                              className="bg-surface-container-low border border-outline-variant/50 focus:border-primary rounded px-2 py-1.5 text-xs text-on-surface outline-none transition-colors w-full cursor-pointer"
                            >
                              <option value="password">{t('modal.typePassword')}</option>
                              <option value="api_key">{t('modal.typeApiKey')}</option>
                              <option value="token">{t('modal.typeToken')}</option>
                              <option value="other">{t('modal.typeOther')}</option>
                            </select>
                          </td>
                          <td className="py-3 px-3">
                            <input
                              type="text"
                              value={item.label}
                              onChange={(e) => handleFieldChange(index, 'label', e.target.value)}
                              placeholder="my_password"
                              className="w-full bg-surface-container-low border border-outline-variant/50 focus:border-primary rounded px-3 py-1.5 text-xs text-on-surface outline-none transition-colors font-medium font-mono"
                            />
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button
                              onClick={() => handleRemoveRule(index)}
                              className="p-2 rounded hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors cursor-pointer"
                              title="Remove Rule"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {patterns.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-12 text-center text-on-surface-variant/70 italic bg-surface-container-lowest">
                          No active rules. Click "Add New Rule" to create one.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Info card */}
            <div className="flex gap-3 bg-surface-container-low/50 border border-outline-variant/60 rounded-xl p-4 text-xs text-on-surface-variant font-body leading-relaxed">
              <HelpCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-on-surface block mb-1">编写正则表达式提示：</span>
                1. 正则表达式中建议包含一个捕获组 <code className="bg-surface-container px-1 py-0.5 rounded font-mono text-primary font-bold">(...)</code> 来包裹密码/Token 的主体。如果包含捕获组，系统会只提取并脱敏该组内的内容，保持前缀标签等完整可识别（例如 <code className="font-mono text-tertiary">password=xxxx</code> 会变成 <code className="font-mono text-tertiary">password=&#123;&#123;secret:sec_xxx&#125;&#125;</code>）。<br />
                2. 若正则中没有捕获组，则会将整段匹配完全脱敏。
              </div>
            </div>
          </div>

          {/* Test Utility (Right column) */}
          <div className="space-y-4">
            <div className="glass-panel border border-outline-variant/60 rounded-2xl p-5 shadow-sm bg-surface-container-low">
              <h3 className="text-sm font-headline font-semibold text-on-surface mb-3 flex items-center gap-2">
                <Play className="w-4 h-4 text-primary" />
                {t('rules.testArea')}
              </h3>
              
              <textarea
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                placeholder={t('rules.testPlaceholder')}
                rows={5}
                className="w-full text-xs font-mono bg-surface-container border border-outline-variant focus:border-primary rounded-xl p-3 outline-none resize-none text-on-surface placeholder:text-on-surface-variant/40 leading-normal"
              ></textarea>

              {isTesting && (
                <div className="mt-5 space-y-3.5 animate-in fade-in duration-300">
                  <div className="flex items-center justify-between text-xs text-on-surface-variant">
                    <span>{t('rules.testResult')}</span>
                    <span className="px-2 py-0.5 rounded bg-primary-fixed/20 border border-primary-fixed-dim text-primary font-semibold font-mono text-[10px]">
                      Matched: {testMatchedCount}
                    </span>
                  </div>
                  
                  <div className="bg-surface-dim border border-outline-variant/60 rounded-xl p-4 font-mono text-[11px] text-on-surface-variant break-all whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed shadow-inner">
                    {testResult}
                  </div>

                  {/* 方案 C: 已匹配的规则列表展示 */}
                  {matchedLabels.length > 0 && (
                    <div className="pt-3 border-t border-outline-variant/20 space-y-2 animate-in fade-in duration-200">
                      <span className="text-[10px] text-on-surface-variant font-bold block uppercase tracking-wider">
                        Matched Rules:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {matchedLabels.map((lbl, idx) => (
                          <span 
                            key={idx} 
                            className="px-2 py-0.5 rounded bg-green-100 border border-green-200 text-green-800 text-[10px] font-semibold font-mono shadow-sm flex items-center gap-1.5 animate-in zoom-in-95"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                            {lbl}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* AI Regex Generator Modal */}
      {isAiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-inverse-surface/40 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="glass-panel w-full max-w-2xl bg-surface border border-outline-variant/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-300">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-outline-variant/40 flex items-center justify-between bg-surface-container-low">
              <h3 className="font-headline text-lg font-semibold text-on-surface flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600 animate-pulse" />
                {t('rules.aiModalTitle')}
              </h3>
              <button 
                onClick={() => {
                  setIsAiModalOpen(false);
                  setAiError('');
                  setAiResult(null);
                }} 
                className="p-1.5 rounded-lg hover:bg-surface-container-highest text-on-surface-variant/70 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1 font-body text-sm leading-relaxed">
              <p className="text-xs text-on-surface-variant">
                {t('rules.aiModalDesc')}
              </p>

              {/* Description Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-on-surface uppercase tracking-wider block">
                  {t('rules.aiDescLabel')}
                </label>
                <input
                  type="text"
                  value={aiDescription}
                  onChange={(e) => setAiDescription(e.target.value)}
                  placeholder={t('rules.aiDescPlaceholder')}
                  className="w-full bg-surface-container-low border border-outline-variant focus:border-primary rounded-xl px-4 py-2.5 outline-none transition-colors"
                />
              </div>

              {/* Sample Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-on-surface uppercase tracking-wider block">
                  {t('rules.aiSampleLabel')}
                </label>
                <textarea
                  value={aiSample}
                  onChange={(e) => setAiSample(e.target.value)}
                  placeholder={t('rules.aiSamplePlaceholder')}
                  rows={2}
                  className="w-full bg-surface-container-low border border-outline-variant focus:border-primary rounded-xl p-3 outline-none resize-none font-mono text-xs leading-normal"
                ></textarea>
              </div>

              {/* Gen button and error messages */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={handleAiGenerate}
                  disabled={isAiGenerating || !aiDescription.trim()}
                  className="btn-primary rounded-lg py-2.5 px-5 flex items-center gap-2 text-sm font-semibold cursor-pointer disabled:opacity-50 bg-gradient-to-r from-violet-600 to-indigo-600 text-white"
                >
                  {isAiGenerating ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  {isAiGenerating ? t('rules.aiGenerating') : t('rules.aiGenBtn')}
                </button>
              </div>

              {aiError && (
                <div className="flex gap-2.5 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl p-3.5 font-mono leading-relaxed">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                  <span>{aiError}</span>
                </div>
              )}

              {/* Results visualization */}
              {aiResult && (
                <div className="border border-outline-variant/60 rounded-xl p-5 bg-surface-container-low space-y-4 animate-in fade-in duration-300">
                  <h4 className="font-headline font-bold text-on-surface border-b border-outline-variant/20 pb-2 text-xs uppercase tracking-wider">
                    {t('rules.aiResultTitle')}
                  </h4>
                  
                  {/* Fields editing inside Modal */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="sm:col-span-2 space-y-1">
                      <span className="text-[10px] text-on-surface-variant font-bold block uppercase">{t('rules.regex')}</span>
                      <input
                        type="text"
                        value={aiResult.pattern}
                        onChange={(e) => setAiResult({ ...aiResult, pattern: e.target.value })}
                        className="w-full bg-surface-container border border-outline-variant/80 focus:border-primary rounded px-3 py-1.5 font-mono text-xs text-on-surface outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] text-on-surface-variant font-bold block uppercase">{t('rules.type')}</span>
                      <select
                        value={aiResult.secret_type}
                        onChange={(e) => setAiResult({ ...aiResult, secret_type: e.target.value })}
                        className="w-full bg-surface-container border border-outline-variant/80 focus:border-primary rounded px-2 py-1.5 text-xs text-on-surface outline-none cursor-pointer"
                      >
                        <option value="password">{t('modal.typePassword')}</option>
                        <option value="api_key">{t('modal.typeApiKey')}</option>
                        <option value="token">{t('modal.typeToken')}</option>
                        <option value="other">{t('modal.typeOther')}</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <span className="text-[10px] text-on-surface-variant font-bold block uppercase">{t('rules.label')}</span>
                      <input
                        type="text"
                        value={aiResult.label}
                        onChange={(e) => setAiResult({ ...aiResult, label: e.target.value })}
                        className="w-full bg-surface-container border border-outline-variant/80 focus:border-primary rounded px-3 py-1.5 font-mono text-xs text-on-surface outline-none font-semibold font-mono"
                      />
                    </div>
                  </div>

                  {/* Verification rendering inside Modal */}
                  {aiSample && (
                    <div className="border-t border-outline-variant/20 pt-4 space-y-2">
                      <h4 className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider flex justify-between items-center">
                        <span>{t('rules.aiVerifyTitle')}</span>
                        {hasAiMatch() ? (
                          <span className="text-green-700 flex items-center gap-1 font-semibold text-[9px] bg-green-100 border border-green-200 px-1.5 py-0.5 rounded uppercase">
                            <Check className="w-3 h-3" /> {t('rules.aiVerifySuccess')}
                          </span>
                        ) : (
                          <span className="text-red-700 flex items-center gap-1 font-semibold text-[9px] bg-red-100 border border-red-200 px-1.5 py-0.5 rounded uppercase">
                            <AlertCircle className="w-3 h-3" /> No Matches
                          </span>
                        )}
                      </h4>
                      
                      <div className="bg-surface border border-outline-variant/50 rounded-lg p-3 font-mono text-xs text-on-surface break-all min-h-12 flex items-center flex-wrap gap-1 leading-relaxed shadow-inner">
                        {hasAiMatch() ? (
                          renderAiSampleHighlight()
                        ) : (
                          <span className="text-on-surface-variant italic opacity-60 text-[11px] block py-1.5 w-full">
                            {t('rules.aiVerifyNoMatch')}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Adopt button */}
                  <div className="flex justify-end pt-2">
                    <button
                      onClick={handleAdoptRule}
                      className="btn-primary rounded-lg py-2 px-4 flex items-center gap-2 text-xs font-bold cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white shadow"
                    >
                      <Check className="w-4 h-4" />
                      {t('rules.aiAdoptBtn')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
