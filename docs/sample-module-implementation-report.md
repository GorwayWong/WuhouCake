# 领域模板验收记录

## 1. 验收基线

| 项目 | 记录 |
| --- | --- |
| 验证日期 | 2026-10-07 |
| 代码基线 | [59afeed](https://github.com/GorwayWong/COLA5.0-Light-Base-Archetype/commit/59afeed) |
| 模板形态 | 31 份包职责文档，无业务类及生产迁移 |
| 模块规则 | 领域纯净、五层方向、API 技术类型、跨模块边界 |
| 装配规则 | application 允许 `@Service`，实现由 bootstrap 显式注册 |
| 公共测试 | bootstrap 测试 Mapper、临时表及独立 Flyway schema |

工程职责见[架构设计](architecture.md)，新增领域步骤见[模块模板](../WuhouCake-sample/README.md)。

## 2. 验证结果

| 检查 | 范围与结果 |
| --- | --- |
| 全工程默认构建 | 29 项测试通过 |
| 模块内测试 | 4 条架构规则、10 项规则验证通过 |
| 全局测试 | 6 条架构规则、9 项规则验证通过 |
| 基础设施集成构建 | 默认 29 项与集成 5 项全部通过，共 34 项 |
| 模板复制 | 改名后独立构建，14 项测试通过 |
| Sample 打包 | 业务 class 数量为 0 |
| bootstrap 打包 | 未包含测试 Mapper、DO、迁移脚本或 Sample 装配 |
| 开发容器 | 先执行集成测试再启动，汇总、存活、就绪状态均为 UP；OpenAPI 无业务路径 |
| 生产容器 | 健康端点返回 200，OpenAPI 与 Swagger 返回 403 |
| 数据库隔离 | public 无技术测试历史表；独立 schema 有测试历史表；无 Sample schema |
| 差异检查 | `git diff --check` 通过 |

集成检查覆盖 PostgreSQL/MyBatis-Plus 读写、保存点回滚、Flyway、健康端点、JSON、Redis TTL 与锁所有权。Flyway 测试历史位于 `integration_probe.integration_flyway_schema_history`；探针表在事务结束时自动移除。

## 3. 验证环境

| 环境 | 版本 |
| --- | --- |
| 宿主机 JDK | Microsoft JDK 25.0.4，编译目标 21 |
| Maven Wrapper | 3.9.16 |
| 容器 JRE | Temurin 21.0.12.1 |
| PostgreSQL | 17.11 |
| Redis | 7.4.11 |

记录对应上述版本；浮动主版本镜像后续获取的补丁版本可能不同。

## 4. 兼容性说明

旧示例迁移 `V1__sample_create_samples.sql` 已从模板移除。新工程使用新数据库；需要保留旧库数据时，先制定迁移兼容方案。不得修改已应用的迁移，或通过 repair、清库、删除数据卷绕过历史校验。
