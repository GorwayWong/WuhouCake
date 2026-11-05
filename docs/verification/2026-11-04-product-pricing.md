# 蛋糕商品单价规则验证

## 生效行为

- CAKE 商品不填写或展示普通单价与会员单价，其他商品继续选填；按商品类型判断，名称不参与判断。
- 纯蛋糕录单只保留整单约定金额；混合单参考小计仅统计其他商品，整单金额独立填写。
- 新建、追加及其他品类改为蛋糕时价格写 null。已有蛋糕的普通资料编辑保留历史原始价格，仅修改单价不增加版本或活动。蛋糕改为其他类型时，未明确填写的新价格为空。
- 历史价格读取不改库；订单详情、工作台和客户填单核对接口输出蛋糕单价为 null。核对保存与转订单按新写入规则处理。原始审计日志保留。
- 单单 XLSX、批量 ZIP 和经营报表保留列布局，蛋糕行两种单价为空，其他商品价格正常输出。
- 历史录单草稿恢复清除表单中的蛋糕价格，但结果待确认请求保留原载荷和幂等键，不重新解释旧请求或改变整单金额。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| 前端单元测试 | 147 项通过 |
| 前端构建 | 通过 |
| Chromium 浏览器回归 | 26 项通过，含价格、图片和草稿恢复场景 |
| 后端相关单元及 ArchUnit | 158 项通过 |
| OrderIT / CustomerSubmissionIT / OrderExportIT | 96 项通过 |
| 扩展 WorkflowManagementIT | 17 项通过，4 项既有失败，见下文 |

价格场景覆盖蛋糕、其他商品、混合订单、品类切换、旧草稿恢复、隐藏的无效价格、非蛋糕零元及空价、识别字段顺序、编辑与核对表单、历史读取不改库、蛋糕价格修改无业务变更，以及 XLSX/ZIP/经营报表。大金额边界测试保留，对非蛋糕价格及整单金额继续验证精确整数分上限。

浏览器使用模拟 HTTP、真实 Chromium 和 IndexedDB；后端集成使用本地 PostgreSQL/Redis 的随机 schema/namespace。浏览器测试屏蔽外部字体请求，避免外网字体加载影响导航稳定性；手机与桌面宽度均核对过界面及横向溢出。

## 已区分的既有回归问题

以下四项在本次单价修改前实现的隔离副本中以相同原因复现，未修改其测试或员工归属逻辑：

- `mixedProductsAreCountedByQuantityAndFilteredExportMatchesTheListWithoutLogs`
- `ownershipChangesRecordRealActorAndArchivedEmployeeKeepsHistoricalAttribution`
- `employeeGroupsUseStableAccountsAndExposeUnknownAmountsWithoutDuplicatingMixedOrderMoney`
- `exportKeepsOneSnapshotWhileAnotherEmployeeChangesTheMatchingOrder`

现有员工手工录单固定归属当前认证员工；这些测试仍要求创建时采用请求中的另一员工，导致归属断言不符、相关筛选为空，继而发生导出行缺失。隔离验证恢复了修改前的商品实体、金额输出投影、客户核对服务及导出单价处理，仅在临时副本中构建，未回退当前工作区。

## 复验命令

```sh
cd frontend
npm test
npm run build
# 先启动本地 Vite；PLAYWRIGHT_MODULE 使用本机可用的 playwright 包路径。
DRAFT_TEST_URL=http://127.0.0.1:5209 PLAYWRIGHT_MODULE=/path/to/playwright node --test --test-concurrency=1 tests/productPricing.browser.mjs tests/itemImages.browser.mjs tests/orderDraft.browser.mjs
```

后端使用 JDK 21 和本地集成配置：

```sh
CUSTOMER_ENTRY_PUBLIC_ORIGIN=http://localhost:5173 ./mvnw -pl WuhouCake-bootstrap -am -Pintegration verify \
  '-Dtest=ProductPricingTest,OrderTest,CustomerSubmissionTest,CustomerSubmissionServiceTest,OrderRecognitionTest,OrderRecognitionServiceTest,OrderFilesTest,*ViewAccess*Test,*Architecture*Test' \
  -Dsurefire.failIfNoSpecifiedTests=false \
  -Dit.test=OrderIT,CustomerSubmissionIT,OrderExportIT -Dfailsafe.failIfNoSpecifiedTests=false
```

本次单价变更没有新增数据库迁移，没有批量清空历史价格，没有部署服务器；既有未提交工作保留。
