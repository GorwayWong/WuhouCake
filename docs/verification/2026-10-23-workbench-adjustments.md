# 工作台状态、商品确认与操作记录验证

日期：2026-10-23。结论基于当前工作区；原有未提交改动保留，本次未提交或推送代码。

## 实现结果

- 周历和月历的状态筛选固定提供全部合法订单状态与制作阶段，按当前显示状态精确匹配；空日历仍提供完整选项。
- 所有有效商品（含主蛋糕）逐项确认。纯蛋糕、混合商品及非蛋糕订单均须经过夹层、抹面，全部商品勾选后确认“其他”，之后才能完成制作；前后端同时校验。
- 取消勾选或修改名称、类型、数量、规格后，对应商品恢复未完成；已确认的“其他”退回已抹面。价格修改不影响确认。追加商品、重新制作和历史订单兼容规则保持方案约定。
- 操作记录使用原生 details/summary，默认收起，展开显示最近三条，保留“全部操作记录”入口。沿用现有权限、加载、错误重试、空状态及完整日志页的筛选分页。
- 商品确认审计文案调整为“更新商品制作确认”，适用于蛋糕及其他商品的勾选和取消勾选。
- 收款统计 SQL、付款时间和历史数据未修改，没有执行历史付款时间回填。

## 自动化验证

| 检查 | 结果 |
| --- | --- |
| 前端相关测试：calendarStatus、shippingPayment、orderForm | PASS，10 项 |
| 前端 TypeScript 与 Vite 构建 | PASS；保留现有 bundle 大小提示 |
| 前端全量测试 | 80/81 通过；1 项既有商品分类断言失败，见下文 |
| 订单模块单元测试及模块 ArchUnit | PASS，186 项 |
| bootstrap 单元测试及全局 ArchUnit（排除既有失败的 OrderStreamWebTest） | PASS，38 项 |
| OrderIT HTTP／数据库集成 | PASS，32 项 |
| 最终审计文案调整后，OrderServiceTest 与商品确认集成场景复验 | PASS，23 项单元测试、1 项集成测试 |
| git diff --check | PASS |

主要命令（仓库根目录执行）：

```bash
cd frontend
node --experimental-strip-types --test tests/calendarStatus.test.ts tests/shippingPayment.test.ts tests/orderForm.test.ts
npm test
npm run build
cd ..
./mvnw -Pintegration -pl WuhouCake-bootstrap -am verify \
  '-Dtest=*Test,!OrderStreamWebTest' -Dsurefire.failIfNoSpecifiedTests=false \
  -Dit.test=OrderIT -Dfailsafe.failIfNoSpecifiedTests=false
./mvnw -Pintegration -pl WuhouCake-bootstrap -am verify \
  -Dtest=OrderServiceTest -Dsurefire.failIfNoSpecifiedTests=false \
  '-Dit.test=OrderIT#simpleWorkflowPackagesAndReceiptDatePersist' \
  -Dfailsafe.failIfNoSpecifiedTests=false
```

集成用例覆盖蛋糕勾选持久化、遗漏主蛋糕时阻止确认“其他”、跳过“其他”被拒绝、过期版本被拒绝、审计记录、回滚及 SSE；单元测试补充蛋糕内容修改重新确认、价格不清除确认、取消勾选回退及重新制作重置。

未在本次修改的既有失败：

- `frontend/tests/productTypes.test.ts` 仍期待旧分类“蛋糕、甜甜圈、纸杯蛋糕、其他茶歇”；当前分类已是“蛋糕、面包、甜甜圈、纸杯蛋糕、饮品”。本次未修改分类实现或这条测试。
- `OrderStreamWebTest` 的 WebMvc 测试上下文缺少 `OrderPackageService` Bean，导致 14 项用例无法启动。本次未修改该测试及套餐装配；全量通过的结论不包含这些用例。

## 浏览器验证

使用 agent-browser 独立会话、临时 CHECK01 测试账号、独立数据库 schema `workbench_check_20261023_1247` 和 Redis 命名空间。后端端口 18080、前端端口 5174；未操作现有业务订单。

- 空日历打开筛选，提供“全部”及完整十种状态与阶段；选择不存在的已取消状态能正常显示空结果。
- 通过页面新建纯蛋糕订单；待制作时蛋糕复选框不可用，开始制作后可勾选，进度条包含“其他”。
- 依次确认夹层、抹面；主蛋糕未勾选时“确认‘其他’完成”按钮禁用，勾选后启用。
- 确认“其他”后显示“整单制作完成”；取消勾选后退回已抹面，确认“其他”按钮再次禁用。
- 重新勾选并确认“其他”，完成整单制作后进入待配送，商品复选框已选中且禁用。
- 操作记录默认收起；展开显示最近三条（按抹面、夹层、开始制作倒序），保留全部记录链接；Enter 可再次收起。
- “全部操作记录”进入完整日志页，显示九条记录及类型筛选；返回详情后默认收起。
- 390 × 844 手机宽度无横向溢出；已查看展开日志及桌面制作完成截图。

截图：

- [手机操作记录展开](assets/2026-10-23-workbench-log-expanded.png)
- [纯蛋糕完成制作后待配送](assets/2026-10-23-workbench-production-completed.png)

## 使用边界

原有 8080 后端已按原有 dev 配置重启为本次构建，现有 5173 工作台可使用新规则。上述浏览器交互验证针对独立运行的本次构建；现有工作台后端的重启验证见下节。

验证后关闭了临时浏览器、5174 前端和 18080 后端，并清理本次创建的临时 schema 与对应 Redis 数据；原有开发服务和业务数据保留。

没有查询截图中的三笔原业务订单，收款为零的具体数据原因仍未判定；只确认了按付款日统计及旧付款时间可能为空的代码事实。

## 现有工作台后端重启验证

- 保留原启动目录、dev profile、数据库连接、Redis 配置、签名密钥及客户入口地址；优雅停止旧进程 PID 67335，启动新进程 PID 97790，监听 8080。原有 5173 前端与 PostgreSQL／Redis 容器继续运行。
- 重启前创建 public schema 的自定义格式 pg_dump 备份，并用 pg_restore --list 核对包含订单数据。备份位于 `/var/folders/4f/k4pz80756g15mx0tfw3pg_cc0000gn/T/wuhou-backend-restart-20261023-2i3ylne3/business-public.dump`，目录权限 700、文件权限 600。
- Flyway 已到 V17，重启未增加迁移。未清空数据、重置账号或重建数据库／Redis。
- 重启前后 public 下全部 13 张表的行数及按行内容排序生成的 MD5 均一致：订单 13 笔、商品 23 条、操作记录 143 条；其他表（包括账号与迁移记录）也一致。
- `/actuator/health`、`/actuator/health/liveness`、`/actuator/health/readiness` 均为 HTTP 200、UP。5173 首页返回 200；经 5173 代理访问受保护的工作台接口正常返回 401，未登录鉴权正常。没有为验证而修改现有业务订单。
- 已确认启动 JAR 包含所有商品完成门禁，SHA-256 为 `67e302c710b0597831dd3150889395b07872eca15f39b8ed50e501b2bae3da96`。
- 启动日志及表指纹核对结果分别位于上述备份目录的 `backend.log`、`restart-result.json`。备份位于系统临时目录，不作为长期归档。

## 商品详情布局优化

- 移除上方独立的“商品制作确认”清单，将“制作完成”放在“全部商品”中各有效商品标题右侧，使用商品名称作为复选框的无障碍标签。已完成采用浅绿色提示；已移除、但因编辑草稿而仍显示的商品不提供勾选入口。
- 商品按行排列，内胚、尺寸、奶油、夹馅等属性以及有权限查看的价格每行两项；标签与字段值分开，字段值加粗、内容换行，并用细分隔线辅助阅读。制作岗位的参数同样采用两列布局。
- 原有勾选接口、权限、版本号、编辑期间禁用、全部完成门禁及取消确认回退规则保持不变；本次未修改后端代码或业务数据。
- 前端构建通过；productionView、orderForm、shippingPayment、calendarStatus 相关测试共 12 项通过。`git diff --check` 通过。
- 浏览器使用独立 5174 前端与 18081 内存接口夹具，验证真实前端组件；未连接业务数据库。验证了 320／390／1280 宽度、长标题与长规格、主蛋糕和非蛋糕各自勾选、全部勾选后启用“其他”、取消勾选回退、无制作权限及交付阶段禁用。制作岗位仍隐藏客户及价格。
- 为确保开发服务加载最新样式，按原命令和环境重启现有 5173 Vite；后端进程及业务数据不变。刷新现有工作台即可查看。

截图：[手机商品布局](assets/2026-10-23-item-layout-mobile.png)、[桌面商品布局](assets/2026-10-23-item-layout-desktop.png)。
