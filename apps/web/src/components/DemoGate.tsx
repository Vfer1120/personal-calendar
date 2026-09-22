import { useState } from "react";
import { CalendarDays, KeyRound, ShieldCheck } from "lucide-react";
import { ApiError, apiJson } from "../lib/api";
import { clearOfflineData } from "../lib/offline";

interface DemoGateProps { onEnter: () => void; }

export function DemoGate({ onEnter }: DemoGateProps) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function enter() {
    setBusy(true);
    setError("");
    try {
      await apiJson("/api/v1/demo/enter", "POST", { password });
      await clearOfflineData();
      onEnter();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "无法进入体验站，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return <main className="grid min-h-screen place-items-center bg-gradient-to-br from-orange-50 via-stone-50 to-amber-50 p-5 dark:from-stone-950 dark:via-stone-900 dark:to-orange-950">
    <section className="glass w-full max-w-md rounded-[2rem] border border-app p-7 shadow-2xl shadow-orange-950/10">
      <div className="mb-8 flex items-center gap-3"><div className="grid size-12 place-items-center rounded-2xl bg-orange-500 text-stone-950 shadow-lg shadow-orange-500/25"><CalendarDays /></div><div><h1 className="text-2xl font-black tracking-tight">个人日程 · 体验站</h1><p className="muted text-sm">无需下载，直接体验核心功能</p></div></div>
      <div className="mb-5 rounded-2xl bg-orange-100 p-4 text-sm text-orange-900 dark:bg-orange-950 dark:text-orange-100"><ShieldCheck className="mb-2" size={20}/><strong>独立体验空间</strong><p className="mt-1 opacity-80">你的示例数据与其他访客隔离，24 小时后自动清理。</p></div>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void enter(); }}>
        <label className="block text-sm font-semibold">邀请密码<input autoFocus className="mt-2 w-full rounded-xl border border-app bg-[var(--input-bg)] px-4 py-3" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入邀请密码" /></label>
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-200">{error}</p>}
        <button disabled={busy || !password} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 font-bold text-stone-950 disabled:opacity-50"><KeyRound size={18}/>{busy ? "正在进入..." : "进入体验站"}</button>
      </form>
      <p className="muted mt-6 text-center text-xs">体验站不会访问你的私人日历，也不支持附件上传和邮件提醒。</p>
    </section>
  </main>;
}
