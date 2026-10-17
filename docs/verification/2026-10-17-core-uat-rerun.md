# 核心业务验收复跑与试用准入

2026-10-17，基线 `1d7317d8a5717d10eaa61eccd0719beafd57592a`，分支 `codex/c2-c1a-order-images`。结论 **CONDITIONAL GO**：本轮未发现已确认的 P0/P1，原 F1/F2/F3 已关闭；同一门店可信员工的功能验收通过，使用真实订单前仍须完成本文列出的部署与设备准入检查。没有提交、推送、合并或部署。

## 1. 环境、身份与合成数据

- 初始工作区干净；阅读仓库规约、架构、订单/前端 README、身份契约及既有验证报告。只更新验证文档，没有改生产代码、配置、依赖或数据库迁移。
- macOS，JDK 25.0.4（编译目标 Java 21），Node 24.19.0，agent-browser 0.36.0。Chrome 使用四个独立临时 profile/CDP `19341–19344`，不是四个共用 Cookie 的标签页。
- 专用容器 `wuhou-uat-pg-20261017` / `wuhou-uat-redis-20261017`，镜像 `postgres:17-bookworm` / `redis:7-bookworm`，仅绑定 `127.0.0.1:15437/16384`；数据库 `wuhou_uat_20261017`，应用 Redis namespace `uat-20261017`。集成类另用随机 schema/namespace；InfrastructureIT 的固定 `integration_probe` 也落在此专用数据库。
- 后端 `18086`、Vite `5186`。A=`UATA001` 前台，B=`UATB001`、C=`UATC001` 师傅，D=`UATD001` 超管。D 通过既有 CLI 初始化及 HTTP 改密、建员工；A/B/C 经真实浏览器首次改密。管理操作使用现有 API。
- 全部账号、客户、地址、图片和订单均为合成；模板使用脱敏手机号和地址。模型开关始终 false、进程 API Key 为空，未调用百炼或外发客户信息；本地识别配置的启用开关也保持关闭。
- 最终 4 单、7 条商品记录（1 条软移除）、55 条订单活动、6 条图片记录（1 张有效）、4 名员工（C 已归档）。全部订单未付款。#1 配送完成/v9/52050 分，#2 自提完成/v9/0 分，#3 取消/v1/金额空，#4 手工创建待制作/v0/金额空。

证据目录 **E**：`/private/tmp/wuhou-uat-20261017/`，保存断言 JSON、截图、实际下载、日志、JUnit XML、驱动及合成数据库备份。临时证据可能被系统清理；长期自动回归以仓库测试为准。验收结束已停止临时服务、四个浏览器及测试容器，删除凭证、RSA 文件和浏览器 profile，原开发 PostgreSQL/Redis 保持运行。

## 2. 用户旅程矩阵

PASS 只覆盖本列实测范围；GAP、NOT RUN 不因相邻场景通过而改变。

| ID | 预期 | 本轮实际 | 判定 | 证据（相对 E） |
| --- | --- | --- | --- | --- |
| T01 | 建员工、首次改密、独立权限/会话 | D 建 A/B/C，三人浏览器改密及登录，四个独立 profile；STAFF 管理查询/创建 403 | PASS | `login-evidence.json`、`main-journey.json`；IdentityIT |
| T02 | 两蛋糕与 6 个小产品为一单 | #1 为 3 个有效 itemId、合计 8 件；报价 19929/22001/1 分，总额独立为 52050 分 | PASS | `main-journey.json`、`create-desktop.png` |
| T03a | 按日期找到订单、详情一致 | 页面日期定位及详情读取；迁日后旧日期消失、新日期出现 | PASS | `information-notes.json`、日历 DOM 断言 |
| T03b | 输入订单号搜索 | 仍只有订单号及链接，没有搜索入口 | GAP | 现有前端路由/工作台；业务范围文档 |
| T04 | 师傅读取完整商品及交接 | B/C 读取 #1 三项规格、备注入口和交接安排 | PASS | `journey.mjs`、`main-journey.json`；OrderIT |
| T05 | B 开始制作、整单夹层 | v0→v2，两个动作均记录 B，商品仍属于同一订单 | PASS | `main-journey.json` |
| T06 | C 抹面、整单完成并实时同步 | v2→v4，C 记名，B 无手动刷新出现开始配送；有效商品统一完成 | PASS | `main-journey.json` |
| T07 | 人工开始/完成配送 | WAITING_DELIVERY→DELIVERING→COMPLETED；制作完成未自动送达 | PASS | `main-journey.json`、`delivery-completed.png` |
| T08 | 付款与反向纠正可追溯 | UNPAID→PAID→UNPAID，每次一版/一条活动，before/after/作者/时间齐全 | PASS | `main-journey.json` |
| T09 | 自提、直接完成、未记录节点 | #2 跳过夹层/抹面，节点 null、界面显示未记录；重新制作后再完成、自提 | PASS | `items-pickup.json`、`pickup-mobile.png` |
| T10 | 局部资料修改、正确归日 | 只改电话、地址、收货日期、交接时间；总额/商品不变，北京时间正确转 UTC | PASS | `information-notes.json` |
| T11 | 稳定 ID、金额、软移除和独立总额 | 19.99 元/会员价 0；追加 17.01 元再软移除；保留原 ID/历史和 0 元总额；最后一件/已移除项操作拒绝 | PASS | `items-pickup.json`、数据库断言 |
| T12 | 多人整单与各商品备注独立 | A/B 八条备注；各商品仅自己的最近三条，作者和历史正确，版本仍 v9 | PASS | `information-notes.json`、`notes-mobile.png` |
| T13 | 图片归属、认证、预览、移除及释放 | 真实整单/商品上传、手机预览、软移除；跨会话同步，图片请求带认证，B/C 卸载释放全部已观察 Blob URL | PASS | `images-added.json`、`resources.json`、`image-preview-mobile.png` |
| T14 | 前台/师傅单单 XLSX 正确 | A 手机和 B 实际下载，四张表/ZIP CRC/XML/图片 SHA256 正确，移除商品不导出，业务详情不变 | PASS | `export-evidence.json`、`file-inspection.json`、`downloads/` |
| T15 | 超管筛选 ZIP 完整正确 | 空筛选两单；状态+配送+付款组合一单；无结果提示；ZIP 与单单快照一致 | PASS | `export-evidence.json`、`file-inspection.json`；边界见下表 |
| T16 | 重置/归档撤销旧连接并保留历史 | 撤销后先等旧流正常 EOF，再写业务；旧 REST/refresh/重连 401，D 健康流继续，C 浏览器拒绝，原工号和活动保留 | PASS | `identity-audit.json`；OrderExportIT 两种撤销及提交失败回归 |
| T17 | 手机视口主要操作无阻塞 | 390×844 完成录单、修改、备注、状态、图片预览和下载；核对截图及页面宽度 | PASS | 手机截图、`final-http.json`、`recognition-rerun.json`；真机另列 NOT RUN |
| T18a | 刷新、切日期、周/月、退出登录及重启恢复 | 42 格月历/周历保留日期；退出后刷新仍登录页；后端重启七表一致，SSE 自动恢复，备注草稿保留，刷新后按契约清空 | PASS | `late-session.json`、`restart-browser.json`、`database-before/after.json` |
| T18b | 离开取消保留、确认丢弃草稿 | 实际确认框取消保留电话，确认离开后新表单为空 | PASS | `draft-protection.json` |
| T18c | 原生刷新/关闭提醒、强制关闭 | 自动 reload 没有可靠暴露 beforeunload；不据此宣称原生提醒通过；系统强制关闭未验收 | NOT RUN | `draft-protection.json` |

## 3. 并发、故障与边界回归

| 检查 | 本轮证据与实际结果 | 判定 |
| --- | --- | --- |
| B/C 同读版本并发修改 | 真实 HTTP 为 200+409，最终仅一版/一条有效活动；没有自动覆盖或重试 | PASS，`items-pickup.json` |
| A→B 迟到成功/401/旧上传 | 两次旧 GET 被拒绝、无重发；旧上传已 abort，迟到回调未释放 B 的写入锁，上传作者正确 | PASS，`late-session.json` |
| 同版本备注/图片 SSE | A 备注、B 图片在 v9 同步到 C，归属正确；卸载资源释放 | PASS，`resources.json` |
| 事务提交失败 | 真实 PostgreSQL 延迟约束覆盖制作、图片添加/移除、导出活动和账号撤销；数据/活动回滚，无成功通知，撤销失败保留原流 | PASS，OrderExportIT、OrderStreamTransactionsTest |
| 成功后丢响应 | 创建 201、图片 201、导出 200 后丢弃响应，各仅一次 POST，未知结果提示和输入保留，服务端可核查 | PASS，`response-loss.json` |
| 原 F1：撤销与流竞态 | 真实撤销/EOF/重连两例；多流、排队、发送/注册竞态及回滚保持通过 | PASS，`identity-audit.json`、JUnit；关闭 F1/P1 |
| 原 F2：正常断开与真实错误 | FIN/RST 两例及 10 项 MVC 回归通过；正常断开不 ERROR/不转 JSON，真实故障仍诊断；集成日志 HttpMessageNotWritableException 为 0 | PASS，JUnit；关闭 F2/P2 |
| 非法制作/交接/取消、商品与金额 | 错序抹面、终态操作、待自提修改、最后商品移除及空取消原因拒绝；详情/版本/活动保持；负数、超精度、溢出等由领域/Node 回归覆盖 | PASS，仅所列等价类 |
| 导出范围/数量/非法筛选 | 42/43 天、100/101 单、精确文件集合、右开边界及 7 组非法筛选通过；无截断、SQL 500 或成功历史残留 | PASS，OrderExportIT |
| 日期与时区 | 手机实际 00:15 北京时间转换、迁日；跨年/闰日/工作台午夜边界自动回归通过 | PASS；实际跨午夜营业 NOT RUN |
| 规则与模型故障隔离 | 27 个合成样例/154 项字段预期通过；超时、非法 JSON、空泛/冲突建议、限流等由既有确定性模型测试覆盖 | PASS，常规回归子集；没有真实模型调用 |
| 识别页面与正式创建 | 脱敏模板、空字段、默认来源、重复/撤销/日期策略、两轮及跨员工迟到响应通过；识别 503 后可手工创建；真实 400 保留草稿，修正后只生成一个 UNPAID/v0 订单 | PASS，`recognition-rerun.json` |
| 完整多行店内模板 | 真实 HTTP 核对 17 个值；日期 2026-09-30、尺寸 8、原味内胚和三个明确夹馅；奶油/名称/数量/时刻/金额为空；须知未污染，识别前后业务计数相同；assist 返回 DISABLED | PASS，`template-http.json` |
| 应用重启/断线恢复 | 两次重启检查，七表摘要一致；唯一新备注无需手动刷新自动可见；最终完整驱动退出 0 | PASS，`restart-browser.json`；不作重连延迟指标 |
| 备份恢复 | pg_dump 后恢复到另一个全新隔离库，9 张表行数及 SHA256 全等，临时恢复库随后删除 | PASS，`backup-restore.json`；不代表正式备份站点演练 |
| 原 F3：文档链接 | 19 份文档、96 处本地链接，无失效目标/标题；账号入口存在 | PASS，`document-links.json`；关闭 F3/P3 |

全部写入依据服务端详情、活动或数据库结果核对；没有把点击次数当作业务次数。Mock 仅用于网络丢失/迟到/503 和既有模型异常，主要业务请求使用真实后端与 PostgreSQL。等待以 EOF、帧、闩锁、DOM、readiness 或摘要一致为条件，不以固定睡眠判定成功。

## 4. 缺陷、能力与未验证风险

**已确认缺陷：** 本轮没有新的 FAIL/P0/P1/P2。原 F1/P1、F2/P2、F3/P3 均有复验依据，可关闭。既有“创建成功提示可能跨订单保留”的 P3 文案问题本轮未作独立复现，不据此升级或宣称修复；不阻断本次核心旅程。没有为增加数量新增重复测试或修改生产实现。

**已实现：** 多商品录单、整单制作/重开、人工配送/自提、取消、付款纠正、局部修改、备注、图片、活动、日历/工作台、单单/批量导出、账号管理 API、规则识别及可选语义补充。RULE 提取明确正文、DEFAULT 仅供蛋糕默认内胚/夹馅、MODEL 始终待确认；本轮模型关闭，缺失/冲突或外部能力不可用时退回人工。所有正式创建仍走原有必填与业务校验。

**GAP：** 订单号搜索、管理员管理页面、员工归属/门店隔离、管理员专属导出、尺寸精确筛选及商品数量统计未实现。地址标签提取已实现；地址真实性/地理结构识别、OCR、支付网关未实现。电话和配送地址仍主要依赖员工核对，不能宣称有真实性校验。详见[当前业务范围](../product-scope.md)。

**已接受边界：** 2026-10-17 维护者明确接受“仅限同一门店可信员工试用”，接受所有已改密员工共享读取及单单/批量导出、仅账号管理限超管。本轮 STAFF 管理查询 403、ZIP 200 与此契约一致，不再将该权限范围列为试用阻塞。跨门店或不可信账号不在此接受范围。

**NOT RUN：** 正式 HTTPS/Secure Cookie/反向代理缓冲与超时/HTTP2；真实 iOS/Android 的软键盘、文件选择/保存和生命周期；原生刷新/强制关闭；原生 Excel 打开；JDK 21 运行时；数据库/Redis 重启与故障切换；正式备份设施恢复；真实跨午夜营业；容量/慢网络/长期运行和全部最大字段组合。多实例广播/事件重放不属于现有能力。真实模型质量、账单及真实客户外发仍未验收，不由少量历史合成调用推断。

## 5. 命令、数量与证据

最终后端一次 clean 完整执行退出 0，**248 项常规/ArchUnit + 68 项集成**，failures/errors/skipped 均 0。集成为 IdentityIT 12、OrderIT 27、OrderExportIT 24、InfrastructureIT 5。前端 **39/39**、TypeScript/Vite 构建通过。合计 **355 项自动测试通过**；27 个样例、154 项字段预期以及专项用例均已包含在上述数量内，不另行累加。

仓库根目录执行，先确保专用 PostgreSQL/Redis readiness：

~~~sh
export SPRING_DATASOURCE_URL=jdbc:postgresql://127.0.0.1:15437/wuhou_uat_20261017
export SPRING_DATASOURCE_USERNAME=wuhoucake
export SPRING_DATASOURCE_PASSWORD=synthetic_uat17_pg_only
export SPRING_DATA_REDIS_HOST=127.0.0.1
export SPRING_DATA_REDIS_PORT=16384
export SPRING_DATA_REDIS_PASSWORD=synthetic_uat17_redis_only
export RECOGNITION_ASSIST_ENABLED=false
export DASHSCOPE_API_KEY=
rtk proxy ./mvnw clean -Pintegration -pl WuhouCake-bootstrap -am -Dit.test=IdentityIT,OrderIT,OrderExportIT,InfrastructureIT -Dfailsafe.failIfNoSpecifiedTests=false verify -q
~~~

frontend 目录执行 `rtk proxy npm test`、`rtk proxy npm run build`。浏览器沿用 agent-browser：`rtk proxy node E/run-step.mjs <驱动名>`，驱动顺序及结果为 login-all → create-order/journey → information-notes/images → pickup-create/items/items-pickup → exports → response-loss/late-session/collaboration-cleanup → identity-audit/final-http → restart-rerun → recognition-rerun/draft-protection。另用 `rtk proxy python3 E/check-files.py`、`rtk proxy node E/run-step.mjs template-http`、`rtk proxy node E/run-step.mjs backup-restore` 验证文件/模板/恢复。E 是本报告开头的绝对目录占位符，不是可直接执行的环境变量。

临时驱动已适配本轮合成 ID，依赖上述执行顺序；凭证已删除，不能直接从空环境重放。长期自动入口为仓库 JUnit/Node 测试，新环境需按身份和本报告隔离配置重新准备，不另建端到端框架。

`automatic-results.json`、`junit/`、各驱动 `*-exit.json`、`final-database.json`、`live-log-summary.json` 为最终证据。实际 UAT 应用日志 ERROR 为 0；自动故障对照中保留的 ERROR 为测试预期。首次环境尚未就绪的启动失败未计入最终通过数；浏览器驱动的渲染等待、确认框与过短文字等待也曾调整，最终成功断言单列保存，不把这些调试失败计为产品缺陷或通过项。原生刷新仍明确 NOT RUN。

## 6. 试用准入与剩余阻塞项

**CONDITIONAL GO，尚非无条件上线许可。** 当前证据支持单后端实例、同一门店可信员工的小范围功能试用，已没有本轮确认的代码级 P0/P1 阻塞。使用真实订单前须完成：

1. **部署站点检查**：在实际 HTTPS/代理上复核登录刷新/退出、Secure Cookie、SSE 不缓冲及超时、重置/归档即时撤销和真实下载。实际试用运行时若为 JDK 21，还须在该运行时复跑；本轮 JDK 25 不能代替它。
2. **实际员工设备检查**：至少在试用所用 iOS/Android/桌面浏览器完成录单、备注、状态、图片与 XLSX/ZIP 保存，补验原生离开提醒；确认员工知道未保存草稿仅驻留内存，强制关闭可能丢失。
3. **实际数据恢复准备**：确认正式备份位置、权限、恢复责任和回滚步骤，并在试用环境做一次恢复演练。本轮本地恢复已通过，尚不能证明正式备份设施可用。

以上为尚未验证的准入门槛，不是假定已存在的代码缺陷。权限范围已获明确接受，无需再以管理员专属导出或员工隔离阻挡本次限定试用。容量、长期运行、AI 真实语料/费用以及其他 GAP 可按范围另排期；试用保持单实例和模型默认关闭，不扩大到多门店或不可信账号。
