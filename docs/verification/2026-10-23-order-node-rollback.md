# 订单状态逐节点回退验证

## 实现行为

配送流程为待制作 ⇄ 制作中 ⇄ 已夹层 ⇄ 已抹面 ⇄ 其他已确认 ⇄ 待配送 ⇄ 配送中 ⇄ 已完成；自提在其他已确认后进入待自提 ⇄ 已完成。每次仅移动一个相邻节点。

- 制作接口新增 ROLLBACK_PRODUCTION；REOPEN_PRODUCTION 从待交付退回其他已确认，保留商品勾选。
- 交付接口新增 ROLLBACK_FULFILLMENT；已完成按当前交付方式退回配送中或待自提。
- `POST /api/orders/{id}/restart` 接收 expectedVersion，仅允许已取消订单恢复至待制作，要求 ORDER_CANCEL 和 ORDER_PRODUCTION_UPDATE 双权限。production-actions 不接受 RESTART_CANCELLED，防止绕过权限。
- 普通后退保留商品勾选；退回待制作或恢复取消单时，清空整单阶段，全部有效商品重置为 NOT_STARTED。已移除商品不重置。
- 向前确认其他和完成制作继续检查全部有效商品已完成。历史缺少制作阶段记录的订单使用相同链，不补写旧活动或自动补勾。
- 每次成功移动递增一次版本，原事务记录操作者及 before/after，提交后通知 SSE；不自动重试。
- 详情按钮明确标注目标；每次后退或恢复取消单使用确认弹窗说明勾选保留／重置，无需原因。待制作无后退，已完成无前进。保留编辑草稿与明确响应更新基线的规则。
- 不新增迁移，不批量调整现有订单；订单号、客户、商品业务资料、金额、付款状态与 paidAt、图片、备注及旧活动保持不变。

## 自动化结果

| 检查 | 结果 |
| --- | --- |
| 订单模块单元测试及模块 ArchUnit | PASS，191 项 |
| bootstrap 单元测试及全局 ArchUnit（排除 OrderStreamWebTest） | PASS，38 项 |
| OrderIT 全部 HTTP／数据库集成用例 | PASS，34 项 |
| 增强历史空阶段及后退活动失败回滚检查后的定向集成复验 | PASS，1 项 |
| 前端节点映射、制作权限、编辑草稿、表单及筛选相关测试 | PASS，17 项 |
| 前端全量 | 83/84 通过，1 项既有分类断言失败 |
| TypeScript 与 Vite 构建 | PASS，保留现有 bundle 大小提示 |
| git diff --check | PASS |

验证覆盖配送与自提的完整后退矩阵、首尾节点和非法动作、历史未记录阶段、退回待制作重置、取消恢复、保留付款及业务资料、过期版本、恢复双权限、活动写入失败回滚、外层事务回滚及 SSE 提交后发送。

主要命令：

```bash
./mvnw -Pintegration -pl WuhouCake-bootstrap -am verify \
  '-Dtest=*Test,!OrderStreamWebTest' -Dsurefire.failIfNoSpecifiedTests=false \
  -Dit.test=OrderIT -Dfailsafe.failIfNoSpecifiedTests=false
./mvnw -Pintegration -pl WuhouCake-bootstrap -am verify \
  -Dtest=OrderServiceTest -Dsurefire.failIfNoSpecifiedTests=false \
  '-Dit.test=OrderIT#adjacentRollbackPersistsAllNodesAndPreservesPaidDataAndItemChecks' \
  -Dfailsafe.failIfNoSpecifiedTests=false
cd frontend
node --experimental-strip-types --test tests/orderTransitions.test.ts tests/productionView.test.ts tests/items.test.ts tests/orderForm.test.ts tests/calendarStatus.test.ts
npm test
npm run build
```

既有验证缺口：`OrderStreamWebTest` 缺少 OrderPackageService 测试 Bean，本次排除，未计为通过；前端 productTypes.test.ts 仍期待旧商品分类，本次未修改分类或该断言。

## 浏览器检查

使用独立 agent-browser 会话、5174 前端及 18081 内存接口夹具，检查实际前端组件；所有模拟状态移动仅发生于夹具，不连接业务数据库。真实接口权限、事务与持久化由上述集成测试覆盖。

- 390 手机及 1280 桌面宽度无横向溢出；已抹面同时显示退回已夹层和确认其他按钮。
- 确认提示包含目标与保留勾选说明。取消确认后状态和勾选不变；接受后逐步退至已夹层、制作中，勾选保持。
- 从制作中退回待制作时，提示清空勾选；成功后只显示开始制作，商品勾选清空且禁用。
- 已取消显示恢复至待制作；恢复后付款仍为已付款。只有制作权限、缺少取消权限时不显示恢复按钮。
- 已完成配送单只显示退回配送中；退回后显示退回待配送和完成配送。已完成自提单显示退回待自提。
- 商品编辑草稿在后台状态变为待交付后保留，通过明确的“退回其他已确认”响应更新基线，草稿不被覆盖。

截图：[手机相邻节点操作](assets/2026-10-23-node-rollback-mobile.png)、[历史完成单后退入口](assets/2026-10-23-node-rollback-completed.png)。

## 现有工作台生效与数据保留

已按原配置更新运行服务：8080 后端 PID 28340，5173 前端 PID 28485。健康与就绪检查 UP，工作台首页 HTTP 200；前端资源已核对含新的回退动作。

后端重启前保存 public schema 的自定义格式备份，并检查备份目录含订单数据。优雅停止后、启动前与启动后，public 下全部 13 张表的行数及排序行内容 MD5 完全一致：订单 13 笔、商品 23 条、操作记录 143 条。没有对原业务订单调用状态变更接口，没有重置账号或清空数据库／Redis。

备份和核对结果位于 `/var/folders/4f/k4pz80756g15mx0tfw3pg_cc0000gn/T/wuhou-backend-restart-20261023-ae6jfbpw/`：`business-public.dump`、`restart-result.json`、`backend.log`。备份目录权限 700，文件权限 600；系统临时目录不作为长期归档。

运行 JAR SHA-256：`edbd7b1fe1d0ae5e37f16f456799cf84559c5b05e256f61e8eec1ed33cedb3f5`。原有未提交改动保留，本次未提交或推送。
