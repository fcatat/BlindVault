import React, { useState, useEffect, useCallback } from 'react';
import { 
  RefreshCcw, KeyRound, Hourglass, Layers, TrendingUp, 
  Info, History, Database, Wrench, Server, Ban, Cloud,
  Code, Mail, Trash2, ShieldCheck, AlertTriangle, Copy
} from 'lucide-react';
import { listSecrets, revokeSecret, type SecretMetadata } from '../api';
import { useI18n } from '../i18n';

export function Dashboard({ sessionId }: { sessionId: string, key?: string }) {
  const { t } = useI18n();
  const [secrets, setSecrets] = useState<SecretMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'expiring' | 'consumed'>('all');
  const [revoking, setRevoking] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchSecrets = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listSecrets(sessionId);
      setSecrets(data);
    } catch (e) {
      console.error('获取 secret 列表失败:', e);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { fetchSecrets(); }, [fetchSecrets]);

  const handleRevoke = async (ref: string) => {
    try {
      setRevoking(ref);
      await revokeSecret(sessionId, ref);
      await fetchSecrets();
    } catch (e) {
      console.error('撤销失败:', e);
    } finally {
      setRevoking(null);
    }
  };

  // 统计
  const activeCount = secrets.filter(s => s.status === 'active' && new Date(s.expires_at).getTime() > now).length;
  const expiringCount = secrets.filter(s => {
    if (s.status !== 'active') return false;
    const ttl = new Date(s.expires_at).getTime() - now;
    return ttl < 3600_000 && ttl > 0;
  }).length;
  const consumedCount = secrets.filter(s => 
    ['exhausted', 'revoked', 'expired'].includes(s.status) || 
    (s.status === 'active' && new Date(s.expires_at).getTime() <= now)
  ).length;

  // 过滤
  const filtered = secrets.filter(s => {
    const isExpired = s.status === 'active' && new Date(s.expires_at).getTime() <= now;
    const currentStatus = isExpired ? 'expired' : s.status;

    if (filter === 'all') return true;
    if (filter === 'active') return currentStatus === 'active';
    if (filter === 'expiring') {
      const ttl = new Date(s.expires_at).getTime() - now;
      return currentStatus === 'active' && ttl < 3600_000 && ttl > 0;
    }
    return ['exhausted', 'revoked', 'expired'].includes(currentStatus);
  });

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto w-full animate-in fade-in duration-500">
      {/* Page Header */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-headline font-bold text-on-surface tracking-tight mb-2">{t('dashboard.title')}</h1>
          <p className="text-on-surface-variant text-sm max-w-2xl">
            {t('dashboard.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="panel rounded px-4 py-2 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse"></span>
            <span className="text-sm text-on-surface-variant font-medium">{t('dashboard.vaultStatus')}</span>
          </div>
          <button 
            onClick={fetchSecrets}
            disabled={loading}
            className="panel rounded p-2 text-on-surface-variant hover:bg-surface-container-highest transition-colors active:scale-95"
            title={t('dashboard.refresh')}
          >
            <RefreshCcw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <StatCard 
          icon={<KeyRound className="w-full h-full opacity-20" />}
          title={t('dashboard.activeCredentials')}
          value={String(activeCount)}
          trendIcon={<TrendingUp className="w-3.5 h-3.5" />}
          trendText={t('dashboard.totalRecords').replace('{count}', String(secrets.length))}
          trendColor="text-secondary"
          valueColor="text-primary"
        />
        <StatCard 
          icon={<Hourglass className="w-full h-full opacity-20" />}
          title={t('dashboard.expiringSoon')}
          value={String(expiringCount)}
          trendIcon={<Info className="w-3.5 h-3.5" />}
          trendText={t('dashboard.needRotation')}
          trendColor="text-on-surface-variant"
          valueColor="text-tertiary"
        />
        <StatCard 
          icon={<Layers className="w-full h-full opacity-20" />}
          title={t('dashboard.consumedRevoked')}
          value={String(consumedCount)}
          trendIcon={<History className="w-3.5 h-3.5" />}
          trendText={t('dashboard.archived')}
          trendColor="text-on-surface-variant"
          valueColor="text-on-surface-variant"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="panel rounded p-1 inline-flex bg-surface-container-low">
          {(['all', 'active', 'expiring', 'consumed'] as const).map(f => (
            <button 
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                filter === f 
                  ? 'bg-surface-container-lowest shadow-sm text-on-surface' 
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {f === 'all' ? t('dashboard.all') : f === 'active' ? t('dashboard.active') : f === 'expiring' ? t('dashboard.expiring') : t('dashboard.consumed')}
            </button>
          ))}
        </div>
      </div>

      {/* Credential Grid */}
      {filtered.length === 0 ? (
        <div className="panel rounded-xl p-12 text-center">
          <ShieldCheck className="w-12 h-12 mx-auto mb-4 text-outline-variant" />
          <p className="text-on-surface-variant text-sm">
            {loading ? t('dashboard.loading') : t('dashboard.emptyDesc')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {filtered.map(secret => {
            const isExpired = secret.status === 'active' && new Date(secret.expires_at).getTime() <= now;
            const isConsumed = ['exhausted', 'revoked', 'expired'].includes(secret.status) || isExpired;
            const ttlMs = new Date(secret.expires_at).getTime() - now;
            const ttlPercent = isConsumed ? 0 : Math.max(0, Math.min(100, (ttlMs / 3600_000) * 100));
            const isExpiring = !isConsumed && ttlMs < 3600_000 && ttlMs > 0;
            const ttlStr = isConsumed ? '00:00:00' : formatTTL(ttlMs);
            
            const statusLabel = isExpired ? 'Expired'
              : secret.status === 'active' 
              ? (isExpiring ? 'Expiring' : 'Active')
              : secret.status === 'exhausted' ? 'Exhausted'
              : secret.status === 'revoked' ? 'Revoked' 
              : 'Expired';

            const typeIcon = secret.secret_type === 'api_key' 
              ? <Code className="text-on-primary-fixed w-5 h-5" />
              : secret.secret_type === 'token'
              ? <Cloud className="text-on-primary-fixed w-5 h-5" />
              : <Database className="text-on-primary-fixed w-5 h-5" />;

            return (
              <CredentialCard
                key={secret.secret_ref}
                status={statusLabel}
                title={secret.label}
                id={maskRef(secret.secret_ref)}
                secretRef={secret.secret_ref}
                icon={typeIcon}
                iconBg={isConsumed ? "bg-surface-container-highest" : "bg-primary-fixed"}
                iconBorder={isConsumed ? "border-outline-variant" : "border-primary-fixed-dim"}
                badgeColor={
                  isConsumed ? "text-outline bg-surface-container border-outline-variant"
                  : isExpiring ? "text-tertiary bg-tertiary/10 border-tertiary/30 animate-pulse"
                  : "text-primary bg-primary/10 border-primary/30"
                }
                dotColor={isConsumed ? "bg-outline" : isExpiring ? "bg-tertiary" : "bg-primary"}
                accentColor={isConsumed ? "bg-outline-variant" : isExpiring ? "bg-tertiary" : "bg-primary"}
                tool={secret.allowed_tools[0] || '-'}
                destination={secret.allowed_destinations[0] || '*'}
                toolIcon={<Wrench className={`w-3 h-3 ${isConsumed ? 'text-outline' : 'text-secondary'}`} />}
                destIcon={<Server className={`w-3 h-3 ${isConsumed ? 'text-outline' : 'text-secondary'}`} />}
                progressColor={isConsumed ? "bg-outline-variant" : "bg-primary"}
                ttl={ttlStr}
                ttlPercent={ttlPercent}
                reads={`${secret.reads_left} left`}
                readsPercent={isConsumed ? 0 : (secret.reads_left > 0 ? 100 : 0)}
                ttlColor={isExpiring ? "text-tertiary" : "text-on-surface"}
                isConsumed={isConsumed}
                actionBtn={
                  isConsumed ? (
                    <button disabled className="w-full bg-surface-container border border-outline-variant rounded py-2 px-4 flex items-center justify-center gap-2 text-sm font-medium text-outline mt-auto cursor-not-allowed">
                      <Trash2 className="w-4 h-4" />
                      {isExpired ? t('dashboard.expired') : secret.status === 'revoked' ? t('dashboard.revoked') : secret.status === 'exhausted' ? t('dashboard.exhausted') : t('dashboard.expired')}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleRevoke(secret.secret_ref)}
                      disabled={revoking === secret.secret_ref}
                      className="w-full btn-danger rounded py-2 px-4 flex items-center justify-center gap-2 text-sm font-medium mt-auto active:scale-[0.98]"
                    >
                      <Ban className={`w-4 h-4 ${revoking === secret.secret_ref ? 'animate-spin' : ''}`} />
                      {revoking === secret.secret_ref ? t('dashboard.revoking') : t('dashboard.revoke')}
                    </button>
                  )
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function maskRef(ref: string): string {
  if (ref.length > 16) return ref.substring(0, 12) + '****';
  return ref;
}

function formatTTL(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function StatCard({ icon, title, value, trendIcon, trendText, trendColor, valueColor }: any) {
  return (
    <div className="panel rounded-xl p-6 relative overflow-hidden group">
      <div className="absolute -right-8 -top-8 text-surface-container-highest group-hover:text-surface-variant transition-colors duration-500 w-32 h-32 flex items-center justify-center">
        {icon}
      </div>
      <div className="text-on-surface-variant text-sm font-medium mb-1 relative z-10">{title}</div>
      <div className={`text-4xl font-display font-bold ${valueColor} mb-2 relative z-10`}>{value}</div>
      <div className={`flex items-center gap-1.5 text-xs ${trendColor} relative z-10 font-medium`}>
        {trendIcon}
        <span>{trendText}</span>
      </div>
    </div>
  );
}

function CredentialCard({ 
  status, title, id, secretRef, icon, iconBg, iconBorder, badgeColor, dotColor, accentColor, 
  tool, destination, toolIcon, destIcon, progressColor, ttl, ttlPercent, reads, readsPercent,
  ttlColor = "text-on-surface", isConsumed = false, actionBtn
}: any) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(`{{secret:${secretRef}}}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`panel-elevated rounded-xl p-5 flex flex-col relative overflow-hidden group h-full bg-surface-container-lowest ${isConsumed ? 'opacity-75 bg-surface-container-low' : ''}`}>
      <div className={`absolute top-0 left-0 w-full h-1 ${accentColor}`}></div>
      
      <div className="flex flex-wrap gap-2 justify-between items-start mb-4">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 shrink-0 rounded ${iconBg} border ${iconBorder} flex items-center justify-center`}>
            {icon}
          </div>
          <div>
            <h3 className={`font-headline font-semibold text-sm ${isConsumed ? 'text-on-surface-variant line-through decoration-outline/50' : 'text-on-surface'}`}>{title}</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`text-xs font-mono ${isConsumed ? 'text-outline' : 'text-on-surface-variant'}`}>{id}</span>
              {!isConsumed && (
                <button
                  onClick={handleCopy}
                  className="text-on-surface-variant hover:text-primary transition-colors p-1 rounded hover:bg-surface-container-high active:scale-95 flex items-center justify-center shrink-0"
                  title="复制安全引用"
                >
                  {copied ? (
                    <span className="text-green-600 text-[10px] font-sans font-semibold">已复制</span>
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
        <div className={`px-2 py-1 rounded border text-xs font-medium flex items-center gap-1.5 shrink-0 ${badgeColor}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`}></span> {status}
        </div>
      </div>

      <div className={`grid grid-cols-2 gap-4 mb-5 p-3 rounded border border-outline-variant ${isConsumed ? 'bg-surface-container' : 'bg-surface-container-lowest'}`}>
        <div>
          <div className={`text-[11px] mb-1 uppercase tracking-wider font-bold ${isConsumed ? 'text-outline' : 'text-on-surface-variant'}`}>Allowed Tool</div>
          <div className={`flex items-center gap-1.5 text-sm font-medium ${isConsumed ? 'text-on-surface-variant' : 'text-on-surface'}`}>
            {toolIcon} <span className="truncate" title={tool}>{tool}</span>
          </div>
        </div>
        <div>
          <div className={`text-[11px] mb-1 uppercase tracking-wider font-bold ${isConsumed ? 'text-outline' : 'text-on-surface-variant'}`}>Destination</div>
          <div className={`flex items-center gap-1.5 text-sm font-medium ${isConsumed ? 'text-on-surface-variant' : 'text-on-surface'}`}>
            {destIcon} <span className="truncate" title={destination}>{destination}</span>
          </div>
        </div>
      </div>

      <div className="space-y-5 mb-6 flex-1">
        <div>
          <div className="flex justify-between text-xs mb-1.5">
            <span className={isConsumed ? 'text-outline' : 'text-on-surface-variant'}>Time to Live (TTL)</span>
            <span className={`${isConsumed ? 'text-outline' : ttlColor} font-mono font-medium tracking-wide`}>{ttl}</span>
          </div>
          <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
            <div className={`h-full ${isConsumed ? 'bg-outline-variant' : (ttlPercent < 20 ? 'bg-tertiary' : 'bg-primary')} rounded-full transition-all duration-500`} style={{ width: `${ttlPercent}%` }}></div>
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs mb-1.5">
            <span className={isConsumed ? 'text-outline' : 'text-on-surface-variant'}>Reads Remaining</span>
            <span className={`${isConsumed ? 'text-outline' : 'text-on-surface'} font-medium`}>{reads}</span>
          </div>
          <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
            <div className={`h-full ${isConsumed ? 'bg-outline-variant' : progressColor} rounded-full transition-all duration-500`} style={{ width: `${readsPercent}%` }}></div>
          </div>
        </div>
      </div>
      
      {actionBtn}
    </div>
  );
}
