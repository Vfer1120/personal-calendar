interface Env {
  API_ORIGIN?: string;
}

export const onRequest = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  const apiOrigin = env.API_ORIGIN ?? "https://personal-calendar-rouge.vercel.app";
  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, apiOrigin);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));
  const init: RequestInit = { method: request.method, headers, redirect: "manual" };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
  return fetch(target.toString(), init);
};