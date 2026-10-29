# WorkflowStudio - n8n 对接与 Docker 部署指南

---

## 目录

1. [项目概述](#1-项目概述)
2. [异步通信架构](#2-异步通信架构)
3. [小红书 Webhook 对接](#3-小红书-webhook-对接)
4. [抖音 Webhook 对接](#4-抖音-webhook-对接)
5. [通用字段参考](#5-通用字段参考)
6. [Docker 部署](#6-docker-部署)
7. [CORS 跨域配置](#7-cors-跨域配置)
8. [常见问题](#8-常见问题)
9. [开发验证](#9-开发验证)

---

## 1. 项目概述

WorkflowStudio 是一个 **AI 内容生成工作台**，支持：

- **小红书**：图文文案生成 → 用户确认/修改 → 重新生成图片
- **抖音**：分镜脚本生成 → 逐帧图片审核 → 视频合成 → 视频审核

两个平台的 n8n Webhook **完全独立**，互不干扰。前端使用异步轮询模式，所有接口立即返回，结果通过 `STATUS_QUERY_URL` 轮询获取。

### 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + Vite + Tailwind CSS |
| 后端 | n8n 工作流自动化 |
| 部署 | Docker (Nginx) + GitHub Actions |

### 可选：参考图片上传

小红书和抖音表单现在都支持上传 1-3 张参考图片。前端会先调用后端上传接口，将图片保存为静态资源，再把以下字段一起传给 n8n：

- 参考图片URL：第一张参考图的绝对 URL
- 参考图片URLs：全部参考图 URL 数组
- 参考图片详情：包含 url、name、type、size 的对象数组

> 重要：PUBLIC_BASE_URL 必须配置成外网可访问域名，例如 https://your-domain.com。如果返回的是 localhost 或内网地址，外部 AI 服务将无法读取参考图。

---

## 2. 异步通信架构

**所有接口均为"触发即返回"模式**：前端调用接口后，n8n 立即返回确认（不等待 AI 处理完成），前端随后通过轮询 `STATUS_QUERY_URL` 获取最新状态。

```
前端                              n8n
 │                                 │
 │── POST start-workflow ─────────→│ 立即返回 { taskId }
 │                                 │（后台开始 AI 处理）
 │── GET  query-status?taskId ────→│ 返回 { status: "processing" }
 │── GET  query-status?taskId ────→│ 返回 { status: "processing" }
 │── GET  query-status?taskId ────→│ 返回 { status: "waiting_user_feedback", preview: {...} }
 │                                 │
 │── POST user-action (confirm) ──→│ 立即返回 { success: true }
 │                                 │（后台继续处理）
 │── GET  query-status?taskId ────→│ 返回 { status: "completed", preview: {...} }
```

**轮询规则**：
- 间隔：每 **3 秒** 一次
- 超时：连续生成 **15 分钟**后停止并提示用户；正常收到待确认/待审核状态时重置计时
- 网络重试：临时断网、超时、HTTP 408/429/5xx 最多连续重试 4 次，按 6/12/24/30 秒退避；成功后重置
- 停止：取消正在进行的状态请求，忽略停止后返回的结果
- 历史同步：任务保存先更新本地列表，服务端历史在挂载时及之后每 30 秒同步，避免每次轮询都重复拉取
- 终态：`completed` 或 `failed` 时停止轮询

---

## 3. 小红书 Webhook 对接

小红书流程：`提交` → `AI处理` → `待确认` → `确认/修改` → `完成` → （可选）`重新生成图片`

需要在 n8n 中创建 **4 个 Workflow**：

---

### 3.1 启动工作流

**方法**: `POST`  
**默认路径**: `/webhook/start-workflow`

**前端请求体**:
```json
{
  "platform": "xiaohongshu",
  "sessionId": "uuid-v4-字符串",
  "params": {
    "主题/产品": "夏季防晒霜",
    "目标人群": "25-35岁都市女性",
    "文案风格": "种草分享",
    "核心卖点": "SPF50+ PA++++\n轻薄不油腻",
    "发布目的": "产品推广",
    "字数范围": "300-500字",
    "图片张数": "3",
    "图片风格": "清新自然",
    "标题风格": "疑问式",
    "标签/关键词": "防晒, 夏季好物",
    "补充说明": ""
  }
}
```

**params 字段说明**:

| 字段名 | 必填 | 可选值 |
|--------|------|--------|
| 主题/产品 | 是 | 自由文本 |
| 目标人群 | 是 | 自由文本 |
| 文案风格 | 是 | 种草分享/干货教程/真实测评/情感共鸣/对比评测/开箱体验/日常分享/攻略指南 |
| 核心卖点 | 是 | 自由文本，多条换行分隔 |
| 发布目的 | 否 | 品牌种草/产品推广/涨粉引流/分享记录/知识科普/活动宣传 |
| 字数范围 | 否 | 100-200字/200-300字/300-500字/500-800字/800字以上 |
| 图片张数 | 否 | 1/2/3/4/6/9 |
| 图片风格 | 否 | 清新自然/高级质感/可爱少女/简约大气/复古文艺/科技感/INS风/日系 |
| 标题风格 | 否 | 疑问式/数字式/感叹式/对比式/悬念式/痛点式 |
| 标签/关键词 | 否 | 逗号分隔 |
| 补充说明 | 否 | 自由文本 |

**n8n 需要立即返回**:
```json
{
  "success": true,
  "taskId": "xhs_1234567890_abc",
  "status": "processing",
  "message": "工作流已启动，正在生成内容..."
}
```

> n8n 返回后，在后台继续调用 AI 生成文案，生成完成后将结果和 `status="waiting_user_feedback"` 写入数据库。

---

### 3.2 查询状态

**方法**: `GET`  
**默认路径**: `/webhook/query-status`  
**前端请求**: `GET /webhook/query-status?taskId=xhs_1234567890_abc`

**处理中时返回**:
```json
{
  "success": true,
  "taskId": "xhs_1234567890_abc",
  "status": "processing",
  "stepName": "generating",
  "message": "正在调用 AI 生成文案...",
  "preview": null,
  "history": [],
  "allowRevise": false,
  "allowConfirm": false
}
```

**初稿完成、等待确认时返回**:
```json
{
  "success": true,
  "taskId": "xhs_1234567890_abc",
  "status": "waiting_user_feedback",
  "stepName": "draft",
  "message": "初稿已生成，请确认或提出修改意见",
  "preview": {
    "text": "✨ 夏日防晒必备 | 真实用后分享 ✨\n\n...(文案全文)",
    "images": [
      "https://your-cdn.com/img1.jpg",
      "https://your-cdn.com/img2.jpg"
    ],
    "videos": []
  },
  "history": [
    { "role": "system", "type": "status", "content": "✅ 工作流已启动", "timestamp": 1700000000000 },
    { "role": "system", "type": "status", "content": "📝 AI 正在生成文案...", "timestamp": 1700000003000 }
  ],
  "allowRevise": true,
  "allowConfirm": true
}
```

**最终完成时返回**:
```json
{
  "success": true,
  "taskId": "xhs_1234567890_abc",
  "status": "completed",
  "stepName": "final",
  "message": "内容生成完成！",
  "preview": {
    "text": "✨ 最终版文案 ✨\n...",
    "images": ["https://your-cdn.com/final1.jpg"],
    "videos": []
  },
  "allowRevise": false,
  "allowConfirm": false
}
```

**失败时返回**:
```json
{
  "success": false,
  "taskId": "xhs_1234567890_abc",
  "status": "failed",
  "message": "AI 调用失败，请重试"
}
```

---

### 3.3 用户操作（确认/修改）

**方法**: `POST`  
**默认路径**: `/webhook/user-action`

**提交修改意见**:
```json
{
  "taskId": "xhs_1234567890_abc",
  "action": "revise",
  "feedback": "标题改为数字式，增加更多emoji，文案更活泼",
  "previousText": "（第一次修改时携带初稿文案，之后修改此字段为空字符串）"
}
```

> `previousText` 字段说明：首次调用 `revise` 时前端会携带当前预览文案，供 n8n 中的 AI 参考原稿进行修改；第二次及以后修改时此字段为空字符串 `""`，n8n 可直接从数据库读取最新版本。

**确认稿件**:
```json
{
  "taskId": "xhs_1234567890_abc",
  "action": "confirm",
  "feedback": "",
  "previousText": "（已确认的文案全文，供后续生成图片使用）"
}
```

**n8n 立即返回**:
```json
{
  "success": true,
  "status": "processing",
  "message": "修改意见已接收，正在重新生成..."
}
```

---

### 3.4 重新生成图片（仅小红书）

文案已确认后，用户可点击"重新生成图片"触发此接口，**不重新生成文案**。

**方法**: `POST`  
**默认路径**: `/webhook/xhs-regenerate-image`

**前端请求体**:
```json
{
  "taskId": "xhs_1234567890_abc",
  "confirmedText": "已确认的文案全文，供图片生成参考"
}
```

**n8n 立即返回**:
```json
{
  "success": true,
  "status": "processing",
  "message": "正在重新生成图片..."
}
```

> n8n 后台调用图片生成 API，完成后将新图片 URL 更新到数据库，`status` 改回 `completed`。前端通过轮询获取新图片。

---

## 4. 抖音 Webhook 对接

抖音流程：`提交` → `AI处理` → `稿件待确认` → `逐帧图片生成` → `逐帧审核` → `触发视频生成` → `视频审核` → `完成`

需要在 n8n 中创建 **6 个 Workflow**：

---

### 4.1 启动工作流

**方法**: `POST`  
**默认路径**: `/webhook/douyin-start-workflow`

**前端请求体**:
```json
{
  "platform": "douyin",
  "sessionId": "uuid-v4-字符串",
  "params": {
    "主题/产品": "智能手表",
    "目标人群": "18-30岁科技爱好者",
    "视频时长": "60秒",
    "脚本风格": "专业讲解",
    "视频类型（口播/混剪/剧情）": "口播",
    "分镜数量": "4-6个",
    "核心卖点": "续航7天\n心率监测\n防水50米",
    "画面风格": "明亮清新",
    "BGM 风格": "轻快活泼",
    "CTA/行动引导": "点击购物车即可购买",
    "补充说明": ""
  }
}
```

**params 字段说明**:

| 字段名 | 必填 | 可选值 |
|--------|------|--------|
| 主题/产品 | 是 | 自由文本 |
| 目标人群 | 是 | 自由文本 |
| 视频时长 | 是 | 15秒/30秒/60秒/3分钟/5分钟 |
| 脚本风格 | 是 | 轻松搞笑/专业讲解/情感故事/快节奏种草/沉浸式体验/对比测评/街头采访 |
| 视频类型（口播/混剪/剧情）| 是 | 口播/混剪/剧情/实拍/动画 |
| 分镜数量 | 否 | 3-4个/4-6个/6-8个/8个以上 |
| 核心卖点 | 是 | 自由文本，多条换行分隔 |
| 画面风格 | 否 | 明亮清新/暗调质感/电影感/日系温暖/赛博朋克/极简白/复古滤镜 |
| BGM 风格 | 否 | 轻快活泼/热血激昂/治愈温馨/电子音乐/古风国潮/流行说唱/纯音乐 |
| CTA/行动引导 | 否 | 自由文本 |
| 补充说明 | 否 | 自由文本 |

**n8n 立即返回**:
```json
{
  "success": true,
  "taskId": "dy_1234567890_abc",
  "status": "processing",
  "message": "工作流已启动，正在生成分镜脚本..."
}
```

---

### 4.2 查询状态

**方法**: `GET`  
**默认路径**: `/webhook/douyin-query-status`  
**前端请求**: `GET /webhook/douyin-query-status?taskId=dy_1234567890_abc`

根据任务所处阶段，返回不同结构：

**阶段一：处理中**
```json
{
  "success": true,
  "taskId": "dy_1234567890_abc",
  "status": "processing",
  "stepName": "generating",
  "message": "正在生成分镜脚本...",
  "allowRevise": false,
  "allowConfirm": false
}
```

**阶段二：分镜稿件待确认**  
`stepName` 为 `"douyin_draft"` 时前端显示文案确认界面：
```json
{
  "success": true,
  "taskId": "dy_1234567890_abc",
  "status": "waiting_user_feedback",
  "stepName": "douyin_draft",
  "message": "分镜脚本已生成，请确认或提出修改意见",
  "preview": {
    "text": "【分镜脚本全文】\n分镜1：...\n分镜2：...",
    "images": [],
    "videos": []
  },
  "allowRevise": true,
  "allowConfirm": true
}
```

**阶段三：逐帧图片生成中**  
`stepName` 为 `"douyin_frame_generating"` 时前端显示逐帧进度：
```json
{
  "success": true,
  "taskId": "dy_1234567890_abc",
  "status": "processing",
  "stepName": "douyin_frame_generating",
  "message": "正在生成第 2/5 帧图片...",
  "frames": [
    {
      "index": 0,
      "imageUrl": "https://your-cdn.com/frame0.jpg",
      "storyboardText": "开场：产品特写，手表表盘旋转",
      "status": "pending"
    },
    {
      "index": 1,
      "imageUrl": null,
      "storyboardText": "功能演示：心率监测界面",
      "status": "pending"
    }
  ],
  "currentFrameIndex": 1
}
```

**阶段四：逐帧审核**  
`stepName` 为 `"douyin_frame_review"` 时前端显示当前帧供用户审核：
```json
{
  "success": true,
  "taskId": "dy_1234567890_abc",
  "status": "processing",
  "stepName": "douyin_frame_review",
  "message": "请审核第 1/5 帧图片",
  "frames": [
    {
      "index": 0,
      "imageUrl": "https://your-cdn.com/frame0.jpg",
      "storyboardText": "开场：产品特写，手表表盘旋转",
      "status": "pending"
    }
  ],
  "currentFrameIndex": 0
}
```

> `frames[].status` 取值：`"pending"`（待审核）、`"approved"`（已通过）、`"rejected"`（已拒绝重新生成）

**阶段五：视频生成中**  
`stepName` 为 `"douyin_video_generating"` 时前端显示视频生成进度：
```json
{
  "success": true,
  "taskId": "dy_1234567890_abc",
  "status": "processing",
  "stepName": "douyin_video_generating",
  "message": "所有帧已通过，正在合成视频..."
}
```

**阶段六：视频待审核**  
`stepName` 为 `"douyin_video_review"` 时前端显示视频播放器：
```json
{
  "success": true,
  "taskId": "dy_1234567890_abc",
  "status": "processing",
  "stepName": "douyin_video_review",
  "message": "视频已生成，请审核",
  "videoUrl": "https://your-cdn.com/output_video.mp4",
  "preview": {
    "text": "【分镜脚本全文】",
    "images": [],
    "videos": ["https://your-cdn.com/output_video.mp4"]
  }
}
```

**阶段七：任务完成**
```json
{
  "success": true,
  "taskId": "dy_1234567890_abc",
  "status": "completed",
  "stepName": "final",
  "message": "抖音视频制作完成！",
  "videoUrl": "https://your-cdn.com/output_video.mp4",
  "preview": {
    "text": "【分镜脚本全文】",
    "images": [],
    "videos": ["https://your-cdn.com/output_video.mp4"]
  }
}
```

---

### 4.3 用户操作（确认/修改分镜稿件）

**方法**: `POST`  
**默认路径**: `/webhook/douyin-user-action`

**提交修改意见**:
```json
{
  "taskId": "dy_1234567890_abc",
  "action": "revise",
  "feedback": "分镜3改为户外场景，增加运动感",
  "previousText": "（首次修改携带初稿脚本全文，之后为空字符串）"
}
```

**确认分镜稿件**（触发逐帧图片生成）:
```json
{
  "taskId": "dy_1234567890_abc",
  "action": "confirm",
  "feedback": "",
  "previousText": "已确认的分镜脚本全文"
}
```

**确认视频完成**:
```json
{
  "taskId": "dy_1234567890_abc",
  "action": "confirm_video",
  "feedback": "",
  "previousText": ""
}
```

**n8n 立即返回**:
```json
{
  "success": true,
  "status": "processing",
  "message": "已接收，正在处理..."
}
```

---

### 4.4 单帧审核

每帧图片生成后，前端显示该帧供用户通过或拒绝。

**方法**: `POST`  
**默认路径**: `/webhook/douyin-frame-action`

**通过当前帧**:
```json
{
  "taskId": "dy_1234567890_abc",
  "frameIndex": 0,
  "action": "approve",
  "feedback": ""
}
```

**拒绝并要求重新生成**:
```json
{
  "taskId": "dy_1234567890_abc",
  "frameIndex": 0,
  "action": "reject",
  "feedback": "画面太暗，改为明亮户外场景"
}
```

**n8n 立即返回**:
```json
{
  "success": true,
  "status": "processing",
  "message": "审核已提交，正在生成下一帧..."
}
```

> n8n 收到 `approve` 后继续生成下一帧；收到 `reject` 后根据 `feedback` 重新生成该帧，完成后将新图片 URL 更新到对应帧，`stepName` 改回 `"douyin_frame_review"`，`currentFrameIndex` 指向该帧。

**所有帧审核通过后的轮询响应**（前端此时会出现"开始生成视频"按钮）:
```json
{
  "success": true,
  "taskId": "dy_1234567890_abc",
  "status": "processing",
  "stepName": "douyin_frame_review",
  "message": "所有帧均已审核通过，可以开始生成视频",
  "frames": [
    { "index": 0, "imageUrl": "...", "storyboardText": "...", "status": "approved" },
    { "index": 1, "imageUrl": "...", "storyboardText": "...", "status": "approved" }
  ],
  "currentFrameIndex": 1
}
```

---

### 4.5 触发视频生成

所有帧审核通过后，用户点击"开始生成视频"按钮触发此接口。

**方法**: `POST`  
**默认路径**: `/webhook/douyin-generate-video`

**前端请求体**:
```json
{
  "taskId": "dy_1234567890_abc",
  "confirmedText": "已确认的分镜脚本全文",
  "frames": [
    { "index": 0, "imageUrl": "https://your-cdn.com/frame0.jpg", "storyboardText": "开场：产品特写" },
    { "index": 1, "imageUrl": "https://your-cdn.com/frame1.jpg", "storyboardText": "功能演示" }
  ]
}
```

**n8n 立即返回**:
```json
{
  "success": true,
  "status": "processing",
  "message": "视频生成已启动，请稍候..."
}
```

---

### 4.6 重新生成视频

视频审核不通过时，用户可点击"重新生成视频"（不重走图片生成流程）。

**方法**: `POST`  
**默认路径**: `/webhook/douyin-regenerate-video`

**前端请求体**:
```json
{
  "taskId": "dy_1234567890_abc"
}
```

**n8n 立即返回**:
```json
{
  "success": true,
  "status": "processing",
  "message": "正在重新生成视频..."
}
```

---

## 5. 通用字段参考

### 5.1 status 取值

| status | 含义 | 适用平台 |
|--------|------|----------|
| `processing` | 后台处理中 | 两者 |
| `waiting_user_feedback` | 等待用户确认/修改 | 两者 |
| `completed` | 任务完成 | 两者 |
| `failed` | 任务失败 | 两者 |

### 5.2 stepName 取值（影响前端界面渲染）

| stepName | 前端表现 | 说明 |
|----------|----------|------|
| `generating` / `draft` / `revising` / 其他 | 进度条 + 状态文字 | 通用处理中 |
| `douyin_draft` | 文案审核界面（确认/修改按钮） | 抖音分镜稿件待确认 |
| `douyin_frame_generating` | 逐帧进度 + 缩略图列表 | 抖音帧图片生成中 |
| `douyin_frame_review` | 大图预览 + 通过/拒绝按钮 | 抖音帧审核 |
| `douyin_video_generating` | 视频生成中旋转动画 | 抖音视频合成中 |
| `douyin_video_review` | 视频播放器 + 确认/重新生成按钮 | 抖音视频审核 |
| `final` | 完成展示（文案+图片 或 视频） | 任务完成 |

### 5.3 history 消息格式

```json
{
  "role": "system",
  "type": "status",
  "content": "✅ 工作流已启动",
  "timestamp": 1700000000000
}
```

| 字段 | 取值 |
|------|------|
| `role` | `"system"` / `"user"` / `"assistant"` |
| `type` | `"status"` / `"preview"` / `"error"` |
| `content` | 显示文本 |
| `timestamp` | Unix 毫秒时间戳 |

---

## 6. Docker 部署

### 6.1 环境变量完整列表

| 变量名 | 对应接口 | 说明 |
|--------|----------|------|
| `XHS_START_WORKFLOW_URL` | 小红书启动工作流 | 优先级高于旧版 `START_WORKFLOW_URL` |
| `XHS_STATUS_QUERY_URL` | 小红书查询状态 | 优先级高于旧版 `STATUS_QUERY_URL` |
| `XHS_USER_ACTION_URL` | 小红书用户操作 | 优先级高于旧版 `USER_ACTION_URL` |
| `XHS_REGENERATE_IMAGE_URL` | 小红书重新生成图片 | — |
| `DOUYIN_START_WORKFLOW_URL` | 抖音启动工作流 | — |
| `DOUYIN_STATUS_QUERY_URL` | 抖音查询状态 | — |
| `DOUYIN_USER_ACTION_URL` | 抖音用户操作（确认/修改稿件/确认视频） | — |
| `DOUYIN_FRAME_ACTION_URL` | 抖音单帧审核 | — |
| `DOUYIN_GENERATE_VIDEO_URL` | 抖音触发视频生成 | — |
| `DOUYIN_REGENERATE_VIDEO_URL` | 抖音重新生成视频 | — |
| `MOCK_ENABLED` | — | `false` 关闭 Mock，`true` 开启本地测试 |

> **向后兼容**：`START_WORKFLOW_URL`、`STATUS_QUERY_URL`、`USER_ACTION_URL`（不带前缀）仍可用，会被注入为小红书接口。`XHS_*` 变量优先级更高，可覆盖旧版变量。

---

### 6.2 只更新抖音部分（小红书保持不变）

停止旧容器，重新启动时**只传入抖音相关变量**，小红书 URL 保持容器内默认值（或原先已注入的值）不变：

```bash
# 停止并删除旧容器
docker stop workflow-studio
docker rm workflow-studio

# 重新启动，只注入抖音 6 个 URL
docker run -d \
  --name workflow-studio \
  --restart unless-stopped \
  -p 3000:80 \
  -e DOUYIN_START_WORKFLOW_URL="https://your-n8n.example.com/webhook/douyin-start-workflow" \
  -e DOUYIN_STATUS_QUERY_URL="https://your-n8n.example.com/webhook/douyin-query-status" \
  -e DOUYIN_USER_ACTION_URL="https://your-n8n.example.com/webhook/douyin-user-action" \
  -e DOUYIN_FRAME_ACTION_URL="https://your-n8n.example.com/webhook/douyin-frame-action" \
  -e DOUYIN_GENERATE_VIDEO_URL="https://your-n8n.example.com/webhook/douyin-generate-video" \
  -e DOUYIN_REGENERATE_VIDEO_URL="https://your-n8n.example.com/webhook/douyin-regenerate-video" \
  ghcr.io/YOUR_USERNAME/n8n-workflow-studio:latest
```

> 把 `https://your-n8n.example.com` 替换为你真实的 n8n 域名，路径部分保持不变（与你在 n8n 中创建的 Webhook 路径一致）。

---

### 6.3 同时注入小红书和抖音所有 URL

```bash
docker stop workflow-studio && docker rm workflow-studio

docker run -d \
  --name workflow-studio \
  --restart unless-stopped \
  -p 3000:80 \
  \
  -e XHS_START_WORKFLOW_URL="https://your-n8n.example.com/webhook/start-workflow" \
  -e XHS_STATUS_QUERY_URL="https://your-n8n.example.com/webhook/query-status" \
  -e XHS_USER_ACTION_URL="https://your-n8n.example.com/webhook/user-action" \
  -e XHS_REGENERATE_IMAGE_URL="https://your-n8n.example.com/webhook/xhs-regenerate-image" \
  \
  -e DOUYIN_START_WORKFLOW_URL="https://your-n8n.example.com/webhook/douyin-start-workflow" \
  -e DOUYIN_STATUS_QUERY_URL="https://your-n8n.example.com/webhook/douyin-query-status" \
  -e DOUYIN_USER_ACTION_URL="https://your-n8n.example.com/webhook/douyin-user-action" \
  -e DOUYIN_FRAME_ACTION_URL="https://your-n8n.example.com/webhook/douyin-frame-action" \
  -e DOUYIN_GENERATE_VIDEO_URL="https://your-n8n.example.com/webhook/douyin-generate-video" \
  -e DOUYIN_REGENERATE_VIDEO_URL="https://your-n8n.example.com/webhook/douyin-regenerate-video" \
  \
  ghcr.io/YOUR_USERNAME/n8n-workflow-studio:latest
```

---

### 6.4 本地开发（Mock 模式）

```bash
# Mock 模式（无需真实 n8n，用于前端调试）
docker run -d -p 3000:80 \
  -e MOCK_ENABLED=true \
  workflow-studio

# 关闭 Mock（生产模式）
docker run -d -p 3000:80 \
  -e MOCK_ENABLED=false \
  -e DOUYIN_START_WORKFLOW_URL="..." \
  workflow-studio
```

> **注意**：Mock 模式下数据存储在浏览器内存中，刷新页面后进行中的任务状态会丢失，这是 Mock 的已知限制。真实 n8n 后端没有此问题。

---

### 6.5 使用 docker-compose（推荐）

创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  workflow-studio:
    image: ghcr.io/YOUR_USERNAME/n8n-workflow-studio:latest
    container_name: workflow-studio
    ports:
      - "3000:80"
    environment:
      # 小红书接口
      - XHS_START_WORKFLOW_URL=https://your-n8n.example.com/webhook/start-workflow
      - XHS_STATUS_QUERY_URL=https://your-n8n.example.com/webhook/query-status
      - XHS_USER_ACTION_URL=https://your-n8n.example.com/webhook/user-action
      - XHS_REGENERATE_IMAGE_URL=https://your-n8n.example.com/webhook/xhs-regenerate-image
      # 抖音接口
      - DOUYIN_START_WORKFLOW_URL=https://your-n8n.example.com/webhook/douyin-start-workflow
      - DOUYIN_STATUS_QUERY_URL=https://your-n8n.example.com/webhook/douyin-query-status
      - DOUYIN_USER_ACTION_URL=https://your-n8n.example.com/webhook/douyin-user-action
      - DOUYIN_FRAME_ACTION_URL=https://your-n8n.example.com/webhook/douyin-frame-action
      - DOUYIN_GENERATE_VIDEO_URL=https://your-n8n.example.com/webhook/douyin-generate-video
      - DOUYIN_REGENERATE_VIDEO_URL=https://your-n8n.example.com/webhook/douyin-regenerate-video
    restart: unless-stopped
```

```bash
docker-compose up -d        # 启动
docker-compose down         # 停止
docker-compose pull && docker-compose up -d  # 更新到最新镜像
```

---

## 7. CORS 跨域配置

前端是静态 SPA，直接从浏览器发起请求到 n8n，需确保 n8n 允许跨域。

### 方式 A：n8n 环境变量（推荐）

```bash
N8N_EDITOR_BASE_URL=https://your-n8n.example.com
WEBHOOK_URL=https://your-n8n.example.com
N8N_CORS_ALLOW_ORIGIN=*
```

### 方式 B：Nginx 反向代理

在 n8n 前置的 Nginx 中添加：

```nginx
location /webhook/ {
    proxy_pass http://n8n:5678;
    add_header Access-Control-Allow-Origin *;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS";
    add_header Access-Control-Allow-Headers "Content-Type";
    if ($request_method = OPTIONS) {
        return 204;
    }
}
```

---

## 8. 常见问题

### Q1：轮询超时怎么办？

默认超时 5 分钟。AI 处理较慢时，修改 `src/config.js` 中的 `POLL_TIMEOUT`（单位毫秒），重新构建镜像。

### Q2：n8n 中如何存储任务状态？

推荐方案：
- **轻量**：n8n 内置的静态数据（Static Data）或 Redis Node
- **生产**：PostgreSQL / MySQL，每个任务一行，字段包括 `taskId`、`status`、`stepName`、`preview_json`、`frames_json`、`video_url`

### Q3：前端如何区分小红书和抖音的请求？

前端在 `startWorkflow` 请求体中携带 `"platform": "xiaohongshu"` 或 `"platform": "douyin"`，两个平台走完全不同的 n8n Workflow URL，n8n 内部无需再做判断。

### Q4：抖音逐帧审核时，拒绝后 n8n 如何处理？

n8n 收到 `reject` + `feedback` 后：
1. 根据 `frameIndex` 找到对应帧的 `storyboardText`
2. 结合 `feedback` 重新调用图片生成 API
3. 将新图片 URL 更新到该帧
4. 将该帧 `status` 改为 `"pending"`，`currentFrameIndex` 指回该帧
5. `stepName` 保持 `"douyin_frame_review"`

前端轮询到更新后会自动显示新图片供再次审核。

### Q5：图片/视频 URL 需要有效多久？

建议至少 **24 小时**可访问。前端会将 URL 存入 localStorage，用户后续查看历史任务时仍会尝试加载。URL 失效后图片会静默隐藏（前端已做 `onError` 处理）。

### Q6：Mock 模式下刷新页面任务消失？

Mock 模式的任务状态存在浏览器内存（`mockTasks` 对象）中，刷新后丢失。前端 localStorage 中仍有任务记录，但轮询时会收到"任务不存在"而标记为失败。这是 Mock 的设计限制，**真实 n8n 后端不受影响**。

### Q7：如何在服务器上更新镜像？

```bash
docker pull ghcr.io/YOUR_USERNAME/n8n-workflow-studio:latest
docker stop workflow-studio && docker rm workflow-studio
# 重新执行 6.2 或 6.3 中的 docker run 命令
```


## 9. 开发验证

使用 Node.js 24 运行测试（使用 Node 内置测试运行器，无需额外测试依赖）：

```bash
npm ci
npm test
npm run build
```

`npm test` 同时运行前端请求、轮询、缓存合并、任务存储以及后端工作流结果的回归测试；后端目录也可单独运行 `npm test`。GitHub Actions 的 `Validate` 工作流会在 PR 和 main 提交上执行测试及前端构建。

前端请求默认在 75 秒后超时。只有工作流 POST 操作允许空响应作为受理确认；登录和状态查询收到空响应、HTML 或无效 JSON 时显示错误，避免把代理错误页误判为成功。客户端不会自动重试 POST，防止重复触发生成任务。
