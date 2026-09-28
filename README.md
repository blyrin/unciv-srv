# UncivSrv

功能完善的 [Unciv](https://github.com/yairm210/Unciv) 多人联机服务器。

首发支持 [UncivCN](https://github.com/AutumnPizazz/Unciv) 独占功能。

## 功能特性

- 游戏存档上传/下载
- WebSocket 实时聊天（可关闭）
- 注册模式可配置（开放注册 / 管理员审核 / 仅预建账号）
- 密码哈希存储（scrypt），IP 可只存网段并到期清理
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

# 注册与联机开关
## 注册模式：open 开放注册 / approval 新账号需管理员审核 / closed 只有预建账号可登录
REGISTER_MODE='open'
## 是否启用多人聊天（关闭后聊天不可用，存档同步与游戏更新推送不受影响）
CHAT_ENABLED=true
## IP 存储策略：full 存完整地址 / anonymized 只存网段 / none 不存
IP_STORAGE='anonymized'
## IP 保留天数（超过后自动清空 IP，0 表示不清理）
IP_RETENTION_DAYS=30
```

完整变量清单见 `example.env`，容器部署见 `docker-compose.yml`。

### 账号与隐私相关配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `REGISTER_MODE` | `open` | `open` 开放自助注册；`approval` 新账号先进入待审核状态，管理员在后台「玩家管理」中通过后才能使用联机接口；`closed` 不开放自助注册，只有管理员预建的账号可登录 |
| `CHAT_ENABLED` | `true` | 设为 `false` 后聊天消息被拒绝，但订阅、房间加入、同步回合信号与「存档已更新」推送仍正常工作 |
| `IP_STORAGE` | `anonymized` | `full` 存完整 IP；`anonymized` 只存网段（IPv4 抹掉主机位、IPv6 只存前 3 组）；`none` 完全不写入 IP |
| `IP_RETENTION_DAYS` | `30` | 超过该天数的 IP 由定时清理任务自动清空，`0` 表示不清理 |
| `ARCHIVE_ENABLED` | `true` | 定时清理时，若存档数据总量超过 `ARCHIVE_MAX_MB`，就把最久未使用的非白名单对局归档；设为 `false` 则不做容量归档 |
| `ARCHIVE_MAX_MB` | `1024` | 存档数据总量上限（MB，按存档正文与预览的字节数统计）；超过后从最久未使用的对局开始归档，直到降到上限以内 |
| `ARCHIVE_DIR` | `data/archive` | 归档目录，每次归档写一个 `unciv-archive-<时间戳>Z.jsonl`（每行一局）；建议放在挂载卷（如 `/data/archive`）里，便于宿主机脚本加密上传到网盘 |

> 密码一律以 scrypt 哈希（每个账号独立随机盐）存储，无法还原；升级旧库时启动日志会提示已把明文密码升级为哈希。管理后台不再提供「查看密码」，只能为玩家重置密码。
>
> 升级旧库时，**历史账号一律按未审核处理**（迁移 000004 以 `approved = 0` 回填），需要管理员在后台「玩家管理」逐个通过后才能使用联机接口。

## 部署者须知

本服务器是社区自建、自维护的联机服务端，**与 Unciv 上游项目及其开发者无关**，也不代表任何官方服务。部署者以个人或社区身份运营时，需要自行确认并承担所在地区的法律义务（ICP 备案、APP 备案、实名与内容安全、未成年人保护/防沉迷、个人信息保护、日志留存等），本项目不提供合规担保。可用的技术手段：

- `REGISTER_MODE=approval` 或 `closed`：只服务确认过的玩家，避免对公众开放注册
- `CHAT_ENABLED=false`：关闭即时通讯能力，只保留存档同步
- `IP_STORAGE` / `IP_RETENTION_DAYS`：只记录网段并限制保留时间
- 访问日志：请求日志含 IP 与 User-Agent，请自行配置日志轮转（`docker-compose.yml` 已限制为 10MB × 3，`docker run` 可用 `--log-opt max-size=10m --log-opt max-file=3`），不要长期堆积
- 生产环境请使用 HTTPS（反向代理终止 TLS）并定期备份 `DB_PATH`
- 部署在境外主机时，请自行评估数据出境与当地法规要求

关于中国大陆部署者的几点提示：

- **域名实名认证不等于 ICP 备案**：在境内用服务器对外提供服务，须通过主机服务商向省通信管理局办理 **ICP 备案** 并公示备案号，备案完成后 30 日内办理**公安联网备案**；未备案的境内服务器通常会被运营商阻断。游戏/出版类服务备案通常还需**前置审批**（如网络出版服务许可/版号），个人主体往往无法提供。
- **APP 备案**：面向中国大陆分发 APK 还需按工信部 2023 年通知办理 **APP 备案**，游戏类 APP 备案同样需要前置审批材料。
- **未成年人保护 / 防沉迷**：面向未成年人提供服务时须遵守未成年人保护与防沉迷要求；法定的网络游戏防沉迷需实名登录并接入国家新闻出版署实名验证系统，个人主体通常无法接入。
- **日志留存**：安全类日志依法可能需留存**不少于 6 个月**，请与个人信息的最小化留存策略分开处理。
- **建议**：若无法满足备案与主体资格要求，可考虑将服务迁出大陆或收敛为邀请制封闭使用，避免公开对大陆提供默认联机入口。

### 冷存档归档

每天凌晨 4:00 的清理任务会把**最久未使用且未加入白名单**的对局归档到本地归档目录，而不是直接删除。触发条件是**存档数据总量**：所有对局的存档正文与预览字节数之和超过 `ARCHIVE_MAX_MB`（默认 1GB）后，按 `updated_at` 从旧到新依次归档，直到总量降到上限以内。

1. 每次归档写一个 `<ARCHIVE_DIR>/unciv-archive-<UTC 时间戳>Z.jsonl`（每行一局，含玩家、创建/更新时间、回合数、存档正文与预览），先写临时文件再改名；
2. 全部写入成功后，才在一个事务里删除数据库记录，并在 `archived_games` 表里留下记录（因此玩家请求已归档对局时能收到「正在恢复」的提示，而不是「对局不存在」）；
3. 宿主机脚本负责把归档文件交给加密归档工具（bvault 自己会做 `tar.zstd.gpg` 与分块上传，例如 `bvault put <归档文件> --to /workspace/unciv-archive --async`），上传校验成功后删除本地副本，因此服务器上只保留尚未上传的归档。

手动触发一次清理与归档（不必等到凌晨 4:00）：

```bash
docker compose exec unciv-srv node --input-type=module -e "
import { loadEnvFile, loadConfig } from './dist/config.js'
import { initDatabase, runCleanup, closeDatabase } from './dist/database.js'
loadEnvFile(); const config = loadConfig(); initDatabase(config)
runCleanup(config.archiveEnabled, config.archiveDir, config.archiveMaxBytes)
closeDatabase()"
```

玩家在游戏里打开（或刷新）已归档的对局时，服务端返回 `503` 与说明文本，客户端会提示「该对局已被冷归档……请稍后重试」，同时登记一条恢复请求（定时刷新的预览请求不会登记）。管理后台的 `GET /api/restore-requests` 可以看到待恢复列表，`DELETE /api/restore-requests/<对局ID>` 表示放弃恢复。

恢复归档（对局 ID 保持不变）：

```bash
# 先从网盘取回归档：bvault get <item-id> --out <目录>（文件名与归档时一致）
# 再把取回的文件放进容器能访问的目录，例如 /root/unciv-srv/data/restore/<归档文件>
docker compose run --rm unciv-srv node dist/main.js --restore-archive /data/restore/<归档文件> [对局ID]
```

不带对局 ID 时恢复归档文件里的全部对局，带对局 ID 时只恢复该局。恢复后对局重新出现在数据库里（对局 ID 保持不变），玩家可以直接继续；管理后台也可以把它加入白名单以免被再次归档。

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

### 镜像标签约定

自建部署时，镜像标签用「配套客户端版本 + 构建号」，例如 `unciv-srv:4.22.4.1-b6`（配套客户端的 `4.22.4.1`，第 6 次服务器端构建）。**不要**写成 `unciv-srv:4.22.4.2` 这类形式：在 UncivCN 的版本规则里，`.2`、`.3`… 是「同一上游版本的 CN 子版本号」（见 `docs/zh/UncivCN/Changelog.md` 开头），会被误读成客户端发版。

### 环境变量（Docker）

与 `.env` 完全一致，可直接通过 `-e` / `environment` 注入：`PORT`、`DB_PATH`、`ADMIN_USERNAME`、`ADMIN_PASSWORD`、`MAX_ATTEMPTS`、`LOCK_TIME`。容器默认 `PORT=11451`、`DB_PATH=/data/unciv-srv.db`。

镜像含健康检查，依赖 `/isalive` 端点，`docker compose ps` 或 `docker inspect` 可查看容器健康状态。

## 安装包直链（UncivCN 社区下载服务器）

服务器**不再托管安装包文件**：安装包仍发布在 GitHub Release，社区下载服务器只做两件事——给大陆玩家一个可达的版本清单，并把 `/dl/...` 直链 302 跳到 GitHub（经镜像前缀）。**游戏内更新检查与安装包下载按玩家地区分流**：

- 首次启动游戏会弹窗询问所在地区（也可在「选项 - 高级 - 玩家地区」修改）
- 选择「中国大陆」的玩家：更新检查（`GET /api/downloads/latest.json`，转发 GitHub `releases/latest`，带 2 分钟进程内缓存，拉取失败时退回上一次缓存）拿到 GitHub 形式的资产清单；下载 `<服务器>/dl/<版本号>/<文件名>` 时服务器 302 到 `DOWNLOAD_GITHUB_PROXY` + GitHub 地址（github.com 在大陆被墙）
- 选择「中国大陆以外」的玩家：与模组下载一样，走玩家在「选项 - 高级 - 下载源」里设置的源（GitHub 官方 / 镜像 / 自定义）

模组下载不受影响，始终走玩家设置的下载源。

> 为什么不再托管：安装包由镜像直接分发给玩家，省下服务器带宽与磁盘；`/dl/` 保留是为了兼容旧客户端（它们的更新检查结果里带的是本服务器的 `/dl/` 链接，客户端会跟随 302）。

### 接口

| 接口 | 说明 |
| --- | --- |
| `GET /api/downloads/latest.json` | 检查更新：转发 GitHub `releases/latest`（公开，无需认证；过滤 `linuxFilesForJar` / `unciv-lua-api` 等辅助文件） |
| `GET /dl/<版本号>/<文件名>` | 安装包直链：302 到 `<DOWNLOAD_GITHUB_PROXY><owner>/<repo>/releases/download/<版本号>/<文件名>`（无鉴权） |

### 环境变量（安装包直链）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DOWNLOAD_GITHUB_REPO` | `AutumnPizazz/Unciv` | 版本清单与安装包所在的 GitHub 仓库（owner/repo） |
| `DOWNLOAD_GITHUB_PROXY` | `https://mirror.ecrow.cn/github-release/` | GitHub 镜像前缀，替换 `https://github.com/`（留空 = 直连） |

### CI 校验

`buildAndDeploy.yml` 在 release 发布后轮询 `GET /api/downloads/latest.json`，确认 `tag_name` 已切到本次版本，并跟随 `/dl/<版本号>/UncivCN-<版本号>.Apk` 的跳转校验安装包可下载。仓库需配置 Secret：`CN_DL_SERVER`（如 `https://unciv.civgo.top:30123`）。未配置时该 job 自动跳过。
