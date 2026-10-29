import express from 'express'
import { randomUUID } from 'crypto'
import { prisma } from '../db.js'
import { config, getWebhookUrls, isVideoPlatform, normalizePlatform } from '../config.js'
import { requireAuth } from '../middleware/auth.js'

import { buildWorkflowStartResponse } from '../utils/workflowStartResponse.js'
import {
  buildActionPersistence,
  mergeResultMetadata,
  mergeResultPreview,
  normalizeStatus,
  terminalResult,
} from '../utils/workflowTaskResult.js'

export const workflowsRouter = express.Router()

workflowsRouter.use(requireAuth)

function isTerminal(status) {
  return status === 'COMPLETED' || status === 'FAILED'
}

async function parseResponse(res) {
  const text = await res.text()
  if (!text || text.trim() === '') {
    return { success: true, status: 'processing', message: '操作已受理' }
  }
  try {
    const data = JSON.parse(text)
    return Array.isArray(data) ? data[0] : data
  } catch {
    return { success: true, status: 'processing', message: '操作已受理' }
  }
}

async function postJson(url, body) {
  if (!url) throw new Error('对应的 n8n Webhook 尚未配置')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.n8nTimeoutMs)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      throw new Error(`n8n 请求失败：${res.status} ${res.statusText}`)
    }

    // Keep the timeout active until the response body has been consumed.
    return await parseResponse(res)
  } finally {
    clearTimeout(timer)
  }
}

async function getJson(url) {
  if (!url) throw new Error('对应的 n8n Webhook 尚未配置')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.n8nTimeoutMs)

  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) {
      throw new Error(`n8n 查询失败：${res.status} ${res.statusText}`)
    }
    const data = await res.json()
    return Array.isArray(data) ? data[0] : data
  } finally {
    clearTimeout(timer)
  }
}

async function findOwnedTask(userId, taskId) {
  return prisma.workflowTask.findFirst({
    where: { userId, taskId },
  })
}

async function updateTaskFromResult(userId, taskId, result) {
  const task = await findOwnedTask(userId, taskId)
  if (!task) return null

  const status = normalizeStatus(result)
  return prisma.workflowTask.update({
    where: { taskId: task.taskId },
    data: {
      status,
      resultPreview: mergeResultPreview(task.resultPreview, task.metadata, result.preview),
      errorMessage: status === 'FAILED' ? (result.message || '工作流执行失败') : null,
      completedAt: isTerminal(status) ? new Date() : undefined,
      metadata: mergeResultMetadata(task.metadata, result),
    },
  })
}

async function recordEvent({ userId, taskId, action, status, metadata }) {
  await prisma.workflowEvent.create({
    data: {
      userId,
      taskId,
      action,
      status,
      metadata,
    },
  })
}

workflowsRouter.post('/start', async (req, res, next) => {
  const platform = normalizePlatform(req.body?.platform)
  const sessionId = String(req.body?.sessionId || randomUUID())
  const params = req.body?.params || {}
  const urls = getWebhookUrls(platform)

  try {
    const existingTask = await prisma.workflowTask.findUnique({ where: { taskId: sessionId } })
    if (existingTask && existingTask.userId !== req.user.id) {
      return res.status(409).json({ success: false, message: '任务 ID 已存在' })
    }

    await prisma.workflowTask.upsert({
      where: { taskId: sessionId },
      create: {
        userId: req.user.id,
        platform,
        taskId: sessionId,
        status: 'PROCESSING',
        inputParams: params,
      },
      update: {
        status: 'PROCESSING',
        inputParams: params,
        errorMessage: null,
        completedAt: null,
      },
    })

    const result = await postJson(urls.START_WORKFLOW_URL, {
      platform,
      contentType: isVideoPlatform(platform) ? 'video' : 'article',
      sessionId,
      params,
    })
    await recordEvent({ userId: req.user.id, taskId: sessionId, action: 'start', status: 'success', metadata: result })

    res.json(buildWorkflowStartResponse(sessionId, result))
  } catch (err) {
    await prisma.workflowTask.update({
      where: { taskId: sessionId },
      data: { status: 'FAILED', errorMessage: err.message, completedAt: new Date() },
    }).catch(() => {})
    await recordEvent({ userId: req.user.id, taskId: sessionId, action: 'start', status: 'failed', metadata: { message: err.message } }).catch(() => {})
    next(err)
  }
})

workflowsRouter.get('/status', async (req, res, next) => {
  try {
    const taskId = String(req.query.taskId || '')
    const task = await findOwnedTask(req.user.id, taskId)
    if (!task) return res.status(404).json({ success: false, message: '任务不存在或无权访问' })
    if (isTerminal(task.status)) return res.json(terminalResult(task))

    const urls = getWebhookUrls(task.platform)
    const url = `${urls.STATUS_QUERY_URL}?taskId=${encodeURIComponent(taskId)}`
    const result = await getJson(url)
    await updateTaskFromResult(req.user.id, taskId, result)

    res.json(result)
  } catch (err) {
    next(err)
  }
})

workflowsRouter.post('/cancel', async (req, res, next) => {
  try {
    const taskId = String(req.body?.taskId || '')
    const task = await findOwnedTask(req.user.id, taskId)
    if (!task) return res.status(404).json({ success: false, message: '任务不存在或无权访问' })
    if (isTerminal(task.status)) return res.json(terminalResult(task))

    const message = '任务已由用户停止'
    const metadata = {
      ...(task.metadata && typeof task.metadata === 'object' ? task.metadata : {}),
      statusMessage: message,
      stoppedAt: new Date().toISOString(),
      stoppedByUserId: req.user.id,
    }

    await prisma.workflowTask.update({
      where: { taskId },
      data: {
        status: 'FAILED',
        errorMessage: message,
        completedAt: new Date(),
        metadata,
      },
    })
    await recordEvent({ userId: req.user.id, taskId, action: 'cancel', status: 'success', metadata: { message } })

    res.json({ success: true, status: 'failed', message, taskId })
  } catch (err) {
    next(err)
  }
})

workflowsRouter.post('/action', async (req, res, next) => {
  try {
    const taskId = String(req.body?.taskId || '')
    const task = await findOwnedTask(req.user.id, taskId)
    if (!task) return res.status(404).json({ success: false, message: '任务不存在或无权访问' })
    if (isTerminal(task.status)) return res.json(terminalResult(task))

    const urls = getWebhookUrls(task.platform)
    const action = req.body?.action
    const body = {
      taskId,
      action,
      platform: task.platform,
      contentType: isVideoPlatform(task.platform) ? 'video' : 'article',
      feedback: req.body?.feedback || '',
      previousText: req.body?.previousText || '',
      confirmedText: req.body?.confirmedText || (
        ['confirm', 'generate_images', 'generate_media'].includes(action) ? (req.body?.previousText || '') : ''
      ),
    }
    const result = await postJson(urls.USER_ACTION_URL, body)
    const persistence = buildActionPersistence({
      action: body.action,
      existingPreview: task.resultPreview,
      existingMetadata: task.metadata,
      previousText: body.previousText,
      confirmedText: body.confirmedText,
      upstreamResult: result,
    })
    await prisma.workflowTask.update({
      where: { taskId },
      data: persistence,
    })
    await recordEvent({ userId: req.user.id, taskId, action: body.action || 'user_action', status: 'success', metadata: result })

    res.json(result)
  } catch (err) {
    next(err)
  }
})

workflowsRouter.post('/regenerate-images', async (req, res, next) => {
  try {
    const taskId = String(req.body?.taskId || '')
    const task = await findOwnedTask(req.user.id, taskId)
    if (!task) return res.status(404).json({ success: false, message: '任务不存在或无权访问' })
    if (isTerminal(task.status)) return res.json(terminalResult(task))

    const urls = getWebhookUrls(task.platform)
    const result = await postJson(urls.REGENERATE_IMAGE_URL, {
      taskId,
      platform: task.platform,
      contentType: isVideoPlatform(task.platform) ? 'video' : 'article',
      confirmedText: req.body?.confirmedText || '',
    })
    await recordEvent({ userId: req.user.id, taskId, action: 'regenerate_images', status: 'success', metadata: result })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

workflowsRouter.post('/frame-action', async (req, res, next) => {
  try {
    const taskId = String(req.body?.taskId || '')
    const task = await findOwnedTask(req.user.id, taskId)
    if (!task) return res.status(404).json({ success: false, message: '任务不存在或无权访问' })
    if (isTerminal(task.status)) return res.json(terminalResult(task))

    const urls = getWebhookUrls(task.platform)
    const result = await postJson(urls.FRAME_ACTION_URL, {
      taskId,
      platform: task.platform,
      contentType: isVideoPlatform(task.platform) ? 'video' : 'article',
      frameIndex: req.body?.frameIndex,
      action: req.body?.action,
      feedback: req.body?.feedback || '',
    })
    await recordEvent({ userId: req.user.id, taskId, action: `frame_${req.body?.action || 'action'}`, status: 'success', metadata: result })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

workflowsRouter.post('/generate-video', async (req, res, next) => {
  try {
    const taskId = String(req.body?.taskId || '')
    const task = await findOwnedTask(req.user.id, taskId)
    if (!task) return res.status(404).json({ success: false, message: '任务不存在或无权访问' })
    if (isTerminal(task.status)) return res.json(terminalResult(task))

    const urls = getWebhookUrls(task.platform)
    const result = await postJson(urls.GENERATE_VIDEO_URL, {
      taskId,
      platform: task.platform,
      contentType: isVideoPlatform(task.platform) ? 'video' : 'article',
      frames: req.body?.frames || [],
      confirmedText: req.body?.confirmedText || '',
    })
    await recordEvent({ userId: req.user.id, taskId, action: 'generate_video', status: 'success', metadata: result })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

workflowsRouter.post('/regenerate-video', async (req, res, next) => {
  try {
    const taskId = String(req.body?.taskId || '')
    const task = await findOwnedTask(req.user.id, taskId)
    if (!task) return res.status(404).json({ success: false, message: '任务不存在或无权访问' })
    if (isTerminal(task.status)) return res.json(terminalResult(task))

    const urls = getWebhookUrls(task.platform)
    const result = await postJson(urls.REGENERATE_VIDEO_URL, {
      taskId,
      platform: task.platform,
      contentType: isVideoPlatform(task.platform) ? 'video' : 'article',
    })
    await recordEvent({ userId: req.user.id, taskId, action: 'regenerate_video', status: 'success', metadata: result })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

