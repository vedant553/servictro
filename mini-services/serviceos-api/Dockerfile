# ServiceOS API + worker — production image (audit INFRA-02).
#
# Multi-stage build:
#  1. deps  — workspace install with dev dependencies (prisma CLI, typescript)
#  2. build — prisma generate + tsc compile of the NestJS monolith
#  3. runtime — node:22-slim, production node_modules only, non-root user,
#     HEALTHCHECK against /health/ready.
#
# The SAME image runs the API (node dist/main.js) and the worker
# (node dist/worker.js) — see docker-compose.prod.yml / ECS task definitions.

FROM oven/bun:1 AS deps
WORKDIR /app
# Workspace manifests first for layer caching.
COPY package.json bun.lock ./
COPY packages/contracts/package.json packages/contracts/
COPY mini-services/serviceos-api/package.json mini-services/serviceos-api/
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS build
WORKDIR /app
ENV PRISMA_CLI_QUERY_ENGINE_TYPE=library
COPY --from=deps /app/node_modules ./node_modules
# packages/contracts is pure TypeScript source with no node_modules of its own
COPY packages/contracts ./packages/contracts
COPY mini-services/serviceos-api ./mini-services/serviceos-api
WORKDIR /app/mini-services/serviceos-api
# Prisma client generation + type-safe compile.
RUN bunx prisma generate && bunx tsc -p tsconfig.build.json

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# tini: correct signal handling (SIGTERM → graceful shutdown).
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 1001 --create-home serviceos
COPY --from=build --chown=1001:1001 /app/node_modules ./node_modules
COPY --from=build --chown=1001:1001 /app/packages/contracts ./packages/contracts
COPY --from=build --chown=1001:1001 /app/mini-services/serviceos-api/dist ./mini-services/serviceos-api/dist
COPY --from=build --chown=1001:1001 /app/mini-services/serviceos-api/prisma ./mini-services/serviceos-api/prisma
COPY --from=build --chown=1001:1001 /app/mini-services/serviceos-api/package.json ./mini-services/serviceos-api/package.json
WORKDIR /app/mini-services/serviceos-api
USER 1001
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/health/ready || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
