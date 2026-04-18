# ── Stage 1: Install production deps ──────────────────────────────────────────
FROM node:20-slim AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: Build TypeScript ──────────────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 3: Minimal runtime image ────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
EXPOSE 3001
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
