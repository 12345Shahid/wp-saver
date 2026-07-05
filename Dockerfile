# Use official Node.js LTS image on Debian/Ubuntu
FROM node:20-slim

# Install Chromium and necessary system font dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    ca-certificates \
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
