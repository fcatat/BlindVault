import React, { useState, useEffect } from 'react';
import { EyeOff, Plus, Trash2, Save, Play, RefreshCw, HelpCircle, CheckCircle } from 'lucide-react';
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
  
  // 测试工具状态
  const [testText, setTestText] = useState('');
  const [testResult, setTestResult] = useState('');
  const [testMatchedCount, setTestMatchedCount] = useState(0);

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

  // 4. 实时测试功能
  useEffect(() => {
    if (!testText.trim()) {
      setTestResult('');
      setTestMatchedCount(0);
      return;
    }

    let result = testText;
    let matchedCount = 0;

    // 按字符位置逆序替换，以防替换后索引发生错乱
    interface TempMatch {
      start: number;
      end: number;
      valueStart: number;
      valueEnd: number;
      value: string;
      label: string;
    }

    const matches: TempMatch[] = [];

    // 执行前端正则解析
    patterns.forEach((p) => {
      if (!p.pattern.trim()) return;
      try {
        const regex = new RegExp(p.pattern, 'gi');
        let match;
        while ((match = regex.exec(testText)) !== null) {
          // 如果有捕获组使用组1，否则使用组0
          const fullMatch = match[0];
          let val = fullMatch;
          let valStart = match.index;
          let valEnd = match.index + fullMatch.length;

          if (match.length > 1 && match[1] !== undefined) {
            val = match[1];
            // 计算捕获组在原字符串里的偏移量
            const groupOffset = fullMatch.indexOf(val);
            if (groupOffset !== -1) {
              valStart = match.index + groupOffset;
              valEnd = valStart + val.length;
            }
          }

          if (val.trim().length >= 3) {
            // 防重复匹配相同区间
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
                label: p.label
              });
            }
          }
        }
      } catch (e) {
        // 忽略测试中编译错误的无效正则
      }
    });

    // 排序：从后往前
    matches.sort((a, b) => b.valueStart - a.valueStart);

    matches.forEach(m => {
      const placeholder = `{{secret:sec_live_${m.label || 'secret'}_***}}`;
      result = result.substring(0, m.valueStart) + placeholder + result.substring(m.valueEnd);
      matchedCount++;
    });

    setTestResult(result);
    setTestMatchedCount(matchedCount);
  }, [testText, patterns]);

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
                    {patterns.map((item, index) => (
                      <tr key={index} className="hover:bg-surface-container-lowest/40 transition-colors">
                        <td className="py-3 px-4">
                          <input
                            type="text"
                            value={item.pattern}
                            onChange={(e) => handleFieldChange(index, 'pattern', e.target.value)}
                            placeholder="e.g. (?::password|pwd)=([A-Za-z0-9]+)"
                            className="w-full bg-surface-container-low border border-outline-variant/50 focus:border-primary rounded px-3 py-1.5 font-mono text-xs text-on-surface outline-none transition-colors"
                          />
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
                            className="w-full bg-surface-container-low border border-outline-variant/50 focus:border-primary rounded px-3 py-1.5 text-xs text-on-surface outline-none transition-colors font-medium"
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
                    ))}
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

              {testText.trim() && (
                <div className="mt-5 space-y-3 animate-in fade-in duration-300">
                  <div className="flex items-center justify-between text-xs text-on-surface-variant">
                    <span>{t('rules.testResult')}</span>
                    <span className="px-2 py-0.5 rounded bg-primary-fixed/20 border border-primary-fixed-dim text-primary font-semibold font-mono text-[10px]">
                      Matched: {testMatchedCount}
                    </span>
                  </div>
                  
                  <div className="bg-surface-dim border border-outline-variant/60 rounded-xl p-4 font-mono text-[11px] text-on-surface-variant break-all whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed">
                    {testResult}
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
