# =============================================================================
# Trading Bot Pro - Dockerfile
# Multi-stage build for optimal image size
# =============================================================================

# ─── Build Stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev for build)
RUN npm ci

# Copy source code
COPY . .

# ─── Production Stage ────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache sqlite

# Create non-root user for security
RUN addgroup -g 1001 -S tradingbot && \
    adduser -S -u 1001 -G tradingbot tradingbot

# Copy built node_modules and source
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .

# Create data directory with correct permissions
RUN mkdir -p /app/data /app/trading-logs && \
    chown -R tradingbot:tradingbot /app

# Switch to non-root user
USER tradingbot

# Expose ports
EXPOSE 3000 3001 3002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3002/api/health || exit 1

# Default: start chatbot server
CMD ["node", "chatbot/chatbot-server.js"]
