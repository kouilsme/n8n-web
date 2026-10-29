export function validateProductionSecurity(env) {
  if (env.NODE_ENV !== 'production') return
  const secret = env.SESSION_SECRET || ''
  if (secret.length < 32 || /replace[-_ ]|change[-_ ]|dev-only|local-dev/i.test(secret)) {
    throw new Error('SESSION_SECRET must be a non-placeholder random secret of at least 32 characters')
  }
  if (env.COOKIE_SECURE === 'false') throw new Error('COOKIE_SECURE must be true in production; configure HTTPS first')
  for (const name of ['FRONTEND_ORIGIN', 'PUBLIC_BASE_URL']) {
    let url
    try { url = new URL(env[name]) } catch { throw new Error(`${name} must be an HTTPS URL in production`) }
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error(`${name} must be an HTTPS URL without credentials in production`)
    }
    if (name === 'FRONTEND_ORIGIN' && url.origin !== env[name]) {
      throw new Error('FRONTEND_ORIGIN must contain only the HTTPS origin, without a path or trailing slash')
    }
  }
}
