export async function createWorkflowTask(db, userId, taskId, platform, inputParams) {
  try {
    const task = await db.workflowTask.create({
      data: { userId, taskId, platform, status: 'PROCESSING', inputParams },
    })
    return { created: true, task }
  } catch (err) {
    if (err.code !== 'P2002') throw err
    const task = await db.workflowTask.findFirst({ where: { userId, taskId } })
    if (!task) throw Object.assign(new Error('任务 ID 已存在或无权访问'), { status: 409 })
    return { created: false, task }
  }
}
