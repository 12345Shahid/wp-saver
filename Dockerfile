# Baileys doesn't need a browser — simple Node.js image is all we need
FROM node:22-slim

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Create directory for persistent WhatsApp session storage
RUN mkdir -p /app/auth_info_baileys

# Start the auto-saver service
CMD ["npm", "start"]
