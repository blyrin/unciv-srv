# UncivSrv

简单的 [Unciv](https://github.com/yairm210/Unciv) 服务器

## 如何运行

### 安装依赖

```sh
pnpm i
```

### 初始化数据库

```sh
psql -h localhost -p 5432 -U postgres -d unciv-srv -f structure.sql
psql -h localhost -p 5432 -U postgres -d unciv-srv -f procedures.sql
```

### 配置

UncivSrc 读取环境变量作为配置，可通过 `.env` 文件进行配置

[参考配置](example.env)

### 启动

```sh
pnpm run dev
```
