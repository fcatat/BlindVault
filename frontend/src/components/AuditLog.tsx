import React, { useState, useEffect } from 'react';
import { useI18n } from '../i18n';
import { getAuditLog, AuditEvent } from '../agentApi';

export const AuditLog: React.FC = () => {
  const { t } = useI18n();
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  // Filters
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [tsFrom, setTsFrom] = useState('');
  const [tsTo, setTsTo] = useState('');
  
  // Pagination
  const limit = 100;
  const [offset, setOffset] = useState(0);

  const [expandedDetails, setExpandedDetails] = useState<number | null>(null);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const res = await getAuditLog({
        actor, action, ts_from: tsFrom, ts_to: tsTo, limit, offset
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      console.error('Failed to fetch audit log:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [offset]); // auto fetch when offset changes

  const handleFilter = () => {
    setOffset(0);
    fetchLogs();
  };

  const handlePrev = () => setOffset(Math.max(0, offset - limit));
  const handleNext = () => setOffset(offset + limit);

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 h-full flex flex-col">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {t('audit.title')}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 border-l-4 border-yellow-400 pl-3 py-1 bg-yellow-50 dark:bg-yellow-900/20 rounded-r">
          {t('audit.subtitle')}
        </p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('audit.actor')}</label>
          <input
            type="text"
            className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-transparent dark:text-white"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            placeholder={t('audit.filterActor')}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('audit.action')}</label>
          <input
            type="text"
            className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-transparent dark:text-white"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder={t('audit.filterAction')}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('audit.filterFrom')}</label>
          <input
            type="datetime-local"
            className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-transparent dark:text-white"
            value={tsFrom}
            onChange={(e) => setTsFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('audit.filterTo')}</label>
          <input
            type="datetime-local"
            className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-transparent dark:text-white"
            value={tsTo}
            onChange={(e) => setTsTo(e.target.value)}
          />
        </div>
        <button
          onClick={handleFilter}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded text-sm font-medium transition-colors"
        >
          {t('dashboard.refresh')}
        </button>
      </div>

      <div className="flex-1 bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('audit.timestamp')}</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('audit.actor')}</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('audit.action')}</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('audit.target')}</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('audit.details')}</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {items.map((item) => (
                <React.Fragment key={item.id}>
                  <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer" onClick={() => setExpandedDetails(expandedDetails === item.id ? null : item.id)}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {new Date(item.ts).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                      {item.actor}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-indigo-600 dark:text-indigo-400 font-mono">
                      {item.action}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {item.target_type && item.target_id ? `${item.target_type}:${item.target_id.slice(0,8)}...` : '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 max-w-xs truncate font-mono">
                      {item.details ? JSON.stringify(item.details) : '-'}
                    </td>
                  </tr>
                  {expandedDetails === item.id && item.details && (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                        <div className="text-xs font-mono text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 p-3 rounded overflow-x-auto">
                          <pre>{JSON.stringify(item.details, null, 2)}</pre>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {items.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                    {t('audit.empty')}
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400 animate-pulse">
                    {t('audit.loading')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex items-center justify-between">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {t('dashboard.totalRecords').replace('{count}', String(total))}
          </div>
          <div className="flex space-x-2">
            <button
              onClick={handlePrev}
              disabled={offset === 0 || loading}
              className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 disabled:opacity-50"
            >
              {t('audit.prevPage')}
            </button>
            <button
              onClick={handleNext}
              disabled={offset + limit >= total || loading}
              className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 disabled:opacity-50"
            >
              {t('audit.nextPage')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
