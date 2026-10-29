import test from 'node:test'
import assert from 'node:assert/strict'
import { createPoller } from './statusPoller.js'

const flush = () => new Promise((resolve) => setImmediate(resolve))

function setup(t, query, options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const updates = []
  const errors = []
  const stop = createPoller({
    query, onUpdate: (result) => updates.push(result), onError: (err) => errors.push(err),
    interval: 100, timeout: 10000, ...options,
  })
  t.after(stop)
  return { stop, updates, errors, tick: async (ms) => { t.mock.timers.tick(ms); await flush() } }
}

test('retries a transient error with backoff and resets after recovery', async (t) => {
  let calls = 0
  const runner = setup(t, async () => {
    calls += 1
    if (calls === 1 || calls === 3) throw new TypeError('offline')
    return { status: 'processing' }
  })
  await runner.tick(100)
  assert.equal(calls, 1)
  await runner.tick(199)
  assert.equal(calls, 1)
  await runner.tick(1)
  assert.equal(runner.updates.length, 1)
  await runner.tick(100)
  await runner.tick(200)
  assert.equal(calls, 4)
  assert.equal(runner.updates.length, 2)
  assert.equal(runner.errors.length, 0)
})

test('stops after bounded consecutive failures', async (t) => {
  let calls = 0
  const runner = setup(t, async () => { calls++; throw new Error('offline') }, { maxRetries: 1 })
  await runner.tick(100)
  await runner.tick(200)
  await runner.tick(1000)
  assert.equal(calls, 2)
  assert.equal(runner.errors.length, 1)
})

test('does not retry an authorization failure', async (t) => {
  const runner = setup(t, async () => { throw Object.assign(new Error('login'), { retryable: false }) })
  await runner.tick(100)
  assert.equal(runner.errors.length, 1)
})

test('stop aborts in-flight work and ignores its late response', async (t) => {
  let resolve, signal
  const runner = setup(t, (incoming) => {
    signal = incoming
    return new Promise((done) => { resolve = done })
  })
  await runner.tick(100)
  runner.stop()
  assert.equal(signal.aborted, true)
  resolve({ status: 'completed' })
  await flush()
  await runner.tick(1000)
  assert.deepEqual(runner.updates, [])
  assert.deepEqual(runner.errors, [])
})

test('slow requests never overlap', async (t) => {
  let calls = 0, resolve
  const runner = setup(t, () => { calls++; return new Promise((done) => { resolve = done }) })
  await runner.tick(100)
  await runner.tick(500)
  assert.equal(calls, 1)
  resolve({ status: 'processing' })
  await flush()
  await runner.tick(100)
  assert.equal(calls, 2)
})

test('waiting for review does not exhaust generation timeout', async (t) => {
  let status = 'waiting_user_feedback'
  const runner = setup(t, async () => ({ status }), { timeout: 300 })
  for (let i = 0; i < 6; i++) await runner.tick(100)
  assert.equal(runner.errors.length, 0)
  status = 'processing'
  await runner.tick(100)
  await runner.tick(100)
  await runner.tick(100)
  assert.equal(runner.errors.length, 1)
})

for (const result of [{ status: 'completed' }, { status: 'failed' }, { stepName: 'douyin_batch_completed' }]) {
  test(`stops on terminal result ${JSON.stringify(result)}`, async (t) => {
    let calls = 0
    const runner = setup(t, async () => { calls++; return result })
    await runner.tick(100)
    await runner.tick(1000)
    assert.equal(calls, 1)
    assert.equal(runner.updates.length, 1)
  })
}
