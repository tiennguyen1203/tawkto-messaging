# syntax=docker/dockerfile:1

# ============================================
# Base stage — shared configuration
# ============================================
FROM node:22-alpine AS base

RUN corepack enable pnpm

WORKDIR /app

# ============================================
# Dependencies stage — install all deps
# ============================================
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ============================================
# Builder stage — compile TypeScript
# ============================================
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig*.json nest-cli.json ./
COPY src ./src

RUN pnpm build

# ============================================
# Tools stage — the provisioning scripts, containerised
# ============================================
#
# So that running this project needs Docker and nothing else. The three
# provisioning tools are TypeScript run through ts-node, which is why they used to
# be run from the developer's machine; here they get the dev dependencies they need
# and `/app` is the repository root, so every path they resolve — the index
# template, the connector config — lands exactly where it does on a laptop.
#
# Built from `deps`, so it reuses the install layer the app build already paid for.
FROM deps AS tools

COPY tsconfig*.json ./
COPY src ./src
COPY scripts ./scripts
COPY infra ./infra
COPY migrations ./migrations
COPY migrate-mongo-config.js ./

# ============================================
# Production dependencies stage
# ============================================
FROM base AS prod-deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# ============================================
# Runtime — minimal image, one per entrypoint
# ============================================
FROM node:22-alpine AS production

RUN apk add --no-cache dumb-init

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs

WORKDIR /app

COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist

# Migrations stay as plain .js and are not compiled, so they are copied verbatim.
COPY --chown=nestjs:nodejs migrations ./migrations
COPY --chown=nestjs:nodejs migrate-mongo-config.js package.json ./

USER nestjs

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]

# No default service, on purpose.
#
# This image carries several processes — see ADR-001 — and defaulting to one of
# them means a container whose `command:` was forgotten starts as something else.
# A second API where the indexer should be does not crash; it just quietly never
# indexes, and the symptom is that search results stop appearing hours later.
# Failing here costs seconds. Every caller states which process it wants.
CMD ["sh", "-c", "\
echo 'This image runs one process per container. Pass the command you want:' >&2; \
echo '' >&2; \
echo '  node dist/messaging/main             the HTTP API' >&2; \
echo '  node dist/messaging/main.consumer    the Kafka to Elasticsearch indexer' >&2; \
echo '  node_modules/.bin/migrate-mongo up   the one-shot migration runner' >&2; \
exit 1"]
