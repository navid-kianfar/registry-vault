# ---- Base ----
FROM --platform=$BUILDPLATFORM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

# ---- Install dependencies ----
FROM --platform=$BUILDPLATFORM node:20-alpine AS deps
RUN npm install -g pnpm@9
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# ---- Build ----
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder
RUN npm install -g pnpm@9
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
RUN pnpm build

# ---- Production ----
FROM --platform=$TARGETPLATFORM node:20-alpine AS production

WORKDIR /app

# Native modules (bcrypt, better-sqlite3) need build tools at install time
RUN apk add --no-cache python3 make g++
RUN npm install -g pnpm@9

# Copy manifests for production-only install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/

# Install only the API's production dependencies
RUN pnpm install --filter @registry-vault/api --prod --frozen-lockfile

# Copy built API
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Copy built web — NestJS ServeStaticModule expects it at ../../web/dist
# relative to apps/api/dist, which resolves to apps/web/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist

# SQLite data directory (mount a volume here in production)
RUN mkdir -p ./data

EXPOSE 80

ENV PORT=80
ENV NODE_ENV=production

CMD ["node", "apps/api/dist/main.js"]
