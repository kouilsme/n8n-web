import path from 'path'
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import express from 'express'
import rateLimit from 'express-rate-limit'
import { config } from '../config.js'
import { requireAuth } from '../middleware/auth.js'
import { hasImageSignature } from '../utils/imageSignature.js'

export const uploadsRouter = express.Router()

class UploadValidationError extends Error {}

const MIME_TO_EXTENSION = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

uploadsRouter.use(requireAuth)
uploadsRouter.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.maxReferenceImageRequestsPerWindow,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id || req.ip),
  message: { success: false, message: '上传过于频繁，请稍后再试' },
}))

function getPlatform(value) {
  const platform = String(value || '').toLowerCase()
  if (['douyin', 'kuaishou', 'bilibili', 'xiaohongshu', 'zhihu', 'wechat'].includes(platform)) {
    return platform
  }
  return 'xiaohongshu'
}

function getPublicOrigin(req) {
  if (config.publicBaseUrl) {
    return config.publicBaseUrl
  }
  return `${req.protocol}://${req.get('host')}`
}

function sanitizeFileName(name) {
  const base = path.basename(String(name || 'reference-image'))
  const sanitized = base.replace(/[^a-zA-Z0-9._-\u4e00-\u9fa5]/g, '_')
  return sanitized.slice(0, 80) || 'reference-image'
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') {
    throw new UploadValidationError('图片内容不能为空')
  }

  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!match) {
    throw new UploadValidationError('仅支持 PNG、JPG、WEBP 图片')
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  }
}

function normalizeStorageKey(storageKey, userId) {
  if (typeof storageKey !== 'string' || storageKey.trim() === '') return null

  const normalized = path.posix.normalize(storageKey.replace(/\\/g, '/')).replace(/^\/+/, '')
  const segments = normalized.split('/')
  if (segments.length !== 4) return null
  if (segments[0] !== 'reference-images') return null
  if (!['xiaohongshu', 'douyin', 'zhihu', 'wechat', 'kuaishou', 'bilibili'].includes(segments[1])) return null
  if (segments[2] !== String(userId)) return null
  if (!segments[3]) return null
  return normalized
}

async function deleteStoredFiles(storageKeys, userId) {
  const normalizedKeys = Array.isArray(storageKeys)
    ? storageKeys.map((storageKey) => normalizeStorageKey(storageKey, userId)).filter(Boolean)
    : []

  await Promise.all(normalizedKeys.map(async (storageKey) => {
    const diskPath = path.join(config.uploadsDir, storageKey)
    await fs.unlink(diskPath).catch(() => {})
  }))

  return normalizedKeys.length
}

uploadsRouter.post('/reference-images', async (req, res, next) => {
  const writtenKeys = []

  try {
    const platform = getPlatform(req.body?.platform)
    const files = Array.isArray(req.body?.files) ? req.body.files : []

    if (files.length === 0) {
      return res.status(400).json({ success: false, message: '请至少上传 1 张参考图片' })
    }

    if (files.length > config.maxReferenceImageCount) {
      return res.status(400).json({
        success: false,
        message: `最多上传 ${config.maxReferenceImageCount} 张参考图片`,
      })
    }

    const validatedFiles = files.map((file) => {
      const displayName = sanitizeFileName(file?.name)
      const { mimeType, buffer } = parseDataUrl(file?.dataUrl)

      if (!config.allowedReferenceImageTypes.includes(mimeType)) {
        throw new UploadValidationError('图片格式不受支持')
      }

      if (buffer.length === 0) {
        throw new UploadValidationError('图片内容为空')
      }

      if (buffer.length > config.maxReferenceImageBytes) {
        throw new UploadValidationError(`单张图片不能超过 ${(config.maxReferenceImageBytes / (1024 * 1024)).toFixed(0)}MB`)
      }

      if (!hasImageSignature(buffer, mimeType)) {
        throw new UploadValidationError('图片内容与声明格式不匹配')
      }
      return { displayName, mimeType, buffer }
    })

    const relativeDir = path.posix.join('reference-images', platform, String(req.user.id))
    const outputDir = path.join(config.uploadsDir, relativeDir)
    await fs.mkdir(outputDir, { recursive: true })

    const uploadedFiles = []

    for (const file of validatedFiles) {
      const extension = MIME_TO_EXTENSION[file.mimeType]
      const generatedName = `${Date.now()}-${randomUUID()}.${extension}`
      const storageKey = path.posix.join(relativeDir, generatedName)
      const diskPath = path.join(config.uploadsDir, storageKey)
      await fs.writeFile(diskPath, file.buffer)
      writtenKeys.push(storageKey)

      const relativeUrl = `${config.uploadsPublicPath}/${storageKey}`.replace(/\\/g, '/')
      uploadedFiles.push({
        name: file.displayName,
        type: file.mimeType,
        size: file.buffer.length,
        storageKey,
        url: `${getPublicOrigin(req)}${relativeUrl}`,
      })
    }

    res.json({ success: true, files: uploadedFiles })
  } catch (err) {
    await deleteStoredFiles(writtenKeys, req.user.id)
    if (err instanceof UploadValidationError) {
      return res.status(400).json({ success: false, message: err.message })
    }
    next(err)
  }
})

uploadsRouter.delete('/reference-images', async (req, res, next) => {
  try {
    const deletedCount = await deleteStoredFiles(req.body?.storageKeys, req.user.id)
    res.json({ success: true, deletedCount })
  } catch (err) {
    next(err)
  }
})




