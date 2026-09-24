import type { IncomingMessage, ServerResponse } from "node:http";
import { app } from "./app";

export default async function handler(incoming: IncomingMessage, outgoing: ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  const forwardedProtocol = String(incoming.headers["x-forwarded-proto"] ?? "https").split(",")[0]!.trim();
  const forwardedHost = String(incoming.headers["x-forwarded-host"] ?? incoming.headers.host ?? "localhost");
  const url = new URL(incoming.url ?? "/", `${forwardedProtocol}://${forwardedHost}`);
  const headers = new Headers();
  for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
    const key = incoming.rawHeaders[index];
    const value = incoming.rawHeaders[index + 1];
    if (key && value && !key.startsWith(":")) headers.append(key, value);
  }
  headers.delete("host");
  if (body) headers.set("content-length", String(body.byteLength));
  const request = new Request(url, { method: incoming.method, headers, body });
  const response = await app.fetch(request);
  outgoing.statusCode = response.status;
  outgoing.statusMessage = response.statusText;
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    outgoing.setHeader(key, value);
  });
  for (const cookie of cookies) outgoing.appendHeader("set-cookie", cookie);
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}