# syntax=docker/dockerfile:1.7

FROM node:20-slim AS base
WORKDIR /app

FROM base AS deps
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder
ENV NODE_ENV=production
COPY . .
RUN npm run build

FROM deps AS production-deps
RUN npm prune --omit=dev

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# If you need to use proxies for outbound requests at runtime,
# provide them through environment variables (see README).

COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000
CMD ["npm", "run", "start"]
