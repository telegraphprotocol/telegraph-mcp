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
COPY guides/ ./guides/
USER node
ENV NODE_ENV=production PORT=8787

# Hosted connector server: docker run -p 8787:8787 -e TELEGRAPH_MCP_PUBLIC_URL=... -e TELEGRAPH_BACKEND_URL=... <image>
# Local stdio server instead: docker run -i <image> --stdio
EXPOSE 8787
ENTRYPOINT ["node", "dist/index.js"]
CMD ["serve", "--http"]
