import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowTask } from './createWorkflowTask.js'

test('concurrent starts with the same id create once and do not reset another task', async () => {
  let current
  const db = { workflowTask: {
    create: async ({ data }) => {
      if (current) throw Object.assign(new Error('duplicate'), { code: 'P2002' })
      current = data
      return current
    },
    findFirst: async ({ where }) => current.userId === where.userId ? current : null,
  } }
  const results = await Promise.all([1, 2].map(() => createWorkflowTask(db, 'owner', 'task', 'douyin', { original: true })))
  assert.equal(results.filter((r) => r.created).length, 1)
  current.status = 'COMPLETED'
  const repeat = await createWorkflowTask(db, 'owner', 'task', 'douyin', { original: false })
  assert.equal(repeat.created, false)
  assert.equal(current.status, 'COMPLETED')
  assert.deepEqual(current.inputParams, { original: true })
  await assert.rejects(createWorkflowTask(db, 'attacker', 'task', 'douyin', {}), (err) => err.status === 409)
})
