export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public payload?: unknown) { super(message); }
}

const REQUEST_TIMEOUT_MS = 15000;

type ApiOptions = RequestInit & { timeoutMs?: number };

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers);
  if (fetchOptions.body && !(fetchOptions.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  fetchOptions.signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const response = await fetch(path, { ...fetchOptions, headers, credentials: "include", signal: controller.signal });
    const contentType = response.headers.get("content-type") ?? "";
    const data = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const payload = data as { error?: string; message?: string };
      throw new ApiError(response.status, payload?.error ?? "REQUEST_FAILED", payload?.message ?? `请求失败 (${response.status})`, data);
    }
    return data as T;
  } catch (error) {
    if (controller.signal.aborted && !fetchOptions.signal?.aborted) throw new ApiError(408, "TIMEOUT", "请求超时，请检查网络后重试");
    throw error;
  } finally {
    window.clearTimeout(timeout);
    fetchOptions.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export const apiJson = <T>(path: string, method: string, body?: unknown) => api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
