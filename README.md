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

# 运行测试
pnpm test

# 构建
pnpm build
```

## 运行

```bash
# 运行构建产物
pnpm start
```
