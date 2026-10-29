import path from 'path'
import dotenv from 'dotenv'
import { validateProductionSecurity } from './utils/productionSecurity.js'

dotenv.config()
validateProductionSecurity(process.env)

const isProduction = process.env.NODE_ENV === 'production'

function required(name, fallback = undefined) {
  const value = process.env[name] || fallback
  if (!value && isProduction) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function normalizePublicPath(value) {
  if (!value) return '/uploads'
  return value.startsWith('/') ? value : `/${value}`
}

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction,
  port: Number(process.env.PORT || 4000),
  databaseUrl: required('DATABASE_URL'),
  sessionSecret: required('SESSION_SECRET', isProduction ? undefined : 'dev-only-session-secret'),
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProduction,
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  adminEmail: process.env.ADMIN_EMAIL,
  adminInitialPassword: process.env.ADMIN_INITIAL_PASSWORD,
  n8nTimeoutMs: Number(process.env.N8N_TIMEOUT_MS || 60000),
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || '15mb',
  publicBaseUrl: required('PUBLIC_BASE_URL', isProduction ? undefined : '').replace(/\/$/, ''),
  uploadsDir: process.env.UPLOADS_DIR || path.resolve(process.cwd(), 'storage', 'uploads'),
  uploadsPublicPath: normalizePublicPath(process.env.UPLOADS_PUBLIC_PATH),
  maxReferenceImageBytes: Number(process.env.MAX_REFERENCE_IMAGE_BYTES || 3145728),
  maxReferenceImageCount: Number(process.env.MAX_REFERENCE_IMAGE_COUNT || 3),
  maxReferenceImageRequestsPerWindow: Number(process.env.MAX_REFERENCE_IMAGE_REQUESTS || 30),
  allowedReferenceImageTypes: ['image/png', 'image/jpeg', 'image/webp'],
  webhooks: {
    xiaohongshu: {
      START_WORKFLOW_URL: process.env.XHS_START_WORKFLOW_URL,
      STATUS_QUERY_URL: process.env.XHS_STATUS_QUERY_URL,
      USER_ACTION_URL: process.env.XHS_USER_ACTION_URL,
      REGENERATE_IMAGE_URL: process.env.XHS_REGENERATE_IMAGE_URL,
    },
    douyin: {
      START_WORKFLOW_URL: process.env.DOUYIN_START_WORKFLOW_URL,
      STATUS_QUERY_URL: process.env.DOUYIN_STATUS_QUERY_URL,
      DOWNLOAD_URL: process.env.DOUYIN_DOWNLOAD_URL,
      USER_ACTION_URL: process.env.DOUYIN_USER_ACTION_URL,
      FRAME_ACTION_URL: process.env.DOUYIN_FRAME_ACTION_URL,
      GENERATE_VIDEO_URL: process.env.DOUYIN_GENERATE_VIDEO_URL,
      REGENERATE_VIDEO_URL: process.env.DOUYIN_REGENERATE_VIDEO_URL,
    },
  },
}

export const SESSION_COOKIE_NAME = 'wfs_session'

const ARTICLE_PLATFORMS = new Set(['xiaohongshu', 'zhihu', 'wechat'])
const VIDEO_PLATFORMS = new Set(['douyin', 'kuaishou', 'bilibili'])

export function normalizePlatform(platform) {
  const value = String(platform || '').toLowerCase()
  if (VIDEO_PLATFORMS.has(value)) return value
  if (ARTICLE_PLATFORMS.has(value)) return value
  return 'xiaohongshu'
}

export function isVideoPlatform(platform) {
  return VIDEO_PLATFORMS.has(normalizePlatform(platform))
}

export function getWebhookUrls(platform) {
  return isVideoPlatform(platform) ? config.webhooks.douyin : config.webhooks.xiaohongshu
}

