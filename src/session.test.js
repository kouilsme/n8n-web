import test from 'node:test'
import assert from 'node:assert/strict'
import { getSession, isCurrentSession, setSessionUser, userStorageKey, handleSessionStorage, SESSION_STORAGE_KEY } from './session.js'
import { getAllTasks, saveTask } from './taskStore.js'

test('account changes invalidate old callbacks and isolate task and form storage', (t) => {
  const data = new Map([['wfs_task_records', '[{"taskId":"unknown-owner"}]']])
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value),
  } })
  t.after(() => {
    setSessionUser(null)
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete globalThis.localStorage
  })
  setSessionUser('alice')
  const alice = getSession()
  const aliceForm = userStorageKey('form_douyin')
  assert.deepEqual(getAllTasks(), [], 'unowned legacy records are not shown to a signed-in user')
  saveTask({ taskId: 'alice-task', status: 'processing' })
  setSessionUser('bob')
  assert.equal(alice.controller.signal.aborted, true)
  assert.equal(isCurrentSession(alice), false)
  assert.notEqual(userStorageKey('form_douyin'), aliceForm)
  assert.deepEqual(getAllTasks(), [])
  saveTask({ taskId: 'bob-task', status: 'completed' })
  setSessionUser('alice')
  assert.equal(isCurrentSession(alice), false, 'a fresh login must not revive callbacks from an earlier session')
  assert.deepEqual(getAllTasks().map((task) => task.taskId), ['alice-task'])
  setSessionUser(null)
  saveTask({ taskId: 'after-logout' })
  assert.deepEqual(getAllTasks(), [])
})

test('a sign-out or account switch in another tab invalidates this tab without overwriting its marker', () => {
  setSessionUser('alice')
  const previous = getSession()
  assert.equal(handleSessionStorage({ key: 'other', newValue: 'bob' }), false)
  assert.equal(handleSessionStorage({ key: SESSION_STORAGE_KEY, newValue: 'alice' }), false)
  assert.equal(handleSessionStorage({ key: SESSION_STORAGE_KEY, newValue: 'bob' }), true)
  assert.equal(previous.controller.signal.aborted, true)
  assert.equal(getSession().userId, null)
})
