# 开发与部署说明

## 1. 配置文件

本目录维护运行环境、Compose 编排及配置契约。应用镜像由外部构建流程提供，通过 `APP_IMAGE` 运行。

| 文件 | 用途 |
| --- | --- |
| [docker-compose-environment.yml](compose/docker-compose-environment.yml) | PostgreSQL 17、Redis 7、健康检查、持久卷和网络 |
| [docker-compose-environment-dev.yml](compose/docker-compose-environment-dev.yml) | 开发端口覆盖，仅绑定 `127.0.0.1` |
| [docker-compose-app.yml](compose/docker-compose-app.yml) | 运行已有镜像，加入环境网络，默认使用 prod |
| [dev.env.example](env/dev.env.example) | 开发配置示例 |
| [prod.env.example](env/prod.env.example) | 生产配置清单 |

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

复制 `prod.env.example` 为 `prod.env`，填写 `APP_IMAGE`、`POSTGRES_PASSWORD`、`REDIS_PASSWORD` 及部署参数。镜像使用明确的版本标签或 digest。

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
- 两组 Compose 分别管理服务，禁止使用 `--remove-orphans` 清理另一组服务。
- 应用端口默认绑定宿主机 `127.0.0.1`。外部访问通过反向代理，或显式调整 `APP_BIND_ADDRESS`。
- prod 关闭接口文档，业务请求默认拒绝；接入业务前配置认证授权。
- 数据备份、资源限制、TLS、账号权限及密钥管理由部署环境配置。

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
| `APP_PORT`、`APP_BIND_ADDRESS` | 宿主机监听端口与地址；容器端口为 8080 |
| `DB_POOL_MAX_SIZE` | Hikari 最大连接数，默认 10 |
| `JAVA_TOOL_OPTIONS` | JVM 参数，含空格的 dotenv 值须加引号 |

app Compose 根据 `POSTGRES_*`、`REDIS_PASSWORD` 和服务名生成容器的 `SPRING_*` 连接配置。仅修改 env 文件中的 `SPRING_*` 值不会覆盖此映射；使用托管数据库或 Redis 时，应同步调整 app Compose。

## 5. Profile 契约

| 配置 | 职责 |
| --- | --- |
| `application.yml` | 公共配置，不设置默认 profile |
| `application-dev.yml` | 本地连接默认值，开放接口文档 |
| `application-prod.yml` | 必填连接参数通过环境变量注入，关闭接口文档 |
| `application-integration.yml` | 基础设施测试连接配置 |

生产示例中的密码与镜像值为空，未配置时 Compose 校验失败。生产配置不提供开发密码兜底。
