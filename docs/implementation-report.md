# 初期骨架验收归档

## 1. 适用范围

本记录对应初期包含 Sample CRUD 的验证工程，验证日期为 2026-10-07。该样例用于检查分层、显式装配及基础设施链路；当前工程采用[空白领域模板](../WuhouCake-sample/README.md)，验收基线见[模板验收记录](sample-module-implementation-report.md)。

## 2. 验证对象

| 范围 | 内容 |
| --- | --- |
| 运行结构 | bootstrap 组合根、shared 公共能力、Sample 领域模块 |
| 业务链路 | HTTP 入口、Facade、应用服务、领域仓储及 MyBatis 实现 |
| 持久化 | PostgreSQL UUID 主键、显式 TypeHandler、Flyway 迁移 |
| 事务 | 应用服务代理、事务参与与回滚 |
| 缓存 | Redis TTL、JSON 编解码、租约锁所有权 |
| 环境 | 分离的环境与应用 Compose、dev/prod 配置、Java 21 镜像 |

## 3. 验证结果

| 检查 | 结果 |
| --- | --- |
| 默认构建 | 16 项测试通过 |
| 集成构建 | 16 项默认测试、5 项集成测试通过 |
| 模板复制 | 复制、改名及 Maven 构建通过 |
| 开发容器 | 健康检查通过；样例创建返回 201，查询结果匹配 |
| 生产容器 | 健康端点返回 200；样例 API、OpenAPI 与 Swagger 返回 403 |
| 配置校验 | Compose 配置通过；缺失 `APP_IMAGE` 时校验失败 |

验证环境：宿主机 Microsoft JDK 25.0.4、Java 编译目标 21、Maven Wrapper 3.9.16；容器 Temurin 21.0.12.1、PostgreSQL 17.11、Redis 7.4.11。

## 4. 现行基线

领域模板仅保留包职责和架构测试，技术验证由 bootstrap 测试夹具承担。新增领域按[模块说明](../WuhouCake-sample/README.md)实施，运行与部署按[部署说明](dev-ops/README.md)执行。历史 Sample 类型、接口及迁移不属于现行模板。
