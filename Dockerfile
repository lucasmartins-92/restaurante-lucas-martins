# Stage 1: Build (install production dependencies)
FROM node:18-alpine AS builder
WORKDIR /app
COPY --chown=node:node package*.json ./
RUN npm config set registry https://registry.yarnpkg.com/ \
  && npm ci --only=production --no-audit --no-fund --ignore-scripts

# Copy sources and remove any local artifacts that should not go into the final image
COPY --chown=node:node index.js ./
COPY --chown=node:node public ./public
COPY --chown=node:node views ./views

# Stage 2: Runtime (minimal image with non-root user)
FROM node:18-alpine AS runtime
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy only the assembled app from builder and set ownership
COPY --from=builder --chown=nodejs:nodejs /app /app

USER nodejs
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/dashboard', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})" || exit 1
CMD ["npm", "start"]
