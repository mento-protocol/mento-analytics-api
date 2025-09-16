# Dockerfile
FROM node:22-alpine AS builder

# Set environment variables
ENV PORT=8080

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json pnpm-lock.yaml ./

# Install pnpm and nest CLI globally
RUN npm install -g pnpm@latest @nestjs/cli

# Install dependencies with frozen lockfile for reproducible builds
RUN pnpm install --frozen-lockfile

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

# Copy package files first for better layer caching
COPY package*.json pnpm-lock.yaml ./

# Install pnpm and nest CLI globally
RUN npm install -g pnpm@latest @nestjs/cli

# Install production dependencies only with frozen lockfile
RUN pnpm install --prod --frozen-lockfile

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Expose API port
EXPOSE 8080

# Start the application
CMD ["pnpm", "start:prod"]