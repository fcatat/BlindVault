/**
 * BlindVault API 服务层
 *
 * 封装所有后端 API 调用。
 * 固定 Header：X-User-Id、X-Session-Id、X-Tenant-Id
 */

const API_BASE = '/api';

// MVP 固定用户（后续替换为 JWT）
function getHeaders(sessionId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-User-Id': 'demo_user',
    'X-Session-Id': sessionId,
    'X-Tenant-Id': 'default',
  };
}

// 兼容旧的不需要 session 的调用
const DEFAULT_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-User-Id': 'demo_user',
  'X-Session-Id': 'default',
  'X-Tenant-Id': 'default',
};

// ---- 类型 ----

export interface SecretResponse {
  secret_ref: string;
  placeholder: string;
  label: string;
  secret_type: string;
  allowed_tools: string[];
  allowed_destinations: string[];
  expires_at: string;
  reads_left: number;
  status: 'active' | 'revoked' | 'expired' | 'exhausted';
}

export interface SecretMetadata {
  secret_ref: string;
  label: string;
  secret_type: string;
  allowed_tools: string[];
  allowed_destinations: string[];
  expires_at: string;
  reads_left: number;
  status: 'active' | 'revoked' | 'expired' | 'exhausted';
}

export interface CreateSecretPayload {
  secret_type: string;
  label: string;
  value: string;
  allowed_tools: string[];
  allowed_destinations: string[];
  ttl_seconds: number;
  max_reads: number;
}

export interface AgentRunPayload {
  user_message: string;
  session_id: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface AgentRunResponse {
  reply: string;
  tool_calls: Array<{
    tool: string;
    args: Record<string, string>;
  }>;
  secret_refs_used: string[];
  sanitized_input: string;
}

// ---- API 函数 ----

export async function createSecret(payload: CreateSecretPayload): Promise<SecretResponse> {
  const res = await fetch(`${API_BASE}/secrets`, {
    method: 'POST',
    headers: DEFAULT_HEADERS,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `创建失败: ${res.status}`);
  }
  return res.json();
}

export async function listSecrets(): Promise<SecretMetadata[]> {
  const res = await fetch(`${API_BASE}/secrets`, {
    headers: DEFAULT_HEADERS,
  });
  if (!res.ok) throw new Error(`获取列表失败: ${res.status}`);
  return res.json();
}

export async function revokeSecret(secretRef: string): Promise<void> {
  const res = await fetch(`${API_BASE}/secrets/${secretRef}/revoke`, {
    method: 'POST',
    headers: DEFAULT_HEADERS,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `撤销失败: ${res.status}`);
  }
}

export async function runAgent(payload: AgentRunPayload): Promise<AgentRunResponse> {
  const res = await fetch(`${API_BASE}/agent/run`, {
    method: 'POST',
    headers: getHeaders(payload.session_id),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Agent 执行失败: ${res.status}`);
  }
  return res.json();
}

// ---- Config 类型 ----

export interface LLMConfig {
  llm_provider: string;
  llm_model: string;
  llm_base_url: string;
  has_api_key: boolean;
}

export interface LLMConfigUpdate {
  llm_provider: string;
  llm_model: string;
  llm_base_url: string;
  llm_api_key: string;
}

// ---- Config API ----

export async function getConfig(): Promise<LLMConfig> {
  const res = await fetch(`${API_BASE}/config`, {
    headers: DEFAULT_HEADERS,
  });
  if (!res.ok) throw new Error(`获取配置失败: ${res.status}`);
  return res.json();
}

export async function updateConfig(payload: LLMConfigUpdate): Promise<LLMConfig> {
  const res = await fetch(`${API_BASE}/config`, {
    method: 'PUT',
    headers: DEFAULT_HEADERS,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `更新配置失败: ${res.status}`);
  }
  return res.json();
}

export async function healthCheck(): Promise<{ status: string }> {
  const res = await fetch('/health');
  if (!res.ok) throw new Error('健康检查失败');
  return res.json();
}
