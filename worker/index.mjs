const API_ORIGIN = "https://personal-calendar-rouge.vercel.app";

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (incoming.pathname === "/__worker_test") return new Response("worker-ok", { status: 200 });
    if (incoming.pathname.startsWith("/api/")) {
      const target = new URL(`${incoming.pathname}${incoming.search}`, API_ORIGIN);
      const headers = new Headers(request.headers);
      headers.delete("host");
      headers.set("x-forwarded-host", incoming.host);
      headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));
      const init = { method: request.method, headers, redirect: "manual" };
      if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
      try {
        return await fetch(target.toString(), init);
      } catch (error) {
        return new Response(`proxy-error: ${error instanceof Error ? error.message : String(error)}`, { status: 502 });
      }
    }
    return env.ASSETS.fetch(request);
  }
};