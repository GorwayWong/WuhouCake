# 无域名公网 IP 部署

## 当前实例

2026-11-01 部署于 `47.106.168.39`，访问入口为 `https://47.106.168.39`，HTTP 自动跳转到 HTTPS。使用 Let's Encrypt 的 IP 证书，不需要配置域名。IP 证书有效期约六天，必须保持 80 端口可达并正常执行续期。

部署目录为 `/home/tago-deploy/wuhou`，Compose 项目名为 `wuhou-ip`。前后端来自部署时的当前工作区，包含已有未提交的业务修改。未迁移本机业务数据库，线上为独立的新数据库。旧 TAGO 环境保持停止，其卷、证书和恢复资料保留。

2026-11-06 当前版本为 `20261105T160046Z-role-ui`，镜像为 `wuhou-app:20261105T160046Z-role-ui`，前端目录为 `releases/20261105T160046Z-role-ui/dist`，对应代码提交 `bf15f04`。本次上线商品图片幂等上传、取货与出品时间、商品定价与表单、下单方式、经营筛选、客户批注及师傅日历；Flyway 新增 V23、V24，原 22 个迁移文件保持不变。部署前备份已通过完整恢复验证，29 张订单、90 个商品项、51 张图片和 3 个账号保持不变。部署与回滚记录见[本次发布验收](../verification/2026-11-06-role-ui-deployment.md)。

配置来源为 [Compose](compose/docker-compose-ip.yml)、[Caddy 配置](compose/Caddyfile.ip)、[证书续期脚本](compose/renew-ip-certificate.sh)和[数据库备份脚本](compose/backup-ip-database.sh)。服务器的 `compose.yml` 对应仓库 Compose 文件；`.env` 包含随机数据库密码、运行 UID/GID、发布目录和镜像名，权限为 `600`，不纳入版本控制。当前网关复用服务器已有 Caddy 2.10.2 镜像，并创建独立的 Wuhou 容器。

应用使用 `prod` profile，保留 Secure Cookie 和 CSRF 校验。客户填单 origin 为 `https://47.106.168.39`。Caddy 配置 `default_sni`，兼容直接访问 IP 时不发送 SNI 的客户端；API 与前端同源，SSE 关闭代理缓冲。公网仅发布 80/443；后端 8080 绑定回环地址，数据库和 Redis 不发布宿主机端口。

服务器为 2 核、约 1.6 GiB 内存。Compose 限制应用 640 MiB、PostgreSQL 256 MiB、Redis 96 MiB、网关 64 MiB，JVM 堆上限 256 MiB，数据库连接池为 5。该配置用于少量员工协作验证，承载量须按实际图片、导出与并发量另行压测。

## 日常操作

使用服务器部署账号执行：

```bash
cd /home/tago-deploy/wuhou
docker compose ps
docker compose logs --tail 100 app
docker compose restart app
```

身份密钥存放于 `keys/`，数据库和 Redis 分别使用 `wuhou-ip_postgres-data`、`wuhou-ip_redis-data` 卷；订单图片同订单数据一起保存在 PostgreSQL。不要执行带 `--volumes` 的清理命令。

管理员工号为 `0001`，临时密码通过受限凭据文件交付，首次登录需修改。员工由店长在员工管理中创建。初始化和管理员密码恢复遵循 [Prod 管理员运维](admin-prod.md)，运维目录为当前部署目录下的 `admin-ops/`，容器运行 UID/GID 使用 `.env` 中的值。

## 证书与备份

部署账号的 crontab 每 12 小时执行证书续期并重载网关，每天服务器时间 03:35 执行数据库备份。两项任务均使用 `flock` 防止重叠；日志存放于 `maintenance/renew.log`、`maintenance/backup.log`。

```bash
cd /home/tago-deploy/wuhou
./renew-ip-certificate.sh
./backup-ip-database.sh
docker compose run --rm -T certbot renew --dry-run --no-random-sleep-on-renew
```

备份为 `backups/wuhou-<UTC时间>.dump`，保留至少七天。首次备份已通过临时数据库的完整恢复验证，临时数据库在验证后删除。备份目前保存在同一台服务器上；服务器整体丢失时仍需要异地副本。

证书续期 dry-run 已通过。服务器目录 `maintenance/verification.json` 保存首次备份恢复和资源检查结果。不要删除 `letsencrypt/`、`keys/`、`.env` 或数据库卷；这些文件应连同异地数据库备份一起由运维方保管。
