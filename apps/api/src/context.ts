import { createDatabase, type Database } from "@calendar/db";
import { eq, sql } from "drizzle-orm";
import { user, workspaces } from "@calendar/db/schema";
import { sendBrevoEmail, sendMailjetEmail, sendSmtp2goEmail } from "@calendar/domain";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { config, corsOrigins } from "./config";

const { db, pool } = createDatabase(config.DATABASE_URL, config.DB_POOL_MAX);
export { db, pool };

export const auth = betterAuth({
  appName: "个人日程",
  baseURL: config.BETTER_AUTH_URL,
  secret: config.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg" }),
  trustedOrigins: [...corsOrigins, config.APP_URL],
  emailAndPassword: { enabled: true, requireEmailVerification: false, minPasswordLength: 8 },
  plugins: [
    emailOTP({
      disableSignUp: false,
      sendVerificationOTP: async ({ email, otp }, ctx) => {
        const normalizedEmail = email.toLowerCase();
        const [existingUser] = await db.select({ id: user.id }).from(user).where(eq(user.email, normalizedEmail)).limit(1);
        const [userCountRow] = await db.select({ count: sql<number>`count(*)::int` }).from(user);
        const allowedEmail = config.OWNER_EMAIL?.toLowerCase();
        const isOwner = Boolean(allowedEmail && normalizedEmail === allowedEmail);
        const inviteCode = ctx?.request?.headers.get("x-registration-invite");
        if (config.ALLOW_MULTI_USER) {
          if (!existingUser && !isOwner && inviteCode !== config.REGISTRATION_INVITE_CODE) {
            throw new Error("邀请码不正确或已失效");
          }
        } else {
          if (allowedEmail && !isOwner) {
            throw new Error("该实例不接受新用户注册");
          }
          if (!allowedEmail && !existingUser && (userCountRow?.count ?? 0) > 0) {
            throw new Error("请先配置 OWNER_EMAIL");
          }
        }
        if (config.NODE_ENV !== "production") {
          console.info(`[auth] email OTP for ${email}: ${otp}`);
          return;
        }
        if (config.MAILJET_API_KEY && config.MAILJET_SECRET_KEY) {
          await sendMailjetEmail({ apiKey: config.MAILJET_API_KEY, secretKey: config.MAILJET_SECRET_KEY, sender: { name: "个人日程", email: config.OWNER_EMAIL ?? email }, to: email, subject: "个人日程登录验证码", text: `验证码：${otp}，5 分钟内有效。` });
          return;
        }
        if (config.SMTP2GO_API_KEY) {
          await sendSmtp2goEmail({ apiKey: config.SMTP2GO_API_KEY, sender: `个人日程 <${config.OWNER_EMAIL ?? email}>`, to: email, subject: "个人日程登录验证码", text: `验证码：${otp}，5 分钟内有效。` });
          return;
        }
        if (config.BREVO_API_KEY) {
          await sendBrevoEmail({ apiKey: config.BREVO_API_KEY, sender: { name: "个人日程", email: config.OWNER_EMAIL ?? email }, to: email, subject: "个人日程登录验证码", text: `验证码：${otp}，5 分钟内有效。` });
          return;
        }
        if (!config.SMTP_URL) {
          throw new Error("未配置邮件服务");
        }
        const nodemailer = await import("nodemailer");
        const transporter = nodemailer.createTransport(config.SMTP_URL);
        await transporter.sendMail({ from: config.SMTP_FROM, to: email, subject: "个人日程登录验证码", text: `验证码：${otp}，5 分钟内有效。` });
      }
    }),
    passkey({
      rpID: new URL(config.APP_URL).hostname,
      rpName: "个人日程",
      origin: config.APP_URL
    })
  ]
});

export interface AuthContextValue {
  userId: string;
  email: string;
  name: string;
  workspaceId: string;
}

export async function getAuthContext(dbInstance: Database, headers: Headers): Promise<AuthContextValue | null> {
  const session = await auth.api.getSession({ headers });
  if (!session?.user) return null;
  const [existing] = await dbInstance.select().from(workspaces).where(eq(workspaces.ownerId, session.user.id)).limit(1);
  let workspace = existing;
  if (!workspace) {
    const [created] = await dbInstance.insert(workspaces).values({ ownerId: session.user.id, name: "我的日程", timezone: config.DEFAULT_TIMEZONE }).returning();
    workspace = created;
  }
  if (!workspace) return null;
  return { userId: session.user.id, email: session.user.email, name: session.user.name, workspaceId: workspace.id };
}