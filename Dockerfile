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

# Overridden per service in docker-compose: the API, the Kafka consumer, and the
# one-shot migration runner all share this image.
CMD ["node", "dist/main"]
