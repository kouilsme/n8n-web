import test from 'node:test'
import assert from 'node:assert/strict'
import { persistWorkflowResult } from './persistWorkflowResult.js'

function database(beforeUpdate) {
  let current = { taskId: 'task', userId: 'owner', status: 'PROCESSING', updatedAt: 1, metadata: {} }
  let writes = 0
  const db = { workflowTask: {
    findFirst: async ({ where }) => where.userId === current.userId ? structuredClone(current) : null,
    updateMany: async ({ where, data }) => {
      writes++
      current = beforeUpdate?.(current) || current
      assert.equal(where.userId, 'owner')
      if (where.updatedAt !== current.updatedAt || where.status.notIn.includes(current.status)) return { count: 0 }
      current = { ...current, ...data, updatedAt: current.updatedAt + 1 }
      return { count: 1 }
    },
  } }
  return { db, get current() { return current }, get writes() { return writes } }
}

test('a late status query cannot revive a cancelled task', async () => {
  const store = database((task) => ({ ...task, status: 'FAILED', updatedAt: 2, errorMessage: 'cancelled' }))
  const task = await persistWorkflowResult(store.db, 'owner', 'task', { status: 'completed' })
  assert.equal(task.status, 'FAILED')
  assert.equal(task.errorMessage, 'cancelled')
})

test('a late status query cannot overwrite a newer confirmed draft', async () => {
  const store = database((task) => ({ ...task, updatedAt: 2, metadata: { confirmedText: 'new draft' } }))
  const task = await persistWorkflowResult(store.db, 'owner', 'task', { preview: { text: 'old draft' } })
  assert.equal(task.metadata.confirmedText, 'new draft')
})

test('owned results are persisted while initialization races are ignored', async () => {
  const store = database()
  await persistWorkflowResult(store.db, 'owner', 'task', { success: false, status: 'processing' })
  assert.equal(store.writes, 0)
  const task = await persistWorkflowResult(store.db, 'owner', 'task', { status: 'completed' })
  assert.equal(task.status, 'COMPLETED')
  assert.ok(task.completedAt)
  assert.equal(await persistWorkflowResult(store.db, 'other', 'task', { status: 'failed' }), null)
  assert.equal(store.writes, 1)
})
