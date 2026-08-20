# ---------- 构建阶段 ----------
FROM node:20-bookworm-slim AS build

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# Node 20 自带 corepack，启用 pnpm
RUN corepack enable

# better-sqlite3 在容器内 prebuilt 下载失败时会回退源码编译，准备工具链
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# 先安装依赖，利用 Docker 层缓存
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# 构建 TypeScript 产物，并剔除开发依赖，缩小运行镜像
COPY . .
RUN pnpm build && pnpm prune --prod

# ---------- 运行阶段 ----------
FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    PORT=11451 \
    DB_PATH=/data/unciv-srv.db \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# 以非 root 用户运行
RUN groupadd -r unciv && useradd -r -g unciv -u 1001 unciv \
    && mkdir -p /data && chown -R unciv:unciv /data

# 复制构建产物与运行所需文件
COPY --from=build /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/migrations ./migrations
COPY example.env ./

USER unciv

VOLUME ["/data"]
EXPOSE 11451

# 通过 /isalive 端点做健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||11451)+'/isalive').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
