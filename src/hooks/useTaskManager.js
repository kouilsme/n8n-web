import { useState, useCallback, useEffect, useRef } from 'react'
import { getUserTask, getUserTasks } from '../authApi'
import { getAllTasks, deleteTask, clearAllTasks, getTask } from '../taskStore'
import { setUpdateListener } from '../backgroundPoller'

import { mergeTasks } from '../taskMerge.js'

const TERMINAL_STATUSES = new Set(['completed', 'failed'])

export function useTaskManager() {
  const [taskRecords, setTaskRecords] = useState(() => getAllTasks())
  const [activeTaskKey, setActiveTaskKey] = useState('task_0')
  const [selectedTaskRecord, setSelectedTaskRecord] = useState(null)

  const remoteTasksRef = useRef([])
  const hiddenTaskIdsRef = useRef(new Set())
  const refreshTimerRef = useRef(null)
  const selectionRef = useRef(0)

  // Saves and poll updates refresh from local storage without another API call.
  // Defer to avoid updating WorkspaceApp inside useTask's state updater.
  const refreshTaskRecords = useCallback(() => {
    clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = setTimeout(() => {
      setTaskRecords(mergeTasks(getAllTasks(), remoteTasksRef.current))
    }, 0)
  }, [])

  useEffect(() => {
    let stopped = false
    let timer
    let controller
    const sync = async () => {
      controller = new AbortController()
      try {
        const result = await getUserTasks({ signal: controller.signal })
        if (!stopped) {
          remoteTasksRef.current = (result.tasks || []).filter((task) => !hiddenTaskIdsRef.current.has(task.taskId))
          refreshTaskRecords()
        }
      } catch {
        // A failed history refresh must not discard local progress or drafts.
      } finally {
        if (!stopped) timer = setTimeout(sync, 30000)
      }
    }
    sync()
    setUpdateListener(refreshTaskRecords)
    return () => {
      stopped = true
      selectionRef.current += 1
      controller?.abort()
      clearTimeout(timer)
      clearTimeout(refreshTimerRef.current)
      setUpdateListener(null)
    }
  }, [refreshTaskRecords])

  const newTask = useCallback(() => {
    selectionRef.current += 1
    setSelectedTaskRecord(null)
    setActiveTaskKey(`task_${Date.now()}`)
  }, [])

  const selectTask = useCallback(async (taskId) => {
    const selection = ++selectionRef.current
    let remoteRecord
    try {
      const result = await getUserTask(taskId)
      remoteRecord = result.task
    } catch {}
    if (selection !== selectionRef.current) return
    const localRecord = getTask(taskId)
    const record = mergeTasks(localRecord ? [localRecord] : [], remoteRecord ? [remoteRecord] : [])[0]
    if (!record) return
    setSelectedTaskRecord(record)
    setActiveTaskKey(`task_${taskId}_${Date.now()}`)
  }, [])

  const deleteTaskRecord = useCallback((taskId) => {
    hiddenTaskIdsRef.current.add(taskId)
    deleteTask(taskId)
    remoteTasksRef.current = remoteTasksRef.current.filter((task) => task.taskId !== taskId)
    setTaskRecords((records) => records.filter((task) => task.taskId !== taskId))
  }, [])

  const clearTaskRecords = useCallback((platform) => {
    for (const task of mergeTasks(getAllTasks(), remoteTasksRef.current)) {
      if (TERMINAL_STATUSES.has(task.status) && (!platform || task.platform === platform)) {
        hiddenTaskIdsRef.current.add(task.taskId)
      }
    }
    clearAllTasks(platform || null, true)
    remoteTasksRef.current = remoteTasksRef.current.filter((task) =>
      !TERMINAL_STATUSES.has(task.status) || (platform && task.platform !== platform))
    setTaskRecords((records) => records.filter((task) => {
      if (!TERMINAL_STATUSES.has(task.status)) return true
      if (!platform) return false
      return task.platform !== platform
    }))
  }, [])

  return {
    taskRecords,
    activeTaskKey,
    selectedTaskRecord,
    refreshTaskRecords,
    newTask,
    selectTask,
    deleteTaskRecord,
    clearTaskRecords,
  }
}

