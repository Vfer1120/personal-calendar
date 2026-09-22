FROM node:24-alpine
RUN npm install -g pnpm@11.7.0
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @calendar/api... --prod=false
COPY packages packages
COPY apps/api apps/api
CMD ["pnpm", "--filter", "@calendar/api", "start"]