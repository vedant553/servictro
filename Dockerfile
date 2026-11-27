# Root-level Dockerfile for Railway deployment of the NestJS API.
# Multi-stage: install workspace deps with bun, compile TypeScript, run on node:22-slim.

FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/contracts/package.json packages/contracts/
COPY mini-services/serviceos-api/package.json mini-services/serviceos-api/
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS build
WORKDIR /app
ENV PRISMA_CLI_QUERY_ENGINE_TYPE=library
COPY --from=deps /app/node_modules ./node_modules
COPY packages/contracts ./packages/contracts
COPY mini-services/serviceos-api ./mini-services/serviceos-api
# Install api deps separately so prisma lands in the sub-workspace node_modules
WORKDIR /app/mini-services/serviceos-api
RUN bun install --frozen-lockfile
# Use the sub-workspace's installed prisma@6 binary (not bunx which fetches Prisma 8)
RUN ./node_modules/.bin/prisma generate && ./node_modules/.bin/tsc -p tsconfig.build.json

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
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
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/health/ready || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
