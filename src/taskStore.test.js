import test from 'node:test'
import assert from 'node:assert/strict'
import { setSessionUser } from './session.js'
import { saveTask, getTask, getAllTasks, clearAllTasks } from './taskStore.js'

function storage(t, initial = null) {
  setSessionUser('test')
  t.after(() => setSessionUser(null))
  let value = initial
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => value, setItem: (_key, next) => { value = next } },
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete globalThis.localStorage
  })
  return (next) => { value = next }
}

test('invalid cached JSON shapes do not crash task operations', (t) => {
  const setRaw = storage(t)
  for (const raw of ['null', '{}', '42', '[null,{},7]', 'broken']) {
    setRaw(raw)
    assert.deepEqual(getAllTasks(), [])
    saveTask({ taskId: 'new', status: 'processing' })
    assert.equal(getTask('new').status, 'processing')
  }
})

test('clearing history preserves running tasks and other platforms', (t) => {
  storage(t)
  saveTask({ taskId: 'running', status: 'processing', platform: 'douyin' })
  saveTask({ taskId: 'finished', status: 'completed', platform: 'douyin' })
  saveTask({ taskId: 'other', status: 'failed', platform: 'xiaohongshu' })
  clearAllTasks('douyin', true)
  assert.equal(getTask('finished'), null)
  assert.ok(getTask('running'))
  assert.ok(getTask('other'))
})

test('poll updates preserve a manually edited draft', (t) => {
  storage(t)
  saveTask({ taskId: 'draft', _manualPreviewText: 'my draft', preview: { text: 'my draft' } })
  saveTask({ taskId: 'draft', preview: { text: 'old server draft', images: ['image'] } })
  assert.equal(getTask('draft').preview.text, 'my draft')
  assert.deepEqual(getTask('draft').preview.images, ['image'])
})
