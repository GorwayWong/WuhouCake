# 时间轴与客户期望收货时间发布验收

日期：2026-11-01（Asia/Shanghai）。入口：<https://47.106.168.39>。

## 版本与备份

- 发布版本及镜像标签：`20261101T063000Z-timeline`、`wuhou-app:20261101T063000Z-timeline`。
- 发布目录：服务器 `/home/tago-deploy/wuhou/releases/20261101T063000Z-timeline`。
- JAR SHA-256：`3ba01c511dd6c259b9420a89f086d45f247194befecdcaf2488ff0e61cb5b59e`。发布目录的 `release.json` 同时记录前端文件哈希、Git HEAD 和工作区差异哈希；构建内容包含当前工作区已有业务修改。
- 备份：`backups/wuhou-before-20261101T063000Z-timeline.dump`，已用 `pg_restore --list` 校验可读取。备份保存在同一服务器。
- 上一版镜像 `wuhou-app:20261101-ip` 和 `releases/20261101-ip` 保留。上一版环境配置保存在权限为 600 的 `maintenance/20261101T063000Z-timeline-previous.env`，不得提交或对外共享。
- 无新增数据库迁移。切换前后均为 24 张订单、84 个商品项、48 张图片、3 个账号、22 条成功迁移记录。

## 验证

- 发布前通过日历相关前端测试、TypeScript 检查、生产构建；后端定向查询测试、模块 ArchUnit 检查及客户填单到工作台的数据库集成用例通过。
- 上传后逐项核对 JAR 和前端文件哈希，容器健康后切换前端。公网 HTTPS 首页及全部 4 个静态资源与发布清单哈希一致，API 请求通过，未跳过 TLS 校验。
- 使用已有 `DEMO-FRONT`、`DEMO-BAKER` 账号分别验证工作台 API；每个账号当日返回 6 张订单，均包含 `requestedReceiveAt`，抽查结果与订单详情字段一致。
- 桌面 Chromium 分别验证“取货时段”“出品时段”标题，以及红色“客户期望收货时间”；无横向溢出。线上检查只读取业务数据，未新增或修改订单。窄屏、待定时间及跨日期显示已在本地模拟订单预览中检查。

## 发布保护与回滚

首次尝试的版本 `20261101T062400Z-timeline` 因受限解包权限使镜像内 JAR 仅 root 可读，未通过健康检查，发布脚本已自动恢复旧版并验证健康。正式发布通过 Dockerfile 的 `COPY --chmod=644` 固定 JAR 读取权限，静态资源采用目录 755、文件 644，切换前额外检查运行用户能够读取 JAR。

服务器 `maintenance/20261101T063000Z-timeline-deployment.json` 记录正式切换、备份和前后数据计数。如需回滚，在服务器部署目录执行：

```sh
cd /home/tago-deploy/wuhou
cp maintenance/20261101T063000Z-timeline-previous.env .env
chmod 600 .env
docker compose up -d --no-deps --wait --wait-timeout 120 app gateway
```

回滚仅恢复应用和前端，不覆盖数据库、不删除卷，不恢复或修改账号密码。
