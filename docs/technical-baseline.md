# 技术基线

## 1. 版本管理

依赖版本以[父 POM](../pom.xml)为准；Maven 版本由[Wrapper 配置](../.mvn/wrapper/maven-wrapper.properties)管理；环境镜像由[环境 Compose](dev-ops/compose/docker-compose-environment.yml)定义。

| 组件 | 版本或配置 | 用途 |
| --- | --- | --- |
| COLA Light | 5.0 分层方式 | 领域模块内包分层 |
| Java | 21 | 编译目标与容器运行时 |
| Spring Boot | 3.5.16 | 父 POM 与基础框架 |
| MyBatis-Plus | 3.5.17 | `mybatis-plus-spring-boot3-starter` |
| Flyway | 11.20.3 | `flyway-core`、`flyway-database-postgresql` |
| PostgreSQL | `postgres:17-bookworm` | 业务事实存储 |
| Redis | `redis:7-bookworm` | 缓存与技术租约 |
| ArchUnit | 1.5.0 | 包分层及模块边界检查 |
| springdoc | 2.8.17 | 开发环境接口文档 |
| Maven | 3.9.16 | Wrapper 构建版本 |

## 2. 工程约定

| 项目 | 约定 |
| --- | --- |
| 编码 | UTF-8 |
| 编译 | Java 21，保留方法参数名称 |
| 应用打包 | bootstrap 输出可执行 JAR，领域模块与 shared 输出普通 JAR |
| 对象映射 | MyBatis-Plus，XML 扫描使用 `classpath*:/mapper/**/*.xml` |
| 数据迁移 | bootstrap 初始化 Flyway，实际领域维护 SQL |
| Redis 使用 | 通用技术封装归 shared，业务缓存归领域 infrastructure |
| 镜像运行 | Java 21，非 root 用户，使用预先构建的 JAR |

镜像标签限定主版本，补丁随标签更新。生产部署可固定到经过验证的镜像 digest。pgvector、AI SDK、对象存储及业务认证按实际领域需求引入。

## 3. 升级验证

调整基线时，同步更新版本管理位置与本表，并验证：

1. 依赖解析与 Java 目标版本兼容性。
2. 默认测试及 ArchUnit 规则。
3. 受影响的 PostgreSQL、Redis、事务或框架装配。
4. bootstrap 打包与容器启动。

[模板验收记录](sample-module-implementation-report.md)记录具体环境版本和验证结果，不作为自动跟随镜像补丁的版本声明。

## 4. 参考资料

- [COLA](https://github.com/alibaba/COLA)：Light 包分层。
- [MyBatis-Plus 快速开始](https://baomidou.com/en/getting-started/)：Boot 3 Starter 与 Mapper。
- [MyBatis-Plus 配置](https://baomidou.com/en/reference/)：多模块资源扫描。
- [MyBatis-Plus TypeHandler](https://baomidou.com/en/guides/type-handler/)：持久化类型转换。
- [ArchUnit 用户指南](https://www.archunit.org/userguide/html/000_Index.html)：分层规则与空层处理。

工程组织参考 `xfg-frame-archetype-lite` 的配置及部署目录划分；模块职责与依赖方向按本仓库[架构规约](architecture.md)执行。
