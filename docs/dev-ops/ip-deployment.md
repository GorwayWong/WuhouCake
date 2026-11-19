# 无域名公网 IP 部署

## 当前实例

2026-11-01 部署于 `47.106.168.39`，访问入口为 `https://47.106.168.39`，HTTP 自动跳转到 HTTPS。使用 Let's Encrypt 的 IP 证书，不需要配置域名。IP 证书有效期约六天，必须保持 80 端口可达并正常执行续期。

部署目录为 `/home/tago-deploy/wuhou`，Compose 项目名为 `wuhou-ip`。前后端来自部署时的当前工作区，包含已有未提交的业务修改。未迁移本机业务数据库，线上为独立的新数据库。旧 TAGO 环境保持停止，其卷、证书和恢复资料保留。

在部署目录执行下列命令核对实际运行的应用和网关前端。镜像标签与发布目录记录各自的源码提交，前端可能独立发布。

```bash
docker compose images app image-worker
docker inspect -f '{{range .Mounts}}{{if eq .Destination "/srv"}}{{.Source}}{{end}}{{end}}' "$(docker compose ps -q gateway)"
```

配置来源为 [Compose](compose/docker-compose-ip.yml)、[Caddy 配置](compose/Caddyfile.ip)、[证书续期脚本](compose/renew-ip-certificate.sh)和[数据库备份脚本](compose/backup-ip-database.sh)。服务器的 `compose.yml` 对应仓库 Compose 文件；`.env` 包含随机数据库密码、运行 UID/GID、发布目录和镜像名，权限为 `600`，不纳入版本控制。当前网关复用服务器已有 Caddy 2.10.2 镜像，并创建独立的 Wuhou 容器。

应用使用 `prod` profile，保留 Secure Cookie 和 CSRF 校验。客户填单 origin 为 `https://47.106.168.39`。Caddy 配置 `default_sni`，兼容直接访问 IP 时不发送 SNI 的客户端；API 与前端同源，Caddy 根据事件流响应头即时转发 SSE。公网仅发布 80/443；后端 8080 绑定回环地址，数据库和 Redis 不发布宿主机端口。

最近记录的服务器规格为 2 核、约 1.6 GiB 内存。仓库候选配置限制 app 为 640 MiB / 1.5 CPU / 160 PIDs，图片端为 320 MiB / 1 CPU / 64 PIDs，PostgreSQL、Redis 和网关分别为 256、96 和 64 MiB。发布前以实际服务器及其他容器占用复核容量。稳态内存上限合计 1,376 MiB，约占 1.6 GiB 的 84%。另运行 Certbot 时上限合计 1,568 MiB，执行续期前核对宿主机余量。PostgreSQL、Redis 参数与标准生产 Compose 一致。计算和边界见[本轮稳定性验收](../verification/2026-11-16-stability-followup.md)。

在部署目录的 `.env` 将 `COMPOSE_FILE` 设为当前环境唯一的文件清单。使用冒号分隔，从 `compose.yml` 开始，按顺序追加已启用的覆盖文件：

```dotenv
# 此例同时启用专用临时盘和 PITR。只列出实际启用的覆盖文件。
COMPOSE_FILE=compose.yml:docker-compose-scratch.yml:docker-compose-pitr.yml
```

默认临时目录无需附加文件。启用[专用临时盘](README.md#专用临时盘)时，预检 ext4/XFS，设置 `APP_SCRATCH_HOST_DIR`，将 [覆盖文件](compose/docker-compose-scratch.yml) 放到部署目录并追加到清单。挂载根目录由 `APP_UID:APP_GID` 所有，权限为 `0700`。启用 PITR 时按 [PITR 手册](pitr-ip.md) 在同一清单末尾追加对应文件。

将 [发布脚本](compose/deploy-ip.sh) 放在部署目录，与 `compose.yml` 和 `.env` 同级。脚本依赖 Python 3.11 或更新版本、Docker Compose 和 curl，PITR 预检另需 Linux 的 `findmnt`。首次升级前从正在使用的容器取得项目、卷和集群标识：

```sh
container=$(docker compose ps -q postgres)
docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container"
docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$container"
docker compose exec -T -u postgres postgres psql -XAt -U wuhou -d wuhou \
  -c 'SELECT system_identifier FROM pg_control_system()'
```

按顺序写入部署目录 `.env` 的 `DEPLOY_POSTGRES_PROJECT`、`DEPLOY_POSTGRES_VOLUME` 和 `DEPLOY_POSTGRES_SYSTEM_IDENTIFIER`。Compose 将原数据卷作为外部卷使用。预检取得本地镜像，以只读方式检查卷内的 PostgreSQL 版本和集群标识。缺卷、空卷、项目或标识不符时，命令在重建前停止。新装空实例须先按独立的初始化流程建立 PostgreSQL 并登记实际集群标识，再使用发布脚本。

```sh
./deploy-ip.sh --check
./deploy-ip.sh --release "$candidate_image" "$candidate_release_dir"
# 已启用 PITR 的环境在更新后执行。
./backup-ip-pitr.sh check
```

正式发布前，将候选镜像加载到本机，把候选静态产物放在新的绝对发布目录下的 `dist/`。保留当前运行版的 `.env`、镜像和发布目录。脚本先核对当前容器及数据库，探测当前 HTTPS 产物，再生成已验证的发布前备份。随后只切换应用、图片端和网关，验证 readiness 及 HTTPS 首页、入口脚本和样式的内容。检查使用公网 IP 的 HTTPS 证书和宿主机信任链。通过后原子登记候选镜像 ID 和目录，结果写入 `maintenance/release-last.json`。

### 失败发布的恢复

只有在隔离环境验证过上一版能读取候选版写入的业务数据后，正式发布才可加 `--rollback-safe`。如果候选失败，脚本停止候选发布服务，核对两版 Flyway 迁移文件、发布前后数据库集群标识和 Flyway 历史，并检查上一版镜像与配置。条件满足时切回上一版并重新探测。即使服务已恢复，候选发布仍返回失败，回执标记为 `rolled-back`。

若回退条件不满足、回退探测失败或发布中断，读取 `maintenance/release-pending.json`，核对当前容器、`.env`、数据库迁移历史和发布期间的写入。先在隔离库验证选定镜像能使用当前 schema 和数据，再登记经过验证的镜像与静态目录。归档待处理记录后执行 `./deploy-ip.sh` 并复检工作台。对不可兼容的迁移优先准备前滚修复。需要恢复数据库时按[备份与恢复手册](backup-recovery.md)在隔离库验收并清点发布后的写入，生产切换单独审批。

两种模式共用容器内 `/tmp/wuhoucake-app` 和应用预算。Caddy 分别限制订单图片正文 6 MiB 与套餐正文 65 MiB，并拒绝公网 Actuator。采集入口和告警规则见[生产监控](monitoring/README.md)。

`prod` 应用需要 `IMAGE_WORKER_URL=http://image-worker:8091/process`。应用可在图片端未就绪或重启时启动和提供无图操作。部署须使用配套的 app、图片端镜像与 Compose 配置。完整发布会等待容器健康检查，再从 app 容器内验证 readiness，包括 PostgreSQL 和 Redis。app 的 liveness 和 readiness 独立于图片端。

套餐和订单图片上传分别允许一个请求解析 Multipart，竞争同一个解码槽。Caddy 2.10.2 为套餐 multipart 单独提供 90 秒请求体读取期限，浏览器对带附件的套餐保存等待最多 150 秒。套餐入口超额时立即返回 `503 IMAGE_PROCESSING_BUSY`。订单入口保留两个等待位，每个最多等 2 秒。套餐按顺序解码，整批处理期限 30 秒，每次调用最多 12 秒且不得超过剩余批次时间。输入和输出都受大小限制，超时或解码失败时尚未进入套餐写事务。

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

生产每天北京时间 03:35 备份到本机，备份失败、漏跑与磁盘告警显示在管理员「服务器情况」并写入主机日志。保留和恢复步骤见[单机单盘备份与恢复](backup-recovery.md)。异机、异盘和[时间点恢复](pitr-ip.md)为可选项。

证书续期每 12 小时运行，用 `flock` 避免重叠，日志位于 `maintenance/renew.log`。

```bash
cd /home/tago-deploy/wuhou
./renew-ip-certificate.sh
docker compose run --rm -T certbot renew --dry-run --no-random-sleep-on-renew
```

请由运维方妥善保管 `letsencrypt/`、`keys/`、`.env`、数据库卷和备份文件。
