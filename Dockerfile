# ---------- 构建阶段：类型检查并打包 ----------
FROM oven/bun:1.4-slim AS build

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json tsconfig.test.json ./
COPY src ./src
COPY test ./test
RUN bun run typecheck && bun run build

# ---------- 运行阶段：只保留构建产物与运行所需文件 ----------
FROM oven/bun:1.4-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    PORT=11451 \
    DB_PATH=/data/unciv-srv.db

# zip 用于管理后台打包历史存档下载
RUN apt-get update && \
    apt-get install -y --no-install-recommends zip && \
    rm -rf /var/lib/apt/lists/*

# 以非 root 用户运行
RUN addgroup -g 1001 unciv && adduser -D -u 1001 -G unciv unciv \
    && mkdir -p /data && chown -R unciv:unciv /data

# 复制构建产物与运行所需文件
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY public ./public
COPY migrations ./migrations
COPY example.env ./

USER unciv

VOLUME ["/data"]
EXPOSE 11451

# 通过 /isalive 端点做健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://127.0.0.1:${PORT:-11451}/isalive || exit 1

CMD ["bun", "dist/main.js"]
