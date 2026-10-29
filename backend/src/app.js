import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import cookieParser from 'cookie-parser'
import { requestSecurity } from './middleware/requestSecurity.js'
import { config } from './config.js'
import { authRouter } from './routes/auth.js'
import { adminRouter } from './routes/admin.js'
import { tasksRouter } from './routes/tasks.js'
import { uploadsRouter } from './routes/uploads.js'
import { workflowsRouter } from './routes/workflows.js'

export function createApp() {
  const app = express()

  app.set('trust proxy', 1)
  app.use(helmet())
  app.use(cors({
    origin: config.frontendOrigin,
    credentials: true,
  }))
  app.use('/api', requestSecurity(config.frontendOrigin))
  app.use(express.json({ limit: config.jsonBodyLimit, inflate: false }))
  app.use(cookieParser())
  app.use(morgan(config.isProduction ? 'combined' : 'dev'))
  app.use(config.uploadsPublicPath, express.static(config.uploadsDir, {
    dotfiles: 'deny',
    fallthrough: true,
    index: false,
    maxAge: config.isProduction ? '7d' : 0,
  }))

  app.get('/health', (_req, res) => {
    res.json({ success: true, service: 'workflow-studio-backend' })
  })

  app.use('/api/auth', authRouter)
  app.use('/api/admin', adminRouter)
  app.use('/api/tasks', tasksRouter)
  app.use('/api/uploads', uploadsRouter)
  app.use('/api/workflows', workflowsRouter)

  app.use((_req, res) => {
    res.status(404).json({ success: false, message: '接口不存在' })
  })

  app.use((err, _req, res, _next) => {
    console.error('Request failed', { name: err.name, status: err.status || 500, code: err.code })
    const status = [400, 413, 415].includes(err.status) ? err.status : 500
    res.status(status).json({
      success: false,
      message: status === 413 ? '请求内容过大' : status === 415 ? '请求编码不受支持' : status === 400 ? '请求内容无效' : config.isProduction ? '服务器内部错误' : err.message,
    })
  })

  return app
}

