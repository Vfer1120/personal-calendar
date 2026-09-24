const API_ORIGIN = "https://personal-calendar-rouge.vercel.app";

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (incoming.pathname.startsWith("/api/")) {
      const target = new URL(`${incoming.pathname}${incoming.search}`, API_ORIGIN);
      const headers = new Headers(request.headers);
      headers.delete("host");
      headers.set("x-forwarded-host", incoming.host);
      headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));
      const init = { method: request.method, headers, redirect: "manual" };
      if (request.method !== "GET" && request.method !== "HEAD") {
        const contentType = request.headers.get("content-type") ?? "";
        if (contentType.includes("application/json") || contentType.startsWith("text/")) {
          const body = await request.text();
          headers.set("content-length", String(new TextEncoder().encode(body).byteLength));
          init.body = body;
        } else {
          const body = await request.arrayBuffer();
          headers.set("content-length", String(body.byteLength));
          init.body = body;
        }
      }
      try {
        const upstream = await fetch(target.toString(), init);
        const body = await upstream.arrayBuffer();
        return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers: upstream.headers });
      } catch (error) {
        return new Response(`proxy-error: ${error instanceof Error ? error.message : String(error)}`, { status: 502 });
      }
    }
    return env.ASSETS.fetch(request);
  }
};