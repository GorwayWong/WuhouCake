# 下单方式录入与查询验收

## 实现

查询页将原“下单人”员工选择替换为“下单方式”，录单、编辑与查询共用“下单人、小程序、到店、客服号”及“其他＋具体文字”控件。“下单人”是固定渠道名称，员工归属、业绩与下钻仍独立保留。

后端复用已有 `ordering_method`，为管理查询、Excel、ZIP 增加可选 `orderingMethod`；按裁剪首尾空白后的完整文字匹配，在分页和聚合前生效。汇总 Excel 记录该条件，ZIP 仍保留完整订单。无新迁移、无历史回填、无业务数据更改。保存继续兼容自由文本，旧值原样回显；扫码填单不会自动归类。

## 验证

- 前端测试 156 项和 TypeScript／Vite 构建通过，保留已有 bundle 大小提示。
- 后端单元及架构检查 349 项通过，相关 PostgreSQL／Redis／HTTP 集成检查 31 项通过：`WorkflowManagementIT` 下单方式及商品筛选共 3 项、`OrderIT` 原有保存／清空／并发及日志用例 1 项、`CustomerSubmissionIT` 全部 27 项。
- 真实查询覆盖四个常用值、自定义与历史值、首尾空白、80／81 字符、字面特殊字符、大小写、关键词／商品／尺寸／员工交集、分页、尺寸及员工汇总、历史未付款模式与删除订单。
- 导出验证 Excel 条件、订单及商品行、整单金额去重，以及 ZIP 仅选匹配订单且完整保留有效商品。
- 浏览器回归覆盖查询 320px 单列、360px／390px／1280px 双列、常用值和其他输入、空值校验、组合条件和两种导出参数、详情返回、清除及快捷模式；录单验证“其他”必填、草稿恢复和实际文字载荷，编辑验证历史值显示与保存；详情原有布局及商品交互回归通过。
- `git diff --check` 通过。浏览器使用合成接口，不能替代真实手机 Safari 验收。此前整组 `WorkflowManagementIT` 的员工归属用例限制仍见[筛选验收记录](2026-11-05-management-filters.md)，本次未修改这些无关用例。

## 命令

仓库根目录：

```sh
rtk mvn -pl WuhouCake-bootstrap -am -Pintegration '-Dit.test=WorkflowManagementIT#orderingMethod*+productName*,OrderIT#orderingMethod*,CustomerSubmissionIT' -Dfailsafe.failIfNoSpecifiedTests=false verify
```

前端目录：

```sh
rtk npm test
rtk npm run build
rtk npm run dev -- --host 127.0.0.1 --port 5197 --strictPort
```

另一个终端在前端目录执行：

```sh
PLAYWRIGHT_MODULE=/path/to/playwright node --test tests/managementFilters.browser.mjs tests/orderDetail.browser.mjs
```
