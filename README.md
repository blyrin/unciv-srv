# UncivSrv

功能完善的 [Unciv](https://github.com/yairm210/Unciv) 多人联机服务器，首发支持 [UncivCN](https://github.com/AutumnPizazz/Unciv) 独占功能。

## 功能特性

* 游戏存档上传/下载
* WebSocket 实时聊天（可关闭）
* 灵活的注册模式（开放注册 / 管理员审核 / 仅预建账号）
* 安全的密码哈希存储（scrypt），支持 IP 网段匿名化与到期清理
* Web 管理后台（管理员面板 + 用户面板）
* 自动数据库版本管理和迁移
* 定时清理过期数据与超量存档归档
* 登录限流保护
* 支持同步回合（UncivCN）与安装包加速分发

## 环境要求

* **Bun** 1.4+

## 配置说明

在项目根目录创建 `.env` 文件（完整配置清单如下）：

| 变量名                  | 默认值                                                                               | 说明                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `PORT`                  | `11451`                                                                              | 服务器监听端口                                                          |
| `DB_PATH`               | `data/unciv-srv.db`                                                                  | SQLite 数据库文件路径                                                   |
| `ADMIN_USERNAME`        | `admin`                                                                              | 后台管理员用户名                                                        |
| `ADMIN_PASSWORD`        | `admin123`                                                                           | 后台管理员密码                                                          |
| `MAX_ATTEMPTS`          | `5`                                                                                  | 网页登录失败限制次数                                                    |
| `LOCK_TIME`             | `5`                                                                                  | 登录超限后的锁定时间（分钟）                                            |
| `REGISTER_MODE`         | `open`                                                                               | 注册模式：`open` 开放注册；`approval` 需管理员审核；`closed` 仅预建账号 |
| `CHAT_ENABLED`          | `true`                                                                               | 是否启用多人聊天（关闭后仅影响聊天，不影响存档同步）                    |
| `IP_STORAGE`            | `anonymized`                                                                         | IP 存储策略：`full` 完整 IP；`anonymized` 只存网段；`none` 不存 IP      |
| `IP_RETENTION_DAYS`     | `30`                                                                                 | IP 保留天数，超过后自动清空（`0` 表示不清理）                           |
| `ARCHIVE_ENABLED`       | `true`                                                                               | 是否启用超出容量后自动归档最久未使用的对局                              |
| `ARCHIVE_MAX_MB`        | `1024`                                                                               | 存档数据总量上限（MB），超出后触发归档                                  |
| `ARCHIVE_DIR`           | `data/archive`                                                                       | 存档归档目录路径                                                        |
| `DOWNLOAD_GITHUB_REPO`  | `AutumnPizazz/Unciv`                                                                 | 版本清单与安装包所在的 GitHub 仓库 (`owner/repo`)                       |
| `DOWNLOAD_GITHUB_PROXY` | `[https://mirror.ecrow.cn/github-release/](https://mirror.ecrow.cn/github-release/)` | GitHub 镜像加速前缀（留空表示直连）                                     |

## 可观测性

* `GET /metrics`：Prometheus 文本格式监控指标（进程运行时长、内存、V8 堆用量及请求/聊天计数器）。
* `GET /ready`：就绪探针（探测数据库连接状态，正常返回 `200`，异常返回 `503`）。
* `GET /isalive`：存活探针，供 Docker 健康检查使用。


## 开发与部署

### 开发与测试

```bash
# 安装依赖（仅类型检查需要）
bun install
# 开发运行（文件变更自动重启）
bun run dev
# 类型检查
bun run typecheck
# 运行单元测试
bun test
# 打包构建
bun run build
```

### Docker 容器部署

推荐使用 `docker-compose` 进行容器化部署，数据库及归档目录默认挂载至 `/data` 卷。

**方式一：Docker Compose（推荐）**

```bash
cp example.env .env   # 可选：生成环境变量配置文件
docker compose up -d --build
```

**方式二：Docker Run**

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

> **镜像标签约定**：自建部署时，镜像建议使用「配套客户端版本 + 构建号」命名（例如 `unciv-srv:4.22.4.1-b6`），避免使用 `.2`、`.3` 等后缀，以免与 UncivCN 客户端子版本号冲突。

---

## 部署者须知

本服务器属于社区自建、自维护的联机服务端，**与 Unciv 上游项目及其开发者无关**。部署者以个人或社区身份运营时，需自行承担相关合规责任。

* **合规与备案**：
* **域名与 ICP 备案**：在中国大陆境内提供服务，须通过主机服务商办理 ICP 备案并公示，30 日内办理公安联网备案。游戏类服务通常需前置审批，个人主体往往较难满足。
* **APP 备案**：面向大陆分发 APK 需按工信部要求办理 APP 备案。
* **未成年人保护**：若面向未成年人，须接入国家新闻出版署实名验证系统。


* **安全与隐私建议**：
* 生产环境请务必配置 HTTPS 并定期备份 `DB_PATH` 数据库。
* 建议合理配置 `REGISTER_MODE=approval` 或 `closed`、开启 `CHAT_ENABLED=false` 以及调整 `IP_STORAGE`，以减少隐私与合规风险。
* 安全日志依法可能需留存不少于 6 个月，请与个人信息最小化留存策略妥善区分。若无法满足大陆的备案与主体资格要求，建议将服务部署在境外或改为私有邀请制。
