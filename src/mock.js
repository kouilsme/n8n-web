/**
 * Mock 服务
 * 在没有真实 n8n 接口时，模拟完整工作流流程
 * 支持：小红书全流程 + 重新生成图片
 *       抖音全流程：草稿 → 逐帧审核 → 视频生成 → 视频审核
 */

import config from './config.js'
import { getPlatformLabel, isVideoPlatform } from './platforms.js'

// 内存中存储 mock 任务状态
const mockTasks = {}

// 延迟函数
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 示例图片和视频（使用 placeholder）
const MOCK_IMAGES = [
  'https://picsum.photos/seed/xhs1/400/500',
  'https://picsum.photos/seed/xhs2/400/500',
  'https://picsum.photos/seed/xhs3/400/500',
  'https://picsum.photos/seed/xhs4/400/500',
]

const MOCK_VIDEO = 'https://www.w3schools.com/html/mov_bbb.mp4'

/**
 * 小红书 mock 内容
 */
function generateXiaohongshuMockContent(params) {
  const topic = params['主题/产品'] || '护肤精华'
  const audience = params['目标人群'] || '25-35岁都市女性'
  const style = params['文案风格'] || '种草分享'

  return {
    draftText: `✨ ${topic} | 用了一个月的真实感受 ✨

姐妹们！！！今天必须来给你们安利这个宝藏${topic}！

作为一个${audience}最关心的问题，我真的尝试了市面上不下 20 款产品，直到遇到了它——

🔥 核心亮点：
1. 质地轻薄不油腻，上脸秒吸收
2. 连续使用 28 天，肤质明显改善
3. 成分安全，敏感肌也能放心用

📝 使用心得：
早晚各一次，配合化妆水效果翻倍！第一周就能感受到皮肤变得更通透了～

💡 小贴士：
建议搭配同系列面霜，锁水效果更好哦～

#${topic} #好物分享 #${style} #真实测评`,

    finalText: `✨ ${topic} | 真实测评 30 天 · 素人实测报告 ✨

Hello 姐妹们～今天来交作业啦！

作为一个混油皮+经常熬夜的打工人，我对${topic}的要求就一个字：有效！

🧪 产品信息：
- 品类：${topic}
- 适合人群：${audience}
- 使用时长：30 天

📊 使用前 vs 使用后：
Week 1：肤感变滑，上妆更服帖
Week 2：暗沉减轻，同事问我是不是偷偷去做了医美
Week 3-4：整体肤质稳定提升，自拍不用开滤镜了！

💰 性价比分析：
这个价位能做到这样的效果，真的值了！

⚠️ 注意事项：
1. 敏感肌建议先耳后试用
2. 建议避光保存
3. 孕期慎用

#${topic} #护肤心得 #真实分享 #好物安利 #素人测评`,

    images: MOCK_IMAGES.slice(0, parseInt(params['图片张数']) || 3),
  }
}

/**
 * 抖音 mock 内容
 */
function generateDouyinMockContent(params) {
  const topic = params['主题/产品'] || '智能手表'
  const duration = params['视频时长'] || '30秒'
  const videoType = params['视频类型（口播 / 混剪 / 剧情）'] || '口播'

  return {
    draftText: `🎬 ${topic} · ${videoType}短视频脚本

【视频时长】${duration}
【视频类型】${videoType}

━━━━━━━━━━━━━━━━━━━
📋 分镜脚本：

🎬 分镜 1（0-5秒）- 开场吸引
画面：产品特写，微距镜头
台词："你还在用传统的XXX？"
BGM：轻快电子音乐渐入

🎬 分镜 2（5-15秒）- 痛点引入
画面：日常使用场景展示
台词："每次XX的时候是不是特别烦？${topic}帮你一键搞定！"
转场：快速切换

🎬 分镜 3（15-25秒）- 产品展示
画面：产品功能演示
台词："看看这个功能，真的绝了！"
特效：功能亮点高亮标注

🎬 分镜 4（25-${duration}）- CTA引导
画面：产品 + 价格标签
台词："链接在小黄车，今天下单还有优惠！"
BGM：节奏加强
━━━━━━━━━━━━━━━━━━━

#${topic} #好物推荐 #${videoType}`,

    finalText: `🎬 ${topic} · ${videoType}短视频脚本（终稿）

【视频时长】${duration}
【视频类型】${videoType}
【画面风格】${params['画面风格'] || '明亮清新'}
【BGM风格】${params['BGM 风格'] || '轻快活泼'}

━━━━━━━━━━━━━━━━━━━
📋 完整分镜脚本：

🎬 分镜 1（0-3秒）- 黄金开场
画面：黑屏 → 产品从画面中心放大出现
台词：（画外音）"等等！先看完这条再划走！"
音效：提示音 + BGM 渐入
💡 拍摄提示：使用微距镜头，产品放在转盘上慢速旋转

🎬 分镜 2（3-8秒）- 痛点共鸣
画面：真实生活场景还原
台词："是不是每次XX都特别头疼？我之前也是这样…"
转场：快速模糊切换
💡 表演提示：表情真实，语气要有共鸣感

🎬 分镜 3（8-18秒）- 产品核心卖点
画面：上手展示 + 功能动态演示
台词："直到我发现了${topic}！你看这个设计，简直不要太好用…"
特效：关键功能文字标注弹出
💡 拍摄提示：45度角俯拍，光线明亮

🎬 分镜 4（18-25秒）- 效果对比/使用反馈
画面：使用前后对比 / 真实好评截图
台词："用了两个礼拜，效果你们自己看…评论区都炸了！"
特效：对比分屏 + 弹幕效果

🎬 分镜 5（25-${duration}）- CTA行动号召
画面：产品正面 + 价格 + 优惠信息叠加
台词："${params['CTA/行动引导'] || '链接就在小黄车，手慢无！赶紧冲！'}"
BGM：节奏高潮段
💡 提示：语速加快，营造紧迫感
━━━━━━━━━━━━━━━━━━━

📌 发布建议：
- 最佳发布时间：晚 7-9 点
- 话题标签：#${topic} #好物推荐 #${videoType} #必买清单
- 首条评论引导互动

#${topic} #短视频脚本 #${videoType}`,

    video: MOCK_VIDEO,
    images: MOCK_IMAGES.slice(0, 2),
  }
}

/**
 * Mock: 启动工作流
 */
export async function mockStartWorkflow(platform, sessionId, params) {
  await delay(config.MOCK_DELAYS.startWorkflow)

  const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const content = !isVideoPlatform(platform)
    ? generateXiaohongshuMockContent(params)
    : generateDouyinMockContent(params)

  // 初始化 mock 任务
  mockTasks[taskId] = {
    platform,
    params,
    content,
    // 小红书阶段: 0=processing, 1=draft_ready, 2=revised/confirmed, 3=final, 4=image_regen
    // 抖音阶段:   0=processing, 1=draft_ready, 2=revised/confirmed, 3=confirmed_text,
    //             5=frame_generating, 6=all_frames_approved, 7=video_generating, 8=video_ready
    phase: 0,
    pollCount: 0,
    reviseFeedback: null,
    approvedFrames: [],
    nextFrameIndex: 0,
    videoSeed: 1,
    history: [
      {
        role: 'system',
        type: 'status',
        content: `✅ 工作流已启动\n平台：${getPlatformLabel(platform)}\n任务 ID：${taskId}`,
        timestamp: Date.now(),
      },
    ],
  }

  return {
    success: true,
    taskId,
    status: 'processing',
    message: '工作流已启动，正在生成内容...',
  }
}

/**
 * Mock: 查询状态
 */
export async function mockQueryStatus(taskId) {
  const task = mockTasks[taskId]
  if (!task) {
    return {
      success: false,
      taskId,
      status: 'failed',
      message: '任务不存在',
    }
  }

  task.pollCount++

  // Phase 0: 处理中（前几次轮询）
  if (task.phase === 0) {
    if (task.pollCount >= 2) {
      // 过渡到第一版结果
      task.phase = 1
      task.pollCount = 0

      const previewContent = !isVideoPlatform(task.platform)
        ? {
            text: task.content.draftText,
            images: task.content.images,
            videos: [],
          }
        : {
            text: task.content.draftText,
            images: task.content.images || [],
            videos: task.content.video ? [task.content.video] : [],
          }

      task.history.push({
        role: 'system',
        type: 'status',
        content: '📝 AI 正在生成初稿内容...',
        timestamp: Date.now() - 1000,
      })
      task.history.push({
        role: 'system',
        type: 'preview',
        content: JSON.stringify(previewContent),
        timestamp: Date.now(),
      })

      return {
        success: true,
        taskId,
        status: 'waiting_user_feedback',
        stepName: 'draft',
        message: '初稿已生成，请预览并确认或提出修改意见',
        preview: previewContent,
        history: task.history,
        allowRevise: true,
        allowConfirm: true,
      }
    }

    // 还在处理
    const steps = ['正在分析需求参数...', '正在调用 AI 模型生成内容...']
    return {
      success: true,
      taskId,
      status: 'processing',
      stepName: 'generating',
      message: steps[Math.min(task.pollCount - 1, steps.length - 1)],
      preview: null,
      history: task.history,
      allowRevise: false,
      allowConfirm: false,
    }
  }

  // Phase 1: 等待用户反馈（不变，由 userAction 触发 phase 变更）
  if (task.phase === 1) {
    const previewContent = !isVideoPlatform(task.platform)
      ? {
          text: task.content.draftText,
          images: task.content.images,
          videos: [],
        }
      : {
          text: task.content.draftText,
          images: task.content.images || [],
          videos: task.content.video ? [task.content.video] : [],
        }

    return {
      success: true,
      taskId,
      status: 'waiting_user_feedback',
      stepName: 'draft',
      message: '请预览初稿内容，确认或提出修改意见',
      preview: previewContent,
      history: task.history,
      allowRevise: true,
      allowConfirm: true,
    }
  }

  // Phase 2: 修改/确认后处理中
  if (task.phase === 2) {
    if (task.pollCount >= 2) {
      task.phase = 3
      task.pollCount = 0

      const finalPreview = !isVideoPlatform(task.platform)
        ? {
            text: task.content.finalText,
            images: task.content.images,
            videos: [],
          }
        : {
            text: task.content.finalText,
            images: task.content.images || [],
            videos: task.content.video ? [task.content.video] : [],
          }

      task.history.push({
        role: 'system',
        type: 'preview',
        content: JSON.stringify(finalPreview),
        timestamp: Date.now(),
      })
      task.history.push({
        role: 'system',
        type: 'status',
        content: '🎉 内容生成完成！',
        timestamp: Date.now(),
      })

      return {
        success: true,
        taskId,
        status: 'completed',
        stepName: 'final',
        message: '内容生成完成！可以复制或下载。',
        preview: finalPreview,
        history: task.history,
        allowRevise: false,
        allowConfirm: false,
      }
    }

    const msg = task.reviseFeedback
      ? '正在根据修改意见优化内容...'
      : '正在生成最终版本...'

    return {
      success: true,
      taskId,
      status: 'processing',
      stepName: task.reviseFeedback ? 'revising' : 'finalizing',
      message: msg,
      preview: null,
      history: task.history,
      allowRevise: false,
      allowConfirm: false,
    }
  }

  // Phase 3: 已完成（小红书）
  if (task.phase === 3) {
    const finalPreview = !isVideoPlatform(task.platform)
      ? { text: task.content.finalText, images: task.content.images, videos: [] }
      : { text: task.content.finalText, images: task.content.images || [], videos: task.content.video ? [task.content.video] : [] }

    return {
      success: true, taskId, status: 'completed', stepName: 'final',
      message: '内容生成完成！', preview: finalPreview,
      history: task.history, allowRevise: false, allowConfirm: false,
    }
  }

  // Phase 4: 小红书重新生成图片
  if (task.phase === 4) {
    if (task.pollCount >= 2) {
      task.phase = 3
      task.pollCount = 0
      const newImages = MOCK_IMAGES.map((url, i) => url.replace('xhs', `xhs_r${Date.now()}_${i}`))
      task.content = { ...task.content, images: newImages }
      const regen = { text: task.content.finalText, images: newImages, videos: [] }
      return {
        success: true, taskId, status: 'completed', stepName: 'final',
        message: '图片重新生成完成！', preview: regen,
        history: task.history, allowRevise: false, allowConfirm: false,
      }
    }
    return {
      success: true, taskId, status: 'processing', stepName: 'image_regen',
      message: '正在重新生成图片...', preview: null,
      history: task.history, allowRevise: false, allowConfirm: false,
    }
  }

  // ── 抖音专属阶段 ──────────────────────────────────────────────────────

  // Phase 5: 生成单帧图片中
  if (task.phase === 5) {
    if (task.pollCount >= 2) {
      const fi = task.nextFrameIndex || 0
      if (!task.frames) task.frames = []
      const existingIdx = task.frames.findIndex(f => f.index === fi)
      const newFrame = {
        index: fi,
        imageUrl: MOCK_FRAME_IMAGES[fi % MOCK_FRAME_IMAGES.length],
        storyboardText: `分镜 ${fi + 1}：${task.content.draftText.split('\n').filter(Boolean)[fi + 3] || '画面描述'}`,
        status: 'reviewing',
      }
      if (existingIdx !== -1) {
        task.frames[existingIdx] = newFrame
      } else {
        task.frames.push(newFrame)
      }
      task.phase = 5.5 // 帧已就绪，等待用户审核
      task.pollCount = 0
    }

    return {
      success: true, taskId, status: 'processing', stepName: 'douyin_frame_generating',
      message: `正在生成第 ${(task.nextFrameIndex || 0) + 1} 帧图片...`,
      frames: task.frames || [], currentFrameIndex: task.nextFrameIndex || 0,
      history: task.history, allowRevise: false, allowConfirm: false,
    }
  }

  // Phase 5.5: 帧图片已生成，等待用户审核
  if (task.phase === 5.5) {
    return {
      success: true, taskId, status: 'waiting_user_feedback', stepName: 'douyin_frame_review',
      message: `第 ${(task.nextFrameIndex || 0) + 1} 帧已生成，请审核`,
      frames: task.frames || [], currentFrameIndex: task.nextFrameIndex || 0,
      history: task.history, allowRevise: false, allowConfirm: false,
    }
  }

  // Phase 6: 所有帧已通过，等待触发视频生成
  if (task.phase === 6) {
    return {
      success: true, taskId, status: 'waiting_user_feedback', stepName: 'douyin_frame_review',
      message: '所有分镜图片审核通过！可以开始生成视频。',
      frames: task.frames || [], currentFrameIndex: -1,
      allFramesApproved: true,
      history: task.history, allowRevise: false, allowConfirm: false,
    }
  }

  // Phase 7: 视频生成中
  if (task.phase === 7) {
    if (task.pollCount >= 3) {
      task.phase = 8
      task.pollCount = 0
    }
    return {
      success: true, taskId, status: 'processing', stepName: 'douyin_video_generating',
      message: '正在合成视频，请稍候...', frames: task.frames || [],
      history: task.history, allowRevise: false, allowConfirm: false,
    }
  }

  // Phase 8: 视频就绪，等待审核
  if (task.phase === 8) {
    const videoUrl = `${MOCK_DOUYIN_VIDEO}?seed=${task.videoSeed}`
    return {
      success: true, taskId, status: 'waiting_user_feedback', stepName: 'douyin_video_review',
      message: '视频已生成，请预览并确认。',
      videoUrl, frames: task.frames || [],
      preview: { text: task.content.finalText || task.content.draftText, images: [], videos: [videoUrl] },
      history: task.history, allowRevise: false, allowConfirm: false,
    }
  }
}

/**
 * Mock: 用户操作
 */
export async function mockUserAction(taskId, action, feedback) {
  await delay(config.MOCK_DELAYS.userAction)

  const task = mockTasks[taskId]
  if (!task) {
    return { success: false, status: 'failed', message: '任务不存在' }
  }

  if (action === 'revise') {
    task.reviseFeedback = feedback
    task.history.push({ role: 'user', type: 'text', content: `📝 修改意见：${feedback}`, timestamp: Date.now() })
    task.history.push({ role: 'system', type: 'status', content: '🔄 已收到修改意见，正在重新生成...', timestamp: Date.now() })
    task.phase = 2
    task.pollCount = 0
  } else if (action === 'confirm') {
    task.history.push({ role: 'user', type: 'text', content: '✅ 已确认，继续生成', timestamp: Date.now() })
    if (isVideoPlatform(task.platform)) {
      // 抖音：确认稿件后进入逐帧生成阶段
      task.history.push({ role: 'system', type: 'status', content: '⏳ 确认成功，开始逐帧生成分镜图片...', timestamp: Date.now() })
      task.phase = 5
      task.nextFrameIndex = 0
      task.approvedFrames = []
      task.frames = []
    } else {
      task.history.push({ role: 'system', type: 'status', content: '⏳ 确认成功，正在生成最终版本...', timestamp: Date.now() })
      task.phase = 2
    }
    task.pollCount = 0
  } else if (action === 'confirm_video') {
    // 抖音：确认视频，任务完成
    task.history.push({ role: 'user', type: 'text', content: '✅ 视频已确认，任务完成', timestamp: Date.now() })
    task.phase = 3
    task.pollCount = 0
  }

  return {
    success: true,
    status: 'processing',
    message: action === 'revise' ? '修改意见已接收，正在重新生成' : action === 'confirm_video' ? '任务已完成！' : '确认成功，正在生成最终版本',
  }
}
// 以下为新增 mock 函数
// =====================================================================

// 抖音分镜图片（每帧一张，与主稿件分镜对应）
const MOCK_FRAME_IMAGES = [
  'https://picsum.photos/seed/frame1/800/450',
  'https://picsum.photos/seed/frame2/800/450',
  'https://picsum.photos/seed/frame3/800/450',
  'https://picsum.photos/seed/frame4/800/450',
]

const MOCK_DOUYIN_VIDEO = 'https://www.w3schools.com/html/mov_bbb.mp4'

/**
 * Mock: 小红书重新生成图片
 */
export async function mockRegenerateImages(taskId, confirmedText) {
  await delay(config.MOCK_DELAYS.userAction)
  const task = mockTasks[taskId]
  if (!task) return { success: false, status: 'failed', message: '任务不存在' }
  task.phase = 4
  task.pollCount = 0
  return { success: true, status: 'processing', message: '正在重新生成图片...' }
}

/**
 * Mock: 抖音单帧审核（approve / reject）
 */
export async function mockFrameAction(taskId, frameIndex, action, feedback) {
  await delay(config.MOCK_DELAYS.userAction)
  const task = mockTasks[taskId]
  if (!task) return { success: false, status: 'failed', message: '任务不存在' }

  if (action === 'approve') {
    if (!task.approvedFrames) task.approvedFrames = []
    if (!task.approvedFrames.includes(frameIndex)) task.approvedFrames.push(frameIndex)
    const totalFrames = MOCK_FRAME_IMAGES.length
    if (task.approvedFrames.length >= totalFrames) {
      task.phase = 6 // all_frames_approved
    } else {
      task.phase = 5 // next_frame_generating
      task.nextFrameIndex = frameIndex + 1
    }
  } else {
    task.phase = 5
    task.nextFrameIndex = frameIndex
    task.rejectFeedback = feedback
  }

  task.pollCount = 0
  return { success: true, status: 'processing', message: action === 'approve' ? '已通过，生成下一帧...' : '已拒绝，重新生成该帧...' }
}

/**
 * Mock: 抖音触发视频生成
 */
export async function mockGenerateVideo(taskId, frames, confirmedText) {
  await delay(config.MOCK_DELAYS.userAction)
  const task = mockTasks[taskId]
  if (!task) return { success: false, status: 'failed', message: '任务不存在' }
  task.phase = 7
  task.pollCount = 0
  return { success: true, status: 'processing', message: '正在生成视频，请稍候...' }
}

/**
 * Mock: 抖音重新生成视频
 */
export async function mockRegenerateVideo(taskId) {
  await delay(config.MOCK_DELAYS.userAction)
  const task = mockTasks[taskId]
  if (!task) return { success: false, status: 'failed', message: '任务不存在' }
  task.phase = 7
  task.pollCount = 0
  task.videoSeed = Date.now()
  return { success: true, status: 'processing', message: '正在重新生成视频...' }
}




