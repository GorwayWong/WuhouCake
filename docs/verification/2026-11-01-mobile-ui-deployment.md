# 手机录单与商品卡片发布验收

日期：2026-11-01（Asia/Shanghai）。入口：<https://47.106.168.39>。

## 版本与验证

- 代码提交：`7183e7a4288e4b938c021d2f3bdfdbc5a14ee425`，分支 `codex/fix-employee-access-ux` 已推送。该提交包含此前待提交的业务修正、运维文件及本轮累计界面优化。
- 发布目录：`/home/tago-deploy/wuhou/releases/20261101T083945Z-mobile-ui`；镜像：`wuhou-app:20261101T083945Z-mobile-ui`。
- JAR SHA-256：`bba1ceba83ebe129cb2e0c859ba7bbc7b6c4992d1a0ab5ece408a893fcc35c78`。发布目录 `release.json` 记录代码提交和全部前端文件哈希，公网首页及静态资源与清单一致，未跳过 TLS 校验。
- 前端 121 项测试和生产构建通过；后端定向运行 `OrderQueryServiceTest`、`OrderRecognitionTest`、`EmployeeAccessPolicyTest` 及各相关模块 `ModuleArchitectureTest`，均通过。未重跑全量集成测试。
- 新后端健康后切换网关静态目录，公网 API 正常。前厅及糕点师傅账号登录、工作台与订单详情读取通过；两种视图均显示单张商品详情卡片，并保留完整备齐清单及红色客户期望收货时间。
- 公网手机宽度下，以未提交草稿验证两商品识别、订购人姓名别名、直接填入和强调状态。普通价合计 70.00、会员价合计 36.00 且提示缺价，独立约定总金额为原文识别的 1699.00；无横向溢出或候选确认表。验收不创建或修改订单。

## 数据与回滚

部署前后均为 24 张订单、84 个商品项、48 张图片、3 个账号、22 条成功迁移记录。无新增数据库迁移，未导入本地业务数据。

切换前备份：`backups/wuhou-before-20261101T083945Z-mobile-ui.dump`，已通过 `pg_restore --list` 可读性检查。备份仍位于同一服务器。旧镜像 `wuhou-app:20261101T063000Z-timeline` 和旧发布目录保留。服务器 `maintenance/20261101T083945Z-mobile-ui-deployment.json` 保存切换和数据计数记录。

如需回滚，在服务器执行：

```sh
cd /home/tago-deploy/wuhou
cp maintenance/20261101T083945Z-mobile-ui-previous.env .env
chmod 600 .env
docker compose up -d --no-deps --wait --wait-timeout 120 app gateway
```

该操作只切回应用和前端；不覆盖数据库或账号，不删除卷。环境备份包含运行凭据，权限为 600，不得提交或公开。
