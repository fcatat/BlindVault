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
