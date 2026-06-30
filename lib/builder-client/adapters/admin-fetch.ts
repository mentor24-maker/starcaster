/**
 * Admin fetch helpers. Handles both error envelope shapes:
 * `{ error: string }` and `{ ok: false, error: { message, code } }`.
 */

type AdminApiPayload = {
  error?: string | { message?: string; code?: string };
  code?: string;
  message?: string;
};

function errorMessageFrom(payload: AdminApiPayload, fallbackMessage: string): string {
  const err = payload.error;
  if (typeof err === 'string' && err.trim()) return err;
  if (err && typeof err === 'object' && typeof err.message === 'string' && err.message.trim()) {
    return err.message;
  }
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
  return fallbackMessage;
}

export async function parseAdminJsonResponse<T>(
  response: Response,
  fallbackMessage: string
): Promise<T> {
  const contentType = response.headers.get('content-type') ?? '';

  if (!contentType.includes('application/json')) {
    const text = await response.text();
    const preview = text.replace(/\s+/g, ' ').trim().slice(0, 160);
    const target = response.url ? ` ${response.url}` : '';
    throw new Error(
      `${fallbackMessage}${target} returned ${response.status} ${response.statusText || 'non-JSON'}: ${preview || 'No response body.'}`
    );
  }

  return (await response.json()) as T;
}

export async function readAdminJson<T>(
  response: Response,
  fallbackMessage: string
): Promise<T> {
  const data = await parseAdminJsonResponse<T>(response, fallbackMessage);

  if (!response.ok) {
    const payload = data as AdminApiPayload;
    if (response.status === 401) {
      throw new Error('Your session expired. Sign in again, then retry.');
    }
    throw new Error(errorMessageFrom(payload, fallbackMessage));
  }

  return data;
}
