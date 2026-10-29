import config from './config.js'

export const SESSION_STORAGE_KEY = `${config.STORAGE_PREFIX}active_user`

let session = { userId: null, controller: new AbortController() }

export function getSession() {
  return session
}

export function isCurrentSession(value) {
  return Boolean(value?.userId) && value === session && !value.controller.signal.aborted
}

export function setSessionUser(userId, { broadcast = true } = {}) {
  const nextUserId = userId ? String(userId) : null
  if (nextUserId === session.userId) return
  const previous = session
  session = { userId: nextUserId, controller: new AbortController() }
  previous.controller.abort()
  if (broadcast) {
    try { localStorage.setItem(SESSION_STORAGE_KEY, nextUserId || '') } catch {}
  }
}

export function userStorageKey(name) {
  return session.userId
    ? `${config.STORAGE_PREFIX}user_${encodeURIComponent(session.userId)}_${name}`
    : null
}

export function handleSessionStorage(event) {
  if (event.key !== SESSION_STORAGE_KEY || !session.userId || event.newValue === session.userId) return false
  setSessionUser(null, { broadcast: false })
  return true
}
