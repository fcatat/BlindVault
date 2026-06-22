// frontend/src/agentApi.ts

const API_BASE = '/api';

function getHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
  };
}

export type SSEEventType =
  | 'thinking'
  | 'plan'
  | 'tool_start'
  | 'tool_end'
  | 'retry'
  | 'interrupt'
  | 'done'
  | 'error'
  | 'sanitized'
  | 'credential_blocked'
  | 'approval_required';

export interface SSEEvent {
  type: SSEEventType;
  data: any;
}

export async function streamAgent(
  message: string,
  threadId: string,
  onEvent: (event: SSEEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const params = new URLSearchParams({
    message,
    thread_id: threadId,
  });

  const res = await fetch(`${API_BASE}/chat/stream?${params}`, {
    headers: getHeaders(),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    onEvent({ type: 'error', data: { error: errText } });
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const raw of parts) {
        const lines = raw.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const parsed: SSEEvent = JSON.parse(line.slice(6));
              onEvent(parsed);
            } catch {
              // skip parse error
            }
          }
        }
      }
    }
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      onEvent({ type: 'error', data: { error: err.message } });
    }
  }
}

export async function approveAgent(threadId: string, decision: 'approve' | 'reject'): Promise<any> {
  const res = await fetch(`${API_BASE}/approve`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ thread_id: threadId, decision }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `请求失败: ${res.status}`);
  }
  return res.json();
}

// ---- Rules API ----
export interface SanitizeRule {
  id: string;
  name: string;
  pattern: string;
  secret_type: string;
  label: string;
  capture_group: number;
  enabled: boolean;
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
}

export async function listRules(): Promise<SanitizeRule[]> {
  const res = await fetch(`${API_BASE}/sanitize-rules`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to list rules');
  return res.json();
}

export async function createRule(payload: Partial<SanitizeRule>): Promise<SanitizeRule> {
  const res = await fetch(`${API_BASE}/sanitize-rules`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to create rule');
  }
  return res.json();
}

export async function updateRule(id: string, payload: Partial<SanitizeRule>): Promise<SanitizeRule> {
  const res = await fetch(`${API_BASE}/sanitize-rules/${id}`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to update rule');
  }
  return res.json();
}

export async function deleteRule(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/sanitize-rules/${id}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to delete rule');
}

export async function restoreDefaults(): Promise<void> {
  const res = await fetch(`${API_BASE}/sanitize-rules/restore-defaults`, {
    method: 'POST',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to restore defaults');
}

export async function aiSuggestRule(samples: string[], description: string): Promise<any> {
  const res = await fetch(`${API_BASE}/sanitize-rules/ai-suggest`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ samples, description }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to suggest rule');
  }
  return res.json();
}

export async function testRule(pattern: string, captureGroup: number, testText: string): Promise<{ matches: any[] }> {
  const res = await fetch(`${API_BASE}/sanitize-rules/test`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ pattern, capture_group: captureGroup, test_text: testText }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to test rule');
  }
  return res.json();
}

// EE Local Model endpoints
export async function getLocalModelConfig(): Promise<any> {
  const res = await fetch(`${API_BASE}/local-model/config`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch local model config');
  return res.json();
}

export async function updateLocalModelConfig(config: any): Promise<void> {
  const res = await fetch(`${API_BASE}/local-model/config`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error('Failed to update local model config');
}

export async function checkLocalModel(config: any): Promise<any> {
  const res = await fetch(`${API_BASE}/local-model/check`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error('Failed to check local model');
  return res.json();
}

// ---- Audit Log ----
export interface AuditEvent {
  id: number;
  ts: string;
  actor: string;
  action: string;
  target_type: string;
  target_id: string;
  details: any;
  ip: string;
}

export async function getAuditLog(params: {
  actor?: string;
  action?: string;
  target_type?: string;
  ts_from?: string;
  ts_to?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: AuditEvent[], total: number }> {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') {
      query.set(k, String(v));
    }
  }
  const res = await fetch(`${API_BASE}/audit-log?${query}`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch audit log');
  return res.json();
}
