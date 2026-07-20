# Use official Google Puppeteer Docker image (includes Node.js, Chrome for Testing, and all Linux DBus/audio/font dependencies)
FROM ghcr.io/puppeteer/puppeteer:latest

# Switch to root to install dependencies and configure permissions
USER root

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source code (includes scripts/ directory)
COPY . .

# [FIX] Apply WhatsApp Web July 2026 compatibility patch (id._serialized → id.$1)
RUN node scripts/patch-serialized.js

# Create directory for persistent WhatsApp session storage and grant ownership to pptruser
RUN mkdir -p /app/.wwebjs_auth && chown -R pptruser:pptruser /app

# Switch back to non-root pptruser for security
USER pptruser

# Tell Puppeteer where Google Chrome is located inside the official image
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Start the auto-saver service
CMD ["npm", "start"]
