import test from 'node:test'
import assert from 'node:assert/strict'
import { toClientTask } from './clientTask.js'
import { mergeResultMetadata } from './workflowTaskResult.js'

test('history restores interactive mode, frame index, images, video and explicit review permissions', () => {
  const metadata = mergeResultMetadata({}, {
    frames: [{ imageUrl: 'frame' }], currentFrameIndex: 2,
    xhsImages: [{ url: 'cover' }], currentImageIndex: 1, videoUrl: 'video',
    allowRevise: false, allowConfirm: true,
  })
  const task = toClientTask({ taskId: '1', status: 'WAITING_USER_FEEDBACK', platform: 'douyin',
    inputParams: { 工作流模式: '逐帧审核模式' }, metadata })
  assert.equal(task.workflowMode, 'interactive')
  assert.equal(task.currentFrameIndex, 2)
  assert.equal(task.currentXhsImageIndex, 1)
  assert.deepEqual(task.frames, [{ imageUrl: 'frame' }])
  assert.deepEqual(task.xhsImages, [{ url: 'cover' }])
  assert.equal(task.videoUrl, 'video')
  assert.equal(task.allowRevise, false)
  assert.equal(task.allowConfirm, true)
})

test('legacy history recovers review fields from the raw n8n result', () => {
  const task = toClientTask({ taskId: 'old', status: 'FRAME_REVIEW', metadata: {
    raw: { frames: ['frame'], currentFrameIndex: 3, videoUrl: 'video' },
  } })
  assert.deepEqual(task.frames, ['frame'])
  assert.equal(task.currentFrameIndex, 3)
  assert.equal(task.videoUrl, 'video')
})
