# SSE 会话撤销修复验证

后续状态：本文记录撤销修复时的结果；当时范围外的正常断开日志问题 F2 随后也已修复，见 [SSE 正常断开验证](2026-10-16-sse-disconnect.md)。本文的 238/66 测试数量为原验证记录。

日期：2026-10-16。基线 635d4f545c1e8fd8abacb9677ab4c049c6acb384，分支 codex/c2-c1a-order-images，初始工作区干净。修复留在工作区，未提交、推送、合并或部署。

## 结果

原来的两个 revokedEmployeeStreamMustStopReceivingOrderEvents 参数化回归均已通过。密码重置和归档成功返回后，同一员工两个独立会话的旧 SSE 都在没有新订单事件触发的情况下结束；管理员的正常连接继续收到订单事件。旧 REST、refresh 仍返回 401。

最终常规检查 238 项通过（包含 ArchUnit），真实集成 66 项通过，失败、错误、跳过均为 0。可关闭原[核心审计](2026-10-16-core-uat.md)的 F1/P1。本次没有重新执行全部浏览器 UAT；原报告的其他 GAP、NOT RUN、F2/F3 继续保留。

## 根因与修复

原 OrderStreamController 只将 JWT 到期时间交给 OrderStreams。连接没有保留身份校验条件，广播只检查到期时间；账号凭证版本变化只能拒绝后续 REST 请求，无法撤销已有流。

- IdentityFacade 新增公开 CredentialsRevoked(accountId, credentialVersion) 契约；IdentityService 在密码变更、重置、归档及管理员恢复的同一事务内发布新凭证版本。OrderStreams 通过 AFTER_COMMIT 处理，避免事务回滚时误断连接。
- SSE 绑定账号、凭证版本和包含 sessionId 的身份复验函数；注册、ready、每个订单帧和心跳发送前复用 authenticate。账号撤销、会话缺失或验证不可用时关闭，清空队列并取消到期任务。
- 撤销通知只关闭该账号较旧版本的连接，保留同账号新版本及其他员工的流。先注册后复验，覆盖安全过滤器验证通过后才发生撤销的注册竞态。
- 独立发送锁使撤销与在途发送串行完成。排队事件不能在撤销后继续发送；普通到期、错误和队列溢出清理不等待新增的撤销屏障，保留原有故障隔离行为。

没有新增基础设施、依赖、表或迁移；SSE 路径、ready/order.changed 帧结构、15 秒心跳、5 分钟最长连接和前端重连协议保持。撤销事件不写订单活动，现有身份审计保持。

## 环境与隔离

macOS，JDK 25.0.4（编译目标 Java 21）。专用 PostgreSQL 17 容器 wuhou-sse-pg-20261016、端口 15435、数据库 wuhou_sse_20261016；Redis 7 容器 wuhou-sse-redis-20261016、端口 16382。每个集成类另外创建随机 schema 和 Redis 命名空间，测试后清理；账号、订单全部合成。没有写入原有开发库或生产库。

模型识别开关为 false，DASHSCOPE_API_KEY 为空，本轮没有第三方模型调用。临时 XML 证据归档在 /private/tmp/wuhou-sse-20261016；源码中的测试是长期可复现依据。

验收后专用容器和监听端口已清理，原有开发 PostgreSQL/Redis 保持运行。git diff --check 通过，暂存区为空。

## 回归矩阵

| 场景 | 断言/证据 | 状态 |
| --- | --- | --- |
| 重置密码、归档的旧连接 | OrderExportIT 原两个回归；每个员工两个独立 session，读取 ready 后撤销，先等待 EOF 再添加新备注；旧凭证 REST/refresh 401 | PASS |
| 其他员工正常连接 | 同一真实 HTTP 用例中管理员流仍收到正确订单的 order.changed | PASS |
| 撤销在提交时失败 | 新增两个 failedRevocationCommitKeepsTheOriginalSessionAndStream；PostgreSQL 延迟约束在 commit 时拒绝版本更新，接口 503、账号及审计保持、旧流仍收到后续备注事件 | PASS |
| 已排队事件与多连接 | OrderStreamsTest 保留发送任务，撤销后才执行；两个旧流仅收到 ready，新版本和其他账号收到变更 | PASS |
| 发送中的撤销 | 用闩锁阻塞在途发送，确认撤销等待，释放后关闭；后续排队帧及新帧均不发送 | PASS |
| 注册竞态 | 撤销发生在注册后复验期间，连接拒绝且不发送 ready；WebMvc 覆盖安全过滤器通过后身份失效 | PASS |
| 通知遗漏/验证失败 | 队列出队前身份变为无效或抛异常，即使没有撤销通知也关闭；无订单时心跳复验关闭 | PASS |
| 提交、回滚及提交异常 | OrderStreamTransactionsTest 验证撤销仅在成功提交后执行；回滚和 commit 异常不关闭，仍能收到后续业务通知 | PASS |
| 队列溢出与资源清理 | 在途发送被闩锁阻塞时，溢出不等待新增的撤销锁；关闭、取消到期任务、正常生命周期和发送失败隔离均保留 | PASS |
| 原有身份与订单链路 | IdentityIT 12、OrderIT 27、OrderExportIT 22、InfrastructureIT 5，全绿 | PASS |

## 命令与数量

在仓库根目录设置上述隔离数据库/Redis 环境变量及合成密码，显式关闭模型：

~~~sh
export SPRING_DATASOURCE_URL=jdbc:postgresql://127.0.0.1:15435/wuhou_sse_20261016
export SPRING_DATASOURCE_USERNAME=wuhoucake
export SPRING_DATASOURCE_PASSWORD=synthetic_sse_pg_only
export SPRING_DATA_REDIS_HOST=127.0.0.1
export SPRING_DATA_REDIS_PORT=16382
export SPRING_DATA_REDIS_PASSWORD=synthetic_sse_redis_only
export RECOGNITION_ASSIST_ENABLED=false
export DASHSCOPE_API_KEY=
rtk proxy ./mvnw -Pintegration -pl WuhouCake-bootstrap -am -Dit.test=OrderIT,OrderExportIT,IdentityIT,InfrastructureIT -Dfailsafe.failIfNoSpecifiedTests=false verify -q
~~~

退出码 0。最终 Surefire：238 tests、0 failures、0 errors、0 skipped；Failsafe：66 tests、0 failures、0 errors、0 skipped。原两个回归在最终完整运行中分别耗时 0.942/0.508 秒（包含账号初始化、多个 HTTP 操作及 EOF 验证，不是断连延迟测量）；新增两个提交失败回归各约 0.507 秒。

针对性执行也通过：-Dit.test=OrderExportIT#revokedEmployeeStreamMustStopReceivingOrderEvents+failedRevocationCommitKeepsTheOriginalSessionAndStream，共 4 个参数化实例。没有用固定等待代替成功状态；使用 EOF、帧内容、数据库断言、闩锁及有截止时间的 future。

## 边界与剩余风险

应用层保证同进程撤销成功返回后不再开始旧连接的新发送；已经发送到网络的字节无法撤回。通知沿用现有单后端实例约定；跨进程/外部命令变更由逐帧复验阻止后续事件，空闲流在下一次心跳检查关闭，不提供跨实例的即时断连广播。

每个 ready/订单帧/心跳多一次既有 Redis/数据库身份校验；本次未做容量或慢速真实网络压测。未验证生产反向代理、真实 TLS、JDK 21 运行时、真实移动设备或整套浏览器 UAT。原 P2 正常断连日志噪音及 P3 历史文档链接缺口不属于本次修复。试用准入仍需结合原审计剩余风险；本次结论仅关闭 SSE 撤销的已知 P1 阻塞。

实现参考：通过 Context7 核对 Spring 6.2 [事务事件](https://docs.spring.io/spring-framework/reference/6.2/data-access/transaction/event.html)及 [SSE/异步 MVC 生命周期](https://docs.spring.io/spring-framework/reference/6.2/web/webmvc/mvc-ann-async.html)。
