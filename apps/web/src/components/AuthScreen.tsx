import { useState } from "react";
import { CalendarDays, Fingerprint, Mail, ShieldCheck } from "lucide-react";
import { authClient } from "../auth";

interface AuthScreenProps { ownerEmailConfigured: boolean; requiresSetup: boolean; registrationInviteRequired?: boolean; onSignedIn: () => void; }

export function AuthScreen({ ownerEmailConfigured, requiresSetup, registrationInviteRequired = false, onSignedIn }: AuthScreenProps) {
  const [email, setEmail] = useState(""); const [otp, setOtp] = useState(""); const [inviteCode, setInviteCode] = useState(""); const [bootstrapToken, setBootstrapToken] = useState(""); const [step, setStep] = useState<"email" | "otp">("email");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function requestOtp() {
    setBusy(true); setError("");
    const headers = { ...(requiresSetup ? { "x-bootstrap-token": bootstrapToken } : {}), ...(registrationInviteRequired ? { "x-registration-invite": inviteCode } : {}) }; const result = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" }, Object.keys(headers).length > 0 ? { headers } : undefined);
    if (result.error) setError(result.error.message ?? "验证码发送失败"); else setStep("otp");
    setBusy(false);
  }
  async function verifyOtp() {
    setBusy(true); setError("");
    const result = await authClient.signIn.emailOtp({ email, otp });
    if (result.error) setError(result.error.message ?? "验证码不正确"); else onSignedIn();
    setBusy(false);
  }
  async function signInPasskey() {
    setBusy(true); setError("");
    const result = await authClient.signIn.passkey();
    if (result.error) setError(result.error.message ?? "无法使用通行密钥"); else onSignedIn();
    setBusy(false);
  }
  return <main className="min-h-screen grid place-items-center p-5 bg-gradient-to-br from-orange-50 via-stone-50 to-amber-50 dark:from-stone-950 dark:via-stone-900 dark:to-orange-950">
    <section className="glass w-full max-w-md rounded-[2rem] border border-app p-7 shadow-2xl shadow-orange-950/10">
      <div className="mb-8 flex items-center gap-3"><div className="grid size-12 place-items-center rounded-2xl bg-orange-500 text-stone-950 shadow-lg shadow-orange-500/25"><CalendarDays /></div><div><h1 className="text-2xl font-black tracking-tight">个人日程</h1><p className="muted text-sm">把重要的事放在清楚的位置</p></div></div>
      {requiresSetup && <div className="mb-5 rounded-2xl bg-orange-100 p-4 text-sm text-orange-900 dark:bg-orange-950 dark:text-orange-100"><ShieldCheck className="mb-2" size={20}/><strong>首次初始化</strong><p className="mt-1 opacity-80">{ownerEmailConfigured ? "使用所有者邮箱接收一次性验证码，登录后立即添加通行密钥。" : "当前未配置 OWNER_EMAIL；首个成功登录的邮箱将成为实例所有者。"}</p></div>}
      {step === "email" ? <div className="space-y-4">{requiresSetup && <label className="block text-sm font-semibold">初始化令牌<input className="mt-2 w-full rounded-xl border border-app bg-[var(--input-bg)] px-4 py-3" type="password" value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} /></label>}{registrationInviteRequired && <label className="block text-sm font-semibold">邀请码<input className="mt-2 w-full rounded-xl border border-app bg-[var(--input-bg)] px-4 py-3" type="password" value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="新用户邀请码；已有账号可留空" /></label>}<label className="block text-sm font-semibold">邮箱<input className="mt-2 w-full rounded-xl border border-app bg-[var(--input-bg)] px-4 py-3" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label><button disabled={busy || !email || (requiresSetup && !bootstrapToken)} onClick={requestOtp} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 font-bold text-stone-950 disabled:opacity-50"><Mail size={18}/>{busy ? "正在发送..." : "发送登录验证码"}</button>{requiresSetup && <button disabled={busy || !email} onClick={() => setStep("otp")} className="min-h-11 w-full rounded-xl border border-app px-4 py-2 text-sm font-bold">已有验证码，直接登录</button>}{!requiresSetup && <button disabled={busy} onClick={signInPasskey} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-app bg-white/60 px-4 py-3 font-bold dark:bg-stone-900/60"><Fingerprint size={18}/>使用通行密钥</button>}</div>
      : <div className="space-y-4"><button className="text-sm text-orange-600 dark:text-orange-400" onClick={() => setStep("email")}>← 修改邮箱</button><label className="block text-sm font-semibold">验证码<input className="mt-2 w-full rounded-xl border border-app bg-[var(--input-bg)] px-4 py-3 text-center text-2xl tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))} /></label><button disabled={busy || otp.length !== 6} onClick={verifyOtp} className="min-h-12 w-full rounded-xl bg-orange-500 px-4 py-3 font-bold text-stone-950 disabled:opacity-50">{busy ? "正在验证..." : "登录"}</button></div>}
      {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-200">{error}</p>}
      <p className="muted mt-6 text-center text-xs">数据只保存在你的实例中。生产环境请使用 HTTPS 和强密码环境变量。</p>
    </section>
  </main>;
}