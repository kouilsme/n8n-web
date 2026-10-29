import test from 'node:test'
import assert from 'node:assert/strict'
import { requestSecurity } from '../middleware/requestSecurity.js'
import { validateProductionSecurity } from './productionSecurity.js'
import { hasImageSignature } from './imageSignature.js'

function check({ method = 'POST', origin, marker = 'WorkflowStudio', json = true } = {}) {
  let status = 200, next = false
  const req = { method, is: () => json, get: (name) => ({ Origin: origin, 'X-Workflow-Client': marker })[name] }
  const res = { status: (code) => { status = code; return res }, json: () => {} }
  requestSecurity('https://studio.example.com')(req, res, () => { next = true })
  return { status, next }
}

test('unsafe requests reject foreign origins and simple cross-site forms', () => {
  assert.equal(check({ origin: 'https://evil.example.com' }).status, 403)
  assert.equal(check({ origin: 'https://studio.example.com', marker: null }).status, 403)
  assert.equal(check({ marker: '' }).status, 403)
  assert.equal(check({ origin: 'https://studio.example.com', json: false }).status, 415)
  assert.equal(check({ origin: 'https://studio.example.com' }).next, true)
  assert.equal(check().next, true, 'explicit API clients can send the custom header without a browser Origin')
  assert.equal(check({ method: 'GET', marker: '', json: false }).next, true)
})

test('production refuses placeholder signing keys, HTTP origins and insecure cookies', () => {
  const valid = { NODE_ENV: 'production', SESSION_SECRET: 'q'.repeat(64),
    FRONTEND_ORIGIN: 'https://studio.example.com', PUBLIC_BASE_URL: 'https://studio.example.com' }
  assert.doesNotThrow(() => validateProductionSecurity(valid))
  for (const patch of [{ SESSION_SECRET: 'short' }, { SESSION_SECRET: 'replace-with-a-long-secret-at-least-32-chars' },
    { COOKIE_SECURE: 'false' }, { FRONTEND_ORIGIN: 'http://studio.example.com' },
    { FRONTEND_ORIGIN: 'https://studio.example.com/path' }, { PUBLIC_BASE_URL: 'https://user:secret@example.com' }]) {
    assert.throws(() => validateProductionSecurity({ ...valid, ...patch }))
  }
  assert.doesNotThrow(() => validateProductionSecurity({ NODE_ENV: 'development' }))
})

test('declaring HTML as a picture does not satisfy image signatures', () => {
  const html = Buffer.from('<script>alert(1)</script>')
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) assert.equal(hasImageSignature(html, type), false)
  assert.equal(hasImageSignature(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png'), true)
  assert.equal(hasImageSignature(Buffer.from([255, 216, 255]), 'image/jpeg'), true)
  assert.equal(hasImageSignature(Buffer.from('RIFFxxxxWEBP'), 'image/webp'), true)
  assert.equal(hasImageSignature(Buffer.alloc(0), 'image/png'), false)
})
