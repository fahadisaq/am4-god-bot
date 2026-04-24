FROM ghcr.io/puppeteer/puppeteer:23.6.0

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy source code
COPY . .

# Expose dashboard port
EXPOSE 3000

# Set environment
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Start the bot
CMD ["node", "src/index.js"]
