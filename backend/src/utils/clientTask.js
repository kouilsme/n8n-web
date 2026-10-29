function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function toClientTask(task) {
  const metadata = asObject(task.metadata)
  // Older records kept review fields only in the last raw n8n response.
  const state = { ...asObject(metadata.raw), ...metadata }
  const interactive = task.inputParams?.['工作流模式'] === '逐帧审核模式'
  const waiting = task.status === 'WAITING_USER_FEEDBACK'
  return {
    id: task.id,
    taskId: task.taskId,
    platform: task.platform,
    status: task.status.toLowerCase(),
    formParams: task.inputParams || null,
    preview: metadata.confirmedText
      ? { ...(task.resultPreview || {}), text: metadata.confirmedText }
      : (task.resultPreview || null),
    previewHistory: state.previewHistory || [],
    history: state.history || [],
    stepName: state.stepName || '',
    statusMessage: state.statusMessage || state.message || '',
    errorMessage: task.errorMessage || null,
    createdAt: task.createdAt?.getTime ? task.createdAt.getTime() : task.createdAt,
    updatedAt: task.updatedAt?.getTime ? task.updatedAt.getTime() : task.updatedAt,
    completedAt: task.completedAt,
    downloadUrl: state.downloadUrl || null,
    fileList: state.fileList || [],
    storyboardDocument: state.storyboardDocument || null,
    generationProgress: state.generationProgress || null,
    confirmedText: metadata.confirmedText || '',
    workflowMode: state.workflowMode || (interactive ? 'interactive' : 'batch'),
    xhsImages: state.xhsImages || [],
    currentXhsImageIndex: state.currentImageIndex ?? 0,
    frames: state.frames || [],
    currentFrameIndex: state.currentFrameIndex ?? 0,
    videoUrl: state.videoUrl || null,
    allowRevise: state.allowRevise ?? waiting,
    allowConfirm: state.allowConfirm ?? waiting,
  }
}
