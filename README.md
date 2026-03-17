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

- Go 1.25.0+

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

## 运行

```bash
# 直接运行（开发模式）
go run -tags dev ./cmd/server

# 运行编译后的程序
./unciv-srv
```

程序启动时会自动：

1. 加载 `.env` 配置文件
2. 创建数据库
3. 执行数据库迁移
4. 启动定时任务
5. 监听 HTTP 服务
