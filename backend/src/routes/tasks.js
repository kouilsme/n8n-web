import express from 'express'
import { prisma } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { toClientTask } from '../utils/clientTask.js'

export const tasksRouter = express.Router()

tasksRouter.use(requireAuth)

tasksRouter.get('/', async (req, res, next) => {
  try {
    const tasks = await prisma.workflowTask.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    res.json({ success: true, tasks: tasks.map(toClientTask) })
  } catch (err) {
    next(err)
  }
})

tasksRouter.get('/:taskId', async (req, res, next) => {
  try {
    const task = await prisma.workflowTask.findFirst({
      where: {
        taskId: req.params.taskId,
        userId: req.user.id,
      },
    })

    if (!task) {
      return res.status(404).json({ success: false, message: '任务不存在' })
    }

    res.json({ success: true, task: toClientTask(task) })
  } catch (err) {
    next(err)
  }
})

