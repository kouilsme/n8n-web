# 生产安全复查（2026-10-30）

本次按 OWASP ASVS 5.0 的身份认证、访问控制、请求边界、文件处理、配置与依赖管理领域做源码复查、依赖审计和本地回归验证。这是有明确范围的工程检查，不是完整 ASVS 等级认证或公网渗透测试。

## 已确认并在本分支修复

| 问题 | 影响和条件 | 修复 |
| --- | --- | --- |
| 任务和表单缓存跨账号共用；退出后轮询仍可能继续 | 共用浏览器切换账号时，旧稿件可能出现在新账号列表；晚到回调可能写入错误账号 | 按用户 ID 隔离缓存，退出和跨标签切换时失效会话、取消请求、禁止旧回调写入 |
| 修改接口没有独立的请求来源/非简单请求校验 | CORS 不等于写操作防护；同站不同源的恶意表单可能携带 Cookie 发出 POST，空参数启动接口也可能触发工作流 | 写操作必须为 JSON，带 `X-Workflow-Client: WorkflowStudio`，存在 Origin 时必须精确匹配配置；压缩请求体拒绝解析 |
| 生产配置允许 HTTP、非 Secure Cookie、占位签名密钥 | 错误部署可泄露登录凭据或削弱会话签名；占位密钥不是可用生产凭据 | 生产启动校验 HTTPS Origin/Public URL、至少 32 字符且非占位密钥，默认 Secure Cookie，明确拒绝生产 `COOKIE_SECURE=false` |
| 相同任务 ID 可重复触发、重置任务；启动没有用户级限流 | 登录用户可重复消耗生成配额；并发检查和写入之间有竞争窗口 | 原子创建唯一任务，冲突只返回本人任务，不重发 n8n；每用户 15 分钟最多 20 次启动、120 次其他写操作 |
| 状态查询可覆盖取消和手动确认结果 | 晚到轮询可能把已停止任务重新写成运行中，或覆盖新稿件 | 基于 `updatedAt` 和非终态条件做乐观并发更新；返回已保存终态 |
| 图片仅信任 Data URL 中的 MIME | 可将非图片字节伪装为图片上传 | 校验 PNG/JPEG/WebP 文件签名；保留大小、数量、登录和随机文件名限制 |
| 原始错误对象可能进入日志 | JSON 解析错误可能附带原始请求体，包含登录字段 | 仅记录错误名称、状态和代码，不输出原始错误对象/请求体 |

同时修复历史任务缺少图片、分镜、当前帧、视频、审核权限等恢复字段；后台审核被宽泛 `processing` 防降级逻辑拦截；后台完成时遗漏下载产物；非抖音视频平台的分镜恢复；前台终态优先级。

## 依赖审计

- 原后端 `npm audit --omit=dev`：1 Critical、4 High、2 Moderate。更新后后端完整审计及生产审计均为 0。
- 原前端完整审计：5 High、3 Moderate、1 Low。更新后完整审计为 0。
- Critical 为 `proxy-addr` 的条件性可信代理网段/IP 伪造公告。现有代码使用数字跳数 `trust proxy: 1`，未确认满足该公告的特殊网段利用条件，不能把依赖评级直接当作应用已可远程接管。已更新锁定版本。
- 保留 Prisma 6 系列；对 `@prisma/config` 的 `deepmerge-ts` 和 `qs` 使用定向 override，Prisma schema validate 和客户端生成通过。UUID 升为兼容现有 v4 调用的 11.1.1。

依赖审计是当日数据库的已知公告检查，不代表无未知漏洞。

## 上线前仍需处理或验证

1. **高优先级：n8n Webhook 直接暴露风险。** 仓库中三个工作流 JSON 的真实 Webhook 触发节点均未声明鉴权。若直接监听公网端口，调用者可绕过网站登录/限流触发生成或操作任务。没有对真实生产端点发送生成请求，公网可达性未确认。应限制 n8n 仅后端/可信网络可达，或在每个 Webhook 上配置 Header/Basic/JWT 鉴权并同步后端请求凭据。不要只依赖路径保密。代码 PR 不会自动加固现有 n8n 实例。
2. **升级配置要求：HTTPS。** 当前生产示例改用 HTTPS 域名。升级前必须配置 TLS、真实随机 `SESSION_SECRET`、`COOKIE_SECURE=true`、精确的 `FRONTEND_ORIGIN` 和 `PUBLIC_BASE_URL`。原 HTTP 配置将拒绝启动，不应直接覆盖线上镜像后才处理证书。
3. **JWT 注销撤销：待完善。** 当前服务端 JWT 有效期 7 天，logout 清 Cookie，不维护服务端会话撤销记录。已泄露的 token 不会仅因退出自动失效；应后续引入可撤销会话或 token 版本。账号禁用仍会被数据库鉴权检查拦截。
4. **参考图的分享语义。** 上传文件通过不可预测 URL 给外部 AI 服务读取，并非私有下载接口；拿到 URL 的人可读取。不要上传不应分享给第三方的资料，后续可改为短期签名 URL、配额和清理机制。
5. **限流与运行环境。** 当前限流为进程内存，多副本需要共享存储。真实反代拓扑、防火墙、数据库备份/权限、镜像/OS/n8n 本体版本、Worker/服务器环境密钥未在此次确认。

旧共用缓存不自动归到某个账号，也没有删除；已落库历史由服务端重新加载，避免错误迁移导致跨用户展示。

## 验证范围

- 45 项单元/回归测试通过；前端生产构建通过。
- 本地 HTTP 检查通过：无自定义请求头的写请求 403、错误 Origin 403、合法空登录字段 400、未登录工作流 401、压缩请求体 415。
- Prisma schema 验证和生成通过；未对真实 PostgreSQL 做迁移/并发压测，未部署生产后端。
- 当前源码及三个工作流对常见私钥、厂商 API key、GitHub token、字面 Bearer token 的模式扫描无命中。不是全 Git 历史/所有格式密钥扫描。

## 参考

- https://asvs.owasp.org/
- https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- https://github.com/advisories/GHSA-jqcg-44mw-7w3h
- https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/
