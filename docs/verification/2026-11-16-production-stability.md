# 午逅工作台生产稳定性整改

源码基线为 `bfe6ccc68145935e10f7ecc59acb99e9d1f232b7`，工作分支为 `codex/fix-employee-access-ux`。GitHub 分支已通过连接器核实。以下配置和验证均针对本地候选版本，部署端以发布时的实际环境核对为准。

## 整改与验证范围

| 项目 | 影响与实现 | 回归入口 |
| --- | --- | --- |
| P0-1 Worker 内存 | 320 MiB 容器内压低监督 JVM 的堆外上限和两个 JVM 的线程栈。解码前按像素位深和采样栅格估算内存，占用较高时提高降采样率。保留透明度、输出尺寸及 EXIF 方向。 | `ImageWorkerTest`，`worker-budget-probe.py` |
| P0-2 Worker 恢复 | 单图启动独立子进程，异常退出和磁盘写失败释放配额。子进程强杀后两秒仍未退出或临时文件不能清理时，监督进程退出并由容器恢复。启动检查临时目录，运行健康检查与 app 的启动解耦。 | 子进程超时、崩溃、OOM、模拟强杀失败、临时盘写满和上传时容器重启 |
| P0-3 / P1-5 主应用及 HTTP | 两套生产 Compose 都配置 app 的内存、CPU 和 PID 上限。生产 profile 限制 Tomcat 线程、队列、连接、请求头、参数和 part 数。Caddy 限制请求读取及连接等待，应用仍以 Servlet Multipart 限制文件和请求体。 | Compose 与 Caddy 解析、Java 验证、容器启动检查 |
| P0-4 / P0-6 套餐与核心隔离 | Multipart 解析前对套餐、订单上传分别准入，一类最多 1 个请求。套餐超额立即拒绝，订单入口保留两个等待位，每个最多等 2 秒。远端客户端和解码端均只接受 1 个解码任务。套餐按剩余总期限逐张解码，完成后才开始版本校验、图片、套餐及审计事务。 | `ImageUploadAdmissionTest`，`OrderPackageIT`，`ImageWorkerTest` |
| P0-5 上传复制 | Servlet 按验证过的 part 大小读入单个数组。请求分开发布协议头和图片，监督进程直接从临时文件发送响应。响应订阅器逐块计数，超限即取消。JDBC、指纹和解码仍需有界数组。 | `ImageWorkerTest`，`OrderPackageIT`，订单图片集成用例 |
| P1-1 / P1-2 下载及存储 | 订单与套餐原图下载共享 2 个入口配额。前端接近视口才发起预览读取，浏览器同时最多读取 2 张，待处理最多 32 个，卸载取消并释放 Blob URL。权限校验仍在 API；BYTEA 方案与迁移条件见下文。 | `FileDownloadAdmissionTest`，`images.test.ts`，订单图片与套餐权限集成用例 |
| P1-3 导出 | 所有订单 XLSX、ZIP 和经营报表共用 1 个入口配额，持有到下载或异常清理结束。订单图片快照与生成分开，经营报表查询事务内固定数据，事务外用 SXSSF 分批写行。带图订单表保留 XSSF 绘图及打印行为并限制单个工作簿的图片总量。 | `OrderExportServiceTest`，`OrderFilesTest`，`PoiOrderReportFilesTest`，`OrderExportIT`，`WorkflowManagementIT` |
| P1-4 数据库 | 生产 Hikari 默认 5 个连接，空闲保留 1 个。JDBC、锁、语句和事务各设期限。IP 部署 PostgreSQL 已配置 `max_connections=40`。现有订单日期、活动、图片和套餐更新时间索引保留。 | 40 连接的专用 PostgreSQL 集成测试、登录和订单事务测试 |
| P1-6 SSE | 全局 24、单账号 3，保留 JWT 限制、5 分钟生命周期、心跳和权限撤销。发送用 2 个平台线程及有界待发送任务队列。单连接堆积至 64 个待发事件时注销，延后在途写入的物理结束。 | `OrderStreamsTest`，`OrderStreamWebTest`，真实 SSE 集成用例 |
| P1-7 / P1-8 异常和指标 | 可恢复拒绝使用稳定 HTTP 业务码，异常响应保持现有错误格式。监控使用 Actuator、Worker 指标与 Docker/PG 运行时数据。 | Web 错误码、文件关闭、Worker 探针、生产配置启动检查 |

本轮新增单工作簿 24 MiB 嵌图上限。较大的单张订单可能返回 `413 EXPORT_FILE_TOO_LARGE`，数据可继续在工作台查看。图片输出仍为经过验证和缩放的 JPEG/PNG。同键重试继续依赖原指纹和事务，首次返回的时间精度对齐 PostgreSQL 的微秒精度。版本号防止套餐更新覆盖另一员工的修改。请求中断后的套餐更新由客户端重新读取版本及图片引用核对，保留现有恢复行为。

## 资源预算

服务器规格参考仓库记载的 2 核约 1.6 GiB；本轮未连接生产服务器。CPU 配额限制单容器突发，两个容器额度不能相加当作宿主机的实际吞吐量。

| 边界 | 预算 | 耗尽时的处理 |
| --- | --- | --- |
| app 容器 | 640 MiB、1.5 CPU、160 PIDs | 活动文件任务和 Web 连接较早触发限额。JVM OOM 时退出。 |
| app JVM | 堆 256、Metaspace 136、Direct 24、Code Cache 48 MiB；栈配置 512 KiB | 四项显式上限合计 464 MiB。余下 176 MiB 用于栈、GC/JIT、class space 管理、线程和共享库等本地开销；按 PID 上限估算栈 80 MiB 后余 96 MiB。512 KiB 为 Java 栈配置，其他原生线程的栈与驻留内存由平台决定。 |
| Worker 监督 JVM | 堆 24、Metaspace 24、Direct 4、Code Cache 8 MiB | 最多 4 个请求线程、4 个排队任务、12 个 HTTP 连接，一个活跃解码。 |
| 解码 JVM | 堆 128、Metaspace 32、Direct 8、Code Cache 16 MiB | 一个独立子进程，10 秒墙钟处理窗口。栅格估算上限 48 MiB，保留编码、方向变换和缩放空间。 |
| Worker 容器 | 两 JVM 显式上限合计 244 MiB，加 16 MiB tmpfs 后余 60 MiB；1 CPU、64 PIDs | 两 JVM 用 Serial GC、512 KiB Java 栈和 2 个编译线程。剩余 60 MiB 为栈、GC/JIT、libjpeg/zlib、运行时和其他本地开销预留。cgroup 实测另见下文。 |
| 网关 / Tomcat | Caddy 读头 5 秒、读 body 30 秒、回源连接 2 秒、响应头 90 秒。Tomcat 24 线程、队列 32、96 连接、accept 24、连接 I/O 超时 10 秒。 | 慢连接在网关或 Tomcat 到期，满载后拒绝或断开。请求头 12 KiB、参数 96、part 20、单个 part 头 1 KiB。Form POST 解析限制是 128 KiB，Multipart 有独立配额。 |
| Multipart | 单文件 5 MiB，请求 65 MiB；最多两个活跃请求，暂存文件合计最多约 130 MiB | 请求上限为 64 MiB 图片总量保留 1 MiB 协议和 JSON 清单空间。套餐最多 16 张，处理后总量 32 MiB，处理期限 30 秒。 |
| 文件下载 | 图片 2；导出 1；生成 45 秒，订单文件传输另限 30 秒 | 入口竞争立即返回 503。导出超时由处理阶段检查与 I/O 限制共同执行，正在进行的同步写最多额外受一次底层 I/O 等待影响。 |
| app 临时文件 | 容器私有磁盘目录 `/tmp/wuhoucake-app`。ZIP 任务最多 256 MiB 图片暂存和 256 MiB 输出，XLSX 单文件 64 MiB。报表 SXSSF 临时 XML 压缩，输出最多 24 MiB。 | 业务代码限制活动文件，容器启动清理私有临时目录。需要宿主机 Docker 数据盘至少为 app 的约 642 MiB 活动暂存、POI 开销和历史日志预留空间。文件级限制不提供跨容器的物理磁盘配额。 |
| Hikari / PostgreSQL | 单 app 5 连接，获取 1.5 秒，校验 1 秒；PG 连接 2 秒、读 15 秒、锁等待 2 秒、语句 10 秒。普通事务默认 15 秒，导出快照 20 秒。 | PostgreSQL 40 连接仍需预留迁移、备份及维护连接。多个 app 实例按总池容量核算。独立环境 Compose 未指定 PostgreSQL 容量，发布时核验。 |
| Redis | 连接 2 秒，命令 2 秒，生产连接命令队列最多 64；IP Compose Redis 96 MiB，数据上限 48 MiB | 依赖 Redis 的登录节流、客户提交限流按现有业务保守失败，断开时拒绝新命令，连接恢复后不会重放先前在途命令。Redis 恢复后可重新执行原操作。 |
| SSE | 24 全局、3 每账号；最多 2 个发送线程、24 个待调度任务、每连接最多 64 帧 | 慢消费者清理，浏览器按现有重连逻辑恢复，身份复验失败时关闭连接。 |

对已提交但响应丢失的上传使用原幂等键恢复。当前请求没有应用层自动写入重试。过载后可按 `Retry-After` 重试已知幂等操作；校验、权限和版本冲突先由调用方处理。Redis、数据库故障期间依赖它们的业务会返回错误，图片及导出的配额保护的是其余可用资源。

## PostgreSQL BYTEA 和对象存储

当前单图 5 MiB，下载限制为 2 个并发。PostgreSQL 仍把 BYTEA 结果物化到 JDBC 内存，图片内容和业务元数据共用事务。WAL、TOAST 膨胀、复制、逻辑备份和恢复窗口均随图片增长。先用 `pg_total_relation_size`、备份体积和恢复时间记录规模趋势；导出快照仍按订单和图片读取，多订单、数百张图片的查询数以及 N+1 成本须结合实测继续评估。现有 OFFSET 深分页及子串搜索的成本也依赖真实数据，需查看慢查询和执行计划。

现阶段保留 BYTEA，同时保留 `OrderImages`、`OrderPackages` 和 `OrderImageValidator` 边界。当前预览和放大共用已缩放的业务图。将来出现实际流量和磁盘压力时，可以让同一授权接口提供低分辨率预览，现有文件 ID 继续指向业务图。

S3 或受管 S3-compatible 存储能分离数据库备份与图片容量，但增加对象访问、生命周期和跨系统失败处理。自管 MinIO 还需独立容量、监控和备份；在当前主机上启用会与现有服务争用资源。若迁移，由服务端生成每次尝试的不可变对象键，创建 Pending 元数据并颁发短期上传凭证。校验长度、签名、完整性及版本后进入 Validated，只在元数据事务提交后变成 Active。上传暂存和已验证产物使用不同的私有键，防止仍有效的原上传 URL 覆盖可见版本。回读先校验业务权限再代理或发短期签名 URL。为待处理、孤儿对象和软删除版本设过期清理；清理前再次检查有效引用。历史图片可批量校验和回填，切换期支持双读；回滚先切回 BYTEA 读取并保留回填源。跨对象和数据库的重试由状态机、唯一键和有界重试保证。 [Amazon S3 预签名 URL](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) · [MinIO 项目](https://github.com/minio/minio)

## 观测与复现

- 从 app 容器回环地址采集 `/actuator/metrics`。查看 `jvm.*`、`process.*`、`tomcat.*`、`hikaricp.*`、`disk.free` 和 `http.server.requests`。HTTP 按明确路由和状态聚合，查看 P95/P99、图片上传与套餐响应成功率、导出成功率和耗时。自定义指标为 `wuhou.uploads.*`、`wuhou.files.*`、`wuhou.sse.*`。公网网关仅代理 `/api/*`。
- 在私有网络采集 Worker `/metrics`。可查看活跃任务、准入、成功、失败、拒绝、超时、子进程异常退出、耗时总量、清理失败和临时盘空闲空间；计数在容器重启时重置。Worker 和 app 日志保留清理异常类型，可结合容器重启时间和 HTTP 错误定位。
- 宿主机采集 `docker stats --no-stream`、`docker inspect` 的 `State.OOMKilled` 和 `RestartCount`，以及 cgroup v2 的 `memory.events`、`memory.peak`、`pids.current`。按容器查看 app 私有临时目录用量与宿主磁盘空闲。PostgreSQL 用 `pg_stat_activity`、`pg_locks` 观测连接和锁等待；线上慢查询日志采样及保留周期由运维依据数据保护要求配置。

```sh
./mvnw --batch-mode --no-transfer-progress verify
# 指向专用 PostgreSQL 与 Redis，连接参数见 docs/testing.md
./mvnw --batch-mode --no-transfer-progress -Pintegration verify
npm --prefix frontend test
npm --prefix frontend run build
python3 docs/verification/worker-budget-probe.py WuhouCake-bootstrap/target/WuhouCake-bootstrap-0.1.0-SNAPSHOT.jar
```

Worker 探针用本地已有 Temurin 镜像和构建产物复现 Compose 参数。用合成 PNG 测量峰值、并发拒绝、tmpfs 充满和上传中重启，然后清理专用容器。主应用配置另以本地 Docker 隔离网络和合成账号验证。部署前仍需用生产同型号主机、真实网络条件和脱敏的图片与导出规模做混合压测，并校验 app PID、GC、PostgreSQL 锁等待、Caddy 上传期限和磁盘裕量。

## 验收结果

| 命令 | 结果 |
| --- | --- |
| `./mvnw --batch-mode --no-transfer-progress verify` | 424 项单元、Web 和 ArchUnit 测试通过，0 失败、0 错误、0 跳过。 |
| `./mvnw --batch-mode --no-transfer-progress -Pintegration verify` | 424 项常规测试和 178 项集成测试通过，0 失败、0 错误、0 跳过，使用专用 PostgreSQL 17 和 Redis 7。 |
| `npm --prefix frontend test` | 212 项通过，0 失败、0 跳过，复用已安装依赖。 |
| `npm --prefix frontend run build` | TypeScript 与 Vite 通过。Vite 仍报告大于 500 KiB 的 bundle。 |
| `docker compose ... config --quiet`、`caddy adapt` | 两套生产 Compose 与 Caddy 2.10.2 解析通过。 |
| `docker build --platform linux/amd64 -t wuhou-app:stability-local WuhouCake-bootstrap` | 本地候选镜像构建通过。容器探针使用同批构建产物与相同 Temurin 基础镜像。 |

- Worker 可复现探针通过 4 种 PNG，包括 2400 万像素 8 位透明 PNG 和 3838×3838 的 16 位透明 PNG。峰值为 207,745,024 字节，约 198.1 MiB，容器上限 320 MiB，cgroup OOM 与 OOM kill 均为 0。3 个并发请求快速拒绝，请求队列达到上限，16 MiB tmpfs 写满后恢复，上传中重启后恢复。真实 JVM 子进程 OOM/超时/崩溃以及模拟不可强杀路径由 Java 测试覆盖。
- 本地生产 profile 在 Worker 未启动时通过登录、订单查询、新建、付款、制作状态和备注、无图套餐保存。有图套餐约 0.21 秒返回 503，Worker 启动后使用相同提交键成功保存，重复提交返回相同结果。
- 16 张合成图片共 64 MiB 的实际 Multipart 保存约 16.97 秒通过，同期重叠套餐请求立即得到 503，订单查询成功。中断另一 Multipart 的请求体后核对创建键无落库记录，入口配额恢复。该样本的绝大部分字节来自可去除的 PNG 元数据，用于验证传输、暂存和批量上限。
- PostgreSQL 对账号表持排他锁时，10 个并发请求耗尽连接池并在期限内得到 503。释放锁后读取恢复。Redis 和 PostgreSQL 分别短暂停止时得到 503，恢复后登录与认证读取继续成功。Tomcat 达 24 个请求线程时，排队的普通读取在慢请求连接关闭后恢复。主应用此轮故障探针的 cgroup 峰值约 524.4 MiB，640 MiB 限额内，OOM 与 OOM kill 均为 0。
- 导出端覆盖并发拒绝、工作簿与 ZIP 大小限制、超时和 Servlet 响应写失败清理。图像快照测试保留生成期间被删除的原图，后续新导出反映删除后的状态。

本地 Docker 为 arm64 主机上的 linux/amd64 镜像，数据均为合成。真实门店网络吞吐量、长时间混合负载、实际宿主磁盘配额和 PID 裕量仍需部署环境核验。

## 参考与取舍

- 图片文件保留类型签名校验、归一化和有界解码。采用 JDK 进程隔离及无等待信号量，未增加 Resilience4j 运行依赖。 [OWASP File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) · [Resilience4j](https://github.com/resilience4j/resilience4j)
- 使用 Spring Boot 原生 Multipart、Actuator 和 Micrometer，按 Tomcat 连接及线程行为配置；Caddy 和 Docker 提供网络与容器级边界。 [Spring Boot 3.5 配置](https://docs.spring.io/spring-boot/3.5/appendix/application-properties/index.html) · [Tomcat HTTP Connector](https://tomcat.apache.org/tomcat-10.1-doc/config/http.html) · [Docker Compose](https://docs.docker.com/reference/compose-file/services/) · [Caddy timeouts](https://caddyserver.com/docs/caddyfile/options#timeouts) · [Micrometer JVM 指标](https://docs.micrometer.io/micrometer/reference/reference/jvm.html)
- 经营报表采用 SXSSF 的 64 行窗口及压缩临时文件，订单导出保留 XSSF 图像布局，单工作簿靠图片字节预检控制驻留。 [Apache POI SXSSF](https://poi.apache.org/components/spreadsheet/how-to.html#sxssf)
- 先确认分支和仓库规约，然后按风险拆分验证，采用代码测试、真实子进程和隔离容器进行回归。 [Codex 实践指南](https://developers.openai.com/codex/learn/best-practices/)

## 文件与发布

- `ImageWorkerServer`、`ImageWorkerProtocol`、`RemoteOrderImageValidator`、`JavaOrderImageValidator` 负责进程恢复、协议边界和解码预算。
- `ImageUploadAdmissionFilter`、`FileDownloadAdmissionFilter`、`WebSupport`、两个文件控制器、`OrderImageService` 和 `OrderPackageService` 负责 HTTP 准入、读取、批次时限与事务衔接。
- `OrderExportService`、`OrderExportSnapshotService`、`OrderManagementService` 和两个 POI 实现负责导出期限、事务边界、尺寸和文件清理。
- `OrderStreams`、`OrderWebComposition`、`SecurityConfiguration`、`ApiErrors` 和 Spring profile 分别负责 SSE、指标权限、错误映射和运行时配置。前端预览与读取变更在 `OrderImages.tsx`、`OrderPackageAdmin.tsx`、`imagePreview.ts` 和 `api.ts`。
- Dockerfile、两套 Compose、Caddy 和生产 env 示例随发布一起变更。数据库没有新增迁移，二进制协议仍为版本 1。单 app 实例重建时会有短暂业务中断，Worker 单独重建期间无图业务可继续。回滚使用配套旧镜像与旧配置，无需恢复数据库。

依赖核对来自本地构建产物：Java 21、Spring Boot 3.5.16、Tomcat 10.1.55、HikariCP 6.3.3、PostgreSQL JDBC 42.7.11、Flyway 11.20.3、MyBatis-Plus 3.5.17、POI 5.5.1、Micrometer 1.15.12。Docker 验证使用本机 PostgreSQL 17.11、Redis 7 系列、Caddy 2.10.2。生产 Compose 镜像标签未锁定补丁版本时，实际版本以发布镜像为准。

## Git 状态

工作区共 52 个变更文件，暂存区为空。HEAD 与远端分支均为 `bfe6ccc68145935e10f7ecc59acb99e9d1f232b7`。整改保留在 `codex/fix-employee-access-ux` 的本地工作区。未提交、未推送、未部署。
