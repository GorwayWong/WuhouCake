# IP 部署的 PostgreSQL 时间点恢复

pgBackRest 通过基础备份和连续 WAL 将 PostgreSQL 17 恢复到指定时刻。备份仓库使用同一台服务器上的独立文件系统。目标是连续保留至少 30 天，并在归档正常时将最新可恢复点控制在 5 分钟内。恢复窗口从首个有效物理备份开始累积。服务器整体损坏超出此方案的覆盖范围。

## 预发布与维护切换

1. 用真实规模的脱敏测试库测量全备大小、日常及高峰 WAL 生成量和恢复时间。为至少 30 天 WAL、全备、差异备份和新旧备份轮换留足空间，并分别核对 PGDATA 文件系统和备份盘的剩余空间。监控缺省低水位为 2 GiB，按高峰 WAL 和预计值班响应时间上调。现有每日 `pg_dump` 继续运行。
2. 将 [Compose 覆盖](compose/docker-compose-pitr.yml)、[Dockerfile](compose/postgres-pitr.Dockerfile)、[配置](compose/pgbackrest-ip.conf)、[发布脚本](compose/deploy-ip.sh)和[备份脚本](compose/backup-ip-pitr.sh)放在生产 `compose.yml` 同目录。将 `.env` 的 `PITR_REPO_DIR` 设为独立盘内专用子目录的绝对路径。用 `findmnt -n -o TARGET,UUID -T "$PITR_REPO_DIR"` 核对实际挂载点和 UUID，分别填入 `PITR_REPO_MOUNT` 与 `PITR_REPO_FS_UUID`。脱离该文件系统时，底层目录应缺少同名子目录。将挂载加入宿主机开机配置，在 Docker 启动及每次切换前校验挂载。仓库目录仅允许镜像内 PostgreSQL 用户及授权运维访问。镜像使用当期生产 PostgreSQL 17 基础镜像的已验证标签或摘要，构建后记录包含 pgBackRest 的镜像 ID。
3. 在隔离环境执行下方同套配置并完成恢复演练。生产维护窗口内先取得一份新的逻辑备份并校验可读，再暂停应用写入。保持原 Compose 项目名、PostgreSQL 卷和数据库凭据，在部署目录的 `.env` 把 `docker-compose-pitr.yml` 追加到 [COMPOSE_FILE 清单](ip-deployment.md)末尾。发布脚本在启动 PostgreSQL 前核对 PITR 配置。初始创建 stanza 前出现的归档失败应在 `check` 后核对是否已再次成功、积压已消除。

```sh
unset COMPOSE_FILE COMPOSE_PATH_SEPARATOR COMPOSE_ENV_FILES COMPOSE_DISABLE_ENV_FILE COMPOSE_PROJECT_NAME PITR_REPO_DIR
docker compose --env-file .env build postgres
./deploy-ip.sh --check postgres
./deploy-ip.sh postgres
docker compose exec -T -u postgres postgres \
  pgbackrest --stanza=wuhou stanza-create
./backup-ip-pitr.sh check
./backup-ip-pitr.sh full
./backup-ip-pitr.sh metrics
```

通过后恢复应用写入。后续统一使用 `./deploy-ip.sh` 发布，更新后运行 `./backup-ip-pitr.sh check`。启用 30 秒私网采集，让与 `/app` 相同的认证采集器将 `./backup-ip-pitr.sh metrics` 的输出提供到 `/pitr`，失败时返回非 2xx。复制现有 `wuhou-app` 抓取配置，改 job 为 `wuhou-pitr`、路径为 `/pitr`，再加载 [pitr-alerts.yml](monitoring/pitr-alerts.yml)。在预发布断开备份仓库写入、制造备份过期及模拟磁盘低水位，确认告警和恢复通知。归档失败时优先恢复目标盘和归档命令，保留尚未归档的 WAL。

使用部署账号的 crontab，每周日 02:00 跑 `full`，周一至周六 02:00 跑 `diff`。两条任务共用一个 `flock`，写现有维护日志目录，与 03:35 的逻辑备份错峰。上线后复核两种备份的耗时，若任务跨过下一份备份的启动时间则调整窗口。物理备份与 WAL 由 pgBackRest 根据保留策略统一管理。

若首次切换无法恢复健康归档，在维护窗口从 `.env` 的 `COMPOSE_FILE` 移除 PITR 覆盖，同时移除 `PITR_REPO_DIR`、`PITR_REPO_MOUNT` 和 `PITR_REPO_FS_UUID`。核对其余覆盖文件仍在，再运行 `./deploy-ip.sh postgres --disable-pitr` 使用原镜像恢复 PostgreSQL，保留同一个数据卷及所有已写出的备份。停用物理备份调度和对应告警并记录 WAL 链断点。下次启用需要重新做基础备份和恢复演练。

## 隔离恢复及演练

准备确定的带时区目标时刻和一个全新的 Docker 数据卷。使用部署用的 PITR 镜像，隔离容器网络，不映射端口，仓库只读挂载。以下从部署目录执行，变量使用实际值，`restore_volume` 必须是刚创建的空卷。

```sh
docker volume create "$restore_volume"
docker run --rm --network none --entrypoint sh \
  -v "$restore_volume:/var/lib/postgresql/data" "$pitr_image" \
  -c 'chown postgres:postgres /var/lib/postgresql/data'
docker run --rm --network none --user postgres --entrypoint pgbackrest \
  -v "$restore_volume:/var/lib/postgresql/data" \
  -v "$PITR_REPO_DIR:/var/lib/pgbackrest:ro" \
  -v "$PWD/pgbackrest-ip.conf:/etc/pgbackrest/pgbackrest.conf:ro" \
  "$pitr_image" --stanza=wuhou --type=time --target="$target" --target-action=promote restore
docker run -d --name "$restore_container" --network none \
  -v "$restore_volume:/var/lib/postgresql/data" \
  -v "$PITR_REPO_DIR:/var/lib/pgbackrest:ro" \
  -v "$PWD/pgbackrest-ip.conf:/etc/pgbackrest/pgbackrest.conf:ro" \
  "$pitr_image" postgres -c archive_mode=off -c listen_addresses=
docker exec -u postgres "$restore_container" psql -X -U wuhou -d wuhou -c 'SELECT pg_is_in_recovery()'
```

最后一条命令须在恢复日志显示到达目标并完成提升后返回 `f`。演练先在测试库做全备，再创建订单、附图、发布活动并追加商品，提交后记录数据库时钟。随后模拟误删并写入另一笔正常订单，执行 `pg_switch_wal()` 和归档 `check`。恢复前者的目标时刻后核对订单、商品数量、图片字节摘要、活动和追加回执，同时确认后者仅在原库存在。记录恢复耗时和最后可用 WAL 的时间跨度。真实事故先在隔离库核对，另外为当前线上数据做备份，再按所需订单定向回补。
