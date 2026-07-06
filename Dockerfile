# Use official Node.js 22 LTS image on Debian bookworm
FROM node:22-bookworm-slim

# Install Chromium and necessary system shared libraries / font dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libxss1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libgbm1 \
    libasound2 \
    fonts-liberation \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to skip downloading its own Chrome and use the system Chromium we just installed
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Set working directory
WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy the application source code
COPY . .

# Create directory for persistent WhatsApp session storage (to be mounted as Railway Volume)
RUN mkdir -p /app/.wwebjs_auth && chown -R node:node /app

# Run container as non-root node user for security
USER node

# Start the auto-saver service
CMD ["npm", "start"]
