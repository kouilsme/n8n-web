import test from 'node:test'
import assert from 'node:assert/strict'
import { registerTask, isRegistered, unregisterTask } from './backgroundPoller.js'
import { getTask, saveTask } from './taskStore.js'
import { setSessionUser } from './session.js'

const flush = () => new Promise((resolve) => setImmediate(resolve))

function setup(t) {
  const records = new Map()
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => records.get(key), setItem: (key, value) => records.set(key, value),
  } })
  setSessionUser('alice')
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  t.after(() => {
    setSessionUser(null)
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete globalThis.localStorage
  })
}

test('background image review accepts a newer index with a processing status', async (t) => {
  setup(t)
  saveTask({ taskId: 'review', status: 'image_review', currentXhsImageIndex: 0 })
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    status: 'processing', stepName: 'xhs_image_review', currentImageIndex: 1, xhsImages: [{ url: 'new' }],
  })))
  registerTask('review', 'xiaohongshu')
  t.mock.timers.tick(3000)
  await flush()
  assert.equal(getTask('review').currentXhsImageIndex, 1)
  assert.deepEqual(getTask('review').xhsImages, [{ url: 'new' }])
  unregisterTask('review')
})

test('background completion preserves final download artifacts on every video platform', async (t) => {
  setup(t)
  saveTask({ taskId: 'batch', platform: 'bilibili', status: 'processing' })
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    status: 'completed', stepName: 'douyin_batch_completed',
    downloadUrl: 'https://example.com/materials.zip', fileList: ['frame.png'],
    storyboardDocument: { title: 'storyboard' },
  })))
  registerTask('batch', 'bilibili')
  t.mock.timers.tick(3000)
  await flush()
  assert.equal(getTask('batch').downloadUrl, 'https://example.com/materials.zip')
  assert.deepEqual(getTask('batch').fileList, ['frame.png'])
  assert.deepEqual(getTask('batch').storyboardDocument, { title: 'storyboard' })
  assert.equal(isRegistered('batch'), false)
})

test('logout aborts background requests and late results cannot affect the next account', async (t) => {
  setup(t)
  let finish, signal
  saveTask({ taskId: 'old', status: 'processing' })
  t.mock.method(globalThis, 'fetch', (_url, options) => {
    signal = options.signal
    return new Promise((resolve) => { finish = resolve })
  })
  registerTask('old', 'xiaohongshu')
  t.mock.timers.tick(3000)
  assert.equal(isRegistered('old'), true)
  setSessionUser(null)
  assert.equal(signal.aborted, true)
  assert.equal(isRegistered('old'), false)
  registerTask('old', 'xiaohongshu')
  assert.equal(isRegistered('old'), false, 'unmount cannot restart polling after logout')
  setSessionUser('bob')
  finish(new Response('{"status":"completed"}'))
  await flush()
  assert.equal(getTask('old'), null)
  setSessionUser('alice')
  assert.equal(getTask('old').status, 'processing')
})
