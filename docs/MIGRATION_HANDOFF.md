# 个人日程项目迁移与交接说明

## 当前基线

- 代码仓库：`https://github.com/Vfer1120/personal-calendar`
- 分支：`master`
- 生成交接文档时的 Git 基线：`8c16f603855ee575b3d54aaa0b7afccae65e9b71`
- 正式前端：`https://personal-calendar-cz9.pages.dev`
- 正式 API 上游：Cloudflare Pages Worker 中的 Vercel API 地址
- 数据库与附件：现有 Supabase 生产项目
- 开发方式：新电脑使用新的空 Supabase 开发项目，不迁移生产数据

## 项目架构

- `apps/web`：React 19 + Vite PWA，负责日历、任务、课表、提醒中心、离线缓存和安装入口。
- `apps/api`：Hono API，负责认证、日程任务、同步、提醒、附件、AI 和其他业务接口。
- `apps/worker`：Node Worker，负责提醒投递、订阅刷新、清理和备份任务。
- `packages/domain`：Zod 类型、重复日程、冲突、ICS/CSV、单双周和课表领域逻辑。
- `packages/db`：Drizzle Schema、数据库客户端和 `0000` 至 `0007` SQL 迁移。
- `worker/index.mjs`：Cloudflare Pages Worker，`/api/*` 转发到 Vercel API，其余请求交给静态资源。
- 生产部署：GitHub `master` 推送后，Vercel 部署 API，Cloudflare Pages 构建前端并部署 Pages Worker。

## 已实现的主要功能

- 日程与任务：开始/结束/截止时间、全天、地点、备注、标签、优先级、子任务、部分完成、取消和删除。
- 重复日程：每天、每周、每月、每年、自定义间隔、单双周、仅本次覆盖和冲突提示。
- 课表：多课表页、可编辑节次、固定表头和节次列、课程时间段、颜色、日期范围、划选创建和移动端入口。
- AI 导入：长文本和多图提取；文本模型 `glm-4.5-flash`，图片模型 `glm-4.6v`；图片使用紧凑 JSON，草稿确认后才写入。
- 提醒与复盘：开始提醒、结束确认、贪睡、顺延建议、待复盘批量操作、站内弹窗、Web Push、系统通知音。
- 离线与同步：IndexedDB 按账号隔离、outbox、增量同步、断网新增和恢复联网合并。
- 附件：应用层 AES-256-GCM 加密、Supabase Storage 直传、图片/PDF/文本预览。
- PWA：桌面和移动端安装、独立窗口、图标、自动更新、持久存储、后台提醒。
- 认证与多用户：用户名密码、邮箱验证码、Passkey、邀请码注册、工作区隔离。

## 环境变量

新电脑开发环境至少需要：

- 基础：`NODE_ENV`、`APP_URL`、`API_URL`、`PORT`、`BETTER_AUTH_URL`、`CORS_ORIGIN`
- 数据库：`DATABASE_URL`、`SUPABASE_DIRECT_URL`、`DB_POOL_MAX`
- 认证：`BETTER_AUTH_SECRET`、`BOOTSTRAP_TOKEN`、`ALLOW_MULTI_USER`、`REGISTRATION_INVITE_CODE`、`OWNER_EMAIL`
- 附件：`ATTACHMENT_MASTER_KEY`、`MAX_ATTACHMENT_MB`、`S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`
- 提醒：`VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT`
- AI：`AI_ENABLED`、`AI_PROVIDER`、`AI_API_KEY`、`AI_BASE_URL`、`AI_TEXT_MODEL`、`AI_VISION_MODEL`、超时和图片限制
- 邮件：`SMTP_URL`、`SMTP_FROM`；开发环境可以留空，验证码会输出到本地日志

真实值只放在根目录 `.env` 和 `.local` 下，两个位置都已加入忽略规则，不能提交到仓库。

## 数据库迁移

新开发库必须按文件名顺序运行：

1. `0000_init.sql`
2. `0001_demo_sessions.sql`
3. `0002_student_core.sql`
4. `0003_ai_usage.sql`
5. `0004_course_timetable.sql`
6. `0005_course_slots.sql`
7. `0006_course_date_range.sql`
8. `0007_timetable_pages.sql`

本次不导入生产数据；如果需要以后执行完整数据迁移，记得额外包含 `timetables` 表并保留 `ATTACHMENT_MASTER_KEY` 不变。

## 新电脑安装与运行

```powershell
corepack enable
corepack prepare pnpm@9.15.5 --activate
git clone https://github.com/Vfer1120/personal-calendar.git
cd personal-calendar
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm dev
```

新电脑不需要复制旧电脑的 `node_modules`、`apps/web/dist`、便携 Node、便携 PostgreSQL、MinIO 数据、备份或 `supabase-data.sql`。

## 已知注意事项

- Cloudflare Pages Worker 当前把 API 地址写在 `worker/index.mjs`。本次沿用现有 Vercel 项目，因此不改；以后更换 Vercel 账号或项目名时，必须修改该地址并重新部署 Cloudflare Pages。
- 旧版迁移文档曾只写到 `0006`；当前必须使用 `0000` 至 `0007`。
- `scripts/migrate-supabase.ps1` 用于将来完整迁移数据时必须包含 `timetables` 表。
- 生产数据库和开发数据库必须分开。开发环境不要复制生产 `DATABASE_URL` 或生产 `S3_*`。
- 新电脑完成首次环境验证前，不要删除旧电脑上的仓库、配置或浏览器会话。

## 回退

如果新电脑验证失败，继续使用旧电脑开发即可。正式网站不会因为本次开发环境迁移而停止。生产数据没有迁移，因此不需要回滚数据库；只需停止使用新电脑配置并恢复旧电脑工作。
