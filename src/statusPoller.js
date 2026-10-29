const TERMINAL = new Set(['completed', 'failed'])
const WAITING = new Set(['waiting_user_feedback', 'image_review', 'frame_review', 'video_review'])
const REVIEW_STEPS = new Set(['xhs_image_review', 'douyin_frame_review', 'douyin_video_review'])

// Sequential requests, bounded retries and explicit cancellation in one place.
export function createPoller({ query, onUpdate, onError, interval, timeout, maxRetries = 4 }) {
  let timer = null
  let controller = null
  let stopped = false
  let failures = 0
  let activeSince = Date.now()

  const stop = () => {
    stopped = true
    clearTimeout(timer)
    controller?.abort()
  }

  const fail = (err) => {
    stop()
    onError(err)
  }

  const poll = async () => {
    if (stopped) return
    if (Date.now() - activeSince >= timeout) {
      fail(new Error('轮询超时，请检查工作流状态或刷新页面重试'))
      return
    }

    controller = new AbortController()
    let result
    try {
      result = await query(controller.signal)
    } catch (err) {
      if (stopped) return
      failures += 1
      if (err.retryable === false || failures > maxRetries) {
        fail(err)
        return
      }
      timer = setTimeout(poll, Math.min(interval * 2 ** failures, 30000))
      return
    }
    if (stopped) return
    failures = 0
    // Time spent reviewing a draft must not consume the generation timeout.
    if (WAITING.has(result.status) || REVIEW_STEPS.has(result.stepName)) {
      activeSince = Date.now()
    }
    onUpdate(result)
    if (stopped) return
    if (TERMINAL.has(result.status) || result.stepName === 'douyin_batch_completed') {
      stop()
      return
    }
    timer = setTimeout(poll, interval)
  }

  timer = setTimeout(poll, interval)
  return stop
}
