import { mergeResultMetadata, mergeResultPreview, normalizeStatus } from './workflowTaskResult.js'

const TERMINAL = ['COMPLETED', 'FAILED']

export async function persistWorkflowResult(db, userId, taskId, result) {
  const find = () => db.workflowTask.findFirst({ where: { userId, taskId } })
  const task = await find()
  if (!task || TERMINAL.includes(task.status)) return task
  if (result.success === false && result.status !== 'failed') return task

  const status = normalizeStatus(result)
  // A cancellation or user action may complete while n8n is responding.
  // Compare the revision so the old result cannot overwrite that newer write.
  await db.workflowTask.updateMany({
    where: { userId, taskId, updatedAt: task.updatedAt, status: { notIn: TERMINAL } },
    data: {
      status,
      resultPreview: mergeResultPreview(task.resultPreview, task.metadata, result.preview),
      errorMessage: status === 'FAILED' ? (result.message || '工作流执行失败') : null,
      completedAt: TERMINAL.includes(status) ? new Date() : undefined,
      metadata: mergeResultMetadata(task.metadata, result),
    },
  })
  return find()
}
