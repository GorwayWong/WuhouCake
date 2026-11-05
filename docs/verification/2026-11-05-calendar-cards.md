# 日历订单卡片精简验证

## 当前行为

前台卡片显示首个商品名称及多商品“另有 N 项”提示，删除独立项数／件数行和电话／交接方式／订单号信息行。取货时间与出品时间左右两列，标签在上、值在下，手机也保持两列。取货读取现有统一时间规则，只有日期时保留日期及“时刻待定”；出品时间为空显示“待定”，不自动推算。

状态、付款权限、最新备注、整卡详情链接、新建高亮及原有时间轴分组保持。制作岗位继续显示原缩略图、数量和信息行，仍按出品时间分组。本轮仅调整前端展示，无 API、数据库或计价规则变更。

## 已执行

- `rtk npm test`：152 项通过，包含现有日历状态、排序、半小时与跨日分组、时间回退、最新备注及路由测试。
- `rtk npm run build`：通过；仍有现有 bundle 大小提示。
- `calendarCards.browser.mjs`、`orderDetail.browser.mjs`、`itemImages.browser.mjs`：共 9 项通过。
- 新增卡片回归覆盖 390px／1280px 两列布局、长名称无横向溢出、单／多商品、跨日出品、23:30 至次日 00:00 分组、取货待定、缺少出品时间、历史取货字段回退，以及默认折叠已完成区。
- 验证创建高亮、状态与付款组合筛选、点击详情后返回保留日期及筛选、清除筛选、付款权限裁剪、备注预览、制作岗位的缩略图和原信息行及出品分组。
- 两种尺寸的截图已人工核对；布局扫描无发现，`git diff --check` 通过。

```sh
cd frontend
rtk npm test
rtk npm run build
# 先启动 Vite，替换本机 Playwright 包路径：
PLAYWRIGHT_MODULE=/path/to/playwright node --test tests/calendarCards.browser.mjs tests/orderDetail.browser.mjs tests/itemImages.browser.mjs
```

截图位于 `/private/tmp/wuhou-calendar-cards-390.png`、`/private/tmp/wuhou-calendar-cards-1280.png`。浏览器使用模拟 API，SSE 断线提示为测试环境状态；未部署，未对真实环境写数据。桌面 Chromium 的手机视口不替代真实 iPhone Safari 验收。
