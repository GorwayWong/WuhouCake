# SSE 正常断开修复验证

日期：2026-10-16。基线 d63d59505ba769610fbf8f8c7453c447a58efb3d，分支 codex/c2-c1a-order-images，初始工作区干净。本次修复未提交、推送、合并或部署。

## 结论与根因

原核心审计 F2/P2 已修复。Servlet 在流写入失败、客户端离开或异步响应结束后，会通过最终 ASYNC dispatch 进入异常解析器。ApiErrors 的通用 Exception 处理抢先捕获 AsyncRequestNotUsableException，记录 request_failed ERROR 后返回 ApiResponse；SSE 上再次尝试 JSON 转换，继而产生 HttpMessageNotWritableException。

生产改动仅在 [ApiErrors](../../WuhouCake-bootstrap/src/main/java/org/xaspire/WuhouCake/bootstrap/security/ApiErrors.java)：

- 异步或已提交响应使用现有 Spring DisconnectedClientHelper 识别已断开的连接；只记 requestId/failureType 的 DEBUG 事件，返回已处理，不启动消息转换，不输出异常正文。
- 不把所有 IOException 当成断连。异步处理前的本地 EOF 仍为真实故障；Spring 的分类排除上游 RestClient 等异常，避免把上游 Broken pipe 当成浏览器退出。
- 真正的未知服务端故障保留 ERROR。已经提交的响应不尝试写 JSON；尚未提交时明确返回 500 application/json，保留原错误码与 no-store。

没有修改日志级别配置来隐藏故障，没有新依赖、表或迁移。OrderStreams 的 I/O 失败清理和容器负责完成请求的行为保持；帧格式、心跳、连接寿命、身份撤销及前端逻辑未改。

## 自动回归证据

新增 [ApiErrorsTest](../../WuhouCake-bootstrap/src/test/java/org/xaspire/WuhouCake/bootstrap/security/ApiErrorsTest.java) 共 10 个 MVC 用例，使用真实异常解析及消息转换链。修复生产代码前运行结果为 5 failures、4 errors、1 pass；修复后 10/10 通过。测试转换器在旧实现中检测到正常断连后尝试转换 ApiResponse，修复后该计数为 0。

| 场景 | 实际断言 | 结果 |
| --- | --- | --- |
| 异步响应结束、Broken pipe、包装的连接重置、EOF | 保持原 SSE 内容、没有 JSON 转换尝试、没有 ERROR；仅一条关联 DEBUG | PASS，4 例 |
| 首次 flush 前异步响应已不可用 | 不写错误正文，不进行 JSON 转换，不记录 ERROR | PASS |
| 已发送 ready 后程序故障、本地 I/O 故障、上游 Broken pipe | 仍记 ERROR，不改写已提交的 SSE | PASS，3 例 |
| 尚未发送 ready 的真正异步故障 | 即使原请求协商 SSE，也返回 500 JSON/INTERNAL_ERROR | PASS |
| 普通请求中的本地文件 EOF | 不吞掉故障，返回 500 JSON 并记录 ERROR | PASS |

在现有 [OrderExportIT](../../WuhouCake-bootstrap/src/test/java/org/xaspire/WuhouCake/bootstrap/OrderExportIT.java) 增加 clientDisconnectCompletesTheSseWithoutErrorLogOrJsonAndOtherClientsKeepWorking 两个参数化实例：

1. 使用真实 Socket 和合成员工令牌订阅，读取 ready 后分别正常关闭 TCP（FIN）或设置 SO_LINGER=0 产生 RST。
2. 管理员的独立流保持；通过各自独立的正常备注触发网络写入检测，等待 Servlet 完成回调。每个备注为不同内容，按实际提交次数核对活动数量，没有重复重试业务请求。
3. 捕获真实日志并按流的 requestId 断言 DEBUG 断连事件、没有对应 ERROR，也没有 HttpMessageNotWritableException；管理员流仍收到正确帧。
4. 注入真实服务方法故障，验证 500/INTERNAL_ERROR 和 ERROR 仍存在，失败事务不新增活动。

FIN/RST 两例在最终完整运行中分别耗时 1.501/1.480 秒，包含账号准备、多个 HTTP 请求和断开回调，并非单独断连延迟。成功依赖帧内容、完成闩锁和数据库结果；没有固定等待作为成功依据。TCP 断开只能在内核或下一次写入报告后被应用观察，未改变原心跳检测策略。

## 执行环境与命令

macOS，JDK 25.0.4，编译目标 Java 21。专用 PostgreSQL 17（127.0.0.1:15436，wuhou_sse_disconnect_20261016）及 Redis 7（16383）；各集成类再使用随机 schema/命名空间。全部账号、客户和订单为合成数据，没有写原开发库或生产库。模型关闭、DASHSCOPE_API_KEY 为空，没有第三方请求。

~~~sh
export SPRING_DATASOURCE_URL=jdbc:postgresql://127.0.0.1:15436/wuhou_sse_disconnect_20261016
export SPRING_DATASOURCE_USERNAME=wuhoucake
export SPRING_DATASOURCE_PASSWORD=synthetic_disconnect_pg_only
export SPRING_DATA_REDIS_HOST=127.0.0.1
export SPRING_DATA_REDIS_PORT=16383
export SPRING_DATA_REDIS_PASSWORD=synthetic_disconnect_redis_only
export RECOGNITION_ASSIST_ENABLED=false
export DASHSCOPE_API_KEY=
rtk proxy ./mvnw -Pintegration -pl WuhouCake-bootstrap -am -Dit.test=OrderIT,OrderExportIT,IdentityIT,InfrastructureIT -Dfailsafe.failIfNoSpecifiedTests=false verify -q
~~~

最终退出码 0：常规与 ArchUnit 检查 248 项、集成 68 项，failures/errors/skipped 均为 0。集成包括 OrderIT 27、OrderExportIT 24、IdentityIT 12、InfrastructureIT 5；上一轮四项撤销/回滚回归保持通过。OrderExportIT 输出中 request_failed/AsyncRequestNotUsableException 为 0，HttpMessageNotWritableException 为 0；故障对照的 ERROR 是预期诊断。

修复前后 XML 和最终集成证据保存在 /private/tmp/wuhou-sse-disconnect-20261016，不作为长期 CI 产物；长期复现以仓库测试为准。没有重复执行前端构建或浏览器测试，因为没有前端改动且本次使用真实网络/容器完成验证。

验收后专用 PostgreSQL/Redis 容器和端口已清理，原开发服务保持运行。git diff --check 通过，暂存区为空；密钥、真实客户数据和构建产物未进入变更。

## 剩余边界

识别遵循项目已安装的 Spring 6.2.19 分类，不承诺把任意未知 I/O 异常视为正常。真正服务端错误发生在 SSE 已提交后无法改成 HTTP 500，保留 ERROR 诊断而不污染原流。正常断开前已经发送的字节无法撤回。

本次未测试生产代理/TLS、HTTP/2、真实手机或长期网络压测，原核心审计其他 GAP/NOT RUN/F3 不自动变为通过。F2 可关闭；这不是对整个生产环境重新准入的结论。

实现依据：Context7 核对的 [Spring MVC 异步/SSE 生命周期](https://docs.spring.io/spring-framework/reference/6.2/web/webmvc/mvc-ann-async.html)，以及官方 [DisconnectedClientHelper](https://docs.spring.io/spring-framework/docs/6.2.x/javadoc-api/org/springframework/web/util/DisconnectedClientHelper.html) 和 [AsyncRequestNotUsableException](https://docs.spring.io/spring-framework/docs/6.2.x/javadoc-api/org/springframework/web/context/request/async/AsyncRequestNotUsableException.html)。
