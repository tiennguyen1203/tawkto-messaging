# The demo client's own image. Separate from the server's Dockerfile on purpose:
# they share no stage, no base image and no dependency tree, and interleaving them
# means every failure has to be traced through stages that belong to the other
# project. The build context is this directory alone.
#
# Two stages: Node to build, nginx to serve. No Node reaches the runtime image.

# ============================================
# Build — Vite bundles the client
# ============================================
FROM node:22-alpine AS builder

RUN corepack enable pnpm

WORKDIR /app

# Manifest first, so a source-only edit does not re-run the install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ============================================
# Runtime — static files and two proxy prefixes
# ============================================
FROM nginx:1.27-alpine AS runtime

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
