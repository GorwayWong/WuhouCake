# 2026-10-20 周历／月历工作台验收

## 实现结果

基于 `codex/fix-employee-access-ux`、`a5c5fca` 完成。工作台保留原有品牌变量、新建入口、批量导出、状态判断、权限和实时刷新机制。

- 周历为七列日期选择器；当天订单使用共享 `OrderTimeline` 和 `OrderSummaryCard`，按上海时间半小时分组，按准确交货时间、订单号排序，仅显示有订单的时段。不同实际交货日期的相同钟点不合并；实际交货日期与收货日期不同时，卡片同时显示交货日期。
- 月历保留六周、42 格；手机日期格固定 88px，桌面固定 112px，摘要为最早交货订单的首件产品和客户手机号后四位。筛选不影响日期概览。
- 月历面板插在所属周之后，同日收起、同周切换、跨周移动；点击相邻月份日期保持原显示月份。月份导航收起旧面板，返回今天和日期跳转定位并展开目标日。
- 卡片为完整链接，展示完整手机号、准确交货时间、交接方式、既有状态标签、所有产品名称数量和整单最新商品备注。备注遍历所有商品，按时间及 ID 选择，不依赖商品顺序。
- 首次进入、刷新和重新登录默认全部筛选；停止读取、写入历史筛选存储。当前账号会话内，日期、视图和详情往返保留筛选；当前范围没有已选状态时仍保留选项。
- URL 保存日期、视图、显示月份、展开状态，详情和日志保留来源日历。浏览器前进后退、显式返回以及带来源的详情深链接均恢复对应日历；退出登录同步重置 URL 和日历视图。

`GET /api/orders/calendar` 新增只读字符串 `customerPhoneLast4`，只在日历 SELECT 中使用 `RIGHT(customer_phone, 4)`。前导零保留，响应不增加完整手机号。workbench 响应、数据库结构、订单实体和写入流程未变。查询缓存仍使用 `calendar`／`workbench` 前缀；收起的月历不查询每日详情。

## 自动化检查

| 检查 | 执行命令 | 结果 |
| --- | --- | --- |
| 前端单元测试 | `cd frontend && rtk npm test` | 67 项通过，0 失败、0 跳过 |
| TypeScript 与生产构建 | `cd frontend && rtk npm run build` | 通过 |
| 后端单元与 ArchUnit | `rtk proxy ./mvnw test` | 267 项通过，0 失败、0 跳过 |
| 订单 HTTP 集成 | `rtk proxy ./mvnw -pl WuhouCake-bootstrap -am -Pintegration -Dit.test=OrderIT verify` | `OrderIT` 28 项通过，0 失败、0 跳过 |
| 变更空白检查 | `rtk git diff --check` | 通过 |

新增／调整测试覆盖：半小时边界与上海时区、同刻排序、跨实际日期排序、跨商品最新备注及同时间 ID、概览首单排序、展开／收起／跨周／跨月、旧链接和来源路由往返、筛选默认及选中状态保留、手机号后四位与前导零、完成／取消订单查询边界，以及 workbench 原有响应契约。

## 浏览器验收

使用 `agent-browser` 和本机 Chrome，连接实际后端及 PostgreSQL、Redis；创建专属 schema、Redis 命名空间和验收账号，测试数据不与现有业务数据混用。验收后已停止测试进程，删除专属 schema、Redis 键和临时密钥、凭证。

测试数据包含单日 0／1／10／30 单、每单 1／3／10 件产品、同刻三单、长备注和非首件商品上的最新备注。最终源码通过 35 项浏览器断言，另实际核对详情来源深链接和批量导出下载。

| 场景 | 结果 |
| --- | --- |
| 375px、390px、1440px 下周历与展开月历 | 无页面水平溢出；日期格高度分别为 88px／112px |
| 月历展开 30 单 | 42 个日期格尺寸不变；产品名称数量完整渲染 |
| 同时刻三单与半小时分组 | 同组显示，卡片保留准确时间；无空时段 |
| 最新备注 | 选择最后一件商品的新备注；长文本正常换行 |
| 同日收起、同周切换、跨周移动 | 正确；同周切换前后周行纵向位置不变 |
| 相邻月份日期 | 原月内展开；月份导航收起旧面板 |
| 请求范围 | 收起月历切月无 workbench 请求；展开只查询对应日期 |
| 状态／付款筛选 | 日期、周月视图及详情往返保留；零匹配时不清除已选状态 |
| 历史 localStorage | 设置真实账号对应的旧筛选键，刷新仍默认全部 |
| 详情跳转及返回 | 整卡进入正确订单；显式返回、浏览器前进后退恢复原月历和展开日 |
| 详情深链接 | 刷新带来源的详情链接后，详情返回和顶部导航都指向原日历 |
| 实时更新 | 直接通过 API 修改手机号、交货时刻和商品备注，SSE 同步更新日期概览及展开列表 |
| 新建、日期跳转与今天 | 新建入口正常；日期控件和今天按钮保持月视图并展开目标日期 |
| 退出与重新登录 | URL 与当天周历一致，筛选重置为全部 |
| 键盘／减少动态效果 | Enter 选择并展开日期；减少动态效果时面板动画为 none |
| 鼠标筛选与页面错误 | 付款筛选可点击操作；无未捕获页面错误 |
| 原批量导出 | 实际下载有效 ZIP，包含 10 份 XLSX，ZIP 完整性检查通过 |

## 截图

均为专属测试数据。手机截图截取滚动后的订单区域，桌面月历使用较高视口展示完整展开面板与后续周。

| 视图 | 375px | 390px | 1440px |
| --- | --- | --- | --- |
| 周历时间轴 | [375 × 844](assets/calendar-workbench-2026-10-20/week-375.png) | [390 × 844](assets/calendar-workbench-2026-10-20/week-390.png) | [1440 × 1000](assets/calendar-workbench-2026-10-20/week-1440.png) |
| 月历行内展开 | [375 × 844](assets/calendar-workbench-2026-10-20/month-375.png) | [390 × 844](assets/calendar-workbench-2026-10-20/month-390.png) | [1440 × 1800](assets/calendar-workbench-2026-10-20/month-1440.png) |

## 变更文件清单

前端代码（相对于 `frontend/`）：

- `src/Calendar.tsx`：七列周历、固定月历周行、按需查询、筛选与展开面板。
- `src/OrderTimeline.tsx`（新增）：共享时间轴、完整订单摘要卡片。
- `src/calendarView.ts`（新增）：日历状态、URL、日期操作、时间分组、排序与最新备注选择。
- `src/App.tsx`：会话筛选状态、URL 恢复、来源导航与退出时状态同步。
- `src/OrderDetail.tsx`：详情和日志保留来源日历。
- `src/routes.ts`：日历来源参数解析、详情及日志链接生成。
- `src/calendarFilters.ts`：移除存储读写，保留当前已选状态。
- `src/types.ts`：日历后四位字段及 workbench 类型隔离。
- `src/styles.css`：日期格、时间轴、卡片、响应式、焦点与减少动态效果样式。
- `tests/calendarView.test.ts`（新增）、`tests/calendarStatus.test.ts`、`tests/routes.test.ts`、`tests/management.test.ts`：相关行为测试。
- `README.md`：工作台交互、筛选与数据说明。

后端代码（以下五项相对于 `WuhouCake-order/src/main/java/org/xaspire/WuhouCake/order/`）：

- `api/dto/OrderQueryViews.java`。
- `domain/port/OrderQueries.java`：只读查询投影，不涉及订单实体。
- `application/service/OrderQueryService.java`。
- `infrastructure/persistence/mapper/OrderQueryMapper.java`。
- `infrastructure/persistence/repository/PostgresOrderQueries.java`。

后端验证与契约：

- `WuhouCake-order/src/test/java/org/xaspire/WuhouCake/order/application/OrderQueryServiceTest.java`。
- `WuhouCake-bootstrap/src/test/java/org/xaspire/WuhouCake/bootstrap/OrderIT.java`。
- `WuhouCake-order/README.md`。

交付材料：本文件及 `docs/verification/assets/calendar-workbench-2026-10-20/` 下六张 PNG 截图。

## 局限

- 远端 SSH 连接失败，未确认远端是否有更新；实现与验收均基于上述本地分支。
- 浏览器验收覆盖 Chrome 的手机尺寸视口，未在实体 iPhone／Android 或 Safari 上验证。
- Vite 构建提示主 chunk 约 841 kB，超过默认 500 kB 提示阈值；本次没有扩展到分包优化。
