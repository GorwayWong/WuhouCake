# WuhouCake

基于 [COLA 5.0 Light 脚手架](https://github.com/GorwayWong/COLA5.0-Light-Base-Archetype) 初始化，来源提交为 `6d325771e1fef3bff6fcdd004286b7c887bf9fb4`。

基于 COLA Light 包分层的模块化单体工程。一个业务领域对应一个 Maven 模块，由 `WuhouCake-bootstrap` 统一装配并输出可执行 JAR。

## 1. 工程结构

| 模块或目录 | 职责 |
| --- | --- |
| `WuhouCake-bootstrap` | 应用入口、组合根、全局配置及运行镜像 |
| `WuhouCake-shared` | 通用契约与技术能力 |
| `WuhouCake-sample` | 可复制的空白领域模块模板 |
| `WuhouCake-identity` | 员工账号、凭证、岗位与登录状态 |
| `WuhouCake-audit` | 操作审计及超级管理员查询 |
| `docs` | 架构规约、技术基线、部署说明及验收记录 |

领域模块内部采用 `api / adapter / application / domain / infrastructure` 五层结构。`WuhouCake-sample` 的生产源码仅定义包职责，不包含业务接口、模型或数据库迁移。

## 2. 快速开始

构建目标为 Java 21，Maven 版本由 Wrapper 管理。开发运行需要 Docker Linux 容器及 Docker Compose。以下命令均在仓库根目录执行，Shell 示例使用 Bash；Windows 可使用 Git Bash，或通过 `./mvnw.cmd` 执行 Maven 命令。

```bash
./mvnw clean verify

umask 077
mkdir -p secrets/identity
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out secrets/identity/private.pem
openssl pkey -in secrets/identity/private.pem -pubout -out secrets/identity/public.pem
chmod 700 secrets/identity
chmod 600 secrets/identity/private.pem
export IDENTITY_PRIVATE_KEY="$PWD/secrets/identity/private.pem"
export IDENTITY_PUBLIC_KEY="$PWD/secrets/identity/public.pem"

cp docs/dev-ops/env/dev.env.example docs/dev-ops/env/dev.env
docker compose --env-file docs/dev-ops/env/dev.env \
  -f docs/dev-ops/compose/docker-compose-environment.yml \
  -f docs/dev-ops/compose/docker-compose-environment-dev.yml up -d --wait

java -jar WuhouCake-bootstrap/target/WuhouCake-bootstrap-0.1.0-SNAPSHOT.jar \
  --spring.profiles.active=dev
```

开发配置默认使用本机 PostgreSQL 和 Redis，与 `dev.env.example` 一致。调整端口或凭据后，须同步配置宿主机 JVM 的 `SPRING_*` 环境变量；具体规则见[部署说明](docs/dev-ops/README.md)。

| 访问地址 | 用途 |
| --- | --- |
| `http://localhost:8080/actuator/health` | 汇总健康状态 |
| `http://localhost:8080/actuator/health/liveness` | 存活探针 |
| `http://localhost:8080/actuator/health/readiness` | 就绪探针，包含数据库检查 |
| `http://localhost:8080/swagger-ui/index.html` | 开发环境接口文档 |

启动须显式选择 `dev` 或 `prod`，并配置持久保存的 RSA 密钥。健康端点允许匿名访问；业务使用 Bearer JWT，员工管理和日志查询仅限超级管理员。生产环境关闭接口文档。首次部署须按[账号运行说明](docs/identity.md)初始化管理员，普通启动不会创建或重置账号。

## 3. 测试

| 范围 | 命令 | 外部服务 |
| --- | --- | --- |
| 全工程架构与规则验证 | `./mvnw clean verify` | 无 |
| 领域模板及其依赖 | `./mvnw -pl WuhouCake-sample -am clean verify` | 无 |
| 基础设施集成验证 | `./mvnw -Pintegration verify` | PostgreSQL、Redis |

集成测试使用测试 Mapper、事务内临时表、独立 Flyway schema 和 Redis 键前缀，覆盖基础设施、真实 HTTP 账号生命周期、并发管理员操作、凭证撤销、CSRF 与审计故障。仅连接开发或专用测试数据库。

## 4. 扩展与部署

新增领域按[模块模板说明](WuhouCake-sample/README.md)复制、改名并注册。接口、仓储实现与输入适配器均由 bootstrap 显式装配。

镜像使用预先构建的 bootstrap JAR。构建上下文为 `WuhouCake-bootstrap`：

```bash
docker build -t wuhoucake-bootstrap:local WuhouCake-bootstrap
```

部署通过 `APP_IMAGE` 指定已有镜像，不绑定具体 CI/CD 平台。使用过旧 Sample 示例迁移的数据库，须按[兼容性说明](docs/sample-module-implementation-report.md#4-兼容性说明)处理。

## 5. 文档索引

| 文档 | 内容 |
| --- | --- |
| [架构设计](docs/architecture.md) | 模块职责、依赖方向与装配规约 |
| [领域模块模板](WuhouCake-sample/README.md) | 包职责、复制步骤与模块测试 |
| [开发与部署](docs/dev-ops/README.md) | Compose、环境变量与运行步骤 |
| [技术基线](docs/technical-baseline.md) | 组件版本及管理位置 |
| [账号运行与 API](docs/identity.md) | 密钥、初始化、管理员恢复、认证和接口契约 |
| [领域词汇](CONTEXT.md) | 员工身份、工号、岗位和归档的含义 |
| [模板验收记录](docs/sample-module-implementation-report.md) | 当前模板的验证范围与结果 |
| [骨架演进记录](docs/implementation-report.md) | 初期业务样例的归档记录 |
| [开发规约](AGENTS.md) | 仓库维护与验证要求 |
