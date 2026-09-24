interface Env {
  ASSETS: Fetcher;
}

export const onRequest = async (context: { request: Request; env: Env }) => {
  const response = await context.env.ASSETS.fetch(context.request);
  if (response.status !== 404) return response;
  const url = new URL(context.request.url);
  if (url.pathname.includes(".")) return response;
  const indexUrl = new URL("/index.html", url);
  return context.env.ASSETS.fetch(new Request(indexUrl.toString(), context.request));
};