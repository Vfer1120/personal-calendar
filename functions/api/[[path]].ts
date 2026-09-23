interface Env {
  API_ORIGIN?: string;
}

export const onRequest = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  if (!env.API_ORIGIN) return new Response("API_ORIGIN is not configured", { status: 500 });
  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, env.API_ORIGIN);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));
  const init: RequestInit = { method: request.method, headers, redirect: "manual" };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
  return fetch(target.toString(), init);
};