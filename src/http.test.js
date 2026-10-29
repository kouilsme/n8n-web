import test from 'node:test'
import assert from 'node:assert/strict'
import { request, ApiError } from './http.js'

test('request includes cookies and merges caller headers', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.credentials, 'include')
    assert.equal(options.headers['Content-Type'], 'application/json')
    assert.equal(options.headers['X-Test'], 'ok')
    return new Response('[{"success":true}]')
  })
  assert.deepEqual(await request('/test', { headers: { 'X-Test': 'ok' } }), { success: true })
})

test('HTML, null, primitive and empty status responses are never reported as success', async (t) => {
  for (const body of ['<html>proxy error</html>', 'null', 'false', '42', '[]', '']) {
    const mock = t.mock.method(globalThis, 'fetch', async () => new Response(body))
    await assert.rejects(request('/status'), (err) => err instanceof ApiError && err.retryable)
    mock.mock.restore()
  }
})

test('empty workflow acknowledgements remain supported explicitly', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }))
  assert.equal((await request('/start', { method: 'POST', allowEmpty: true })).status, 'processing')
})

test('HTTP status is preserved even when the error body is HTML', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>login</html>', { status: 401 }))
  await assert.rejects(request('/me'), (err) => err.status === 401 && !err.retryable)
})

test('server errors and rate limits can be retried, validation errors cannot', async (t) => {
  for (const [status, retryable] of [[429, true], [503, true], [400, false], [404, false]]) {
    const mock = t.mock.method(globalThis, 'fetch', async () =>
      new Response('{"message":"example"}', { status }))
    await assert.rejects(request('/test'), (err) =>
      err.message === 'example' && err.status === status && err.retryable === retryable)
    mock.mock.restore()
  }
})

test('request timeout also covers a stalled response body', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => ({
    ok: true,
    text: () => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }),
  }))
  const pending = request('/status', { timeoutMs: 100 })
  const check = assert.rejects(pending, (err) => err instanceof ApiError && /超时/.test(err.message))
  await Promise.resolve()
  t.mock.timers.tick(100)
  await check
})

test('caller cancellation propagates and does not become a timeout error', async (t) => {
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }))
  const controller = new AbortController()
  const pending = request('/status', { signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})
