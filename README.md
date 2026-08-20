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

## 安装包托管（CN 官方下载服务器）

服务器内置安装包托管功能：把 UncivCN 的安装包（APK / MSI / 绿色版 zip / jar 等）上传到本服务器。**游戏内更新检查与安装包下载按玩家地区分流**：

- 首次启动游戏会弹窗询问所在地区（也可在「选项 - 高级 - 玩家地区」修改）
- 选择「中国大陆」的玩家：更新检查（`GET /api/downloads/latest.json`）与安装包下载（`<服务器>/dl/<版本号>/<文件名>`）固定走本服务器（github.com 在大陆被墙）
- 选择「中国大陆以外」的玩家：与模组下载一样，走玩家在「选项 - 高级 - 下载源」里设置的源（GitHub 官方 / 镜像 / 自定义）

模组下载不受影响，始终走玩家设置的下载源。

### 目录结构

```
<DOWNLOAD_DIR>/           # 默认 /data/unciv-dl（容器）或 data/unciv-dl（本地）
└── 4.21.10.1/            # 版本 tag 目录
    ├── UncivCN-4.21.10.1.Apk
    ├── UncivCN-4.21.10.1.msi
    └── ...
```

上传新版本后自动清理旧版本目录，只保留最新 `DOWNLOAD_KEEP_VERSIONS` 个版本（默认 1），节约存储空间。

### 管理接口（管理员认证）

认证方式二选一：Web 后台登录会话（浏览器 cookie），或管理员 Basic Auth（CI 等无 cookie 场景）：

| 接口 | 说明 |
| --- | --- |
| `GET /api/downloads/latest.json` | 检查更新：返回最新版本与资产清单（公开，无需认证） |
| `POST /api/downloads/upload?tag=<版本号>&filename=<文件名>` | 上传安装包（请求体为文件原始字节，流式写入） |
| `GET /api/downloads` | 列出已托管文件 |
| `DELETE /api/downloads/<版本号>/<文件名>` | 删除指定文件 |
| `GET /dl/<版本号>/<文件名>` | 下载安装包（无鉴权，受下载保护限制） |

上传示例（CI / 命令行）：

```bash
curl -u "admin:你的管理员密码" -X POST \
  --data-binary "@UncivCN-4.21.10.1.Apk" \
  "http://服务器地址/api/downloads/upload?tag=4.21.10.1&filename=UncivCN-4.21.10.1.Apk"
```

Web 管理后台新增「安装包托管」页签，可上传、查看、下载与删除托管文件。

### 下载保护

- 全局并发连接数限制（`DOWNLOAD_MAX_CONCURRENT`，默认 4）——防止带宽被打满
- 单连接限速（`DOWNLOAD_RATE_LIMIT_KBPS`，默认 1024 即 1MB/s，0 表示不限速）——防止单用户占满带宽
- 每 IP 每分钟请求数限制（`DOWNLOAD_IP_LIMIT_PER_MINUTE`，默认 30）——防刷流量
- 版本号/文件名校验 + 路径穿越防护
- 支持 `Range` 断点续传

### 环境变量（安装包托管）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DOWNLOAD_DIR` | `data/unciv-dl` | 托管根目录（容器内建议 `/data/unciv-dl` 并挂卷） |
| `DOWNLOAD_MAX_CONCURRENT` | `4` | 同时下载连接数上限 |
| `DOWNLOAD_RATE_LIMIT_KBPS` | `1024` | 单连接限速 KB/s，0 不限速 |
| `DOWNLOAD_IP_LIMIT_PER_MINUTE` | `30` | 每 IP 每分钟下载请求上限 |
| `DOWNLOAD_KEEP_VERSIONS` | `1` | 保留的最新版本数，旧版本自动清理 |
| `DOWNLOAD_MAX_FILE_SIZE_MB` | `512` | 单个上传文件大小上限（MB） |

### CI 自动同步

`buildAndDeploy.yml` 在 release 发布后自动把安装包同步到本服务器。仓库需配置 Secrets：`CN_DL_SERVER`（如 `http://sp.unciv.cn:30123`）、`CN_DL_USER` / `CN_DL_PASS`（与 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 一致）。未配置时同步自动跳过。
