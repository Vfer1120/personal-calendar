FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.base.json ./
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @calendar/web build
ENV NODE_ENV=production
ENV SERVE_WEB=true
ENV WEB_DIST=/app/apps/web/dist
EXPOSE 3000
CMD ["pnpm", "--filter", "@calendar/api", "start"]