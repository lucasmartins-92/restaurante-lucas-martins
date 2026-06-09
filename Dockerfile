# Stage 1: Build (install production dependencies)
FROM node:18-alpine AS builder
WORKDIR /app
RUN apk update && apk upgrade --no-cache && apk add --no-cache --virtual .build-deps python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund --ignore-scripts

COPY index.js ./
COPY public ./public
COPY views ./views

# Stage 2: Runtime (minimal image with non-root user)
FROM node:18-alpine AS runtime
WORKDIR /app
RUN apk update && apk upgrade --no-cache && addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY --from=builder /app /app

USER nodejs
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/', res => { if (![200,302].includes(res.statusCode)) process.exit(1) }, err => process.exit(1))" || exit 1
CMD ["node", "index.js"]
