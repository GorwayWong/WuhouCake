# 取货与出品时间统一验证

## 当前行为

- 员工新建、改期、客户扫码、员工核对、详情、工作台和导出统一使用取货与出品两个时间。取货指客户或配送员从门店取走商品。
- 出品默认取货前一小时；自动值随动，手动值保留，可恢复自动。员工本机草稿保留模式，识别与撤销同时处理模式和时间。
- 历史取货优先 `plannedHandoffAt`，缺失回退 `requestedReceiveAt`，再回退日期。日历、经营查询、出货统计、重复提示及日期导出使用相同口径。
- 不批量回填历史。只打开订单不写入；只改电话等无关资料保留原时间及精度。明确修改取货时同步兼容字段。原始客户提交和审计记录保持原样。
- 数据库列及公开字段名未删除或重命名；未执行生产数据迁移、部署或提交。

## 自动化验证

- 前端 `npm test`：140 项通过；`npm run build` 通过。
- JDK 21 下 Maven 单元测试及架构检查：331 项通过。
- `OrderIT`、`OrderExportIT`、`CustomerSubmissionIT`、`WorkflowManagementIT`：共 113 项，109 项通过，4 项既有员工归属测试失败，见下节。
- 新增数据库验证直接构造历史冲突时间，覆盖日历、工作台、出货汇总、日期导出、经营查询与 XLSX；读取及无关修改均不回填。缺失取货时刻与日期型旧单的回退也已验证。
- 经营报表时间文案更新后，单独重跑 `WorkflowManagementIT#managementReceiveFilterAndExportsUseHistoricalPickupDatesWithFallbacks`，通过。
- Chromium 移动端回归覆盖 320、360、390、430、1280px：原有 15 项及新增 3 项。新增流程验证自动随动、手动保留、刷新恢复、恢复自动、历史编辑仅提交电话，以及客户扫码至员工核对的字段同步。
- 单元验证覆盖跨日／月／年、闰年、不完整时间、清空来源、手动空值、识别与撤销、原值及秒精度保留。

## 既有失败的独立复现

在 `/private/tmp/wuhou-time-baseline` 中解包未修改的 `HEAD`，使用相同 JDK 21、数据库和独立测试 schema，以下四项仍以同样原因失败（3 个断言失败、1 个异常）：

- `WorkflowManagementIT.mixedProductsAreCountedByQuantityAndFilteredExportMatchesTheListWithoutLogs`
- `WorkflowManagementIT.ownershipChangesRecordRealActorAndArchivedEmployeeKeepsHistoricalAttribution`
- `WorkflowManagementIT.employeeGroupsUseStableAccountsAndExposeUnknownAmountsWithoutDuplicatingMixedOrderMoney`
- `WorkflowManagementIT.exportKeepsOneSnapshotWhileAnotherEmployeeChangesTheMatchingOrder`

这些测试仍假设员工手工录单可以直接指定其他归属员工；当前实现按登录员工归属，导致归属断言不符或按另一员工筛选为空。本次未改变该业务行为，也未改写上述四项测试。

## 环境与边界

数据库测试使用随机独立 schema，Redis 使用独立 namespace；测试结束清理自身数据。浏览器流程使用模拟 API，持久化与 HTTP 契约由数据库集成测试覆盖。手机宽度 Chromium 检查不代表真实 iPhone Safari 或线上服务器验收。

完整日志位于 `/private/tmp/wuhou-time-integration-final.log`、`/private/tmp/wuhou-time-baseline.log`、`/private/tmp/wuhou-time-report-check.log`、`/private/tmp/wuhou-time-browser-final.log`。移动端截图位于 `/private/tmp/wuhou-time-mobile.png`。
