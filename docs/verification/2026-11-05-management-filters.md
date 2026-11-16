# 订单查询筛选布局与商品名称验收

## 变更

按[筛选说明](../order-query-filters.md)实现四行双列筛选和独立商品名称搜索。名称条件贯通列表、统计、Excel 和 ZIP 选单；商品数量只计匹配项，金额仍为完整订单金额。ZIP 内逐单文件保留全部有效商品，无数据库迁移。

## 通过项

- 前端测试 153 项通过，TypeScript／Vite 生产构建通过；保留已有 bundle 大小提示。
- 后端单元及架构检查合计 348 项通过。
- PostgreSQL／Redis／HTTP 相关集成回归 7 项通过，包括新增 `productName*` 两项，以及取货日期兼容、历史尺寸、非法条件、超过百单的汇总导出和北京时间边界回归。
- 真实 PostgreSQL 查询验证中文、空值、100／101 字符、字面特殊字符、关键词交集、移除商品、删除模式、分页前过滤，以及名称和尺寸必须匹配同一商品。
- 真实导出文件验证匹配商品与数量、整单金额只计一次、汇总 Excel 的商品明细裁剪，以及 ZIP 只选匹配订单且每份文件保留完整商品。
- 合成接口浏览器回归通过：360px／390px／1280px 双列及 320px 单列，日期与图标不重叠、无页面横向溢出，日历弹层、键盘展开选择、组合条件查询后生效、导出参数、分页、详情返回、清除条件和历史未付款模式。
- `git diff --check` 通过；保留工作区既有修改。

## 整组集成测试限制

首次运行整个 `WorkflowManagementIT` 共 23 项，其中 19 项通过，3 项断言失败、1 项报错。以下已有用例仍假设普通录单可归属请求指定的另一位员工：

- `mixedProductsAreCountedByQuantityAndFilteredExportMatchesTheListWithoutLogs`
- `ownershipChangesRecordRealActorAndArchivedEmployeeKeepsHistoricalAttribution`
- `employeeGroupsUseStableAccountsAndExposeUnknownAmountsWithoutDuplicatingMixedOrderMoney`
- `exportKeepsOneSnapshotWhileAnotherEmployeeChangesTheMatchingOrder`

当前工作区 `OrderService.create` 对普通录单已使用实际录单人作为归属员工，因此前三项归属断言不符，第四项按另一员工筛选后得不到预期导出行。本次没有修改该归属规则或上述用例。不能将整组集成测试标记为通过。

## 复核命令

仓库根目录执行：

```sh
rtk mvn -pl WuhouCake-bootstrap -am -Pintegration '-Dit.test=WorkflowManagementIT#productName*+managementReceiveFilter*+abnormalHistoricalSizes*+malformedConditions*+managementExportHandles*+createdDate*' -Dfailsafe.failIfNoSpecifiedTests=false verify
```

前端目录执行（浏览器回归需要先启动 5197 端口的 Vite）：

```sh
rtk npm test
rtk npm run build
rtk npm run dev -- --host 127.0.0.1 --port 5197 --strictPort
```

另一终端在前端目录执行：

```sh
PLAYWRIGHT_MODULE=/path/to/playwright node --test tests/managementFilters.browser.mjs
```

浏览器使用合成数据，不代表真实 iPhone Safari 或生产部署验收。
