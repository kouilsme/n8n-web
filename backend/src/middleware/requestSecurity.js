const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function requestSecurity(frontendOrigin) {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next()
    // A custom header prevents HTML forms/simple fetches from changing state.
    // Cross-origin JSON callers must also pass the exact configured Origin.
    const origin = req.get('Origin')
    if ((origin && origin !== frontendOrigin) || req.get('X-Workflow-Client') !== 'WorkflowStudio') {
      return res.status(403).json({ success: false, message: '请求来源校验失败' })
    }
    if (!req.is('application/json')) {
      return res.status(415).json({ success: false, message: '请求必须使用 JSON 格式' })
    }
    next()
  }
}
