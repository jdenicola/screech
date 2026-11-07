FROM livekit/livekit-server:v1.13.11 AS livekit
FROM node:22.22-alpine
COPY --from=livekit /livekit-server /usr/local/bin/livekit-server
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
CMD ["npm","run","server"]
