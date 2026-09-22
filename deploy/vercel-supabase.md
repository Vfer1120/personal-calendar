# Vercel + Supabase 免费云端部署

## 1. Supabase
1. 创建 Supabase Free 项目，区域优先选择 Singapore。
2. 在 SQL Editor 中按顺序运行 `packages/db/migrations/0000_init.sql` 至 `0006_course_date_range.sql`。
3. 创建私有 Storage bucket `calendar-attachments`。
4. 给该 bucket 配置允许生产 Vercel 域名执行 `PUT` 和 `GET` 的 CORS。
5. 在 Project Settings 中复制 Session Pooler 连接串，作为 Vercel 的 `DATABASE_URL`。
6. 复制 Direct connection 连接串，仅用于迁移旧数据库。
7. 在 Storage S3 设置中创建访问密钥，并填写 `S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`。

## 2. Vercel
1. 导入仓库，Root Directory 保持仓库根目录。
2. 使用仓库中的 `vercel.json`，无需修改 Build Command。
3. 配置环境变量：
   - `APP_URL`、`BETTER_AUTH_URL`、`CORS_ORIGIN`：`https://<项目名>.vercel.app`
   - `DATABASE_URL`：Supabase Session Pooler
   - `DB_POOL_MAX=2`
   - `ALLOW_MULTI_USER=true`
   - `REGISTRATION_INVITE_CODE`：给朋友的统一邀请码
   - `CRON_SECRET`：至少 32 位随机字符串
   - `SMTP_URL`、`SMTP_FROM`：QQ 邮箱或 Gmail 的免费 SMTP 授权码配置
   - `ATTACHMENT_MASTER_KEY`：迁移时沿用原值
   - `S3_*`：Supabase Storage S3 配置
   - `AI_ENABLED`、`AI_API_KEY`、`AI_REQUEST_TIMEOUT_MS=50000` 等现有 AI 配置
   - `VAPID_*`：Web Push 配置
4. 首次部署后记录生产域名，并在 Supabase SQL Editor 将 `deploy/supabase-cron.sql` 中的 `<VERCEL_URL>` 和 `<CRON_SECRET>` 替换后执行。

## 3. 数据与附件迁移
1. 暂停本机写入，备份 `postgres-data` 和 MinIO 数据卷。
2. 使用 `pg_dump` 迁移业务表、用户和工作区；不要迁移 `session`、`verification`、`passkey`。
3. 使用带 `--endpoint-url` 的 AWS CLI 或 rclone，将对象从 MinIO 复制到 Supabase Storage 的同名对象键。
4. 保持原 `ATTACHMENT_MASTER_KEY` 不变，逐条验证附件可访问。
5. 用原所有者邮箱请求验证码，登录新 Vercel 地址后重新添加 Passkey。

## 4. 一键迁移脚本

安装 PostgreSQL client 和 AWS CLI 后，可从本机执行：

```powershell
pwsh ./scripts/migrate-supabase.ps1 `
  -SupabaseDirectUrl "postgresql://..." `
  -MinioEndpoint "http://127.0.0.1:9000" `
  -MinioAccessKey "..." -MinioSecretKey "..." `
  -SupabaseEndpoint "https://<project>.storage.supabase.co/storage/v1/s3" `
  -SupabaseAccessKey "..." -SupabaseSecretKey "..." `
  -Bucket "calendar-attachments" `
  -LocalDatabaseUrl "postgresql://calendar:..."
```

脚本会导出业务数据、导入 Supabase，并将 MinIO 附件复制到 Supabase Storage。执行前仍应停止写入并备份两个数据源。
## 4. 数据与附件迁移命令示例
```bash
pg_dump "$LOCAL_DATABASE_URL" --no-owner --no-acl --data-only \
  --table=user --table=account --table=workspaces --table=calendars \
  --table=items --table=item_tags --table=tags --table=reminder_rules \
  --table=recurrence_exceptions --table=attachments --table=deliveries \
  --table=app_settings --table=schedule_periods --table=ai_usage \
  > calendar-data.sql
psql "$SUPABASE_DIRECT_URL" -v ON_ERROR_STOP=1 -f calendar-data.sql
```
`change_log` 和 `sync_mutations` 可以按需迁移，若从当前状态继续同步，建议保留 `change_log` 并从其最大 cursor 开始。

附件复制时建议使用 `rclone copy` 或 AWS CLI；完成后抽样打开图片和 PDF，确认应用层解密正常。