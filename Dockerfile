# Single-stage Dockerfile for the keepertoll gateway.
# Used by fly.io / render.com / railway / any container host.

FROM node:20-alpine

WORKDIR /app
RUN corepack enable

# Copy workspace metadata + the gateway source. Other packages are not needed
# at runtime — gateway has no workspace dependencies.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/gateway packages/gateway

# Install only what the gateway needs, then build.
RUN pnpm install --frozen-lockfile --filter @keepertoll/gateway... \
 && pnpm --filter @keepertoll/gateway build

WORKDIR /app/packages/gateway

# Persistent state lives at /data — mount this as a volume on your host.
ENV GATEWAY_PORT=3030 \
    GATEWAY_REGISTRY_PATH=/data/registry.json \
    GATEWAY_AUDIT_LOG_PATH=/data/audit.log

EXPOSE 3030

CMD ["node", "dist/server.js"]
