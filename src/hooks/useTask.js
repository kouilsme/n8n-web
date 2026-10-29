/**
 * useTask hook
 * 封装单任务的完整状态机，支持小红书和抖音两种流程
 *
 * 小红书流程：submitting → processing → waiting_user_feedback → (revising →) completed
 *   额外：文案确认后 → image_review（逐张审图）→ completed
 *   额外：completed 后可 regenerate_images → processing → completed
 *
 * 抖音流程：submitting → processing → waiting_user_feedback (稿件) →
 *   frame_review → video_generating → video_review → completed
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import {
  startWorkflow,
  cancelWorkflow,
  submitUserAction,
  regenerateImages,
  submitFrameAction,
  generateVideo,
  regenerateVideo,
  uploadReferenceImages,
  deleteReferenceImages,
} from '../api'
import { usePoller } from './usePoller'
import { saveTask } from '../taskStore'
import { getSession, isCurrentSession } from '../session.js'
import { registerTask, unregisterTask, isRegistered } from '../backgroundPoller'

import { isVideoPlatform } from '../platforms'

const INITIAL_STATE = {
  taskId: null,
  platform: 'xiaohongshu',
  formParams: null,
  taskStatus: 'idle',      // idle|submitting|processing|waiting_user_feedback|revising|image_review|frame_review|video_generating|video_review|completed|failed
  stepName: '',
  statusMessage: '',
  preview: null,           // { text, images, videos }
  history: [],
  previewHistory: [],
  allowRevise: false,
  allowConfirm: false,
  errorMessage: '',
  isActionSubmitting: false,
  createdAt: null,
  // 小红书逐张审图
  xhsImages: [],           // [{url, status: 'pending'|'approved'|'rejected'}]
  currentXhsImageIndex: 0,
  // 抖音专用（逐帧审核模式）
  frames: [],              // [{ index, imageUrl, storyboardText, status }]
  currentFrameIndex: 0,
  confirmedText: '',       // 已确认的文案/稿件
  _manualPreviewText: null,
  _manualPreviewUpdatedAt: null,
  videoUrl: null,
  // 抖音专用（批量生成模式）
  workflowMode: 'batch',   // 'batch' | 'interactive'
  storyboardDocument: null, // 完整分镜文档（markdown/结构化文本）
  downloadUrl: null,        // 素材包下载链接（zip）
  fileList: [],             // [{name, type, url, size}] 生成的文件列表
  generationProgress: null, // {current, total, currentStep} 素材生成进度
}

const TERMINAL_STATUSES = new Set(['completed', 'failed'])
const REFERENCE_IMAGE_FIELD = '参考图片'

function splitReferenceImages(formData = {}) {
  const referenceFiles = Array.isArray(formData[REFERENCE_IMAGE_FIELD])
    ? formData[REFERENCE_IMAGE_FIELD].filter(Boolean)
    : []

  const serializableFormData = Object.entries(formData).reduce((acc, [key, value]) => {
    if (key === REFERENCE_IMAGE_FIELD) return acc
    acc[key] = value
    return acc
  }, {})

  if (referenceFiles.length > 0) {
    serializableFormData['参考图片文件名'] = referenceFiles.map((file) => file.name).join('、')
  }

  return { referenceFiles, serializableFormData }
}

function withReferenceImageParams(formData, uploadedFiles) {
  if (!Array.isArray(uploadedFiles) || uploadedFiles.length === 0) {
    return { ...formData }
  }

  return {
    ...formData,
    参考图片URL: uploadedFiles[0]?.url || '',
    参考图片URLs: uploadedFiles.map((file) => file.url),
    参考图片详情: uploadedFiles.map(({ url, name, type, size }) => ({ url, name, type, size })),
  }
}

/**
 * 从持久化的任务记录恢复初始状态
 */
function hydrateFromRecord(record) {
  if (!record) return INITIAL_STATE
  const localText = record._manualPreviewText ?? record.confirmedText
  const preview = (typeof localText === 'string' && (localText.length > 0 || record._manualPreviewText != null))
    ? {
        ...(record.preview || {}),
        text: localText,
        images: record.preview?.images || [],
        videos: record.preview?.videos || [],
      }
    : (record.preview || null)
  return {
    ...INITIAL_STATE,
    taskId: record.taskId,
    platform: record.platform || 'xiaohongshu',
    formParams: record.formParams || null,
    taskStatus: record.status || 'idle',
    stepName: record.stepName || '',
    statusMessage: record.statusMessage || '',
    preview,
    history: record.history || [],
    previewHistory: record.previewHistory || [],
    allowRevise: record.allowRevise ?? record.status === 'waiting_user_feedback',
    allowConfirm: record.allowConfirm ?? record.status === 'waiting_user_feedback',
    errorMessage: record.errorMessage || '',
    createdAt: record.createdAt || null,
    xhsImages: record.xhsImages || [],
    currentXhsImageIndex: record.currentXhsImageIndex || 0,
    frames: record.frames || [],
    currentFrameIndex: record.currentFrameIndex ?? 0,
    confirmedText: record.confirmedText || '',
    _manualPreviewText: record._manualPreviewText ?? null,
    _manualPreviewUpdatedAt: record._manualPreviewUpdatedAt || null,
    videoUrl: record.videoUrl || null,
    // 批量模式字段
    workflowMode: record.workflowMode || 'batch',
    storyboardDocument: record.storyboardDocument || null,
    downloadUrl: record.downloadUrl || null,
    fileList: record.fileList || [],
    generationProgress: record.generationProgress || null,
  }
}

export function useTask(onTaskSaved, initialTaskRecord = null) {
  const [state, setState] = useState(() => hydrateFromRecord(initialTaskRecord))
  const sessionRef = useRef(getSession())

  // 用 ref 追踪最新 state，供闭包内异步回调使用
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])

  const manualPreviewTextRef = useRef(initialTaskRecord?._manualPreviewText ?? null)

  const protectPreviewText = useCallback((incomingPreview, currentState) => {
    const manualText = manualPreviewTextRef.current ?? currentState._manualPreviewText
    const protectedText = manualText ?? currentState.confirmedText
    if (typeof protectedText !== 'string' || (protectedText.length === 0 && manualText == null)) {
      return incomingPreview || currentState.preview
    }
    const basePreview = incomingPreview || currentState.preview || {}
    return {
      ...basePreview,
      text: protectedText,
      images: basePreview.images || [],
      videos: basePreview.videos || [],
    }
  }, [])

  // 将 state 补丁合并并持久化
  const patch = useCallback((updates, persist = true) => {
    if (!isCurrentSession(sessionRef.current)) return
    setState(prev => {
      if (!isCurrentSession(sessionRef.current)) return prev
      const next = { ...prev, ...updates }
      stateRef.current = next
      if (persist && next.taskId) {
        saveTask({
          taskId: next.taskId,
          platform: next.platform,
          formParams: next.formParams,
          status: next.taskStatus,
          stepName: next.stepName,
          statusMessage: next.statusMessage,
          preview: next.preview,
          previewHistory: next.previewHistory,
          allowRevise: next.allowRevise,
          allowConfirm: next.allowConfirm,
          errorMessage: next.errorMessage || null,
          createdAt: next.createdAt,
          xhsImages: next.xhsImages,
          currentXhsImageIndex: next.currentXhsImageIndex,
          // 抖音专用字段
          frames: next.frames,
          currentFrameIndex: next.currentFrameIndex,
          confirmedText: next.confirmedText,
          _manualPreviewText: next._manualPreviewText,
          _manualPreviewUpdatedAt: next._manualPreviewUpdatedAt,
          videoUrl: next.videoUrl,
          // 批量模式字段
          workflowMode: next.workflowMode,
          storyboardDocument: next.storyboardDocument,
          downloadUrl: next.downloadUrl,
          fileList: next.fileList,
          generationProgress: next.generationProgress,
          // 图片操作锁（持久化，供 backgroundPoller 使用）
          _approvingImageIndex: approvingImageIndexRef.current,
          _rejectingImage: rejectingImageRef.current,
          _actionLock: actionLockRef.current,
        })
        if (onTaskSaved) onTaskSaved()
      }
      return next
    })
  }, [onTaskSaved])

  // 用户操作锁：记录操作触发时间和操作前的状态
  // 在锁定期间，若轮询返回"操作前的旧状态"则忽略，防止竞态覆盖乐观更新
  const actionLockRef = useRef(initialTaskRecord?._actionLock || null)

  // 图片重新生成锁：记录正在重新生成的图片的索引和被拒绝时的 URL
  const rejectingImageRef = useRef(initialTaskRecord?._rejectingImage || null)

  // 图片通过锁：记录已通过的图片索引，轮询回来若 currentImageIndex 仍 <= 该值则跳过
  const approvingImageIndexRef = useRef(initialTaskRecord?._approvingImageIndex ?? null)

  // ── 轮询回调 ───────────────────────────────────────────────
  const handleStatusUpdate = useCallback((result) => {
    // success:false 且明确是 failed 状态才算真正失败
    if (!result.success && result.status === 'failed') {
      patch({ taskStatus: 'failed', errorMessage: result.message || '获取状态失败' })
      return
    }

    // 操作锁：若在锁定期内收到"操作前的旧状态"，跳过此次更新
    // 注意：当存在图片专用锁时，对 xhs_image_review 结果不在此拦截，交给下方更精准的图片锁处理
    const hasImageLock = approvingImageIndexRef.current !== null || rejectingImageRef.current !== null
    if (actionLockRef.current) {
      const { prevStatus, lockedAt, lockDurationMs } = actionLockRef.current
      const isExpired = Date.now() - lockedAt > lockDurationMs
      if (isExpired) {
        actionLockRef.current = null
      } else if (result.status === prevStatus && !(hasImageLock && result.stepName === 'xhs_image_review')) {
        return
      } else {
        actionLockRef.current = null
      }
    }

    const cur = stateRef.current
    const isVideo = isVideoPlatform(cur.platform)

    // 公共字段
    const common = {
      stepName: result.stepName || '',
      statusMessage: result.message || '',
      history: result.history || cur.history,
      allowRevise: result.allowRevise || false,
      allowConfirm: result.allowConfirm || false,
    }

    if (result.status === 'failed') {
      patch({ ...common, taskStatus: 'failed', errorMessage: result.message || '工作流执行失败' })
      return
    }

    if (result.status === 'completed') {
      const updates = { ...common, taskStatus: 'completed', preview: protectPreviewText(result.preview, cur) }
      if (isVideo && result.videoUrl) updates.videoUrl = result.videoUrl
      if (isVideo && result.downloadUrl) updates.downloadUrl = result.downloadUrl
      if (isVideo && result.fileList) updates.fileList = result.fileList
      if (isVideo && (cur.confirmedText || result.storyboardDocument)) updates.storyboardDocument = cur.confirmedText || result.storyboardDocument
      patch(updates)
      return
    }

    // 小红书：逐张审图
    if (!isVideo && result.stepName === 'xhs_image_review') {
      const incomingIndex = result.currentImageIndex ?? cur.currentXhsImageIndex
      const incomingImages = result.xhsImages || cur.xhsImages

      // 通过锁：若轮询返回的 index 仍 <= 已通过的 index，说明新图还未生成，跳过
      if (approvingImageIndexRef.current !== null) {
        if (incomingIndex <= approvingImageIndexRef.current) {
          return  // 还停在旧图，跳过
        }
        // index 已推进，下一张已到位，清锁
        approvingImageIndexRef.current = null
      }

      // 拒绝重新生成锁：若该索引的图片 URL 还和被拒绝时相同，说明新图还没生成完，跳过
      if (rejectingImageRef.current !== null) {
        const { index: lockIndex, rejectedUrl } = rejectingImageRef.current
        if (incomingIndex === lockIndex) {
          const incomingImg = incomingImages[lockIndex]
          const incomingUrl = incomingImg ? incomingImg.url : ''
          if (incomingUrl === rejectedUrl) {
            return  // 还是旧图，跳过
          }
          rejectingImageRef.current = null
        }
      }

      patch({
        ...common,
        taskStatus: 'image_review',
        currentXhsImageIndex: incomingIndex,
        xhsImages: incomingImages,
      })
      return
    }

    // 抖音特殊 stepName 处理
    if (isVideo) {
      // ── 批量模式：分镜文档生成中 ──
      if (result.stepName === 'douyin_storyboard_generating') {
        patch({
          ...common,
          taskStatus: 'processing',
          statusMessage: result.message || '正在生成分镜文档...',
        })
        return
      }
      // ── 批量模式：素材生成中（配图、配音、字幕等）──
      if (result.stepName === 'douyin_media_generating') {
        patch({
          ...common,
          taskStatus: 'processing',
          generationProgress: result.generationProgress || cur.generationProgress,
          statusMessage: result.message || '正在生成素材...',
        })
        return
      }
      // ── 批量模式：所有素材完成 ──
      if (result.stepName === 'douyin_batch_completed') {
        patch({
          ...common,
          taskStatus: 'completed',
          downloadUrl: result.downloadUrl || cur.downloadUrl,
          fileList: result.fileList || cur.fileList,
          storyboardDocument: cur.confirmedText || result.storyboardDocument || cur.storyboardDocument,
          preview: protectPreviewText(result.preview, cur),
        })
        return
      }
      // ── 逐帧审核模式（保留原有逻辑）──
      if (result.stepName === 'douyin_frame_review' || result.stepName === 'douyin_frame_generating') {
        const frames = result.frames || cur.frames
        patch({
          ...common,
          taskStatus: 'frame_review',
          frames,
          currentFrameIndex: result.currentFrameIndex ?? cur.currentFrameIndex,
          preview: result.preview || cur.preview,
        })
        return
      }
      if (result.stepName === 'douyin_video_generating') {
        patch({ ...common, taskStatus: 'video_generating' })
        return
      }
      if (result.stepName === 'douyin_video_review') {
        patch({
          ...common,
          taskStatus: 'video_review',
          videoUrl: result.videoUrl || cur.videoUrl,
          preview: result.preview || cur.preview,
        })
        return
      }
    }

    if (result.status === 'waiting_user_feedback') {
      let newPreview = result.preview || cur.preview
      const localDraftText = manualPreviewTextRef.current ?? cur._manualPreviewText
      if (localDraftText !== null && cur.taskStatus === 'waiting_user_feedback') {
        newPreview = {
          ...(newPreview || {}),
          text: localDraftText,
          images: newPreview?.images || [],
          videos: newPreview?.videos || [],
        }
      }
      const updates = {
        ...common,
        taskStatus: 'waiting_user_feedback',
        preview: newPreview,
      }
      // 批量模式：保存分镜文档
      if (isVideo && result.storyboardDocument) {
        updates.storyboardDocument = result.storyboardDocument
      }
      // 如果是初稿（previewHistory 为空），自动记录
      if (newPreview?.text && cur.previewHistory.length === 0) {
        updates.previewHistory = [{ version: 1, label: '初稿', text: newPreview.text, timestamp: Date.now() }]
      }
      patch(updates)
      return
    }

    // 稳定状态保护：已到达需要用户操作的状态时，不允许轮询将其降级为 processing
    // （n8n 并发执行时 staticData 可能被覆盖，导致轮询返回 processing，但本地已有初稿/图片）
    // 用户自己的操作会在发请求前先把本地状态切成 processing，因此不会被此保护误拦
    const STABLE_STATUSES = new Set(['waiting_user_feedback', 'image_review', 'frame_review', 'video_review'])
    if (STABLE_STATUSES.has(cur.taskStatus) && result.status === 'processing') {
      return
    }

    // 仍在 processing
    patch({ ...common, taskStatus: 'processing', preview: protectPreviewText(result.preview, cur) })
  }, [patch, protectPreviewText])

  const handlePollError = useCallback((err) => {
    patch({ taskStatus: 'failed', errorMessage: err.message || '轮询出错' })
  }, [patch])

  const { start: startPolling, stop: stopPolling } = usePoller(handleStatusUpdate, handlePollError)

  const updatePreviewText = useCallback((text) => {
    const { preview } = stateRef.current
    manualPreviewTextRef.current = text
    const nextPreview = {
      ...(preview || {}),
      text,
      images: preview?.images || [],
      videos: preview?.videos || [],
    }
    patch({
      preview: nextPreview,
      _manualPreviewText: text,
      _manualPreviewUpdatedAt: Date.now(),
    })
  }, [patch])

  // 延迟轮询定时器（用户操作后给 n8n 留出处理时间，避免立即拿到旧状态）
  const delayTimerRef = useRef(null)

  // ── 前台接管：若任务在后台，先注销再开始前台轮询 ──────────
  const startForegroundPolling = useCallback((taskId, platform) => {
    if (!isCurrentSession(sessionRef.current)) return
    if (isRegistered(taskId)) {
      unregisterTask(taskId)
    }
    startPolling(taskId, platform)
  }, [startPolling])

  // ── 延迟后启动轮询（用于 confirm/revise 等操作，避免竞态覆盖乐观状态）──
  const startPollingAfterDelay = useCallback((taskId, platform, delayMs = 5000) => {
    // 先停掉当前轮询，避免竞态
    stopPolling()
    if (delayTimerRef.current) clearTimeout(delayTimerRef.current)
    delayTimerRef.current = setTimeout(() => {
      delayTimerRef.current = null
      startForegroundPolling(taskId, platform)
    }, delayMs)
  }, [stopPolling, startForegroundPolling])

  // ── 组件卸载：将未终态任务移交后台 ─────────────────────────
  useEffect(() => {
    return () => {
      if (delayTimerRef.current) clearTimeout(delayTimerRef.current)
      stopPolling()
      const { taskId, platform, taskStatus } = stateRef.current
      if (taskId && !TERMINAL_STATUSES.has(taskStatus) && taskStatus !== 'idle' && taskStatus !== 'submitting') {
        registerTask(taskId, platform)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 仅 unmount 时执行

  // 恢复已有任务：若从 initialTaskRecord 恢复且任务未终止，自动重启前台轮询
  useEffect(() => {
    if (!initialTaskRecord) return
    const { taskId, platform, status } = initialTaskRecord
    if (!taskId || TERMINAL_STATUSES.has(status)) return
    startForegroundPolling(taskId, platform || 'xiaohongshu')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 仅 mount 时执行一次

  // ── 提交表单 ───────────────────────────────────────────────
  const submit = useCallback((platform, formData) => {
    const createdAt = Date.now()
    const sessionId = uuidv4()
    const { referenceFiles, serializableFormData } = splitReferenceImages(formData)
    const workflowMode = (isVideoPlatform(platform) && serializableFormData['\u5de5\u4f5c\u6d41\u6a21\u5f0f'] === '\u9010\u5e27\u5ba1\u6838\u6a21\u5f0f') ? 'interactive' : 'batch'
    manualPreviewTextRef.current = null

    const prev = stateRef.current
    if (prev.taskId && !TERMINAL_STATUSES.has(prev.taskStatus) && prev.taskStatus !== 'idle' && prev.taskStatus !== 'submitting') {
      stopPolling()
      if (delayTimerRef.current) { clearTimeout(delayTimerRef.current); delayTimerRef.current = null }
      registerTask(prev.taskId, prev.platform)
    }

    approvingImageIndexRef.current = null
    rejectingImageRef.current = null
    actionLockRef.current = null

    patch({
      taskId: sessionId,
      platform,
      formParams: serializableFormData,
      taskStatus: 'processing',
      statusMessage: referenceFiles.length > 0 ? '正在上传参考图片...' : '工作流已启动，正在生成内容...',
      createdAt,
      workflowMode,
      confirmedText: '',
      _manualPreviewText: null,
      _manualPreviewUpdatedAt: null,
    })

    let uploadedStorageKeys = []

    ;(async () => {
      let uploadedFiles = []

      if (referenceFiles.length > 0) {
        const uploadResult = await uploadReferenceImages(referenceFiles, platform)
        uploadedFiles = Array.isArray(uploadResult.files) ? uploadResult.files : []
        uploadedStorageKeys = uploadedFiles.map((file) => file.storageKey).filter(Boolean)
      }

      if (!isCurrentSession(sessionRef.current)) return
      const workflowParams = withReferenceImageParams(serializableFormData, uploadedFiles)
      patch({
        formParams: workflowParams,
        statusMessage: uploadedFiles.length > 0 ? '参考图片已上传，正在启动工作流...' : '工作流已启动，正在生成内容...',
      })

      startForegroundPolling(sessionId, platform)
      const result = await startWorkflow(platform, sessionId, workflowParams)
      if (!isCurrentSession(sessionRef.current)) return
      if (result?.success === false) {
        if (uploadedStorageKeys.length > 0) {
          deleteReferenceImages(uploadedStorageKeys).catch(() => {})
        }
        patch({
          taskStatus: 'failed',
          errorMessage: result.message || '启动工作流失败',
        })
        stopPolling()
      }
    })().catch((err) => {
      if (!isCurrentSession(sessionRef.current)) return
      if (uploadedStorageKeys.length > 0) {
        deleteReferenceImages(uploadedStorageKeys).catch(() => {})
      }
      patch({
        taskStatus: 'failed',
        errorMessage: err.message || '提交失败，请检查网络连接',
      })
      stopPolling()
    })
  }, [patch, startForegroundPolling, stopPolling])

  // ── 提交修改意见 ───────────────────────────────────────────
  const revise = useCallback((feedback, draftText) => {
    const { taskId, preview, platform } = stateRef.current
    if (!taskId) return
    const currentText = typeof draftText === 'string' ? draftText : (preview?.text || '')
    const nextPreview = {
      ...(preview || {}),
      text: currentText,
      images: preview?.images || [],
      videos: preview?.videos || [],
    }
    const sendPreviousText = currentText
    manualPreviewTextRef.current = null

    // 先设置锁，再 patch（patch 内 saveTask 会持久化锁状态）
    actionLockRef.current = { prevStatus: 'waiting_user_feedback', lockedAt: Date.now(), lockDurationMs: 60000 }
    patch({
      isActionSubmitting: false,
      taskStatus: 'processing',
      statusMessage: '修改意见已接收，重新生成中...',
      preview: nextPreview,
      _manualPreviewText: null,
      _manualPreviewUpdatedAt: null,
    })
    startPollingAfterDelay(taskId, platform, 5000)

    submitUserAction(taskId, 'revise', feedback, sendPreviousText, platform).catch(() => {
      patch({ taskStatus: 'failed', errorMessage: '提交修改失败，请检查网络连接' })
      stopPolling()
    })
  }, [patch, startPollingAfterDelay, stopPolling])

  // ── 确认稿件 ───────────────────────────────────────────────
  const confirm = useCallback((draftText) => {
    const { taskId, preview, platform, previewHistory, workflowMode } = stateRef.current
    if (!taskId) return

    const currentText = typeof draftText === 'string' ? draftText : (preview?.text || '')
    const nextPreview = {
      ...(preview || {}),
      text: currentText,
      images: preview?.images || [],
      videos: preview?.videos || [],
    }
    const updated = currentText ? [
      ...previewHistory,
      { version: previewHistory.length + 1, label: '确认版本', text: currentText, timestamp: Date.now() }
    ] : previewHistory
    const confirmedText = currentText
    manualPreviewTextRef.current = null

    // 先设置锁，再 patch（patch 内 saveTask 会持久化锁状态）
    // confirm + generate 两个请求串行，总时长可能较长，锁定10分钟
    actionLockRef.current = { prevStatus: 'waiting_user_feedback', lockedAt: Date.now(), lockDurationMs: 600000 }

    const isBatchMode = isVideoPlatform(platform) && workflowMode === 'batch'
    patch({
      isActionSubmitting: false,
      taskStatus: 'processing',
      statusMessage: isBatchMode ? '分镜确认成功，正在生成素材...' : '确认成功，正在生成配图...',
      preview: nextPreview,
      previewHistory: updated,
      confirmedText,
      _manualPreviewText: confirmedText,
      _manualPreviewUpdatedAt: Date.now(),
    })
    startPollingAfterDelay(taskId, platform, 8000)

    if (isBatchMode) {
      // 批量模式：confirm 后触发素材批量生成
      submitUserAction(taskId, 'confirm', '', confirmedText, platform)
        .then(() => submitUserAction(taskId, 'generate_media', '', confirmedText, platform))
        .catch(() => {
          patch({ taskStatus: 'failed', errorMessage: '确认失败，请检查网络连接' })
          stopPolling()
        })
    } else {
      // 逐帧审核模式 / 小红书模式
      submitUserAction(taskId, 'confirm', '', confirmedText, platform)
        .then(() => submitUserAction(taskId, 'generate_images', '', confirmedText, platform))
        .catch(() => {
          patch({ taskStatus: 'failed', errorMessage: '确认失败，请检查网络连接' })
          stopPolling()
        })
    }
  }, [patch, startPollingAfterDelay, stopPolling])

  // ── 小红书：审核单张图片（通过）──────────────────────────
  const approveXhsImage = useCallback((imageIndex) => {
    const { taskId, platform, xhsImages } = stateRef.current
    if (!taskId) return
    const updatedImages = xhsImages.map((img, i) =>
      i === imageIndex ? { ...img, status: 'approved' } : img
    )
    // 先设置锁 refs，再 patch（patch 内的 saveTask 会读取 refs 持久化到 localStorage）
    approvingImageIndexRef.current = imageIndex
    actionLockRef.current = { prevStatus: 'image_review', lockedAt: Date.now(), lockDurationMs: 60000 }
    patch({
      isActionSubmitting: false,
      taskStatus: 'processing',
      statusMessage: `第${imageIndex + 1}张图片审核通过，正在生成下一张...`,
      xhsImages: updatedImages,
    })
    startPollingAfterDelay(taskId, platform, 5000)

    submitUserAction(taskId, 'approve_image', '', String(imageIndex), platform).catch(() => {
      approvingImageIndexRef.current = null
      actionLockRef.current = null
      patch({ isActionSubmitting: false, statusMessage: '审核提交失败，请检查网络连接' })
    })
  }, [patch, startPollingAfterDelay])

  // ── 小红书：审核单张图片（拒绝）──────────────────────────
  const rejectXhsImage = useCallback((imageIndex, feedback) => {
    const { taskId, platform, xhsImages } = stateRef.current
    if (!taskId) return
    // 记录被拒绝图片的 URL，用于识别轮询回来的旧图
    const rejectedUrl = xhsImages[imageIndex] ? xhsImages[imageIndex].url : ''
    const updatedImages = xhsImages.map((img, i) =>
      i === imageIndex ? { ...img, status: 'rejected' } : img
    )
    // 先设置锁 refs，再 patch
    rejectingImageRef.current = { index: imageIndex, rejectedUrl }
    actionLockRef.current = { prevStatus: 'image_review', lockedAt: Date.now(), lockDurationMs: 60000 }
    patch({
      isActionSubmitting: false,
      taskStatus: 'processing',
      statusMessage: `正在重新生成第${imageIndex + 1}张图片...`,
      xhsImages: updatedImages,
    })
    startPollingAfterDelay(taskId, platform, 5000)

    submitUserAction(taskId, 'reject_image', feedback, String(imageIndex), platform).catch(() => {
      rejectingImageRef.current = null
      actionLockRef.current = null
      patch({ isActionSubmitting: false, statusMessage: '审核提交失败，请检查网络连接' })
    })
  }, [patch, startPollingAfterDelay])

  // ── 小红书：重新生成图片 ───────────────────────────────────
  const regenImages = useCallback((confirmedTextArg) => {
    const { taskId, preview, confirmedText, platform } = stateRef.current
    if (!taskId) return
    const text = confirmedTextArg || confirmedText || preview?.text || ''
    patch({ isActionSubmitting: false, taskStatus: 'processing', statusMessage: '正在重新生成图片...' })
    startForegroundPolling(taskId, platform)

    regenerateImages(taskId, text, platform).catch(() => {
      patch({ taskStatus: 'completed', errorMessage: '重新生成图片失败，请检查网络连接' })
      stopPolling()
    })
  }, [patch, startForegroundPolling, stopPolling])

  // ── 抖音：审核单帧 ─────────────────────────────────────────
  const approveFrame = useCallback(async (frameIndex) => {
    const { taskId, platform, frames } = stateRef.current
    if (!taskId) return
    try {
      patch({ isActionSubmitting: true, statusMessage: `第${frameIndex + 1}帧审核通过，等待下一帧...` })
      const updatedFrames = frames.map(f => f.index === frameIndex ? { ...f, status: 'approved' } : f)
      patch({ frames: updatedFrames })

      const result = await submitFrameAction(taskId, frameIndex, 'approve', '', platform)
      if (result?.success === false) {
        patch({ isActionSubmitting: false, statusMessage: result.message || '审核提交失败' })
        return
      }
      patch({ isActionSubmitting: false, taskStatus: 'processing', statusMessage: result.message || '正在生成下一帧...' })
      startForegroundPolling(taskId, platform)
    } catch (err) {
      patch({ isActionSubmitting: false, statusMessage: err.message || '审核提交失败' })
    }
  }, [patch, startForegroundPolling])

  const rejectFrame = useCallback(async (frameIndex, feedback) => {
    const { taskId, platform, frames } = stateRef.current
    if (!taskId) return
    try {
      patch({ isActionSubmitting: true, statusMessage: `正在重新生成第${frameIndex + 1}帧...` })
      const updatedFrames = frames.map(f => f.index === frameIndex ? { ...f, status: 'rejected' } : f)
      patch({ frames: updatedFrames })

      const result = await submitFrameAction(taskId, frameIndex, 'reject', feedback, platform)
      if (result?.success === false) {
        patch({ isActionSubmitting: false, statusMessage: result.message || '审核提交失败' })
        return
      }
      patch({ isActionSubmitting: false, taskStatus: 'processing', statusMessage: result.message || '正在重新生成该帧...' })
      startForegroundPolling(taskId, platform)
    } catch (err) {
      patch({ isActionSubmitting: false, statusMessage: err.message || '审核提交失败' })
    }
  }, [patch, startForegroundPolling])

  // ── 抖音：触发视频生成 ─────────────────────────────────────
  const triggerGenerateVideo = useCallback(async () => {
    const { taskId, frames, confirmedText, preview, platform } = stateRef.current
    if (!taskId) return
    const text = confirmedText || preview?.text || ''
    try {
      patch({ isActionSubmitting: true, taskStatus: 'video_generating', statusMessage: '正在生成视频...' })
      const result = await generateVideo(taskId, frames, text, platform)
      if (result?.success === false) {
        patch({ taskStatus: 'frame_review', isActionSubmitting: false, statusMessage: result.message || '触发视频生成失败' })
        return
      }
      patch({ isActionSubmitting: false, statusMessage: result.message || '视频生成中，请稍候...' })
      startForegroundPolling(taskId, platform)
    } catch (err) {
      patch({ taskStatus: 'frame_review', isActionSubmitting: false, statusMessage: err.message || '触发视频生成失败' })
    }
  }, [patch, startForegroundPolling])

  // ── 抖音：重新生成视频 ─────────────────────────────────────
  const regenVideo = useCallback(async () => {
    const { taskId, platform } = stateRef.current
    if (!taskId) return
    try {
      patch({ isActionSubmitting: true, taskStatus: 'video_generating', statusMessage: '正在重新生成视频...' })
      const result = await regenerateVideo(taskId, platform)
      if (result?.success === false) {
        patch({ taskStatus: 'video_review', isActionSubmitting: false, statusMessage: result.message || '重新生成视频失败' })
        return
      }
      patch({ isActionSubmitting: false, statusMessage: result.message || '正在重新生成视频...' })
      startForegroundPolling(taskId, platform)
    } catch (err) {
      patch({ taskStatus: 'video_review', isActionSubmitting: false, statusMessage: err.message || '重新生成视频失败' })
    }
  }, [patch, startForegroundPolling])

  // ── 抖音：确认视频，任务完成 ───────────────────────────────
  const confirmVideo = useCallback(async () => {
    const { taskId, platform } = stateRef.current
    if (!taskId) return
    try {
      patch({ isActionSubmitting: true, statusMessage: '正在确认完成...' })
      const result = await submitUserAction(taskId, 'confirm_video', '', '', platform)
      if (result?.success === false) {
        patch({ isActionSubmitting: false, statusMessage: result.message || '确认失败' })
        return
      }
      patch({ taskStatus: 'completed', isActionSubmitting: false, statusMessage: result.message || '任务已完成！' })
    } catch (err) {
      patch({ isActionSubmitting: false, statusMessage: err.message || '确认失败' })
    }
  }, [patch])

  const stopTask = useCallback(async () => {
    const { taskId, taskStatus } = stateRef.current
    if (!taskId || TERMINAL_STATUSES.has(taskStatus)) return

    const message = '任务已由用户停止'
    patch({ isActionSubmitting: true, statusMessage: '正在停止任务...' })

    try {
      const result = await cancelWorkflow(taskId)
      stopPolling()
      if (delayTimerRef.current) {
        clearTimeout(delayTimerRef.current)
        delayTimerRef.current = null
      }
      unregisterTask(taskId)
      approvingImageIndexRef.current = null
      rejectingImageRef.current = null
      actionLockRef.current = null
      patch({
        taskStatus: 'failed',
        statusMessage: result.message || message,
        errorMessage: result.message || message,
        isActionSubmitting: false,
      })
    } catch (err) {
      patch({
        isActionSubmitting: false,
        statusMessage: err.message || '停止任务失败，请稍后重试',
      })
    }
  }, [patch, stopPolling])
  const reset = useCallback(() => {
    stopPolling()
    manualPreviewTextRef.current = null
    setState(INITIAL_STATE)
  }, [stopPolling])

  return {
    ...state,
    submit,
    revise,
    confirm,
    updatePreviewText,
    approveXhsImage,
    rejectXhsImage,
    regenImages,
    approveFrame,
    rejectFrame,
    triggerGenerateVideo,
    regenVideo,
    confirmVideo,
    stopTask,
    reset,
  }
}

