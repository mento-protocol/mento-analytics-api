# Dockerfile
FROM node:22-alpine AS builder

# Set environment variables
ENV PORT=8080

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json pnpm-lock.yaml ./

# Install pnpm, nest CLI, and dependencies
RUN npm install -g pnpm@10.29.1 @nestjs/cli@10.4.8 && \
    pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN pnpm run build

# Production stage
FROM node:22-alpine AS production

# Default to production, but allow override via --build-arg or at runtime
ARG NODE_ENV=production
ARG RELEASE_VERSION=unknown
ENV NODE_ENV=${NODE_ENV}
ENV PORT=8080
ENV RELEASE_VERSION=${RELEASE_VERSION}

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs

# Copy package files first for better layer caching
COPY package*.json pnpm-lock.yaml ./

# Install pnpm, nest CLI, and production dependencies
RUN npm install -g pnpm@10.29.1 @nestjs/cli@10.4.8 && \
    pnpm install --prod --frozen-lockfile

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Switch to non-root user
USER nestjs

# Expose API port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/api/v1/health || exit 1

# Start the application
CMD ["pnpm", "start:prod"]
