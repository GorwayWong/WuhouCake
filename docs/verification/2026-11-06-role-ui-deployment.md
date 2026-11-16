# 订单功能与角色工作台发布验收

日期：2026-11-06（Asia/Shanghai）。入口：<https://47.106.168.39>。

## 版本

- 源码提交：`bf15f049d6ed4c3ac935a2d5e41c4c952515b859`，发布源码工作区干净。
- 发布目录：`/home/tago-deploy/wuhou/releases/20261105T160046Z-role-ui`。
- 镜像：`wuhou-app:20261105T160046Z-role-ui`。
- JAR SHA-256：`9633130a4527283525891ea20de7aa2e5739a8b2d0427c5132be332e8e8c3607`。
- 发布包 SHA-256：`5a8cd2f361166ebab8f2c075df824c872ce45e7cd5481f721a348f62b33ee453`。
- `release.json` 保存源码版本和 JAR、6 个前端文件的哈希；上传、解包和公网 HTTPS 静态资源逐项校验通过。

本次包含当前工作区已完成的商品图片、取货/出品时间、商品定价和表单布局、下单方式、经营筛选、客户填单批注及师傅日历调整，不导入本机业务数据，不重置线上账号。

## 发布前验证

- 前端 161 项单元测试、生产构建通过。38 项合成接口浏览器场景通过；完整回归中的旧价格测试定位适配当前前台详情 DOM 后，相关两项定向复验通过。覆盖图片、草稿恢复、定价、表单、客户填单、筛选、详情和角色日历。
- JDK 21 后端单元及架构测试 349 项通过。
- PostgreSQL/Redis/HTTP 集成测试共 152 项，148 项通过、3 项断言失败、1 项异常。以下 4 项在未修改的已提交版本 `72ce137` 中用独立测试 schema 再次复现相同失败，不能将完整集成套件标记为通过：
  - `WorkflowManagementIT.ownershipChangesRecordRealActorAndArchivedEmployeeKeepsHistoricalAttribution`
  - `WorkflowManagementIT.mixedProductsAreCountedByQuantityAndFilteredExportMatchesTheListWithoutLogs`
  - `WorkflowManagementIT.employeeGroupsUseStableAccountsAndExposeUnknownAmountsWithoutDuplicatingMixedOrderMoney`
  - `WorkflowManagementIT.exportKeepsOneSnapshotWhileAnotherEmployeeChangesTheMatchingOrder`
- 上述用例仍假设手工录单可归属另一员工，既有实现按实际录单人归属；本次没有改动该归属行为或改写这些测试。背景见[时间验证](2026-11-04-order-times.md#既有失败的独立复现)。
- 第一次沙箱内 JDK 文件导出测试进程异常退出；在沙箱外启用 headless 后完整复验，无此异常。Java 21 部署打包成功。
- 仅使用临时测试 PostgreSQL/Redis 容器，不写入本机开发业务库或线上库。

## 数据库与备份

原 22 个 Flyway SQL 文件逐项哈希一致，仅新增：

- V23：图片上传幂等记录表、有效商品图片索引。
- V24：订单下单方式可空字段。

切换前创建 `backups/wuhou-before-20261105T160046Z-role-ui.dump`，大小 2,592,811 字节；已在服务器临时数据库中执行完整 `pg_restore --exit-on-error`，恢复后订单、商品、图片、账号及 22 条迁移计数与原库一致，验证后删除临时数据库。备份权限为 600，仍保存在同一服务器。

部署前后分别为 `29 / 90 / 51 / 3` 张订单、商品项、图片、账号。成功迁移记录由 22 增至 24；应用日志确认两条迁移成功，未发现删除或回填业务数据。

## 线上检查

- 应用 liveness 为 `UP`；应用、PostgreSQL、Redis 健康，网关正常。
- 公网 HTTPS 首页、JS、CSS、品牌图片和手机图标共 6 个文件均为 200 且与清单哈希相同，未跳过 TLS 校验。
- CSRF 接口 200，Cookie 保留 Secure 与 SameSite；未登录 `/api/me` 为 401。
- 保留原 HTTPS、密钥、数据库、Redis、同源 API 和 SSE 代理配置。此次没有创建、修改或删除线上订单，也没有重置密码。
- 未进行需要真实员工凭据的线上交互验收；角色交互来自隔离浏览器模拟接口，真实手机 Safari 和员工登录后仍需复核。

服务器部署记录：`maintenance/20261105T160046Z-role-ui-deployment.json`；构建/切换日志：`maintenance/20261105T160046Z-role-ui-deploy.log`。

## 回滚

旧镜像、旧前端目录和受限环境备份均保留。服务器执行：

```sh
cd /home/tago-deploy/wuhou
cp maintenance/20261105T160046Z-role-ui-previous.env .env
chmod 600 .env
docker compose up -d --no-deps --wait --wait-timeout 150 app gateway
```

此命令切回前一版应用与前端，保留数据库及新增的可兼容表、索引、可空字段；不自动恢复旧数据库，不删除卷或覆盖上线后的业务数据。环境备份含运行凭据，不得提交或公开。本次没有执行线上回滚演练。
