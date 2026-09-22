FROM node:24-alpine
RUN apk add --no-cache postgresql16-client && npm install -g pnpm@11.7.0
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --frozen-lockfile --filter @calendar/worker... --prod=false
COPY packages packages
COPY apps/worker apps/worker
CMD ["pnpm", "--filter", "@calendar/worker", "start"]