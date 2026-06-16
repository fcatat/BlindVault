import React, { useState, useEffect } from 'react';
import { ShieldCheck, Info, RefreshCw, Plus, Trash2, Edit2, Play, Check, AlertTriangle, Save } from 'lucide-react';
import { useI18n } from '../i18n';
import { listRules, createRule, updateRule, deleteRule, restoreDefaults, aiSuggestRule, testRule, SanitizeRule } from '../agentApi';

export function RulesConfig() {
  const { t } = useI18n();
  const [rules, setRules] = useState<SanitizeRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean; message: string; isDanger: boolean; onConfirm: () => void } | null>(null);

  const [globalTestText, setGlobalTestText] = useState('');
  const [globalTestHits, setGlobalTestHits] = useState<{ rule: SanitizeRule; matches: any[] }[] | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const fetchRules = async () => {
    setIsLoading(true);
    try {
      const data = await listRules();
      setRules(data);
      if (data.length > 0 && !selectedRuleId) {
        setSelectedRuleId(data[0].id);
      }
    } catch (error) {
      console.error('Failed to fetch sanitize rules', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, []);

  const handleRestore = async () => {
    setConfirmDialog({
      isOpen: true,
      message: t('rules.restoreDefaults') + '?',
      isDanger: false,
      onConfirm: async () => {
        await restoreDefaults();
        fetchRules();
      }
    });
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDialog({
      isOpen: true,
      message: t('rules.confirmDelete'),
      isDanger: true,
      onConfirm: async () => {
        await deleteRule(id);
        if (selectedRuleId === id) setSelectedRuleId(null);
        fetchRules();
      }
    });
  };

  const handleToggleEnable = async (rule: SanitizeRule, e: React.MouseEvent) => {
    e.stopPropagation();
    await updateRule(rule.id, { enabled: !rule.enabled });
    fetchRules();
  };

  const handleGlobalTest = async () => {
    if (!globalTestText.trim()) {
      setGlobalTestHits(null);
      return;
    }
    setIsTesting(true);
    setGlobalTestHits(null);
    const enabledRules = rules.filter(r => r.enabled);
    try {
      const results = await Promise.all(enabledRules.map(async r => {
        try {
          const res = await testRule(r.pattern, r.capture_group, globalTestText);
          return { rule: r, matches: res.matches };
        } catch (e) {
          return { rule: r, matches: [] };
        }
      }));
      const hits = results.filter(r => r.matches && r.matches.length > 0);
      setGlobalTestHits(hits);
    } catch (e) {
      console.error(e);
    } finally {
      setIsTesting(false);
    }
  };

  const matchedRuleIds = globalTestHits ? globalTestHits.map(h => h.rule.id) : [];

  const selectedRule = rules.find(r => r.id === selectedRuleId);

  const getRuleName = (rule: SanitizeRule) => {
    if (rule.is_builtin) {
      const key = `ruleName.${rule.label}` as any;
      const translated = t(key);
      return translated !== key ? translated : rule.name;
    }
    return rule.name;
  };

  return (
    <div className="flex-1 p-6 lg:p-10 max-w-7xl mx-auto w-full animate-in slide-in-from-right-4 duration-500 overflow-y-auto pb-24">
      {/* Top Banner */}
      <div className="mb-4 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-400 p-3 rounded-lg flex items-center gap-2 border border-amber-200 dark:border-amber-800/30">
        <AlertTriangle className="w-4 h-4" />
        <span className="text-sm font-medium">{t('rules.changesNewSession')}</span>
      </div>

      <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-outline-variant/30 pb-6">
        <div>
          <h2 className="text-3xl font-headline font-semibold text-on-surface tracking-tight flex items-center gap-3">
            <ShieldCheck className="text-primary w-8 h-8" />
            {t('rules.title')}
          </h2>
          <p className="text-on-surface-variant mt-2 text-sm max-w-2xl font-body">
            {t('rules.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleRestore}
            className="btn-secondary rounded py-2 px-4 flex items-center justify-center gap-2 text-sm font-semibold whitespace-nowrap"
          >
            <RefreshCw className="w-4 h-4" />
            {t('rules.restoreDefaults')}
          </button>
          <button 
            onClick={() => setWizardOpen(true)}
            className="btn-primary rounded py-2 px-4 flex items-center justify-center gap-2 text-sm font-semibold whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            {t('rules.newRule')}
          </button>
        </div>
      </div>

      {/* Global Test Area */}
      <div className="mb-6 bg-surface border border-outline-variant/60 rounded-2xl shadow-sm p-6 animate-in fade-in duration-300">
        <div className="flex items-center gap-2 mb-3">
          <Play className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-lg text-on-surface">{t('rules.globalTestTitle')}</h3>
          <span className="text-xs text-on-surface-variant font-medium ml-2 border border-outline-variant/50 px-2 py-0.5 rounded-full">
            {t('rules.globalTestSubtitle')}
          </span>
        </div>
        <textarea 
          className="w-full bg-surface-container-lowest border border-outline-variant/50 rounded-lg p-3 font-mono text-sm text-on-surface min-h-[80px] focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary mb-3 transition-shadow"
          placeholder={t('rules.globalTestPlaceholder')}
          value={globalTestText}
          onChange={e => setGlobalTestText(e.target.value)}
        />
        <button 
          onClick={handleGlobalTest} 
          disabled={isTesting || !globalTestText.trim()}
          className="btn-secondary px-5 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 mb-4 disabled:opacity-50"
        >
          {isTesting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {isTesting ? t('rules.testing') : t('rules.testMatch')}
        </button>

        {globalTestHits && (
          <div className="bg-surface-container-low border border-outline-variant/40 rounded-lg p-4 transition-all">
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              {t('rules.hitResults')}
              <span className={`px-2 py-0.5 rounded-full text-xs text-white ${globalTestHits.length > 0 ? 'bg-green-500' : 'bg-on-surface-variant'}`}>
                {globalTestHits.length} {t('rules.hitCount')}
              </span>
            </h4>
            {globalTestHits.length > 0 ? (
              <div className="space-y-3">
                {globalTestHits.map(hit => (
                  <div key={hit.rule.id} className="text-sm bg-surface rounded-lg p-3 border border-outline-variant/30 shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-semibold text-primary">{getRuleName(hit.rule)}</span>
                      <span className="text-xs text-on-surface-variant font-mono bg-surface-container px-1.5 py-0.5 rounded">{hit.rule.label}</span>
                    </div>
                    {hit.matches.map((m, i) => (
                      <div key={i} className="font-mono text-xs text-on-surface bg-surface-container-lowest p-2 rounded border border-outline-variant/20 mb-1">
                        Found [{m.start}-{m.end}]: <span className="text-red-500 font-bold bg-red-500/10 px-1 rounded">{m.value}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-on-surface-variant italic">{t('rules.noHits')}</div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* Left List */}
        <div className="w-full md:w-1/3 flex flex-col gap-3">
          {isLoading ? (
            <div className="flex justify-center p-10"><RefreshCw className="w-6 h-6 animate-spin text-primary" /></div>
          ) : rules.length === 0 ? (
            <div className="text-center p-10 bg-surface-container-low rounded-xl text-on-surface-variant text-sm">{t('rules.noRules')}</div>
          ) : (
            rules.map(rule => {
              const isMatched = matchedRuleIds.includes(rule.id);
              const isSelected = selectedRuleId === rule.id;
              
              return (
              <div 
                key={rule.id}
                onClick={() => setSelectedRuleId(rule.id)}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  isMatched ? 'border-amber-500 bg-amber-500/5 shadow-md shadow-amber-500/10 ring-1 ring-amber-500' :
                  isSelected ? 'border-primary bg-primary/5 shadow-sm' : 
                  'border-outline-variant/50 hover:bg-surface-container-low'
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="font-semibold text-on-surface truncate pr-2 flex items-center gap-2">
                    {getRuleName(rule)}
                    {isMatched && <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" title="已命中"></span>}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={(e) => handleToggleEnable(rule, e)} className={`text-xs px-2 py-0.5 rounded ${rule.enabled ? 'bg-green-100 text-green-700' : 'bg-surface-container-highest text-on-surface-variant'}`}>
                      {rule.enabled ? t('rules.enable') : t('rules.disable')}
                    </button>
                    <button onClick={(e) => handleDelete(rule.id, e)} className="p-1 text-on-surface-variant hover:text-red-500 rounded hover:bg-surface-container-highest">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {rule.is_builtin ? (
                    <span className="text-[10px] bg-surface-container-high text-on-surface-variant px-1.5 py-0.5 rounded uppercase tracking-wider">{t('rules.builtin')}</span>
                  ) : (
                    <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded uppercase tracking-wider">{t('rules.custom')}</span>
                  )}
                  <span className="text-xs text-on-surface-variant truncate font-mono">{rule.label}</span>
                </div>
              </div>
            )})
          )}
        </div>

        {/* Right Editor/Details */}
        <div className="w-full md:w-2/3">
          {selectedRule ? (
            <RuleEditor rule={selectedRule} onUpdate={fetchRules} />
          ) : (
            <div className="h-64 flex items-center justify-center border border-dashed border-outline-variant rounded-2xl text-on-surface-variant bg-surface-container-lowest/50">
              {t('rules.selectRule')}
            </div>
          )}
        </div>
      </div>

      {wizardOpen && (
        <RuleWizardModal onClose={() => setWizardOpen(false)} onComplete={() => { setWizardOpen(false); fetchRules(); }} />
      )}

      {confirmDialog?.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-surface w-full max-w-sm rounded-2xl shadow-xl border border-outline-variant/30 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-on-surface mb-2">{t('rules.confirmAction')}</h3>
              <p className="text-sm text-on-surface-variant">{confirmDialog.message}</p>
            </div>
            <div className="px-6 py-4 bg-surface-container-low flex justify-end gap-3 border-t border-outline-variant/30">
              <button 
                onClick={() => setConfirmDialog({ ...confirmDialog, isOpen: false })} 
                className="px-4 py-2 text-sm font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest rounded-lg transition-colors"
              >
                {t('rules.cancel')}
              </button>
              <button 
                onClick={() => { confirmDialog.onConfirm(); setConfirmDialog({ ...confirmDialog, isOpen: false }); }} 
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors shadow-sm ${confirmDialog.isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary/90'}`}
              >
                {t('rules.confirmOk')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RuleEditor({ rule, onUpdate }: { rule: SanitizeRule, onUpdate: () => void }) {
  const { t } = useI18n();
  const [pattern, setPattern] = useState(rule.pattern);
  const [captureGroup, setCaptureGroup] = useState(rule.capture_group);
  
  useEffect(() => {
    setPattern(rule.pattern);
    setCaptureGroup(rule.capture_group);
  }, [rule]);

  const handleSave = async () => {
    try {
      await updateRule(rule.id, { pattern, capture_group: captureGroup });
      onUpdate();
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="bg-surface border border-outline-variant/60 rounded-2xl shadow-sm p-6 space-y-5">
      <div className="flex justify-between items-center border-b border-outline-variant/30 pb-4">
        <h3 className="font-headline font-semibold text-lg">
          {rule.is_builtin ? (t(`ruleName.${rule.label}` as any) !== `ruleName.${rule.label}` ? t(`ruleName.${rule.label}` as any) : rule.name) : rule.name}
        </h3>
        <span className="font-mono text-xs text-primary bg-primary/10 px-2 py-1 rounded">{rule.secret_type}</span>
      </div>

      <div>
        <label className="block text-sm font-semibold text-on-surface mb-2">{t('rules.regex')}</label>
        <textarea 
          className="w-full bg-surface-container-low border border-outline-variant/50 rounded-lg p-3 font-mono text-sm text-on-surface min-h-[100px] focus:outline-none focus:border-primary"
          value={pattern}
          onChange={e => setPattern(e.target.value)}
        />
      </div>
      
      <div className="flex gap-4 items-center border-b border-outline-variant/30 pb-6">
        <label className="text-sm font-semibold text-on-surface">{t('rules.wizardCaptureGroup')}:</label>
        <input 
          type="number"
          className="w-24 bg-surface-container-low border border-outline-variant/50 rounded-lg p-2 font-mono text-sm focus:outline-none focus:border-primary"
          value={captureGroup}
          onChange={e => setCaptureGroup(parseInt(e.target.value) || 0)}
        />
      </div>

      <div className="pt-2 flex justify-between items-center">
        <div className="text-xs text-on-surface-variant flex items-center gap-1">
          {rule.is_builtin ? <Info className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
          {rule.is_builtin ? t('rules.builtinWarning') : t('rules.customWarning')}
        </div>
        <button onClick={handleSave} className="btn-primary px-5 py-2 rounded font-semibold text-sm flex items-center gap-2">
          <Save className="w-4 h-4" /> {t('rules.save')}
        </button>
      </div>
    </div>
  );
}

function RuleWizardModal({ onClose, onComplete }: { onClose: () => void, onComplete: () => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState(1);
  const [samples, setSamples] = useState('');
  const [description, setDescription] = useState('');
  
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [suggestedRule, setSuggestedRule] = useState<any>(null);

  const [testText, setTestText] = useState('');
  const [testResult, setTestResult] = useState<any[] | null>(null);

  const handleSuggest = async () => {
    setAiLoading(true);
    setAiError('');
    try {
      const res = await aiSuggestRule(samples.split('\n').filter(s => s.trim()), description);
      setSuggestedRule(res);
      setTestText(samples); // preset test text
      setStep(3); // go to step 3 directly
    } catch (err: any) {
      setAiError(err.message);
    } finally {
      setAiLoading(false);
    }
  };

  const handleTest = async () => {
    try {
      const res = await testRule(suggestedRule.pattern, suggestedRule.capture_group, testText);
      setTestResult(res.matches);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleSave = async () => {
    try {
      await createRule({
        name: suggestedRule.label || 'Custom Rule',
        pattern: suggestedRule.pattern,
        secret_type: suggestedRule.secret_type || 'password',
        label: suggestedRule.label || 'custom_rule',
        capture_group: suggestedRule.capture_group || 0,
        enabled: true
      });
      onComplete();
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface w-full max-w-2xl rounded-2xl shadow-xl border border-outline-variant/30 flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-outline-variant/30 flex justify-between items-center">
          <h2 className="text-xl font-headline font-semibold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" /> {t('rules.aiModalTitle')}
          </h2>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface text-2xl leading-none">&times;</button>
        </div>
        
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Step 1 */}
          <div className={`transition-opacity ${step >= 1 ? 'opacity-100' : 'opacity-30'}`}>
            <h3 className="font-semibold text-lg mb-2">{t('rules.wizardStep1')}</h3>
            <p className="text-sm text-on-surface-variant mb-4">{t('rules.wizardSamplesDesc')}</p>
            
            <label className="block text-sm font-medium mb-1">{t('rules.aiSampleLabel')}</label>
            <textarea 
              className="w-full bg-surface-container-low border border-outline-variant/50 rounded-lg p-3 font-mono text-sm focus:outline-none focus:border-primary mb-3"
              rows={3}
              value={samples}
              onChange={e => setSamples(e.target.value)}
              placeholder="ssh root@10.0.0.1 pwd=MySecretPassword"
            />
            
            <label className="block text-sm font-medium mb-1">{t('rules.aiDescLabel')}</label>
            <input 
              type="text"
              className="w-full bg-surface-container-low border border-outline-variant/50 rounded-lg p-3 text-sm focus:outline-none focus:border-primary mb-4"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="匹配 pwd= 后面的密码"
            />
            
            {step === 1 && (
              <button 
                onClick={handleSuggest} 
                disabled={aiLoading || !samples.trim()}
                className="btn-primary w-full py-3 rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {aiLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                {aiLoading ? t('rules.aiGenerating') : t('rules.aiGenBtn')}
              </button>
            )}
            {aiError && <div className="text-red-500 text-sm mt-2">{aiError}</div>}
          </div>

          {/* Step 3 (Step 2 is handled by AI loading state) */}
          {step === 3 && suggestedRule && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pt-6 border-t border-outline-variant/30">
              <div className="flex items-center gap-2 mb-4 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-400 p-2 rounded text-sm">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {t('rules.aiWarning')}
              </div>
              
              <h3 className="font-semibold text-lg mb-4">{t('rules.wizardStep3')}</h3>
              
              <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant/50 mb-4 space-y-3">
                <div>
                  <label className="block text-xs text-on-surface-variant uppercase mb-1">Pattern</label>
                  <input 
                    type="text"
                    className="w-full bg-surface border border-outline-variant/50 rounded p-2 font-mono text-sm"
                    value={suggestedRule.pattern}
                    onChange={e => setSuggestedRule({...suggestedRule, pattern: e.target.value})}
                  />
                </div>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-xs text-on-surface-variant uppercase mb-1">Label</label>
                    <input 
                      type="text"
                      className="w-full bg-surface border border-outline-variant/50 rounded p-2 font-mono text-sm"
                      value={suggestedRule.label}
                      onChange={e => setSuggestedRule({...suggestedRule, label: e.target.value})}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-on-surface-variant uppercase mb-1">Capture Group</label>
                    <input 
                      type="number"
                      className="w-full bg-surface border border-outline-variant/50 rounded p-2 font-mono text-sm"
                      value={suggestedRule.capture_group}
                      onChange={e => setSuggestedRule({...suggestedRule, capture_group: parseInt(e.target.value) || 0})}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-on-surface-variant uppercase mb-1">Explanation</label>
                  <div className="text-sm text-on-surface-variant">{suggestedRule.explanation}</div>
                </div>
              </div>

              <label className="block text-sm font-medium mb-1">{t('rules.testMatch')}</label>
              <textarea 
                className="w-full bg-surface-container-lowest border border-outline-variant/50 rounded-lg p-3 font-mono text-sm focus:outline-none focus:border-primary mb-3"
                rows={3}
                value={testText}
                onChange={e => setTestText(e.target.value)}
              />
              <button onClick={handleTest} className="btn-secondary w-full py-2 rounded-lg font-semibold flex items-center justify-center gap-2 mb-4">
                <Play className="w-4 h-4" /> {t('rules.testMatch')}
              </button>

              {testResult && (
                <div className="bg-surface-container-low border border-outline-variant/40 rounded-lg p-4 mb-4">
                  <h4 className="text-sm font-semibold mb-2">{t('rules.testHits')} {testResult.length}</h4>
                  {testResult.map((m, i) => (
                    <div key={i} className="text-sm font-mono p-2 bg-surface rounded mb-1 border border-outline-variant/20">
                      Found [{m.start}-{m.end}]: <span className="text-primary font-bold">{m.value}</span>
                    </div>
                  ))}
                  {testResult.length === 0 && (
                    <div className="text-sm text-amber-500">No matches found.</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        
        {step === 3 && (
          <div className="p-4 border-t border-outline-variant/30 flex justify-end gap-3 bg-surface-container-lowest rounded-b-2xl">
            <button onClick={onClose} className="px-4 py-2 text-on-surface-variant hover:text-on-surface font-medium">{t('rules.cancel')}</button>
            <button onClick={handleSave} className="btn-primary px-6 py-2 rounded-lg font-semibold flex items-center gap-2">
              <Check className="w-4 h-4" /> {t('rules.saveConfirm')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
// added Sparkles to imports
import { Sparkles } from 'lucide-react';
