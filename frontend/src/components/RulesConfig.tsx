import React, { useState, useEffect } from 'react';
import { ShieldCheck, Info, RefreshCw } from 'lucide-react';

interface RuleItem {
  name: string;
  description: string;
  example: string;
}

export function RulesConfig() {
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchRules = async () => {
      setIsLoading(true);
      try {
        const response = await fetch('/api/sanitize-rules');
        if (response.ok) {
          const data = await response.json();
          setRules(data);
        }
      } catch (error) {
        console.error('Failed to fetch sanitize rules', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchRules();
  }, []);

  return (
    <div className="flex-1 p-6 lg:p-10 max-w-5xl mx-auto w-full animate-in slide-in-from-right-4 duration-500 overflow-y-auto pb-24">
      <div className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-outline-variant/30 pb-6">
        <div>
          <h2 className="text-3xl font-headline font-semibold text-on-surface tracking-tight flex items-center gap-3">
            <ShieldCheck className="text-primary w-8 h-8" />
            内置脱敏规则
          </h2>
          <p className="text-on-surface-variant mt-2 text-sm max-w-2xl font-body">
            以下规则为系统内置的可逆脱敏主层防御规则，扫描拦截所有传给模型的请求，进行密码/密钥替换保护。当前暂不支持在界面上自定义规则。
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <RefreshCw className="w-8 h-8 text-primary animate-spin" />
          <span className="text-sm text-on-surface-variant font-medium">加载中...</span>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="glass-panel overflow-hidden border border-outline-variant/60 rounded-2xl shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-surface-container-low text-on-surface font-semibold border-b border-outline-variant/40">
                    <th className="py-4 px-4 font-headline w-1/4">规则名称</th>
                    <th className="py-4 px-4 font-headline w-1/2">描述</th>
                    <th className="py-4 px-4 font-headline w-1/4">命中示例</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/20">
                  {rules.map((rule, index) => (
                    <tr key={index} className="hover:bg-surface-container-lowest/40 transition-colors">
                      <td className="py-4 px-4 text-on-surface font-medium">{rule.name}</td>
                      <td className="py-4 px-4 text-on-surface-variant leading-relaxed">
                        <div className="flex items-start gap-2">
                          <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                          <span>{rule.description}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-on-surface font-mono text-xs bg-surface-container-lowest rounded-md">
                        {rule.example}
                      </td>
                    </tr>
                  ))}
                  {rules.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-12 text-center text-on-surface-variant/70 italic bg-surface-container-lowest">
                        无内置规则
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

