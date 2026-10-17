# 领域模块模板

`WuhouCake-sample` 提供 COLA Light 目录、包职责及架构测试，用于复制创建业务领域模块。生产源码仅包含 `package-info.java`，业务类型与迁移脚本由实际领域定义。

## 1. 目录结构

```text
src/main/java/org/xaspire/WuhouCake/sample
├── api/{facade,dto,command,query}
├── adapter/{web,mq,job}
├── application/{service,command,query,assembler}
├── domain
│   ├── model/{aggregate,entity,valobj}
│   ├── service
│   ├── repository
│   ├── port
│   └── event
└── infrastructure
    ├── persistence/{mapper,dataobject,repository}
    ├── gateway
    └── client

src/test/java/org/xaspire/WuhouCake
├── sample/architecture
├── sample/integration
└── 架构规则测试夹具
```

## 2. 包职责

| 包 | 职责 |
| --- | --- |
| `api.facade` | 公开用例接口，由 application 实现 |
| `api.dto`、`api.command`、`api.query` | 公开输出、写入请求、查询条件 |
| `adapter.web`、`adapter.mq`、`adapter.job` | HTTP、消息消费者、定时任务入口 |
| `application.service` | 用例编排、事务边界、领域调用和事件发布 |
| `application.command`、`application.query` | 写、读用例处理器 |
| `application.assembler` | DTO 与领域数据转换 |
| `domain.model.aggregate` | 聚合根与聚合内一致性 |
| `domain.model.entity`、`domain.model.valobj` | 有身份的实体、按内容比较的值对象及其约束 |
| `domain.service` | 同一业务领域内，跨对象的业务规则 |
| `domain.repository`、`domain.port` | 聚合存取契约、外部能力输出端口 |
| `domain.event` | 内部领域事实 |
| `infrastructure.persistence` | Mapper、DO、仓储实现及持久化转换 |
| `infrastructure.gateway`、`infrastructure.client` | 输出端口适配、第三方 SDK 与 HTTP 客户端 |

## 3. 开发规约

- 【强制】依赖方向为 `adapter → application → domain ← infrastructure`；adapter 可通过本模块 api.facade 调用用例。
- 【强制】domain 仅依赖自身 domain 和 JDK 核心值类型；api 不暴露领域模型、持久化对象或技术类型。
- 【强制】application 可使用 `@Service`、`@Transactional`，实现由 bootstrap 显式注册；领域模块不提供 `@Configuration`。
- 【强制】跨模块只引用对方 api，不引用内部层，也不依赖 bootstrap。
- 【强制】跨模块事件契约在 api 公开，内部 `domain.event` 由 application 转换、发布。
- 【推荐】业务缓存、数据库和外部系统适配归本领域 infrastructure，通用能力复用 shared。

分层允许范围、JDK 包白名单及组件注册约束以[架构规约](../docs/architecture.md)为准。一个领域仅对应一个 Maven 模块，包级边界由 ArchUnit 检查。

## 4. 新增领域模块

从仓库根目录执行，以 `agent` 为例：

```bash
mkdir WuhouCake-agent
cp WuhouCake-sample/pom.xml WuhouCake-sample/README.md WuhouCake-agent/
cp -R WuhouCake-sample/src WuhouCake-agent/
```

按以下顺序调整：

1. 修改 artifactId 为 `WuhouCake-agent`，更新模块描述；parent 的 `relativePath` 保持 `../pom.xml`。
2. 同时将主、测试源码的 `org/xaspire/WuhouCake/sample` 目录改为 `org/xaspire/WuhouCake/agent`。
3. 替换代码中的 `org.xaspire.WuhouCake.sample`，包括包声明、引用及架构测试常量。测试中的 `boundaryfixture` 包用于模拟其他模块，保留其命名。
4. 在根 POM 的 `modules` 中注册 `WuhouCake-agent`，在 bootstrap POM 中增加领域依赖：

```xml
<dependency>
    <groupId>org.xaspire</groupId>
    <artifactId>WuhouCake-agent</artifactId>
    <version>${project.version}</version>
</dependency>
```

5. 实现公开契约、用例、领域规则和技术适配。bootstrap 按需配置 `@Bean`、`@Import`、`@MapperScan`。
6. 需要数据库时，在 `src/main/resources/db/migration` 创建迁移，使用仓库级唯一递增版本。
7. 验证新模块及全工程：

```bash
./mvnw -pl WuhouCake-agent -am clean verify
./mvnw clean verify
```

复制范围为源码、POM 和说明文件，不包含 `target` 等构建目录。模板可参与构建；增加运行能力后，再补相应组合根装配。

## 5. 测试职责

| 测试 | 范围 |
| --- | --- |
| `ModuleArchitectureTest` | 本模块领域纯净、内部层方向、API 类型及跨模块边界 |
| `ModuleArchitectureRulesTest` | 验证合法依赖通过、违规依赖被拒绝 |
| `integration` 包 | 实际领域开发后的基础设施测试 |

空层通过可选层和 `allowEmptyShould(true)` 处理，规则与验证夹具随模板复制。夹具仅位于 test，不进入运行 JAR。

从根目录执行 `./mvnw -pl WuhouCake-sample -am clean verify`，无需外部服务。涉及完整应用启动的测试放在 bootstrap，避免领域模块依赖 bootstrap；当前执行命令与验证边界见[验证入口](../frontend/verification.md#验证入口)。
