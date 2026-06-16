import re

with open("frontend/src/i18n.tsx", "r") as f:
    content = f.read()

zh_keys = """
    'config.headerTitle': 'Agent 模型与策略配置',
    'config.headerSubtitle': '只读展示后端环境变量加载的核心配置参数。',
    'config.gatewayConfigTitle': 'LiteLLM 网关配置',
    'config.virtualKeyConfigured': '已配置 Virtual Key',
    'config.virtualKeyNotConfigured': '未配置 Virtual Key',
    'config.agentStrategyTitle': 'Agent 执行策略',
    'config.maxIterationsDesc': '最大循环思考次数。',
    'config.sandboxUpgradeFailed': '升级沙箱失败',
    'config.notConfigured': '未配置',

    'rules.noRules': '暂无规则',
    'rules.selectRule': '选择左侧规则查看详情',
    'rules.testMatch': '测试匹配',
    'rules.builtinWarning': '内置规则修改后将覆盖默认行为。',
    'rules.cancel': '取消',
"""

en_keys = """
    'config.headerTitle': 'Agent Model & Strategy Config',
    'config.headerSubtitle': 'Read-only display of core config parameters loaded from backend environment variables.',
    'config.gatewayConfigTitle': 'LiteLLM Gateway Config',
    'config.virtualKeyConfigured': 'Virtual Key Configured',
    'config.virtualKeyNotConfigured': 'Virtual Key Not Configured',
    'config.agentStrategyTitle': 'Agent Execution Strategy',
    'config.maxIterationsDesc': 'Max loop thinking iterations.',
    'config.sandboxUpgradeFailed': 'Failed to upgrade sandbox',
    'config.notConfigured': 'Not Configured',

    'rules.noRules': 'No Rules',
    'rules.selectRule': 'Select a rule from the left to view details',
    'rules.testMatch': 'Run Test',
    'rules.builtinWarning': 'Modifying built-in rules will override default behavior.',
    'rules.cancel': 'Cancel',
"""

content = content.replace("'config.title': 'Agent 配置',", "'config.title': 'Agent 配置'," + zh_keys)
content = content.replace("'config.title': 'Agent Config',", "'config.title': 'Agent Config'," + en_keys)

with open("frontend/src/i18n.tsx", "w") as f:
    f.write(content)
