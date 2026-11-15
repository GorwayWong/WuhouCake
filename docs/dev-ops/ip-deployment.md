# 无域名公网 IP 部署

## 当前实例

2026-11-01 部署于 `47.106.168.39`，访问入口为 `https://47.106.168.39`，HTTP 自动跳转到 HTTPS。使用 Let's Encrypt 的 IP 证书，不需要配置域名。IP 证书有效期约六天，必须保持 80 端口可达并正常执行续期。

部署目录为 `/home/tago-deploy/wuhou`，Compose 项目名为 `wuhou-ip`。前后端来自部署时的当前工作区，包含已有未提交的业务修改。未迁移本机业务数据库，线上为独立的新数据库。旧 TAGO 环境保持停止，其卷、证书和恢复资料保留。

2026-11-08 当前版本为 `20261108T083033Z-pricing-ui`，镜像为 `wuhou-app:20261108T083033Z-pricing-ui`，前端目录为 `releases/20261108T083033Z-pricing-ui/dist`，对应源码提交 `2dc3116`。上线录单 UI、日期显示、前厅制作权限、双报价与支付登记、编辑图片暂存及更新提示；Flyway 新增 V26，旧 25 个迁移文件保持不变。切换前后 32 张订单、93 个商品项、53 张图片、3 个账号保持不变。当前进度保留三项已知草稿／编辑缺陷，详见[本次发布验收及恢复限制](../verification/2026-11-08-pricing-ui-deployment.md)。

配置来源为 [Compose](compose/docker-compose-ip.yml)、[Caddy 配置](compose/Caddyfile.ip)、[证书续期脚本](compose/renew-ip-certificate.sh)和[数据库备份脚本](compose/backup-ip-database.sh)。服务器的 `compose.yml` 对应仓库 Compose 文件；`.env` 包含随机数据库密码、运行 UID/GID、发布目录和镜像名，权限为 `600`，不纳入版本控制。当前网关复用服务器已有 Caddy 2.10.2 镜像，并创建独立的 Wuhou 容器。

应用使用 `prod` profile，保留 Secure Cookie 和 CSRF 校验。客户填单 origin 为 `https://47.106.168.39`。Caddy 配置 `default_sni`，兼容直接访问 IP 时不发送 SNI 的客户端；API 与前端同源，SSE 关闭代理缓冲。公网仅发布 80/443；后端 8080 绑定回环地址，数据库和 Redis 不发布宿主机端口。

服务器为 2 核、约 1.6 GiB 内存。Compose 限制应用 640 MiB、图片处理端 320 MiB/1 核、PostgreSQL 256 MiB、Redis 96 MiB、网关 64 MiB，主 JVM 堆上限 256 MiB，数据库连接池为 5。图片端与应用使用同一发布镜像，但运行独立监督进程和有期限的解码子进程，不暴露公网端口。该配置用于少量员工协作，承载量须按实际图片、导出与并发量另行压测。

`prod` Web 应用必须设置 `IMAGE_WORKER_URL=http://image-worker:8091/process`，缺失时拒绝启动，禁止自动退回主 JVM 解码。无图操作不依赖图片端的健康状态。部署须同时更新 `app` 和 `image-worker`；仅替换旧 Compose 中的 app 镜像不足以启用隔离。非 Web 管理员初始化/恢复命令不需要图片端，图片维护命令仍须配置图片端。

主应用最多同时处理一批图片上传，另允许两个请求等待最多 2 秒，超额返回 `503 IMAGE_PROCESSING_BUSY`。套餐单批最多 16 张、原始文件总量最多 64 MiB、处理后图片总量最多 32 MiB；仍保留单图 5 MiB、8192 单边和 2400 万像素限制。图片端单张处理期限为 10 秒，主应用调用期限 12 秒；套餐在每张处理前后检查 30 秒整批预算，最后一张调用最多额外占用一个调用期限。超时或处理端失联不会进入套餐写事务。

图片端以只读文件系统、32 MiB 临时内存盘、64 PIDs 上限运行，每张图由独立 128 MiB 堆子进程处理。监督进程在期限后终止并回收子进程。主应用 GC/safepoint 输出到 Docker 轮转日志；图片端日志记录处理结果和耗时，不含图片内容。`unhealthy` 只是健康状态，`restart: unless-stopped` 不会仅因健康失败重启。健康失败先采集日志和线程现场，再人工恢复，避免无上限重启掩盖故障。

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
