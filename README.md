# UncivSrv

简单的 [Unciv](https://github.com/yairm210/Unciv) 多人联机服务器

## 功能特性

- 游戏存档上传/下载
- WebSocket 实时聊天
- Web 管理后台（管理员面板 + 用户面板）
- 自动数据库版本管理和迁移
- 定时清理过期数据
- 登录限流保护

## 环境要求

- Go 1.24.0+
- PostgreSQL 数据库

## 编译

```bash
# 不注入版本信息
go build -ldflags="-s -w" -o unciv-srv ./cmd/server

# 注入版本信息
go build -ldflags="-s -w -X main.Version=v1.0.0 -X main.BuildTime=2025-12-05T10:30:00Z -X main.GitCommit=abc1234" -o unciv-srv ./cmd/server
```

## 配置

在项目根目录创建 `.env` 文件：

```env
# 服务端口
PORT=11451

# 数据库配置（TCP 连接）
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=unciv-srv

# 可选：使用 Unix Socket 连接（设置后优先使用）
# DB_SOCKET_PATH=/var/run/postgresql

# 管理员账户
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123

# 登录限流配置
MAX_ATTEMPTS=5    # 最大尝试次数
LOCK_TIME=5       # 锁定时间（分钟）
```

## 运行

```bash
# 直接运行（开发模式）
go run ./cmd/server

# 运行编译后的程序
./unciv-srv
```

程序启动时会自动：

1. 加载 `.env` 配置文件
2. 连接数据库
3. 执行数据库迁移
4. 启动定时任务
5. 监听 HTTP 服务

## 数据库初始化

程序首次运行时会自动执行 `migrations/` 目录下的迁移脚本，无需手动创建表结构。

只需提前创建好数据库即可：

```sql
CREATE DATABASE "unciv-srv";
```

## API 端点

### 游戏客户端接口

- `GET/PUT /auth` - 玩家认证
- `GET/PUT /files/{gameId}` - 游戏存档读写
- `/chat` - WebSocket 聊天

### Web 管理接口

- `/` - 主页
- `/admin/` - 管理员面板
- `/user/` - 用户面板
- `/isalive` - 健康检查
