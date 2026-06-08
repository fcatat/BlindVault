import React from 'react';
import { 
  Users, ClipboardList, Layers, ShieldCheck, Server, Crown, Sparkles, CheckCircle2, ShieldAlert
} from 'lucide-react';
import { useI18n } from '../i18n';

interface EnterprisePlaceholderProps {
  viewType: 'sso' | 'audit' | 'multi_model' | 'policy' | 'hardware';
}

export function EnterprisePlaceholder({ viewType }: EnterprisePlaceholderProps) {
  const { locale, t } = useI18n();

  const translationsData = {
    zh: {
      statusActive: '企业许可生效中',
      licenseNormal: '商业特许 License 状态：正常校验',
      moduleStatusTitle: '模块运行状态说明',
      securityHintTitle: '安全与集成提示：',
      securityHintText: '企业版子系统与全局凭证中心（BlindVault Core）处于统一的微隔离虚机保护下。如需对配置接口进行深度定制或调试开发，请遵循私有仓库中的 CONTRIBUTING_EE.md 文档说明。',
      sso: {
        title: t('sidebar.userManagement') || '用户管理 (SSO / LDAP)',
        subtitle: '企业统一身份认证接入与多租户隔离控制中心',
        details: [
          { label: '支持协议', value: 'OIDC / SAML 2.0 / LDAP' },
          { label: '统一网关状态', value: '已激活，支持同步 AD/LDAP 目录树' },
          { label: '多租户控制', value: '租户沙箱多实例隔离策略 [RUNNING]' }
        ],
        mockDesc: '该功能模块已由商业 License 成功解锁。可在配置后台完成与 LDAP 域控制器（AD Active Directory）及 SSO 系统的单点登录绑定，实现权限（RBAC）与脱敏策略按租户动态继承。'
      },
      audit: {
        title: t('sidebar.auditLog') || '安全审计日志',
        subtitle: '敏感凭证全生命周期阻断日志与安全合规流水分析',
        details: [
          { label: '旁路审计', value: '日志流式导出启用中 (Kafka / Syslog)' },
          { label: '合规标准', value: '符合 ISO27001 / 等保三级凭据管理规范' },
          { label: '阻断拦截', value: '拦截违规 LLM 通信并保留告警上下文 [ON]' }
        ],
        mockDesc: '所有 Agent 调用和诊断沙箱执行产生的操作指令都将被加密存入本地数据库。支持流式实时转发至企业内部 SOC、SIEM 系统或大日志分析平台进行全链路行为回溯。'
      },
      multi_model: {
        title: t('sidebar.multiModel') || '多模型智能路由',
        subtitle: '依据脱敏等级与成本效益对 prompt 语义分类分级路由',
        details: [
          { label: '路由引擎', value: '基于语义密度与安全分类的自适应路由 [ON]' },
          { label: '备用模型', value: '支持混合多大模型负载均衡 (Fallback & Retry)' },
          { label: '流量管控', value: '租户速率限制 (Rate Limiting) 与防爆卡策略' }
        ],
        mockDesc: '系统支持对经过脱敏的 Prompt 开展多路径分流。可设定当提示词包含极高机密性时，强制路由至内网私有大模型；日常指令转发至公网低成本大模型，兼顾安全与效率。'
      },
      policy: {
        title: t('sidebar.policyEngine') || '合规策略引擎',
        subtitle: '可视化规则编排，对不同智能体或工具设置动态权限',
        details: [
          { label: '策略判定', value: '严格零信任动态授权模式 [ON]' },
          { label: '工具防护', value: '支持基于敏感标签 (Label-based) 的工具防火墙' },
          { label: '凭据保护', value: '凭据仅在安全沙箱内部单向绑定还原' }
        ],
        mockDesc: '允许策略管理员为各个接入的 Agent 制定差异化访问规则。定义特定 Agent 只能引用特定密钥组，从源头上阻断特权滥用与命令注入导致的信息泄露风险。'
      },
      hardware: {
        title: t('sidebar.hardwareAppliance') || '一体机硬体指标',
        subtitle: 'BlindVault 私有化专属一体机物理负载与系统运行监控',
        details: [
          { label: '安全芯片', value: '硬件加密卡 (HSM) 就绪，符合商密二级标准' },
          { label: '存储加密', value: '物理落盘数据加密 [ON] / 防拆写篡改保护' },
          { label: '健康态势', value: '冷酷气流平衡、主板核心温度、冗余电源在线' }
        ],
        mockDesc: '显示 BlindVault 私有物理一体机的专属硬件监控（如果采用了软硬一体交付方案）。通过独立的硬加密芯片保管系统主加密主密钥，提供硬件级的零信任堡垒保护。'
      }
    },
    en: {
      statusActive: 'Enterprise License Active',
      licenseNormal: 'Commercial License Status: Validated successfully',
      moduleStatusTitle: 'Module Operation Status',
      securityHintTitle: 'Security & Integration Notes:',
      securityHintText: 'Enterprise subsystems and the global Secret Vault (BlindVault Core) are enclosed under unified micro-isolated sandbox protection. To deep-customize API endpoints or develop modules, please follow CONTRIBUTING_EE.md guidelines in the private repository.',
      sso: {
        title: t('sidebar.userManagement') || 'User Management (SSO / LDAP)',
        subtitle: 'Unified enterprise identity gateway & multi-tenant access control',
        details: [
          { label: 'Protocols', value: 'OIDC / SAML 2.0 / LDAP' },
          { label: 'Gateway Status', value: 'Activated, AD/LDAP tree synchronization ready' },
          { label: 'Tenant Isolation', value: 'Multi-instance sandbox isolation strategy [RUNNING]' }
        ],
        mockDesc: 'This module has been unlocked by your commercial license. You can configure SSO integration with LDAP domain controllers or active directory trees to inherit RBAC permissions and sanitization rules dynamically.'
      },
      audit: {
        title: t('sidebar.auditLog') || 'Security Audit Log',
        subtitle: 'Lifecycle telemetry of secret references and policy compliance audits',
        details: [
          { label: 'Log Export', value: 'Streaming log exports online (Kafka / Syslog)' },
          { label: 'Compliance', value: 'Meets ISO27001 / SOC2 Level 3 specifications' },
          { label: 'Interventions', value: 'Intercepts anomalous LLM payloads & saves context [ON]' }
        ],
        mockDesc: 'Every single agent run and sandbox operation generates strict audit trails. Supports real-time stream integration into corporate SOC, SIEM systems or syslog managers.'
      },
      multi_model: {
        title: t('sidebar.multiModel') || 'Multi-Model Routing',
        subtitle: 'Intelligent prompt routing based on compliance levels and cloud cost metrics',
        details: [
          { label: 'Routing Engine', value: 'Adaptive classifier based on semantic sensitivity [ON]' },
          { label: 'Fallback Policy', value: 'Multi-model fallback logic active' },
          { label: 'Rate Limits', value: 'Tenant rate limit filters & safety throttling active' }
        ],
        mockDesc: 'Allows users to classify prompt routing pathways. Highly confidential prompt segments force routing to secure local/private LLM deployments; standard prompts delegate to public SaaS LLMs.'
      },
      policy: {
        title: t('sidebar.policyEngine') || 'Compliance Policy Engine',
        subtitle: 'Visual policy editor mapping dynamic rule sets onto agents and tools',
        details: [
          { label: 'Policy Enforcer', value: 'Zero-Trust dynamic authorization model active [ON]' },
          { label: 'Tool Firewall', value: 'Label-based policy guardrails for agent tools' },
          { label: 'Key Isolation', value: 'One-way bindings resolved only inside sandbox' }
        ],
        mockDesc: 'Empowers security officers to dictate security restrictions. Ensure specific agents only access their designated whitelist of credentials, blocking command injections and credential harvesting.'
      },
      hardware: {
        title: t('sidebar.hardwareAppliance') || 'Hardware Appliance Metric',
        subtitle: 'Physical system loads and chassis metrics of BlindVault Server',
        details: [
          { label: 'Secure Hardware', value: 'HSM Cryptographic coprocessor online' },
          { label: 'Data Encryption', value: 'Physical storage encryption [ON] / Anti-tamper active' },
          { label: 'Chassis Health', value: 'Chassis temperature, airflow balance, dual power online' }
        ],
        mockDesc: 'Monitors the hardware status of your physical BlindVault appliance. Employs hardware-security modules (HSMs) to safeguard master system cryptographic keys.'
      }
    }
  };

  // 兜底降级回 zh
  const data = translationsData[locale] || translationsData.zh;
  const meta = data[viewType];

  const getIcon = () => {
    switch (viewType) {
      case 'sso': return <Users className="w-6 h-6 text-amber-500" />;
      case 'audit': return <ClipboardList className="w-6 h-6 text-amber-500" />;
      case 'multi_model': return <Layers className="w-6 h-6 text-amber-500" />;
      case 'policy': return <ShieldCheck className="w-6 h-6 text-amber-500" />;
      case 'hardware': return <Server className="w-6 h-6 text-amber-500" />;
    }
  };

  return (
    <div className="p-6 lg:p-10 max-w-4xl mx-auto w-full animate-in fade-in duration-500">
      
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-3">
          <div className="h-12 w-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
            {getIcon()}
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-3xl font-headline font-bold text-on-surface tracking-tight">{meta.title}</h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/30 flex items-center gap-1">
                <Crown className="w-3 h-3 text-amber-500" />
                {t('config.localModelEEBadge') || 'Enterprise'}
              </span>
            </div>
            <p className="text-on-surface-variant text-sm mt-1">{meta.subtitle}</p>
          </div>
        </div>
      </div>

      {/* Main Status Panel */}
      <div className="panel rounded-xl p-6 mb-8 border border-amber-500/20 bg-amber-500/[0.02] flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full flex items-center justify-center bg-green-500/10 text-green-600">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <div className="text-sm font-semibold text-on-surface">{data.statusActive}</div>
            <div className="text-xs text-on-surface-variant mt-0.5">{data.licenseNormal}</div>
          </div>
        </div>
        
        <div className="flex items-center gap-2 bg-gradient-to-r from-amber-500/10 to-orange-500/10 px-3.5 py-1.5 rounded-lg border border-amber-500/20">
          <Sparkles className="w-4 h-4 text-amber-500" />
          <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Enterprise Pro</span>
        </div>
      </div>

      {/* Description Card */}
      <div className="panel rounded-xl p-6 mb-8 space-y-6">
        <h3 className="text-base font-semibold text-on-surface">{data.moduleStatusTitle}</h3>
        <p className="text-sm text-on-surface-variant leading-relaxed">
          {meta.mockDesc}
        </p>

        {/* Feature Tags / Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-outline-variant">
          {meta.details.map((detail, idx) => (
            <div key={idx} className="bg-surface-container rounded-lg p-4 border border-outline-variant/60">
              <div className="text-xs text-on-surface-variant mb-1.5 font-medium">{detail.label}</div>
              <div className="text-sm font-semibold text-on-surface">{detail.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Future Plan info */}
      <div className="panel rounded-xl p-5 bg-surface-container/30 border border-outline-variant">
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <div className="text-xs text-on-surface-variant leading-relaxed">
            <p><strong className="text-on-surface">{data.securityHintTitle}</strong> {data.securityHintText}</p>
          </div>
        </div>
      </div>

    </div>
  );
}
