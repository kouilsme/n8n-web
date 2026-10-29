import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeTasks } from './taskMerge.js'

test('cached history cannot overwrite newer local progress', () => {
  const [task] = mergeTasks(
    [{ taskId: '1', status: 'completed', updatedAt: 20, preview: { text: 'final' } }],
    [{ taskId: '1', status: 'processing', updatedAt: 10 }],
  )
  assert.equal(task.status, 'completed')
  assert.equal(task.preview.text, 'final')
})

test('newer server artifacts are merged while local manual text is preserved', () => {
  const [task] = mergeTasks(
    [{ taskId: '1', updatedAt: 10, _manualPreviewText: '', preview: { text: '' } }],
    [{ taskId: '1', updatedAt: 20, status: 'completed', preview: { text: 'stale', images: ['new'] } }],
  )
  assert.equal(task.status, 'completed')
  assert.equal(task.preview.text, '')
  assert.deepEqual(task.preview.images, ['new'])
})

test('task history is deduplicated and sorted newest first', () => {
  const tasks = mergeTasks([{ taskId: 'old', createdAt: 1 }], [
    { taskId: 'new', createdAt: 2 }, { taskId: 'old', createdAt: 1 },
  ])
  assert.deepEqual(tasks.map((task) => task.taskId), ['new', 'old'])
})
