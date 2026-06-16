import re

with open("frontend/src/i18n.tsx", "r") as f:
    content = f.read()

zh_keys = """
    'rules.newRule': '新建规则',
    'rules.restoreDefaults': '恢复默认',
    'rules.changesNewSession': '规则改动将在新会话生效',
    'rules.builtin': '默认',
    'rules.custom': '自定义',
    'rules.enable': '启用',
    'rules.disable': '禁用',
    'rules.edit': '编辑',
    'rules.delete': '删除',
    'rules.confirmDelete': '确定要删除这条规则吗？',
    'rules.aiWarning': '⚠️ AI 生成，请人工核对',
    'rules.customWarning': '⚠️ 自定义规则错误可能导致密码未被脱敏，请用测试框充分验证。',
    'rules.wizardStep1': '1. 示例输入',
    'rules.wizardStep2': '2. AI 生成',
    'rules.wizardStep3': '3. 测试调试',
    'rules.wizardSamplesDesc': '输入 1-N 条样例文本，以及一句描述。',
    'rules.wizardTestPlaceholder': '在此处输入文本实时测试...',
    'rules.wizardCaptureGroup': '捕获组索引',
    'rules.saveConfirm': '保存并入库',
    'rules.testHits': '命中测试：',
"""

en_keys = """
    'rules.newRule': 'New Rule',
    'rules.restoreDefaults': 'Restore Defaults',
    'rules.changesNewSession': 'Rules changes take effect in new sessions',
    'rules.builtin': 'Built-in',
    'rules.custom': 'Custom',
    'rules.enable': 'Enable',
    'rules.disable': 'Disable',
    'rules.edit': 'Edit',
    'rules.delete': 'Delete',
    'rules.confirmDelete': 'Are you sure you want to delete this rule?',
    'rules.aiWarning': '⚠️ AI Generated, please verify manually',
    'rules.customWarning': '⚠️ Incorrect custom rules may cause passwords to be exposed. Please test thoroughly.',
    'rules.wizardStep1': '1. Samples',
    'rules.wizardStep2': '2. AI Generation',
    'rules.wizardStep3': '3. Test & Debug',
    'rules.wizardSamplesDesc': 'Provide 1-N sample texts and a brief description.',
    'rules.wizardTestPlaceholder': 'Type here to test live...',
    'rules.wizardCaptureGroup': 'Capture Group',
    'rules.saveConfirm': 'Save Rule',
    'rules.testHits': 'Match Hits:',
"""

content = content.replace("'rules.addRule': '添加新规则',", "'rules.addRule': '添加新规则'," + zh_keys)
content = content.replace("'rules.addRule': 'Add New Rule',", "'rules.addRule': 'Add New Rule'," + en_keys)

with open("frontend/src/i18n.tsx", "w") as f:
    f.write(content)
