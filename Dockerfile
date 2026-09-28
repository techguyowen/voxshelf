# VocalFlow — multi-stage production image (Next.js standalone + native sqlite)
FROM node:24-slim AS base

# ---- dependencies (may compile better-sqlite3 from source) ----
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ---- build ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- production runner ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  DATA_DIR=/app/data \
  PORT=38492 \
  HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
USER nextjs

EXPOSE 38492
VOLUME /app/data
CMD ["node", "server.js"]
