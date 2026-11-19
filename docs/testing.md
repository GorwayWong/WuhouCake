# 测试指南

## 图片故障隔离回归

`ImageWorkerTest` 验证真实子进程的解码、不可中断任务超时终止、崩溃后恢复和响应体期限；`OrderPackageIT` 验证七图准备不持有事务、处理失败全回滚和同键重放不重复解码。图片单元测试保留透明 PNG、小图和 EXIF 1–8 方向回归。

资源验收使用专用数据库与回环测试入口，不得指向生产。先运行 `WuhouCake-order/src/test/java/org/xaspire/WuhouCake/order/infrastructure/files/ImageResourceFixtures.java` 的独立 main，生成七张 6000×4000 合成 JPEG（包括渐进 JPEG），避免样本生成占用被测服务堆。测试 app 使用 256 MiB 堆/640 MiB 容器，图片端使用 Compose 的 320 MiB/1 核边界。测试实例预建 `SOAK` 管理员；脚本默认初始/改后口令仅为合成测试值，也可通过 `WUHOU_IMAGE_TEST_INITIAL_PASSWORD`、`WUHOU_IMAGE_TEST_PASSWORD` 设置。

```bash
java -Xmx384m WuhouCake-order/src/test/java/org/xaspire/WuhouCake/order/infrastructure/files/ImageResourceFixtures.java /tmp/wuhou-image-fixtures
python3 docs/verification/image-isolation-probe.py --base http://127.0.0.1:18080 --images /tmp/wuhou-image-fixtures --seconds 1800 --output /tmp/wuhou-image-result.json
```

脚本并发提交三批七图套餐，同时探测 CSRF、会话和套餐读取；成功后同键重放并删除合成套餐。目标为读取 p95 < 1 秒、最大 < 3 秒、无读取错误。`--pause-worker wuhou-image-soak-image-worker-1` 可对专用验收容器注入暂停，验证上传受控超时且读取不受影响；该参数只接受此验收命名前缀。持续观察 Docker 内存、PIDs、健康及临时文件，并在结束后删除专用测试环境。合成样本不能替代事故原图的确定性复现。

前端新增 `frontend/tests/requestDeadlines.test.ts` 和 `packageDraftStorage.test.ts`；浏览器回归使用 `PLAYWRIGHT_MODULE=/path/to/playwright node --test frontend/tests/packageRecovery.browser.mjs frontend/tests/packageConflict.browser.mjs`，需先在 5197 端口启动前端，覆盖七张图片响应丢失后刷新、同键确认、确认时再次繁忙、草稿版本冲突及原有多人编辑。

## 常用命令

| 验证目标 | 命令 | 依赖 |
| --- | --- | --- |
| 后端业务规则、Web 边界与模块架构 | `./mvnw test` | Java 21 |
| HTTP、数据库、事务、Redis 与历史数据升级 | `./mvnw -Pintegration verify` | Java 21、专用 PostgreSQL 和 Redis |
| 前端表单数据、路由、请求、草稿与同步 | `npm --prefix frontend test` | Node.js 24、`npm --prefix frontend ci` |
| 前端类型与打包 | `npm --prefix frontend run build` | 同上 |

本地集成测试的连接参数见 [integration profile](../WuhouCake-bootstrap/src/main/resources/application-integration.yml)。使用专用测试实例，按实际连接设置 `SPRING_DATASOURCE_*` 和 `SPRING_DATA_REDIS_*`。测试 HTTP 服务绑定 IPv4 回环并使用随机端口，避免系统其他服务的 IPv4 回环监听覆盖双栈通配监听。测试使用随机数据库 schema、Redis 键前缀与合成样本。复现 CI 时关闭外部识别并清空模型密钥，参见 [CI 环境配置](../.github/workflows/ci.yml)。

单独重跑某一条 HTTP 集成用例时，可以指定类和方法。测试报告分别在各模块的 `target/surefire-reports` 和 `target/failsafe-reports`。

```sh
./mvnw -pl WuhouCake-bootstrap -am -Pintegration verify \
  '-Dit.test=IdentityIT#auditFiltersByActorActionResultAndTimeWithStablePagination' \
  -Dfailsafe.failIfNoSpecifiedTests=false
```

## 生产稳定性确定性回归

使用 Java 21 运行完整后端校验，再以专用 PostgreSQL 17、Redis 7 和合成数据运行 integration profile。执行 `python3 docs/dev-ops/compose/test-resource-config.py` 核验四组 Compose 和 JVM 参数。在有本地 Docker 的环境，用 Caddy 2.10.2 和合成证书执行 `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`，分别验证 6 MiB 订单路由、65 MiB 套餐路由和公网管理路径。告警规则用 `promtool check rules docs/dev-ops/monitoring/alerts.yml` 解析。

- `OrderTest` 验证 100 个含软删除的订单商品项边界。`OrderExportIT` 验证整单图片数量、32 MiB 精确字节和超一字节、幂等、两条事务争用真实 PostgreSQL 行锁、历史图片保留和导出失败清理。
- `OrderExportIT`、`OrderPackageIT` 通过真实 HTTP 验证鉴权先于准入、无 Content-Length 时的正文限制、额外 Part、JSON 限额、16 图套餐和释放准入。检查 `/actuator/prometheus` 回环采集与非回环拒绝。
- `ScratchSpaceTest` 验证预留边界、异常释放、独占锁、活动文件保护和孤儿文件期限。`ImageWorkerTest` 验证批次独占、快速 BUSY、期限和 Worker 错误后的恢复。
- `frontend/tests/images.test.ts` 验证容量错误提示以及原文件和幂等键的重试行为。保留草稿、权限、套餐和原导出内容回归。

本轮验收只使用确定性回归和少量并发请求。后续独立资源验收由专用环境执行，流程可参照上文。

## 满额导出负载

在专用 PostgreSQL 17 和 Redis 环境配置本页的集成连接参数，使用 Java 21 运行。测试绑定回环，使用随机 schema 和 Redis 键前缀。

```sh
./mvnw -pl WuhouCake-bootstrap -am -Pintegration verify \
  '-Dit.test=OrderExportIT#measureFullExportWithConcurrentOrderCreationAndWorkbenchReads' \
  -Dwuhou.export.load=true -Dfailsafe.failIfNoSpecifiedTests=false
```

测试使用五连接的 Hikari 池。每个经营 ZIP 含 100 笔合成订单，每单有两件商品、订单备注、商品备注和一张小图。写请求使用相邻日期，避免改变导出筛选结果。预热后交替执行各三轮无导出和单路持续导出，每轮 30 秒，每秒发送 4 次录单和 8 次工作台卡片读取。Failsafe XML 中的 `EXPORT_LOAD` 行记录每轮计数、耗时分位数、从首条 SQL 到事务提交的快照耗时、实际快照 SQL 数，以及每 50 毫秒采样的连接池等待。平时 CI 运行两种 ZIP 入口的 SQL 数与结果一致性断言。

### 2026-11-19 隔离测量

以下基线使用 `edbb8e0` 的逐单读取，复测使用批量读取。两次均运行于同一台 macOS ARM64 主机，PostgreSQL 17 和 Redis 运行在本机 Docker 中。延迟单位为毫秒，p50 和 p95 取三轮各自分位数的中位数，最大值取三轮中的最大值。

| 版本与负载 | 指标 | 样本数 | p50 | p95 | 最大值 |
| --- | --- | ---: | ---: | ---: | ---: |
| 基线，无导出 | 录单 | 361 | 32.00 | 51.07 | 201.70 |
| 基线，无导出 | 工作台读取 | 721 | 23.58 | 39.82 | 174.67 |
| 基线，持续导出 | 录单 | 362 | 16.07 | 25.45 | 81.79 |
| 基线，持续导出 | 工作台读取 | 722 | 10.05 | 18.30 | 89.45 |
| 基线，持续导出 | ZIP 响应 | 119 | 735.17 | 849.14 | 1219.17 |
| 基线，持续导出 | 快照事务 | 119 | 222.53 | 309.24 | 357.33 |
| 批量读取，无导出 | 录单 | 361 | 32.57 | 48.49 | 135.88 |
| 批量读取，无导出 | 工作台读取 | 721 | 24.49 | 37.10 | 123.37 |
| 批量读取，持续导出 | 录单 | 361 | 17.91 | 40.75 | 406.32 |
| 批量读取，持续导出 | 工作台读取 | 720 | 12.26 | 31.04 | 340.57 |
| 批量读取，持续导出 | ZIP 响应 | 143 | 592.94 | 836.48 | 1517.99 |
| 批量读取，持续导出 | 快照事务 | 143 | 20.60 | 39.40 | 227.40 |

100 单快照 SQL 从 502 条降至 7 条。两次完整测量均无 HTTP 错误，复测的第二轮导出有三个等待采样点，峰值为两个请求，其余轮次未采到连接等待。持续导出采用前一份 ZIP 返回即请求下一份的策略，复测期间完成的 ZIP 更多，同时录单与工作台的尾延迟高于基线。快照耗时的下降可复现，端到端尾延迟仍受并发生成 ZIP 和本机资源调度影响。首轮探索复测有一次未分类的导出 HTTP 503，最终三轮未再出现。压测工具会区分业务错误码并对 `EXPORT_BUSY` 遵守 `Retry-After`。

### 2026-11-19 同频复测

在同一台 macOS ARM64 主机的隔离环境中交替运行 `edbb8e0` 和 `7aa4162`。沿用 PostgreSQL 17、Redis、五连接的 Hikari 池及以上 100 单合成数据。各版本先预热，再每 2 秒发起一份经营 ZIP。每轮持续 36 秒，同时每秒发起 4 次录单和 8 次工作台卡片读取。按请求记录完整响应延迟，分段记录快照和文件生成耗时、生成线程 CPU 时间、连接池等待及 JFR 采样。

| 指标 | 逐单读取 `edbb8e0` | 批量读取 `7aa4162` 第一轮 | 批量读取第二轮 |
| --- | ---: | ---: | ---: |
| 成功完成的 ZIP | 18 | 18 | 18 |
| 录单 p95 | 72.40 ms | 50.11 ms | 45.55 ms |
| 工作台读取 p95 | 45.35 ms | 36.83 ms | 36.43 ms |
| ZIP 响应中位数 | 1048.15 ms | 754.89 ms | 652.85 ms |
| 快照耗时中位数 | 339.35 ms | 31.96 ms | 30.31 ms |
| 每份 ZIP 的快照 SQL | 502 | 7 | 7 |

表中每轮的 144 次录单和 288 次工作台读取均成功。另一次基线同频运行有一份 ZIP 返回 `EXPORT_BUSY`，实际只完成 17 份，未计入同频对照。

上次 p95 上升的可能原因是持续导出模式下，批量读取缩短了请求间隔，同一窗口内实际生成了更多工作簿。沿用该模式复跑，两版各测 48 秒，完成的 ZIP 从 56 份增至 69 份，生成阶段累计 CPU 时间从 26.4 秒增至 33.1 秒。生成线程的 JFR CPU 采样主要集中于 POI／XMLBeans 的工作簿构建，持续导出阶段未采到连接池排队。两组持续导出复跑的业务 p95 变化方向不一致，现有证据无法精确归因上次的单轮尖峰。

同频测量未见录单或工作台读取 p95 上升。保留批量查询，暂缓进一步优化。若真实门店持续导出时出现可感知的卡顿，优先度量工作簿生成成本。

## 隔离备份恢复

使用 Java 21、Docker Compose、Python 3.11 及 OpenSSL，从仓库根目录执行。先用 Maven 构建 Spring Boot JAR。

```sh
python3 -B docs/dev-ops/compose/test-restore-ip.py --jar WuhouCake-bootstrap/target/WuhouCake-bootstrap-*.jar
docker build -f docs/dev-ops/compose/postgres-pitr.Dockerfile -t wuhou-pitr-test:local docs/dev-ops/compose
python3 -B docs/dev-ops/compose/test-restore-ip.py --jar WuhouCake-bootstrap/target/WuhouCake-bootstrap-*.jar --pitr-image wuhou-pitr-test:local
```

逻辑恢复和 PITR 分别运行。测试使用随机 Compose 项目、临时卷、回环端口、合成数据与临时凭据，完成后清理。通过条件为还原库中的订单、商品、图片摘要、付款和活动记录匹配，并通过应用 API 确认恢复点之后的订单缺席。输出记录目标时刻和从开始还原到业务验收完成的耗时。CI 每次运行逻辑恢复。

## 业务覆盖入口

| 业务或风险 | 代表性测试 |
| --- | --- |
| 订单、制作、取货和付款 | `OrderTest`、`OrderPricingTest`、`OrderIT` 覆盖状态转换、分级权限、金额边界、并发版本、回滚和通知 |
| 客户扫码与确认 | `CustomerSubmissionIT` 覆盖提交、核对、重复确认、权限、限流、幂等和异常数据拒绝 |
| 粘贴识别 | `OrderRecognitionTest`、`OrderRecognitionServiceTest`、`OrderIT` 和 `recognition.test.ts` 覆盖规则识别、模型降级、禁止缓存和保留手工输入 |
| 查询、报表和导出 | `WorkflowManagementIT`、`OrderIT`、`OrderExportIT` 覆盖时区、筛选、汇总、文件内容、导出限额和失败清理 |
| 套餐、商品图片与草稿 | `OrderPackageIT`、`OrderExportIT`、`orderDraftStorage.test.ts` 及对应浏览器用例覆盖版本冲突、文件归属、重试和本机恢复 |
| 账号、权限和审计 | `IdentityIT`、`authentication.test.ts` 覆盖首次改密、会话撤销、权限变化、审计筛选分页、事务回滚和存量岗位 |
| 基础设施和升级 | `InfrastructureIT` 验证迁移装配、数据库事务和 Redis 锁。历史升级用例在各业务集成测试中从指定旧版本建立合成数据再运行迁移 |

新增回归时，从最轻的可观察边界入手。领域测试断言状态、金额和错误结果。接口测试断言响应以及重新读取的状态，异常写入同时检查版本、记录或审计是否保持原状。数据库约束、真实回滚、并发竞争和旧数据迁移使用集成测试。对于页面用例，优先使用控件标签、可访问名称和用户可见提示来定位。

## 浏览器回归

现有 Playwright 用例按需运行，覆盖表单交互、弹窗、布局、本机存储和多标签页等浏览器行为。API 使用合成响应，真实 HTTP 契约由后端集成测试验证。

在 `frontend` 启动 `npm run dev -- --host 127.0.0.1 --port 5197`，另开终端在同一目录运行以下命令。需要本机 Chrome 和可用的 Playwright 模块，环境变量及其他用例见 [前端验证说明](../frontend/README.md#草稿回归验证)。

```sh
node --test --test-name-pattern='首次登录|客户扫码响应丢失' \
  tests/firstLogin.browser.mjs tests/orderDraft.browser.mjs
```

首次改密用例从录单深链接开始，验证首次登录的访问限制、当前密码错误后的重试，以及改密后使用新密码重新登录。扫码用例验证响应丢失后保留输入，并用原幂等键和原内容重试。部署环境的 HTTPS Cookie、反向代理、真实设备和外部模型可用性仍需在对应环境验收。


### CI 浏览器验收

从仓库根目录使用 Node.js 24、Java 21、Docker Compose 及 OpenSSL 执行。使用锁文件中的 Playwright 和配套 Chromium。

```sh
./mvnw -DskipTests package
npm --prefix frontend ci
cd frontend
npx playwright install --only-shell chromium
cd ..
DRAFT_BROWSER_CHANNEL=headless-shell python3 -B docs/dev-ops/compose/test-browser-receipt.py \
  --jar WuhouCake-bootstrap/target/WuhouCake-bootstrap-*.jar
```

该入口启动隔离 PostgreSQL、Redis、Spring Boot 和回环 Vite。真实扫码用例在后端已返回回执时断开浏览器响应，再验证跨刷新同键重试。其他用例通过模拟 API 覆盖撤权、录单草稿和套餐恢复。设置 `WUHOU_BROWSER_TRACE_DIR` 可保存 trace，CI 仅在任务失败时上传。
