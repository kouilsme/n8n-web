/**
 * usePoller hook
 * 封装轮询逻辑，可在任意组件中复用
 * 轮询持续到任务进入终态（completed/failed）或调用 stop()
 */

import { useRef, useCallback } from 'react'
import { createStatusPoller } from '../api'
import { getSession, isCurrentSession } from '../session.js'

/**
 * @param {Function} onUpdate  每次收到状态更新时的回调
 * @param {Function} onError   轮询出错时的回调
 * @returns {{ start: Function, stop: Function }}
 */
export function usePoller(onUpdate, onError) {
  const stopRef = useRef(null)

  const stop = useCallback(() => {
    if (stopRef.current) {
      stopRef.current()
      stopRef.current = null
    }
  }, [])

  const start = useCallback((taskId, platform) => {
    // 先停止可能存在的旧轮询
    stop()
    const session = getSession()
    if (!isCurrentSession(session)) return
    const signal = session.controller.signal
    const stopPoller = createStatusPoller(taskId,
      (result) => { if (isCurrentSession(session)) onUpdate(result) },
      (err) => { if (isCurrentSession(session)) onError(err) }, platform)
    const cancel = () => {
      stopPoller()
      signal.removeEventListener('abort', cancel)
    }
    signal.addEventListener('abort', cancel, { once: true })
    stopRef.current = cancel
  }, [stop, onUpdate, onError])

  return { start, stop }
}

