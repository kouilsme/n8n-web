const API_BASE = import.meta.env?.VITE_API_BASE_URL || ''

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.retryable = status === 0 || status === 408 || status === 429 || status >= 500
  }
}

// Only workflow action endpoints may acknowledge a request with an empty body.
export async function request(path, options = {}) {
  const { timeoutMs = 75000, allowEmpty = false, signal, headers, ...fetchOptions } = options
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...fetchOptions,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...headers },
      signal: controller.signal,
    })
    const text = await res.text()
    let data
    try {
      data = text.trim() ? JSON.parse(text) : null
    } catch {
      // Preserve the HTTP status below, including when a proxy returns HTML.
    }
    if (Array.isArray(data)) data = data[0]
    if (!res.ok) {
      throw new ApiError(data?.message || `请求失败：${res.status} ${res.statusText}`, res.status)
    }
    if (!text.trim() && allowEmpty) {
      return { success: true, status: 'processing', message: '操作已受理' }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ApiError('服务器返回了无效响应，请稍后重试', 502)
    }
    return data
  } catch (err) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new ApiError('请求超时，请稍后重试')
    }
    throw err
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
