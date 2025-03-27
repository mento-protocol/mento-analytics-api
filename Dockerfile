# Dockerfile
FROM node:18-alpine AS builder

# Set environment variables
ENV PORT=8080

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY pnpm-lock.yaml ./

# Install pnpm and nest CLI globally
RUN npm install -g pnpm @nestjs/cli

# Install dependencies
RUN pnpm install

# Copy source code
COPY . .

# Build the application
RUN pnpm run build

# Production stage
FROM node:18-alpine AS production

# Default to production, but allow override via --build-arg or at runtime
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV} PORT=8080

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY pnpm-lock.yaml ./

# Install pnpm and nest CLI globally
RUN npm install -g pnpm @nestjs/cli

# Install production dependencies only
RUN pnpm install --prod

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Expose API port
EXPOSE 8080

# Start the application
CMD ["pnpm", "start:prod"]