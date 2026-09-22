# 个人日程 PWA

移动优先、离线可用、支持邀请制多账号的个人日程与任务系统。前端为 React/Vite PWA，API 使用 Hono，后台提醒由独立 Worker 处理，数据保存在 PostgreSQL，附件经应用层加密后写入 S3 兼容存储。

## 已实现能力

- 日程与任务统一模型，支持标题、开始/结束时间、全天、截止时间、地点、备注、标签颜色、优先级、完成状态和两级子任务
- 日、周、月、议程视图；新建、编辑、删除、复制、拖拽和缩放
- 每天、每周、每月、每年及自定义间隔重复；编辑时可选择仅本次或全部
- 重叠冲突检测，冲突时阻止首次保存并由界面确认后强制保存
- IndexedDB 离线缓存与 outbox，恢复网络后自动增量同步
- JSON、CSV、ICS 导入导出，ICS 只读订阅与带令牌的只读订阅源
- AES-256-GCM 附件加密、图片/PDF/文本预览、25 MB 附件限制
- 站内提醒、重复提醒、贪睡、错过提醒、Web Push 与 SMTP 邮件
- Passkey 优先认证、邮箱一次性验证码、行程搜索、深色模式、键盘快捷键和 PWA 安装
- 每日加密 PostgreSQL 备份，保留 7 日、4 周和 12 月
- Docker Compose + Caddy 自动 HTTPS 部署

## 目录结构

- `apps/web`：React/Vite PWA
- `apps/api`：Hono REST/SSE API 与认证
- `apps/worker`：提醒调度、订阅刷新和加密备份
- `packages/domain`：Zod 模型、RRULE 展开、冲突判断、ICS/CSV
- `packages/db`：Drizzle Schema、数据库客户端与 SQL 迁移
- `deploy`：Caddy 配置

## 本地开发

要求 Node.js 22+、pnpm 11+；附件和完整数据库功能需要 Docker。

```bash
corepack enable
pnpm install
cp .env.example .env
docker compose up -d postgres minio minio-init migrate
pnpm dev
```

前端默认运行于 `http://localhost:5173`，API 运行于 `http://localhost:3000`。开发环境未配置 SMTP 时，邮箱验证码会输出到 API 日志：

```text
[auth] email OTP for you@example.com: 123456
```

生产环境必须在 `.env` 中设置 `OWNER_EMAIL`、`BETTER_AUTH_SECRET`、`BOOTSTRAP_TOKEN` 和有效的 `SMTP_URL`。

## 同一 Wi-Fi 访问

运行 `start-local.cmd` 后，脚本会同时显示本机地址和局域网地址。确保手机与电脑连接同一个 Wi-Fi，然后在手机浏览器打开脚本显示的局域网地址，例如 `http://192.168.1.7:5173/`。

如果手机无法连接，双击项目根目录的 `enable-lan-access.cmd`，在 Windows 管理员确认框中选择“是”。该脚本只为个人日程使用的 Node 程序添加入站防火墙规则。

普通 HTTP 局域网访问可以正常登录和编辑；PWA 安装、Web Push 和部分安全认证需要 HTTPS。手机端首次登录建议使用邮箱验证码。
## Vercel + Supabase 免费云端部署

仓库已包含单项目 Vercel 部署配置、多用户邀请码认证、Supabase Storage 附件直传、按账号隔离的 PWA 本地缓存和 Supabase Cron 定时任务。详细步骤见 `deploy/vercel-supabase.md`，环境变量模板见 `.env.vercel.example`。
## VPS 部署

1. 准备 Linux VPS、域名、Docker Engine 与 Compose，并将域名 A/AAAA 记录指向服务器。
2. 复制生产环境模板并生成强随机密钥：

```bash
cp .env.production.example .env
openssl rand -base64 48
openssl rand -base64 32
openssl rand -base64 32
```

3. 将三个随机值分别写入 `BETTER_AUTH_SECRET`、`BOOTSTRAP_TOKEN` 和 `ATTACHMENT_MASTER_KEY`，同时填写域名、数据库密码、MinIO 密码、`OWNER_EMAIL` 和 SMTP 配置。
4. 启动全部服务：

```bash
docker compose up -d --build
docker compose ps
```

5. Caddy 会自动申请 HTTPS 证书。首次打开站点，使用 `OWNER_EMAIL` 接收邮箱验证码；登录后立即在“设置”中添加 Passkey。
6. 在设置页启用浏览器通知。iOS 需要先将站点安装到主屏幕，并由用户手势触发通知权限。

## 免费临时公网体验站

如果不想购买 VPS 和域名，可以在这台电脑上运行临时公网体验站。体验者仍然只需要浏览器，但电脑必须保持开机、联网和不休眠。

1. 双击 `start-demo-tunnel.cmd`。
2. 脚本会优先使用已有的 `cloudflared.exe`；没有时自动改用系统自带 SSH 连接免费 `serveo.net`，无需额外下载。
3. 窗口会显示 `https://随机地址.trycloudflare.com` 和邀请密码，把两者发给体验者即可。
4. 停止体验站时双击 `stop-demo-tunnel.cmd`。

临时地址每次启动都会变化，停止脚本不会影响私人日历的 `3000/5173` 服务。

## 公网邀请制体验站

体验站与私人实例使用独立项目名、数据库和存储卷。访客需要邀请密码，进入后各自获得一个 24 小时临时工作区和示例数据。

1. 准备支持 Docker 的香港或新加坡 VPS，Ubuntu 24.04，建议至少 2 vCPU、2 GB 内存、40 GB SSD。
2. 将域名 A 记录指向服务器 IP。
3. 复制体验站环境模板并替换所有密码和邀请密码：

```bash
cp .env.demo.example .env.demo
openssl rand -base64 48
openssl rand -base64 32
openssl rand -base64 32
```

4. 将 `DOMAIN` 设置为域名，并将随机值写入 `BETTER_AUTH_SECRET`、`BOOTSTRAP_TOKEN`、`ATTACHMENT_MASTER_KEY`，同时设置强 `DEMO_ACCESS_PASSWORD`。
5. 启动独立体验站：

```bash
docker compose -p calendar-demo --env-file .env.demo up -d --build
docker compose -p calendar-demo --env-file .env.demo ps
```

6. Caddy 会自动申请 HTTPS。将 `https://你的域名` 和邀请密码发给体验者即可，无需对方下载 App。

体验模式不提供附件上传、邮件/PWA 推送、外部日历订阅和公开 ICS 订阅源；访客可以体验日历、任务、重复日程、拖拽、搜索、导入导出和主题切换。过期工作区由 Worker 每小时清理。

## 备份与恢复

Worker 每天 03:15 UTC 执行 `pg_dump`，并使用 `ATTACHMENT_MASTER_KEY` 派生的密钥加密输出到 `backup-data` 卷。查看与手动恢复：

```bash
docker compose exec worker sh -lc 'ls -lh /app/backups'
docker compose exec worker sh -lc 'pnpm --filter @calendar/worker restore -- /app/backups/daily-YYYY-MM-DD.pcal'
```

附件对象存储在 `minio-data` 卷中；VPS 级灾难恢复必须同时备份 `postgres-data`、`minio-data` 和 `backup-data` 卷，或将 MinIO 数据同步到独立的 S3 存储。

## 常用命令

```bash
pnpm typecheck
pnpm test
pnpm build
docker compose logs -f api worker caddy
docker compose pull && docker compose up -d --build
```