/**
 * backgroundPoller.js
 * 后台任务轮询单例
 *
 * 当 useTask 组件卸载但任务未终态时，将任务移交此模块继续轮询。
 * 轮询结果直接写入 taskStore（localStorage），并通知监听器刷新 UI。
 * 当组件重新 mount 并接管时，调用 unregister 停止后台轮询。
 */

import { createStatusPoller } from './api.js'
import { saveTask, getTask } from './taskStore.js'
import { getSession, isCurrentSession } from './session.js'
import { isVideoPlatform } from './platforms.js'

// Map<taskId, stopFn>
const registry = new Map()

// 状态更新监听器（由 useTaskManager 注册）
let _updateListener = null

/**
 * 注册监听器，后台任务状态变化时回调（用于刷新 OngoingTaskList）
 * @param {Function|null} fn
 */
export function setUpdateListener(fn) {
  _updateListener = fn
}

function notifyListener() {
  if (_updateListener) _updateListener()
}

/**
 * 将任务移交后台轮询
 * @param {string} taskId
 * @param {'xiaohongshu'|'douyin'} platform
 */
export function registerTask(taskId, platform) {
  const session = getSession()
  if (!isCurrentSession(session)) return
  if (registry.has(taskId)) return // 已在后台，不重复注册

  const stopFn = createStatusPoller(
    taskId,
    (result) => { if (isCurrentSession(session)) handleUpdate(taskId, platform, result) },
    (err) => { if (isCurrentSession(session)) handleError(taskId, err) },
    platform,
  )

  const signal = session.controller.signal
  const cancel = () => unregisterTask(taskId)
  signal.addEventListener('abort', cancel, { once: true })
  registry.set(taskId, () => {
    stopFn()
    signal.removeEventListener('abort', cancel)
  })
}

/**
 * 从后台移除任务（前台组件接管时调用）
 * @param {string} taskId
 */
export function unregisterTask(taskId) {
  const stop = registry.get(taskId)
  if (stop) {
    stop()
    registry.delete(taskId)
  }
}

/**
 * 查询某任务是否在后台轮询中
 * @param {string} taskId
 * @returns {boolean}
 */
export function isRegistered(taskId) {
  return registry.has(taskId)
}

// ── 内部处理 ─────────────────────────────────────────────

const TERMINAL = new Set(['completed', 'failed'])

function getProtectedText(record) {
  if (record?._manualPreviewText !== null && record?._manualPreviewText !== undefined) {
    return record._manualPreviewText
  }
  return record?.confirmedText || null
}

function protectPreviewText(incomingPreview, current) {
  const protectedText = getProtectedText(current)
  if (typeof protectedText !== 'string') {
    return incomingPreview || current.preview
  }
  const basePreview = incomingPreview || current.preview || {}
  return {
    ...basePreview,
    text: protectedText,
    images: basePreview.images || [],
    videos: basePreview.videos || [],
  }
}

function handleUpdate(taskId, platform, result) {
  const current = getTask(taskId)
  if (!current) {
    // 任务记录已被删除，停止轮询
    unregisterTask(taskId)
    return
  }

  if (!result.success && result.status === 'failed') {
    saveTask({ ...current, status: 'failed', errorMessage: result.message || '获取状态失败' })
    unregisterTask(taskId)
    notifyListener()
    return
  }

  // success:false 但非 failed 状态（如任务初始化竞态），跳过本次更新继续轮询
  // 注意：若 n8n 响应未包含 success 字段，不应跳过（只有明确 success===false 且非 failed 才跳）
  if (result.success === false && result.status !== 'failed') return

  // 将轮询结果合并写入存储
  const updates = {
    ...current,
    stepName: result.stepName || current.stepName,
    statusMessage: result.message || current.statusMessage,
  }

  // ── 操作锁保护（从 localStorage 恢复，与 useTask 中的 ref 锁逻辑一致）──
  // actionLock：通用操作锁，阻止旧状态覆盖
  // 注意：当存在图片专用锁时，对 xhs_image_review 结果不在此拦截，交给下方更精准的图片锁处理
  const hasImageLock = (current._approvingImageIndex !== null && current._approvingImageIndex !== undefined) ||
                       current._rejectingImage
  if (current._actionLock) {
    const { prevStatus, lockedAt, lockDurationMs } = current._actionLock
    const isExpired = Date.now() - lockedAt > lockDurationMs
    if (isExpired) {
      updates._actionLock = null  // 过期清锁
    } else if (result.status === prevStatus && !(hasImageLock && result.stepName === 'xhs_image_review')) {
      return  // 锁定期内，旧状态跳过（但图片锁场景下放行给下方专用检查）
    } else {
      updates._actionLock = null  // 新状态到达，清锁
    }
  }

  // 图片通过锁：index 未推进时跳过 xhs_image_review
  if (current._approvingImageIndex !== null && current._approvingImageIndex !== undefined) {
    if (result.stepName === 'xhs_image_review') {
      const incomingIndex = result.currentImageIndex ?? current.currentXhsImageIndex
      if (incomingIndex <= current._approvingImageIndex) {
        return  // 还停在旧图，跳过
      }
      // index 已推进，清锁
      updates._approvingImageIndex = null
      updates._actionLock = null
    }
  }

  // 图片拒绝锁：URL 未变化时跳过 xhs_image_review
  if (current._rejectingImage) {
    if (result.stepName === 'xhs_image_review') {
      const { index: lockIndex, rejectedUrl } = current._rejectingImage
      const incomingIndex = result.currentImageIndex ?? current.currentXhsImageIndex
      if (incomingIndex === lockIndex) {
        const incomingImages = result.xhsImages || current.xhsImages || []
        const incomingImg = incomingImages[lockIndex]
        const incomingUrl = incomingImg ? incomingImg.url : ''
        if (incomingUrl === rejectedUrl) {
          return  // 还是旧图，跳过
        }
      }
      // 新图已到位或 index 已变，清锁
      updates._rejectingImage = null
      updates._actionLock = null
    }
  }

  // 稳定状态保护：已到达需要用户操作的状态时，不允许轮询降级为 processing
  // （n8n 并发执行时 staticData/文件可能暂时查不到任务，返回 processing）
  const STABLE_STATUSES = new Set(['waiting_user_feedback', 'image_review', 'frame_review', 'video_review'])

  // Preserve artifacts and review permissions even when status is already completed.
  for (const key of ['downloadUrl', 'fileList', 'generationProgress', 'frames',
    'currentFrameIndex', 'videoUrl', 'allowRevise', 'allowConfirm', 'history']) {
    if (result[key] !== undefined) updates[key] = result[key]
  }

  if (result.status === 'failed') {
    updates.status = 'failed'
    updates.errorMessage = result.message || '工作流执行失败'
  } else if (result.status === 'completed') {
    updates.status = 'completed'
    updates.preview = protectPreviewText(result.preview, current)
    if (isVideoPlatform(platform) && (current.confirmedText || result.storyboardDocument)) {
      updates.storyboardDocument = current.confirmedText || result.storyboardDocument
    }
  } else if (result.status === 'waiting_user_feedback') {
    updates.status = 'waiting_user_feedback'
    if (result.preview || current._manualPreviewText) updates.preview = protectPreviewText(result.preview, current)
    // 初稿自动记录版本历史
    if (result.preview?.text && (!current.previewHistory || current.previewHistory.length === 0)) {
      updates.previewHistory = [
        { version: 1, label: '初稿', text: result.preview.text, timestamp: Date.now() },
      ]
    }
  } else if (result.stepName === 'xhs_image_review') {
    updates.status = 'image_review'
    updates.currentXhsImageIndex = result.currentImageIndex ?? current.currentXhsImageIndex
    if (result.xhsImages) updates.xhsImages = result.xhsImages
  } else if (result.stepName === 'douyin_frame_review' || result.stepName === 'douyin_frame_generating') {
    updates.status = 'frame_review'
    if (result.frames) updates.frames = result.frames
    updates.currentFrameIndex = result.currentFrameIndex ?? current.currentFrameIndex
  } else if (result.stepName === 'douyin_video_generating') {
    updates.status = 'video_generating'
  } else if (result.stepName === 'douyin_video_review') {
    updates.status = 'video_review'
    if (result.videoUrl) updates.videoUrl = result.videoUrl
  } else if (result.stepName === 'douyin_storyboard_generating') {
    updates.status = 'processing'
  } else if (result.stepName === 'douyin_media_generating') {
    updates.status = 'processing'
    if (result.generationProgress) updates.generationProgress = result.generationProgress
  } else if (result.stepName === 'douyin_batch_completed') {
    updates.status = 'completed'
    if (result.downloadUrl) updates.downloadUrl = result.downloadUrl
    if (result.fileList) updates.fileList = result.fileList
    if (current.confirmedText || result.storyboardDocument) updates.storyboardDocument = current.confirmedText || result.storyboardDocument
    updates.preview = protectPreviewText(result.preview, current)
  } else {
    if (STABLE_STATUSES.has(current.status) && result.status === 'processing') return
    updates.status = 'processing'
  }

  saveTask(updates)
  notifyListener()

  // 终态自动注销
  if (TERMINAL.has(updates.status)) {
    unregisterTask(taskId)
  }
}

function handleError(taskId, err) {
  const current = getTask(taskId)
  if (current) {
    saveTask({ ...current, status: 'failed', errorMessage: err.message || '轮询出错' })
    notifyListener()
  }
  unregisterTask(taskId)
}

