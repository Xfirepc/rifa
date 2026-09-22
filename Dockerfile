FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/.next /app/.next
COPY --from=builder /app/next.config.ts /app/next.config.ts
COPY --from=builder /app/drizzle /app/drizzle
COPY --from=builder /app/scripts /app/scripts
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.mjs && npm run start"]
