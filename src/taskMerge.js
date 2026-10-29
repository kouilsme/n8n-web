export function protectLocalDraft(record, localRecord) {
  const protectedText = localRecord?._manualPreviewText ?? localRecord?.confirmedText
  if (typeof protectedText !== 'string' || (protectedText.length === 0 && localRecord?._manualPreviewText == null)) return record

  const basePreview = record.preview || localRecord.preview || {}
  return {
    ...record,
    confirmedText: localRecord.confirmedText || record.confirmedText,
    _manualPreviewText: localRecord._manualPreviewText ?? record._manualPreviewText,
    _manualPreviewUpdatedAt: localRecord._manualPreviewUpdatedAt || record._manualPreviewUpdatedAt,
    preview: {
      ...basePreview,
      text: protectedText,
      images: basePreview.images || [],
      videos: basePreview.videos || [],
    },
    storyboardDocument: localRecord.confirmedText || record.storyboardDocument,
  }
}

export function mergeTasks(localTasks, remoteTasks) {
  const byId = new Map()
  for (const task of localTasks || []) {
    byId.set(task.taskId, task)
  }
  for (const task of remoteTasks || []) {
    const existing = byId.get(task.taskId) || {}
    const latest = (existing.updatedAt || 0) > (task.updatedAt || 0)
      ? { ...task, ...existing }
      : { ...existing, ...task }
    byId.set(task.taskId, protectLocalDraft(latest, existing))
  }
  return [...byId.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

