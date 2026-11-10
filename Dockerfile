FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
USER node
EXPOSE 3000

ENV TELEGRAPH_MCP_TRANSPORT=stdio
ENV NODE_ENV=production

ENTRYPOINT ["node", "dist/index.js"]