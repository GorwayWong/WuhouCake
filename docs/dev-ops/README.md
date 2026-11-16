# 开发与部署说明

## 1. 配置文件

本目录维护运行环境、Compose 编排及配置契约。镜像使用预先构建的 bootstrap JAR：在仓库根执行 `./mvnw clean verify` 后，用 `docker build -t wuhoucake-bootstrap:local WuhouCake-bootstrap` 构建。生产通过 `APP_IMAGE` 引用明确版本的已有镜像，不绑定具体 CI/CD 平台。

| 文件 | 用途 |
| --- | --- |
| [docker-compose-environment.yml](compose/docker-compose-environment.yml) | PostgreSQL 17、Redis 7、健康检查、持久卷和网络 |
| [docker-compose-environment-dev.yml](compose/docker-compose-environment-dev.yml) | 开发端口覆盖，仅绑定 `127.0.0.1` |
| [docker-compose-app.yml](compose/docker-compose-app.yml) | 运行已有镜像，加入环境网络，默认使用 prod |
| [dev.env.example](env/dev.env.example) | 开发配置示例 |
| [prod.env.example](env/prod.env.example) | 生产配置清单 |
| [Prod 管理员运维](admin-prod.md) | 管理员初始化、密码恢复、权限和失败处理 |

以下命令均从仓库根目录执行，Shell 示例使用 Bash。实际 `dev.env`、`prod.env` 仅保留本地，不提交仓库。

## 2. 本地开发

```bash
cp docs/dev-ops/env/dev.env.example docs/dev-ops/env/dev.env

docker compose --env-file docs/dev-ops/env/dev.env \
  -f docs/dev-ops/compose/docker-compose-environment.yml \
  -f docs/dev-ops/compose/docker-compose-environment-dev.yml up -d --wait
```

宿主机 JVM 使用 `localhost`；应用容器使用服务名 `postgres`、`redis`。调整 `POSTGRES_PORT`、`REDIS_PORT` 后，同步调整本地 JVM 的 JDBC URL 和 Redis 端口。

Compose 的 `--env-file` 不会设置宿主机 JVM 环境。直接运行应用前，可在 Bash 中加载配置：

```bash
set -a
source docs/dev-ops/env/dev.env
set +a
```

PowerShell 使用 `$env:变量名` 设置对应值。应用构建与启动步骤见[项目说明](../../README.md#2-快速开始)。

停止开发环境：

```bash
docker compose --env-file docs/dev-ops/env/dev.env \
  -f docs/dev-ops/compose/docker-compose-environment.yml \
  -f docs/dev-ops/compose/docker-compose-environment-dev.yml down
```

`down` 保留命名卷。删除数据卷不属于日常启停操作。

## 3. 生产运行

复制 `prod.env.example` 为 `prod.env`，填写 `APP_IMAGE`、`POSTGRES_PASSWORD`、`REDIS_PASSWORD`、`IDENTITY_KEY_DIR`、`APP_TEMP_DIR` 及部署参数。启动应用前完成下文的临时盘检查。镜像使用明确的版本标签或 digest。密钥见[账号运行说明](../identity.md)，管理员初始化和密码恢复见[Prod 管理员运维](admin-prod.md)。

```bash
docker compose --env-file docs/dev-ops/env/prod.env \
  -f docs/dev-ops/compose/docker-compose-environment.yml up -d --wait

docker compose --env-file docs/dev-ops/env/prod.env \
  -f docs/dev-ops/compose/docker-compose-app.yml pull

docker compose --env-file docs/dev-ops/env/prod.env \
  -f docs/dev-ops/compose/docker-compose-app.yml up -d --wait
```

运行约束：

- 环境与应用使用同一 `COMPOSE_PROJECT_NAME`，共享对应网络；先启动环境，再启动应用。
- 业务后端目前按单实例运行；SSE 是进程内连接和通知，没有跨实例广播或持久化重放。
- 两组 Compose 分别管理服务，禁止使用 `--remove-orphans` 清理另一组服务。
- 应用端口绑定宿主机 `127.0.0.1`，外部访问通过 HTTPS 反向代理。代理仅转发 `/api/`。
- prod 关闭接口文档；业务使用 Bearer JWT，员工管理和审计查询仅限超级管理员，其他未开放路径默认拒绝。
- 数据备份、资源限制、TLS、账号权限及密钥管理由部署环境配置。

这些 Compose 文件只运行后端和依赖，不构建或发布前端。前端先执行 npm ci / npm run build，再由 HTTPS 站点提供 dist 并代理 /api；SSE 不缓冲，代理读超时须长于心跳间隔。具体交互和同步边界见[前端说明](../../frontend/README.md)。可选百炼默认关闭，当前 app Compose 未显式透传识别环境变量；启用方式和数据授权见[订单识别配置](../../WuhouCake-order/README.md#百炼配置)。

## 4. 环境变量

| 变量 | 用途 |
| --- | --- |
| `COMPOSE_PROJECT_NAME` | Compose 项目、网络和卷命名 |
| `POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD` | 数据库初始化及应用容器连接 |
| `REDIS_PASSWORD` | Redis 服务及应用容器认证 |
| `POSTGRES_PORT`、`REDIS_PORT` | 开发环境宿主机端口 |
| `SPRING_PROFILES_ACTIVE` | 应用 profile；app Compose 默认 prod |
| `SPRING_DATASOURCE_URL`、`SPRING_DATASOURCE_USERNAME`、`SPRING_DATASOURCE_PASSWORD` | 直接运行 JVM 的数据库配置 |
| `SPRING_DATA_REDIS_HOST`、`SPRING_DATA_REDIS_PORT`、`SPRING_DATA_REDIS_PASSWORD` | 直接运行 JVM 的 Redis 配置 |
| `APP_IMAGE` | 已构建镜像，必填 |
| `APP_PORT` | 宿主机回环监听端口，容器端口为 8080 |
| `DB_POOL_MAX_SIZE` | Hikari 最大连接数，prod 默认 5，其余 profile 默认 10 |
| `APP_TEMP_DIR` | 专用磁盘的宿主机挂载点，容器内映射到 `/run/wuhou-scratch` |
| `POSTGRES_*`、`REDIS_MEM_LIMIT`、`REDIS_CPUS`、`REDIS_PIDS_LIMIT`、`REDIS_MAXMEMORY` | 两种生产 Compose 共用资源变量，开发使用 `dev.env.example` 中的预算 |
| `IDENTITY_KEY_DIR` | 应用 Compose 只读挂载的宿主机密钥目录，应用用户须可读 |
| `IDENTITY_PRIVATE_KEY`、`IDENTITY_PUBLIC_KEY` | 直接运行 JVM 时的持久 RSA 密钥绝对路径 |
| `CUSTOMER_ENTRY_PUBLIC_ORIGIN` | dev 默认 auto，启动时探测 Wi-Fi IPv4；prod 使用配置的 HTTPS 服务器 IP 或域名源站且禁止 auto；app Compose 必填 |
| `CUSTOMER_ENTRY_PER_MINUTE`、`CUSTOMER_ENTRY_PER_HOUR` | 每来源 IP 提交上限，默认 10／100 |
| `CUSTOMER_ENTRY_MAX_BODY_BYTES` | 客户提交正文上限，默认 131072 字节 |
| `CUSTOMER_ENTRY_TRUSTED_PROXIES` | 可信直连代理准确 IP，逗号分隔；默认不信任转发头 |

app Compose 根据 `POSTGRES_*`、`REDIS_PASSWORD` 和服务名生成容器的 `SPRING_*` 连接配置。仅修改 env 文件中的 `SPRING_*` 值不会覆盖此映射；使用托管数据库或 Redis 时，应同步调整 app Compose。

app Compose 的外置 HTTPS 代理须按路由限制请求体。订单图片 POST 为 6 MiB，套餐写入 POST/PUT 为 65 MiB，对已声明长度和流式正文均生效，正文读取期限设为 30 秒。IP 部署的 [Caddy 配置](compose/Caddyfile.ip) 可直接作为配置参考。套餐限制 16 张、图片合计 64 MiB，另给 JSON 256 KiB 和 multipart 协议留空间。

两种生产 Compose 固定主 JVM 的堆、元空间、直接内存、代码缓存、线程栈和可见处理器参数。环境文件中的 `JAVA_TOOL_OPTIONS`、`JDK_JAVA_OPTIONS`、`_JAVA_OPTIONS` 不会传入或替换固定预算。时区已通过 `TZ=Asia/Shanghai` 配置。Worker 使用固定启动参数以及固定子进程预算。Hikari 生产池默认 5，调整前核对 PostgreSQL 预留连接数。

PostgreSQL 默认 256 MiB / 0.75 核 / 64 PIDs，24 个连接、64 MiB shared buffers、2 MiB work mem、每进程 64 MiB query 临时文件。Redis 默认 96 MiB / 0.35 核 / 32 PIDs，32 MiB maxmemory、noeviction、AOF，继续使用原 `redis-data` 卷。升级前应核对已有 Redis 用量。若已超过新限额，数据随 AOF 保留，新增内存写入可能失败直至带 TTL 的键过期。以实际宿主机内存核对总预算，计算和告警链接见[本轮稳定性验收](../verification/2026-11-16-stability-followup.md)和[生产监控](monitoring/README.md)。

### 专用临时盘

在 Linux 上分配约 1 GiB 的独立 ext4 或 XFS 文件系统，使用专用块设备、LV 或已实际分配底层空间的 loop 文件。将其持久挂载到 `APP_TEMP_DIR`，配置系统启动先挂载再启动应用。应用启动检查独立文件系统和容量。普通目录 bind mount 只负责映射路径，硬上限由独立文件系统提供。

新建文件系统时应使用空设备并保留专用空间。完成挂载后设置根目录为 `10001:10001`、`0700`。IP 模式根据 `APP_UID:APP_GID` 设置所有者。目录与身份密钥、数据库数据、镜像文件及备份分开。部署检查在宿主机执行。

```sh
sh docs/dev-ops/compose/check-app-scratch.sh /srv/wuhoucake-scratch 10001 10001
```

应用 JVM、Multipart 与 POI 使用同一临时盘。应用层预留总量为 896 MiB，独立盘设置额外 64 MiB 空闲保护。活动导出覆盖快照、文件生成和下载，每次预留 768 MiB。两个上传入口分别预留 6 MiB 和 65 MiB。应用启动取得专用目录独占锁，清理符合命名规则的旧文件，进程内无活动预留时每 10 分钟清扫超过 1 小时的孤儿文件。失败会记录日志和指标。

客户入口的 HTTPS、代理来源识别和部署前验证要求见[客户扫码填单](../customer-entry.md#部署与保护)。

## 5. Profile 契约

| 配置 | 职责 |
| --- | --- |
| `application.yml` | 公共配置，不设置默认 profile |
| `application-dev.yml` | 本地连接默认值，开放接口文档 |
| `application-prod.yml` | 必填连接参数通过环境变量注入，关闭接口文档 |
| `application-integration.yml` | 基础设施测试连接配置 |

生产示例中的密码与镜像值为空，未配置时 Compose 校验失败。生产配置不提供开发密码兜底。
