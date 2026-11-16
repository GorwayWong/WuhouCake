# 2026-11-16 午逅生产稳定性后续验收

基线为 GitHub `main` 的 `f4e25d6eb2120309cdefc155b00d417229e6a99a`，已包含 `8843875179cd1da46bd24e3c3dfd72cf4c4e8924`。在干净工作区基于该提交创建 `codex/stability-hardening-followup`。验收只使用本地代码、隔离 PostgreSQL/Redis、合成 HTTP 请求和合成证书。

## 缺陷与回归

| 范围 | 修改前 | 修改后与文件 | 回归 |
| --- | --- | --- | --- |
| P0-1 PostgreSQL、Redis | 标准生产环境缺少数据库和缓存资源上限 | `docker-compose-environment.yml` 与 `docker-compose-ip.yml` 采用相同预算。开发覆盖文件保留独立默认值。env 示例列出可调变量 | `test-resource-config.py` 展开四组配置。隔离 Compose 验证 PostgreSQL 实际参数、Redis maxmemory/noeviction/AOF 以及重启后恢复合成键 |
| P0-2 订单容量 | 每商品限 5 张，整单图片和商品无上限 | `OrderFileLimits`、`OrderImageService`、`OrderImages` 及 PostgreSQL 适配器在原订单行锁内检查 40 张有效图和累计 32 MiB。已有幂等查找在容量校验之前。聚合创建和追加共用 100 项限制。API 和前端映射拒绝原因 | `OrderTest`、`OrderExportIT`、`images.test.ts`。覆盖 100/101、40/41、正好 32 MiB 和超 1 字节、软删、重试和冲突。通过真实行锁使两个事务争用最后容量，两图仅存一图 |
| P0-3 Multipart 与准入顺序 | 订单与套餐共用 65 MiB，额外 Part 可被忽略，两个准入过滤器都位于 Security 之前 | `ImageUploadAdmissionFilter`、`FileDownloadAdmissionFilter` 及 `WebSupport` 在 Spring Security 完成后、Spring MVC 解析前执行。`UploadMultipartFilter` 对真实流计量，解析时限制 Part、缓冲、文件数和大小。`Caddyfile.ip` 使用相同路由正文上限 | `OrderExportIT` 额外文件、chunked、回环指标访问和下载准入。`OrderPackageIT` 16 图、超大 JSON、401/403/503 和释放准入。Caddy 2.10.2 实际验证已知长度、chunked 413、套餐允许相同大小及公网指标路径 404 |
| P1-1 应用临时盘 | 上传和导出写入容器可写层，共享磁盘无硬上限 | `ScratchSpace`、两个准入过滤器、`Dockerfile` 和两组生产 Compose 增加独立盘、进程独占、预算预留、按期限清扫和指标。POI 使用 JVM 同盘目录。[宿主机检查](../dev-ops/compose/check-app-scratch.sh)要求专用 ext4/XFS 文件系统 | `ScratchSpaceTest` 验证边界、异常释放、所有者互斥、孤儿期限和任务保护。`OrderFilesTest` 用不可删除文件路径验证清理失败保留成功响应。Compose 契约验证两种挂载方式 |
| P1-2 JVM 参数 | 标准 app Compose 的 `JAVA_TOOL_OPTIONS` 可被整串替换 | `docker-compose-app.yml` 固定生产 JVM 参数。两种配置均使用固定 Worker JVM 和解码子进程参数 | 配置测试注入含 `-Xmx900m` 的覆盖值，检查两种 Compose 解析后仍使用原预算 |
| P1-3 套餐批次 | 每张图片单独释放名额，普通上传可插入同一批次 | `OrderImageValidator`、`RemoteOrderImageValidator`、`OrderPackageService` 对需要解码的套餐持有同步批次租约。只重放已有图片的请求仍用指纹校验 | `ImageWorkerTest` 在两图之间确定性验证同批独占、普通和下一批快速 BUSY、超时及 Worker 错误后恢复。`OrderPackageIT` 验证失败无部分提交和同键重放 |
| P1-4 导出 | 元数据和图片复制使用同一个 REPEATABLE READ 事务 | `OrderExportSnapshotService` 只读元数据。 `PoiOrderExportFiles` 每个工作簿单独暂存图片。历史可重压缩图片每次在短事务内校验 `processing_version` 并读取单张，磁盘写入在事务外 | `OrderExportIT` 验证普通读取无事务、滚回时元数据阶段无临时文件、压缩发生在短事务内时保留旧图、压缩先于复制时拒绝整包、缺失图片无下载附件。原权限、工作簿图片、布局和批量内容用例保留 |
| P1-5 监控 | Actuator 指标字典和 Worker 计数存在，缺少标准抓取和告警 | Bootstrap 加 Prometheus Registry，只有容器回环可访问敏感端点。保留 Worker 内网指标，加上传结果、导出计数与超时、临时盘用量及清理失败。外部采集和告警见[生产监控](../dev-ops/monitoring/README.md) | `OrderExportIT` 验证回环采集、非回环伪造转发头仍被拒绝，以及 JVM、Tomcat、Hikari、HTTP 直方图、SSE 和临时盘样本。 `promtool` 解析 8 条告警及采集配置 |

## 资源预算

| 资源 | 默认预算和保护 |
| --- | --- |
| PostgreSQL | 容器 256 MiB、0.75 核、64 PIDs。连接数 24，保留默认 3 个超级用户连接。以 21 个常规连接核算，应用池 5、迁移过渡 2、备份和恢复验证 2、维护和排查 4，仍有 8 个常规位置。正常 Flyway 通过应用数据源复用已有池。64 MiB shared buffers，2 MiB work mem 是每个执行节点的预算，64 MiB temp file limit 是每个 PostgreSQL 进程的约束，均不能视为实例总用量 |
| Redis | 容器 96 MiB、0.35 核、32 PIDs。maxmemory 32 MiB，约 64 MiB 留给 AOF 缓冲、fork 写时复制、分配器和进程开销。noeviction、AOF 和原卷继续使用。已有持久数据超过 32 MiB 时无法保证新登录等写入能立刻成功，部署前检查现存占用 |
| 主应用 JVM | 容器 640 MiB、1.5 核、160 PIDs。堆 256 MiB、Metaspace 136 MiB、Direct 24 MiB、Code Cache 48 MiB，合计 464 MiB 指定上限。还需线程栈、GC/native、临时文件页缓存等开销。栈 512 KiB，可见处理器数 2 |
| Worker JVM | 容器 320 MiB、1 核、64 PIDs。服务 JVM 为 24 MiB 堆、24 MiB Metaspace、4 MiB Direct、8 MiB Code Cache。解码 JVM 为 128 MiB 堆、32 MiB Metaspace、8 MiB Direct、16 MiB Code Cache。两个 JVM 各使用 512 KiB 栈及 1 个可见处理器。独立 16 MiB 临时 tmpfs、单并发、估算解码栅格 48 MiB、Worker 单图 10 秒、远程交换 12 秒、套餐图片准备 30 秒 |
| Tomcat、Hikari | 24 工作线程、32 等待队列、96 连接、24 accept 队列。池默认 5，最小空闲 1，获取连接 5 秒。下载同时 2 张，导出和报表共用 1 个任务名额 |
| 上传与订单存储 | 普通请求 6 MiB、单图 5 MiB、一个 file 和 36 字节 itemId。套餐正文 65 MiB、最多 16 张、图片总计 64 MiB、独立 JSON 256 KiB、处理后图片总计 32 MiB。每类同时解析 1 请求。订单每商品最多 5 张，每单最多 40 张有效图和 32 MiB 保留内容，含已移除图片 |
| 应用临时磁盘 | 独立约 1 GiB ext4/XFS，应用预算 896 MiB，空闲保护 64 MiB。每个导出预留 768 MiB，覆盖 ZIP 256 MiB、每工作簿最多 24 MiB 当前图片快照、临时 XML、POI 包装文件及余量。两类上传预留 6 + 65 MiB，最大同时预留 839 MiB。经营报表使用同一个导出名额，SXSSF 临时 XML 走同一受限盘，另有正文和输出上限 |
| 导出 | 最多 100 单、800 张、ZIP 256 MiB、单本 XLSX 64 MiB，且单本嵌图独立限制 24 MiB。元数据事务超时 20 秒，历史图片短事务 10 秒，每项检查共同的导出 45 秒期限，响应传输检查 30 秒。任何生成失败在发送附件头之前结束 |
| 网关与证书 | Caddy 内存 64 MiB。Certbot 是运维临时任务，内存上限 192 MiB。证书操作与服务并行时应按额外资源重新核算 |

1.6 GiB 约为 1,638 MiB。标准部署四个常驻容器上限合计 1,312 MiB，名义剩余约 326 MiB（19.9%），外置网关或同机监控占用须另算。IP 部署加 Caddy 合计 1,376 MiB，名义剩余约 262 MiB（16.0%）。叠加 Certbot 后名义剩余约 70 MiB（4.3%）。四个业务及数据容器 CPU 配额合计 3.60 核，2 核主机竞争时由调度器分配，不能同时得到这些配额。cgroup 内存是总量上限，宿主机分配器、容器/内核、磁盘页缓存、日志和并发维护都需实际环境数据验证。

## 数据兼容与回滚

没有新增 Flyway 迁移。历史订单及图片可照常读取、修改无关字段并按既有导出预算导出。新商品上限含已软删除的商品，因此反复删除与追加无法增长订单商品记录。图片数量按有效图计，字节使用 PostgreSQL 已约束等于实际 BYTEA 长度的 `size`，含软删除。到期仍使用现有整单 30 天保留及清理机制。孤立软删图片继续保留元数据、幂等记录和二进制，单独释放二进制需要新的业务保留政策。恢复旧应用镜像会放开新写入限制，不涉及数据结构回退。Redis 卷及 AOF 不需要重新初始化。

归档数据在元数据快照后被物理清理，导出会明确失败并清理临时文件。压缩若先于历史图片读取，处理版本不符整包失败。压缩若发生在该图短事务已经开始之后，使用该次短事务看到的旧字节。普通上传的版本 1 图片内容在现有维护命令下不可变，保留的软删除图片仍可从已有快照读取。

## TDD 证据

| 回归输入 | Red | Green |
| --- | --- | --- |
| 展开标准/开发 Compose，注入 JVM 覆盖 | 数据容器缺少 `mem_limit`，旧开发配置套用生产 256 MiB，app 可解析为 `-Xmx900m` | 四组配置通过，旧开发 env 不含新增变量也使用开发预算 |
| 已到 40 图与 32 MiB + 1 字节 | 新图返回 201 | 返回 409，精确边界仍可写 |
| 两笔真实行锁上传竞争剩余一图的字节 | 两者均返回 STORED | 一成一拒，数据库只新增一条图、一条幂等记录、一条活动 |
| 软删后追加第 101 件 | 追加成功 | 聚合拒绝且版本不增长 |
| 普通上传带额外文件 Part | 返回 201 | 返回 400，超限 chunked 返回 413，之后可正常上传 |
| 套餐释放首图后普通请求 | 普通请求插入成功 | 两图之间普通请求和下一批都 BUSY，租约释放后恢复 |
| 元数据事务内复制普通及历史图片 | 普通图的事务断言失败，历史元数据读取已创建磁盘文件 | 普通图连接释放后复制，历史图在受版本保护的单图事务中读取后落盘 |
| 导出清理路径不可删除 | `delete` 抛出 `UncheckedIOException` | 已成功响应可保留，清理故障按计数和日志记录 |
| 专用临时盘和 Prometheus | Compose 无 `APP_TEMP_DIR`，Prometheus 端点不可访问 | 合成 Compose 挂载检查、回环端点及统计样本通过 |
| 前端图片容量错误 | 新错误码无法翻译为 32 MiB 用户提示 | 显示具体容量提示，保留原文件与幂等键，失败不自动重传 |

## 最终验收结果

| 命令或场景 | 结果 |
| --- | --- |
| `./mvnw --batch-mode --no-transfer-progress verify` | Java 21，429 项单元、Web 和架构测试通过 |
| `./mvnw --batch-mode --no-transfer-progress -Pintegration verify` | 隔离 PostgreSQL 17 和 Redis 7，187 项集成测试通过，无跳过。先前一轮的端口冲突已通过集成 profile 显式绑定 IPv4 回环解决，Tomcat JMX 在集成 profile 一致启用 |
| `npm --prefix frontend ci`、`npm --prefix frontend test`、`npm --prefix frontend run build` | 安装及构建通过，212 项前端测试通过 |
| `packageRecovery.browser.mjs`、`packageConflict.browser.mjs` | 本地 Chrome 和合成 API 响应，7 项通过 |
| `python3 docs/dev-ops/compose/test-resource-config.py` | 4 项配置契约，通过标准生产环境、应用、IP 和开发 Compose 的 `config --quiet` |
| Caddy 2.10.2 配置和 HTTP 路由 | `caddy validate` 通过，订单已知长度和 chunked 超限均返回 413，套餐接受同等长度，管理端点返回 404 |
| `promtool check rules` 和 `check config --syntax-only` | 8 条规则和采集示例通过解析 |
| 应用镜像、JVM 与宿主机脚本 | Docker Hub 认证接口超时后，使用本地缓存的 Temurin OCI 基础镜像完成 amd64 本地构建。容器内 `PrintFlagsFinal` 核验主应用和图片端关键参数。Linux 隔离容器验证预检脚本拒绝普通未挂载目录 |

Maven 与 npm 验收使用可写的临时缓存。最终分支为 `codex/stability-hardening-followup`，HEAD 仍为 `f4e25d6eb2120309cdefc155b00d417229e6a99a`。共有 54 个本地变更文件，暂存区为空，未提交或推送。

## 部署边界与后续

标准部署和 IP 部署使用各自的 Compose 入口，均需配置并预检宿主机 `APP_TEMP_DIR`。标准镜像用户为 10001:10001，IP 模式由 `APP_UID:APP_GID` 决定，挂载根应为 0700。外置反向代理须同步 6/65 MiB 与正文读取期限。宿主机已用内存、运行中的 Redis 工作集、专用挂载的硬配额、真实凭据和外部 Prometheus 告警投递需在相应环境验收。这里验证了应用拒绝逻辑、挂载契约、解析和指标，实际生产挂载与告警尚无运行证据。宿主机磁盘写入若卡在系统调用中，业务代码只能在调用返回后检查期限。专用盘监控和并发上限用于约束这类故障的影响。

本轮未执行负载测试、压力测试、soak、生产探测或部署。后续在独立同规格环境经单独授权后，可用合成数据核验 AOF 重写时 RSS、历史导出峰值、磁盘接近满额时的恢复和容器 OOM 事件接入。
