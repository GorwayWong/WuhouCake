# 录单草稿与识别界面发布验收

日期：2026-11-04（Asia/Shanghai）。入口：<https://47.106.168.39>。

## 版本与构建

- 代码提交：`f579c8b89ae5329c8111b931bd030e8cf33dcd4b`，包含 `50ee28a` 的本机草稿和手机录单调整，以及本次去掉识别统计提示和“未识别内容”的修改；保留撤销操作和字段核对标记。
- 发布目录：`/home/tago-deploy/wuhou/releases/20261104T043157Z-order-drafts`。
- 镜像：`wuhou-app:20261104T043157Z-order-drafts`。
- JAR SHA-256：`d2fde61e31f0f86fc398ce473d17f4cf60eeca88dd2fe3f45e001d49cb419fa2`。
- 发布目录 `release.json` 记录源码提交、工作区差异哈希、JAR 及全部 6 个前端文件哈希；源码发布时工作区干净。
- 发布前前端 134 项测试、12 项模拟 API 浏览器回归和生产构建通过，后端 27 项 OrderServiceTest 与 61 项 ArchUnit 检查通过。JDK 21 打包成功；未重跑完整后端集成套件。草稿验证详情见[本机草稿验证](2026-11-04-order-draft.md)。

## 线上验证

- 上传包及解包文件哈希全部核对通过。新后端健康后切换网关前端目录。
- 公网 HTTPS 首页、JavaScript、CSS、品牌图片及手机图标共 6 个文件与发布清单 SHA-256 完全一致，未跳过 TLS 校验。
- 应用 liveness 为 `UP`，应用、PostgreSQL、Redis 健康，网关正常运行；保留原来的 HTTPS、身份密钥、数据库和 Redis 配置。
- 本机历史演示账号凭据已无法认证，服务器保存的演示凭据记录与本机相同。本次没有重置密码、修改账号，也未完成需要登录的线上识别及草稿恢复验收。识别显示和恢复交互的自动回归来自发布前隔离浏览器的模拟 API 测试；真实 iPhone Safari 验收仍待完成。
- 发布验收未创建、修改或删除订单。

## 数据与备份

从上一版 `20261101T095154Z-customer-search` 切换。部署前后均为 29 张订单、90 个商品项、51 张图片、3 个账号、22 条成功迁移记录。新旧 JAR 内的 22 个 Flyway 迁移文件逐项校验一致，无新增迁移，未导入本地业务数据。

切换前备份：`backups/wuhou-before-20261104T043157Z-order-drafts.dump`，大小 2,592,533 字节，已通过 `pg_restore --list` 可读性检查，本次未做完整恢复演练。旧镜像和发布目录保留；备份仍在同一服务器。

部署记录：`maintenance/20261104T043157Z-order-drafts-deployment.json`，包含版本、前后数据计数、备份路径及静态资源验收结果。构建及切换日志：`maintenance/20261104T043157Z-order-drafts-deploy.log`。

## 回滚

在服务器部署目录执行：

```sh
cd /home/tago-deploy/wuhou
cp maintenance/20261104T043157Z-order-drafts-previous.env .env
chmod 600 .env
docker compose up -d --no-deps --wait --wait-timeout 150 app gateway
```

该操作切回旧应用与前端，不覆盖数据库、不删除卷、不修改账号。环境备份含运行凭据，权限为 600，不得提交或公开。
