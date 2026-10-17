# WuhouCake

蛋糕店员工协作系统：多商品订单、整单制作与交接、人工付款、备注、图片、导出及员工账号。采用 Java 21 / Spring Boot 模块化单体，React / TypeScript 前端。基于 [COLA Light 脚手架](https://github.com/GorwayWong/COLA5.0-Light-Base-Archetype) 初始化，来源提交 6d325771e1fef3bff6fcdd004286b7c887bf9fb4。

## 1. 当前范围

| 目录 | 职责 |
| --- | --- |
| [WuhouCake-bootstrap](WuhouCake-bootstrap/pom.xml) | 唯一应用入口、组合根、安全及运行配置 |
| [WuhouCake-order](WuhouCake-order/README.md) | 订单、制作、交接、图片、导出、可选文本识别 |
| [WuhouCake-identity](WuhouCake-identity/README.md) | 员工账号、岗位、凭证和登录会话 |
| [WuhouCake-audit](WuhouCake-audit/README.md) | 身份操作审计及超级管理员查询 |
| WuhouCake-shared | 通用契约、ID 和技术能力 |
| [WuhouCake-sample](WuhouCake-sample/README.md) | 只有包职责和架构测试的空白领域模板 |
| [frontend](frontend/README.md) | 店员工作台、录单和订单详情 |

当前使用一个业务后端实例。制作按整单推进，付款人工确认；文本识别只辅助未保存草稿。当前能力与未实现项分别见[业务范围](docs/product-scope.md)，不能将旧开发计划当作已实现功能。

## 2. 快速开始

需要 Java 21+、Docker Linux 容器及 Docker Compose；前端需要 Node.js 22.18+。Maven 使用仓库 Wrapper。具体依赖版本以 [pom.xml](pom.xml)、[Wrapper 配置](.mvn/wrapper/maven-wrapper.properties)、[前端锁文件](frontend/package-lock.json)和 [Compose 清单](docs/dev-ops/README.md)为准。

以下从仓库根目录执行，Bash 示例用于首次本地配置；已有 env 文件和持久密钥应继续使用原文件。

~~~bash
./mvnw clean verify
cp docs/dev-ops/env/dev.env.example docs/dev-ops/env/dev.env
docker compose --env-file docs/dev-ops/env/dev.env \
  -f docs/dev-ops/compose/docker-compose-environment.yml \
  -f docs/dev-ops/compose/docker-compose-environment-dev.yml up -d --wait
set -a
source docs/dev-ops/env/dev.env
set +a
~~~

接着按[账号运行说明](docs/identity.md#首次本地配置)生成或指定持久 RSA 密钥，并用一次性命令初始化管理员。普通启动不会创建或重置账号。

~~~bash
java -jar WuhouCake-bootstrap/target/WuhouCake-bootstrap-0.1.0-SNAPSHOT.jar \
  --spring.profiles.active=dev
cd frontend
npm ci
npm run dev
~~~

前端默认 http://127.0.0.1:5173，同源代理 /api 到 http://127.0.0.1:8080。后端 dev 提供 /actuator/health、/actuator/health/readiness 和 /swagger-ui/index.html。生产关闭接口文档，业务使用 Bearer JWT；首次登录必须改密后重新登录。

Compose 的 env 文件不会自动设置宿主机 JVM 环境；直接运行 JVM 的连接变量、端口和密码须与 Compose 一致。生产运行、镜像和反向代理边界见[开发与部署](docs/dev-ops/README.md)，不使用 vite preview 代替生产站点。

## 3. 验证

| 范围 | 命令 | 环境 |
| --- | --- | --- |
| 常规测试及 ArchUnit | ./mvnw clean verify | 不依赖外部数据库或模型 |
| 领域模板 | ./mvnw -pl WuhouCake-sample -am clean verify | 无外部服务 |
| 全部基础设施及 HTTP 集成 | ./mvnw -Pintegration verify | 专用 PostgreSQL、Redis |
| 前端 | 在 frontend 执行 npm test、npm run build | Node.js |

集成测试使用随机 schema 和 Redis 命名空间，仍须只连接开发或专用测试实例。口述需求八项补齐的测试与浏览器结果见[业务流程补齐验收](docs/verification/2026-10-17-workflow-fixes.md)，其他历史验证见[验证摘要](frontend/verification.md)；测试数量附执行日期，不代表以后修改自动通过。

## 4. 文档入口

| 文档 | 用途 |
| --- | --- |
| [业务范围与缺口](docs/product-scope.md) | 已实现能力、保留约束、尚未实现事项 |
| [架构规约](docs/architecture.md) | 模块依赖、分层、事务和装配 |
| [账号运行与 API](docs/identity.md) | 密钥、初始化、认证、账号和审计契约 |
| [订单 API](WuhouCake-order/README.md) | 订单字段、状态、文件和识别契约 |
| [前端运行与交互](frontend/README.md) | 草稿、并发、同步、图片与下载 |
| [开发与部署](docs/dev-ops/README.md) | Compose、环境变量、运行边界 |
| [管理员运维](docs/dev-ops/admin-prod.md) | 首位管理员初始化与密码恢复 |
| [验证摘要](frontend/verification.md) | 自动测试、浏览器/视觉结果、独立报告 |
| [身份领域词汇](CONTEXT.md) | 员工、工号、岗位、归档和会话 |
| [领域模板](WuhouCake-sample/README.md) / [开发规约](AGENTS.md) | 新模块与仓库维护 |
