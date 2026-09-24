import { useState } from "react";
import { CalendarDays, Fingerprint, LockKeyhole, UserRound } from "lucide-react";
import { authClient } from "../auth";
import { apiJson } from "../lib/api";

interface AuthScreenProps { ownerEmailConfigured: boolean; requiresSetup: boolean; registrationInviteRequired?: boolean; onSignedIn: () => void; }

export function AuthScreen({ registrationInviteRequired = false, onSignedIn }: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const normalized = username.trim().toLowerCase();
  const email = `${normalized}@calendar.local`;

  async function login() {
    setBusy(true); setError("");
    const result = await authClient.signIn.email({ email, password });
    if (result.error) setError(result.error.message ?? "用户名或密码错误"); else onSignedIn();
    setBusy(false);
  }

  async function register() {
    setBusy(true); setError("");
    try {
      await apiJson("/api/v1/account/register", "POST", { username: normalized, password, inviteCode });
      const result = await authClient.signIn.email({ email, password });
      if (result.error) throw new Error(result.error.message ?? "注册成功，但自动登录失败");
      onSignedIn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "注册失败");
    } finally {
      setBusy(false);
    }
  }

  async function signInPasskey() {
    setBusy(true); setError("");
    const result = await authClient.signIn.passkey();
    if (result.error) setError(result.error.message ?? "无法使用通行密钥"); else onSignedIn();
    setBusy(false);
  }

  return <main className="min-h-screen grid place-items-center p-5 bg-gradient-to-br from-orange-50 via-stone-50 to-amber-50 dark:from-stone-950 dark:via-stone-900 dark:to-orange-950">
    <section className="glass w-full max-w-md rounded-[2rem] border border-app p-7 shadow-2xl shadow-orange-950/10">
      <div className="mb-7 flex items-center gap-3"><div className="grid size-12 place-items-center rounded-2xl bg-orange-500 text-stone-950 shadow-lg shadow-orange-500/25"><CalendarDays /></div><div><h1 className="text-2xl font-black tracking-tight">个人日程</h1><p className="muted text-sm">用户名密码登录，无需邮箱验证码</p></div></div>
      <div className="mb-5 grid grid-cols-2 rounded-xl border border-app p-1">
        <button onClick={() => { setMode("login"); setError(""); }} className={`rounded-lg px-3 py-2 text-sm font-bold ${mode === "login" ? "bg-orange-500 text-stone-950" : "muted"}`}>登录</button>
        {registrationInviteRequired && <button onClick={() => { setMode("register"); setError(""); }} className={`rounded-lg px-3 py-2 text-sm font-bold ${mode === "register" ? "bg-orange-500 text-stone-950" : "muted"}`}>注册</button>}
      </div>
      <div className="space-y-4">
        <label className="block text-sm font-semibold">用户名<input className="mt-2 w-full rounded-xl border border-app bg-[var(--input-bg)] px-4 py-3" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))} placeholder="3-32 位字母、数字、_ 或 -" /></label>
        <label className="block text-sm font-semibold">密码<input className="mt-2 w-full rounded-xl border border-app bg-[var(--input-bg)] px-4 py-3" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位" /></label>
        {mode === "register" && <label className="block text-sm font-semibold">邀请码<input className="mt-2 w-full rounded-xl border border-app bg-[var(--input-bg)] px-4 py-3" type="password" value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="请输入管理员提供的邀请码" /></label>}
      </div>
      {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-200">{error}</p>}
      <button disabled={busy || normalized.length < 3 || password.length < 8 || (mode === "register" && !inviteCode)} onClick={() => void (mode === "login" ? login() : register())} className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 font-bold text-stone-950 disabled:opacity-50">{busy ? "请稍候..." : mode === "login" ? <><LockKeyhole size={18}/>登录</> : <><UserRound size={18}/>创建账号</>}</button>
      <button disabled={busy} onClick={() => void signInPasskey()} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-app bg-white/60 px-4 py-3 font-bold dark:bg-stone-900/60"><Fingerprint size={18}/>使用通行密钥</button>
      <p className="muted mt-5 text-center text-xs">每位用户的数据自动隔离，并同步保存到云端。</p>
    </section>
  </main>;
}