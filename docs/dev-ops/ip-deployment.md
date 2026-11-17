# 无域名公网 IP 部署

## 当前实例

2026-11-01 部署于 `47.106.168.39`，访问入口为 `https://47.106.168.39`，HTTP 自动跳转到 HTTPS。使用 Let's Encrypt 的 IP 证书，不需要配置域名。IP 证书有效期约六天，必须保持 80 端口可达并正常执行续期。

部署目录为 `/home/tago-deploy/wuhou`，Compose 项目名为 `wuhou-ip`。前后端来自部署时的当前工作区，包含已有未提交的业务修改。未迁移本机业务数据库，线上为独立的新数据库。旧 TAGO 环境保持停止，其卷、证书和恢复资料保留。

2026-11-08 当前版本为 `20261108T083033Z-pricing-ui`，镜像为 `wuhou-app:20261108T083033Z-pricing-ui`，前端目录为 `releases/20261108T083033Z-pricing-ui/dist`，对应源码提交 `2dc3116`。上线录单 UI、日期显示、前厅制作权限、双报价与支付登记、编辑图片暂存及更新提示；Flyway 新增 V26，旧 25 个迁移文件保持不变。切换前后 32 张订单、93 个商品项、53 张图片、3 个账号保持不变。当前进度保留三项已知草稿／编辑缺陷，详见[本次发布验收及恢复限制](../verification/2026-11-08-pricing-ui-deployment.md)。

配置来源为 [Compose](compose/docker-compose-ip.yml)、[Caddy 配置](compose/Caddyfile.ip)、[证书续期脚本](compose/renew-ip-certificate.sh)和[数据库备份脚本](compose/backup-ip-database.sh)。服务器的 `compose.yml` 对应仓库 Compose 文件；`.env` 包含随机数据库密码、运行 UID/GID、发布目录和镜像名，权限为 `600`，不纳入版本控制。当前网关复用服务器已有 Caddy 2.10.2 镜像，并创建独立的 Wuhou 容器。

应用使用 `prod` profile，保留 Secure Cookie 和 CSRF 校验。客户填单 origin 为 `https://47.106.168.39`。Caddy 配置 `default_sni`，兼容直接访问 IP 时不发送 SNI 的客户端；API 与前端同源，Caddy 根据事件流响应头即时转发 SSE。公网仅发布 80/443；后端 8080 绑定回环地址，数据库和 Redis 不发布宿主机端口。

最近记录的服务器规格为 2 核、约 1.6 GiB 内存。仓库候选配置限制 app 为 640 MiB / 1.5 CPU / 160 PIDs，图片端为 320 MiB / 1 CPU / 64 PIDs，PostgreSQL、Redis 和网关分别为 256、96 和 64 MiB。发布前以实际服务器及其他容器占用复核容量。稳态内存上限合计 1,376 MiB，约占 1.6 GiB 的 84%。另运行 Certbot 时上限合计 1,568 MiB，执行续期前核对宿主机余量。PostgreSQL、Redis 参数与标准生产 Compose 一致。计算和边界见[本轮稳定性验收](../verification/2026-11-16-stability-followup.md)。

默认使用[应用本地临时目录](README.md#默认本地临时目录)，无需管理员挂载。需要物理容量隔离时，按[专用临时盘](README.md#专用临时盘)预检 ext4/XFS 挂载，在 `.env` 设置 `APP_SCRATCH_HOST_DIR`，并将 [覆盖文件](compose/docker-compose-scratch.yml) 放到部署目录。宿主机挂载根目录须由 `APP_UID:APP_GID` 所有，权限为 `0700`。在部署目录使用以下命令启用，后续 Compose 操作沿用同一组文件。

```sh
docker compose -f compose.yml -f docker-compose-scratch.yml up -d --wait
```

两种模式共用容器内 `/tmp/wuhoucake-app` 和应用预算。Caddy 分别限制订单图片正文 6 MiB 与套餐正文 65 MiB，并拒绝公网 Actuator。采集入口和告警规则见[生产监控](monitoring/README.md)。

`prod` 应用需要 `IMAGE_WORKER_URL=http://image-worker:8091/process`。应用可在图片端未就绪或重启时启动和提供无图操作。部署须使用配套的 app、图片端镜像与 Compose 配置。服务更新可通过 `docker compose up -d --wait` 等待两个健康检查，app 的 liveness 和 readiness 独立于图片端。

套餐和订单图片上传分别允许一个请求解析 Multipart，竞争同一个解码槽。套餐入口超额时立即返回 `503 IMAGE_PROCESSING_BUSY`。订单入口保留两个等待位，每个最多等 2 秒。套餐按顺序解码，整批处理期限 30 秒，每次调用最多 12 秒且不得超过剩余批次时间。输入和输出都受大小限制，超时或解码失败时尚未进入套餐写事务。

图片端以只读文件系统和 16 MiB tmpfs 运行。子 JVM 可在异常退出后重新启动处理下一张图。子进程强杀后两秒仍存活或临时文件无法清理时，监督进程退出，容器由 `restart: unless-stopped` 恢复。若健康检查持续失败，检查 tmpfs、容器退出状态、cgroup OOM 与网络。运行时监控和预发布压测步骤见专项报告。

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
