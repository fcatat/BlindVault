/**
 * BlindVault Enterprise Edition - 前端模块入口
 *
 * 企业版专属 UI 组件和页面：
 * - SSO 登录页面
 * - 审计日志仪表盘
 * - License 管理面板
 * - 多租户切换器
 *
 * 通过 API 检测后端是否启用了企业版 License，
 * 动态加载或隐藏企业版功能入口。
 */

/**
 * 检查后端是否启用了企业版功能
 * @returns {Promise<{edition: string, licensed: boolean, features: string[]}>}
 */
export async function checkEEStatus() {
  try {
    const resp = await fetch('/api/ee/status');
    if (!resp.ok) {
      return { edition: 'community', licensed: false, features: [] };
    }
    return await resp.json();
  } catch {
    return { edition: 'community', licensed: false, features: [] };
  }
}

/**
 * 判断是否应该显示企业版功能入口
 * @param {string} feature - 功能标识 (如 'sso', 'audit_export')
 * @param {string[]} enabledFeatures - 已激活的功能列表
 * @returns {boolean}
 */
export function isFeatureEnabled(feature, enabledFeatures) {
  return enabledFeatures.includes(feature);
}
