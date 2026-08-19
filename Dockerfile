FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
# Railway injects service variables into the build only for stages that declare
# them, and only from this point down. Declared here, after the dependency
# layers, so a new commit doesn't invalidate the pnpm install cache. The image
# has no .git and no git binary, so this is the only way the build can learn
# which commit it is. pnpm railway:deploy sets it; see scripts/app-version.js.
ARG APP_COMMIT_SHA
RUN pnpm build

FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
COPY --from=builder /app/build ./build
COPY scripts/migrate.ts ./scripts/migrate.ts
COPY migrations ./migrations
ENV NODE_ENV=production
CMD ["node", "build/index.js"]
