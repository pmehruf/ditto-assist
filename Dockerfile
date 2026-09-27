# syntax=docker/dockerfile:1

# ---- Build stage: installs devDependencies, runs the exact same build the
# user already validated locally (vite build + esbuild server bundle) ----
FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Cache-bust: forces every layer from here on to rebuild from the current
# source, bypassing Cloud Build/Kaniko's layer cache. Needed because a
# recent deploy (revision ditto-assist-00090-hs7, built 2026-09-23) served
# code that didn't reflect the latest playbookIngest.ts changes even though
# the uploaded source and Dockerfile were both correct — the layer cache was
# the only remaining explanation. Bump this value whenever a deploy needs to
# guarantee a clean rebuild instead of relying on cache invalidation.
ARG CACHE_BUST=2026-09-24-01
COPY . .
RUN npm run build

# Drop devDependencies now that the build artifacts exist — the runtime
# image only needs what dist/server.cjs actually requires at runtime
# (esbuild was run with --packages=external, so those requires are NOT
# bundled into server.cjs and must be present in node_modules).
RUN npm prune --omit=dev

# ---- Runtime stage: slim image, only the built output + prod deps ----
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/assets ./assets

# Cloud Run injects PORT (defaults to 8080) and expects the container to
# bind 0.0.0.0 — server.ts already does both (`process.env.PORT`, "0.0.0.0").
EXPOSE 8080

CMD ["node", "dist/server.cjs"]
