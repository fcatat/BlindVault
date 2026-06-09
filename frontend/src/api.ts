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

// 统一错误处理，支持解包 FastAPI 422 验证报错
async function throwError(res: Response): Promise<never> {
  const err = await res.json().catch(() => ({}));
  let errMsg = err.detail;
  if (Array.isArray(err.detail)) {
    // 针对 422 validation_error 展开为清晰的中文字符串
    errMsg = err.detail.map((d: any) => `${d.loc.join('.')}: ${d.msg}`).join('; ');
  } else if (typeof err.detail === 'object' && err.detail !== null) {
    errMsg = JSON.stringify(err.detail);
  }
  throw new Error(errMsg || `请求失败: ${res.status}`);
}

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
  confirmed?: boolean;
}

export interface AgentRunResponse {
  reply: string;
  tool_calls: Array<{
    tool: string;
    args: Record<string, string>;
  }>;
  secret_refs_used: string[];
  sanitized_input: string;
  leak_detected?: boolean;
  leaked_value?: string;
  status?: string;
  requires_approval?: boolean;
  pending_command?: string;
  triggered_rule?: string;
  plan?: TaskPlan;
}


export interface TaskPlanStep {
  index: number;
  title: string;
  command: string;
  secret_ref: string | null;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  stdout: string | null;
  stderr: string | null;
}


export interface TaskPlan {
  id: string;
  steps: TaskPlanStep[];
}


// ---- API 函数 ----

export async function createSecret(sessionId: string, payload: CreateSecretPayload): Promise<SecretResponse> {
  const res = await fetch(`${API_BASE}/secrets`, {
    method: 'POST',
    headers: getHeaders(sessionId),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    await throwError(res);
  }
  return res.json();
}

export async function listSecrets(sessionId: string): Promise<SecretMetadata[]> {
  const res = await fetch(`${API_BASE}/secrets`, {
    headers: getHeaders(sessionId),
  });
  if (!res.ok) throw new Error(`获取 secret 列表失败: ${res.status}`);
  return res.json();
}

export async function revokeSecret(sessionId: string, secretRef: string): Promise<void> {
  const res = await fetch(`${API_BASE}/secrets/${secretRef}/revoke`, {
    method: 'POST',
    headers: getHeaders(sessionId),
  });
  if (!res.ok) {
    await throwError(res);
  }
}

export async function runAgent(payload: AgentRunPayload, signal?: AbortSignal): Promise<AgentRunResponse> {
  const res = await fetch(`${API_BASE}/agent/run`, {
    method: 'POST',
    headers: getHeaders(payload.session_id),
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    await throwError(res);
  }
  return res.json();
}


// ---- Config 类型 ----

export interface LLMConfig {
  llm_provider: string;
  llm_model: string;
  llm_base_url: string;
  has_api_key: boolean;
  system_prompt: string;
  // 企业版：本地模型网关
  local_model_url: string;
  local_model_name: string;
  local_model_timeout: number;
  local_model_api_type: string;
  local_model_prompt: string;
  local_model_disable_cot: boolean;
  // 运行与安全决策
  agent_max_retries: number;
  agent_high_risk_commands: string;
  agent_approval_required: boolean;
}

export interface LLMConfigUpdate {
  llm_provider: string;
  llm_model: string;
  llm_base_url: string;
  llm_api_key: string;
  // 企业版：本地模型网关
  local_model_url?: string;
  local_model_name?: string;
  local_model_timeout?: number;
  local_model_api_type?: string;
  local_model_prompt?: string;
  local_model_disable_cot?: boolean;
  // 运行与安全决策
  agent_max_retries?: number;
  agent_high_risk_commands?: string;
  agent_approval_required?: boolean;
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
    await throwError(res);
  }
  return res.json();
}

export interface ConnectionCheckResult {
  success: boolean;
  status: 'connected' | 'auth_error' | 'network_error' | 'mock';
  detail: string;
}

export async function checkLlmConnection(): Promise<ConnectionCheckResult> {
  const res = await fetch(`${API_BASE}/config/check`, {
    method: 'POST',
    headers: DEFAULT_HEADERS,
  });
  if (!res.ok) {
    await throwError(res);
  }
  return res.json();
}


export async function healthCheck(): Promise<{ status: string }> {
  const res = await fetch('/health');
  if (!res.ok) throw new Error('健康检查失败');
  return res.json();
}

// ---- Sandbox 类型 ----

export interface SandboxStatus {
  status: 'healthy' | 'offline' | string;
  version: string;
  tools: string[];
}

// ---- Sandbox API ----

export async function getSandboxStatus(): Promise<SandboxStatus> {
  const res = await fetch(`${API_BASE}/config/sandbox/status`, {
    headers: DEFAULT_HEADERS,
  });
  if (!res.ok) throw new Error(`获取沙箱状态失败: ${res.status}`);
  return res.json();
}

export async function upgradeSandbox(): Promise<SandboxStatus> {
  const res = await fetch(`${API_BASE}/config/sandbox/upgrade`, {
    method: 'POST',
    headers: DEFAULT_HEADERS,
  });
  if (!res.ok) {
    await throwError(res);
  }
  return res.json();
}

// ---- 企业版：本地模型网关 ----

export interface LocalModelStatus {
  available: boolean;
  models: string[];
  error: string;
}

export async function checkLocalModel(url?: string, apiType?: string, modelName?: string): Promise<LocalModelStatus> {
  let endpoint = `${API_BASE}/config/local-model/check`;
  const params = new URLSearchParams();
  if (url) params.append('url', url);
  if (apiType) params.append('api_type', apiType);
  if (modelName) params.append('model_name', modelName);
  if (params.toString()) {
    endpoint += `?${params.toString()}`;
  }

  const res = await fetch(endpoint, {
    headers: DEFAULT_HEADERS,
  });
  if (!res.ok) throw new Error(`本地模型检测失败: ${res.status}`);
  return res.json();
}

// ---- 企业版许可状态 ----

export interface EEStatus {
  edition: string;
  licensed: boolean;
  features: string[];
}

export async function checkEEStatus(): Promise<EEStatus> {
  try {
    const res = await fetch(`${API_BASE}/ee/status`, {
      headers: DEFAULT_HEADERS,
    });
    if (!res.ok) {
      return { edition: 'community', licensed: false, features: [] };
    }
    return res.json();
  } catch {
    return { edition: 'community', licensed: false, features: [] };
  }
}


// ============================================================
// 定时任务 (Scheduled Tasks) 与步骤执行 (Plan Steps)
// ============================================================

export interface ScheduledTask {
  id: string;
  user_id: string;
  session_id: string;
  tenant_id: string;
  label: string;
  command: string;
  secret_ref: string | null;
  cron_expression: string | null;
  delay_seconds: number | null;
  next_run_at: string;
  status: 'active' | 'paused' | 'completed' | 'failed';
  created_at: string;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_output: string | null;
}

export interface RunPlanStepPayload {
  command: string;
  secret_ref?: string;
  session_id: string;
}

export interface RunPlanStepResponse {
  exit_code: number;
  stdout: string;
  stderr: string;
  status: 'success' | 'error';
}

export async function listScheduledTasks(sessionId: string): Promise<ScheduledTask[]> {
  const res = await fetch(`${API_BASE}/tasks`, {
    headers: getHeaders(sessionId),
  });
  if (!res.ok) throw new Error(`获取计划任务列表失败: ${res.status}`);
  return res.json();
}

export async function pauseScheduledTask(sessionId: string, taskId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/pause`, {
    method: 'POST',
    headers: getHeaders(sessionId),
  });
  if (!res.ok) await throwError(res);
}

export async function resumeScheduledTask(sessionId: string, taskId: string): Promise<{ status: string; next_run_at: string }> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/resume`, {
    method: 'POST',
    headers: getHeaders(sessionId),
  });
  if (!res.ok) await throwError(res);
  return res.json();
}

export async function deleteScheduledTask(sessionId: string, taskId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}`, {
    method: 'DELETE',
    headers: getHeaders(sessionId),
  });
  if (!res.ok) await throwError(res);
}

export async function getScheduledTaskLogs(sessionId: string, taskId: string): Promise<{ task_id: string; last_run_at: string | null; last_run_status: string | null; output: string }> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/logs`, {
    headers: getHeaders(sessionId),
  });
  if (!res.ok) await throwError(res);
  return res.json();
}

export async function runPlanStep(sessionId: string, payload: RunPlanStepPayload): Promise<RunPlanStepResponse> {
  const res = await fetch(`${API_BASE}/agent/run_plan_step`, {
    method: 'POST',
    headers: getHeaders(sessionId),
    body: JSON.stringify(payload),
  });
  if (!res.ok) await throwError(res);
  return res.json();
}


