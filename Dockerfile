# Lightweight production image
FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies separately for better caching
COPY package.json package-lock.json* ./
RUN npm install --omit=dev || npm install --omit=dev

# Copy application source
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -q -O - http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server.js"]

