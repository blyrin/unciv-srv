# UncivSrv

功能完善的 [Unciv](https://github.com/yairm210/Unciv) 多人联机服务器。

首发支持 [UncivCN](https://github.com/AutumnPizazz/Unciv) 独占功能。

## 功能特性

- 游戏存档上传/下载
- WebSocket 实时聊天
- Web 管理后台（管理员面板 + 用户面板）
- 自动数据库版本管理和迁移
- 定时清理过期数据
- 登录限流保护
- 同步回合（UncivCN）

## 环境要求

- Node.js 20+
- pnpm 10+

## 配置

在项目根目录创建 `.env` 文件：

```env
# 监听端口
PORT=11451

# 数据库文件路径
DB_PATH='data/unciv-srv.db'

# 管理员配置
ADMIN_USERNAME='admin'
ADMIN_PASSWORD='admin123'

# 网页登录限制
## 次数
MAX_ATTEMPTS=5
## 分钟
LOCK_TIME=5
```

## 开发与测试

```bash
# 安装依赖
pnpm install

# 开发运行
pnpm dev

# 类型检查
pnpm typecheck

# 运行 Vitest 测试
pnpm test

# 生成覆盖率报告（输出到 .local/coverage）
pnpm test:coverage

# 构建
pnpm build
```

## 运行

```bash
# 运行构建产物
pnpm start
```

## Docker 部署

仓库自带 `Dockerfile`、`docker-compose.yml` 与 `.dockerignore`，可一键容器化部署。镜像多阶段构建、以非 root 用户运行，数据库存放在 `/data` 卷中（SQLite 自动迁移）。

### 方式一：docker compose（推荐）

```bash
# 构建并启动
cp example.env .env   # 可选：先用 example 生成 .env 占位
docker compose up -d --build

# 查看日志
docker compose logs -f

# 停止
docker compose down
```

启动前请修改 `docker-compose.yml` 中的 `ADMIN_USERNAME` / `ADMIN_PASSWORD`，避免使用默认管理员口令。

### 方式二：docker run

```bash
docker build -t unciv-srv .
docker run -d --name unciv-srv \
  -p 11451:11451 \
  -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD=admin123 \
  -e DB_PATH=/data/unciv-srv.db \
  -v unciv-srv-data:/data \
  --restart unless-stopped \
  unciv-srv
```

### 环境变量（Docker）

与 `.env` 完全一致，可直接通过 `-e` / `environment` 注入：`PORT`、`DB_PATH`、`ADMIN_USERNAME`、`ADMIN_PASSWORD`、`MAX_ATTEMPTS`、`LOCK_TIME`。容器默认 `PORT=11451`、`DB_PATH=/data/unciv-srv.db`。

镜像含健康检查，依赖 `/isalive` 端点，`docker compose ps` 或 `docker inspect` 可查看容器健康状态。
