/**
 * 任务历史存储模块
 * 基于 localStorage 的任务记录 CRUD，支持跨页面刷新持久化
 * 最多保存 MAX_TASK_RECORDS 条，超出时 FIFO 淘汰最旧的
 */

import config from './config.js'
import { userStorageKey } from './session.js'

const MAX_RECORDS = config.MAX_TASK_RECORDS || 50

/**
 * 从 localStorage 读取所有任务记录
 * @returns {Array}
 */
function readAll() {
  try {
    const key = userStorageKey('task_records')
    if (!key) return []
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const records = JSON.parse(raw)
    return Array.isArray(records)
      ? records.filter((record) => record && typeof record === 'object' && typeof record.taskId === 'string')
      : []
  } catch {
    return []
  }
}

/**
 * 将任务列表写入 localStorage
 * @param {Array} records
 */
function writeAll(records) {
  try {
    const key = userStorageKey('task_records')
    if (key) localStorage.setItem(key, JSON.stringify(records))
  } catch {
    // localStorage 写入失败（如隐私模式或存储已满），静默忽略
  }
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function protectExistingDraft(existing, task) {
  if (!existing) return task

  const explicitlyClearedManual = hasOwn(task, '_manualPreviewText') && task._manualPreviewText === null
  const incomingManualText = task._manualPreviewText ?? null
  const existingManualText = !explicitlyClearedManual ? (existing._manualPreviewText ?? null) : null
  const protectedText = incomingManualText ??
    existingManualText ??
    (task.confirmedText || existing.confirmedText || null)

  if (typeof protectedText !== 'string' || (protectedText.length === 0 && incomingManualText == null && existingManualText == null)) return task

  const basePreview = task.preview || existing.preview || {}
  return {
    ...task,
    confirmedText: task.confirmedText ?? existing.confirmedText,
    _manualPreviewText: task._manualPreviewText ?? existing._manualPreviewText,
    _manualPreviewUpdatedAt: task._manualPreviewUpdatedAt || existing._manualPreviewUpdatedAt,
    preview: {
      ...basePreview,
      text: protectedText,
      images: basePreview.images || [],
      videos: basePreview.videos || [],
    },
  }
}

/**
 * 保存（新建或更新）一条任务记录
 * @param {{
 *   taskId: string,
 *   platform: 'xiaohongshu' | 'douyin',
 *   status: string,
 *   formParams: object,
 *   preview: object | null,
 *   previewHistory: Array,
 *   stepName: string,
 *   statusMessage: string,
 *   errorMessage: string | null,
 *   createdAt: number,
 *   xhsImages: Array,
 *   currentXhsImageIndex: number,
 * }} task
 */
export function saveTask(task) {
  const records = readAll()
  const now = Date.now()
  const existingIdx = records.findIndex((r) => r.taskId === task.taskId)

  if (existingIdx !== -1) {
    // 更新现有记录
    const protectedTask = protectExistingDraft(records[existingIdx], task)
    records[existingIdx] = { ...records[existingIdx], ...protectedTask, updatedAt: now }
  } else {
    // 新增记录：超出上限时淘汰最旧的（按 createdAt 升序，最旧在前）
    const newRecord = { ...task, createdAt: task.createdAt || now, updatedAt: now }
    records.push(newRecord)

    if (records.length > MAX_RECORDS) {
      records.sort((a, b) => a.createdAt - b.createdAt)
      records.splice(0, records.length - MAX_RECORDS)
    }
  }

  writeAll(records)
}

/**
 * 获取单条任务记录
 * @param {string} taskId
 * @returns {object | null}
 */
export function getTask(taskId) {
  return readAll().find((r) => r.taskId === taskId) || null
}

/**
 * 获取所有任务记录，按创建时间倒序（最新在前）
 * @param {'xiaohongshu' | 'douyin' | null} platform  传 null 获取全部平台
 * @returns {Array}
 */
export function getAllTasks(platform = null) {
  const records = readAll()
  const filtered = platform ? records.filter((r) => r.platform === platform) : records
  return [...filtered].sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * 删除单条任务记录
 * @param {string} taskId
 */
export function deleteTask(taskId) {
  const records = readAll().filter((r) => r.taskId !== taskId)
  writeAll(records)
}

/**
 * 清空任务记录
 * @param {'xiaohongshu' | 'douyin' | null} platform  传 null 清空所有平台
 * @param {boolean} terminalOnly  仅清空完成/失败记录，保留进行中的任务
 */
export function clearAllTasks(platform = null, terminalOnly = false) {
  const records = readAll().filter((record) => {
    if (platform && record.platform !== platform) return true
    return terminalOnly && !['completed', 'failed'].includes(record.status)
  })
  writeAll(records)
}
