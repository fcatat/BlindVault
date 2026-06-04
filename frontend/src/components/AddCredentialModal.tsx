import React, { useState } from 'react';
import { 
  ShieldCheck, X, ChevronDown, Tag, Eye, EyeOff, Key, Globe, Plus, Link, Timer, Activity, KeyRound, CheckCircle2, Copy
} from 'lucide-react';
import { createSecret, type SecretResponse } from '../api';
import { useI18n } from '../i18n';

interface AddCredentialModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  onCreated?: () => void;
}

export function AddCredentialModal({ isOpen, onClose, sessionId, onCreated }: AddCredentialModalProps) {
  const { t } = useI18n();
  const [isMasked, setIsMasked] = useState(true);
  const [ttl, setTtl] = useState(15);
  const [maxReads, setMaxReads] = useState(1);
  const [secretType, setSecretType] = useState('password');
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [allowedTool, setAllowedTool] = useState('secure_shell');
  const [destination, setDestination] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SecretResponse | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!label.trim() || !value.trim()) {
      setError(t('modal.fillRequired'));
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const resp = await createSecret(sessionId, {
        secret_type: secretType,
        label: label.trim(),
        value: value.trim(),
        allowed_tools: [allowedTool],
        allowed_destinations: destination.trim() ? [destination.trim()] : [],
        ttl_seconds: ttl * 60,
        max_reads: maxReads,
      });
      setResult(resp);
      onCreated?.();
    } catch (e: any) {
      setError(e.message || t('config.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = () => {
    if (result) {
      navigator.clipboard.writeText(result.placeholder);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setResult(null);
    setError('');
    setLabel('');
    setValue('');
    setDestination('');
    setTtl(15);
    setMaxReads(1);
    onClose();
  };

  // 成功界面
  if (result) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-200">
        <div className="absolute inset-0 bg-inverse-surface/40 backdrop-blur-sm" onClick={handleClose}></div>
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/10 blur-[120px] rounded-full mix-blend-multiply"></div>
        </div>

        <main className="w-full max-w-lg bg-surface shadow-2xl border border-outline-variant rounded-xl z-10 relative overflow-hidden">
          <header className="px-6 py-5 border-b border-outline-variant flex justify-between items-center bg-surface-container-lowest">
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-full bg-green-100 text-green-700 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-headline font-semibold text-on-surface">{t('modal.secretCreated')}</h2>
                <p className="text-xs text-on-surface-variant mt-0.5">{t('modal.secretCreatedDesc')}</p>
              </div>
            </div>
            <button onClick={handleClose} className="text-on-surface-variant hover:text-on-surface p-2 rounded-lg hover:bg-surface-container-high active:scale-95">
              <X className="w-5 h-5" />
            </button>
          </header>

          <div className="px-6 py-6 space-y-5">
            <div className="bg-surface-container rounded-lg p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-on-surface-variant">{t('modal.labelField')}</span>
                <span className="text-on-surface font-medium">{result.label}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-on-surface-variant">{t('modal.typeField')}</span>
                <span className="text-on-surface font-medium">{result.secret_type}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-on-surface-variant">{t('modal.statusField')}</span>
                <span className="text-primary font-medium flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                  {result.status}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-on-surface-variant">{t('modal.readsLeftField')}</span>
                <span className="text-on-surface font-medium">{result.reads_left}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-on-surface-variant font-medium">{t('modal.placeholderLabel')}</label>
              <div className="flex gap-2">
                <code className="flex-1 bg-primary/5 border border-primary/20 rounded-lg px-4 py-3 text-sm font-mono text-primary break-all select-all">
                  {result.placeholder}
                </code>
                <button
                  onClick={handleCopy}
                  className="px-3 bg-surface-container border border-outline-variant rounded-lg hover:bg-surface-container-high transition-colors active:scale-95"
                  title={t('modal.copy')}
                >
                  {copied ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-on-surface-variant" />}
                </button>
              </div>
              <p className="text-xs text-on-surface-variant">
                {t('modal.placeholderHint')}
              </p>
            </div>
          </div>

          <footer className="px-6 py-5 border-t border-outline-variant bg-surface-container">
            <button onClick={handleClose} className="w-full px-6 py-2.5 rounded-lg font-semibold text-sm bg-primary text-on-primary hover:bg-primary/90 shadow-sm transition-all active:scale-[0.98]">
              {t('modal.done')}
            </button>
          </footer>
        </main>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-inverse-surface/40 backdrop-blur-sm" onClick={handleClose}></div>
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/10 blur-[120px] rounded-full mix-blend-multiply"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-tertiary/10 blur-[100px] rounded-full mix-blend-multiply"></div>
      </div>

      <main className="w-full max-w-2xl bg-surface shadow-2xl border border-outline-variant rounded-xl z-10 relative overflow-hidden flex flex-col max-h-full">
        <header className="px-6 py-5 border-b border-outline-variant flex justify-between items-center bg-surface-container-lowest shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-headline font-semibold text-on-surface tracking-tight">{t('modal.title')}</h2>
              <p className="text-xs sm:text-sm font-body text-on-surface-variant mt-0.5">{t('modal.subtitle')}</p>
            </div>
          </div>
          <button onClick={handleClose} className="text-on-surface-variant hover:text-on-surface transition-colors p-2 rounded-lg hover:bg-surface-container-high active:scale-95 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="px-6 py-6 space-y-6 overflow-y-auto min-h-0">
          {error && (
            <div className="bg-error-container text-on-error-container rounded-lg px-4 py-3 text-sm font-medium">
              {error}
            </div>
          )}

          {/* Type & Label */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <label className="block text-sm font-label text-on-surface-variant font-medium">{t('modal.secretType')}</label>
              <div className="relative group">
                <select 
                  value={secretType}
                  onChange={(e) => setSecretType(e.target.value)}
                  className="w-full appearance-none bg-surface-container border border-outline-variant focus:border-primary focus:ring-1 focus:ring-primary transition-all text-on-surface text-sm rounded-lg px-4 py-3 pr-10 cursor-pointer outline-none"
                >
                  <option value="password">{t('modal.typePassword')}</option>
                  <option value="api_key">{t('modal.typeApiKey')}</option>
                  <option value="token">{t('modal.typeToken')}</option>
                  <option value="database_password">{t('modal.typeDbPassword')}</option>
                  <option value="ssh_key">{t('modal.typeSshKey')}</option>
                  <option value="other">{t('modal.typeOther')}</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none group-focus-within:text-primary transition-colors w-4 h-4" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-label text-on-surface-variant font-medium">{t('modal.label')}</label>
              <div className="relative bg-surface-container border border-outline-variant focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all rounded-lg flex items-center px-4 py-2.5">
                <Tag className="text-on-surface-variant mr-3 w-5 h-5 opacity-70" />
                <input 
                  type="text" 
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="w-full bg-transparent border-none text-sm text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:ring-0 p-0 py-0.5" 
                  placeholder={t('modal.labelPlaceholder')} 
                />
              </div>
            </div>
          </div>

          {/* Secret Value */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="block text-sm font-label text-on-surface-variant font-medium">{t('modal.value')}</label>
              <button 
                onClick={() => setIsMasked(!isMasked)}
                type="button" 
                className="text-xs text-primary hover:text-primary-container transition-colors flex items-center gap-1 font-semibold"
              >
                {isMasked ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                <span>{isMasked ? t('modal.showValue') : t('modal.hideValue')}</span>
              </button>
            </div>
            <div className="relative bg-surface-container border border-outline-variant focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all rounded-lg flex items-start px-4 py-3 min-h-[80px]">
              <Key className="text-on-surface-variant mr-3 w-5 h-5 mt-0.5 opacity-70 shrink-0" />
              <textarea 
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full bg-transparent border-none text-sm text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:ring-0 p-0 resize-none h-full font-mono outline-none" 
                placeholder={t('modal.valuePlaceholder')} 
                style={{ WebkitTextSecurity: isMasked ? 'disc' : 'none' } as any}
                rows={3}
              ></textarea>
            </div>
          </div>

          {/* Tools & Destination */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <label className="block text-sm font-label text-on-surface-variant font-medium">{t('modal.allowedTools')}</label>
              <div className="relative group">
                <select 
                  value={allowedTool}
                  onChange={(e) => setAllowedTool(e.target.value)}
                  className="w-full appearance-none bg-surface-container border border-outline-variant focus:border-primary focus:ring-1 focus:ring-primary transition-all text-on-surface text-sm rounded-lg px-4 py-3 pr-10 cursor-pointer outline-none"
                >
                  <option value="secure_shell">secure_shell</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none w-4 h-4" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-label text-on-surface-variant font-medium">{t('modal.allowedDest')}</label>
              <div className="relative bg-surface-container border border-outline-variant focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all rounded-lg flex items-center px-4 py-2.5">
                <Link className="text-on-surface-variant mr-3 w-5 h-5 opacity-70 shrink-0" />
                <input 
                  type="url" 
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  className="w-full bg-transparent border-none text-sm text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:ring-0 p-0 py-0.5" 
                  placeholder="https://example.com" 
                />
              </div>
            </div>
          </div>

          {/* TTL & Max Reads */}
          <div className="p-4 rounded-lg bg-surface-container border border-outline-variant flex flex-col sm:flex-row gap-6">
            <div className="flex-1 space-y-4">
              <div className="flex justify-between items-center">
                <label className="block text-sm font-label text-on-surface-variant font-medium flex items-center gap-1.5">
                  <Timer className="w-4 h-4 opacity-70" /> {t('modal.ttl')}
                </label>
                <span className="text-sm font-semibold text-primary">{ttl === 60 ? '1h' : `${ttl}m`}</span>
              </div>
              <input 
                type="range" min="1" max="60" 
                value={ttl}
                onChange={(e) => setTtl(parseInt(e.target.value))}
                className="w-full accent-primary" 
              />
              <div className="flex justify-between text-xs font-semibold text-on-surface-variant/70">
                <span>1m</span><span>1h</span>
              </div>
            </div>
            <div className="w-px bg-outline-variant hidden sm:block shrink-0"></div>
            <div className="sm:w-32 space-y-2 shrink-0">
              <label className="block text-sm font-label text-on-surface-variant font-medium flex items-center gap-1.5">
                <Activity className="w-4 h-4 opacity-70" /> {t('modal.maxReads')}
              </label>
              <div className="relative bg-surface border border-outline-variant rounded-lg flex items-center px-3 py-2">
                <input 
                  type="number" min="1" max="100"
                  value={maxReads}
                  onChange={(e) => setMaxReads(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full bg-transparent border-none text-sm text-center text-on-surface focus:outline-none focus:ring-0 p-0 font-medium" 
                />
              </div>
            </div>
          </div>
        </div>

        <footer className="px-6 py-5 border-t border-outline-variant bg-surface-container flex justify-end gap-3 shrink-0">
          <button onClick={handleClose} className="px-5 py-2.5 rounded-lg font-label font-medium text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all active:scale-95 border border-transparent hover:border-outline-variant">
            {t('modal.cancel')}
          </button>
          <button 
            onClick={handleSubmit}
            disabled={submitting}
            className="px-6 py-2.5 rounded-lg font-label font-semibold text-sm bg-primary text-on-primary hover:bg-primary/90 shadow-sm transition-all active:scale-[0.98] flex items-center gap-2 border border-transparent disabled:opacity-50"
          >
            <KeyRound className={`w-4 h-4 ${submitting ? 'animate-spin' : ''}`} />
            {submitting ? t('modal.creating') : t('modal.create')}
          </button>
        </footer>
      </main>
    </div>
  );
}
