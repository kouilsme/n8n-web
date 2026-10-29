function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function hasValue(value) {
  return value !== undefined && value !== null
}

const TEXT_ACTIONS = new Set(['revise', 'confirm', 'generate_images', 'generate_media'])
const CONFIRMING_TEXT_ACTIONS = new Set(['confirm', 'generate_images', 'generate_media'])

function pickSubmittedText(previousText, confirmedText) {
  const submitted = {}
  if (hasValue(previousText)) submitted.previousText = String(previousText)
  if (hasValue(confirmedText)) submitted.confirmedText = String(confirmedText)
  return submitted
}

function preferredSubmittedText(previousText, confirmedText) {
  const confirmed = hasValue(confirmedText) ? String(confirmedText) : ''
  const previous = hasValue(previousText) ? String(previousText) : ''
  return confirmed || previous || null
}

function parseJsonObject(text) {
  if (typeof text !== 'string' || !text.trim()) return null
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function preferIncomingList(incoming, existing) {
  if (Array.isArray(incoming) && incoming.length > 0) return incoming
  if (Array.isArray(existing) && existing.length > 0) return existing
  return Array.isArray(incoming) ? incoming : (existing || [])
}

function buildPreview(existingPreview, metadata) {
  const preview = asObject(existingPreview || metadata.preview)
  const text = metadata.confirmedText || preview.text || null
  if (!text && Object.keys(preview).length === 0) return null
  return {
    ...preview,
    ...(text ? { text } : {}),
  }
}

export function normalizeStatus(result = {}) {
  if (result.status === 'completed') return 'COMPLETED'
  if (result.status === 'failed') return 'FAILED'
  if (result.status === 'waiting_user_feedback') return 'WAITING_USER_FEEDBACK'
  if (result.stepName === 'douyin_batch_completed') return 'COMPLETED'
  if (result.stepName === 'xhs_image_review') return 'IMAGE_REVIEW'
  if (result.stepName === 'douyin_frame_review' || result.stepName === 'douyin_frame_generating') return 'FRAME_REVIEW'
  if (result.stepName === 'douyin_video_generating') return 'VIDEO_GENERATING'
  if (result.stepName === 'douyin_video_review') return 'VIDEO_REVIEW'
  return 'PROCESSING'
}

export function mergeResultMetadata(existingMetadata, result = {}) {
  const metadata = asObject(existingMetadata)
  const hasConfirmedText = typeof metadata.confirmedText === 'string' && metadata.confirmedText.length > 0
  return {
    ...metadata,
    ...Object.fromEntries(['xhsImages', 'currentImageIndex', 'frames', 'currentFrameIndex',
      'videoUrl', 'workflowMode', 'allowRevise', 'allowConfirm', 'history', 'previewHistory']
      .filter((key) => result[key] !== undefined).map((key) => [key, result[key]])),
    downloadUrl: result.downloadUrl ?? metadata.downloadUrl ?? null,
    fileList: preferIncomingList(result.fileList, metadata.fileList),
    storyboardDocument: hasConfirmedText && metadata.storyboardDocument
      ? metadata.storyboardDocument
      : (result.storyboardDocument ?? metadata.storyboardDocument ?? null),
    generationProgress: result.generationProgress ?? metadata.generationProgress ?? null,
    stepName: result.stepName ?? metadata.stepName ?? null,
    statusMessage: result.message ?? metadata.statusMessage ?? null,
    raw: result,
  }
}

export function mergeResultPreview(existingPreview, existingMetadata, incomingPreview) {
  const metadata = asObject(existingMetadata)
  const confirmedText = metadata.confirmedText || null
  const basePreview = incomingPreview || existingPreview || metadata.preview || null

  if (!confirmedText) {
    return basePreview || undefined
  }

  return {
    ...asObject(basePreview),
    text: confirmedText,
  }
}

export function terminalResult(task) {
  const metadata = asObject(task.metadata)
  const status = task.status.toLowerCase()
  const statusMessage = task.errorMessage || metadata.statusMessage || (status === 'completed' ? 'Task completed' : 'Task ended')

  return {
    success: status !== 'failed',
    status,
    message: statusMessage,
    taskId: task.taskId,
    preview: buildPreview(task.resultPreview, metadata),
    downloadUrl: metadata.downloadUrl || null,
    fileList: metadata.fileList || [],
    storyboardDocument: metadata.storyboardDocument || null,
    generationProgress: metadata.generationProgress || null,
    stepName: metadata.stepName || '',
    statusMessage,
  }
}

export function buildActionPersistence({
  action,
  existingPreview,
  existingMetadata,
  previousText,
  confirmedText,
  upstreamResult = {},
}) {
  const actionName = String(action || '')
  const currentMetadata = asObject(existingMetadata)
  const usesText = TEXT_ACTIONS.has(actionName)
  const confirmsText = CONFIRMING_TEXT_ACTIONS.has(actionName)
  const submittedText = usesText ? pickSubmittedText(previousText, confirmedText) : {}
  const text = usesText ? preferredSubmittedText(previousText, confirmedText) : null
  const parsedStoryboard = confirmsText ? parseJsonObject(text) : null
  const metadata = {
    ...currentMetadata,
    ...submittedText,
    ...(confirmsText && text ? { confirmedText: text } : {}),
    ...(usesText && text ? { lastSubmittedText: text } : {}),
    ...(parsedStoryboard ? { storyboardDocument: parsedStoryboard } : {}),
    statusMessage: upstreamResult.message ?? currentMetadata.statusMessage ?? null,
    lastUserActionResult: upstreamResult,
  }

  const persistence = {
    metadata,
  }

  if (usesText && text !== null) {
    persistence.resultPreview = {
      ...asObject(existingPreview),
      ...submittedText,
      text,
    }
  }

  return persistence
}

