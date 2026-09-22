import { app } from "../apps/api/src/app";

export const config = { maxDuration: 60 };

export default async function handler(request: Request) {
  return app.fetch(request);
}